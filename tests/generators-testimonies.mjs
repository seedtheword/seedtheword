/**
 * Generators for testimony fixture data.
 *
 * Spec:    .kiro/specs/admin-editor-testimonies-schema/
 * Design:  §"Testing strategy → Property-based testing approach"
 * Used by: tests/schema-testimonies.test.js (added in task 3)
 *
 * Conventions
 * -----------
 *  - All emitted strings are ASCII-only and built on top of the helpers in
 *    tests/harness.mjs (`pick`, `range`, `genAsciiString`, `genLineString`).
 *  - `fast-check` is used for two specific concerns where smart shrinking
 *    pays off: body strings (property P5) and consent enum sampling
 *    (property P6). Everything else is plain Math.random()-based generators
 *    so the harness's existing `forAll(gen, predicate)` runner can drive them
 *    without an fc.assert wrapper.
 *  - Each exported generator carries a JSDoc header documenting its sample
 *    space so future readers can verify the corresponding property's input
 *    coverage at a glance.
 *
 * Exports
 * -------
 *  Helpers:
 *    randomSlug(), randomDate(), randomNonEmptyString()
 *  Record generators:
 *    genTestimonyRecord()       — varied / sometimes-invalid records
 *    genValidTestimonyRecord()  — always passes the validator stack
 *  File generators:
 *    genTestimoniesFile(opts?)  — varied; supports forced id-collision mode
 *    genValidTestimoniesFile()  — always passes SCHEMAS.testimonies.validate
 *  fast-check arbitraries (re-exposed for direct fc.assert use):
 *    arbBodyString              — drives P5
 *    arbConsentValue            — drives P6
 */

import fc from 'fast-check';
import { pick, range, genAsciiString } from './harness.mjs';

// ── helpers ─────────────────────────────────────────────────────────────────

const SLUG_HEAD_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const SLUG_TAIL_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-'.split('');

/**
 * Build an ASCII-only slug matching `/^[a-z0-9][a-z0-9-]*$/`.
 *
 * Sample space:
 *   - length: 3..40 chars
 *   - first char: [a-z0-9]
 *   - tail chars: [a-z0-9-]
 *   - never starts with '-' (the per-field validator rejects that)
 *   - consecutive '-' permitted (still slug-shaped per the regex)
 */
export function randomSlug() {
  const len = range(3, 40);
  let out = pick(SLUG_HEAD_CHARS);
  for (let i = 1; i < len; i++) out += pick(SLUG_TAIL_CHARS);
  return out;
}

/**
 * Build an ASCII-only YYYY-MM-DD date string. Days are clamped to 1..28 so
 * generated dates never collide with month-length edge cases (the schema
 * validator only checks the lexical shape, not calendar validity).
 *
 * Sample space:
 *   - year: 2020..2030
 *   - month: 01..12
 *   - day: 01..28
 */
export function randomDate() {
  const y = range(2020, 2030);
  const m = String(range(1, 12)).padStart(2, '0');
  const d = String(range(1, 28)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build a non-empty ASCII string suitable for free-form fields like `name`,
 * `excerpt`, `anchorVerse`. Length 1..60 (post-trim).
 */
export function randomNonEmptyString() {
  for (let i = 0; i < 5; i++) {
    const s = genAsciiString(1, 60).trim();
    if (s.length > 0) return s;
  }
  // Fallback — guarantees non-empty even on adverse RNG runs.
  return 'x' + genAsciiString(0, 8);
}

/**
 * Build a multi-paragraph body string that occasionally contains the blank
 * line used by the renderer's paragraph splitter (`\n\n`). Always non-empty.
 */
function randomBody() {
  const paragraphs = range(1, 3);
  const out = [];
  for (let i = 0; i < paragraphs; i++) {
    if (i > 0) out.push(''); // blank line ⇒ new paragraph
    const lines = range(1, 4);
    for (let j = 0; j < lines; j++) out.push(randomNonEmptyString());
  }
  return out.join('\n');
}

const CONSENT_SAMPLE_SPACE = ['explicit', 'verbal', 'invalid', ''];

/**
 * Arbitrary for body strings used in property P5 (paragraph preservation).
 * Re-exported so the test file can drive it through fast-check's runner
 * directly when shrinking is wanted.
 */
export const arbBodyString = fc.string({ minLength: 0, maxLength: 5000 });

/**
 * Arbitrary for consent values used in property P6 (consent enum closure).
 * Drawn uniformly from ['explicit', 'verbal', 'invalid', ''] so a meaningful
 * fraction of samples should be rejected by the schema-level validator.
 */
export const arbConsentValue = fc.constantFrom(...CONSENT_SAMPLE_SPACE);

function sampleArb(arb) {
  // fast-check's `sample(arb, 1)` returns a single-element array. We use it
  // to keep the surface compatible with the harness's predicate-only
  // `forAll(gen, predicate)` API while still drawing from fc arbitraries.
  return fc.sample(arb, 1)[0];
}

function maybeHttpsUrl() {
  if (Math.random() < 0.5) return '';
  return `https://example.com/${randomSlug()}.jpg`;
}

// ── record generators ───────────────────────────────────────────────────────

/**
 * Emit a single testimony record with random `published` and *varied
 * required-field population* — that is, `name` / `excerpt` / `body` /
 * `anchorVerse` / `publishedAt` are each independently empty ≈40% of the
 * time, regardless of `published`. Combined with the consent enum sampling
 * below this is the workhorse for properties P2, P4 (id-uniqueness setup),
 * and P6.
 *
 * Sample space:
 *   - id:           always slug-valid (`/^[a-z0-9][a-z0-9-]*$/`)
 *   - name:         ASCII string, ≈40% empty
 *   - anonymous:    boolean, uniform
 *   - submittedAt:  always YYYY-MM-DD
 *   - publishedAt:  '' (≈50%) or YYYY-MM-DD
 *   - published:    boolean, uniform
 *   - excerpt:      ASCII string, ≈40% empty
 *   - body:         multi-line ASCII string, ≈40% empty
 *   - anchorVerse:  ASCII string, ≈40% empty
 *   - mediaUrl:     '' (≈50%) or `https://example.com/<slug>.jpg`
 *   - consent:      one of ['explicit', 'verbal', 'invalid', ''] uniformly
 *                   via fast-check (so ≈50% of samples are
 *                   schema-validator-invalid)
 */
export function genTestimonyRecord() {
  const maybeEmpty = (s) => (Math.random() < 0.4 ? '' : s);
  return {
    id: randomSlug(),
    name: maybeEmpty(randomNonEmptyString()),
    anonymous: Math.random() < 0.5,
    submittedAt: randomDate(),
    publishedAt: Math.random() < 0.5 ? '' : randomDate(),
    published: Math.random() < 0.5,
    excerpt: maybeEmpty(randomNonEmptyString()),
    body: maybeEmpty(randomBody()),
    anchorVerse: maybeEmpty(randomNonEmptyString()),
    mediaUrl: maybeHttpsUrl(),
    consent: sampleArb(arbConsentValue),
  };
}

/**
 * Emit a single testimony record that passes both the per-field validators
 * declared on `SCHEMAS.testimonies` and its top-level cross-field validator
 * (see design §"Schema entry — exact `SCHEMAS.testimonies`"). Used by the
 * file-level valid generator; also exported for example-style tests.
 *
 * Sample space:
 *   - id:           slug-valid (file-level uniqueness is enforced by the
 *                   caller, not here)
 *   - name:         non-empty ASCII string
 *   - anonymous:    boolean, uniform
 *   - submittedAt:  YYYY-MM-DD
 *   - publishedAt:  YYYY-MM-DD when published===true; '' or YYYY-MM-DD
 *                   otherwise
 *   - published:    boolean, uniform
 *   - excerpt:      non-empty when published===true; '' or non-empty when
 *                   draft
 *   - body:         non-empty multi-line string when published===true;
 *                   '' or non-empty when draft
 *   - anchorVerse:  non-empty when published===true; '' or non-empty when
 *                   draft
 *   - mediaUrl:     '' or https URL
 *   - consent:      one of ['explicit', 'verbal'] uniformly
 */
export function genValidTestimonyRecord() {
  const isPublished = Math.random() < 0.5;
  // When published, populate the renderer-consumed field; when draft, leave
  // it blank ≈50% of the time so drafts-in-progress are well represented.
  const requiredWhenPublished = (gen) =>
    isPublished ? gen() : (Math.random() < 0.5 ? '' : gen());

  return {
    id: randomSlug(),
    name: randomNonEmptyString(),
    anonymous: Math.random() < 0.5,
    submittedAt: randomDate(),
    publishedAt: isPublished
      ? randomDate()
      : (Math.random() < 0.5 ? '' : randomDate()),
    published: isPublished,
    excerpt: requiredWhenPublished(randomNonEmptyString),
    body: requiredWhenPublished(randomBody),
    anchorVerse: requiredWhenPublished(randomNonEmptyString),
    mediaUrl: maybeHttpsUrl(),
    consent: pick(['explicit', 'verbal']),
  };
}

// ── file generators ─────────────────────────────────────────────────────────

const RESERVED_ROOT_KEYS = new Set(['_help', '_team_review_workflow', 'testimonies']);

function maybeReservedDocStrings(file) {
  if (Math.random() < 0.8) file._help = genAsciiString(20, 200);
  if (Math.random() < 0.5) file._team_review_workflow = genAsciiString(20, 200);
}

function sprinkleUnknownRootKeys(file) {
  // 0..2 arbitrary unknown root keys with ASCII string values so the
  // round-trip preservation property (P1) sees recognized-extra coverage.
  const extraCount = range(0, 2);
  for (let i = 0; i < extraCount; i++) {
    const key = '_' + randomSlug();
    if (RESERVED_ROOT_KEYS.has(key)) continue;
    file[key] = genAsciiString(0, 80);
  }
}

/**
 * Emit a testimonies file shaped as
 *   `{_help?, _team_review_workflow?, testimonies: [...], <extras?>}`
 * with arbitrary unknown root keys included so property P1 (round-trip
 * identity) sees coverage of the editor's unknown-key preservation path.
 *
 * Sample space:
 *   - _help:                   present ≈80% of samples (ASCII string)
 *   - _team_review_workflow:   present ≈50% of samples (ASCII string)
 *   - testimonies:             0..6 records via genTestimonyRecord()
 *   - id-collision mode:       when `opts.idCollisionMode === true` a
 *                              duplicate id is *forced* into the array;
 *                              when undefined, a duplicate is injected on
 *                              ≈50% of samples (drives property P4)
 *   - extras:                  0..2 unknown root keys with ASCII values
 *
 * @param {{idCollisionMode?: boolean}} [opts]
 */
export function genTestimoniesFile(opts = {}) {
  const wantsCollision =
    typeof opts.idCollisionMode === 'boolean'
      ? opts.idCollisionMode
      : Math.random() < 0.5;

  const recordCount = range(0, 6);
  const testimonies = [];
  for (let i = 0; i < recordCount; i++) testimonies.push(genTestimonyRecord());

  if (wantsCollision && testimonies.length >= 2) {
    const a = range(0, testimonies.length - 1);
    let b = range(0, testimonies.length - 1);
    if (b === a) b = (a + 1) % testimonies.length;
    testimonies[b].id = testimonies[a].id;
  }

  /** @type {Record<string, unknown>} */
  const file = {};
  maybeReservedDocStrings(file);
  file.testimonies = testimonies;
  sprinkleUnknownRootKeys(file);
  return file;
}

/**
 * Emit a testimonies file guaranteed to pass `SCHEMAS.testimonies.validate`:
 * every record is built via `genValidTestimonyRecord()` and ids are forced
 * pairwise-distinct by suffixing with the record index.
 *
 * Sample space:
 *   - _help:                   present ≈80% of samples
 *   - _team_review_workflow:   present ≈50% of samples
 *   - testimonies:             0..6 records via genValidTestimonyRecord()
 *                              with id `<slug>-<index>` to guarantee
 *                              uniqueness
 *   - extras:                  0..2 unknown root keys with ASCII values
 *
 * Drives properties P1 (valid-form round-trip subset) and P3 (renderer
 * compatibility against the live `STWTestimonies.renderGrid`).
 */
export function genValidTestimoniesFile() {
  const recordCount = range(0, 6);
  const testimonies = [];
  for (let i = 0; i < recordCount; i++) {
    const r = genValidTestimonyRecord();
    r.id = `${r.id}-${i}`;
    testimonies.push(r);
  }

  /** @type {Record<string, unknown>} */
  const file = {};
  maybeReservedDocStrings(file);
  file.testimonies = testimonies;
  sprinkleUnknownRootKeys(file);
  return file;
}
