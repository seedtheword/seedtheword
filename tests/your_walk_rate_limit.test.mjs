// Feature: your-walk-tracker — rate-limit helper (YW7, helper-side)
//
// Tests for findEmailLinkRequestsInWindow_. The handler-side YW7
// (4th-request-in-24h returns rate-limited) lives in
// your_walk_rate_limit_handler.test.mjs once the handler exists; this
// file pins the pure-helper contract that the handler depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  findEmailLinkRequestsInWindow_,
  WALK_LINK_RATE_WINDOW_HOURS,
} from '../docs/apps-script/your-walk-helpers.js';

// Helper — build the kind of `values` array Sheet's getDataRange()
// returns: row 0 is the header, rows 1+ are data. Shape: each row is
// an array of column values matching the header order.
function buildSheet(rows) {
  return [
    ['email', 'token', 'created_at', 'last_seen_at', 'expires_at',
     'link_requests_24h_ts', 'revoked_at'],
    ...rows.map(r => [
      r.email || '',
      r.token || '',
      r.created_at || '',
      r.last_seen_at || '',
      r.expires_at || '',
      Array.isArray(r.timestamps) ? r.timestamps.join(',') : (r.timestamps || ''),
      r.revoked_at || '',
    ]),
  ];
}

const IDX = {
  email: 0, token: 1, created_at: 2, last_seen_at: 3,
  expires_at: 4, link_requests_24h_ts: 5, revoked_at: 6,
};

// Helper — minutes-ago timestamp.
function minutesAgo(now, m) {
  return new Date(now.getTime() - m * 60000).toISOString();
}


// ── Empty / missing input ─────────────────────────────────────────

test('findEmailLinkRequestsInWindow_ — empty values → []', () => {
  const r = findEmailLinkRequestsInWindow_([], IDX, 'a@b.co', 24, new Date());
  assert.deepEqual(r, []);
});

test('findEmailLinkRequestsInWindow_ — header-only values → []', () => {
  const r = findEmailLinkRequestsInWindow_(
    [['email', 'token', 'created_at', 'last_seen_at', 'expires_at', 'link_requests_24h_ts', 'revoked_at']],
    IDX,
    'a@b.co',
    24,
    new Date()
  );
  assert.deepEqual(r, []);
});

test('findEmailLinkRequestsInWindow_ — empty email → []', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([{ email: 'a@b.co', timestamps: [minutesAgo(now, 5)] }]);
  assert.deepEqual(findEmailLinkRequestsInWindow_(sheet, IDX, '', 24, now), []);
  assert.deepEqual(findEmailLinkRequestsInWindow_(sheet, IDX, null, 24, now), []);
});

test('findEmailLinkRequestsInWindow_ — bad idx → []', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([{ email: 'a@b.co', timestamps: [minutesAgo(now, 5)] }]);
  assert.deepEqual(findEmailLinkRequestsInWindow_(sheet, null, 'a@b.co', 24, now), []);
  assert.deepEqual(findEmailLinkRequestsInWindow_(sheet, {}, 'a@b.co', 24, now), []);
});


// ── Filtering by email ────────────────────────────────────────────

test('findEmailLinkRequestsInWindow_ — only target email\'s timestamps are returned', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: [minutesAgo(now, 5), minutesAgo(now, 10)] },
    { email: 'c@d.co', timestamps: [minutesAgo(now, 15), minutesAgo(now, 20)] },
  ]);
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now);
  assert.equal(r.length, 2, 'only a@b.co\'s 2 timestamps');
});

test('findEmailLinkRequestsInWindow_ — email match is case-insensitive', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([
    { email: 'sam@example.com', timestamps: [minutesAgo(now, 5)] },
  ]);
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'SAM@example.com', 24, now);
  assert.equal(r.length, 1);
});


// ── Window cutoff ─────────────────────────────────────────────────

test('findEmailLinkRequestsInWindow_ — entries older than the window are dropped', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: [
      minutesAgo(now, 5),                  // 5 min ago — inside 24h
      minutesAgo(now, 60 * 23),            // 23 hours ago — inside 24h
      minutesAgo(now, 60 * 24 + 1),        // 24h+1min ago — outside
      minutesAgo(now, 60 * 48),            // 2 days ago — outside
    ]},
  ]);
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now);
  assert.equal(r.length, 2);
});

test('findEmailLinkRequestsInWindow_ — entries exactly at the cutoff (== now - window) are included', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const exactlyAtCutoff = new Date(now.getTime() - 24 * 3600000).toISOString();
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: [exactlyAtCutoff] },
  ]);
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now);
  assert.equal(r.length, 1, 'cutoff is inclusive on the floor (>=)');
});


// ── Edge cases on the timestamp string ────────────────────────────

test('findEmailLinkRequestsInWindow_ — empty link_requests_24h_ts cell is skipped', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: '' },        // explicit empty
  ]);
  assert.deepEqual(findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now), []);
});

test('findEmailLinkRequestsInWindow_ — malformed timestamp parts are skipped', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: [minutesAgo(now, 5), 'NOT-A-DATE', minutesAgo(now, 10)] },
  ]);
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now);
  assert.equal(r.length, 2, 'malformed entry is dropped, others survive');
});


// ── Output is sorted ascending ────────────────────────────────────

test('findEmailLinkRequestsInWindow_ — output is sorted ascending by timestamp', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  // Provide them out of order; expect ascending.
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: [
      minutesAgo(now, 30),
      minutesAgo(now, 5),
      minutesAgo(now, 60),
      minutesAgo(now, 15),
    ]},
  ]);
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now);
  for (let i = 1; i < r.length; i++) {
    assert.equal(r[i - 1].getTime() <= r[i].getTime(), true,
      'entry ' + i + ' is at or after entry ' + (i - 1));
  }
});


// ── YW7 (helper-side property) — rate-limit boundary ──────────────

test('YW7 (helper, property) — len < 3 ⇒ allow; len >= 3 ⇒ block', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 6 }),     // # timestamps inside the window
      fc.integer({ min: 0, max: 5 }),     // # timestamps outside the window
      (insideCount, outsideCount) => {
        const now = new Date('2026-05-01T12:00:00Z');
        const insideTs = [];
        for (let i = 0; i < insideCount; i++) {
          // Spread inside the 24h window: 1..23 hours ago.
          insideTs.push(minutesAgo(now, 60 + i * 60));
        }
        const outsideTs = [];
        for (let i = 0; i < outsideCount; i++) {
          // Each well outside the window: 25h..30h ago.
          outsideTs.push(minutesAgo(now, 60 * (25 + i)));
        }
        const sheet = buildSheet([
          { email: 'a@b.co', timestamps: [...insideTs, ...outsideTs] },
        ]);
        const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 24, now);
        // Only the inside-window timestamps should survive.
        if (r.length !== insideCount) return false;
        // Caller's rate-limit decision: r.length >= 3 means rate-limited.
        const wouldBeLimited = r.length >= 3;
        const expected = insideCount >= 3;
        return wouldBeLimited === expected;
      }
    ),
    { numRuns: 200 }
  );
});


// ── Default window constant matches the spec ──────────────────────

test('WALK_LINK_RATE_WINDOW_HOURS === 24', () => {
  assert.equal(WALK_LINK_RATE_WINDOW_HOURS, 24);
});

test('findEmailLinkRequestsInWindow_ — default hours when 0/null provided uses WALK_LINK_RATE_WINDOW_HOURS', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const sheet = buildSheet([
    { email: 'a@b.co', timestamps: [minutesAgo(now, 60)] },     // 1h ago
  ]);
  // Passing 0 should fall back to default (24).
  const r = findEmailLinkRequestsInWindow_(sheet, IDX, 'a@b.co', 0, now);
  assert.equal(r.length, 1, '1h ago is inside the default 24h window');
});
