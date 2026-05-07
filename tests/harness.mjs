// Test harness for the browser-admin-editor feature.
//
// Provides:
//   - forAll(gen, predicate, iterations=200) — property-based test runner
//   - sleep(ms) — injectable-clock timer
//   - makeFakeClock() — deterministic clock for retry/debounce tests
//   - makeFakeFetch(handler) — in-memory fetch stub that records (url, init) tuples
//   - makeFakeStorage() — in-memory stand-in for sessionStorage / localStorage
//
// Zero external dependencies — Node's built-in test runner is our only requirement.

import assert from 'node:assert/strict';

// ── Property-based test runner ──────────────────────────────────────────────
//
// Runs `predicate(sample)` for `iterations` samples drawn from `gen()`.
// On failure, throws an Error that includes the offending sample so the
// counterexample is visible in test output.

export function forAll(gen, predicate, iterations = 200) {
  for (let i = 0; i < iterations; i++) {
    const sample = gen();
    try {
      predicate(sample);
    } catch (err) {
      const pretty = safeStringify(sample);
      const msg = err && err.message ? err.message : String(err);
      throw new Error(`forAll failed on iteration ${i} with sample ${pretty}: ${msg}`);
    }
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

// ── Deterministic clock ─────────────────────────────────────────────────────
//
// `sleep(ms, clock?)` resolves after `ms` wall-clock time by default.
// Pass in a fake clock returned by `makeFakeClock()` to advance time
// manually inside a test without actually waiting.

export function sleep(ms, clock) {
  if (clock && typeof clock.sleep === 'function') return clock.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeFakeClock() {
  let now = 0;
  const pending = []; // { at, resolve }

  return {
    now() {
      return now;
    },
    sleep(ms) {
      return new Promise((resolve) => {
        pending.push({ at: now + ms, resolve });
      });
    },
    async advance(ms) {
      now += ms;
      // Resolve any pending sleeps whose deadline has passed, in order.
      const due = pending.filter((p) => p.at <= now).sort((a, b) => a.at - b.at);
      for (const p of due) {
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
        p.resolve();
      }
      // Yield a microtask so awaited resolvers run before the caller continues.
      await Promise.resolve();
    },
    pendingCount() {
      return pending.length;
    },
  };
}

// ── fetch stub ──────────────────────────────────────────────────────────────
//
// makeFakeFetch(handler) returns { fetch, calls } where `fetch` is a drop-in
// for global fetch and `calls` is the array of recorded `(url, init)` tuples.
// `handler(url, init, callIndex)` returns a `{ status, body, headers }` object
// or throws to simulate a network error.

export function makeFakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const callIndex = calls.length;
    calls.push({ url: String(url), init });
    const result = handler(String(url), init, callIndex);
    if (result && typeof result.then === 'function') {
      return wrapResponse(await result);
    }
    return wrapResponse(result);
  };
  return { fetch: fetchImpl, calls };
}

function wrapResponse({ status = 200, body = '', headers = {} } = {}) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const lower = String(name).toLowerCase();
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === lower) return headers[k];
        }
        return null;
      },
    },
    async text() {
      return bodyText;
    },
    async json() {
      return bodyText ? JSON.parse(bodyText) : null;
    },
  };
}

// ── storage stub ────────────────────────────────────────────────────────────
//
// In-memory stand-in for sessionStorage / localStorage. Implements the subset
// of the Storage interface that the admin-editor code uses.

export function makeFakeStorage() {
  const store = new Map();
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(n) {
      return Array.from(store.keys())[n] || null;
    },
    // Convenience for tests:
    _dump() {
      return Object.fromEntries(store);
    },
  };
}

// ── Small generator helpers ─────────────────────────────────────────────────

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function range(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function genAsciiString(minLen = 0, maxLen = 20) {
  const len = range(minLen, maxLen);
  let out = '';
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  for (let i = 0; i < len; i++) out += pick(chars.split(''));
  return out;
}

export function genLineString(minLen = 0, maxLen = 40) {
  const lineCount = range(minLen, maxLen);
  const lines = [];
  for (let i = 0; i < lineCount; i++) lines.push(genAsciiString(0, 30));
  return lines.join('\n');
}

// Re-export assert for convenient test imports.
export { assert };
