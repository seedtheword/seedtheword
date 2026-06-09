// Feature: your-walk-tracker — YW9 revoke completeness
//
// **Validates: Requirements YW9**
//
// Seeds WalkTokens/WalkStamps/WalkBadges for two different emails E1
// and E2, revokes E1, and asserts:
//   • E1 has zero rows in all three tabs
//   • E2 is untouched
//   • subsequent walkStamp for E1's old token returns bad-token
//   • subsequent walkSync for E1's old token returns bad-token
//   • subsequent walkRevoke for E1's old token returns bad-token
//   • a fresh walkLinkRequest for E1 produces a brand-new WalkTokens
//     row whose created_at is strictly after the revoke moment

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateWalkLinkRequest_,
  validateWalkStamp_,
  tokenIsActive_,
  isWalkTokenHex_,
  findEmailLinkRequestsInWindow_,
  WALK_LINK_RATE_WINDOW_HOURS,
} from '../docs/apps-script/your-walk-helpers.js';

const TOKENS_HEADERS = [
  'email', 'token', 'created_at', 'last_seen_at', 'expires_at',
  'link_requests_24h_ts', 'revoked_at',
];
const STAMPS_HEADERS = [
  'email', 'stamp_date', 'stamp_at', 'anchor_book', 'anchor_chapter', 'stream',
];
const BADGES_HEADERS = [
  'email', 'badge_id', 'unlocked_at', 'unlocked_on',
];

const E1_TOKEN = 'a'.repeat(64);
const E2_TOKEN = 'b'.repeat(64);

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

function makeHarness(seed = {}) {
  const tokens = makeFakeSheet(TOKENS_HEADERS);
  const stamps = makeFakeSheet(STAMPS_HEADERS);
  const badges = makeFakeSheet(BADGES_HEADERS);
  for (const r of (seed.tokens || [])) {
    tokens.appendRow(TOKENS_HEADERS.map(h => r[h] == null ? '' : r[h]));
  }
  for (const r of (seed.stamps || [])) {
    stamps.appendRow(STAMPS_HEADERS.map(h => r[h] == null ? '' : r[h]));
  }
  for (const r of (seed.badges || [])) {
    badges.appendRow(BADGES_HEADERS.map(h => r[h] == null ? '' : r[h]));
  }
  let randomCounter = 1000;
  const emails = [];
  return {
    tokens, stamps, badges,
    cfg: { enabled: true, tokenTtlDays: 30, graceDays: 3, linkRateLimitPerDay: 3 },
    catalog: { badges: [{ id: 'first-chapter-back', unlockRule: 'first-stamp-ever' }] },
    now: seed.now || new Date('2026-05-01T12:00:00Z'),
    setNow(d) { this.now = d; },
    randomToken() {
      randomCounter++;
      const hex = String(randomCounter).padStart(64, 'c');
      return hex.slice(-64);
    },
    emailLog: emails,
    sendMiracleLink(email, token) { emails.push({ email, token }); },
  };
}

function ymdUtc(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function findRowByEmail(values, idx, email) {
  const target = String(email || '').trim().toLowerCase();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.email] || '').trim().toLowerCase() === target) return r;
  }
  return -1;
}

function findTokensRowObject(values, idx, token) {
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.token] || '') === token) {
      return {
        email:                String(values[r][idx.email] || '').trim().toLowerCase(),
        token:                String(values[r][idx.token] || ''),
        created_at:           values[r][idx.created_at],
        last_seen_at:         values[r][idx.last_seen_at],
        expires_at:           values[r][idx.expires_at],
        link_requests_24h_ts: values[r][idx.link_requests_24h_ts],
        revoked_at:           values[r][idx.revoked_at],
      };
    }
  }
  return null;
}

function deleteRowsByEmail(sheet, idx, email) {
  const values = sheet.getDataRange().getValues();
  const target = String(email || '').trim().toLowerCase();
  let deleted = 0;
  for (let r = values.length - 1; r >= 1; r--) {
    const rowEmail = String(values[r][idx.email] || '').trim().toLowerCase();
    if (rowEmail === target) {
      sheet.deleteRow(r + 1);
      deleted++;
    }
  }
  return deleted;
}

// ── Shadow handlers ───────────────────────────────────────────────

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
  const existing = findRowByEmail(values, idx, v.email);

  if (existing === -1) {
    const row = TOKENS_HEADERS.map(() => '');
    row[idx.email]                = v.email;
    row[idx.token]                = token;
    row[idx.created_at]           = h.now.toISOString();
    row[idx.last_seen_at]         = '';
    row[idx.expires_at]           = expiresAt.toISOString();
    row[idx.link_requests_24h_ts] = h.now.toISOString();
    row[idx.revoked_at]           = '';
    h.tokens.appendRow(row);
  } else {
    const r = existing + 1;
    h.tokens.getRange(r, idx.token + 1).setValue(token);
    h.tokens.getRange(r, idx.expires_at + 1).setValue(expiresAt.toISOString());
    const oldTs = String(values[existing][idx.link_requests_24h_ts] || '');
    const newTs = oldTs ? oldTs + ',' + h.now.toISOString() : h.now.toISOString();
    h.tokens.getRange(r, idx.link_requests_24h_ts + 1).setValue(newTs);
    h.tokens.getRange(r, idx.revoked_at + 1).setValue('');
  }
  h.sendMiracleLink(v.email, token);
  return { ok: true, status: 'sent', tokenForTest: token };
}

function shadowWalkStamp(payload, h) {
  if (payload && payload.extra_field_2) return { ok: true, route: 'honeypot' };
  const v = validateWalkStamp_(payload);
  if (!v.ok) return { ok: false, error: v.reason };
  if (!h.cfg.enabled) return { ok: false, error: 'disabled' };
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, v.token);
  if (!tokenRow || !tokenIsActive_(tokenRow, h.now)) {
    return { ok: false, error: 'bad-token' };
  }
  return { ok: true };
}

function shadowWalkSync(payload, h) {
  const token = String((payload && payload.token) || '').trim();
  if (!isWalkTokenHex_(token)) return { ok: false, error: 'bad-token-shape' };
  if (!h.cfg.enabled) return { ok: false, error: 'disabled' };
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, token);
  if (!tokenRow || !tokenIsActive_(tokenRow, h.now)) {
    return { ok: false, error: 'bad-token' };
  }
  return { ok: true };
}

function shadowWalkRevoke(payload, h) {
  const token = String((payload && payload.token) || '').trim();
  if (!isWalkTokenHex_(token)) return { ok: false, error: 'bad-token-shape' };
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, token);
  if (!tokenRow) return { ok: false, error: 'bad-token' };
  const email = tokenRow.email;
  const deleted = { tokens: 0, stamps: 0, badges: 0 };
  deleted.tokens = deleteRowsByEmail(h.tokens, tokenIdx, email);
  deleted.stamps = deleteRowsByEmail(h.stamps, indexFor(STAMPS_HEADERS), email);
  deleted.badges = deleteRowsByEmail(h.badges, indexFor(BADGES_HEADERS), email);
  return { ok: true, deleted };
}


// ── Helpers for test fixtures ─────────────────────────────────────

function seedTwoMembers(now) {
  return makeHarness({
    now,
    tokens: [
      {
        email: 'e1@example.com',
        token: E1_TOKEN,
        created_at: '2026-04-01T00:00:00Z',
        last_seen_at: '2026-04-15T00:00:00Z',
        expires_at: '2026-06-01T00:00:00Z',
        link_requests_24h_ts: '',
        revoked_at: '',
      },
      {
        email: 'e2@example.com',
        token: E2_TOKEN,
        created_at: '2026-04-01T00:00:00Z',
        last_seen_at: '2026-04-20T00:00:00Z',
        expires_at: '2026-06-15T00:00:00Z',
        link_requests_24h_ts: '',
        revoked_at: '',
      },
    ],
    stamps: [
      { email: 'e1@example.com', stamp_date: '2026-04-15', stamp_at: '2026-04-15T12:00:00Z',
        anchor_book: 'John', anchor_chapter: 1, stream: 'nt' },
      { email: 'e1@example.com', stamp_date: '2026-04-16', stamp_at: '2026-04-16T12:00:00Z',
        anchor_book: 'John', anchor_chapter: 2, stream: 'nt' },
      { email: 'e2@example.com', stamp_date: '2026-04-20', stamp_at: '2026-04-20T12:00:00Z',
        anchor_book: '', anchor_chapter: '', stream: '' },
      { email: 'e2@example.com', stamp_date: '2026-04-21', stamp_at: '2026-04-21T12:00:00Z',
        anchor_book: '', anchor_chapter: '', stream: '' },
    ],
    badges: [
      { email: 'e1@example.com', badge_id: 'first-chapter-back',
        unlocked_at: '2026-04-15T12:00:00Z', unlocked_on: '2026-04-15' },
      { email: 'e2@example.com', badge_id: 'first-chapter-back',
        unlocked_at: '2026-04-20T12:00:00Z', unlocked_on: '2026-04-20' },
    ],
  });
}


// ── YW9 — explicit examples ───────────────────────────────────────

test('YW9 — revoke for E1 leaves zero rows in all three tabs for E1', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  // Pre-conditions.
  assert.equal(h.tokens.rows().length, 2);
  assert.equal(h.stamps.rows().length, 4);
  assert.equal(h.badges.rows().length, 2);

  const out = shadowWalkRevoke({ token: E1_TOKEN }, h);
  assert.equal(out.ok, true);
  assert.deepEqual(out.deleted, { tokens: 1, stamps: 2, badges: 1 });

  // E1 gone everywhere.
  function rowsFor(sheet, email) {
    return sheet.rows().filter(r => String(r[0] || '').toLowerCase() === email.toLowerCase());
  }
  assert.equal(rowsFor(h.tokens, 'e1@example.com').length, 0);
  assert.equal(rowsFor(h.stamps, 'e1@example.com').length, 0);
  assert.equal(rowsFor(h.badges, 'e1@example.com').length, 0);
});

test('YW9 — revoke for E1 does NOT touch E2 rows', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  shadowWalkRevoke({ token: E1_TOKEN }, h);

  function rowsFor(sheet, email) {
    return sheet.rows().filter(r => String(r[0] || '').toLowerCase() === email.toLowerCase());
  }
  assert.equal(rowsFor(h.tokens, 'e2@example.com').length, 1);
  assert.equal(rowsFor(h.stamps, 'e2@example.com').length, 2);
  assert.equal(rowsFor(h.badges, 'e2@example.com').length, 1);
});

test('YW9 — after revoke, walkStamp for E1 old token returns bad-token', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  shadowWalkRevoke({ token: E1_TOKEN }, h);
  const out = shadowWalkStamp({ token: E1_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
});

test('YW9 — after revoke, walkSync for E1 old token returns bad-token', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  shadowWalkRevoke({ token: E1_TOKEN }, h);
  const out = shadowWalkSync({ token: E1_TOKEN }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
});

test('YW9 — after revoke, walkRevoke for E1 old token returns bad-token', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  shadowWalkRevoke({ token: E1_TOKEN }, h);
  const out = shadowWalkRevoke({ token: E1_TOKEN }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
});

test('YW9 — fresh walkLinkRequest for E1 after revoke creates a new row whose created_at is post-revoke', () => {
  const revokeAt = new Date('2026-05-01T12:00:00Z');
  const h = seedTwoMembers(revokeAt);
  shadowWalkRevoke({ token: E1_TOKEN }, h);

  // Advance the clock to simulate the user requesting a fresh link
  // some time later.
  const linkAt = new Date('2026-05-01T12:30:00Z');
  h.setNow(linkAt);
  const out = shadowWalkLinkRequest({ email: 'e1@example.com' }, h);
  assert.equal(out.ok, true);
  assert.equal(out.status, 'sent');

  // A brand-new WalkTokens row exists for E1.
  const idx = indexFor(TOKENS_HEADERS);
  const e1Rows = h.tokens.rows().filter(r =>
    String(r[idx.email] || '').toLowerCase() === 'e1@example.com');
  assert.equal(e1Rows.length, 1, 'one fresh WalkTokens row for E1');

  const newRow = e1Rows[0];
  // created_at is strictly after the revoke moment.
  const createdAt = new Date(newRow[idx.created_at]);
  assert.equal(createdAt.getTime() > revokeAt.getTime(), true,
    'created_at (' + createdAt.toISOString() + ') is after revoke (' + revokeAt.toISOString() + ')');

  // The new token is DIFFERENT from the old E1 token.
  assert.notEqual(String(newRow[idx.token]), E1_TOKEN);

  // No WalkStamps or WalkBadges rows for E1 — the history was wiped.
  assert.equal(h.stamps.rows().filter(r => String(r[0] || '').toLowerCase() === 'e1@example.com').length, 0);
  assert.equal(h.badges.rows().filter(r => String(r[0] || '').toLowerCase() === 'e1@example.com').length, 0);
});

test('YW9 — fresh walkLinkRequest for E1 after revoke does not affect E2', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  shadowWalkRevoke({ token: E1_TOKEN }, h);
  h.setNow(new Date('2026-05-01T12:30:00Z'));
  shadowWalkLinkRequest({ email: 'e1@example.com' }, h);

  // E2's token is still active.
  const out = shadowWalkSync({ token: E2_TOKEN }, h);
  assert.equal(out.ok, true);
});

test('YW9 — revoke is idempotent for the case where the token row was already removed', () => {
  const h = seedTwoMembers(new Date('2026-05-01T12:00:00Z'));
  const out1 = shadowWalkRevoke({ token: E1_TOKEN }, h);
  assert.equal(out1.ok, true);

  // Calling again with the same (now-deleted) token row → bad-token.
  const out2 = shadowWalkRevoke({ token: E1_TOKEN }, h);
  assert.equal(out2.ok, false);
  assert.equal(out2.error, 'bad-token');
  // E1 still has zero rows in every tab.
  function rowsFor(sheet, email) {
    return sheet.rows().filter(r => String(r[0] || '').toLowerCase() === email.toLowerCase());
  }
  assert.equal(rowsFor(h.tokens, 'e1@example.com').length, 0);
  assert.equal(rowsFor(h.stamps, 'e1@example.com').length, 0);
  assert.equal(rowsFor(h.badges, 'e1@example.com').length, 0);
});

test('YW9 — revoke works on an EXPIRED E1 token (Requirement 9.4)', () => {
  // Build a harness where E1's token has expired but E2 is fresh.
  const h = makeHarness({
    now: new Date('2026-05-01T12:00:00Z'),
    tokens: [
      {
        email: 'e1@example.com',
        token: E1_TOKEN,
        created_at: '2026-01-01T00:00:00Z',
        last_seen_at: '2026-02-15T00:00:00Z',
        expires_at: '2026-03-15T00:00:00Z',         // expired
        link_requests_24h_ts: '',
        revoked_at: '',
      },
      {
        email: 'e2@example.com',
        token: E2_TOKEN,
        created_at: '2026-04-01T00:00:00Z',
        last_seen_at: '',
        expires_at: '2026-06-15T00:00:00Z',
        link_requests_24h_ts: '',
        revoked_at: '',
      },
    ],
    stamps: [
      { email: 'e1@example.com', stamp_date: '2026-02-15', stamp_at: '2026-02-15T12:00:00Z',
        anchor_book: '', anchor_chapter: '', stream: '' },
    ],
    badges: [
      { email: 'e1@example.com', badge_id: 'first-chapter-back',
        unlocked_at: '2026-02-15T12:00:00Z', unlocked_on: '2026-02-15' },
    ],
  });
  const out = shadowWalkRevoke({ token: E1_TOKEN }, h);
  assert.equal(out.ok, true, 'revoke must work on expired tokens');
  assert.deepEqual(out.deleted, { tokens: 1, stamps: 1, badges: 1 });
});
