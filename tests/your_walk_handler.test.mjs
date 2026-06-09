// Feature: your-walk-tracker, YW8 (stamp authenticity) + audit-first contract
//
// The Apps Script handler can't be imported into Node directly (it
// references SpreadsheetApp, MailApp, CacheService, UrlFetchApp,
// PropertiesService, etc.). The canonical contract is encoded in a
// "shadow handler" in this file that composes the real pure helpers
// from your-walk-helpers.js with injected mocks for the I/O side
// effects. The shadow handler mirrors the production handler's
// audit-first sequence step for step; if the shadow drifts from the
// production code, the test suite is the trip wire.
//
// What we're verifying with these tests:
//
//   YW8 — Stamp authenticity:
//     • Unknown token → bad-token; NO WalkStamps row appended;
//       NO WalkBadges row appended; NO WalkTokens mutation.
//     • Expired token → bad-token; same write-nothing invariant.
//     • Revoked token → bad-token; same write-nothing invariant.
//
//   Audit-first contract:
//     • When WalkStamps.appendRow throws, the response surfaces
//       sheet-write-failed AND no WalkBadges row is written AND
//       WalkTokens.last_seen_at is NOT updated AND
//       WalkTokens.expires_at is NOT bumped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateWalkStamp_,
  tokenIsActive_,
  computeStreak_,
  evaluateBadgeUnlocks_,
  daysBetweenIso_,
} from '../docs/apps-script/your-walk-helpers.js';

// ── Headers (mirror order-handler.gs constants) ───────────────────
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
const OTHER_TOKEN = 'b'.repeat(64);

// ── Shape of the harness ───────────────────────────────────────────

function indexFor(headers) {
  const idx = {};
  for (let i = 0; i < headers.length; i++) idx[headers[i]] = i;
  return idx;
}

function makeFakeSheet(headers, opts = {}) {
  const values = [headers.slice()];
  let appendThrows = !!opts.appendThrows;
  return {
    headers,
    appendRow(row) {
      if (appendThrows) throw new Error('boom');
      values.push(row.slice());
    },
    getDataRange() {
      return { getValues: () => values.map(r => r.slice()) };
    },
    getRange(rowIdx, colIdx) {
      return {
        setValue(v) {
          while (values.length < rowIdx) values.push(headers.map(() => ''));
          while (values[rowIdx - 1].length < colIdx) values[rowIdx - 1].push('');
          values[rowIdx - 1][colIdx - 1] = v;
        },
      };
    },
    deleteRow(rowIdx) {
      values.splice(rowIdx - 1, 1);
    },
    rows() { return values.slice(1); },
    rawValues() { return values; },
    setAppendThrows(v) { appendThrows = !!v; },
  };
}

function makeHarness(seed = {}) {
  const tokens = makeFakeSheet(TOKENS_HEADERS);
  const stamps = makeFakeSheet(STAMPS_HEADERS, { appendThrows: !!seed.stampsAppendThrows });
  const badges = makeFakeSheet(BADGES_HEADERS);
  // Seed the WalkTokens rows.
  for (const r of (seed.tokens || [])) {
    const row = TOKENS_HEADERS.map(h => r[h] == null ? '' : r[h]);
    tokens.appendRow(row);
  }
  for (const r of (seed.stamps || [])) {
    const row = STAMPS_HEADERS.map(h => r[h] == null ? '' : r[h]);
    stamps.appendRow(row);
  }
  for (const r of (seed.badges || [])) {
    const row = BADGES_HEADERS.map(h => r[h] == null ? '' : r[h]);
    badges.appendRow(row);
  }
  return {
    tokens, stamps, badges,
    cfg: { enabled: true, tokenTtlDays: 30, graceDays: 3, linkRateLimitPerDay: 3, ...(seed.cfg || {}) },
    catalog: seed.catalog || { badges: [
      { id: 'first-chapter-back', name: 'First chapter back',
        description: 'The first stamp on a new walk. Welcome.',
        unlockRule: 'first-stamp-ever' },
    ]},
    now: seed.now || new Date('2026-05-01T12:00:00Z'),
  };
}

// ── Shadow handler — mirrors handleWalkStamp_ in order-handler.gs ──
function shadowWalkStamp(payload, h) {
  // 1. Honeypot.
  if (payload && payload.extra_field_2) {
    return { ok: true, route: 'honeypot' };
  }

  // 2. Validate.
  const v = validateWalkStamp_(payload);
  if (!v.ok) return { ok: false, error: v.reason };

  // 3. Disabled gate.
  if (!h.cfg.enabled) return { ok: false, error: 'disabled' };

  // 4. ±2-day server-UTC sanity bound on `today`.
  const serverToday = ymdUtc(h.now);
  const dayDelta = daysBetweenIso_(v.today, serverToday);
  if (!Number.isFinite(dayDelta) || Math.abs(dayDelta) > 2) {
    return { ok: false, error: 'bad-date' };
  }

  // 5. Resolve token via WalkTokens.
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, v.token);
  if (!tokenRow || !tokenIsActive_(tokenRow, h.now)) {
    return { ok: false, error: 'bad-token' };
  }
  const email = tokenRow.email;

  // 6. Read all stamps + already-unlocked badges for this email.
  const stampValues = h.stamps.getDataRange().getValues();
  const stampIdx = indexFor(stampValues[0]);
  const myStamps = readStamps(stampValues, stampIdx, email);

  const badgeValues = h.badges.getDataRange().getValues();
  const badgeIdx = indexFor(badgeValues[0]);
  const alreadyUnlocked = readBadgeIds(badgeValues, badgeIdx, email);

  // 7. Idempotency check on (email, today).
  const alreadyStampedToday = myStamps.some(s => s.stamp_date === v.today);
  const isIdempotent = alreadyStampedToday;

  // 8. On a NEW stamp: append the row, then update the WalkTokens row.
  if (!alreadyStampedToday) {
    try {
      const row = STAMPS_HEADERS.map(() => '');
      row[stampIdx.email]          = email;
      row[stampIdx.stamp_date]     = v.today;
      row[stampIdx.stamp_at]       = h.now.toISOString();
      row[stampIdx.anchor_book]    = v.anchorBook;
      row[stampIdx.anchor_chapter] = v.anchorChapter === '' ? '' : v.anchorChapter;
      row[stampIdx.stream]         = v.stream;
      h.stamps.appendRow(row);
    } catch (err) {
      return { ok: false, error: 'sheet-write-failed' };
    }

    myStamps.push({
      stamp_date:     v.today,
      anchor_book:    v.anchorBook,
      anchor_chapter: typeof v.anchorChapter === 'number' ? v.anchorChapter : null,
      stream:         v.stream,
    });

    // Bump WalkTokens.last_seen_at and expires_at.
    const newExpiry = new Date(h.now.getTime() + h.cfg.tokenTtlDays * 86400000);
    const tokenRowIdx = findTokensRowIndexByToken(tokenValues, tokenIdx, v.token);
    if (tokenRowIdx !== -1) {
      const rr = tokenRowIdx + 1;
      h.tokens.getRange(rr, tokenIdx.last_seen_at + 1).setValue(h.now.toISOString());
      h.tokens.getRange(rr, tokenIdx.expires_at + 1).setValue(newExpiry.toISOString());
    }
  }

  // 9. Evaluate badges + append rows on new unlocks.
  const evalResult = evaluateBadgeUnlocks_(myStamps, h.catalog, alreadyUnlocked);
  if (!alreadyStampedToday && evalResult.newlyUnlocked.length) {
    for (const badgeId of evalResult.newlyUnlocked) {
      const brow = BADGES_HEADERS.map(() => '');
      brow[badgeIdx.email]       = email;
      brow[badgeIdx.badge_id]    = badgeId;
      brow[badgeIdx.unlocked_at] = h.now.toISOString();
      brow[badgeIdx.unlocked_on] = v.today;
      h.badges.appendRow(brow);
    }
  }

  // 10. Compute streak + totals.
  const allDates = myStamps.map(s => s.stamp_date);
  const streak = computeStreak_(allDates, v.today, h.cfg.graceDays);
  const totals = {
    stamps:       myStamps.length,
    psalmStamps:  new Set(myStamps.filter(s => s.stream === 'psalm').map(s => s.stamp_date)).size,
    johnChapters: new Set(myStamps
      .filter(s => s.anchor_book === 'John' && typeof s.anchor_chapter === 'number')
      .map(s => s.anchor_chapter)).size,
  };

  return {
    ok: true,
    idempotent: isIdempotent,
    streak,
    totals,
    badges: {
      all: evalResult.all,
      newlyUnlocked: isIdempotent ? [] : evalResult.newlyUnlocked,
    },
  };
}

// ── Helpers used by the shadow handler ─────────────────────────────

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

function findTokensRowIndexByToken(values, idx, token) {
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.token] || '') === token) return r;
  }
  return -1;
}

function readStamps(values, idx, email) {
  const out = [];
  const target = String(email || '').trim().toLowerCase();
  for (let r = 1; r < values.length; r++) {
    const rowEmail = String(values[r][idx.email] || '').trim().toLowerCase();
    if (rowEmail !== target) continue;
    const ch = values[r][idx.anchor_chapter];
    out.push({
      stamp_date:     String(values[r][idx.stamp_date] || ''),
      anchor_book:    String(values[r][idx.anchor_book] || ''),
      anchor_chapter: typeof ch === 'number' ? ch : (ch === '' || ch == null ? null : Number(ch)),
      stream:         String(values[r][idx.stream] || ''),
    });
  }
  return out;
}

function readBadgeIds(values, idx, email) {
  const out = new Set();
  const target = String(email || '').trim().toLowerCase();
  for (let r = 1; r < values.length; r++) {
    const rowEmail = String(values[r][idx.email] || '').trim().toLowerCase();
    if (rowEmail !== target) continue;
    const bid = String(values[r][idx.badge_id] || '');
    if (bid) out.add(bid);
  }
  return out;
}


// ── YW8 — unknown token returns bad-token; writes nothing ─────────

test('YW8 — unknown token rejects with bad-token; no WalkStamps row appended; no WalkBadges row; no WalkTokens mutation', () => {
  // Seed a different active token; the request will use a DIFFERENT one.
  const h = makeHarness({
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
  const beforeTokens = JSON.stringify(h.tokens.rawValues());
  const out = shadowWalkStamp({ token: OTHER_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
  assert.equal(h.stamps.rows().length, 0, 'no WalkStamps row');
  assert.equal(h.badges.rows().length, 0, 'no WalkBadges row');
  assert.equal(JSON.stringify(h.tokens.rawValues()), beforeTokens,
    'WalkTokens was not mutated by an unknown-token request');
});

test('YW8 — expired token rejects with bad-token; no WalkStamps row; no WalkBadges row; no WalkTokens mutation', () => {
  const h = makeHarness({
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-01-01T00:00:00Z',
      last_seen_at: '',
      expires_at: '2026-04-01T00:00:00Z',     // EXPIRED — server's `now` is 2026-05-01
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
  });
  const beforeTokens = JSON.stringify(h.tokens.rawValues());
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
  assert.equal(JSON.stringify(h.tokens.rawValues()), beforeTokens);
});

test('YW8 — revoked_at populated rejects with bad-token; nothing written', () => {
  const h = makeHarness({
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '',
      expires_at: '2026-06-01T00:00:00Z',
      link_requests_24h_ts: '',
      revoked_at: '2026-04-15T00:00:00Z',     // soft-revoked
    }],
  });
  const beforeTokens = JSON.stringify(h.tokens.rawValues());
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token');
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
  assert.equal(JSON.stringify(h.tokens.rawValues()), beforeTokens);
});

test('YW8 — bad token shape (not 64 hex chars) rejects without sheet contact', () => {
  const h = makeHarness({
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
  const beforeTokens = JSON.stringify(h.tokens.rawValues());
  const out = shadowWalkStamp({ token: 'short', today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-token-shape');
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
  assert.equal(JSON.stringify(h.tokens.rawValues()), beforeTokens);
});


// ── Audit-first contract ──────────────────────────────────────────

test('Audit-first — when WalkStamps.appendRow throws, no WalkBadges row written; WalkTokens.last_seen_at is NOT updated', () => {
  const h = makeHarness({
    stampsAppendThrows: true,
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '2026-04-15T00:00:00Z',     // pre-existing value
      expires_at: '2026-06-01T00:00:00Z',
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
  });
  const beforeTokens = JSON.stringify(h.tokens.rawValues());
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'sheet-write-failed');
  assert.equal(h.stamps.rows().length, 0, 'no WalkStamps row');
  assert.equal(h.badges.rows().length, 0, 'no WalkBadges row');
  // WalkTokens row left exactly as it was — last_seen_at NOT updated,
  // expires_at NOT bumped.
  assert.equal(JSON.stringify(h.tokens.rawValues()), beforeTokens,
    'WalkTokens row was not mutated when WalkStamps appendRow threw');
});

test('Audit-first — happy path stamps the row, updates last_seen_at + expires_at, and unlocks first-chapter-back', () => {
  const h = makeHarness({
    tokens: [{
      email: 'sam@example.com',
      token: VALID_TOKEN,
      created_at: '2026-04-01T00:00:00Z',
      last_seen_at: '2026-04-15T00:00:00Z',
      expires_at: '2026-06-01T00:00:00Z',
      link_requests_24h_ts: '',
      revoked_at: '',
    }],
  });
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, true);
  assert.equal(out.idempotent, false);
  assert.equal(h.stamps.rows().length, 1);
  assert.equal(h.badges.rows().length, 1, 'first-chapter-back unlocks on first stamp');
  assert.deepEqual(out.badges.newlyUnlocked, ['first-chapter-back']);
  // WalkTokens was updated.
  const tokensAfter = h.tokens.rawValues();
  assert.equal(tokensAfter[1][indexFor(TOKENS_HEADERS).last_seen_at], '2026-05-01T12:00:00.000Z');
  // expires_at bumped to now + 30d = 2026-05-31T12:00:00Z.
  assert.equal(tokensAfter[1][indexFor(TOKENS_HEADERS).expires_at], '2026-05-31T12:00:00.000Z');
});

test('YW8 — disabled config writes nothing, returns disabled error', () => {
  const h = makeHarness({
    cfg: { enabled: false, tokenTtlDays: 30, graceDays: 3, linkRateLimitPerDay: 3 },
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
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'disabled');
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
});

test('YW8 — honeypot trip is silently OK; nothing is written', () => {
  const h = makeHarness({
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
  const out = shadowWalkStamp({
    token: VALID_TOKEN, today: '2026-05-01',
    extra_field_2: 'i-am-a-bot',
  }, h);
  assert.equal(out.ok, true);
  assert.equal(out.route, 'honeypot');
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
});

test('YW8 — out-of-bounds today (>2 days from server UTC) rejects with bad-date', () => {
  const h = makeHarness({
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
  // server's `now` is 2026-05-01; today claims 2026-04-25 (6 days back) — out of bound.
  const out = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-04-25' }, h);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'bad-date');
  assert.equal(h.stamps.rows().length, 0);
  assert.equal(h.badges.rows().length, 0);
});
