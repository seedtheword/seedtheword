// Feature: prayer-request-intake, smoke import test
//
// Asserts that every named helper from design §4.13 is exported by
// docs/apps-script/prayer-intake-helpers.js. The Apps Script project
// pastes these functions verbatim into order-handler.gs, so the test
// runner is the only place the ES exports are exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as helpers from '../docs/apps-script/prayer-intake-helpers.js';

const REQUIRED = [
  'mdv2Escape_',
  'buildTelegramMessage_',
  'salutation',
  'pickVersesForSubmission_',
  'computeDripStatus_',
  'stripHtmlAndNormalize_',
  'isLikelyEmail_',
  'parseDripTemplatesPicks_',
  'hashCodeFromString_',
];

test('helpers module exports every required name', () => {
  for (const name of REQUIRED) {
    assert.equal(
      typeof helpers[name], 'function',
      `expected ${name} to be exported as a function`,
    );
  }
});
