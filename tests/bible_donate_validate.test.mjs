// Feature: bible-donate-request, validators (BD3 — story gate is the only required filter)
//
// Tests both validators across happy/error paths, with explicit
// boundary tests on the story length gate. Validators are pure — no
// I/O — so we use plain example tests + a couple of fast-check
// properties for the boundary regions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  validateBibleDonate_,
  validateBibleRequest_,
  BIBLE_STORY_MIN_CHARS,
  BIBLE_STORY_MAX_CHARS,
  BIBLE_DONOR_NOTE_MAX_CHARS,
  BIBLE_COUNT_MIN,
  BIBLE_COUNT_MAX,
} from '../docs/apps-script/bible-donate-helpers.js';

// ── Donate validator — happy path ─────────────────────────────
test('validateBibleDonate_ — accepts a minimal valid donate payload', () => {
  const out = validateBibleDonate_({
    name: 'Sam',
    email: 'sam@example.com',
    count: 1,
    handoffMethod: 'dropoff',
  });
  assert.equal(out.ok, true);
  assert.equal(out.name, 'Sam');
  assert.equal(out.count, 1);
  assert.equal(out.handoffMethod, 'dropoff');
});

test('validateBibleDonate_ — accepts phone-only contact (no email)', () => {
  const out = validateBibleDonate_({
    name: 'Sam',
    phone: '555-1234',
    count: 5,
    handoffMethod: 'pickup',
  });
  assert.equal(out.ok, true);
  assert.equal(out.email, '');
  assert.equal(out.phone, '555-1234');
});

test('validateBibleDonate_ — strips HTML from note', () => {
  const out = validateBibleDonate_({
    name: 'Sam',
    email: 'sam@example.com',
    count: 1,
    handoffMethod: 'dropoff',
    note: 'Hello <script>alert(1)</script> world',
  });
  assert.equal(out.ok, true);
  assert.equal(out.note, 'Hello  world');
});

test('validateBibleDonate_ — uppercases and slices state to two letters', () => {
  const out = validateBibleDonate_({
    name: 'Sam', email: 'a@b.co', count: 1, handoffMethod: 'dropoff',
    state: 'washington',
  });
  assert.equal(out.ok, true);
  assert.equal(out.state, 'WA');
});

test('validateBibleDonate_ — accepts numeric count as string ("3")', () => {
  const out = validateBibleDonate_({
    name: 'Sam', email: 'a@b.co', count: '3', handoffMethod: 'dropoff',
  });
  assert.equal(out.ok, true);
  assert.equal(out.count, 3);
});

// ── Donate validator — error paths ────────────────────────────
test('validateBibleDonate_ — rejects empty payload', () => {
  assert.deepEqual(validateBibleDonate_({}), { ok: false, reason: 'name-required' });
  assert.deepEqual(validateBibleDonate_(null), { ok: false, reason: 'not-object' });
  assert.deepEqual(validateBibleDonate_(undefined), { ok: false, reason: 'not-object' });
});

test('validateBibleDonate_ — rejects missing contact (no email AND no phone)', () => {
  const out = validateBibleDonate_({
    name: 'Sam', count: 1, handoffMethod: 'dropoff',
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'contact-required');
});

test('validateBibleDonate_ — rejects malformed email', () => {
  const out = validateBibleDonate_({
    name: 'Sam', email: 'not-an-email', count: 1, handoffMethod: 'dropoff',
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad-email');
});

test('validateBibleDonate_ — rejects bad count values', () => {
  for (const bad of [0, -1, 501, 1000, 'abc', null, undefined]) {
    const out = validateBibleDonate_({
      name: 'Sam', email: 'a@b.co', count: bad, handoffMethod: 'dropoff',
    });
    assert.equal(out.ok, false, 'count=' + JSON.stringify(bad));
    assert.equal(out.reason, 'bad-count');
  }
});

test('validateBibleDonate_ — accepts count at exact boundaries', () => {
  for (const good of [BIBLE_COUNT_MIN, BIBLE_COUNT_MAX]) {
    const out = validateBibleDonate_({
      name: 'Sam', email: 'a@b.co', count: good, handoffMethod: 'dropoff',
    });
    assert.equal(out.ok, true, 'count=' + good);
  }
});

test('validateBibleDonate_ — rejects bad handoff method', () => {
  for (const bad of ['', 'mail', 'shipping', 'foo']) {
    const out = validateBibleDonate_({
      name: 'Sam', email: 'a@b.co', count: 1, handoffMethod: bad,
    });
    assert.equal(out.ok, false, 'handoffMethod=' + JSON.stringify(bad));
    assert.equal(out.reason, 'bad-handoff');
  }
});

test('validateBibleDonate_ — rejects oversize note', () => {
  const out = validateBibleDonate_({
    name: 'Sam', email: 'a@b.co', count: 1, handoffMethod: 'dropoff',
    note: 'a'.repeat(BIBLE_DONOR_NOTE_MAX_CHARS + 1),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'note-too-long');
});

// ── Receive validator — happy path ────────────────────────────
test('validateBibleRequest_ — accepts a minimal valid receive payload', () => {
  const story = 'I just moved into a new apartment in Everett and lost my old Bible during the move. I would love to get back into reading scripture.';
  const out = validateBibleRequest_({
    name: 'Maria',
    email: 'maria@example.com',
    city: 'Everett',
    story: story,
  });
  assert.equal(out.ok, true);
  assert.equal(out.story.length >= BIBLE_STORY_MIN_CHARS, true);
});

test('validateBibleRequest_ — strips HTML from story', () => {
  const innerStory = 'Bible reading has been a part of my life since childhood, and I want to start again after a long pause that I now regret.';
  const out = validateBibleRequest_({
    name: 'Maria', email: 'm@example.com', city: 'Everett',
    story: '<p>' + innerStory + '</p>',
  });
  assert.equal(out.ok, true);
  assert.equal(out.story, innerStory);
});

// ── Receive validator — error paths ───────────────────────────
test('validateBibleRequest_ — rejects empty payload', () => {
  assert.deepEqual(validateBibleRequest_({}), { ok: false, reason: 'name-required' });
});

test('validateBibleRequest_ — rejects missing email', () => {
  const out = validateBibleRequest_({
    name: 'Maria', city: 'Everett', story: 'a'.repeat(BIBLE_STORY_MIN_CHARS),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'email-required');
});

test('validateBibleRequest_ — rejects malformed email', () => {
  const out = validateBibleRequest_({
    name: 'Maria', email: 'not-an-email', city: 'Everett',
    story: 'a'.repeat(BIBLE_STORY_MIN_CHARS),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad-email');
});

test('validateBibleRequest_ — rejects missing city', () => {
  const out = validateBibleRequest_({
    name: 'Maria', email: 'm@example.com',
    story: 'a'.repeat(BIBLE_STORY_MIN_CHARS),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'city-required');
});

// ── BD3: story length boundary tests (the central security gate) ─
test('BD3 — story at MIN-1 chars rejects', () => {
  const out = validateBibleRequest_({
    name: 'Maria', email: 'm@example.com', city: 'Everett',
    story: 'a'.repeat(BIBLE_STORY_MIN_CHARS - 1),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'story-too-short');
});

test('BD3 — story at exact MIN chars accepts', () => {
  const out = validateBibleRequest_({
    name: 'Maria', email: 'm@example.com', city: 'Everett',
    story: 'a'.repeat(BIBLE_STORY_MIN_CHARS),
  });
  assert.equal(out.ok, true);
  assert.equal(out.story.length, BIBLE_STORY_MIN_CHARS);
});

test('BD3 — story at exact MAX chars accepts', () => {
  const out = validateBibleRequest_({
    name: 'Maria', email: 'm@example.com', city: 'Everett',
    story: 'a'.repeat(BIBLE_STORY_MAX_CHARS),
  });
  assert.equal(out.ok, true);
  assert.equal(out.story.length, BIBLE_STORY_MAX_CHARS);
});

test('BD3 — story at MAX+1 chars rejects', () => {
  const out = validateBibleRequest_({
    name: 'Maria', email: 'm@example.com', city: 'Everett',
    story: 'a'.repeat(BIBLE_STORY_MAX_CHARS + 1),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'story-too-long');
});

// ── BD3 property: any payload missing a required field rejects ───
test('BD3 — receive validator rejects when ANY required field is empty (property)', () => {
  const validStory = 'a'.repeat(BIBLE_STORY_MIN_CHARS);
  const required = ['name', 'email', 'city', 'story'];
  fc.assert(fc.property(
    fc.constantFrom(...required),
    (drop) => {
      const base = {
        name: 'Maria',
        email: 'm@example.com',
        city: 'Everett',
        story: validStory,
      };
      delete base[drop];
      const out = validateBibleRequest_(base);
      return out.ok === false;
    }
  ), { numRuns: 50 });
});

// ── BD3 property: when ALL required fields are present and valid,
//                  the validator accepts (regardless of optional fields).
test('BD3 — receive validator accepts iff all required fields are present and valid', () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 60 }).filter(s => s.trim().length > 0),
    fc.string({ minLength: 1, maxLength: 60 }).filter(s => s.trim().length > 0),
    fc.integer({ min: BIBLE_STORY_MIN_CHARS, max: BIBLE_STORY_MAX_CHARS }),
    fc.option(fc.string({ minLength: 0, maxLength: 30 })),
    (name, city, storyLen, phone) => {
      const out = validateBibleRequest_({
        name: name.trim(),
        email: 'test@example.com',
        city: city.trim(),
        story: 'a'.repeat(storyLen),
        phone: phone || '',
      });
      return out.ok === true;
    }
  ), { numRuns: 100 });
});
