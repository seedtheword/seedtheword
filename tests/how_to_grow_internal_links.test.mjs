// Feature: how-to-grow-evangelism-guide, HG5 — Internal Links Resolve.
// Walks every internal <a href> in how-to-grow.html and asserts the
// resolved on-disk path exists. Catches cross-link typos and dead
// references in copy edits.
//
// Spec: .kiro/specs/how-to-grow-evangelism-guide/ (Requirements 14.8)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const HTML = fs.readFileSync(path.resolve('how-to-grow.html'), 'utf8');

function isExternal(href) {
  return /^https?:\/\//i.test(href)
    || href.startsWith('mailto:')
    || href.startsWith('tel:')
    || href.startsWith('javascript:');
}

test('HG5: every internal <a href> in how-to-grow.html resolves on disk', () => {
  const dom = new JSDOM(HTML);
  const anchors = [...dom.window.document.body.querySelectorAll('a[href]')];
  const missing = [];

  for (const a of anchors) {
    const raw = (a.getAttribute('href') || '').trim();
    if (!raw) continue;                  // skip empty
    if (raw.startsWith('#')) continue;    // pure anchor
    if (isExternal(raw)) continue;        // external scheme

    // Strip query string and fragment.
    const clean = raw.split('?')[0].split('#')[0];
    if (!clean) continue;                 // e.g. "?foo" alone

    // Resolve relative to repo root.
    const resolved = path.resolve(clean);
    if (!fs.existsSync(resolved)) {
      missing.push({ href: raw, resolved });
    }
  }

  assert.equal(
    missing.length, 0,
    `dead internal links in how-to-grow.html: ${JSON.stringify(missing, null, 2)}`,
  );
});
