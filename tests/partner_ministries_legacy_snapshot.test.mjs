// Feature: partner-ministries-rich-profiles, PM5 — Backwards-compat
// render snapshot + rich dispatch flag.
//
// Spec: .kiro/specs/partner-ministries-rich-profiles/ (Req 10.1, 14.8)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePartnerRenderEnv, renderInto } from './_partner_render_harness.mjs';

const LEGACY_FIXTURE = {
  name: 'Example Friend Ministry',
  url: 'https://example.com',
  logo: 'assets/images/partners/example/logo.png',
  description: 'A short legacy-style description.'
};

const LEGACY_SNAPSHOT =
  '<div class="partners-grid">' +
  '\n      <a class="partner-card glass-morphism" href="https://example.com" target="_blank" rel="noopener">\n' +
  '        <img class="partner-card__logo" src="assets/images/partners/example/logo.png" alt="Example Friend Ministry">\n' +
  '        <h4 class="partner-card__name">Example Friend Ministry</h4>\n' +
  '        <p class="partner-card__desc">A short legacy-style description.</p>\n' +
  '      </a>\n    ' +
  '</div>';

test('PM5: legacy partner entry renders the pinned legacy DOM shape', () => {
  const dom = makePartnerRenderEnv();
  const container = renderInto(dom, [LEGACY_FIXTURE]);
  assert.equal(
    container.innerHTML,
    LEGACY_SNAPSHOT,
    'legacy partner render drifted from the pinned pre-feature shape.\n' +
    'expected:\n' + LEGACY_SNAPSHOT + '\nactual:\n' + container.innerHTML
  );
});

test('PM5: minimal rich partner entry produces an element with class partner-card--rich', () => {
  const dom = makePartnerRenderEnv();
  const container = renderInto(dom, [{
    slug: 'example-rich',
    name: 'Example Rich',
    url: 'https://example.com'
  }]);
  const richEl = container.querySelector('.partner-card--rich');
  assert.ok(richEl, 'rich entry did not produce an element with class partner-card--rich');
  assert.equal(richEl.tagName, 'ARTICLE', 'rich card should be an <article>, not a wrapping <a>');
});
