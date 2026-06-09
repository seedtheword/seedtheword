// Feature: how-to-grow-evangelism-guide, HG4 — Nav Parity.
// Asserts the canonical site nav is byte-equivalent (href + trimmed
// text, in order) between how-to-grow.html and how-to-seed.html.
//
// Spec: .kiro/specs/how-to-grow-evangelism-guide/ (Requirements 10.2,
// 14.7)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

function navEntries(file) {
  const html = fs.readFileSync(path.resolve(file), 'utf8');
  const dom = new JSDOM(html);
  const anchors = dom.window.document.querySelectorAll(
    'nav#site-nav ul.nav-links li a'
  );
  return [...anchors].map((a) => ({
    href: (a.getAttribute('href') || '').trim(),
    text: (a.textContent || '').trim(),
  }));
}

test('HG4: site-nav parity between how-to-grow.html and how-to-seed.html', () => {
  const grow = navEntries('how-to-grow.html');
  const seed = navEntries('how-to-seed.html');
  if (grow.length !== seed.length) {
    assert.fail(
      `nav length mismatch: how-to-grow.html has ${grow.length} entries, ` +
      `how-to-seed.html has ${seed.length} entries.\n` +
      `  grow: ${JSON.stringify(grow)}\n  seed: ${JSON.stringify(seed)}`,
    );
  }
  for (let i = 0; i < grow.length; i++) {
    if (grow[i].href !== seed[i].href || grow[i].text !== seed[i].text) {
      assert.fail(
        `nav entry ${i} differs:\n` +
        `  grow: ${JSON.stringify(grow[i])}\n` +
        `  seed: ${JSON.stringify(seed[i])}`,
      );
    }
  }
  assert.deepEqual(grow, seed);
});
