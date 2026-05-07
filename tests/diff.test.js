// Feature: browser-admin-editor, Property 5: Diff engine correctness
//
// For any pair of strings `before` and `after`, applying the diff produced by
// `diffLines(before, after)` to `before` SHALL produce `after`. Equivalently:
// applyUnified(before, formatUnified(diffLines(before, after))) === after
//
// Additionally, for any string `s`, diffLines(s, s) SHALL produce the empty
// change set.
//
// Validates: Requirement 7.1, 7.2, 7.3

import { test } from 'node:test';
import { assert, forAll, genLineString, pick, range } from './harness.mjs';
import { loadModule } from '../assets/js/admin-editor-test-shim.js';

const diff = await loadModule('admin-editor-diff');

// ── Generators ─────────────────────────────────────────────────────────────

function genStringPair() {
  // Mix of: identical pairs, totally different pairs, edit-distance-1 pairs,
  // pairs with inserts, pairs with deletes, empty edge cases.
  const pattern = pick(['identical', 'random', 'edit1', 'insert', 'delete', 'empty']);
  const before = genLineString(0, 12);
  switch (pattern) {
    case 'identical':
      return { before, after: before };
    case 'random':
      return { before, after: genLineString(0, 12) };
    case 'edit1': {
      const lines = before.split('\n');
      if (lines.length === 0) return { before, after: 'X' };
      const idx = range(0, lines.length - 1);
      const edited = [...lines];
      edited[idx] = edited[idx] + ' EDITED';
      return { before, after: edited.join('\n') };
    }
    case 'insert': {
      const lines = before.split('\n');
      const idx = range(0, lines.length);
      const inserted = [...lines.slice(0, idx), 'NEW LINE', ...lines.slice(idx)];
      return { before, after: inserted.join('\n') };
    }
    case 'delete': {
      const lines = before.split('\n');
      if (lines.length < 2) return { before, after: '' };
      const idx = range(0, lines.length - 1);
      const removed = [...lines.slice(0, idx), ...lines.slice(idx + 1)];
      return { before, after: removed.join('\n') };
    }
    case 'empty':
      return pick([
        { before: '', after: '' },
        { before: '', after: 'only after\nhas\ncontent' },
        { before: 'only before\nhas\ncontent', after: '' },
      ]);
    default:
      return { before, after: before };
  }
}

// ── Property 5 ─────────────────────────────────────────────────────────────

test('Property 5a: apply(format(diff(before, after))) === after', () => {
  forAll(genStringPair, ({ before, after }) => {
    const changes = diff.diffLines(before, after);
    const unified = diff.formatUnified(changes);
    const roundTrip = diff.applyUnified(before, unified);
    assert.equal(
      roundTrip,
      after,
      `round-trip diff/apply failed.\nbefore:\n${before}\n\nafter:\n${after}\n\nunified:\n${unified}\n\ngot:\n${roundTrip}`
    );
  });
});

test('Property 5b: diffLines(s, s) produces an empty change set', () => {
  forAll(
    () => genLineString(0, 12),
    (s) => {
      const changes = diff.diffLines(s, s);
      assert.ok(
        isEmptyChangeSet(changes),
        `expected empty change set for identical strings, got: ${JSON.stringify(changes)}`
      );
    }
  );
});

// A "change set" is an Array of { kind: 'equal'|'add'|'remove', line: string }.
// "Empty" in the Property 5 sense means no adds or removes — only equals (or
// literally no entries when both sides are empty).
function isEmptyChangeSet(changes) {
  if (!Array.isArray(changes)) return false;
  return changes.every((c) => c.kind === 'equal');
}

// ── Example tests ──────────────────────────────────────────────────────────

test('diffLines on identical non-empty strings returns only equals', () => {
  const changes = diff.diffLines('a\nb\nc', 'a\nb\nc');
  assert.ok(changes.every((c) => c.kind === 'equal'));
  assert.equal(changes.length, 3);
});

test('diffLines detects a single-line edit as one remove + one add', () => {
  const changes = diff.diffLines('a\nb\nc', 'a\nB\nc');
  const adds = changes.filter((c) => c.kind === 'add').map((c) => c.line);
  const removes = changes.filter((c) => c.kind === 'remove').map((c) => c.line);
  assert.deepEqual(adds, ['B']);
  assert.deepEqual(removes, ['b']);
});

test('formatUnified and applyUnified round-trip on a known small example', () => {
  const before = 'one\ntwo\nthree';
  const after = 'one\nTWO\nthree\nfour';
  const unified = diff.formatUnified(diff.diffLines(before, after));
  assert.equal(diff.applyUnified(before, unified), after);
});
