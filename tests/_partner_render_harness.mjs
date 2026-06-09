// Test harness: load assets/js/recommendations.js into a jsdom window
// and expose window.renderPartners for the partner-ministries tests.
//
// Spec: .kiro/specs/partner-ministries-rich-profiles/

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const SCRIPT_SRC = fs.readFileSync(path.resolve('assets/js/recommendations.js'), 'utf8');

export function makePartnerRenderEnv() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  // Stub fetch so the DOMContentLoaded auto-init (if it fires) cannot
  // pollute test state. Tests call renderPartners directly with controlled
  // inputs, so they never need the real JSON.
  dom.window.fetch = () => Promise.reject(new Error('fetch disabled in test env'));
  dom.window.eval(SCRIPT_SRC);
  return dom;
}

export function renderInto(dom, partners) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  dom.window.renderPartners(container, partners);
  return container;
}
