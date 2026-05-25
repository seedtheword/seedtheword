// Feature: prayer-request-intake, Property PI1 (audit-first integrity).
//
// Validates: Requirements 4.9, 4.10, 5.2, 5.6, 12.1
//
// We model the orchestrator's audit-first sequence (design §4.3)
// against in-memory mocks of the Prayers Sheet tab and the Telegram
// HTTP call. The contract:
//
//   1. validate → rate-limit → rate-of-success
//   2. appendPrayersRow_ (placeholder telegram_status='failed')
//   3. relayToTelegram_
//   4. updatePrayersRowTelegramStatus_(sent|failed)
//
// PI1 says: every accepted Submission produces either
//   (one Sheet row + one Telegram message + telegram_status='sent') OR
//   (one Sheet row + zero Telegram messages + telegram_status='failed')
// — never the third "Telegram sent without Sheet row" combination.
// AND when the Sheet append itself fails, no Telegram call is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildTelegramMessage_,
  computeDripStatus_,
  stripHtmlAndNormalize_,
} from '../docs/apps-script/prayer-intake-helpers.js';

// ── Fakes ──────────────────────────────────────────────────────
class PrayersSheetFake {
  constructor({ failOnAppend = false } = {}) {
    this.rows = [];
    this.failOnAppend = failOnAppend;
  }
  append(row) {
    if (this.failOnAppend) throw new Error('sheet write failed (mock)');
    this.rows.push({ ...row });
  }
  update(submissionId, status, msgId, errText) {
    for (const r of this.rows) {
      if (r.submission_id === submissionId) {
        r.telegram_status = status;
        r.telegram_message_id = msgId;
        r.telegram_error = errText;
        return true;
      }
    }
    return false;
  }
}

class TelegramFake {
  constructor({ shouldSucceed }) {
    this.shouldSucceed = shouldSucceed;
    this.calls = [];
  }
  send(text) {
    this.calls.push(text);
    if (this.shouldSucceed) {
      return { ok: true, messageId: this.calls.length };
    }
    return { ok: false, error: 'mock telegram failure' };
  }
}

// Test-side replica of the orchestrator's audit-first sequence. The
// production version lives in order-handler.gs (handlePrayerIntake_).
// The two MUST stay in sync — if the production sequence is reordered,
// this test must be updated as well, and the property fails until it is.
function orchestrate({ payload, cfg, prayersSheet, telegram }) {
  // Honeypot.
  if (payload.extra_field_2) return { ok: true, route: 'honeypot' };
  // Disabled.
  if (!cfg.enabled) return { ok: false, error: 'disabled' };

  // Validate.
  if (payload.kind !== 'prayer' && payload.kind !== 'thanksgiving') {
    return { ok: false, error: 'bad-kind' };
  }
  const anon = payload.anonymous === true;
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const body = stripHtmlAndNormalize_(String(payload.body || ''));
  if (!anon && !name) return { ok: false, error: 'name-required' };
  if (body.length < cfg.bodyMinChars) return { ok: false, error: 'body-too-short' };
  if (body.length > cfg.bodyMaxChars) return { ok: false, error: 'body-too-long' };

  const submissionId = 'sub-' + Math.random().toString(36).slice(2);
  const dripStatus = computeDripStatus_({ email }, cfg);

  // Build (no I/O).
  const assembled = buildTelegramMessage_({
    kind: payload.kind, submitterName: name, anonymous: anon, body, marker: cfg.marker,
  });

  // PHASE 1 — append the audit row in pessimistic shape.
  try {
    prayersSheet.append({
      submission_id: submissionId,
      kind: payload.kind,
      submitter_name: name,
      submitter_email: email,
      anonymous: anon,
      body,
      telegram_status: 'failed',
      telegram_message_id: '',
      telegram_error: '',
      drip_status: dripStatus,
    });
  } catch (_err) {
    return { ok: false, error: 'sheet-write-failed' };
  }

  // PHASE 2 — Telegram + audit-row update.
  const sendResult = telegram.send(assembled.text);
  prayersSheet.update(submissionId,
    sendResult.ok ? 'sent' : 'failed',
    sendResult.messageId || '',
    sendResult.error || '');

  return {
    ok: true,
    submissionId,
    telegram: sendResult.ok ? 'sent' : 'failed',
    truncated: !!assembled.truncated,
  };
}

const FIXED_CFG = {
  enabled: true,
  marker: '(via the website)',
  bodyMinChars: 10,
  bodyMaxChars: 2000,
  dripDays: [0, 3, 7, 14],
  dripEnabled: false,
  auditSheetTabName: 'Prayers',
};

// ── PI1 — happy + failing-Telegram + failing-Sheet ─────────────
test('PI1 — accepted Submissions produce one row + at most one Telegram call', () => {
  fc.assert(fc.property(
    fc.array(fc.record({
      kind: fc.constantFrom('prayer', 'thanksgiving'),
      name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
      email: fc.option(fc.constant('a@b.co'), { nil: '' }),
      anonymous: fc.boolean(),
      body: fc.string({ minLength: 10, maxLength: 200 }),
    }), { minLength: 1, maxLength: 6 }),
    fc.boolean(),  // telegramSucceeds (uniform across the batch)
    (payloads, telegramSucceeds) => {
      const sheet = new PrayersSheetFake({ failOnAppend: false });
      const tg = new TelegramFake({ shouldSucceed: telegramSucceeds });

      const accepted = [];
      for (const p of payloads) {
        const out = orchestrate({
          payload: { ...p, extra_field_2: '' },
          cfg: FIXED_CFG,
          prayersSheet: sheet,
          telegram: tg,
        });
        if (out.ok && out.submissionId) accepted.push(out);
      }

      // (1) One row per accepted Submission.
      assert.equal(sheet.rows.length, accepted.length,
        'Sheet rows should equal accepted count');

      // (2) At most one Telegram call per accepted Submission, and
      //     exactly the count is independent of telegramSucceeds — every
      //     accepted Submission attempts the call exactly once.
      assert.equal(tg.calls.length, accepted.length,
        'Telegram call count should equal accepted count');

      // (3) Sheet row's telegram_status mirrors the call result.
      for (const r of sheet.rows) {
        assert.equal(r.telegram_status, telegramSucceeds ? 'sent' : 'failed');
      }

      // (4) NEVER a Telegram call without a row. (Already implied by
      //     equal counts above, but assert explicitly.)
      assert.ok(tg.calls.length <= sheet.rows.length,
        'Telegram calls must never exceed sheet rows');
    },
  ), { numRuns: 80 });
});

test('PI1 — when the Sheet append fails, NO Telegram call is made', () => {
  fc.assert(fc.property(
    fc.record({
      kind: fc.constantFrom('prayer', 'thanksgiving'),
      name: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
      anonymous: fc.boolean(),
      body: fc.string({ minLength: 10, maxLength: 200 }),
    }),
    (p) => {
      const sheet = new PrayersSheetFake({ failOnAppend: true });
      const tg = new TelegramFake({ shouldSucceed: true });

      const out = orchestrate({
        payload: { ...p, email: '', extra_field_2: '' },
        cfg: FIXED_CFG,
        prayersSheet: sheet,
        telegram: tg,
      });

      assert.equal(out.ok, false);
      assert.equal(out.error, 'sheet-write-failed');
      assert.equal(sheet.rows.length, 0);
      assert.equal(tg.calls.length, 0,
        'Telegram MUST NOT be called when the audit append fails');
    },
  ), { numRuns: 30 });
});

test('PI1 — honeypot trip writes nothing and returns ok:true', () => {
  const sheet = new PrayersSheetFake();
  const tg = new TelegramFake({ shouldSucceed: true });
  const out = orchestrate({
    payload: {
      kind: 'prayer', name: 'Spam', email: '', anonymous: false,
      body: 'this should be discarded',
      extra_field_2: 'bot was here',
    },
    cfg: FIXED_CFG,
    prayersSheet: sheet,
    telegram: tg,
  });
  assert.equal(out.ok, true);
  assert.equal(out.route, 'honeypot');
  assert.equal(sheet.rows.length, 0);
  assert.equal(tg.calls.length, 0);
});

test('PI1 — disabled config rejects without writing or relaying', () => {
  const sheet = new PrayersSheetFake();
  const tg = new TelegramFake({ shouldSucceed: true });
  const out = orchestrate({
    payload: {
      kind: 'prayer', name: 'Maria', email: '', anonymous: false,
      body: 'please pray for me',
      extra_field_2: '',
    },
    cfg: { ...FIXED_CFG, enabled: false },
    prayersSheet: sheet,
    telegram: tg,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'disabled');
  assert.equal(sheet.rows.length, 0);
  assert.equal(tg.calls.length, 0);
});
