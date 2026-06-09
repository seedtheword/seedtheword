// Feature: how-to-grow-evangelism-guide, HG3 — Reciprocal Cross-Link.
// Asserts each how-to page links to the other at least once in body.
//
// Spec: .kiro/specs/how-to-grow-evangelism-guide/ (Requirements 11.1,
// 11.2, 14.6)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

function bodyHrefs(file) {
  const html = fs.readFileSync(path.resolve(file), 'utf8');
  const dom = new JSDOM(html);
  return [...dom.window.document.body.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href') || '')
    .map((h) => h.split('?')[0].split('#')[0]);
}

test('HG3: how-to-grow.html links to how-to-seed.html', () => {
  const hrefs = bodyHrefs('how-to-grow.html');
  assert.ok(
    hrefs.includes('how-to-seed.html'),
    `how-to-grow.html has no <a href="how-to-seed.html"> in body. ` +
    `Requirement 11.1 requires at least one. Found hrefs: ${JSON.stringify(hrefs)}`,
  );
});

test('HG3: how-to-seed.html links to how-to-grow.html', () => {
  const hrefs = bodyHrefs('how-to-seed.html');
  assert.ok(
    hrefs.includes('how-to-grow.html'),
    `how-to-seed.html has no <a href="how-to-grow.html"> in body. ` +
    `Requirement 11.2 requires at least one. Found hrefs: ${JSON.stringify(hrefs)}`,
  );
});
