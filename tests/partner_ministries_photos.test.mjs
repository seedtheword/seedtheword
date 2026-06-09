// Feature: partner-ministries-rich-profiles, PM4 — Image presence.
// Walks every rich partner's photos[], asserts each path begins with
// assets/images/partners/<slug>/ (using the entry's own slug) and
// resolves on disk.
//
// Spec: .kiro/specs/partner-ministries-rich-profiles/ (Req 5.3, 14.7)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RECOS = JSON.parse(fs.readFileSync(path.resolve('assets/data/recommendations.json'), 'utf8'));
const PARTNERS = Array.isArray(RECOS.partners) ? RECOS.partners : [];

test('PM4: every rich partner photo path is under its own slug and exists on disk', () => {
  const issues = [];
  for (const entry of PARTNERS) {
    if (!entry || !entry.slug || !Array.isArray(entry.photos)) continue;
    const expectedPrefix = `assets/images/partners/${entry.slug}/`;
    for (const p of entry.photos) {
      if (typeof p !== 'string' || !p) continue;
      if (!p.startsWith(expectedPrefix)) {
        issues.push({ partner: entry.name, slug: entry.slug, path: p, reason: 'wrong-prefix', expected: expectedPrefix });
        continue;
      }
      const resolved = path.resolve(p);
      if (!fs.existsSync(resolved)) {
        issues.push({ partner: entry.name, slug: entry.slug, path: p, reason: 'missing', resolved });
      }
    }
  }
  assert.equal(issues.length, 0,
    `partner photo issues:\n${JSON.stringify(issues, null, 2)}`);
});
