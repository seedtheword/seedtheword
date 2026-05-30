// Feature: bible-donate-request, BD6 — idempotent resubmit lookup
//
// The Apps Script handler calls findRecentSubmissionFromValues_ with
// the current Bibles snapshot to short-circuit duplicate submissions.
// Tests cover:
//   - returns the most recent matching row inside the window
//   - returns null when outside the window
//   - kind mismatch returns null (donate row does not match receive lookup)
//   - email comparison is case-insensitive
//   - empty inputs don't crash

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findRecentSubmissionFromValues_,
  bibleHeaderIndex_,
} from '../docs/apps-script/bible-donate-helpers.js';

// Minimal headers — only the columns the helper reads.
const HEADERS = [
  'submission_id', 'received_at', 'kind', 'name', 'contact_email',
  'count', 'status',
];
const IDX = bibleHeaderIndex_(HEADERS);

function row(submissionId, receivedAt, kind, email, status) {
  return [submissionId, receivedAt, kind, 'Tester', email, 1, status];
}

const NOW = new Date('2026-05-29T12:00:00Z');
const HOURS_AGO = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const DAYS_AGO = (d) => HOURS_AGO(d * 24);

// ── Inside-window happy paths ─────────────────────────────────
test('BD6 — returns the most recent matching row inside the donate window (1 day)', () => {
  const values = [
    HEADERS,
    row('id-1', DAYS_AGO(2), 'donate', 'sam@example.com', 'fulfilled'),  // outside window
    row('id-2', HOURS_AGO(20), 'donate', 'sam@example.com', 'pending_fulfillment'),
    row('id-3', HOURS_AGO(2), 'donate', 'sam@example.com', 'pending_fulfillment'), // most recent
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.notEqual(r, null);
  assert.equal(r.submissionId, 'id-3');
  assert.equal(r.status, 'pending_fulfillment');
  assert.equal(r.rowIndex, 4);
});

test('BD6 — returns the most recent matching row inside the receive window (7 days)', () => {
  const values = [
    HEADERS,
    row('id-1', DAYS_AGO(10), 'receive', 'maria@example.com', 'declined'), // outside
    row('id-2', DAYS_AGO(5), 'receive', 'maria@example.com', 'approved'),
    row('id-3', DAYS_AGO(1), 'receive', 'maria@example.com', 'pending_review'), // most recent
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'maria@example.com', 'receive', 7, NOW);
  assert.notEqual(r, null);
  assert.equal(r.submissionId, 'id-3');
  assert.equal(r.status, 'pending_review');
});

// ── Outside window ───────────────────────────────────────────
test('BD6 — returns null when the only matching row is outside the window', () => {
  const values = [
    HEADERS,
    row('id-1', DAYS_AGO(2), 'donate', 'sam@example.com', 'fulfilled'),  // 2d ago, window is 1d
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.equal(r, null);
});

// ── Kind mismatch ─────────────────────────────────────────────
test('BD6 — donate-side lookup ignores receive-side rows', () => {
  const values = [
    HEADERS,
    row('id-1', HOURS_AGO(2), 'receive', 'sam@example.com', 'pending_review'),
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.equal(r, null);
});

test('BD6 — receive-side lookup ignores donate-side rows', () => {
  const values = [
    HEADERS,
    row('id-1', HOURS_AGO(2), 'donate', 'sam@example.com', 'fulfilled'),
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'receive', 7, NOW);
  assert.equal(r, null);
});

// ── Email case-insensitivity ─────────────────────────────────
test('BD6 — email comparison is case-insensitive', () => {
  const values = [
    HEADERS,
    row('id-1', HOURS_AGO(2), 'donate', 'Sam@Example.COM', 'pending_fulfillment'),
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.notEqual(r, null);
  assert.equal(r.submissionId, 'id-1');

  const r2 = findRecentSubmissionFromValues_(values, IDX, 'SAM@EXAMPLE.COM', 'donate', 1, NOW);
  assert.notEqual(r2, null);
  assert.equal(r2.submissionId, 'id-1');
});

// ── Email mismatch ────────────────────────────────────────────
test('BD6 — different emails do not match', () => {
  const values = [
    HEADERS,
    row('id-1', HOURS_AGO(2), 'donate', 'sam@example.com', 'pending_fulfillment'),
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'someone-else@example.com', 'donate', 1, NOW);
  assert.equal(r, null);
});

// ── Defensive paths ──────────────────────────────────────────
test('BD6 — empty values returns null (no rows yet)', () => {
  const r = findRecentSubmissionFromValues_([HEADERS], IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.equal(r, null);
});

test('BD6 — null email returns null (caller should never call with empty email anyway)', () => {
  const values = [HEADERS, row('id-1', HOURS_AGO(2), 'donate', 'sam@example.com', 'fulfilled')];
  assert.equal(findRecentSubmissionFromValues_(values, IDX, '', 'donate', 1, NOW), null);
  assert.equal(findRecentSubmissionFromValues_(values, IDX, null, 'donate', 1, NOW), null);
});

test('BD6 — invalid daysWindow returns null', () => {
  const values = [HEADERS, row('id-1', HOURS_AGO(2), 'donate', 'sam@example.com', 'fulfilled')];
  assert.equal(findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 0, NOW), null);
  assert.equal(findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', -1, NOW), null);
});

test('BD6 — malformed received_at row is silently skipped', () => {
  const values = [
    HEADERS,
    row('id-1', 'not-a-date', 'donate', 'sam@example.com', 'fulfilled'),  // bad row
    row('id-2', HOURS_AGO(2), 'donate', 'sam@example.com', 'pending_fulfillment'),
  ];
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.notEqual(r, null);
  assert.equal(r.submissionId, 'id-2');
});

test('BD6 — boundary: row exactly at the window edge is included', () => {
  const exactlyOneDayAgo = new Date(NOW.getTime() - 86400000).toISOString();
  const values = [
    HEADERS,
    row('id-1', exactlyOneDayAgo, 'donate', 'sam@example.com', 'fulfilled'),
  ];
  // The cutoff is inclusive — receivedAt.getTime() < cutoff would exclude,
  // so a row at cutoff IS inside the window.
  const r = findRecentSubmissionFromValues_(values, IDX, 'sam@example.com', 'donate', 1, NOW);
  assert.notEqual(r, null);
});
