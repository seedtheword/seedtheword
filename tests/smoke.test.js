// Smoke test — verifies the harness itself works before other tests rely on it.
// If this fails, the problem is infrastructure, not the feature under test.

import { test } from 'node:test';
import {
  assert,
  forAll,
  makeFakeClock,
  makeFakeFetch,
  makeFakeStorage,
  genAsciiString,
} from './harness.mjs';
import { loadModule } from '../assets/js/admin-editor-test-shim.js';

test('forAll iterates the requested number of times', () => {
  let count = 0;
  forAll(
    () => ({ n: count }),
    () => {
      count++;
    },
    50
  );
  assert.equal(count, 50);
});

test('forAll surfaces the failing sample in the error message', () => {
  assert.throws(
    () =>
      forAll(
        () => ({ value: 'specific-sample' }),
        (s) => {
          assert.equal(s.value, 'other');
        },
        1
      ),
    /specific-sample/
  );
});

test('makeFakeClock advance resolves pending sleeps in order', async () => {
  const clock = makeFakeClock();
  const order = [];
  const a = clock.sleep(100).then(() => order.push('a'));
  const b = clock.sleep(50).then(() => order.push('b'));
  await clock.advance(50);
  await Promise.resolve(); // flush microtasks
  assert.deepEqual(order, ['b']);
  await clock.advance(50);
  await Promise.resolve();
  assert.deepEqual(order, ['b', 'a']);
  await a;
  await b;
});

test('makeFakeFetch records calls and returns handler-shaped responses', async () => {
  const { fetch, calls } = makeFakeFetch((url) => {
    if (url.endsWith('/ok')) return { status: 200, body: { hello: 'world' } };
    return { status: 404, body: 'not found' };
  });

  const ok = await fetch('https://example.com/ok', { method: 'GET' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { hello: 'world' });

  const missing = await fetch('https://example.com/nope');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'not found');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://example.com/ok');
  assert.equal(calls[0].init.method, 'GET');
});

test('makeFakeStorage behaves like window Storage', () => {
  const s = makeFakeStorage();
  assert.equal(s.getItem('missing'), null);
  s.setItem('k', 'v');
  assert.equal(s.getItem('k'), 'v');
  assert.equal(s.length, 1);
  assert.equal(s.key(0), 'k');
  s.removeItem('k');
  assert.equal(s.getItem('k'), null);
});

test('genAsciiString returns strings within the requested length bounds', () => {
  forAll(
    () => genAsciiString(0, 10),
    (s) => {
      assert.ok(typeof s === 'string');
      assert.ok(s.length <= 10);
    },
    50
  );
});

// Shim smoke: each production module loads and exports the expected shape.
test('loadModule: admin-editor-diff exports diffLines, formatUnified, applyUnified', async () => {
  const m = await loadModule('admin-editor-diff');
  assert.equal(typeof m.diffLines, 'function');
  assert.equal(typeof m.formatUnified, 'function');
  assert.equal(typeof m.applyUnified, 'function');
});

test('loadModule: admin-editor-github exports createClient + constants', async () => {
  const m = await loadModule('admin-editor-github');
  assert.equal(typeof m.createClient, 'function');
  assert.equal(typeof m.constants, 'object');
  assert.equal(m.constants.REPO_OWNER, 'seedtheword');
});

test('loadModule: admin-editor-drafts exports createStore + constants', async () => {
  const m = await loadModule('admin-editor-drafts');
  assert.equal(typeof m.createStore, 'function');
  assert.equal(typeof m.KEY_PREFIX, 'string');
  assert.equal(m.DEBOUNCE_MS, 1000);
});
