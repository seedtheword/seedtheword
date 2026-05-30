// Feature: bible-donate-request, BD9 — 48-hour review SLO
//
// Shadow cron mirroring processBibleReviewReminders_ in
// order-handler.gs. The Apps Script cron walks the Bibles tab and
// emails admins for any receive row that's been pending_review
// past the SLO and hasn't been reminded yet. One reminder per row.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bibleHeaderIndex_ } from '../docs/apps-script/bible-donate-helpers.js';

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
  r[IDX.received_at] = opts.receivedAt || new Date('2026-05-29T12:00:00Z').toISOString();
  r[IDX.kind] = opts.kind || 'receive';
  r[IDX.name] = opts.name || 'Maria';
  r[IDX.contact_email] = opts.email || 'maria@example.com';
  r[IDX.story] = 'a'.repeat(120);
  r[IDX.status] = opts.status || 'pending_review';
  r[IDX.approve_token] = 'tok-approve-' + (opts.submissionId || 'sid-1');
  r[IDX.decline_token] = 'tok-decline-' + (opts.submissionId || 'sid-1');
  r[IDX.reminder_sent_at] = opts.reminderSentAt || '';
  return r;
}

// Shadow of processBibleReviewReminders_.
function shadowCron(deps) {
  const values = deps.sheet.getValues();
  if (values.length < 2) return;
  const reminderHours = deps.reminderHours || 48;
  const now = deps.now;
  const thresholdMs = now.getTime() - reminderHours * 3600 * 1000;

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[IDX.kind]) !== 'receive') continue;
    if (String(r[IDX.status]) !== 'pending_review') continue;
    if (r[IDX.reminder_sent_at]) continue;
    const receivedAt = new Date(r[IDX.received_at]);
    if (isNaN(receivedAt.getTime())) continue;
    if (receivedAt.getTime() > thresholdMs) continue;

    deps.emails.push({
      to: 'seedthewordministry@gmail.com',
      submissionId: String(r[IDX.submission_id]),
      ageHours: Math.round((now.getTime() - receivedAt.getTime()) / 3600000),
    });
    deps.sheet.setCell(i + 1, IDX.reminder_sent_at, now.toISOString());
  }
}

const NOW = new Date('2026-05-31T12:00:00Z');
const HOURS_AGO = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

// ── BD9 — Cron emits a reminder when window crossed ─────────
test('BD9 — receive row pending 49h gets a reminder, reminder_sent_at stamped', () => {
  const sheet = makeSheet([row({ submissionId: 'old', receivedAt: HOURS_AGO(49) })]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  assert.equal(deps.emails.length, 1);
  assert.equal(deps.emails[0].submissionId, 'old');
  assert.equal(sheet.rowAt(2)[IDX.reminder_sent_at], NOW.toISOString());
});

test('BD9 — receive row pending 47h gets NO reminder (under SLO)', () => {
  const sheet = makeSheet([row({ submissionId: 'fresh', receivedAt: HOURS_AGO(47) })]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  assert.equal(deps.emails.length, 0);
  assert.equal(sheet.rowAt(2)[IDX.reminder_sent_at], '');
});

// ── BD9 — One reminder per row across multiple cron runs ────
test('BD9 — second cron run is a no-op for an already-reminded row', () => {
  const sheet = makeSheet([row({ submissionId: 'old', receivedAt: HOURS_AGO(49) })]);
  const deps1 = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps1);
  assert.equal(deps1.emails.length, 1);

  // Second run, 30 minutes later — same row should NOT be reminded again.
  const later = new Date(NOW.getTime() + 30 * 60 * 1000);
  const deps2 = { sheet, emails: [], reminderHours: 48, now: later };
  shadowCron(deps2);
  assert.equal(deps2.emails.length, 0);
});

// ── BD9 — Cron only handles 'receive' kind ──────────────────
test('BD9 — donate-kind row is never reminded even if pending and old', () => {
  const sheet = makeSheet([row({ kind: 'donate', status: 'pending_fulfillment', receivedAt: HOURS_AGO(72) })]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  assert.equal(deps.emails.length, 0);
});

// ── BD9 — Cron only handles 'pending_review' status ─────────
test('BD9 — approved/declined rows get no reminder', () => {
  const sheet = makeSheet([
    row({ submissionId: 'approved', status: 'approved', receivedAt: HOURS_AGO(72) }),
    row({ submissionId: 'declined', status: 'declined', receivedAt: HOURS_AGO(72) }),
  ]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  assert.equal(deps.emails.length, 0);
});

// ── BD9 — Multiple rows: only the pending+old ones get reminded ─
test('BD9 — multiple rows: cron sends one reminder per overdue pending_review row', () => {
  const sheet = makeSheet([
    row({ submissionId: 'A', receivedAt: HOURS_AGO(72) }),                                          // overdue → reminder
    row({ submissionId: 'B', receivedAt: HOURS_AGO(20) }),                                          // fresh → no
    row({ submissionId: 'C', status: 'approved', receivedAt: HOURS_AGO(72) }),                      // not pending → no
    row({ submissionId: 'D', receivedAt: HOURS_AGO(60), reminderSentAt: HOURS_AGO(10) }),           // already reminded → no
    row({ submissionId: 'E', receivedAt: HOURS_AGO(50) }),                                          // overdue → reminder
  ]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  const ids = deps.emails.map(e => e.submissionId).sort();
  assert.deepEqual(ids, ['A', 'E']);
});

// ── BD9 — Configurable threshold ────────────────────────────
test('BD9 — reviewReminderHours config knob is respected', () => {
  const sheet = makeSheet([row({ submissionId: 'short', receivedAt: HOURS_AGO(2) })]);
  // Threshold of 1h: a 2h-old row IS overdue.
  const deps = { sheet, emails: [], reminderHours: 1, now: NOW };
  shadowCron(deps);
  assert.equal(deps.emails.length, 1);
});

// ── BD9 — Malformed received_at is silently skipped ────────
test('BD9 — row with malformed received_at does not crash the cron', () => {
  const r = row({ submissionId: 'broken' });
  r[IDX.received_at] = 'not-a-date';
  const sheet = makeSheet([r, row({ submissionId: 'good', receivedAt: HOURS_AGO(72) })]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  // Only the good row should be reminded.
  assert.equal(deps.emails.length, 1);
  assert.equal(deps.emails[0].submissionId, 'good');
});

// ── BD9 — Empty sheet is a no-op ────────────────────────────
test('BD9 — empty Bibles sheet is a no-op (no rows, no emails)', () => {
  const sheet = makeSheet([]);
  const deps = { sheet, emails: [], reminderHours: 48, now: NOW };
  shadowCron(deps);
  assert.equal(deps.emails.length, 0);
});
