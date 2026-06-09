// Feature: partner-ministries-rich-profiles, PM2 — Slug uniqueness and
// pattern. Walks partners[], collects every present slug, asserts each
// matches the regex and is unique. Legacy entries (no slug) are skipped.
//
// Spec: .kiro/specs/partner-ministries-rich-profiles/ (Req 3.2, 14.5)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RECOS = JSON.parse(fs.readFileSync(path.resolve('assets/data/recommendations.json'), 'utf8'));
const PARTNERS = Array.isArray(RECOS.partners) ? RECOS.partners : [];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

test('PM2: every partner slug matches ^[a-z0-9][a-z0-9-]{1,40}$', () => {
  const bad = [];
  for (const entry of PARTNERS) {
    if (!entry || typeof entry.slug !== 'string') continue;
    if (!SLUG_RE.test(entry.slug)) {
      bad.push({ name: entry.name, slug: entry.slug });
    }
  }
  assert.equal(bad.length, 0,
    `slug pattern violations:\n${JSON.stringify(bad, null, 2)}\n` +
    `Slugs must match ^[a-z0-9][a-z0-9-]{1,40}$ (kebab-case, no leading dash, ≤ 41 chars).`);
});

test('PM2: partner slugs are unique across partners[]', () => {
  const seen = new Map();
  const dupes = [];
  for (const entry of PARTNERS) {
    if (!entry || typeof entry.slug !== 'string' || !entry.slug) continue;
    if (seen.has(entry.slug)) dupes.push({ slug: entry.slug, names: [seen.get(entry.slug), entry.name] });
    else seen.set(entry.slug, entry.name);
  }
  assert.equal(dupes.length, 0,
    `duplicate slugs:\n${JSON.stringify(dupes, null, 2)}\nEach rich partner needs its own slug.`);
});
