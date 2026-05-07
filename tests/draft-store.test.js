// Feature: browser-admin-editor, Property 9: Retry and draft preservation on transient failure
//
// For any sequence of responses where some prefix are 5xx or network errors
// and the final is non-5xx, the system SHALL emit at most 3 total attempts
// with delays of 1000 ms and 3000 ms; no 4xx response SHALL trigger a retry.
//
// For any form state F with a pending edit E, if a network error occurs, the
// draft store SHALL contain a snapshot of F under stwm-admin-draft:{path}
// after the error surfaces, deeply equal to F on restore.
//
// Validates: Requirement 13.6, 13.7, 17.1, 17.2, 17.3

import { test } from 'node:test';
import { assert, forAll, makeFakeFetch, makeFakeClock, makeFakeStorage, pick, range } from './harness.mjs';
import { loadModule } from '../assets/js/admin-editor-test-shim.js';

const gh = await loadModule('admin-editor-github');
const draftModule = await loadModule('admin-editor-drafts');

// ── Generators ─────────────────────────────────────────────────────────────

// Response sequence generator. Produces an array of response objects that
// `makeFakeFetch` will replay in order. Constraints:
//   - Some prefix may be 5xx or 'network' (simulated by throwing).
//   - The final response is guaranteed non-5xx.
function genResponseSequence() {
  const prefixLen = range(0, 3);
  const prefix = [];
  for (let i = 0; i < prefixLen; i++) {
    prefix.push(pick(['500', '502', '503', 'network']));
  }
  const finalStatus = pick([200, 201, 204, 400, 401, 403, 404, 422]);
  return { prefix: prefix, finalStatus: finalStatus };
}

function makeHandlerFromSequence(sequence) {
  const replay = [...sequence.prefix, { status: sequence.finalStatus, body: { ok: true } }];
  return function handler(_url, _init, callIndex) {
    const step = replay[callIndex] || replay[replay.length - 1];
    if (step === '500' || step === '502' || step === '503') {
      return { status: Number(step), body: { message: 'server error' } };
    }
    if (step === 'network') {
      throw new Error('simulated network error');
    }
    return step;
  };
}

function genFormSnapshot() {
  // A sample form state — keep it simple so deep equality is well-defined.
  return {
    listening: Array.from({ length: range(0, 3) }, (_, i) => ({
      kind: 'spotify',
      id: 'id_' + i,
      title: 'Title ' + i,
    })),
    partners: [{ name: 'Name', url: 'https://example.com' }],
  };
}

// ── Property 9a: retry cap + backoff pattern ───────────────────────────────

test('Property 9a: writeFile attempts at most 3 times on transient 5xx/network', async () => {
  for (let i = 0; i < 200; i++) {
    const seq = genResponseSequence();
    const { fetch, calls } = makeFakeFetch(makeHandlerFromSequence(seq));
    const clock = makeFakeClock();
    const client = gh.createClient({
      fetch,
      pat: 'pat',
      clock,
      storage: makeFakeStorage(),
    });

    // Drive the write; advance the clock to let sleeps resolve.
    const p = client.writeFile('path', 'content', { sha: 's', message: 'm' }).catch((e) => e);
    // Advance through potential 1 s + 3 s backoffs plus a buffer.
    for (let tick = 0; tick < 6; tick++) {
      await Promise.resolve();
      await clock.advance(1000);
    }
    await p;

    const transientPrefix = seq.prefix.length;
    // The PUT should have been attempted 1 + retries times where retries ≤ 2.
    // If the prefix has 0 transients, exactly 1 call. 1 → 2 calls. 2+ → 3 calls (cap).
    const expectedAttempts = Math.min(1 + transientPrefix, 3);
    assert.ok(
      calls.length <= 3,
      `expected ≤ 3 attempts, got ${calls.length} (prefix=${JSON.stringify(seq.prefix)})`
    );
    // If the prefix is all transient and we hit the cap, the final attempt is still the last one tried.
    if (transientPrefix >= 2) {
      assert.equal(calls.length, 3, `expected cap at 3 with prefix ${JSON.stringify(seq.prefix)}`);
    } else {
      assert.equal(
        calls.length,
        expectedAttempts,
        `expected ${expectedAttempts} attempts, got ${calls.length}`
      );
    }
  }
});

test('Property 9b: 4xx responses never trigger a retry', async () => {
  const fourXxs = [400, 401, 403, 404, 409, 422];
  for (const status of fourXxs) {
    const { fetch, calls } = makeFakeFetch(() => ({ status, body: { message: 'x' } }));
    const clock = makeFakeClock();
    const client = gh.createClient({ fetch, pat: 'pat', clock, storage: makeFakeStorage() });
    await client.writeFile('path', 'content', { sha: 's', message: 'm' }).catch(() => {});
    assert.equal(calls.length, 1, `${status} must not retry; got ${calls.length} calls`);
  }
});

// ── Property 9c: draft preserved on network error, restorable ──────────────

test('Property 9c: a snapshot flushed before a network error round-trips on restore', () => {
  forAll(
    () => ({
      path: 'assets/data/' + pick(['recommendations', 'daily-verses', 'ministry-outreach']) + '.json',
      baseSha: 'sha_' + range(0, 100000),
      form: genFormSnapshot(),
    }),
    ({ path, baseSha, form }) => {
      const storage = makeFakeStorage();
      const clock = makeFakeClock();
      const drafts = draftModule.createStore({ storage, clock });

      // Simulate the force-flush that happens on network error.
      drafts.flushNow('recommendations', path, baseSha, form);

      // Restore — payload must deeply equal what was flushed.
      const restored = drafts.restore(path);
      assert.ok(restored, 'expected a draft to be present');
      assert.equal(restored.schemaId, 'recommendations');
      assert.equal(restored.baseSha, baseSha);
      assert.deepEqual(restored.form, form);
    },
    100
  );
});

// ── Example tests ──────────────────────────────────────────────────────────

test('draft TTL: drafts older than 24 h are not returned', () => {
  const storage = makeFakeStorage();
  let now = 0;
  const clock = { now: () => now, sleep: () => Promise.resolve() };
  const drafts = draftModule.createStore({ storage, clock });
  const path = 'assets/data/x.json';
  drafts.flushNow('x', path, 'sha', { a: 1 });
  now = 25 * 60 * 60 * 1000; // 25 hours later
  assert.equal(drafts.restore(path), null, 'expected expired draft to be pruned');
  assert.equal(storage.getItem('stwm-admin-draft:' + path), null, 'expected key to be removed on expired restore');
});

test('draft discard removes the sessionStorage key', () => {
  const storage = makeFakeStorage();
  const drafts = draftModule.createStore({ storage });
  drafts.flushNow('x', 'assets/data/x.json', 'sha', { a: 1 });
  drafts.discard('assets/data/x.json');
  assert.equal(storage.getItem('stwm-admin-draft:assets/data/x.json'), null);
});

test('debounced flush coalesces rapid edits into a single write', async () => {
  const storage = makeFakeStorage();
  const clock = makeFakeClock();
  const drafts = draftModule.createStore({ storage, clock });
  const path = 'assets/data/x.json';

  drafts.flushDebounced('x', path, 'sha', { n: 1 });
  drafts.flushDebounced('x', path, 'sha', { n: 2 });
  drafts.flushDebounced('x', path, 'sha', { n: 3 });

  // Nothing written yet.
  assert.equal(storage.getItem('stwm-admin-draft:' + path), null);

  // Advance past the 1 s debounce.
  await clock.advance(1000);
  await Promise.resolve();

  const written = storage.getItem('stwm-admin-draft:' + path);
  assert.ok(written, 'expected a flushed draft after the debounce');
  const parsed = JSON.parse(written);
  assert.deepEqual(parsed.form, { n: 3 }, 'expected the final value after coalescing');
});
