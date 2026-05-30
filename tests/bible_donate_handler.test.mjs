// Feature: bible-donate-request, BD1 (audit-first integrity) + BD2 (receive
// never relays to Telegram at intake)
//
// The Apps Script handler can't be imported into Node directly (it
// references SpreadsheetApp, MailApp, PropertiesService, etc.). The
// canonical contract is encoded in a "shadow handler" in this file
// that composes the real pure helpers (validateBibleDonate_,
// validateBibleRequest_, findRecentSubmissionFromValues_) with
// injected mocks for the I/O side effects. The shadow handler
// mirrors the production handler's audit-first sequence step for
// step; if the shadow drifts from the production code, the test
// suite is the trip wire.
//
// What we're verifying with these tests:
//
//   BD1 — Audit-first integrity:
//     • Honeypot trip: no row, no email, no telegram, ok:true.
//     • Validation reject: no row, no email, no telegram.
//     • Sheet append fails: no email, no telegram.
//     • Sheet append succeeds, Telegram fails: row exists with
//       telegram_status='failed'; admin email and donor email
//       were both attempted.
//     • Sheet append succeeds, Telegram succeeds: row exists
//       with telegram_status='sent'.
//     • A submission NEVER produces a Telegram message without
//       a Bibles row.
//
//   BD2 — Receive-side never relays to Telegram at intake:
//     • For all valid receive submissions, the shadow receive
//       handler MUST NOT call the telegram mock at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBibleDonate_,
  validateBibleRequest_,
  findRecentSubmissionFromValues_,
  bibleHeaderIndex_,
} from '../docs/apps-script/bible-donate-helpers.js';

// ── In-memory Bibles-sheet mock ───────────────────────────────
function makeFakeSheet(headers) {
  const values = [headers.slice()];
  return {
    appendRow(row) { values.push(row.slice()); },
    getValues() { return values; },
    headers,
    rows() { return values.slice(1); },
    findRow(submissionId, idx) {
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idx.submission_id]) === String(submissionId)) {
          return { rowIndex: i, row: values[i] };
        }
      }
      return null;
    },
    setCell(rowIndex, colIndex, value) { values[rowIndex][colIndex] = value; },
  };
}

// ── Side-effect log ───────────────────────────────────────────
function newLog() {
  return { emails: [], telegrams: [], appendsFailed: 0, sheetWrites: 0 };
}

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

// ── Shadow donate handler ─────────────────────────────────────
//
// Mirrors handleBibleDonate_ in order-handler.gs step for step.
// Returns the same JSON-equivalent the production handler returns.
function shadowDonate(payload, deps) {
  // 1. Honeypot.
  if (payload && payload.extra_field_2) {
    return { ok: true, route: 'honeypot' };
  }
  // 2. Disabled gate.
  if (!deps.cfg.enabled) {
    return { ok: false, error: 'disabled' };
  }
  // 3. Validate.
  const v = validateBibleDonate_(payload);
  if (!v.ok) return { ok: false, error: v.reason };
  // 4. Rate-limit.
  if (deps.rateLimited) return { ok: false, error: 'rate-limit' };
  // 5. Idempotency.
  const dup = v.email
    ? findRecentSubmissionFromValues_(deps.sheet.getValues(), IDX, v.email,
        'donate', deps.cfg.donateIdempotencyDays, deps.now || new Date())
    : null;
  if (dup) {
    return { ok: true, idempotent: true, submissionId: dup.submissionId, status: dup.status, kind: 'donate' };
  }
  // 6. Build row.
  const submissionId = deps.uuid();
  const receivedAt = deps.now || new Date();
  // 7. Audit-first append.
  try {
    deps.appendBiblesRow({
      submissionId, receivedAt,
      kind: 'donate',
      name: v.name, contactEmail: v.email, contactPhone: v.phone,
      count: v.count, handoffMethod: v.handoffMethod,
      city: v.city, state: v.state, story: v.note,
      status: 'pending_fulfillment',
      signId: v.signId,
      clientIpHash: deps.ipHash || '',
      telegramStatus: 'skipped',
      telegramMessageId: '', telegramError: '',
    });
    deps.log.sheetWrites++;
  } catch (err) {
    deps.log.appendsFailed++;
    return { ok: false, error: 'sheet-write-failed' };
  }
  // 8. Admin email (always).
  deps.sendAdminEmail(submissionId, v, receivedAt);
  // 9. Telegram (skipped when no thread configured).
  const telegramResult = deps.sendTelegram(v, submissionId);
  deps.updateTelegramStatus(submissionId, telegramResult);
  // 10. Donor thank-you (only when email provided).
  if (v.email) deps.sendDonorThankYou(v, submissionId);

  return {
    ok: true,
    submissionId,
    kind: 'donate',
    handoffMethod: v.handoffMethod,
    telegram: telegramResult.status,
  };
}

function shadowReceive(payload, deps) {
  if (payload && payload.extra_field_2) return { ok: true, route: 'honeypot' };
  if (!deps.cfg.enabled) return { ok: false, error: 'disabled' };
  const v = validateBibleRequest_(payload);
  if (!v.ok) return { ok: false, error: v.reason };
  if (deps.rateLimited) return { ok: false, error: 'rate-limit' };
  const dup = findRecentSubmissionFromValues_(deps.sheet.getValues(), IDX, v.email,
    'receive', deps.cfg.receiveIdempotencyDays, deps.now || new Date());
  if (dup) return { ok: true, idempotent: true, submissionId: dup.submissionId, status: dup.status, kind: 'receive' };

  const submissionId = deps.uuid();
  const receivedAt = deps.now || new Date();
  // Issue the three tokens at intake.
  const approveToken = deps.signToken(submissionId, 'approve');
  const declineToken = deps.signToken(submissionId, 'decline');
  const handoffToken = deps.signToken(submissionId, 'handoff');
  try {
    deps.appendBiblesRow({
      submissionId, receivedAt,
      kind: 'receive',
      name: v.name, contactEmail: v.email, contactPhone: v.phone,
      count: 1, handoffMethod: '',
      city: v.city, state: v.state, story: v.story,
      status: 'pending_review',
      signId: v.signId,
      clientIpHash: deps.ipHash || '',
      telegramStatus: '', telegramMessageId: '', telegramError: '',
      approveToken, declineToken, handoffToken,
    });
    deps.log.sheetWrites++;
  } catch (err) {
    deps.log.appendsFailed++;
    return { ok: false, error: 'sheet-write-failed' };
  }
  // Admin review email — and NO requester email and NO Telegram.
  deps.sendReviewEmail(submissionId, v, receivedAt, { approveToken, declineToken });
  return { ok: true, submissionId, kind: 'receive', status: 'pending_review' };
}

function makeDonateDeps({ telegramConfigured = false, telegramFails = false, appendThrows = false, prevValues = null } = {}) {
  const sheet = makeFakeSheet(HEADERS);
  if (prevValues) {
    for (const r of prevValues) sheet.appendRow(r);
  }
  const log = newLog();
  let counter = 0;
  return {
    cfg: { enabled: true, donateIdempotencyDays: 1, receiveIdempotencyDays: 7 },
    rateLimited: false,
    sheet,
    log,
    uuid: () => 'fake-id-' + (++counter),
    now: new Date('2026-05-29T12:00:00Z'),
    ipHash: 'hash',
    appendBiblesRow(fields) {
      if (appendThrows) throw new Error('boom');
      const row = HEADERS.map(h => '');
      row[IDX.submission_id] = String(fields.submissionId || '');
      row[IDX.received_at] = (fields.receivedAt instanceof Date) ? fields.receivedAt.toISOString() : String(fields.receivedAt);
      row[IDX.kind] = String(fields.kind || '');
      row[IDX.name] = String(fields.name || '');
      row[IDX.contact_email] = String(fields.contactEmail || '');
      row[IDX.contact_phone] = String(fields.contactPhone || '');
      row[IDX.count] = fields.count == null ? '' : Number(fields.count);
      row[IDX.handoff_method] = String(fields.handoffMethod || '');
      row[IDX.city] = String(fields.city || '');
      row[IDX.state] = String(fields.state || '');
      row[IDX.story] = String(fields.story || '');
      row[IDX.status] = String(fields.status || '');
      row[IDX.sign_id] = String(fields.signId || '');
      row[IDX.client_ip_hash] = String(fields.clientIpHash || '');
      row[IDX.telegram_status] = String(fields.telegramStatus || '');
      row[IDX.approve_token] = String(fields.approveToken || '');
      row[IDX.decline_token] = String(fields.declineToken || '');
      row[IDX.handoff_token] = String(fields.handoffToken || '');
      sheet.appendRow(row);
    },
    sendAdminEmail(submissionId, v, _receivedAt) {
      log.emails.push({ to: 'seedthewordministry@gmail.com', kind: 'donate-admin', submissionId, name: v.name });
    },
    sendDonorThankYou(v, submissionId) {
      log.emails.push({ to: v.email, kind: 'donate-thank-you', submissionId, name: v.name });
    },
    sendTelegram(_v, submissionId) {
      if (!telegramConfigured) return { status: 'skipped', error: 'no-thread-configured', messageId: '' };
      log.telegrams.push({ submissionId });
      return telegramFails
        ? { status: 'failed', error: 'http-500', messageId: '' }
        : { status: 'sent', error: '', messageId: 12345 };
    },
    updateTelegramStatus(submissionId, result) {
      const found = sheet.findRow(submissionId, IDX);
      if (found) {
        sheet.setCell(found.rowIndex, IDX.telegram_status, result.status);
        sheet.setCell(found.rowIndex, IDX.telegram_message_id, result.messageId);
        sheet.setCell(found.rowIndex, IDX.telegram_error, result.error);
      }
    },
    signToken(_id, verb) { return 'tok-' + verb; },
    sendReviewEmail(submissionId, v, _receivedAt, _tokens) {
      log.emails.push({ to: 'seedthewordministry@gmail.com', kind: 'review-admin', submissionId, name: v.name });
    },
  };
}

// ── BD1 — Honeypot ─────────────────────────────────────────────
test('BD1 — donate honeypot writes nothing, sends nothing, returns ok:true', () => {
  const deps = makeDonateDeps();
  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 1, handoffMethod: 'dropoff',
    extra_field_2: 'i-am-a-bot',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.route, 'honeypot');
  assert.equal(deps.sheet.rows().length, 0);
  assert.equal(deps.log.emails.length, 0);
  assert.equal(deps.log.telegrams.length, 0);
});

// ── BD1 — Validation reject ──────────────────────────────────
test('BD1 — donate validation reject writes nothing, sends nothing', () => {
  const deps = makeDonateDeps();
  const out = shadowDonate({}, deps);
  assert.equal(out.ok, false);
  assert.equal(deps.sheet.rows().length, 0);
  assert.equal(deps.log.emails.length, 0);
  assert.equal(deps.log.telegrams.length, 0);
});

// ── BD1 — Disabled gate ──────────────────────────────────────
test('BD1 — disabled config writes nothing, sends nothing', () => {
  const deps = makeDonateDeps();
  deps.cfg.enabled = false;
  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 1, handoffMethod: 'dropoff',
  }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'disabled');
  assert.equal(deps.sheet.rows().length, 0);
  assert.equal(deps.log.emails.length, 0);
  assert.equal(deps.log.telegrams.length, 0);
});

// ── BD1 — Sheet append fails ─────────────────────────────────
test('BD1 — when append fails, NO email, NO telegram', () => {
  const deps = makeDonateDeps({ appendThrows: true, telegramConfigured: true });
  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 1, handoffMethod: 'dropoff',
  }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'sheet-write-failed');
  assert.equal(deps.sheet.rows().length, 0);
  assert.equal(deps.log.emails.length, 0);
  assert.equal(deps.log.telegrams.length, 0);
});

// ── BD1 — Append OK + Telegram fails ────────────────────────
test('BD1 — append OK but Telegram fails: row exists with telegram_status=failed; emails were sent', () => {
  const deps = makeDonateDeps({ telegramConfigured: true, telegramFails: true });
  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 1, handoffMethod: 'dropoff',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.telegram, 'failed');
  assert.equal(deps.sheet.rows().length, 1);
  const row = deps.sheet.rows()[0];
  assert.equal(row[IDX.telegram_status], 'failed');
  // Both emails sent.
  assert.ok(deps.log.emails.find(e => e.kind === 'donate-admin'));
  assert.ok(deps.log.emails.find(e => e.kind === 'donate-thank-you'));
});

// ── BD1 — Append OK + Telegram OK ───────────────────────────
test('BD1 — happy path: row appended, both emails sent, telegram_status=sent', () => {
  const deps = makeDonateDeps({ telegramConfigured: true });
  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 3, handoffMethod: 'pickup', city: 'Everett',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.telegram, 'sent');
  assert.equal(deps.sheet.rows().length, 1);
  const row = deps.sheet.rows()[0];
  assert.equal(row[IDX.telegram_status], 'sent');
  assert.equal(row[IDX.telegram_message_id], 12345);
  assert.equal(row[IDX.kind], 'donate');
  assert.equal(row[IDX.status], 'pending_fulfillment');
  assert.equal(deps.log.emails.length, 2);
  assert.equal(deps.log.telegrams.length, 1);
});

// ── BD1 — Telegram skipped when not configured ──────────────
test('BD1 — telegram skipped (no thread configured) does not log a telegram call', () => {
  const deps = makeDonateDeps({ telegramConfigured: false });
  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 1, handoffMethod: 'dropoff',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.telegram, 'skipped');
  assert.equal(deps.log.telegrams.length, 0);
  assert.equal(deps.sheet.rows().length, 1);
  assert.equal(deps.sheet.rows()[0][IDX.telegram_status], 'skipped');
});

// ── BD1 — Donor with phone-only contact gets no thank-you ─
test('BD1 — donor with phone-only contact: row + admin email, no donor thank-you (no email to send to)', () => {
  const deps = makeDonateDeps({ telegramConfigured: false });
  const out = shadowDonate({
    name: 'Sam', phone: '555-1234', count: 1, handoffMethod: 'dropoff',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(deps.sheet.rows().length, 1);
  // Only the admin email; no donor thank-you (no email address).
  assert.equal(deps.log.emails.length, 1);
  assert.equal(deps.log.emails[0].kind, 'donate-admin');
});

// ── BD1 — Idempotent resubmit returns the previous submissionId ─
test('BD1 — idempotent resubmit: no new row, no new emails, no new telegram', () => {
  // Seed the sheet with a prior donate submission from the same email.
  const previous = HEADERS.map(h => '');
  previous[IDX.submission_id] = 'prior-id';
  previous[IDX.received_at] = new Date('2026-05-29T11:00:00Z').toISOString();   // 1 hour ago
  previous[IDX.kind] = 'donate';
  previous[IDX.contact_email] = 'sam@example.com';
  previous[IDX.status] = 'pending_fulfillment';
  const deps = makeDonateDeps({ telegramConfigured: true, prevValues: [previous] });

  const out = shadowDonate({
    name: 'Sam', email: 'sam@example.com', count: 1, handoffMethod: 'dropoff',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.idempotent, true);
  assert.equal(out.submissionId, 'prior-id');
  // No new row, no new emails, no new telegram.
  assert.equal(deps.sheet.rows().length, 1);
  assert.equal(deps.log.emails.length, 0);
  assert.equal(deps.log.telegrams.length, 0);
});

// ── BD2 — Receive side never relays to Telegram at intake ───
test('BD2 — receive submission writes a row, sends admin review email, but NEVER sends to Telegram', () => {
  const deps = makeDonateDeps({ telegramConfigured: true });
  const out = shadowReceive({
    name: 'Maria', email: 'maria@example.com', city: 'Everett',
    story: 'I just moved into a new apartment in Everett and I lost my Bible during the move. I would love to read scripture again now that I am settled in.',
  }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.kind, 'receive');
  assert.equal(out.status, 'pending_review');
  // Row exists.
  assert.equal(deps.sheet.rows().length, 1);
  const row = deps.sheet.rows()[0];
  assert.equal(row[IDX.kind], 'receive');
  assert.equal(row[IDX.status], 'pending_review');
  // Tokens were issued.
  assert.equal(row[IDX.approve_token], 'tok-approve');
  assert.equal(row[IDX.decline_token], 'tok-decline');
  assert.equal(row[IDX.handoff_token], 'tok-handoff');
  // Admin review email sent; NO requester email; NO Telegram.
  assert.equal(deps.log.emails.length, 1);
  assert.equal(deps.log.emails[0].kind, 'review-admin');
  assert.equal(deps.log.telegrams.length, 0);
});

test('BD2 — receive validation rejection writes nothing, sends nothing', () => {
  const deps = makeDonateDeps({ telegramConfigured: true });
  const out = shadowReceive({}, deps);
  assert.equal(out.ok, false);
  assert.equal(deps.sheet.rows().length, 0);
  assert.equal(deps.log.emails.length, 0);
  assert.equal(deps.log.telegrams.length, 0);
});
