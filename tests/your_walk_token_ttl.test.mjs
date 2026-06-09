// Feature: your-walk-tracker — YW6 token TTL boundary
//
// **Validates: Requirements YW6**
//
// A WalkTokens row whose expires_at is in the past causes:
//   • walkStamp  → bad-token (no row written, no mutation)
//   • walkSync   → bad-token (read-only handler still rejects)
//   • walkRevoke → STILL SUCCEEDS — the documented exception per
//                  Requirement 9.4. A lapsed member must be able to
//                  wipe their data without re-authenticating.
//
// Property generator pins the per-handler boundary at expires_at ==
// now ± small-epsilon: strictly greater than now is active, anything
// at or before is inactive (per tokenIsActive_'s `> now` semantics).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  validateWalkStamp_,
  tokenIsActive_,
  daysBetweenIso_,
  isWalkTokenHex_,
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

const VALID_TOKEN = 'a'.repeat(64);

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
  return {
    tokens, stamps, badges,
    cfg: { enabled: true, tokenTtlDays: 30, graceDays: 3, ...(seed.cfg || {}) },
    catalog: seed.catalog || { badges: [
      { id: 'first-chapter-back', unlockRule: 'first-stamp-ever' },
    ]},
    now: seed.now || new Date('2026-05-01T12:00:00Z'),
  };
}

function ymdUtc(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
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

// Shadow walkStamp.
function shadowWalkStamp(payload, h) {
  if (payload && payload.extra_field_2) return { ok: true, route: 'honeypot' };
  const v = validateWalkStamp_(payload);
  if (!v.ok) return { ok: false, error: v.reason };
  if (!h.cfg.enabled) return { ok: false, error: 'disabled' };
  const dayDelta = daysBetweenIso_(v.today, ymdUtc(h.now));
  if (!Number.isFinite(dayDelta) || Math.abs(dayDelta) > 2) {
    return { ok: false, error: 'bad-date' };
  }
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, v.token);
  if (!tokenRow || !tokenIsActive_(tokenRow, h.now)) {
    return { ok: false, error: 'bad-token' };
  }
  // Happy path bookkeeping not needed for these tests.
  return { ok: true, idempotent: false };
}

// Shadow walkSync.
function shadowWalkSync(payload, h) {
  if (payload && payload.extra_field_2) return { ok: true, route: 'honeypot' };
  const token = String((payload && payload.token) || '').trim();
  if (!isWalkTokenHex_(token)) return { ok: false, error: 'bad-token-shape' };
  if (!h.cfg.enabled) return { ok: false, error: 'disabled' };
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, token);
  if (!tokenRow || !tokenIsActive_(tokenRow, h.now)) {
    return { ok: false, error: 'bad-token' };
  }
  return { ok: true, email: tokenRow.email };
}

// Shadow walkRevoke. Critical contract: SHALL succeed even when
// expires_at is in the past.
function shadowWalkRevoke(payload, h) {
  if (payload && payload.extra_field_2) return { ok: true, route: 'honeypot' };
  const token = String((payload && payload.token) || '').trim();
  if (!isWalkTokenHex_(token)) return { ok: false, error: 'bad-token-shape' };
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  // Do NOT call tokenIsActive_ — revoke must work on expired tokens.
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, token);
  if (!tokenRow) return { ok: false, error: 'bad-token' };
  const email = tokenRow.email;
  const deleted = { tokens: 0, stamps: 0, badges: 0 };
  deleted.tokens = deleteRowsByEmail(h.tokens, tokenIdx, email);
  const stampIdx = indexFor(STAMPS_HEADERS);
  deleted.stamps = deleteRowsByEmail(h.stamps, stampIdx, email);
  const badgeIdx = indexFor(BADGES_HEADERS);
  deleted.badges = deleteRowsByEmail(h.badges, badgeIdx, email);
  return { ok: true, deleted };
}


// ── Helpers for test fixtures ─────────────────────────────────────

function harnessWithExpiredToken(now) {
  return makeHarness({
    now,
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-01-01T00:00:00Z',
      last_seen_at: '',
      expires_at: '2026-04-01T00:00:00Z',         // PAST relative to now
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
    stamps: [{
      email: 'sam@example.com',
      stamp_date: '2026-03-15',
      stamp_at: '2026-03-15T12:00:00Z',
      anchor_book: '', anchor_chapter: '', stream: '',
    }],
    badges: [{
      email: 'sam@example.com',
      badge_id: 'first-chapter-back',
      unlocked_at: '2026-03-15T12:00:00Z',
      unlocked_on: '2026-03-15',
    }],
  });
}


// ── YW6 — explicit examples ───────────────────────────────────────

test('YW6 — expired token: walkStamp returns bad-token', () => {
  const h = harnessWithExpiredToken(new Date('2026-05-01T12:00:00Z'));
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
  // No mutation to WalkStamps or WalkBadges.
  assert.equal(h.stamps.rows().length, 1, 'pre-existing stamp untouched');
  assert.equal(h.badges.rows().length, 1, 'pre-existing badge untouched');
});

test('YW6 — expired token: walkSync returns bad-token', () => {
  const h = harnessWithExpiredToken(new Date('2026-05-01T12:00:00Z'));
  const out = shadowWalkSync({ token: VALID_TOKEN }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
});

test('YW6 — expired token: walkRevoke STILL SUCCEEDS (Requirement 9.4)', () => {
  const h = harnessWithExpiredToken(new Date('2026-05-01T12:00:00Z'));
  const out = shadowWalkRevoke({ token: VALID_TOKEN }, h);
  assert.equal(out.ok, true);
  assert.deepEqual(out.deleted, { tokens: 1, stamps: 1, badges: 1 });
  // All three tabs are now empty for this email.
  assert.equal(h.tokens.rows().length, 0);
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
});

test('YW6 — token expiring exactly at `now` is INACTIVE (tokenIsActive_ uses `> now`, strict)', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const h = makeHarness({
    now,
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '',
      expires_at: now.toISOString(),       // EXACTLY at the boundary
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
  });
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
});

test('YW6 — token expiring 1ms after `now` is ACTIVE', () => {
  const now = new Date('2026-05-01T12:00:00.000Z');
  const future = new Date(now.getTime() + 1);
  const h = makeHarness({
    now,
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '',
      expires_at: future.toISOString(),
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
  });
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, true);
});

test('YW6 — empty expires_at is treated as inactive', () => {
  const h = makeHarness({
    now: new Date('2026-05-01T12:00:00Z'),
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '',
      expires_at: '',
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
  });
  const out = shadowWalkSync({ token: VALID_TOKEN }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
});

test('YW6 — revoked_at populated treats token as inactive for stamp + sync', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const h = makeHarness({
    now,
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '',
      expires_at: '2026-06-01T00:00:00Z',     // future
      link_requests_24h_ts: '',
      revoked_at: '2026-04-15T00:00:00Z',     // soft-revoked
    }],
  });
  assert.equal(shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h).error, 'bad-token');
  assert.equal(shadowWalkSync({ token: VALID_TOKEN }, h).error, 'bad-token');
  // BUT revoke still succeeds.
  const rev = shadowWalkRevoke({ token: VALID_TOKEN }, h);
  assert.equal(rev.ok, true);
});


// ── YW6 — fast-check property: per-handler boundary ───────────────

test('YW6 (property) — walkStamp/walkSync agree with tokenIsActive_ on the boundary; walkRevoke is independent', () => {
  fc.assert(
    fc.property(
      // ttlOffsetMs ∈ [-3600000, +3600000] → 2-hour window straddling now.
      fc.integer({ min: -3600000, max: 3600000 }),
      (offsetMs) => {
        const now = new Date('2026-05-01T12:00:00Z');
        const expiresAt = new Date(now.getTime() + offsetMs);
        const h = makeHarness({
          now,
          tokens: [{
            email: 'sam@example.com',
            token: VALID_TOKEN,
            created_at: '2026-01-01T00:00:00Z',
            last_seen_at: '',
            expires_at: expiresAt.toISOString(),
            link_requests_24h_ts: '',
            revoked_at: '',
          }],
        });
        const expectedActive = expiresAt.getTime() > now.getTime();

        const stampOut = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
        const stampOk = stampOut.ok === true;
        if (stampOk !== expectedActive) return false;

        // Restore (revoke deletes) — re-make harness for sync test.
        const h2 = makeHarness({
          now,
          tokens: [{
            email: 'sam@example.com',
            token: VALID_TOKEN,
            created_at: '2026-01-01T00:00:00Z',
            last_seen_at: '',
            expires_at: expiresAt.toISOString(),
            link_requests_24h_ts: '',
            revoked_at: '',
          }],
        });
        const syncOut = shadowWalkSync({ token: VALID_TOKEN }, h2);
        const syncOk = syncOut.ok === true;
        if (syncOk !== expectedActive) return false;

        // Revoke is independent of TTL — always succeeds when the row
        // exists.
        const h3 = makeHarness({
          now,
          tokens: [{
            email: 'sam@example.com',
            token: VALID_TOKEN,
            created_at: '2026-01-01T00:00:00Z',
            last_seen_at: '',
            expires_at: expiresAt.toISOString(),
            link_requests_24h_ts: '',
            revoked_at: '',
          }],
        });
        const revokeOut = shadowWalkRevoke({ token: VALID_TOKEN }, h3);
        if (revokeOut.ok !== true) return false;

        return true;
      }
    ),
    { numRuns: 200 }
  );
});

test('YW6 (property) — unknown token rejects from all four; revoke included', () => {
  fc.assert(
    fc.property(
      fc.hexaString({ minLength: 64, maxLength: 64 }),
      (otherTokenHex) => {
        const otherToken = otherTokenHex.toLowerCase();
        if (otherToken === VALID_TOKEN) return true;     // skip the collision case
        const now = new Date('2026-05-01T12:00:00Z');
        const h = makeHarness({
          now,
          tokens: [{
            email: 'sam@example.com',
            token: VALID_TOKEN,
            created_at: '2026-04-01T00:00:00Z',
            last_seen_at: '',
            expires_at: '2026-06-01T00:00:00Z',
            link_requests_24h_ts: '',
            revoked_at: '',
          }],
        });
        const stampOut = shadowWalkStamp({ token: otherToken, today: '2026-05-01' }, h);
        if (stampOut.error !== 'bad-token') return false;
        const syncOut = shadowWalkSync({ token: otherToken }, h);
        if (syncOut.error !== 'bad-token') return false;
        const revokeOut = shadowWalkRevoke({ token: otherToken }, h);
        if (revokeOut.error !== 'bad-token') return false;
        return true;
      }
    ),
    { numRuns: 100 }
  );
});
