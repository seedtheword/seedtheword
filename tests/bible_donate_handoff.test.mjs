// Feature: bible-donate-request, BD7 (mailing_address only post-approval) +
// BD8 (handoff form rejects pre-approval access)
//
// Shadow handoff handler — mirrors handleBibleRequestHandoff_ in
// order-handler.gs. The Apps Script side serves both the GET (form
// render) and submit ("GET with submit=1") via the same web app
// dispatcher. The shadow encodes that contract explicitly.

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

function makeSheet(rows = []) {
  const values = [HEADERS.slice()];
  for (const r of rows) values.push(r.slice());
  return {
    getValues() { return values; },
    setCell(rowIndex, colIndex, value) {
      values[rowIndex - 1][colIndex] = value;
    },
    rowAt(rowIndex) { return values[rowIndex - 1]; },
  };
}

function row(opts = {}) {
  const r = HEADERS.map(() => '');
  r[IDX.submission_id] = opts.submissionId || 'sid-1';
  r[IDX.received_at] = '2026-05-29T12:00:00Z';
  r[IDX.kind] = 'receive';
  r[IDX.name] = opts.name || 'Maria';
  r[IDX.contact_email] = opts.email || 'maria@example.com';
  r[IDX.city] = 'Everett';
  r[IDX.state] = 'WA';
  r[IDX.story] = 'a'.repeat(120);
  r[IDX.status] = opts.status || 'pending_review';
  r[IDX.handoff_method] = opts.handoff_method || '';
  r[IDX.mailing_address] = opts.mailing_address || '';
  r[IDX.handoff_token] = 'tok-handoff-' + (opts.submissionId || 'sid-1');
  return r;
}

function shadowHandoff(token, params, deps) {
  const r = resolveBibleReviewTokenFromValues_(deps.sheet.getValues(), IDX, token, 'handoff');
  if (!r.ok) return { page: 'invalid', formShown: false, mutated: false };
  if (r.currentStatus !== 'approved' && r.currentStatus !== 'awaiting_handoff') {
    return { page: 'not-ready', formShown: false, mutated: false, observedStatus: r.currentStatus };
  }
  const submitFlag = String((params && params.submit) || '').trim();
  if (submitFlag !== '1') {
    return { page: 'form', formShown: true, mutated: false };
  }
  const method = String((params && params.handoff_method) || '').trim();
  const address = String((params && params.mailing_address) || '').slice(0, 400);
  if (method !== 'dropoff' && method !== 'mail') {
    return { page: 'form-error-method', formShown: true, mutated: false };
  }
  if (method === 'mail' && address.trim().length < 15) {
    return { page: 'form-error-address', formShown: true, mutated: false };
  }
  // Persist.
  deps.sheet.setCell(r.rowIndex, IDX.handoff_method, method);
  if (method === 'mail') {
    deps.sheet.setCell(r.rowIndex, IDX.mailing_address, address);
  }
  deps.sheet.setCell(r.rowIndex, IDX.status, 'awaiting_handoff');
  deps.adminEmails.push({ method, address, rowIndex: r.rowIndex });
  return { page: 'thank-you', formShown: false, mutated: true };
}

// ── BD8 — handoff form rejects pre-approval access ───────────
test('BD8 — pending_review status: form is NOT rendered, "not-ready" page instead', () => {
  const sheet = makeSheet([row({ status: 'pending_review' })]);
  const out = shadowHandoff('tok-handoff-sid-1', {}, { sheet, adminEmails: [] });
  assert.equal(out.page, 'not-ready');
  assert.equal(out.formShown, false);
  assert.equal(out.observedStatus, 'pending_review');
});

test('BD8 — declined status: form is NOT rendered', () => {
  const sheet = makeSheet([row({ status: 'declined' })]);
  const out = shadowHandoff('tok-handoff-sid-1', {}, { sheet, adminEmails: [] });
  assert.equal(out.page, 'not-ready');
  assert.equal(out.formShown, false);
});

test('BD8 — approved status: form IS rendered', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const out = shadowHandoff('tok-handoff-sid-1', {}, { sheet, adminEmails: [] });
  assert.equal(out.page, 'form');
  assert.equal(out.formShown, true);
});

test('BD8 — awaiting_handoff status: form IS still accessible (re-edit)', () => {
  const sheet = makeSheet([row({ status: 'awaiting_handoff' })]);
  const out = shadowHandoff('tok-handoff-sid-1', {}, { sheet, adminEmails: [] });
  assert.equal(out.page, 'form');
  assert.equal(out.formShown, true);
});

test('BD8 — invalid token: invalid page, no form, no mutation', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const out = shadowHandoff('not-a-real-token', {}, { sheet, adminEmails: [] });
  assert.equal(out.page, 'invalid');
  assert.equal(out.formShown, false);
});

// ── BD7 — mailing_address only post-approval ─────────────────
test('BD7 — mailing_address is empty for pending_review row', () => {
  const sheet = makeSheet([row({ status: 'pending_review' })]);
  assert.equal(sheet.rowAt(2)[IDX.mailing_address], '');
});

test('BD7 — mailing_address is empty for declined row', () => {
  const sheet = makeSheet([row({ status: 'declined' })]);
  assert.equal(sheet.rowAt(2)[IDX.mailing_address], '');
});

test('BD7 — submitting drop-off does NOT populate mailing_address', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const deps = { sheet, adminEmails: [] };
  const out = shadowHandoff('tok-handoff-sid-1', {
    submit: '1', handoff_method: 'dropoff',
  }, deps);
  assert.equal(out.page, 'thank-you');
  assert.equal(out.mutated, true);
  assert.equal(sheet.rowAt(2)[IDX.handoff_method], 'dropoff');
  assert.equal(sheet.rowAt(2)[IDX.mailing_address], '');
  assert.equal(sheet.rowAt(2)[IDX.status], 'awaiting_handoff');
});

test('BD7 — submitting mail DOES populate mailing_address (when long enough)', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const deps = { sheet, adminEmails: [] };
  const out = shadowHandoff('tok-handoff-sid-1', {
    submit: '1', handoff_method: 'mail', mailing_address: '123 Main St, Everett, WA 98201',
  }, deps);
  assert.equal(out.page, 'thank-you');
  assert.equal(out.mutated, true);
  assert.equal(sheet.rowAt(2)[IDX.handoff_method], 'mail');
  assert.equal(sheet.rowAt(2)[IDX.mailing_address], '123 Main St, Everett, WA 98201');
  assert.equal(sheet.rowAt(2)[IDX.status], 'awaiting_handoff');
});

// ── Form validation ──────────────────────────────────────────
test('handoff submit with missing method: form re-renders with error, no mutation', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const deps = { sheet, adminEmails: [] };
  const out = shadowHandoff('tok-handoff-sid-1', { submit: '1' }, deps);
  assert.equal(out.page, 'form-error-method');
  assert.equal(out.mutated, false);
  // Status unchanged.
  assert.equal(sheet.rowAt(2)[IDX.status], 'approved');
});

test('handoff submit with mail method but too-short address: form re-renders with error', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const deps = { sheet, adminEmails: [] };
  const out = shadowHandoff('tok-handoff-sid-1', {
    submit: '1', handoff_method: 'mail', mailing_address: 'short',
  }, deps);
  assert.equal(out.page, 'form-error-address');
  assert.equal(out.mutated, false);
  assert.equal(sheet.rowAt(2)[IDX.status], 'approved');
});

test('handoff submit truncates oversized address to 400 chars', () => {
  const sheet = makeSheet([row({ status: 'approved' })]);
  const deps = { sheet, adminEmails: [] };
  const longAddress = '123 Main St, Everett, WA ' + 'X'.repeat(450);
  shadowHandoff('tok-handoff-sid-1', {
    submit: '1', handoff_method: 'mail', mailing_address: longAddress,
  }, deps);
  assert.equal(sheet.rowAt(2)[IDX.mailing_address].length, 400);
});

// ── Cross-verb attack ───────────────────────────────────────
test('handoff with an approve token returns invalid (BD4 cross-verb at the handler)', () => {
  // Build a row with approve_token set; use it against the handoff endpoint.
  const r = row({ status: 'approved' });
  r[IDX.approve_token] = 'tok-approve-only';
  const sheet = makeSheet([r]);
  const out = shadowHandoff('tok-approve-only', {}, { sheet, adminEmails: [] });
  assert.equal(out.page, 'invalid');
  assert.equal(out.formShown, false);
});
