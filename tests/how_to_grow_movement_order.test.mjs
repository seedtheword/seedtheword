// Feature: how-to-grow-evangelism-guide, HG1 — Movement Order.
// Asserts the four locked movements appear in DOM order and there is
// no fifth, and each carries a non-empty heading.
//
// Spec: .kiro/specs/how-to-grow-evangelism-guide/ (Requirements 2.1,
// 2.2, 2.3, 2.5, 14.4)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const HTML = fs.readFileSync(path.resolve('how-to-grow.html'), 'utf8');
const EXPECTED_ORDER = ['reconnaissance', 'law', 'gospel', 'action'];

test('HG1: how-to-grow.html has exactly four .lg-movement sections in locked order', () => {
  const dom = new JSDOM(HTML);
  const sections = [...dom.window.document.querySelectorAll('section.lg-movement')];
  assert.equal(
    sections.length, 4,
    `expected exactly 4 .lg-movement sections, found ${sections.length}. ` +
    `A fifth movement is forbidden by Requirement 2.5.`,
  );
  const ids = sections.map((s) => s.id);
  assert.deepEqual(
    ids, EXPECTED_ORDER,
    `movement order mismatch.\n  expected: ${JSON.stringify(EXPECTED_ORDER)}\n  actual:   ${JSON.stringify(ids)}`,
  );
});

test('HG1: each movement section has a non-empty h2.lg-movement__title', () => {
  const dom = new JSDOM(HTML);
  const sections = [...dom.window.document.querySelectorAll('section.lg-movement')];
  for (const section of sections) {
    const title = section.querySelector('h2.lg-movement__title');
    assert.ok(title, `section #${section.id} missing h2.lg-movement__title`);
    assert.ok(
      title.textContent.trim().length > 0,
      `section #${section.id} has an empty h2.lg-movement__title`,
    );
  }
});
