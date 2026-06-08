// Feature: your-walk-tracker — streak math (YW2, YW3)
//
// Tests for computeStreak_:
//   YW2 — 3-day grace correctness. Gap of 4 days extends; gap of 5 resets.
//   YW3 — Streak monotonicity. A sequence of stamps in chronological
//         order can only grow (+1) or reset (to 1). Never shrink in
//         place.
//
// Boundaries are pinned with explicit example tests; fast-check then
// covers the surrounding probability mass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  computeStreak_,
  daysBetweenIso_,
  WALK_DEFAULT_GRACE_DAYS,
} from '../docs/apps-script/your-walk-helpers.js';

// Helper — add `n` calendar days to an ISO date string.
function addDays(iso, n) {
  const p = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}


// ── Empty / single-stamp base cases ───────────────────────────────

test('computeStreak_ — empty input → all zeros, lastStampDate null', () => {
  const out = computeStreak_([], '2026-04-30', 3);
  assert.deepEqual(out, { current: 0, longest: 0, lastStampDate: null });
});

test('computeStreak_ — single stamp → current=1, longest=1', () => {
  const out = computeStreak_(['2026-04-30'], '2026-04-30', 3);
  assert.deepEqual(out, { current: 1, longest: 1, lastStampDate: '2026-04-30' });
});

test('computeStreak_ — duplicates are deduplicated before folding', () => {
  const out = computeStreak_(
    ['2026-04-30', '2026-04-30', '2026-04-30'],
    '2026-04-30',
    3
  );
  assert.deepEqual(out, { current: 1, longest: 1, lastStampDate: '2026-04-30' });
});

test('computeStreak_ — unsorted input is sorted before folding', () => {
  const out = computeStreak_(
    ['2026-05-03', '2026-05-01', '2026-05-02'],
    '2026-05-03',
    3
  );
  assert.deepEqual(out, { current: 3, longest: 3, lastStampDate: '2026-05-03' });
});


// ── YW2 — 3-day grace correctness, explicit boundaries ────────────

test('YW2 boundary — gap of 1 day extends streak (consecutive days)', () => {
  const out = computeStreak_(['2026-04-30', '2026-05-01'], '2026-05-01', 3);
  assert.equal(out.current, 2);
  assert.equal(out.longest, 2);
});

test('YW2 boundary — gap of 4 calendar days (3 missed days) STILL extends', () => {
  // Stamp Tue 04-28; next stamp Sat 05-02 = gap of 4 days, 3 missed days.
  // 3 missed days is the max grace, so streak SHOULD extend.
  const out = computeStreak_(['2026-04-28', '2026-05-02'], '2026-05-02', 3);
  assert.equal(out.current, 2,
    'gap of 4 days = 3 missed days = within the 3-day grace');
  assert.equal(out.longest, 2);
});

test('YW2 boundary — gap of 5 calendar days (4 missed days) RESETS to 1', () => {
  // Stamp Tue 04-28; next stamp Sun 05-03 = gap of 5 days, 4 missed days.
  // That exceeds the 3-day grace by one — streak resets.
  const out = computeStreak_(['2026-04-28', '2026-05-03'], '2026-05-03', 3);
  assert.equal(out.current, 1,
    'gap of 5 days = 4 missed days = exceeds 3-day grace');
  assert.equal(out.longest, 1);
});

test('YW2 — longest is preserved across a reset', () => {
  // Build streak of 5, then break it, then build another streak of 3.
  // Final current=3 but longest=5.
  const dates = [
    '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05',
    // 5 days off — exceeds 3-day grace → reset
    '2026-04-11', '2026-04-12', '2026-04-13',
  ];
  const out = computeStreak_(dates, '2026-04-13', 3);
  assert.equal(out.current, 3);
  assert.equal(out.longest, 5);
});

test('YW2 — graceDays=0 means consecutive days only', () => {
  // With grace 0, gap of 2 calendar days (1 missed day) resets.
  const out = computeStreak_(['2026-04-30', '2026-05-02'], '2026-05-02', 0);
  assert.equal(out.current, 1);
});

test('YW2 — graceDays=7 (a-week grace) extends across larger gaps', () => {
  // Gap of 8 days (7 missed days) is still within a 7-day grace.
  const out = computeStreak_(['2026-04-22', '2026-04-30'], '2026-04-30', 7);
  assert.equal(out.current, 2,
    'gap of 8 days = 7 missed days = within a 7-day grace');
  // Gap of 9 days (8 missed days) exceeds the 7-day grace.
  const out2 = computeStreak_(['2026-04-21', '2026-04-30'], '2026-04-30', 7);
  assert.equal(out2.current, 1);
});


// ── YW2 — fast-check generator across random gaps ─────────────────

test('YW2 (property) — gap g ≤ graceDays+1 extends; g ≥ graceDays+2 resets', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 20 }),    // gap in calendar days
      fc.integer({ min: 0, max: 10 }),    // graceDays
      (gap, grace) => {
        const start = '2026-04-01';
        const next = addDays(start, gap);
        const out = computeStreak_([start, next], next, grace);
        if (gap <= grace + 1) {
          // gap fits within the grace window → streak should be 2
          return out.current === 2 && out.longest === 2;
        } else {
          // gap exceeds the grace window → streak should reset to 1
          return out.current === 1 && out.longest === 1;
        }
      }
    ),
    { numRuns: 500 }
  );
});


// ── YW3 — streak monotonicity ─────────────────────────────────────

test('YW3 (property) — sequence of `current` after each prefix only grows by 1 or resets', () => {
  // For any sorted strictly-ascending list of distinct ISO dates, the
  // sequence of `current` values produced by running computeStreak_
  // after each prefix should only have (+1) or (reset to 1) transitions.
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 30 }),
      (gaps) => {
        const dates = ['2026-01-01'];
        for (const g of gaps) {
          dates.push(addDays(dates[dates.length - 1], g));
        }
        let lastCurrent = 0;
        for (let i = 1; i <= dates.length; i++) {
          const out = computeStreak_(dates.slice(0, i), dates[i - 1], 3);
          const c = out.current;
          if (i === 1) {
            // First prefix → current must be 1
            if (c !== 1) return false;
          } else {
            // c must be either lastCurrent+1 (extension) or 1 (reset).
            // Anything else is a violation of monotonicity.
            if (c !== lastCurrent + 1 && c !== 1) return false;
          }
          lastCurrent = c;
        }
        return true;
      }
    ),
    { numRuns: 300 }
  );
});

test('YW3 — longest is monotonically non-decreasing across prefixes', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 30 }),
      (gaps) => {
        const dates = ['2026-01-01'];
        for (const g of gaps) {
          dates.push(addDays(dates[dates.length - 1], g));
        }
        let lastLongest = 0;
        for (let i = 1; i <= dates.length; i++) {
          const out = computeStreak_(dates.slice(0, i), dates[i - 1], 3);
          if (out.longest < lastLongest) return false;
          lastLongest = out.longest;
        }
        return true;
      }
    ),
    { numRuns: 300 }
  );
});


// ── Determinism — calling twice with the same input yields the same result ─

test('computeStreak_ — deterministic across calls', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 0, maxLength: 25 }),
      (gaps) => {
        const dates = gaps.length === 0 ? [] : ['2026-01-01'];
        for (const g of gaps) {
          dates.push(addDays(dates[dates.length - 1], g));
        }
        const today = dates.length ? dates[dates.length - 1] : '2026-01-01';
        const a = computeStreak_(dates, today, 3);
        const b = computeStreak_(dates, today, 3);
        return a.current === b.current
          && a.longest === b.longest
          && a.lastStampDate === b.lastStampDate;
      }
    ),
    { numRuns: 200 }
  );
});


// ── daysBetweenIso_ — sanity ──────────────────────────────────────

test('daysBetweenIso_ — basic arithmetic', () => {
  assert.equal(daysBetweenIso_('2026-04-30', '2026-05-01'), 1);
  assert.equal(daysBetweenIso_('2026-04-30', '2026-04-30'), 0);
  assert.equal(daysBetweenIso_('2026-05-01', '2026-04-30'), -1);
  assert.equal(daysBetweenIso_('2026-04-01', '2026-05-01'), 30);
});

test('daysBetweenIso_ — month/year boundaries', () => {
  assert.equal(daysBetweenIso_('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetweenIso_('2024-02-28', '2024-03-01'), 2,
    '2024 is a leap year — Feb has 29 days, so Feb 28 → Mar 1 = 2 days');
  assert.equal(daysBetweenIso_('2025-02-28', '2025-03-01'), 1,
    '2025 is NOT a leap year');
});

test('daysBetweenIso_ — invalid input → NaN', () => {
  assert.equal(Number.isNaN(daysBetweenIso_('not-a-date', '2026-04-30')), true);
  assert.equal(Number.isNaN(daysBetweenIso_('2026-04-30', 'not-a-date')), true);
});


// ── Confirm the default grace constant matches the spec ───────────

test('WALK_DEFAULT_GRACE_DAYS === 3', () => {
  assert.equal(WALK_DEFAULT_GRACE_DAYS, 3);
});

test('computeStreak_ — default graceDays parameter is 3', () => {
  // Two stamps 4 days apart; with default grace, streak should extend.
  const out = computeStreak_(['2026-04-28', '2026-05-02'], '2026-05-02');
  assert.equal(out.current, 2);
});
