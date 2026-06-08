// Feature: your-walk-tracker — badge unlocks (YW4, YW5)
//
// Tests for evaluateBadgeUnlocks_:
//   YW4 — Determinism. Same (stamps, catalog, alreadyUnlocked) always
//         yields the same (newlyUnlocked, all).
//   YW5 — Idempotency. After running once and folding result.newlyUnlocked
//         into alreadyUnlocked, a second call returns newlyUnlocked = [].
//
// Plus explicit boundary tests for each of the five seed-badge rules
// at their unlock thresholds, and a default → false test for any
// catalog entry with an unknown unlockRule string.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fc from 'fast-check';

import { evaluateBadgeUnlocks_ } from '../docs/apps-script/your-walk-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CATALOG = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'your-walk-badges.json'), 'utf8'
));

// Helper — build a stamp object with sensible defaults.
function stamp(date, opts = {}) {
  return {
    stamp_date:     date,
    anchor_book:    opts.book   || '',
    anchor_chapter: opts.chapter == null ? '' : opts.chapter,
    stream:         opts.stream || '',
  };
}

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


// ── Empty / edge-case base ─────────────────────────────────────────

test('evaluateBadgeUnlocks_ — empty stamps + empty alreadyUnlocked → no unlocks', () => {
  const r = evaluateBadgeUnlocks_([], CATALOG, []);
  assert.deepEqual(r, { newlyUnlocked: [], all: [] });
});

test('evaluateBadgeUnlocks_ — null catalog → no unlocks', () => {
  const r = evaluateBadgeUnlocks_([stamp('2026-04-30')], null, []);
  assert.deepEqual(r, { newlyUnlocked: [], all: [] });
});

test('evaluateBadgeUnlocks_ — unknown unlockRule never unlocks (default → false)', () => {
  const r = evaluateBadgeUnlocks_([stamp('2026-04-30')], CATALOG, []);
  // The synthetic-unknown-rule fixture should NEVER appear in newlyUnlocked.
  assert.equal(r.newlyUnlocked.includes('synthetic-unknown-rule'), false);
  assert.equal(r.all.includes('synthetic-unknown-rule'), false);
});


// ── first-chapter-back (rule: first-stamp-ever) ────────────────────

test('first-chapter-back — unlocks on the first stamp', () => {
  const r = evaluateBadgeUnlocks_([stamp('2026-04-30')], CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('first-chapter-back'), true);
});

test('first-chapter-back — does NOT unlock with zero stamps', () => {
  const r = evaluateBadgeUnlocks_([], CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('first-chapter-back'), false);
});


// ── walked-through-john (rule: twenty-one-john-chapters) ───────────

test('walked-through-john boundary — 20 distinct John chapters does NOT unlock', () => {
  const stamps = [];
  for (let ch = 1; ch <= 20; ch++) {
    stamps.push(stamp(addDays('2026-04-01', ch), { book: 'John', chapter: ch, stream: 'nt' }));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('walked-through-john'), false);
});

test('walked-through-john boundary — 21 distinct John chapters unlocks', () => {
  const stamps = [];
  for (let ch = 1; ch <= 21; ch++) {
    stamps.push(stamp(addDays('2026-04-01', ch), { book: 'John', chapter: ch, stream: 'nt' }));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('walked-through-john'), true);
});

test('walked-through-john — distinct CHAPTERS, not stamps (re-reading John 3 doesn\'t count twice)', () => {
  const stamps = [];
  // 21 stamps but only on chapter 3 — should NOT unlock.
  for (let i = 0; i < 21; i++) {
    stamps.push(stamp(addDays('2026-04-01', i), { book: 'John', chapter: 3, stream: 'nt' }));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('walked-through-john'), false);
});


// ── psalmists-30-days (rule: thirty-psalm-stamps) ──────────────────

test('psalmists-30-days boundary — 29 psalm stamps does NOT unlock', () => {
  const stamps = [];
  for (let i = 0; i < 29; i++) {
    stamps.push(stamp(addDays('2026-04-01', i), { stream: 'psalm' }));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('psalmists-30-days'), false);
});

test('psalmists-30-days boundary — 30 psalm stamps unlocks', () => {
  const stamps = [];
  for (let i = 0; i < 30; i++) {
    stamps.push(stamp(addDays('2026-04-01', i), { stream: 'psalm' }));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('psalmists-30-days'), true);
});

test('psalmists-30-days — non-psalm stamps don\'t count toward the 30', () => {
  const stamps = [];
  for (let i = 0; i < 60; i++) {
    stamps.push(stamp(addDays('2026-04-01', i), { stream: 'nt' }));   // wrong stream
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('psalmists-30-days'), false);
});


// ── 30-day-walk (rule: thirty-day-streak) ──────────────────────────

test('30-day-walk boundary — 29 consecutive stamps does NOT unlock', () => {
  const stamps = [];
  for (let i = 0; i < 29; i++) {
    stamps.push(stamp(addDays('2026-04-01', i)));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('30-day-walk'), false);
});

test('30-day-walk boundary — 30 consecutive stamps unlocks', () => {
  const stamps = [];
  for (let i = 0; i < 30; i++) {
    stamps.push(stamp(addDays('2026-04-01', i)));
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('30-day-walk'), true);
});

test('30-day-walk — uses LONGEST streak, not current (so a past 30-streak still credits)', () => {
  // 30 consecutive stamps, then a 6-day gap that would reset the
  // CURRENT streak. The longest is still 30, so the badge persists.
  const stamps = [];
  for (let i = 0; i < 30; i++) {
    stamps.push(stamp(addDays('2026-04-01', i)));
  }
  // Big gap (6 days = 5 missed days = beyond the 3-day grace) then stamp again.
  stamps.push(stamp(addDays('2026-04-30', 6)));
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('30-day-walk'), true,
    '30-day-walk unlocks on longest, not current');
});


// ── faithful-in-small-things (rule: five-days-four-weeks) ──────────

test('faithful-in-small-things boundary — 3 weeks of 5 weekday-stamps does NOT unlock', () => {
  // Build 3 consecutive ISO weeks, each with 5 weekday-stamps.
  const stamps = [];
  // 2026-W22 starts Mon May 25 2026 (weekday 1).
  const wkStarts = ['2026-05-25', '2026-06-01', '2026-06-08'];
  for (const monday of wkStarts) {
    for (let dow = 0; dow < 5; dow++) {           // Mon..Fri
      stamps.push(stamp(addDays(monday, dow)));
    }
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('faithful-in-small-things'), false);
});

test('faithful-in-small-things boundary — 4 consecutive weeks of 5 weekday-stamps unlocks', () => {
  const stamps = [];
  const wkStarts = ['2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15'];
  for (const monday of wkStarts) {
    for (let dow = 0; dow < 5; dow++) {
      stamps.push(stamp(addDays(monday, dow)));
    }
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('faithful-in-small-things'), true);
});

test('faithful-in-small-things — non-CONSECUTIVE qualifying weeks don\'t unlock', () => {
  const stamps = [];
  // 4 qualifying weeks but with a 1-week gap between weeks 2 and 3.
  const wkStarts = ['2026-05-25', '2026-06-01', '2026-06-15', '2026-06-22'];
  for (const monday of wkStarts) {
    for (let dow = 0; dow < 5; dow++) {
      stamps.push(stamp(addDays(monday, dow)));
    }
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('faithful-in-small-things'), false);
});

test('faithful-in-small-things — weekend stamps do not count toward the 5-per-week', () => {
  const stamps = [];
  // 4 weeks but only weekend stamps each week — should NOT unlock.
  const wkStarts = ['2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15'];
  for (const monday of wkStarts) {
    stamps.push(stamp(addDays(monday, 5)));    // Sat
    stamps.push(stamp(addDays(monday, 6)));    // Sun
  }
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, []);
  assert.equal(r.newlyUnlocked.includes('faithful-in-small-things'), false);
});


// ── YW4 — determinism property ────────────────────────────────────

test('YW4 (property) — same input always yields same output', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          dayOffset: fc.integer({ min: 0, max: 90 }),
          book: fc.constantFrom('John', 'Genesis', 'Psalm', ''),
          chapter: fc.integer({ min: 1, max: 21 }),
          stream: fc.constantFrom('nt', 'psalm', 'otHistory', ''),
        }),
        { minLength: 0, maxLength: 50 }
      ),
      fc.array(fc.constantFrom(
        'first-chapter-back',
        'walked-through-john',
        'psalmists-30-days',
        '30-day-walk'
      ), { maxLength: 4 }),
      (rawStamps, alreadyArr) => {
        const stamps = rawStamps.map(s => stamp(addDays('2026-04-01', s.dayOffset), {
          book: s.book, chapter: s.chapter, stream: s.stream,
        }));
        const a = evaluateBadgeUnlocks_(stamps, CATALOG, alreadyArr);
        const b = evaluateBadgeUnlocks_(stamps, CATALOG, alreadyArr);
        return JSON.stringify(a) === JSON.stringify(b);
      }
    ),
    { numRuns: 200 }
  );
});


// ── YW5 — idempotency property ────────────────────────────────────

test('YW5 (property) — second eval after folding newlyUnlocked yields []', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          dayOffset: fc.integer({ min: 0, max: 90 }),
          book: fc.constantFrom('John', 'Genesis', 'Psalm', ''),
          chapter: fc.integer({ min: 1, max: 21 }),
          stream: fc.constantFrom('nt', 'psalm', 'otHistory', ''),
        }),
        { minLength: 0, maxLength: 50 }
      ),
      (rawStamps) => {
        const stamps = rawStamps.map(s => stamp(addDays('2026-04-01', s.dayOffset), {
          book: s.book, chapter: s.chapter, stream: s.stream,
        }));
        const r1 = evaluateBadgeUnlocks_(stamps, CATALOG, []);
        const r2 = evaluateBadgeUnlocks_(stamps, CATALOG, [...r1.newlyUnlocked]);
        // After folding the newly-unlocked into alreadyUnlocked, the
        // second eval should report nothing newly unlocked.
        return r2.newlyUnlocked.length === 0
          // And `all` should be the same set across both calls.
          && JSON.stringify([...r1.all].sort()) === JSON.stringify([...r2.all].sort());
      }
    ),
    { numRuns: 200 }
  );
});

test('YW5 example — already-unlocked badge is preserved in `all` but not in `newlyUnlocked`', () => {
  const stamps = [stamp('2026-04-30')];
  // Pre-supply first-chapter-back as already unlocked.
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, ['first-chapter-back']);
  assert.equal(r.all.includes('first-chapter-back'), true);
  assert.equal(r.newlyUnlocked.includes('first-chapter-back'), false);
});

test('YW5 — already-unlocked badges that the rule no longer satisfies are still preserved in `all`', () => {
  // Pretend a member earned walked-through-john historically but
  // their current stamps don't include any John chapters. The badge
  // should NOT be lost from `all`.
  const stamps = [stamp('2026-04-30')];     // no John chapters
  const r = evaluateBadgeUnlocks_(stamps, CATALOG, ['walked-through-john']);
  assert.equal(r.all.includes('walked-through-john'), true,
    'badge persists in `all` even if rule no longer evaluates true');
  assert.equal(r.newlyUnlocked.includes('walked-through-john'), false);
});


// ── alreadyUnlocked accepts both Set and Array ────────────────────

test('evaluateBadgeUnlocks_ — alreadyUnlocked accepts a Set', () => {
  const r = evaluateBadgeUnlocks_(
    [stamp('2026-04-30')],
    CATALOG,
    new Set(['first-chapter-back'])
  );
  assert.equal(r.newlyUnlocked.includes('first-chapter-back'), false);
  assert.equal(r.all.includes('first-chapter-back'), true);
});

test('evaluateBadgeUnlocks_ — alreadyUnlocked accepts an Array', () => {
  const r = evaluateBadgeUnlocks_(
    [stamp('2026-04-30')],
    CATALOG,
    ['first-chapter-back']
  );
  assert.equal(r.newlyUnlocked.includes('first-chapter-back'), false);
  assert.equal(r.all.includes('first-chapter-back'), true);
});

test('evaluateBadgeUnlocks_ — alreadyUnlocked null is treated as empty', () => {
  const r = evaluateBadgeUnlocks_([stamp('2026-04-30')], CATALOG, null);
  // first-chapter-back rule now evaluates true → it should be NEWLY unlocked.
  assert.equal(r.newlyUnlocked.includes('first-chapter-back'), true);
});
