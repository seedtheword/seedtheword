/* ============================================================
   admin-editor-drafts.js

   Draft persistence for in-progress editor form state. Uses
   sessionStorage only (not localStorage) per Requirement 17.5 so
   drafts do not survive tab-close on shared devices.

   Key shape:    stwm-admin-draft:{contentPath}
   TTL:          24 hours (enforced lazily on restore)
   Flush cadence:
     - flushDebounced(...)  — 1 s debounced autosave on every field change
     - flushNow(...)        — forced flush (called before write calls, on 401,
                              and on window 'beforeunload')

   Payload shape (JSON):
     {
       schemaId: string,
       baseSha:  string,
       savedAt:  number (epoch ms),
       form:     any
     }

   Validates: Requirement 13.7, 17.1, 17.2, 17.3, 17.4, 17.5
   ============================================================ */

(function (global) {
  'use strict';

  const KEY_PREFIX = 'stwm-admin-draft:';
  const DEBOUNCE_MS = 1000;
  const TTL_MS = 24 * 60 * 60 * 1000;

  function createStore(opts) {
    const storage = (opts && opts.storage) ||
      (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    if (!storage) {
      throw new Error('admin-editor-drafts: no storage implementation available');
    }
    const clock = (opts && opts.clock) || {
      now: function () { return Date.now(); },
      sleep: function (ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
      },
    };

    // Pending debounce timers keyed by path. Each entry is either
    //   { timer: opaque, resolve: fn, fakeTimer?: { at, cancelled } }
    // Browser path uses setTimeout; fake-clock path uses a polling loop
    // scheduled via clock.sleep so tests advance time deterministically.
    const pending = new Map();

    function keyFor(path) {
      return KEY_PREFIX + String(path);
    }

    function serialize(schemaId, baseSha, form) {
      const payload = {
        schemaId: String(schemaId || ''),
        baseSha: String(baseSha || ''),
        savedAt: clock.now(),
        form: form,
      };
      return JSON.stringify(payload);
    }

    function flushNow(schemaId, path, baseSha, form) {
      const key = keyFor(path);
      storage.setItem(key, serialize(schemaId, baseSha, form));
      // Cancel any pending debounce for this path — no point firing it now.
      cancelPending(path);
    }

    function cancelPending(path) {
      const entry = pending.get(path);
      if (!entry) return;
      if (entry.fakeTimer) entry.fakeTimer.cancelled = true;
      if (entry.timer && typeof clearTimeout === 'function') {
        try { clearTimeout(entry.timer); } catch (_) { /* ignore */ }
      }
      pending.delete(path);
    }

    function flushDebounced(schemaId, path, baseSha, form) {
      cancelPending(path);

      // Detect whether we're in a fake-clock environment: our fake clock
      // returns a number that doesn't match Date.now() (since it starts
      // at 0). Easier tell: does clock.sleep exist AND is it not the
      // native setTimeout wrapper? We dispatch on presence of advance().
      const usingFakeClock = clock.advance && typeof clock.advance === 'function';

      if (usingFakeClock) {
        const entry = { fakeTimer: { cancelled: false } };
        pending.set(path, entry);
        // Poll: sleep DEBOUNCE_MS, then if not cancelled, flush.
        clock.sleep(DEBOUNCE_MS).then(function () {
          if (entry.fakeTimer.cancelled) return;
          storage.setItem(keyFor(path), serialize(schemaId, baseSha, form));
          pending.delete(path);
        });
      } else {
        const timer = setTimeout(function () {
          storage.setItem(keyFor(path), serialize(schemaId, baseSha, form));
          pending.delete(path);
        }, DEBOUNCE_MS);
        pending.set(path, { timer: timer });
      }
    }

    function restore(path) {
      const key = keyFor(path);
      const raw = storage.getItem(key);
      if (!raw) return null;
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (_) {
        storage.removeItem(key);
        return null;
      }
      if (!parsed || typeof parsed !== 'object') {
        storage.removeItem(key);
        return null;
      }
      const savedAt = Number(parsed.savedAt) || 0;
      if (clock.now() - savedAt > TTL_MS) {
        storage.removeItem(key);
        return null;
      }
      return parsed;
    }

    function discard(path) {
      cancelPending(path);
      storage.removeItem(keyFor(path));
    }

    function list() {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) keys.push(k.slice(KEY_PREFIX.length));
      }
      return keys;
    }

    function hasPending(path) {
      return pending.has(path);
    }

    return {
      flushNow: flushNow,
      flushDebounced: flushDebounced,
      restore: restore,
      discard: discard,
      list: list,
      hasPending: hasPending,
    };
  }

  const api = { createStore: createStore, KEY_PREFIX: KEY_PREFIX, DEBOUNCE_MS: DEBOUNCE_MS, TTL_MS: TTL_MS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.drafts = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
