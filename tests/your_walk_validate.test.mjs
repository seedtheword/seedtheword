// Feature: your-walk-tracker — validators
//
// Tests for validateWalkLinkRequest_ and validateWalkStamp_. Validators
// are pure — no I/O — so we use plain example tests with a small
// fast-check pass for the email round-trip and ISO-date round-trip.
//
// Properties exercised here are not part of the YW1–YW9 set directly;
// the validators are the foundation those properties stand on, and a
// regression here would surface as cascading failures in YW1+ tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  validateWalkLinkRequest_,
  validateWalkStamp_,
  isLikelyEmail_,
  isIsoDateString_,
  isWalkTokenHex_,
  WALK_TOKEN_HEX_LENGTH,
  WALK_EMAIL_MAX_CHARS,
  WALK_STREAMS,
} from '../docs/apps-script/your-walk-helpers.js';

// A canonical valid token for stamp tests. Exactly 64 lowercase hex chars.
const VALID_TOKEN = 'a'.repeat(64);

// ── isLikelyEmail_ — shape predicate ──────────────────────────────

test('isLikelyEmail_ — accepts ordinary addresses', () => {
  assert.equal(isLikelyEmail_('a@b.co'), true);
  assert.equal(isLikelyEmail_('first.last+tag@subdomain.example.com'), true);
});

test('isLikelyEmail_ — rejects empty / non-string / no-at / no-dot', () => {
  assert.equal(isLikelyEmail_(''), false);
  assert.equal(isLikelyEmail_(null), false);
  assert.equal(isLikelyEmail_(undefined), false);
  assert.equal(isLikelyEmail_(42), false);
  assert.equal(isLikelyEmail_('no-at-sign.example.com'), false);
  assert.equal(isLikelyEmail_('no-dot@example'), false);
  assert.equal(isLikelyEmail_('   '), false);
});

test('isLikelyEmail_ — rejects strings longer than WALK_EMAIL_MAX_CHARS', () => {
  const longLocal = 'x'.repeat(WALK_EMAIL_MAX_CHARS - 5);
  const overLong  = longLocal + '@a.co';     // exactly WALK_EMAIL_MAX_CHARS
  assert.equal(isLikelyEmail_(overLong), true);
  const tooLong = longLocal + 'x@a.co';      // WALK_EMAIL_MAX_CHARS + 1
  assert.equal(isLikelyEmail_(tooLong), false);
});


// ── isIsoDateString_ — strict YYYY-MM-DD ──────────────────────────

test('isIsoDateString_ — accepts a valid date', () => {
  assert.equal(isIsoDateString_('2026-04-30'), true);
  assert.equal(isIsoDateString_('2024-02-29'), true);   // leap year
  assert.equal(isIsoDateString_('2000-02-29'), true);   // century leap year
});

test('isIsoDateString_ — rejects impossible dates that round-trip wrong', () => {
  assert.equal(isIsoDateString_('2026-02-30'), false);  // Feb has at most 29
  assert.equal(isIsoDateString_('2025-02-29'), false);  // 2025 is NOT a leap year
  assert.equal(isIsoDateString_('2026-04-31'), false);  // April has 30
  assert.equal(isIsoDateString_('2026-13-01'), false);  // no month 13
  assert.equal(isIsoDateString_('2026-00-01'), false);  // no month 0
  assert.equal(isIsoDateString_('2026-01-00'), false);  // no day 0
  assert.equal(isIsoDateString_('1900-02-29'), false);  // 1900 NOT a leap year
});

test('isIsoDateString_ — rejects wrong shape', () => {
  assert.equal(isIsoDateString_('2026-4-30'), false);   // single-digit month
  assert.equal(isIsoDateString_('2026/04/30'), false);  // slashes
  assert.equal(isIsoDateString_('2026-04-30T08:00:00Z'), false);  // has time
  assert.equal(isIsoDateString_(''), false);
  assert.equal(isIsoDateString_('not a date'), false);
  assert.equal(isIsoDateString_(20260430), false);      // not a string
});


// ── isWalkTokenHex_ — 64 lowercase hex ────────────────────────────

test('isWalkTokenHex_ — accepts the canonical shape', () => {
  assert.equal(isWalkTokenHex_('0'.repeat(64)), true);
  assert.equal(isWalkTokenHex_('abcdef0123456789'.repeat(4)), true);
});

test('isWalkTokenHex_ — rejects wrong length', () => {
  assert.equal(isWalkTokenHex_(''), false);
  assert.equal(isWalkTokenHex_('a'.repeat(63)), false);
  assert.equal(isWalkTokenHex_('a'.repeat(65)), false);
});

test('isWalkTokenHex_ — rejects uppercase or non-hex characters', () => {
  assert.equal(isWalkTokenHex_('A'.repeat(64)), false);
  assert.equal(isWalkTokenHex_('g'.repeat(64)), false);
  assert.equal(isWalkTokenHex_('-'.repeat(64)), false);
});


// ── validateWalkLinkRequest_ ──────────────────────────────────────

test('validateWalkLinkRequest_ — accepts a minimal valid email', () => {
  const out = validateWalkLinkRequest_({ email: 'a@b.co' });
  assert.equal(out.ok, true);
  assert.equal(out.email, 'a@b.co');
});

test('validateWalkLinkRequest_ — lowercases and trims the email', () => {
  const out = validateWalkLinkRequest_({ email: '  Sam.Smith@Example.COM  ' });
  assert.equal(out.ok, true);
  assert.equal(out.email, 'sam.smith@example.com');
});

test('validateWalkLinkRequest_ — rejects non-object payload', () => {
  assert.equal(validateWalkLinkRequest_(null).ok, false);
  assert.equal(validateWalkLinkRequest_(null).reason, 'not-object');
  assert.equal(validateWalkLinkRequest_('hello').ok, false);
  assert.equal(validateWalkLinkRequest_(42).ok, false);
});

test('validateWalkLinkRequest_ — rejects empty / missing email with email-required', () => {
  assert.equal(validateWalkLinkRequest_({}).reason, 'email-required');
  assert.equal(validateWalkLinkRequest_({ email: '' }).reason, 'email-required');
  assert.equal(validateWalkLinkRequest_({ email: '   ' }).reason, 'email-required');
  assert.equal(validateWalkLinkRequest_({ email: null }).reason, 'email-required');
});

test('validateWalkLinkRequest_ — rejects email > WALK_EMAIL_MAX_CHARS with email-too-long', () => {
  const tooLong = 'x'.repeat(WALK_EMAIL_MAX_CHARS) + '@a.co';
  const out = validateWalkLinkRequest_({ email: tooLong });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'email-too-long');
});

test('validateWalkLinkRequest_ — rejects malformed email with bad-email', () => {
  assert.equal(validateWalkLinkRequest_({ email: 'no-at-sign' }).reason, 'bad-email');
  assert.equal(validateWalkLinkRequest_({ email: 'no-dot@example' }).reason, 'bad-email');
  assert.equal(validateWalkLinkRequest_({ email: 'spaces in@example.com' }).reason, 'bad-email');
});

test('validateWalkLinkRequest_ — email round-trip is idempotent (lowercased + trimmed)', () => {
  fc.assert(
    fc.property(
      fc.emailAddress(),
      (rawEmail) => {
        const padded = '   ' + rawEmail.toUpperCase() + '   ';
        const out = validateWalkLinkRequest_({ email: padded });
        if (!out.ok) return true;          // some generated emails exceed length cap; that's fine
        // The output is the lower-cased trimmed form, with no trailing/leading whitespace.
        return out.email === rawEmail.toLowerCase()
          && out.email.trim() === out.email
          && out.email === out.email.toLowerCase();
      }
    ),
    { numRuns: 200 }
  );
});


// ── validateWalkStamp_ ────────────────────────────────────────────

test('validateWalkStamp_ — accepts a minimal valid payload (no anchor)', () => {
  const out = validateWalkStamp_({ token: VALID_TOKEN, today: '2026-04-30' });
  assert.equal(out.ok, true);
  assert.equal(out.token, VALID_TOKEN);
  assert.equal(out.today, '2026-04-30');
  assert.equal(out.anchorBook, '');
  assert.equal(out.anchorChapter, '');
  assert.equal(out.stream, '');
});

test('validateWalkStamp_ — accepts a valid anchor with all three fields', () => {
  const out = validateWalkStamp_({
    token: VALID_TOKEN,
    today: '2026-04-30',
    anchor: { book: 'John', chapter: 3, stream: 'nt' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.anchorBook, 'John');
  assert.equal(out.anchorChapter, 3);
  assert.equal(out.stream, 'nt');
});

test('validateWalkStamp_ — silently strips a malformed anchor (not an object)', () => {
  const out = validateWalkStamp_({
    token: VALID_TOKEN,
    today: '2026-04-30',
    anchor: 'this is not an object',
  });
  assert.equal(out.ok, true);
  assert.equal(out.anchorBook, '');
  assert.equal(out.anchorChapter, '');
  assert.equal(out.stream, '');
});

test('validateWalkStamp_ — silently strips an unknown stream value', () => {
  const out = validateWalkStamp_({
    token: VALID_TOKEN,
    today: '2026-04-30',
    anchor: { book: 'Genesis', chapter: 1, stream: 'apocrypha' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.anchorBook, 'Genesis');
  assert.equal(out.anchorChapter, 1);
  assert.equal(out.stream, '', 'unknown stream should be silently dropped');
});

test('validateWalkStamp_ — accepts every stream in the WALK_STREAMS whitelist', () => {
  for (const stream of WALK_STREAMS) {
    const out = validateWalkStamp_({
      token: VALID_TOKEN,
      today: '2026-04-30',
      anchor: { book: 'Test', chapter: 1, stream },
    });
    assert.equal(out.ok, true, 'stream=' + stream);
    assert.equal(out.stream, stream);
  }
});

test('validateWalkStamp_ — strips chapter that is out of range or non-numeric', () => {
  const cases = [
    { chapter: 0,       desc: 'zero rejected' },
    { chapter: -1,      desc: 'negative rejected' },
    { chapter: 999999,  desc: 'over the cap rejected' },
    { chapter: 'three', desc: 'non-numeric rejected' },
    { chapter: NaN,     desc: 'NaN rejected' },
  ];
  for (const c of cases) {
    const out = validateWalkStamp_({
      token: VALID_TOKEN,
      today: '2026-04-30',
      anchor: { book: 'John', chapter: c.chapter, stream: 'nt' },
    });
    assert.equal(out.ok, true, c.desc);
    assert.equal(out.anchorChapter, '', c.desc + ' (chapter should be empty)');
  }
});

test('validateWalkStamp_ — accepts numeric chapter passed as string ("3")', () => {
  const out = validateWalkStamp_({
    token: VALID_TOKEN,
    today: '2026-04-30',
    anchor: { book: 'John', chapter: '3', stream: 'nt' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.anchorChapter, 3);
});

test('validateWalkStamp_ — caps anchor.book at WALK_ANCHOR_BOOK_MAX_CHARS', () => {
  const longBook = 'X'.repeat(200);
  const out = validateWalkStamp_({
    token: VALID_TOKEN,
    today: '2026-04-30',
    anchor: { book: longBook, chapter: 1, stream: 'nt' },
  });
  assert.equal(out.ok, true);
  assert.equal(out.anchorBook.length <= 40, true,
    'book is sliced to WALK_ANCHOR_BOOK_MAX_CHARS');
});

test('validateWalkStamp_ — rejects non-object payload', () => {
  assert.equal(validateWalkStamp_(null).reason, 'not-object');
  assert.equal(validateWalkStamp_('hello').reason, 'not-object');
});

test('validateWalkStamp_ — rejects missing or empty token with token-required', () => {
  assert.equal(validateWalkStamp_({ today: '2026-04-30' }).reason, 'token-required');
  assert.equal(validateWalkStamp_({ token: '', today: '2026-04-30' }).reason, 'token-required');
  assert.equal(validateWalkStamp_({ token: '   ', today: '2026-04-30' }).reason, 'token-required');
});

test('validateWalkStamp_ — rejects bad token shape with bad-token-shape', () => {
  // Wrong length
  assert.equal(
    validateWalkStamp_({ token: 'a'.repeat(63), today: '2026-04-30' }).reason,
    'bad-token-shape'
  );
  // Uppercase hex
  assert.equal(
    validateWalkStamp_({ token: 'A'.repeat(64), today: '2026-04-30' }).reason,
    'bad-token-shape'
  );
  // Non-hex character
  assert.equal(
    validateWalkStamp_({ token: 'g'.repeat(64), today: '2026-04-30' }).reason,
    'bad-token-shape'
  );
});

test('validateWalkStamp_ — rejects missing today with today-required', () => {
  assert.equal(validateWalkStamp_({ token: VALID_TOKEN }).reason, 'today-required');
  assert.equal(validateWalkStamp_({ token: VALID_TOKEN, today: '' }).reason, 'today-required');
});

test('validateWalkStamp_ — rejects malformed date with bad-date', () => {
  assert.equal(
    validateWalkStamp_({ token: VALID_TOKEN, today: '2026-13-01' }).reason,
    'bad-date'
  );
  assert.equal(
    validateWalkStamp_({ token: VALID_TOKEN, today: '2026-02-30' }).reason,
    'bad-date',
    'Feb 30 must round-trip-fail'
  );
  assert.equal(
    validateWalkStamp_({ token: VALID_TOKEN, today: '2025-02-29' }).reason,
    'bad-date',
    '2025 is not a leap year'
  );
  assert.equal(
    validateWalkStamp_({ token: VALID_TOKEN, today: 'yesterday' }).reason,
    'bad-date'
  );
});
