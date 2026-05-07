// Feature: browser-admin-editor, Property 2: Form validity gating
//
// For any schema S and form state F, the system SHALL enable the commit
// button iff every `required` field has a non-empty value in F AND every
// declared validator passes its check; otherwise the button SHALL be
// disabled and the inline error rendered.
//
// Because the "commit button enable/disable" and "inline error" renderings
// are DOM-side, this test covers the pure validation contract that drives
// them: `validate(S, F).ok` iff all required fields are populated AND all
// validators pass.
//
// Validates: Requirement 4.6, 4.7

import { test } from 'node:test';
import { assert, forAll, pick, range, genAsciiString } from './harness.mjs';
import { loadModule } from '../assets/js/admin-editor-test-shim.js';

const v = await loadModule('admin-editor-validate');

// A small schema with a mix of required and optional fields in both a
// direct group and a repeating group.
function makeSchema() {
  return {
    groups: [
      {
        fields: [
          { name: 'title', label: 'Title', kind: 'text', required: true },
          { name: 'note', label: 'Note', kind: 'textarea', required: false },
        ],
      },
      {
        name: 'listening',
        label: 'Listening',
        kind: 'repeating-group',
        fields: [
          { name: 'kind', label: 'Kind', kind: 'select', required: true },
          { name: 'id', label: 'ID', kind: 'text', required: true },
          {
            name: 'url',
            label: 'URL',
            kind: 'url',
            required: false,
            validate: (v) => (/^https?:\/\//.test(v) ? null : 'Must be an http(s) URL'),
          },
        ],
      },
    ],
  };
}

// ── Generators ─────────────────────────────────────────────────────────────

function genSchemaFormPair() {
  const schema = makeSchema();
  const listeningCount = range(0, 3);
  const rows = [];
  for (let i = 0; i < listeningCount; i++) {
    rows.push({
      kind: pick(['spotify', 'youtube', '']), // '' triggers required-fail
      id: pick(['abc123', '', genAsciiString(1, 10)]),
      url: pick(['https://example.com', 'not a url', '', 'http://ok']),
    });
  }
  const form = {
    title: pick(['', 'A valid title', genAsciiString(0, 20)]),
    note: pick(['', 'optional', genAsciiString(0, 20)]),
    listening: rows,
  };
  return { schema, form };
}

function isExpectedValid({ schema, form }) {
  // Mirror the schema's rules in test code so we have an independent oracle.
  if (!form.title || String(form.title).trim() === '') return false;
  for (const row of form.listening || []) {
    if (!row.kind || String(row.kind).trim() === '') return false;
    if (!row.id || String(row.id).trim() === '') return false;
    if (row.url && !/^https?:\/\//.test(row.url)) return false;
  }
  return true;
}

// ── Property 2: validate.ok matches the independent oracle ─────────────────

test('Property 2: validate(S, F).ok iff all required filled AND all validators pass', () => {
  forAll(genSchemaFormPair, (pair) => {
    const got = v.validate(pair.schema, pair.form).ok;
    const want = isExpectedValid(pair);
    assert.equal(
      got,
      want,
      `validate disagreed with oracle for ${JSON.stringify(pair.form)}`
    );
  });
});

// ── Example tests ──────────────────────────────────────────────────────────

test('validate flags a missing required top-level field by name', () => {
  const schema = makeSchema();
  const result = v.validate(schema, { title: '', listening: [] });
  assert.equal(result.ok, false);
  assert.match(result.errors.title, /required/i);
});

test('validate flags a failing per-field validator with the custom message', () => {
  const schema = makeSchema();
  const result = v.validate(schema, {
    title: 'ok',
    listening: [{ kind: 'spotify', id: 'x', url: 'not a url' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors['listening[0].url'], 'Must be an http(s) URL');
});

test('validate treats an empty optional field as fine', () => {
  const schema = makeSchema();
  const result = v.validate(schema, {
    title: 'ok',
    note: '',
    listening: [{ kind: 'spotify', id: 'x', url: '' }],
  });
  assert.equal(result.ok, true);
});

test('validate runs the schema-level validator and reports top-level errors', () => {
  const schema = {
    ...makeSchema(),
    validate: (d) => (d.listening && d.listening.length > 2 ? 'Too many listens' : null),
  };
  const result = v.validate(schema, {
    title: 'ok',
    listening: [
      { kind: 'a', id: '1' },
      { kind: 'b', id: '2' },
      { kind: 'c', id: '3' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.__root__, 'Too many listens');
});

test('isValid returns true for a fully-filled, valid form', () => {
  const schema = makeSchema();
  assert.equal(
    v.isValid(schema, {
      title: 'ok',
      listening: [{ kind: 'spotify', id: 'x' }],
    }),
    true
  );
});
