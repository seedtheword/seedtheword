// Feature: browser-admin-editor, Property 7: GitHub client request-shape invariants
//
// For any sequence of public method calls on the GitHub client module with any
// inputs:
//   - Every HTTP request URL emitted SHALL begin with https://api.github.com/
//     or https://uploads.github.com/.
//   - Every request URL that targets a repository endpoint SHALL contain the
//     substring /repos/seedtheword/seedtheword/.
//   - Every request SHALL carry headers:
//       Accept: application/vnd.github+json
//       X-GitHub-Api-Version: 2022-11-28
//   - No request body, URL, or header value other than Authorization SHALL
//     contain the PAT string.
//
// Validates: Requirement 2.2, 2.3, 11.3, 18.1, 18.2
//
// Also covers Property 8 (No overwrite on conflict or validation failure)
// for the client-level half of the property; the UI-level half lives with
// the commit handler tests.

import { test } from 'node:test';
import { assert, forAll, makeFakeFetch, makeFakeStorage, pick, range, genAsciiString } from './harness.mjs';
import { loadModule } from '../assets/js/admin-editor-test-shim.js';

const gh = await loadModule('admin-editor-github');

const FAKE_PAT = 'github_pat_TEST_1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ── Helpers ────────────────────────────────────────────────────────────────

function installClient({ fetch, pat = FAKE_PAT, storage }) {
  // The client is designed to accept injected fetch/pat/storage so tests can
  // deterministically observe request shape. In production these come from
  // window.fetch / localStorage.
  const client = gh.createClient({
    fetch,
    pat,
    storage: storage || makeFakeStorage(),
    clock: { now: () => Date.now(), sleep: () => Promise.resolve() },
  });
  return client;
}

function genMethodCall() {
  // Each entry is a function (client) → Promise that exercises one public method.
  const ops = [
    (c) => c.validatePat(FAKE_PAT),
    (c) => c.readFile('assets/data/recommendations.json'),
    (c) =>
      c.writeFile('assets/data/recommendations.json', '{"listening":[]}', {
        sha: 'abc123',
        message: 'content(recos): test',
      }),
    (c) =>
      c.deleteFile('assets/images/backgrounds/old.jpg', 'deadbeef', 'remove old bg'),
    (c) =>
      c.dispatchWorkflow('telegram-announcements.yml', { dry_run: 'true' }),
  ];
  return pick(ops);
}

// Handler that returns 200 for most things; a few endpoints need tailored bodies.
function defaultHandler(url) {
  if (url.includes('/contents/') && url.includes('GET')) {
    return { status: 200, body: { sha: 'abc123', content: btoa('{}'), encoding: 'base64' } };
  }
  if (url.includes('/user')) {
    return { status: 200, body: { login: 'test-user' } };
  }
  if (url.includes('/repos/seedtheword/seedtheword') && !url.includes('/contents/')) {
    return { status: 200, body: { permissions: { push: true, pull: true } } };
  }
  if (url.includes('/dispatches')) {
    return { status: 204, body: '' };
  }
  // Default — includes the content PUT path.
  return {
    status: 200,
    body: {
      content: { sha: 'newsha', path: 'x' },
      commit: { sha: 'commitsha', html_url: 'https://github.com/x' },
    },
  };
}

// btoa shim for Node (some methods base64 payloads).
function btoa(s) {
  return Buffer.from(s, 'binary').toString('base64');
}
globalThis.btoa = globalThis.btoa || btoa;

// ── Property 7: request-shape invariants ───────────────────────────────────

test('Property 7a: every URL starts with api.github.com or uploads.github.com', async () => {
  // We run a short sequence of method calls in each forAll iteration. Because
  // each iteration is async, we use a manual loop rather than forAll's
  // synchronous predicate form.
  for (let i = 0; i < 200; i++) {
    const { fetch, calls } = makeFakeFetch(defaultHandler);
    const client = installClient({ fetch });
    const op = genMethodCall();
    try {
      await op(client);
    } catch (_) {
      // Some methods surface errors on non-success bodies we didn't stub;
      // that's fine — we only care about the URL-shape invariant on any
      // request that did fly.
    }
    for (const call of calls) {
      assert.ok(
        call.url.startsWith('https://api.github.com/') ||
          call.url.startsWith('https://uploads.github.com/'),
        `URL violates host allowlist: ${call.url}`
      );
    }
  }
});

test('Property 7b: repo-targeted URLs contain /repos/seedtheword/seedtheword/', async () => {
  for (let i = 0; i < 200; i++) {
    const { fetch, calls } = makeFakeFetch(defaultHandler);
    const client = installClient({ fetch });
    const op = genMethodCall();
    try {
      await op(client);
    } catch (_) {}
    for (const call of calls) {
      // /user is the one non-repo endpoint we hit; everything else is repo.
      if (call.url.endsWith('/user') || call.url.includes('/user?')) continue;
      assert.ok(
        call.url.includes('/repos/seedtheword/seedtheword/') ||
          call.url.includes('/repos/seedtheword/seedtheword?') ||
          call.url.endsWith('/repos/seedtheword/seedtheword'),
        `repo URL does not target seedtheword/seedtheword: ${call.url}`
      );
    }
  }
});

test('Property 7c: required headers are present on every request', async () => {
  for (let i = 0; i < 200; i++) {
    const { fetch, calls } = makeFakeFetch(defaultHandler);
    const client = installClient({ fetch });
    const op = genMethodCall();
    try {
      await op(client);
    } catch (_) {}
    for (const call of calls) {
      const h = call.init.headers || {};
      assert.equal(h['Accept'], 'application/vnd.github+json', `Accept missing on ${call.url}`);
      assert.equal(h['X-GitHub-Api-Version'], '2022-11-28', `API version missing on ${call.url}`);
    }
  }
});

test('Property 7d: PAT appears only in Authorization header — nowhere else', async () => {
  const pat = 'github_pat_SECRET_TOKEN_VALUE_' + genAsciiString(16, 16).replace(/\s/g, 'A');
  for (let i = 0; i < 50; i++) {
    const { fetch, calls } = makeFakeFetch(defaultHandler);
    const client = installClient({ fetch, pat });
    const op = genMethodCall();
    try {
      await op(client);
    } catch (_) {}
    for (const call of calls) {
      // PAT must appear in Authorization header.
      const auth = (call.init.headers || {})['Authorization'] || '';
      assert.ok(auth.includes(pat), `Authorization missing PAT: ${auth}`);
      // PAT must NOT appear in the URL.
      assert.ok(!call.url.includes(pat), `PAT leaked into URL: ${call.url}`);
      // PAT must NOT appear in the body.
      const body = call.init.body ? String(call.init.body) : '';
      assert.ok(!body.includes(pat), `PAT leaked into body`);
      // PAT must NOT appear in any header other than Authorization.
      for (const [k, v] of Object.entries(call.init.headers || {})) {
        if (k === 'Authorization') continue;
        assert.ok(!String(v).includes(pat), `PAT leaked into header ${k}`);
      }
    }
  }
});

// ── Example tests (required-path contracts) ────────────────────────────────

test('validatePat returns ok + user on 200 from /user and /repos', async () => {
  const { fetch } = makeFakeFetch((url) => {
    if (url.endsWith('/user')) return { status: 200, body: { login: 'alice' } };
    if (url.endsWith('/repos/seedtheword/seedtheword'))
      return { status: 200, body: { permissions: { push: true, pull: true } } };
    return { status: 404, body: '' };
  });
  const client = installClient({ fetch });
  const result = await client.validatePat(FAKE_PAT);
  assert.equal(result.ok, true);
  assert.equal(result.user.login, 'alice');
  assert.equal(result.permissions.push, true);
});

test('validatePat returns ok=false, reason=invalid on 401', async () => {
  const { fetch } = makeFakeFetch(() => ({ status: 401, body: { message: 'Bad credentials' } }));
  const client = installClient({ fetch });
  const result = await client.validatePat(FAKE_PAT);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
});

test('writeFile includes sha and message in the PUT body', async () => {
  const { fetch, calls } = makeFakeFetch(() => ({
    status: 200,
    body: { content: { sha: 'new' }, commit: { sha: 'c', html_url: '#' } },
  }));
  const client = installClient({ fetch });
  await client.writeFile('p', 'hello', { sha: 'baseSha', message: 'm' });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.sha, 'baseSha');
  assert.equal(body.message.endsWith('[via web admin]'), true, `expected audit suffix: ${body.message}`);
  assert.equal(body.branch, 'main');
});

// ── Property 8: No overwrite on conflict (client-level) ────────────────────
//
// When writeFile gets a 409 or 422-sha-mismatch response, it must throw a
// ConflictError and NOT auto-retry the same PUT.

test('Property 8: writeFile does not auto-retry on 409', async () => {
  let putCount = 0;
  const { fetch } = makeFakeFetch((url, init) => {
    if (init.method === 'PUT') {
      putCount++;
      return { status: 409, body: { message: 'sha does not match' } };
    }
    return { status: 200, body: {} };
  });
  const client = installClient({ fetch });
  await assert.rejects(() => client.writeFile('p', 'x', { sha: 's', message: 'm' }), (err) => {
    assert.equal(err.name, 'ConflictError');
    return true;
  });
  assert.equal(putCount, 1, `expected 1 PUT, got ${putCount}`);
});

test('Property 8: writeFile does not auto-retry on 422 sha-mismatch', async () => {
  let putCount = 0;
  const { fetch } = makeFakeFetch((url, init) => {
    if (init.method === 'PUT') {
      putCount++;
      return { status: 422, body: { message: 'Update is not a fast-forward' } };
    }
    return { status: 200, body: {} };
  });
  const client = installClient({ fetch });
  await assert.rejects(() => client.writeFile('p', 'x', { sha: 's', message: 'm' }));
  assert.equal(putCount, 1);
});
