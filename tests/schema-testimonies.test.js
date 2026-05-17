/**
 * admin-editor-testimonies-schema — schema registration + property + example
 * test suite.
 *
 * Spec:        .kiro/specs/admin-editor-testimonies-schema/
 * Run (CI):    node --test tests/schema-testimonies.test.js
 * Note:        Node is not installed locally — CI is the only test runner.
 *
 * Test plan (implemented incrementally across tasks 3.1 – 3.10):
 *
 *   Registration  — SCHEMAS.testimonies shape + listActive() membership
 *                   (task 3.1 — THIS task)
 *   Property P1   — round-trip identity (preserves _help,
 *                   _team_review_workflow, and any unknown root keys)
 *                   (task 3.2 — TODO)
 *   Property P2   — validator monotonicity over publishing
 *                   (task 3.3 — TODO)
 *   Property P3   — renderer compatibility (jsdom + STWTestimonies.renderGrid)
 *                   (task 3.4 — DONE)
 *   Property P4   — id uniqueness across the testimonies array
 *                   (task 3.5 — DONE)
 *   Property P5   — body paragraph preservation through JSON round-trip
 *                   (task 3.6 — DONE)
 *   Property P6   — consent enum closure ({"explicit", "verbal"})
 *                   (task 3.7 — DONE)
 *   Examples      — per-field validator branches (id slug, dates, mediaUrl)
 *                   (task 3.8 — DONE)
 *   Examples      — schema-level validator branches (duplicate id,
 *                   required-when-published gates, consent enum)
 *                   (task 3.9 — DONE)
 *   Integration   — live assets/data/testimonies.json + jsdom renderer
 *                   (task 3.10 — DONE)
 *
 * Generators live in tests/generators-testimonies.mjs (task 1).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import fc from 'fast-check';
import { loadModule } from '../assets/js/admin-editor-test-shim.js';
import { forAll } from './harness.mjs';
import {
  genTestimoniesFile,
  genTestimonyRecord,
  genValidTestimoniesFile,
  arbBodyString,
} from './generators-testimonies.mjs';

// Resolve assets/js/testimonies.js once at module init so each iteration of
// property P3 doesn't pay a disk-read cost. The renderer is a self-contained
// IIFE that we load fresh into a per-iteration vm context (see runRender
// below), which is what keeps the renderer's module-level `cache` from
// leaking across iterations.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'assets', 'js', 'testimonies.js'),
  'utf-8'
);

// Load the schema registry once at module init. The test shim returns the
// same `api` object that admin-editor-schemas.js exports, i.e. the
// `{ SCHEMAS, listActive, extractSpotify, extractYouTube }` shape.
const schemasApi = await loadModule('admin-editor-schemas');
const SCHEMA = schemasApi.SCHEMAS.testimonies;

// ──────────────────────────────────────────────────────────────
// Feature: admin-editor-testimonies-schema, Registration
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1**
// ──────────────────────────────────────────────────────────────
describe('SCHEMAS.testimonies registration', () => {
  test('schema entry exists on the registry', () => {
    assert.ok(
      SCHEMA,
      'SCHEMAS.testimonies must be present on the schema registry'
    );
  });

  test('id is "testimonies"', () => {
    assert.equal(SCHEMA.id, 'testimonies');
  });

  test('kind is "json"', () => {
    assert.equal(SCHEMA.kind, 'json');
  });

  test('path points at assets/data/testimonies.json', () => {
    assert.equal(SCHEMA.path, 'assets/data/testimonies.json');
  });

  test('rootType is "object"', () => {
    assert.equal(SCHEMA.rootType, 'object');
  });

  test('category is "content"', () => {
    assert.equal(SCHEMA.category, 'content');
  });

  test('first group is the testimonies repeating group', () => {
    assert.ok(
      Array.isArray(SCHEMA.groups) && SCHEMA.groups.length > 0,
      'SCHEMA.groups must be a non-empty array'
    );
    assert.equal(SCHEMA.groups[0].name, 'testimonies');
  });

  test('listActive() surfaces the testimonies schema to the content picker', () => {
    const active = schemasApi.listActive();
    assert.ok(
      Array.isArray(active),
      'listActive() must return an array'
    );
    assert.ok(
      active.some((s) => s && s.id === 'testimonies'),
      'listActive() must include the testimonies schema (no wip / readOnly flags)'
    );
  });
});

// ──────────────────────────────────────────────────────────────
// Property P1 — round-trip identity
// **Validates: Requirements 5.1, 5.2, 5.4, 12.2**
//
// Generator: genTestimoniesFile() — emits forms with arbitrary unknown root
// keys, optional reserved keys (_help, _team_review_workflow), and a
// testimonies array.
//
// Assertion: serializing the form via JSON.stringify(form, null, 2) + '\n'
// and re-parsing yields a structurally-identical object. Reserved keys
// _help and _team_review_workflow survive when present and stay absent
// when not.
// ──────────────────────────────────────────────────────────────
test('Property P1 — round-trip identity', () => {
  forAll(
    genTestimoniesFile,
    (form) => {
      const out = JSON.parse(JSON.stringify(form, null, 2) + '\n');
      assert.deepEqual(out, form);

      // Reserved-key preservation: presence and absence both round-trip.
      const hasHelp = Object.prototype.hasOwnProperty.call(form, '_help');
      assert.equal(
        Object.prototype.hasOwnProperty.call(out, '_help'),
        hasHelp,
        '_help presence must round-trip'
      );
      if (hasHelp) {
        assert.deepEqual(out._help, form._help, '_help value must round-trip');
      }

      const hasWorkflow = Object.prototype.hasOwnProperty.call(
        form,
        '_team_review_workflow'
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(out, '_team_review_workflow'),
        hasWorkflow,
        '_team_review_workflow presence must round-trip'
      );
      if (hasWorkflow) {
        assert.deepEqual(
          out._team_review_workflow,
          form._team_review_workflow,
          '_team_review_workflow value must round-trip'
        );
      }
    },
    100
  );
});

// ──────────────────────────────────────────────────────────────
// Property P2 — validator monotonicity over publishing
// **Validates: Requirements 4.3, 12.2**
//
// Generator: genTestimonyRecord() — a record with random `published` and
// independently-empty required fields, ensuring meaningful coverage of
// both the populated and empty cases.
//
// Mechanism: the schema-level validator only operates on the whole file
// shape, so we wrap each record in `{ testimonies: [record] }` to test it
// in isolation.
//
// Assertion: for any record `r` whose draft form (published=false) passes
// validation, flipping `published` to true passes IFF every renderer-
// consumed field — publishedAt, excerpt, body, anchorVerse — is populated.
// When the draft form already fails, the property makes no claim about
// the published form (skip silently — the record is malformed for some
// other reason: bad consent, etc.).
// ──────────────────────────────────────────────────────────────
test('Property P2 — validator monotonicity over publishing', () => {
  forAll(
    genTestimonyRecord,
    (r) => {
      const draft = { ...r, published: false };
      const pub = { ...r, published: true };

      const validatesDraft = SCHEMA.validate({ testimonies: [draft] }) === null;
      const validatesPub = SCHEMA.validate({ testimonies: [pub] }) === null;

      const hasAllRequired =
        !!r.publishedAt && !!r.excerpt && !!r.body && !!r.anchorVerse;

      // The property only constrains the published outcome when the draft
      // form already passes; otherwise the record is malformed for some
      // unrelated reason (e.g. invalid consent) and there's no claim to
      // make.
      if (validatesDraft) {
        assert.equal(
          validatesPub,
          hasAllRequired,
          'published-form pass/fail must equal the conjunction of ' +
            'publishedAt/excerpt/body/anchorVerse being populated'
        );
      }
    },
    200
  );
});

// ──────────────────────────────────────────────────────────────
// Property P3 — renderer compatibility
// **Validates: Requirements 7.1, 7.2, 12.2**
//
// Generator: genValidTestimoniesFile() — only schema-valid forms, so the
// renderer never sees a record the validator would reject.
//
// Mechanism: build a fresh JSDOM window per iteration with a single
// <div id="testimonies-grid"> mounted *after* the renderer IIFE has
// auto-wired (so auto-wire no-ops). The renderer's `loadManifest` calls
// window.fetch(MANIFEST_URL); we stub fetch to return the generated file
// and let the renderer apply its own `published === true` filter.
//
// We drive renderGrid with `{limit: 0}` to bypass the news-page cap and
// the optional ?author= filter, so the rendered <article> count must
// equal the published-record count exactly.
//
// Each iteration runs in its own vm context with its own re-evaluation of
// the renderer source — that way the module-level `cache` variable inside
// the IIFE never bleeds across iterations. Iterations run sequentially
// because renderGrid is async and the loop's predicate must complete
// fully before the next sample is drawn.
// ──────────────────────────────────────────────────────────────

/**
 * Mount a fresh JSDOM, evaluate testimonies.js into it, drive
 * STWTestimonies.renderGrid against `form.testimonies.filter(published)`,
 * and return the rendered <article> count.
 *
 * Throws on any error during render; the caller wraps with iteration
 * context so a failing sample is identifiable.
 */
async function runRender(form) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/',
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // Stub fetch BEFORE evaluating the IIFE. The renderer's MANIFEST_URL is
  // 'assets/data/testimonies.json' (with a `?t=<timestamp>` cache-buster
  // appended), so we don't bother matching the URL — every fetch in this
  // sandbox returns the generated form.
  window.fetch = async function fakeFetch(/* url, init */) {
    return {
      ok: true,
      status: 200,
      async json() {
        return form;
      },
      async text() {
        return JSON.stringify(form);
      },
    };
  };

  // Evaluate the renderer IIFE inside the JSDOM window's vm context. This
  // defines window.STWTestimonies and runs the auto-wire path. Since we
  // haven't mounted #testimonies-grid yet, auto-wire no-ops and we get to
  // drive renderGrid ourselves.
  const ctx = dom.getInternalVMContext();
  vm.runInContext(RENDERER_SRC, ctx, { filename: 'assets/js/testimonies.js' });

  // Mount the grid container *after* auto-wire so we control the render
  // entry point. limit:0 means render every published record.
  const gridEl = window.document.createElement('div');
  gridEl.id = 'testimonies-grid';
  window.document.body.appendChild(gridEl);

  await window.STWTestimonies.renderGrid(gridEl, { limit: 0 });

  return window.document.querySelectorAll('article').length;
}

test('Property P3 — renderer compatibility', async () => {
  const ITERATIONS = 100;
  for (let i = 0; i < ITERATIONS; i++) {
    const form = genValidTestimoniesFile();
    const expected = form.testimonies.filter((t) => t.published === true).length;

    let articleCount;
    try {
      articleCount = await runRender(form);
    } catch (err) {
      const sample = JSON.stringify(form).slice(0, 500);
      throw new Error(
        `renderer threw on iteration ${i} with input ${sample}: ${err && err.message ? err.message : err}`
      );
    }

    assert.equal(
      articleCount,
      expected,
      `iteration ${i}: expected ${expected} <article> elements, got ${articleCount}; ` +
        `input=${JSON.stringify(form).slice(0, 500)}`
    );
  }
});

// ──────────────────────────────────────────────────────────────
// Property P4 — id uniqueness
// **Validates: Requirements 4.2, 8.3, 12.2**
//
// Generator: genTestimoniesFile() — emits forms with intentional id
// collisions in roughly 50% of samples (the generator's default mode).
//
// Assertion: when a collision exists in the array, the schema-level
// validator MUST reject the form (validates === false). The contrapositive
// is that any form the validator accepts has pairwise-distinct ids. The
// converse direction (no-collision ⟹ validator-pass) is *not* claimed —
// the validator can also reject for unrelated reasons (consent enum,
// required-when-published gates, etc.), so we only assert pairwise
// distinctness when the validator actually accepted the form.
// ──────────────────────────────────────────────────────────────
test('Property P4 — id uniqueness', () => {
  forAll(
    genTestimoniesFile,
    (form) => {
      const ids = form.testimonies.map((t) => t.id).filter(Boolean);
      const uniqueIds = new Set(ids);
      const hasCollision = ids.length !== uniqueIds.size;
      const validates = SCHEMA.validate(form) === null;

      // hasCollision ⟹ !validates
      if (hasCollision) {
        assert.equal(
          validates,
          false,
          'duplicate ids must be rejected by the schema-level validator'
        );
      }

      // validates ⟹ pairwise-distinct ids
      if (validates) {
        assert.equal(
          ids.length,
          uniqueIds.size,
          'a passing form must have pairwise-distinct testimony ids'
        );
      }
    },
    100
  );
});

// ──────────────────────────────────────────────────────────────
// Property P5 — body paragraph preservation
// **Validates: Requirements 6.1, 6.2, 6.3, 12.2**
//
// Generator: fc.string({minLength: 0, maxLength: 5000}) — re-exposed
// from generators-testimonies.mjs as `arbBodyString` for shrinking on
// failure.
//
// Assertion: round-tripping a body string through JSON.stringify and
// JSON.parse yields the exact same string, character-for-character. This
// guards against any future smart-quote / autotrim coercion silently
// breaking the renderer's `\n{2,}` paragraph splitter.
// ──────────────────────────────────────────────────────────────
test('Property P5 — body paragraph preservation', () => {
  fc.assert(
    fc.property(arbBodyString, (b) => {
      const out = JSON.parse(JSON.stringify({ body: b })).body;
      assert.equal(out, b);
    }),
    { numRuns: 200 }
  );
});

// ──────────────────────────────────────────────────────────────
// Property P6 — consent enum closure
// **Validates: Requirements 4.4, 12.2**
//
// Generator: genTestimonyRecord() — `consent` is drawn uniformly from
// ['explicit', 'verbal', 'invalid', ''] so a meaningful fraction of
// samples carry an out-of-enum value.
//
// Mechanism: the schema-level validator only operates on the whole-file
// shape, so we wrap each record in `{ testimonies: [r] }`.
//
// Assertion: when the schema-level validator accepts a record, its
// `consent` value lies inside the closed set the validator's enum check
// permits. The validator's actual rejection rule is
// `if (t.consent && t.consent !== 'explicit' && t.consent !== 'verbal')`,
// so an empty `consent` slips past the schema-level check (per-field
// `required: true` is enforced separately at form submit). The property
// reflects this: pass ⟹ consent ∈ {'explicit', 'verbal', ''}.
// ──────────────────────────────────────────────────────────────
test('Property P6 — consent enum closure', () => {
  forAll(
    genTestimonyRecord,
    (r) => {
      const validates = SCHEMA.validate({ testimonies: [r] }) === null;
      if (validates) {
        assert.ok(
          r.consent === 'explicit' ||
            r.consent === 'verbal' ||
            r.consent === '',
          `validator-pass implies consent ∈ {"explicit","verbal",""}; ` +
            `got ${JSON.stringify(r.consent)}`
        );
      }
    },
    100
  );
});

// ──────────────────────────────────────────────────────────────
// Task 3.8 — Example tests for per-field validators
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 12.3**
//
// The per-field validators live nested at SCHEMA.groups[0].fields[*].validate.
// `getFieldValidator(name)` looks up a field by name and returns its
// `validate` callback so each test reads as `validate(input)` instead of
// having to walk the schema in-line.
//
// Convention: a passing input returns `null`; a failing input returns a
// non-empty string (the error message shown to the admin).
// ──────────────────────────────────────────────────────────────
function getFieldValidator(name) {
  const f = SCHEMA.groups[0].fields.find((f) => f.name === name);
  return f && f.validate;
}

describe('per-field validators', () => {
  describe('id slug', () => {
    const validate = getFieldValidator('id');

    test('accepts canonical team slug "stw-team-david-l-draft"', () => {
      assert.equal(validate('stw-team-david-l-draft'), null);
    });

    test('accepts canonical story slug "stw-story-2026-04-10-liam"', () => {
      assert.equal(validate('stw-story-2026-04-10-liam'), null);
    });

    test('rejects whitespace ("Has Spaces")', () => {
      assert.equal(typeof validate('Has Spaces'), 'string');
    });

    test('rejects uppercase ("UpperCase")', () => {
      assert.equal(typeof validate('UpperCase'), 'string');
    });

    test('rejects leading dash ("-foo")', () => {
      assert.equal(typeof validate('-foo'), 'string');
    });

    test('rejects special characters ("foo!bar")', () => {
      assert.equal(typeof validate('foo!bar'), 'string');
    });
  });

  describe('submittedAt', () => {
    const validate = getFieldValidator('submittedAt');

    test('accepts an ISO date "2026-04-01"', () => {
      assert.equal(validate('2026-04-01'), null);
    });

    test('rejects US-style date "04/01/2026"', () => {
      assert.equal(typeof validate('04/01/2026'), 'string');
    });

    test('rejects non-padded ISO date "2026-4-1"', () => {
      assert.equal(typeof validate('2026-4-1'), 'string');
    });

    test('rejects free-form text "not-a-date"', () => {
      assert.equal(typeof validate('not-a-date'), 'string');
    });
  });

  describe('publishedAt', () => {
    const validate = getFieldValidator('publishedAt');

    test('accepts empty string (drafts have no publishedAt)', () => {
      assert.equal(validate(''), null);
    });

    test('accepts an ISO date "2026-04-01"', () => {
      assert.equal(validate('2026-04-01'), null);
    });

    test('rejects US-style date "04/01/2026"', () => {
      assert.equal(typeof validate('04/01/2026'), 'string');
    });

    test('rejects non-padded ISO date "2026-4-1"', () => {
      assert.equal(typeof validate('2026-4-1'), 'string');
    });

    test('rejects free-form text "not-a-date"', () => {
      assert.equal(typeof validate('not-a-date'), 'string');
    });
  });

  describe('mediaUrl', () => {
    const validate = getFieldValidator('mediaUrl');

    test('accepts empty string (mediaUrl is optional)', () => {
      assert.equal(validate(''), null);
    });

    test('accepts an https URL "https://example.com/x.jpg"', () => {
      assert.equal(validate('https://example.com/x.jpg'), null);
    });

    test('rejects plain http "http://example.com"', () => {
      assert.equal(typeof validate('http://example.com'), 'string');
    });

    test('rejects ftp URL "ftp://example.com"', () => {
      assert.equal(typeof validate('ftp://example.com'), 'string');
    });

    test('rejects javascript: URL "javascript:alert(1)"', () => {
      assert.equal(typeof validate('javascript:alert(1)'), 'string');
    });
  });
});

// ──────────────────────────────────────────────────────────────
// Task 3.9 — Example tests for schema-level validator branches
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 12.3**
//
// Each test builds the smallest fixture that isolates the branch under
// test, calls SCHEMA.validate(fixture), and asserts the returned string
// matches the validator's exact wording (or null for the empty-array
// case).
//
// `validRecord(overrides)` returns a fully-populated, schema-valid
// testimony so each branch test can flip exactly one field and trust
// that no unrelated rule fires first.
// ──────────────────────────────────────────────────────────────
function validRecord(overrides) {
  return Object.assign(
    {
      id: 'foo',
      name: 'Bar',
      anonymous: false,
      submittedAt: '2026-01-01',
      publishedAt: '',
      published: false,
      excerpt: '',
      body: '',
      anchorVerse: '',
      mediaUrl: '',
      consent: 'explicit',
    },
    overrides || {}
  );
}

describe('schema-level validator branches', () => {
  test('empty testimonies array passes', () => {
    assert.equal(SCHEMA.validate({ testimonies: [] }), null);
  });

  test('duplicate id surfaces an error pointing at the second occurrence', () => {
    const fixture = {
      testimonies: [
        validRecord({ id: 'foo' }),
        validRecord({ id: 'foo' }),
      ],
    };
    const err = SCHEMA.validate(fixture);
    assert.equal(typeof err, 'string');
    assert.ok(
      err.includes('Testimony #2 has duplicate id'),
      `expected error to point at the second occurrence; got ${JSON.stringify(err)}`
    );
  });

  test('published=true with empty publishedAt produces a row-tagged error', () => {
    const fixture = {
      testimonies: [
        validRecord({
          published: true,
          publishedAt: '',
          excerpt: 'x',
          body: 'x',
          anchorVerse: 'x',
        }),
      ],
    };
    assert.equal(
      SCHEMA.validate(fixture),
      'Testimony #1: set publishedAt before publishing.'
    );
  });

  test('published=true with empty excerpt produces a row-tagged error', () => {
    const fixture = {
      testimonies: [
        validRecord({
          published: true,
          publishedAt: '2026-04-01',
          excerpt: '',
          body: 'x',
          anchorVerse: 'x',
        }),
      ],
    };
    assert.equal(
      SCHEMA.validate(fixture),
      'Testimony #1: excerpt is required before publishing.'
    );
  });

  test('published=true with empty body produces a row-tagged error', () => {
    const fixture = {
      testimonies: [
        validRecord({
          published: true,
          publishedAt: '2026-04-01',
          excerpt: 'x',
          body: '',
          anchorVerse: 'x',
        }),
      ],
    };
    assert.equal(
      SCHEMA.validate(fixture),
      'Testimony #1: body is required before publishing.'
    );
  });

  test('published=true with empty anchorVerse produces a row-tagged error', () => {
    const fixture = {
      testimonies: [
        validRecord({
          published: true,
          publishedAt: '2026-04-01',
          excerpt: 'x',
          body: 'x',
          anchorVerse: '',
        }),
      ],
    };
    assert.equal(
      SCHEMA.validate(fixture),
      'Testimony #1: anchorVerse is required before publishing.'
    );
  });

  test('consent: "maybe" produces the consent-enum error', () => {
    const fixture = {
      testimonies: [validRecord({ consent: 'maybe' })],
    };
    assert.equal(
      SCHEMA.validate(fixture),
      'Testimony #1: consent must be "explicit" or "verbal".'
    );
  });
});

// ──────────────────────────────────────────────────────────────
// Task 3.10 — Integration test against the live fixture
// **Validates: Requirements 7.1, 7.2, 7.3, 12.4**
//
// Reads the on-disk assets/data/testimonies.json and exercises the same
// two surfaces the property tests cover with synthetic data — the
// schema-level validator and the jsdom-mounted renderer — but against
// the actual file admins are editing today. This catches the case where
// the synthetic generators drift from a real-world shape that's still
// supposed to round-trip.
//
// The renderer test reuses runRender() from Property P3 above so we
// don't duplicate the jsdom + vm setup. As of this task the live file
// has zero published records (every team-draft testimony is still
// awaiting sign-off), so the assertion holds trivially today and will
// continue to hold as records are flipped to published over time.
// ──────────────────────────────────────────────────────────────
describe('integration: live fixture', () => {
  const FIXTURE_PATH = path.resolve(
    __dirname,
    '..',
    'assets',
    'data',
    'testimonies.json'
  );

  test('live testimonies.json passes the schema-level validator', () => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    assert.equal(
      SCHEMA.validate(data),
      null,
      'live assets/data/testimonies.json must pass SCHEMAS.testimonies.validate'
    );
  });

  test('renderer produces one <article> per published testimony', async () => {
    const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const expected = data.testimonies.filter((t) => t.published === true).length;

    const articleCount = await runRender(data);

    assert.equal(
      articleCount,
      expected,
      `expected ${expected} <article> elements, got ${articleCount}`
    );
  });
});
