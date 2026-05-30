// Feature: bible-donate-request, BD5 (decline silent) + idempotent state transitions
//
// Shadow handler for the approve/decline GET routes. The Apps Script
// handlers are tightly coupled to SpreadsheetApp + Session.getActiveUser
// so we mirror their exact state-transition logic here against an
// in-memory sheet mock and assert:
//
//   BD5 — A valid Decline transitions the row to declined AND sends NO
//         email to contact_email. (The admin sees a success page.)
//
//   Plus: idempotent transitions for both verbs, invalid-token responses,
//   and decline_reason truncation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveBibleReviewTokenFromValues_,
  bibleHeaderIndex_,
} from '../docs/apps-script/bible-donate-helpers.js';

const HEADERS = [
  'submission_id', 'received_at', 'kind', 'name', 'contact_email', 'contact_phone',
  'count', 'handoff_method', 'city', 'state', 'story', 'status',
  'reviewer_email', 'reviewed_at', 'decline_reason',
  'mailing_address', 'address_redacted_at',
  'sign_id', 'client_ip_hash',
  'telegram_status', 'telegram_message_id', 'telegram_error',
  'approve_token', 'decline_token', 'handoff_token',
  'reminder_sent_at',
];
const IDX = bibleHeaderIndex_(HEADERS);

// ── In-memory sheet mock ─────────────────────────────────────
function makeSheet(initialRows = []) {
  const values = [HEADERS.slice()];
  for (const r of initialRows) values.push(r.slice());
  return {
    getValues() { return values; },
    setCell(rowIndex /* 1-based */, colIndex /* 0-based */, value) {
      values[rowIndex - 1][colIndex] = value;
    },
    rowAt(rowIndex /* 1-based */) { return values[rowIndex - 1]; },
  };
}

// Build a valid pending_review row with all three tokens set.
function pendingReceiveRow(opts = {}) {
  const row = HEADERS.map(() => '');
  row[IDX.submission_id] = opts.submissionId || 'sid-1';
  row[IDX.received_at] = (opts.receivedAt || new Date('2026-05-29T12:00:00Z')).toISOString();
  row[IDX.kind] = 'receive';
  row[IDX.name] = opts.name || 'Maria';
  row[IDX.contact_email] = opts.email || 'maria@example.com';
  row[IDX.city] = opts.city || 'Everett';
  row[IDX.state] = 'WA';
  row[IDX.story] = opts.story || 'a'.repeat(120);
  row[IDX.status] = opts.status || 'pending_review';
  row[IDX.approve_token] = opts.approveToken || 'tok-approve-1';
  row[IDX.decline_token] = opts.declineToken || 'tok-decline-1';
  row[IDX.handoff_token] = opts.handoffToken || 'tok-handoff-1';
  return row;
}

// ── Shadow handlers ──────────────────────────────────────────
function shadowApprove(token, params, deps) {
  const r = resolveBibleReviewTokenFromValues_(deps.sheet.getValues(), IDX, token, 'approve');
  if (!r.ok) return { page: 'invalid', mutated: false, emails: deps.emails };
  if (r.currentStatus === 'approved' || r.currentStatus === 'awaiting_handoff' || r.currentStatus === 'fulfilled') {
    return { page: 'already-approved', mutated: false, emails: deps.emails };
  }
  if (r.currentStatus !== 'pending_review') {
    return { page: 'cannot-approve', mutated: false, emails: deps.emails };
  }
  // Mutate.
  deps.sheet.setCell(r.rowIndex, IDX.status, 'approved');
  deps.sheet.setCell(r.rowIndex, IDX.reviewer_email, deps.reviewerEmail || '(unknown)');
  deps.sheet.setCell(r.rowIndex, IDX.reviewed_at, (deps.now || new Date()).toISOString());
  // Send approval email to contact_email.
  const row = deps.sheet.rowAt(r.rowIndex);
  deps.emails.push({
    to: String(row[IDX.contact_email]),
    kind: 'approval',
    submissionId: r.submissionId,
  });
  return { page: 'approved', mutated: true, emails: deps.emails };
}

function shadowDecline(token, params, deps) {
  const r = resolveBibleReviewTokenFromValues_(deps.sheet.getValues(), IDX, token, 'decline');
  if (!r.ok) return { page: 'invalid', mutated: false, emails: deps.emails };
  if (r.currentStatus === 'declined') {
    return { page: 'already-declined', mutated: false, emails: deps.emails };
  }
  if (r.currentStatus !== 'pending_review') {
    return { page: 'cannot-decline', mutated: false, emails: deps.emails };
  }
  const reason = String((params && params.reason) || '').slice(0, 500);
  deps.sheet.setCell(r.rowIndex, IDX.status, 'declined');
  deps.sheet.setCell(r.rowIndex, IDX.reviewer_email, deps.reviewerEmail || '(unknown)');
  deps.sheet.setCell(r.rowIndex, IDX.reviewed_at, (deps.now || new Date()).toISOString());
  deps.sheet.setCell(r.rowIndex, IDX.decline_reason, reason);
  // SILENT — no email pushed.
  return { page: 'declined', mutated: true, emails: deps.emails };
}

// ── BD5: decline is silent ───────────────────────────────────
test('BD5 — valid decline transitions row to declined AND sends NO email to requester', () => {
  const sheet = makeSheet([pendingReceiveRow({ email: 'maria@example.com' })]);
  const deps = { sheet, emails: [], reviewerEmail: 'admin@example.com', now: new Date('2026-05-30T00:00:00Z') };
  const out = shadowDecline('tok-decline-1', {}, deps);
  assert.equal(out.page, 'declined');
  assert.equal(out.mutated, true);
  // Row mutated.
  assert.equal(sheet.rowAt(2)[IDX.status], 'declined');
  assert.equal(sheet.rowAt(2)[IDX.reviewer_email], 'admin@example.com');
  // CRITICAL: no email sent to the requester.
  assert.equal(out.emails.length, 0);
});

test('BD5 — decline with a `reason` param stores it (truncated to 500 chars), still no email', () => {
  const sheet = makeSheet([pendingReceiveRow()]);
  const deps = { sheet, emails: [], reviewerEmail: 'admin@example.com' };
  const longReason = 'a'.repeat(700);
  shadowDecline('tok-decline-1', { reason: longReason }, deps);
  assert.equal(sheet.rowAt(2)[IDX.decline_reason].length, 500);
  assert.equal(deps.emails.length, 0);
});

// ── Approve: happy path ──────────────────────────────────────
test('approve happy path: row transitions to approved AND a single approval email is sent to contact_email', () => {
  const sheet = makeSheet([pendingReceiveRow({ email: 'maria@example.com' })]);
  const deps = { sheet, emails: [], reviewerEmail: 'admin@example.com' };
  const out = shadowApprove('tok-approve-1', {}, deps);
  assert.equal(out.page, 'approved');
  assert.equal(out.mutated, true);
  assert.equal(sheet.rowAt(2)[IDX.status], 'approved');
  assert.equal(deps.emails.length, 1);
  assert.equal(deps.emails[0].to, 'maria@example.com');
  assert.equal(deps.emails[0].kind, 'approval');
});

// ── Idempotent transitions ───────────────────────────────────
test('approve is idempotent on already-approved row (no second email)', () => {
  const sheet = makeSheet([pendingReceiveRow({ status: 'approved' })]);
  const deps = { sheet, emails: [] };
  const out = shadowApprove('tok-approve-1', {}, deps);
  assert.equal(out.page, 'already-approved');
  assert.equal(out.mutated, false);
  assert.equal(deps.emails.length, 0);
});

test('approve refuses when row is in a non-pending_review state (e.g. declined)', () => {
  const sheet = makeSheet([pendingReceiveRow({ status: 'declined' })]);
  const deps = { sheet, emails: [] };
  const out = shadowApprove('tok-approve-1', {}, deps);
  assert.equal(out.page, 'cannot-approve');
  assert.equal(out.mutated, false);
  assert.equal(deps.emails.length, 0);
});

test('decline is idempotent on already-declined row', () => {
  const sheet = makeSheet([pendingReceiveRow({ status: 'declined' })]);
  const deps = { sheet, emails: [] };
  const out = shadowDecline('tok-decline-1', {}, deps);
  assert.equal(out.page, 'already-declined');
  assert.equal(out.mutated, false);
});

test('decline refuses when row is approved (cannot decline an approved one)', () => {
  const sheet = makeSheet([pendingReceiveRow({ status: 'approved' })]);
  const deps = { sheet, emails: [] };
  const out = shadowDecline('tok-decline-1', {}, deps);
  assert.equal(out.page, 'cannot-decline');
  assert.equal(out.mutated, false);
});

// ── Invalid token paths ──────────────────────────────────────
test('approve with unknown token renders invalid page, no mutation', () => {
  const sheet = makeSheet([pendingReceiveRow()]);
  const deps = { sheet, emails: [] };
  const out = shadowApprove('not-a-real-token', {}, deps);
  assert.equal(out.page, 'invalid');
  assert.equal(out.mutated, false);
  assert.equal(sheet.rowAt(2)[IDX.status], 'pending_review');
});

test('decline with unknown token renders invalid page, no mutation', () => {
  const sheet = makeSheet([pendingReceiveRow()]);
  const deps = { sheet, emails: [] };
  const out = shadowDecline('not-a-real-token', {}, deps);
  assert.equal(out.page, 'invalid');
  assert.equal(out.mutated, false);
  assert.equal(sheet.rowAt(2)[IDX.status], 'pending_review');
});

// ── Cross-verb attack ────────────────────────────────────────
test('approve with a decline token returns invalid (BD4 cross-verb isolation rendered at the handler)', () => {
  const sheet = makeSheet([pendingReceiveRow()]);
  const deps = { sheet, emails: [] };
  // Caller passes the decline token to the approve route.
  const out = shadowApprove('tok-decline-1', {}, deps);
  assert.equal(out.page, 'invalid');
  assert.equal(out.mutated, false);
});
