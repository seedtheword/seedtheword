// Feature: prayer-request-intake, relay-side properties.
//
// Covers:
//   - PI2 (anonymous attribution holds in Telegram)
//   - PI3 (marker pattern parses under the digest's regex)
//   - PI6 (body length and message length bounded)
//   - Property 8 (HTML strip leaves no tag-shaped substring; idempotent)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildTelegramMessage_,
  stripHtmlAndNormalize_,
  isLikelyEmail_,
} from '../docs/apps-script/prayer-intake-helpers.js';

const TELEGRAM_MAX_CHARS = 4090;
const MARKER = '(via the website)';

// The digest's recognition regex (literal copy of the one in the
// weekly-prayer-digest spec — design §12 Property 3 codifies it).
const DIGEST_REGEX =
  /^\u{1F48C} New (prayer request|thanksgiving announcement) from (.+?) \(via the website\): (.*)$/su;

// ── PI2 ────────────────────────────────────────────────────────
// Validates: Requirements 4.4, 5.5, 12.2

// Generator for "name-shaped" strings: at least 3 characters of
// letters/digits/spaces. The 3-char floor avoids trivial substring
// false-positives — single-character or two-character generated
// names inevitably substring-match the literal marker prefix
// ("e" appears in "website", "the", "request", etc.). Real
// submitter names are well above this floor.
const nameStrategy = fc.string({
  minLength: 3,
  maxLength: 80,
  unit: fc.constantFrom(
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' ',
  ),
}).filter((s) => {
  const t = s.trim();
  if (t.length < 3) return false;
  // Reject names that are substrings of the literal marker prefix.
  // The prefix "💌 New prayer request from " / "💌 New thanksgiving
  // announcement from " plus " (via the website): " is fixed
  // English text — generated names that happen to match it would
  // create unavoidable false positives.
  const lit =
    '💌 New prayer request from  (via the website): ' +
    '💌 New thanksgiving announcement from  (via the website): ' +
    'Anonymous';
  return !lit.includes(t);
});

// Mirrors what Telegram does to a MarkdownV2 message body when it
// renders + redelivers via getUpdates: the parser strips the
// backslash from each \X escape sequence (where X is one of the 18
// MarkdownV2 metacharacters), leaving the literal X. The producer
// MUST emit the escaped form to satisfy Telegram's parser; the
// digest's Poller reads the rendered form from getUpdates. PI3
// asserts the round-trip on the rendered form.
function unescapeMarkdownV2(s) {
  return s.replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, '$1');
}

const MDV2_METACHARS = /[_*\[\]()~`>#+\-=|{}.!]/g;

test('PI2 — anonymous attribution holds in Telegram', () => {
  fc.assert(fc.property(
    nameStrategy,
    fc.constantFrom('prayer', 'thanksgiving'),
    fc.string({ minLength: 10, maxLength: 1500 }),
    (name, kind, body) => {
      const out = buildTelegramMessage_({
        kind,
        submitterName: name,
        anonymous: true,
        body,
        marker: MARKER,
      });
      // Compare on the rendered (post-Telegram-strip) form so the test
      // doesn't have to track which characters got escaped.
      const rendered = unescapeMarkdownV2(out.text);
      // The literal "Anonymous" must appear immediately after "from ".
      assert.match(rendered, /\u{1F48C} New (?:prayer request|thanksgiving announcement) from Anonymous /u);
      // Anonymity governs the FROM-field only — the user's body is
      // pass-through user-controlled content (someone may legitimately
      // sign their own name inside the prayer they wrote, e.g. "please
      // pray for me, Eric"). We assert here that the real name does not
      // appear in the from-field segment, which is what anonymity
      // actually guarantees. The body segment after "(via the website):"
      // is intentionally not policed.
      const fromMatch = rendered.match(
        /\u{1F48C} New (?:prayer request|thanksgiving announcement) from (.+?) \(via the website\):/u
      );
      assert.ok(fromMatch, 'rendered message did not match the from-field shape');
      const fromField = fromMatch[1];
      assert.equal(fromField, 'Anonymous',
        'anonymous Telegram message leaked the real name in the FROM field: ' +
        JSON.stringify({ name, fromField }));
    },
  ), { numRuns: 200 });
});

// ── PI3 ────────────────────────────────────────────────────────
// Validates: Requirements 4.2, 4.3, 4.5, 4.6, 12.3
//
// The producer emits a MarkdownV2-escaped string. Telegram's
// `sendMessage` accepts that under parse_mode=MarkdownV2 and re-
// delivers the plain rendered form via getUpdates — that's the
// string the digest's Poller actually parses. PI3 asserts the
// round-trip on the rendered form: post-strip, the message MUST
// match the digest's regex AND round-trip to the producer's
// (kind, name, body) tuple.

test('PI3 — marker pattern parses under the digest regex (round-trip)', () => {
  fc.assert(fc.property(
    fc.constantFrom('prayer', 'thanksgiving'),
    fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    fc.boolean(),
    fc.string({ minLength: 10, maxLength: 1500 }),
    (kind, name, anonymous, body) => {
      const out = buildTelegramMessage_({
        kind, submitterName: name, anonymous, body, marker: MARKER,
      });
      // Apply Telegram's render step before regex-matching — that's
      // what the digest's Poller sees.
      const rendered = unescapeMarkdownV2(out.text);
      const m = DIGEST_REGEX.exec(rendered);
      assert.ok(m,
        'rendered message did not match digest regex: ' + JSON.stringify(rendered));
      const expectedVerb = kind === 'thanksgiving'
        ? 'thanksgiving announcement' : 'prayer request';
      assert.equal(m[1], expectedVerb);
      const expectedName = anonymous ? 'Anonymous' : name;
      assert.equal(m[2], expectedName,
        'rendered name did not round-trip: ' +
        JSON.stringify({ expected: expectedName, actual: m[2] }));
      if (out.truncated) {
        // Truncated body ends with the ellipsis codepoint.
        assert.ok(m[3].endsWith('\u2026'),
          'truncated body should end with ellipsis: ' + JSON.stringify(m[3]));
      } else {
        assert.equal(m[3], body,
          'rendered body did not round-trip: ' +
          JSON.stringify({ expected: body, actual: m[3] }));
      }
    },
  ), { numRuns: 200 });
});

// ── PI6 ────────────────────────────────────────────────────────
// Validates: Requirements 1.5, 4.7, 10.3, 12.6

test('PI6 — assembled Telegram message length never exceeds TELEGRAM_MAX_CHARS', () => {
  fc.assert(fc.property(
    fc.constantFrom('prayer', 'thanksgiving'),
    fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    fc.boolean(),
    // Bodies up to bodyMaxChars (2000) — the producer accepts up to this.
    fc.string({ minLength: 1, maxLength: 2000 }),
    (kind, name, anonymous, body) => {
      const out = buildTelegramMessage_({
        kind, submitterName: name, anonymous, body, marker: MARKER,
      });
      assert.ok(out.text.length <= TELEGRAM_MAX_CHARS,
        'message length ' + out.text.length + ' exceeds cap ' + TELEGRAM_MAX_CHARS);
      if (out.truncated) {
        assert.equal(out.text.length, TELEGRAM_MAX_CHARS,
          'truncated message length should be exactly ' + TELEGRAM_MAX_CHARS);
        assert.ok(out.text.endsWith('\u2026'),
          'truncated message should end with ellipsis');
      }
    },
  ), { numRuns: 200 });
});

test('PI6 — explicitly large input forces truncation flag', () => {
  // Construct a body large enough that mdv2-escape definitely pushes
  // the assembled message past the 4090-char cap.
  const body = 'a'.repeat(2000) + '_'.repeat(2000); // 4000 raw, 6000+ after escapes
  const out = buildTelegramMessage_({
    kind: 'prayer', submitterName: 'X', anonymous: false, body, marker: MARKER,
  });
  assert.equal(out.truncated, true);
  assert.equal(out.text.length, TELEGRAM_MAX_CHARS);
  assert.ok(out.text.endsWith('\u2026'));
});

// ── Property 8 ─────────────────────────────────────────────────
// Validates: Requirement 10.4

test('Property 8 — stripHtmlAndNormalize_ leaves no tag-shaped substring', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    const out = stripHtmlAndNormalize_(s);
    assert.equal(/<[^>]*>/.test(out), false,
      'output contained a tag-shaped substring: ' + JSON.stringify(out));
  }), { numRuns: 300 });
});

test('Property 8 — stripHtmlAndNormalize_ is idempotent', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    const once = stripHtmlAndNormalize_(s);
    const twice = stripHtmlAndNormalize_(once);
    assert.equal(twice, once);
  }), { numRuns: 300 });
});

// ── isLikelyEmail_ basic sanity ────────────────────────────────
test('isLikelyEmail_ accepts/rejects basic shapes', () => {
  assert.equal(isLikelyEmail_('alice@example.com'), true);
  assert.equal(isLikelyEmail_('a@b.co'), true);
  assert.equal(isLikelyEmail_('not-an-email'), false);
  assert.equal(isLikelyEmail_(''), false);
  assert.equal(isLikelyEmail_('a@b'), false);
  assert.equal(isLikelyEmail_('  alice@example.com  '), true);
  assert.equal(isLikelyEmail_('a@b.'.padEnd(220, 'c')), false);
});
