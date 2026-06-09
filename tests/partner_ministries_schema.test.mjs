// Feature: partner-ministries-rich-profiles, PM1 — Schema validation /
// non-throwing render. Loads recommendations.json, walks every entry in
// partners[], renders each through window.renderPartners against a jsdom
// document, asserts no throw, container non-empty, no "undefined" in
// textContent or innerHTML.
//
// Spec: .kiro/specs/partner-ministries-rich-profiles/ (Req 14.4, 10.4)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePartnerRenderEnv, renderInto } from './_partner_render_harness.mjs';

const RECOS = JSON.parse(fs.readFileSync(path.resolve('assets/data/recommendations.json'), 'utf8'));
const PARTNERS = Array.isArray(RECOS.partners) ? RECOS.partners : [];

test('PM1: every partners[] entry renders without throwing or producing "undefined"', () => {
  const dom = makePartnerRenderEnv();

  for (const entry of PARTNERS) {
    const label = entry?.name || entry?.slug || '<unnamed entry>';
    let container;
    assert.doesNotThrow(
      () => { container = renderInto(dom, [entry]); },
      `renderPartners threw for entry: ${label}`
    );
    const text = container.textContent || '';
    const html = container.innerHTML || '';
    assert.ok(html.length > 0, `empty render for entry: ${label}`);
    assert.ok(!text.includes('undefined'),
      `entry ${label} produced "undefined" in textContent. Likely an unguarded interpolation.`);
    assert.ok(!html.includes('="undefined"'),
      `entry ${label} produced ="undefined" attribute. Likely an unguarded escapeAttr call.`);
  }
});
