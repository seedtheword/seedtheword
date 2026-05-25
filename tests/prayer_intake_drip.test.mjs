// Feature: prayer-request-intake, drip-side properties.
//
// Covers:
//   - PI4 (drip respects unsubscribe at fire time)
//   - PI5 (anonymous drips never leak the real name)
//   - Property 7 (verse distinctness within a Submission)
//   - Property 9 (unsubscribe token round-trip + distinctness)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import crypto from 'node:crypto';

import {
  pickVersesForSubmission_,
  parseDripTemplatesPicks_,
  salutation,
  hashCodeFromString_,
} from '../docs/apps-script/prayer-intake-helpers.js';

// ── Property 7 ─────────────────────────────────────────────────
// Validates: Requirement 7.3

test('Property 7 — verse picks are pairwise distinct when k <= verses.length', () => {
  // Verse pool of 31 distinct refs (matches the committed daily-verses.json).
  const versePool = Array.from({ length: 31 }, (_, i) => ({
    text: 'verse text ' + i,
    ref: 'Ref ' + i,
    version: 'KJV',
  }));

  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 64 }),
    fc.integer({ min: 1, max: 31 }),
    (submissionId, k) => {
      const days = Array.from({ length: k }, (_, i) => i);
      const picks = pickVersesForSubmission_(submissionId, days, versePool);
      assert.equal(picks.length, k);
      const seen = new Set();
      for (const v of picks) {
        assert.equal(seen.has(v.ref), false,
          'duplicate ref in picks for submissionId=' + submissionId + ': ' + v.ref);
        seen.add(v.ref);
      }
    },
  ), { numRuns: 200 });
});

test('Property 7 — Day 7 verse is provably different from Day 0 and Day 3', () => {
  const versePool = Array.from({ length: 31 }, (_, i) => ({
    text: 'verse text ' + i,
    ref: 'Ref ' + i,
    version: 'KJV',
  }));
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 64 }),
    (submissionId) => {
      const picks = pickVersesForSubmission_(submissionId, [0, 3, 7, 14], versePool);
      assert.equal(picks.length, 4);
      assert.notEqual(picks[2].ref, picks[0].ref); // day7 vs day0
      assert.notEqual(picks[2].ref, picks[1].ref); // day7 vs day3
    },
  ), { numRuns: 100 });
});

// ── Verse picker is deterministic ──────────────────────────────
test('pickVersesForSubmission_ is deterministic for the same submission_id', () => {
  const verses = Array.from({ length: 5 }, (_, i) => ({ ref: 'V' + i, text: '', version: '' }));
  const a = pickVersesForSubmission_('abc-123', [0, 3, 7, 14], verses);
  const b = pickVersesForSubmission_('abc-123', [0, 3, 7, 14], verses);
  assert.deepEqual(a, b);
});

// ── PI5 ────────────────────────────────────────────────────────
// Validates: Requirements 8.1, 8.2, 8.3, 12.5
//
// We test this at the salutation + template-picks layer (the pure
// helpers that drive renderDripEmail_). The full email render lives
// in order-handler.gs and pulls the same helpers, so the property
// reduces to: salutation('anonymous=true') === 'Friend' AND nothing
// else in the rendered text path can pull in the real name.

test('PI5 — salutation for an anonymous row is the literal "Friend"', () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 80 }),
    (name) => {
      const sal = salutation({ anonymous: true, submitter_name: name });
      assert.equal(sal, 'Friend');
    },
  ), { numRuns: 200 });
});

test('PI5 — template picks never include the real submitter name', () => {
  // The template pools are the only other source of free-form text
  // in a drip email. The picker is a pure index-into-pool function;
  // it cannot synthesize a name, but we test it against pools whose
  // entries are deliberately seeded with strings that include the
  // generated name as a substring — to confirm the picker simply
  // returns pool entries verbatim and never composes them.
  //
  // The name generator requires ≥3 alphanumeric characters and
  // disjointness from the safe pool's English text. Single-character
  // names ("A", "I", " ") trivially substring-match natural English
  // ("and", "his", "the sparrow"); the property is meant to catch
  // composition bugs, not unavoidable English collisions.
  const safePool = [
    'be still and know',
    'his eye is on the sparrow',
    'come unto me',
  ];
  const safeJoined = safePool.join(' ').toLowerCase();
  const dripNameStrategy = fc.string({
    minLength: 3,
    maxLength: 30,
    unit: fc.constantFrom(
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
      'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
      'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ),
  }).filter((s) => s.length >= 3 && !safeJoined.includes(s.toLowerCase()));

  fc.assert(fc.property(
    dripNameStrategy,
    fc.string({ minLength: 1, maxLength: 30 }),
    (name, submissionId) => {
      const picks = parseDripTemplatesPicks_(submissionId, {
        day3_reflections: safePool,
        day3_tips: safePool,
        day7_reflections: safePool,
        day14_invitation_a: safePool[0],
        day14_invitation_b: safePool[1],
      });
      const haystack = (
        picks.day3_reflection + '\n' +
        picks.day3_tip + '\n' +
        picks.day7_reflection + '\n' +
        picks.day14_invitation
      ).toLowerCase();
      assert.equal(haystack.includes(name.toLowerCase()), false,
        'template picks contained the real name (' + JSON.stringify(name) +
        '): ' + JSON.stringify(picks));
    },
  ), { numRuns: 200 });
});

// ── Salutation behavior for non-anonymous case ─────────────────
test('salutation uses first token of name for non-anonymous rows', () => {
  assert.equal(salutation({ anonymous: false, submitter_name: 'Maria K' }), 'Maria');
  assert.equal(salutation({ anonymous: false, submitter_name: '  Bob  ' }), 'Bob');
  assert.equal(salutation({ anonymous: false, submitter_name: '' }), 'Friend');
  assert.equal(salutation({ anonymous: false, submitter_name: null }), 'Friend');
});

// ── PI4 ────────────────────────────────────────────────────────
// Validates: Requirements 7.6, 7.7, 7.9, 9.5, 12.4
//
// We model the cron-side selection predicate against an in-memory
// PrayerDrip table. The cron's contract:
//   1. row.status === 'pending' AND row.unsubscribed !== TRUE AND
//      row.timestamp <= now → ELIGIBLE TO SEND.
//   2. After the unsubscribe handler flips a row, all future fires
//      for that submission_id observe unsubscribed === TRUE and skip.
//   3. Rows already 'sent' before unsubscribe stay 'sent' (no
//      retroactive flipping).

function pickEligibleRowsForSend(rows, now) {
  // Mirrors the predicate inside processPrayerDrip_ in order-handler.gs.
  return rows.filter((r) =>
    r.status === 'pending' &&
    r.unsubscribed !== true &&
    new Date(r.timestamp) <= now
  );
}

function applyUnsubscribe(rows, submissionId, now) {
  // Mirrors flipDripRowsToUnsubscribed_ in order-handler.gs.
  return rows.map((r) => {
    if (r.submission_id !== submissionId) return r;
    const next = { ...r, unsubscribed: true };
    if (next.status === 'pending') {
      next.status = 'unsubscribed';
      next.timestamp = now.toISOString();
    }
    return next;
  });
}

test('PI4 — drip rows past T_unsub never reach status=sent', () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.array(fc.record({
      drip_day: fc.constantFrom(0, 3, 7, 14),
      offsetMinutes: fc.integer({ min: -10000, max: 10000 }),
    }), { minLength: 1, maxLength: 8 }),
    fc.integer({ min: -5000, max: 5000 }), // T_unsub offset in minutes
    (submissionId, rowSpecs, unsubOffset) => {
      const t0 = new Date(2026, 0, 1, 12, 0, 0);
      const rows = rowSpecs.map((spec) => ({
        submission_id: submissionId,
        drip_day: spec.drip_day,
        status: 'pending',
        timestamp: new Date(t0.getTime() + spec.offsetMinutes * 60_000).toISOString(),
        error: '',
        unsubscribed: false,
      }));
      const tUnsub = new Date(t0.getTime() + unsubOffset * 60_000);

      // Simulate: any row whose fire time is BEFORE T_unsub may have
      // already been sent at fire time. Mark them as 'sent'.
      let working = rows.map((r) => {
        if (new Date(r.timestamp) <= tUnsub) {
          return { ...r, status: 'sent' };
        }
        return r;
      });

      // User unsubscribes at tUnsub.
      working = applyUnsubscribe(working, submissionId, tUnsub);

      // After unsubscribe, the cron runs at some later time. No
      // pending row past tUnsub should ever flip to 'sent'.
      const tCronRun = new Date(tUnsub.getTime() + 60 * 60 * 1000);
      const eligible = pickEligibleRowsForSend(working, tCronRun);
      assert.equal(eligible.length, 0,
        'Eligible rows after unsubscribe: ' + JSON.stringify(eligible));

      // Every row past tUnsub is in {pending+unsubscribed=TRUE,
      // unsubscribed-status, sent-before-tUnsub}. None of those is
      // pending+!unsubscribed.
      for (const r of working) {
        const fireTs = new Date(r.timestamp);
        if (fireTs > tUnsub && r.status === 'sent') {
          // We pre-applied 'sent' only to rows BEFORE tUnsub, so this
          // can't happen unless our model lies. Catches bugs in the
          // test wiring itself.
          assert.fail('row past tUnsub marked sent unexpectedly: ' +
            JSON.stringify(r));
        }
      }
    },
  ), { numRuns: 100 });
});

// ── Property 9 ─────────────────────────────────────────────────
// Validates: Requirements 9.2, 9.3, 9.4
//
// Test-side mirror of computeUnsubscribeToken_ uses Node's crypto
// to produce the SAME byte sequence as Apps Script's
// Utilities.computeHmacSha256Signature, then base64url-encodes it.
// resolveUnsubscribeToken_ is a Sheet linear-scan in production;
// here we model it with a plain object map.

function computeToken(submissionId, secret) {
  const sig = crypto.createHmac('sha256', secret).update(submissionId).digest();
  return sig.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function resolveToken(token, prayersTable) {
  if (!token || typeof token !== 'string') return { ok: false };
  for (const row of prayersTable) {
    if (row.unsubscribe_token === token) {
      return { ok: true, submissionId: row.submission_id };
    }
  }
  return { ok: false };
}

const TEST_SECRET = 'unit-test-secret-not-for-production';

test('Property 9 — token round-trip resolves the original submissionId', () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 64 }),
    (submissionId) => {
      const token = computeToken(submissionId, TEST_SECRET);
      const table = [{ submission_id: submissionId, unsubscribe_token: token }];
      const resolved = resolveToken(token, table);
      assert.equal(resolved.ok, true);
      assert.equal(resolved.submissionId, submissionId);
    },
  ), { numRuns: 200 });
});

test('Property 9 — distinct submissionIds produce distinct tokens', () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 64 }),
    fc.string({ minLength: 1, maxLength: 64 }),
    (a, b) => {
      fc.pre(a !== b);
      const ta = computeToken(a, TEST_SECRET);
      const tb = computeToken(b, TEST_SECRET);
      assert.notEqual(ta, tb);
    },
  ), { numRuns: 200 });
});

test('Property 9 — forged/unknown tokens resolve to {ok:false}', () => {
  const knownId = 'real-submission-id';
  const knownToken = computeToken(knownId, TEST_SECRET);
  const table = [{ submission_id: knownId, unsubscribe_token: knownToken }];

  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 64 }),
    (forged) => {
      fc.pre(forged !== knownToken);
      const resolved = resolveToken(forged, table);
      assert.equal(resolved.ok, false);
    },
  ), { numRuns: 200 });

  // Empty / null / non-string also resolves false.
  assert.equal(resolveToken('', table).ok, false);
  assert.equal(resolveToken(null, table).ok, false);
  assert.equal(resolveToken(123, table).ok, false);
});

// ── hashCodeFromString_ sanity ─────────────────────────────────
test('hashCodeFromString_ is deterministic and unsigned-32-bit', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    const a = hashCodeFromString_(s);
    const b = hashCodeFromString_(s);
    assert.equal(a, b);
    assert.ok(Number.isInteger(a));
    assert.ok(a >= 0);
    assert.ok(a <= 0xFFFFFFFF);
  }), { numRuns: 100 });
});
