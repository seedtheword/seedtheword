// Feature: how-to-grow-evangelism-guide, HG2 — Locked Phrases Reachable.
// Asserts the maintainer's verbatim training-notes phrases are visible
// somewhere in the rendered text content of how-to-grow.html.
//
// Spec: .kiro/specs/how-to-grow-evangelism-guide/ (Requirements 5.1,
// 5.2, 14.5)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const HTML = fs.readFileSync(path.resolve('how-to-grow.html'), 'utf8');

const LOCKED_PHRASES = [
  'Bad news then Good News',
  'the parachute',
  'prioritize one idea',
  'identity in Jesus',
  "Mark's gospel",
  'Psalm 50',
  'Psalm 51',
  'young ruler',
  'FBI hostage negotiation',
];

function normalize(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

test('HG2: every Locked_Phrase is reachable in rendered body text', () => {
  const dom = new JSDOM(HTML);
  const haystack = normalize(dom.window.document.body.textContent || '');
  const missing = [];
  for (const phrase of LOCKED_PHRASES) {
    if (!haystack.includes(normalize(phrase))) {
      missing.push(phrase);
    }
  }
  assert.equal(
    missing.length, 0,
    `Locked_Phrase(s) missing from how-to-grow.html body text: ${JSON.stringify(missing)}\n` +
    `These phrases are pinned by Requirement 5.1 and must appear verbatim in visible copy.`,
  );
});
