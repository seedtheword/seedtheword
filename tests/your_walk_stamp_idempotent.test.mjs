// Feature: your-walk-tracker — YW1 idempotent stamp
//
// **Validates: Requirements YW1**
//
// Stamping the same (email, today) twice yields:
//   • the second response has idempotent: true
//   • no second row is appended to WalkStamps
//   • the second response's streak / totals / badges.all deep-equal
//     the first response's
//   • the second response's badges.newlyUnlocked is [] regardless of
//     what the first response surfaced
//
// Plus a fast-check generator over arbitrary stamp histories with a
// duplicated date inserted at random positions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  validateWalkStamp_,
  tokenIsActive_,
  computeStreak_,
  evaluateBadgeUnlocks_,
  daysBetweenIso_,
} from '../docs/apps-script/your-walk-helpers.js';

// Catalog used by the shadow — production catalog minus the
// faithful-in-small-things rule (which needs a 4-week stretch we
// don't bother to construct in these tests).
const CATALOG = { badges: [
  { id: 'first-chapter-back', name: 'First chapter back',
    description: 'The first stamp on a new walk. Welcome.',
    unlockRule: 'first-stamp-ever' },
  { id: 'walked-through-john', name: 'Walked through the Gospel of John',
    description: 'Twenty-one chapters.',
    unlockRule: 'twenty-one-john-chapters' },
  { id: 'psalmists-30-days', name: 'Sat with the Psalmists for 30 days',
    description: 'Thirty psalm stamps.',
    unlockRule: 'thirty-psalm-stamps' },
  { id: '30-day-walk', name: '30-day walk',
    description: 'Thirty-day longest streak.',
    unlockRule: 'thirty-day-streak' },
]};

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
      return {
        setValue(v) {
          values[rowIdx - 1][colIdx - 1] = v;
        },
      };
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
    const row = TOKENS_HEADERS.map(h => r[h] == null ? '' : r[h]);
    tokens.appendRow(row);
  }
  return {
    tokens, stamps, badges,
    cfg: { enabled: true, tokenTtlDays: 30, graceDays: 3, ...(seed.cfg || {}) },
    catalog: seed.catalog || CATALOG,
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

// Shadow walkStamp handler. Mirror of handleWalkStamp_.
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
  const email = tokenRow.email;

  const stampValues = h.stamps.getDataRange().getValues();
  const stampIdx = indexFor(stampValues[0]);
  const myStamps = readStamps(stampValues, stampIdx, email);

  const badgeValues = h.badges.getDataRange().getValues();
  const badgeIdx = indexFor(badgeValues[0]);
  const alreadyUnlocked = readBadgeIds(badgeValues, badgeIdx, email);

  const alreadyStampedToday = myStamps.some(s => s.stamp_date === v.today);
  const isIdempotent = alreadyStampedToday;

  if (!alreadyStampedToday) {
    const row = STAMPS_HEADERS.map(() => '');
    row[stampIdx.email]          = email;
    row[stampIdx.stamp_date]     = v.today;
    row[stampIdx.stamp_at]       = h.now.toISOString();
    row[stampIdx.anchor_book]    = v.anchorBook;
    row[stampIdx.anchor_chapter] = v.anchorChapter === '' ? '' : v.anchorChapter;
    row[stampIdx.stream]         = v.stream;
    h.stamps.appendRow(row);
    myStamps.push({
      stamp_date:     v.today,
      anchor_book:    v.anchorBook,
      anchor_chapter: typeof v.anchorChapter === 'number' ? v.anchorChapter : null,
      stream:         v.stream,
    });
    const newExpiry = new Date(h.now.getTime() + h.cfg.tokenTtlDays * 86400000);
    const tokenRowIdx = findTokensRowIndexByToken(tokenValues, tokenIdx, v.token);
    if (tokenRowIdx !== -1) {
      const rr = tokenRowIdx + 1;
      h.tokens.getRange(rr, tokenIdx.last_seen_at + 1).setValue(h.now.toISOString());
      h.tokens.getRange(rr, tokenIdx.expires_at + 1).setValue(newExpiry.toISOString());
    }
  }

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

// ── Helpers for tests ─────────────────────────────────────────────

const VALID_TOKEN = 'a'.repeat(64);

function freshHarness() {
  return makeHarness({
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
}

function addDays(iso, n) {
  const p = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}


// ── YW1 — explicit examples ───────────────────────────────────────

test('YW1 — second stamp same (email, today) returns idempotent: true with no extra row', () => {
  const h = freshHarness();
  const out1 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out1.ok, true);
  assert.equal(out1.idempotent, false);
  assert.equal(h.stamps.rows().length, 1);

  const out2 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out2.ok, true);
  assert.equal(out2.idempotent, true);
  assert.equal(h.stamps.rows().length, 1, 'no second row appended');

  // streak / totals / badges.all deep-equal between the two responses.
  assert.deepEqual(out2.streak, out1.streak);
  assert.deepEqual(out2.totals, out1.totals);
  assert.deepEqual([...out2.badges.all].sort(), [...out1.badges.all].sort());
  // Critical: idempotent re-stamp must NOT re-fire celebration.
  assert.deepEqual(out2.badges.newlyUnlocked, []);
});

test('YW1 — first stamp surfaces newlyUnlocked: ["first-chapter-back"]; second stamp on same day surfaces []', () => {
  const h = freshHarness();
  const out1 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.deepEqual(out1.badges.newlyUnlocked, ['first-chapter-back']);
  const out2 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.deepEqual(out2.badges.newlyUnlocked, [],
    'YW5 invariant — celebration never re-fires for the same day');
  assert.deepEqual(out2.badges.all, out1.badges.all);
});

test('YW1 — third stamp same day still idempotent and still no extra rows', () => {
  const h = freshHarness();
  shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  const out3 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out3.idempotent, true);
  assert.equal(h.stamps.rows().length, 1);
  assert.equal(h.badges.rows().length, 1);
});

test('YW1 — stamping different days both succeed, neither idempotent, two rows appended', () => {
  const h = freshHarness();
  // Move now to 2026-05-01.
  h.now = new Date('2026-05-01T12:00:00Z');
  const out1 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-01' }, h);
  assert.equal(out1.idempotent, false);

  // Move now to 2026-05-02.
  h.now = new Date('2026-05-02T12:00:00Z');
  const out2 = shadowWalkStamp({ token: VALID_TOKEN, today: '2026-05-02' }, h);
  assert.equal(out2.idempotent, false);
  assert.equal(out2.streak.current, 2);
  assert.equal(h.stamps.rows().length, 2);
});


// ── YW1 — fast-check generator over arbitrary histories ───────────

test('YW1 (property) — re-stamping the duplicated date yields idempotent:true and same streak/totals/badges.all', () => {
  fc.assert(
    fc.property(
      // A small sequence of distinct day-offsets (so no duplicates from
      // the generator itself) plus an index into the sequence to pick
      // which date to "re-stamp".
      fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 12 })
        .map(arr => Array.from(new Set(arr)).sort((a, b) => a - b)),
      fc.integer({ min: 0, max: 999 }),
      (offsets, dupSeed) => {
        if (offsets.length === 0) return true;
        const baseDate = '2026-05-01';
        const h = makeHarness({
          tokens: [{
            email: 'sam@example.com',
            token: VALID_TOKEN,
            created_at: '2026-04-01T00:00:00Z',
            last_seen_at: '',
            expires_at: '2027-01-01T00:00:00Z',
            link_requests_24h_ts: '',
            revoked_at: '',
          }],
        });
        // Replay every offset as a stamp.
        for (const off of offsets) {
          const day = addDays(baseDate, off);
          h.now = new Date(day + 'T12:00:00Z');
          const r = shadowWalkStamp({ token: VALID_TOKEN, today: day }, h);
          if (!r.ok) return false;
        }
        // Pick a date to re-stamp; capture the state before.
        const dupOffset = offsets[dupSeed % offsets.length];
        const dupDay = addDays(baseDate, dupOffset);
        h.now = new Date(dupDay + 'T12:00:00Z');
        const before = shadowWalkSync(h, VALID_TOKEN);
        // Re-stamp the same day.
        const after = shadowWalkStamp({ token: VALID_TOKEN, today: dupDay }, h);
        // The idempotent contract:
        if (after.idempotent !== true) return false;
        if (after.badges.newlyUnlocked.length !== 0) return false;
        if (h.stamps.rows().length !== offsets.length) return false;
        // streak / totals / badges.all should match the pre-re-stamp state.
        if (JSON.stringify(after.streak) !== JSON.stringify(before.streak)) return false;
        if (JSON.stringify(after.totals) !== JSON.stringify(before.totals)) return false;
        if (JSON.stringify([...after.badges.all].sort())
          !== JSON.stringify([...before.badges.all].sort())) return false;
        return true;
      }
    ),
    { numRuns: 100 }
  );
});

// Helper — read-only "sync" snapshot used by the property test.
function shadowWalkSync(h, token) {
  const tokenValues = h.tokens.getDataRange().getValues();
  const tokenIdx = indexFor(tokenValues[0]);
  const tokenRow = findTokensRowObject(tokenValues, tokenIdx, token);
  const email = tokenRow.email;
  const stampValues = h.stamps.getDataRange().getValues();
  const stampIdx = indexFor(stampValues[0]);
  const myStamps = readStamps(stampValues, stampIdx, email);
  const badgeValues = h.badges.getDataRange().getValues();
  const badgeIdx = indexFor(badgeValues[0]);
  const alreadyUnlocked = readBadgeIds(badgeValues, badgeIdx, email);
  const today = ymdUtc(h.now);
  const allDates = myStamps.map(s => s.stamp_date);
  const streak = computeStreak_(allDates, today, h.cfg.graceDays);
  const totals = {
    stamps:       myStamps.length,
    psalmStamps:  new Set(myStamps.filter(s => s.stream === 'psalm').map(s => s.stamp_date)).size,
    johnChapters: new Set(myStamps
      .filter(s => s.anchor_book === 'John' && typeof s.anchor_chapter === 'number')
      .map(s => s.anchor_chapter)).size,
  };
  const evalResult = evaluateBadgeUnlocks_(myStamps, h.catalog, alreadyUnlocked);
  return { streak, totals, badges: { all: evalResult.all } };
}
