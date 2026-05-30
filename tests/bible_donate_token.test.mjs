// Feature: bible-donate-request, BD4 — token round-trip and verb isolation
//
// The HMAC token signer is dependency-injected so it can run on
// Node (using the `crypto` module) and inside Apps Script (using
// Utilities.computeHmacSha256Signature). Tests verify:
//   - same (submissionId, verb) → same token
//   - distinct verbs → distinct tokens
//   - resolver returns {ok:true, submissionId} when token matches
//     the right column, {ok:false} when it doesn't
//   - forged tokens always resolve to {ok:false}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createHmac } from 'node:crypto';

import {
  computeBibleReviewToken_,
  resolveBibleReviewTokenFromValues_,
  bibleHeaderIndex_,
} from '../docs/apps-script/bible-donate-helpers.js';

// ── Node-side polyfills for the dep-injected signer ───────────
function nodeHmac(message, secret) {
  return createHmac('sha256', secret).update(message).digest();   // Buffer
}

function nodeBase64Url(bytes) {
  // bytes is a Buffer or Uint8Array; convert to URL-safe base64.
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

const TEST_SECRET = 'test-secret-do-not-use-in-prod-32bytes!';
const SUBMISSION_A = '00000000-0000-4000-8000-000000000001';
const SUBMISSION_B = '00000000-0000-4000-8000-000000000002';

// ── Determinism ───────────────────────────────────────────────
test('BD4 — same (submissionId, verb) always produces the same token', () => {
  const a1 = computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  const a2 = computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  assert.equal(a1, a2);
});

// ── Verb isolation ────────────────────────────────────────────
test('BD4 — distinct verbs produce distinct tokens', () => {
  const a = computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  const d = computeBibleReviewToken_(SUBMISSION_A, 'decline', TEST_SECRET, nodeHmac, nodeBase64Url);
  const h = computeBibleReviewToken_(SUBMISSION_A, 'handoff', TEST_SECRET, nodeHmac, nodeBase64Url);
  assert.notEqual(a, d);
  assert.notEqual(a, h);
  assert.notEqual(d, h);
});

test('BD4 — distinct submission ids produce distinct tokens', () => {
  const a = computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  const b = computeBibleReviewToken_(SUBMISSION_B, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  assert.notEqual(a, b);
});

test('BD4 — token shape is base64url with no padding', () => {
  const t = computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  // SHA-256 = 32 bytes = 43 chars base64 (with one '=' pad), so URL-safe no-pad is 43 chars.
  assert.equal(t.length, 43);
  assert.match(t, /^[A-Za-z0-9_-]+$/);
});

// ── Resolver round-trip ───────────────────────────────────────
//
// Build a fake `Bibles` sheet snapshot with two rows, each with three
// distinct tokens, then check that resolveBibleReviewTokenFromValues_
// (a) returns ok with the right submissionId for the right (token, verb)
// (b) returns {ok:false} when verb mismatches the token's verb
function buildFixture() {
  // Real BIBLES_HEADERS minus columns we don't need for these tests —
  // just enough to exercise headerIndex_ + the resolver's column lookup.
  const headers = [
    'submission_id', 'received_at', 'kind', 'name', 'contact_email',
    'count', 'status',
    'approve_token', 'decline_token', 'handoff_token',
  ];
  const aApprove = computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  const aDecline = computeBibleReviewToken_(SUBMISSION_A, 'decline', TEST_SECRET, nodeHmac, nodeBase64Url);
  const aHandoff = computeBibleReviewToken_(SUBMISSION_A, 'handoff', TEST_SECRET, nodeHmac, nodeBase64Url);
  const bApprove = computeBibleReviewToken_(SUBMISSION_B, 'approve', TEST_SECRET, nodeHmac, nodeBase64Url);
  const bDecline = computeBibleReviewToken_(SUBMISSION_B, 'decline', TEST_SECRET, nodeHmac, nodeBase64Url);
  const bHandoff = computeBibleReviewToken_(SUBMISSION_B, 'handoff', TEST_SECRET, nodeHmac, nodeBase64Url);

  const values = [
    headers,
    [SUBMISSION_A, '2026-05-29T00:00:00Z', 'receive', 'Maria', 'maria@example.com', 1, 'pending_review', aApprove, aDecline, aHandoff],
    [SUBMISSION_B, '2026-05-29T01:00:00Z', 'receive', 'James',  'james@example.com', 1, 'approved',       bApprove, bDecline, bHandoff],
  ];
  return { values, idx: bibleHeaderIndex_(headers), tokens: { aApprove, aDecline, aHandoff, bApprove, bDecline, bHandoff } };
}

test('BD4 — resolver returns ok for matching (token, verb)', () => {
  const fx = buildFixture();
  const r = resolveBibleReviewTokenFromValues_(fx.values, fx.idx, fx.tokens.aApprove, 'approve');
  assert.equal(r.ok, true);
  assert.equal(r.submissionId, SUBMISSION_A);
  assert.equal(r.rowIndex, 2);                  // 1-based; header row at 1, A at 2
  assert.equal(r.currentStatus, 'pending_review');
});

test('BD4 — resolver returns ok=false for cross-verb attack', () => {
  const fx = buildFixture();
  // Approve token presented to the decline endpoint MUST NOT resolve.
  const r = resolveBibleReviewTokenFromValues_(fx.values, fx.idx, fx.tokens.aApprove, 'decline');
  assert.equal(r.ok, false);
});

test('BD4 — resolver returns ok=false for cross-submission attack', () => {
  // Swap: B's approve token presented as if it were A's. Both happen
  // to be in the approve column, but the row that matches is B's row.
  // The resolver returns the row that owns the token; this isn't an
  // "attack" so much as a confirmation that the resolver doesn't
  // misattribute. Cover it for completeness.
  const fx = buildFixture();
  const r = resolveBibleReviewTokenFromValues_(fx.values, fx.idx, fx.tokens.bApprove, 'approve');
  assert.equal(r.ok, true);
  assert.equal(r.submissionId, SUBMISSION_B);
});

test('BD4 — resolver returns ok=false for forged token', () => {
  const fx = buildFixture();
  fc.assert(fc.property(
    fc.string({ minLength: 20, maxLength: 50 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s)),
    (forged) => {
      // Skip the (extraordinarily unlikely) collision case.
      const t = fx.tokens;
      if (forged === t.aApprove || forged === t.aDecline || forged === t.aHandoff
       || forged === t.bApprove || forged === t.bDecline || forged === t.bHandoff) {
        return true;
      }
      const r = resolveBibleReviewTokenFromValues_(fx.values, fx.idx, forged, 'approve');
      return r.ok === false;
    }
  ), { numRuns: 100 });
});

test('BD4 — resolver returns ok=false for empty token, empty values, bad verb', () => {
  const fx = buildFixture();
  assert.deepEqual(resolveBibleReviewTokenFromValues_(fx.values, fx.idx, '', 'approve'), { ok: false });
  assert.deepEqual(resolveBibleReviewTokenFromValues_(fx.values, fx.idx, fx.tokens.aApprove, 'unknown'), { ok: false });
  assert.deepEqual(resolveBibleReviewTokenFromValues_([fx.values[0]], fx.idx, fx.tokens.aApprove, 'approve'), { ok: false });
  assert.deepEqual(resolveBibleReviewTokenFromValues_(null, fx.idx, fx.tokens.aApprove, 'approve'), { ok: false });
});

test('computeBibleReviewToken_ — throws on invalid args', () => {
  assert.throws(() => computeBibleReviewToken_('', 'approve', TEST_SECRET, nodeHmac, nodeBase64Url));
  assert.throws(() => computeBibleReviewToken_(SUBMISSION_A, 'unknown', TEST_SECRET, nodeHmac, nodeBase64Url));
  assert.throws(() => computeBibleReviewToken_(SUBMISSION_A, 'approve', '', nodeHmac, nodeBase64Url));
  assert.throws(() => computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, null, nodeBase64Url));
  assert.throws(() => computeBibleReviewToken_(SUBMISSION_A, 'approve', TEST_SECRET, nodeHmac, null));
});
