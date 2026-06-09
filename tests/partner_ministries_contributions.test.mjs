// Feature: partner-ministries-rich-profiles, PM3 — Internal-link
// resolution. Walks every rich partner's contributions[].href, filters
// to relative URLs (no scheme; not mailto/tel/#), strips ? and #, and
// asserts each path exists on disk.
//
// Spec: .kiro/specs/partner-ministries-rich-profiles/ (Req 8.3, 14.6,
// mirrors HG5)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RECOS = JSON.parse(fs.readFileSync(path.resolve('assets/data/recommendations.json'), 'utf8'));
const PARTNERS = Array.isArray(RECOS.partners) ? RECOS.partners : [];

function isExternal(href) {
  return /^https?:\/\//i.test(href)
    || href.startsWith('mailto:')
    || href.startsWith('tel:')
    || href.startsWith('javascript:');
}

test('PM3: every rich partner contribution href resolves on disk', () => {
  const missing = [];
  for (const entry of PARTNERS) {
    if (!entry || !Array.isArray(entry.contributions)) continue;
    for (const c of entry.contributions) {
      const raw = (c && c.href || '').trim();
      if (!raw) continue;
      if (raw.startsWith('#')) continue;
      if (isExternal(raw)) continue;
      const clean = raw.split('?')[0].split('#')[0];
      if (!clean) continue;
      const resolved = path.resolve(clean);
      if (!fs.existsSync(resolved)) {
        missing.push({ partner: entry.name, slug: entry.slug, href: raw, resolved });
      }
    }
  }
  assert.equal(missing.length, 0,
    `dead contribution links:\n${JSON.stringify(missing, null, 2)}`);
});
