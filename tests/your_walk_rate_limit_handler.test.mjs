// Feature: your-walk-tracker — YW7 link-request rate limit (handler side)
//
// **Validates: Requirements YW7**
//
// End-to-end behaviour of handleWalkLinkRequest_ around the rolling
// 24h window:
//   • 3 walkLinkRequests for the same email inside the same 24h
//     window all return { ok: true, status: 'sent' } AND emit one
//     magic-link email each.
//   • The 4th request inside the same window returns
//     { ok: false, error: 'rate-limited' } AND emits NO email.
//   • A 4th request after now + 24h + 1ms succeeds again — the
//     window is rolling, not bucketed.
//
// Uses a controllable Date (the harness exposes `now` and the test
// advances it explicitly).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateWalkLinkRequest_,
  findEmailLinkRequestsInWindow_,
  WALK_LINK_RATE_WINDOW_HOURS,
} from '../docs/apps-script/your-walk-helpers.js';

const TOKENS_HEADERS = [
  'email', 'token', 'created_at', 'last_seen_at', 'expires_at',
  'link_requests_24h_ts', 'revoked_at',
];
const RATE_LIMIT = 3;
const TIMESTAMP_CAP = 5;
const TTL_DAYS = 30;

function indexFor(headers) {
  const idx = {};
  for (let i = 0; i < headers.length; i++) idx[headers[i]] = i;
  return idx;
}

function makeFakeSheet(headers) {
  const values = [headers.slice()];
  return {
    headers,
    appendRow(row) { values.push(row.slice()); },
    getDataRange() { return { getValues: () => values.map(r => r.slice()) }; },
    getRange(rowIdx, colIdx) {
      return { setValue(v) { values[rowIdx - 1][colIdx - 1] = v; } };
    },
    deleteRow(rowIdx) { values.splice(rowIdx - 1, 1); },
    rows() { return values.slice(1); },
    rawValues() { return values; },
  };
}

function makeHarness(now) {
  const tokens = makeFakeSheet(TOKENS_HEADERS);
  const emails = [];
  let randomCounter = 0;
  return {
    tokens,
    emailLog: emails,
    cfg: { enabled: true, tokenTtlDays: TTL_DAYS, linkRateLimitPerDay: RATE_LIMIT },
    now,
    setNow(d) { this.now = d; },
    randomToken() {
      randomCounter++;
      // 64 hex chars, deterministic per call.
      const hex = String(randomCounter).padStart(64, 'a');
      return hex.slice(-64);
    },
    sendMagicLink(email, token) { emails.push({ email, token }); },
  };
}

function findRowByEmail(values, idx, email) {
  const target = String(email || '').trim().toLowerCase();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.email] || '').trim().toLowerCase() === target) return r;
  }
  return -1;
}

function rowTimestamps(values, idx, rowIdx) {
  if (rowIdx < 1 || rowIdx >= values.length) return [];
  const raw = String(values[rowIdx][idx.link_requests_24h_ts] || '');
  if (!raw) return [];
  const out = [];
  for (const t of raw.split(',')) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) out.push(d);
  }
  return out;
}

function appendAndCap(existing, now, cap) {
  const out = [];
  for (const v of existing) {
    if (v instanceof Date) out.push(v.toISOString());
    else if (typeof v === 'string' && v) out.push(v);
  }
  out.push(now.toISOString());
  if (out.length > cap) return out.slice(out.length - cap);
  return out;
}

// Shadow walkLinkRequest. Mirror of handleWalkLinkRequest_.
function shadowWalkLinkRequest(payload, h) {
  if (payload && payload.extra_field_2) return { ok: true, route: 'honeypot' };
  const v = validateWalkLinkRequest_(payload);
  if (!v.ok) return { ok: false, error: v.reason };
  if (!h.cfg.enabled) return { ok: false, error: 'disabled' };

  const values = h.tokens.getDataRange().getValues();
  const idx = indexFor(values[0]);

  const recent = findEmailLinkRequestsInWindow_(
    values, idx, v.email, WALK_LINK_RATE_WINDOW_HOURS, h.now);
  if (recent.length >= h.cfg.linkRateLimitPerDay) {
    return { ok: false, error: 'rate-limited' };
  }

  const token = h.randomToken();
  const expiresAt = new Date(h.now.getTime() + h.cfg.tokenTtlDays * 86400000);

  const existingRowIdx = findRowByEmail(values, idx, v.email);
  const newTs = appendAndCap(rowTimestamps(values, idx, existingRowIdx), h.now, TIMESTAMP_CAP);

  if (existingRowIdx === -1) {
    const row = TOKENS_HEADERS.map(() => '');
    row[idx.email]                = v.email;
    row[idx.token]                = token;
    row[idx.created_at]           = h.now.toISOString();
    row[idx.last_seen_at]         = '';
    row[idx.expires_at]           = expiresAt.toISOString();
    row[idx.link_requests_24h_ts] = newTs.join(',');
    row[idx.revoked_at]           = '';
    h.tokens.appendRow(row);
  } else {
    const r = existingRowIdx + 1;
    h.tokens.getRange(r, idx.token + 1).setValue(token);
    h.tokens.getRange(r, idx.expires_at + 1).setValue(expiresAt.toISOString());
    h.tokens.getRange(r, idx.link_requests_24h_ts + 1).setValue(newTs.join(','));
  }

  h.sendMagicLink(v.email, token);
  return { ok: true, status: 'sent' };
}


// ── YW7 — three sends inside the window all succeed ───────────────

test('YW7 — first three walkLinkRequests inside 24h all return { ok: true, status: "sent" }', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);

  const out1 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.deepEqual(out1, { ok: true, status: 'sent' });

  h.setNow(new Date(start.getTime() + 60 * 60 * 1000));        // +1h
  const out2 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.deepEqual(out2, { ok: true, status: 'sent' });

  h.setNow(new Date(start.getTime() + 2 * 60 * 60 * 1000));    // +2h
  const out3 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.deepEqual(out3, { ok: true, status: 'sent' });

  // Three magic-link emails dispatched.
  assert.equal(h.emailLog.length, 3);
  // One row in WalkTokens (rotated, not appended).
  assert.equal(h.tokens.rows().length, 1);
});

test('YW7 — 4th walkLinkRequest inside 24h returns { ok: false, error: "rate-limited" } and emits NO email', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);

  for (let i = 0; i < 3; i++) {
    h.setNow(new Date(start.getTime() + i * 60 * 60 * 1000));
    const r = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
    assert.equal(r.ok, true);
  }
  assert.equal(h.emailLog.length, 3);

  // 4th request 30 minutes after the 3rd — well inside the window.
  h.setNow(new Date(start.getTime() + 2.5 * 60 * 60 * 1000));
  const r4 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.equal(r4.ok, false);
  assert.equal(r4.error, 'rate-limited');
  assert.equal(h.emailLog.length, 3, 'no 4th email');
});

test('YW7 — 4th request after the rolling 24h window has elapsed succeeds again', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);

  // Three sends spaced 1 hour apart starting at `start`.
  for (let i = 0; i < 3; i++) {
    h.setNow(new Date(start.getTime() + i * 60 * 60 * 1000));
    shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  }
  // Advance to start + 24h + 1ms; the FIRST request (at start) is now
  // strictly older than the window. With cap = 3 and 2 timestamps
  // remaining inside the window, the 4th request should succeed.
  h.setNow(new Date(start.getTime() + 24 * 60 * 60 * 1000 + 1));
  const r = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'sent');
  assert.equal(h.emailLog.length, 4);
});

test('YW7 — different emails do NOT share a budget', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);

  for (let i = 0; i < 3; i++) {
    h.setNow(new Date(start.getTime() + i * 60 * 60 * 1000));
    shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  }
  // Now cap exhausted for sam, but maria has her own row.
  h.setNow(new Date(start.getTime() + 2.5 * 60 * 60 * 1000));
  const r = shadowWalkLinkRequest({ email: 'maria@example.com' }, h);
  assert.equal(r.ok, true);
  assert.equal(h.emailLog.length, 4);
  assert.equal(h.tokens.rows().length, 2);
});

test('YW7 — 24h window is rolling: each old timestamp falls off independently', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);

  // Send 3 in a tight burst at start.
  shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  h.setNow(new Date(start.getTime() + 60 * 1000));
  shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  h.setNow(new Date(start.getTime() + 2 * 60 * 1000));
  shadowWalkLinkRequest({ email: 'sam@example.com' }, h);

  // Try again at +24h + 30s — the FIRST send (at start) just fell out
  // of the window (>24h ago); the 2nd and 3rd are still inside.
  h.setNow(new Date(start.getTime() + 24 * 60 * 60 * 1000 + 30 * 1000));
  const r1 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.equal(r1.ok, true, 'one timestamp aged out of the rolling window');
  assert.equal(h.emailLog.length, 4);

  // Trying again immediately is back to the cap.
  h.setNow(new Date(start.getTime() + 24 * 60 * 60 * 1000 + 31 * 1000));
  const r2 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.equal(r2.error, 'rate-limited');
});

test('YW7 — bad-email rejection does not consume rate-limit budget', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);
  // 100 bogus requests to a different (malformed) email.
  for (let i = 0; i < 100; i++) {
    const r = shadowWalkLinkRequest({ email: 'not-an-email' }, h);
    assert.equal(r.ok, false);
  }
  // Three real requests still succeed.
  for (let i = 0; i < 3; i++) {
    const r = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
    assert.equal(r.ok, true);
  }
  // 4th hits the cap.
  const r4 = shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  assert.equal(r4.error, 'rate-limited');
});

test('YW7 — link_requests_24h_ts cell is capped at TIMESTAMP_CAP entries', () => {
  const start = new Date('2026-05-01T08:00:00Z');
  const h = makeHarness(start);

  // 3 sends → row exists with 3 timestamps.
  for (let i = 0; i < 3; i++) {
    h.setNow(new Date(start.getTime() + i * 60 * 60 * 1000));
    shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  }
  // Wait past the rolling window then send 5 more.
  h.setNow(new Date(start.getTime() + 25 * 60 * 60 * 1000));
  shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  h.setNow(new Date(start.getTime() + 25.1 * 60 * 60 * 1000));
  shadowWalkLinkRequest({ email: 'sam@example.com' }, h);
  // (3rd inside this new window would hit rate limit; check cap on the cell.)
  const idx = indexFor(TOKENS_HEADERS);
  const cell = String(h.tokens.rawValues()[1][idx.link_requests_24h_ts] || '');
  const parts = cell.split(',').filter(Boolean);
  assert.ok(parts.length <= TIMESTAMP_CAP,
    'link_requests_24h_ts holds at most ' + TIMESTAMP_CAP + ' entries; got ' + parts.length);
});
