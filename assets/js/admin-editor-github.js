/* ============================================================
   admin-editor-github.js

   Thin wrapper around the GitHub REST API for the browser admin
   editor. Supports the Contents_API subset needed by Phase A:
     - validatePat: GET /user + GET /repos/seedtheword/seedtheword
     - readFile:    GET /repos/seedtheword/seedtheword/contents/{path}
     - writeFile:   PUT /repos/seedtheword/seedtheword/contents/{path}
     - deleteFile:  DELETE /repos/seedtheword/seedtheword/contents/{path}
     - dispatchWorkflow: POST /repos/seedtheword/seedtheword/actions/workflows/{file}/dispatches

   Git_Data_API (multi-file / video uploads) is added in Phase C.

   The client is created via createClient({ fetch, pat, storage, clock })
   so tests can inject deterministic dependencies. In production,
   assets/js/admin-editor.js calls createClient with real
   window.fetch / localStorage / Date-backed clock.

   The Authorization header is the ONLY place the PAT ever appears
   outside of the caller's own memory. Property 7 tests assert this.
   ============================================================ */

(function (global) {
  'use strict';

  const REPO_OWNER = 'seedtheword';
  const REPO_NAME = 'seedtheword';
  const REPO_PATH = '/repos/' + REPO_OWNER + '/' + REPO_NAME;
  const API_BASE = 'https://api.github.com';
  const API_VERSION = '2022-11-28';
  const ACCEPT = 'application/vnd.github+json';
  const AUDIT_SUFFIX = ' [via web admin]';

  // Exposed so tests can assert these constants match Property 7 expectations.
  const CONSTANTS = {
    REPO_OWNER: REPO_OWNER,
    REPO_NAME: REPO_NAME,
    API_BASE: API_BASE,
    API_VERSION: API_VERSION,
    ACCEPT: ACCEPT,
    AUDIT_SUFFIX: AUDIT_SUFFIX,
  };

  // ── Errors ──────────────────────────────────────────────────────────────
  function makeError(name, message, extras) {
    const err = new Error(message);
    err.name = name;
    if (extras) Object.assign(err, extras);
    return err;
  }

  // ── base64 helpers (cross-env) ──────────────────────────────────────────
  function b64encode(str) {
    if (typeof btoa === 'function') {
      // Browser: encode UTF-8 bytes first to avoid "Latin-1 only" errors.
      return btoa(unescape(encodeURIComponent(String(str))));
    }
    // Node.
    return Buffer.from(String(str), 'utf-8').toString('base64');
  }

  function b64decode(b64) {
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(b64)));
    }
    return Buffer.from(b64, 'base64').toString('utf-8');
  }

  // ── Create a client with injected deps ─────────────────────────────────
  function createClient(opts) {
    const _fetch = (opts && opts.fetch) ||
      (typeof fetch !== 'undefined' ? fetch : null);
    if (!_fetch) {
      throw new Error('admin-editor-github: no fetch implementation available');
    }
    let pat = (opts && opts.pat) || '';
    const clock = (opts && opts.clock) || {
      now: function () { return Date.now(); },
      sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    };

    function setPat(next) {
      pat = String(next || '');
    }

    function headers(extra) {
      const h = {
        Accept: ACCEPT,
        'X-GitHub-Api-Version': API_VERSION,
      };
      if (pat) h.Authorization = 'Bearer ' + pat;
      if (extra) Object.assign(h, extra);
      return h;
    }

    // Core request helper. Retries 5xx/network errors up to twice with
    // 1 s / 3 s backoff per design Section 7. 4xx is never retried.
    async function request(url, init, options) {
      const maxAttempts = (options && options.retries === false) ? 1 : 3;
      const backoffs = [1000, 3000];
      let lastError = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response;
        try {
          response = await _fetch(url, init);
        } catch (networkErr) {
          lastError = networkErr;
          if (attempt < maxAttempts) {
            await clock.sleep(backoffs[attempt - 1]);
            continue;
          }
          throw makeError('NetworkError', networkErr && networkErr.message || 'network failure', {
            cause: networkErr,
          });
        }

        if (response.status >= 500 && response.status < 600) {
          if (attempt < maxAttempts) {
            await clock.sleep(backoffs[attempt - 1]);
            continue;
          }
          const bodyText = await safeText(response);
          throw makeError('ServerError', 'GitHub returned ' + response.status, {
            status: response.status,
            body: bodyText,
          });
        }

        // Any 2xx / 3xx / 4xx result — return it; callers interpret.
        return response;
      }
      // Unreachable, but for the type checker.
      throw lastError || new Error('request: unknown failure');
    }

    async function safeText(response) {
      try { return await response.text(); } catch (_) { return ''; }
    }

    async function safeJson(response) {
      const text = await safeText(response);
      if (!text) return null;
      try { return JSON.parse(text); } catch (_) { return null; }
    }

    function encodePath(path) {
      return String(path || '').split('/').map(encodeURIComponent).join('/');
    }

    function appendAuditSuffix(message) {
      const msg = String(message || '').trim();
      if (!msg) throw makeError('ValidationError', 'commit message required');
      if (msg.indexOf(AUDIT_SUFFIX) !== -1) return msg;
      // Split subject vs body.
      const parts = msg.split(/\n\n/);
      const subject = parts[0];
      const rest = parts.slice(1).join('\n\n');
      const MAX_SUBJECT = 72;
      let finalSubject;
      let finalBody = rest;
      if (subject.length > MAX_SUBJECT) {
        finalSubject = subject.slice(0, MAX_SUBJECT).replace(/\s+\S*$/, '');
        const overflow = subject.slice(finalSubject.length).replace(/^\s+/, '');
        finalBody = overflow + (rest ? '\n\n' + rest : '');
      } else {
        finalSubject = subject;
      }
      finalSubject = finalSubject + AUDIT_SUFFIX;
      return finalBody ? finalSubject + '\n\n' + finalBody : finalSubject;
    }

    // ── Public methods ──────────────────────────────────────────────────
    async function validatePat(candidate) {
      const prev = pat;
      if (candidate) pat = candidate;
      try {
        const [userResp, repoResp] = await Promise.all([
          request(API_BASE + '/user', { method: 'GET', headers: headers() }, { retries: false }),
          request(API_BASE + REPO_PATH, { method: 'GET', headers: headers() }, { retries: false }),
        ]);

        if (userResp.status === 401 || repoResp.status === 401) {
          return { ok: false, reason: 'invalid' };
        }
        if (repoResp.status === 404 || repoResp.status === 403) {
          return { ok: false, reason: 'no-repo-access' };
        }
        if (!userResp.ok || !repoResp.ok) {
          return { ok: false, reason: 'unknown', status: { user: userResp.status, repo: repoResp.status } };
        }
        const user = await safeJson(userResp);
        const repo = await safeJson(repoResp);
        return {
          ok: true,
          user: user || {},
          permissions: (repo && repo.permissions) || {},
        };
      } catch (err) {
        if (err && err.name === 'NetworkError') return { ok: false, reason: 'network' };
        throw err;
      } finally {
        // validatePat doesn't mutate the stored PAT — that's the caller's job.
        pat = prev || candidate || '';
      }
    }

    async function readFile(path) {
      const url = API_BASE + REPO_PATH + '/contents/' + encodePath(path);
      const resp = await request(url, { method: 'GET', headers: headers() });
      if (resp.status === 404) {
        throw makeError('NotFoundError', 'File not found: ' + path, { status: 404 });
      }
      if (!resp.ok) {
        throw makeError('RequestError', 'GET contents failed: ' + resp.status, { status: resp.status });
      }
      const body = await safeJson(resp);
      if (!body || !body.content) {
        throw makeError('RequestError', 'GET contents: unexpected body', { status: resp.status });
      }
      const raw = String(body.content).replace(/\n/g, '');
      return {
        content: b64decode(raw),
        sha: body.sha,
        encoding: body.encoding || 'base64',
        size: body.size || null,
      };
    }

    async function writeFile(path, content, options) {
      options = options || {};
      const url = API_BASE + REPO_PATH + '/contents/' + encodePath(path);
      const body = {
        message: appendAuditSuffix(options.message),
        content: b64encode(content),
        branch: 'main',
      };
      if (options.sha) body.sha = options.sha;

      const resp = await request(url, {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }, { retries: options.retries !== false ? true : false });

      const respBody = await safeJson(resp);

      if (resp.status === 409) {
        throw makeError('ConflictError', 'File SHA does not match', {
          status: 409,
          message: respBody && respBody.message,
        });
      }
      if (resp.status === 422) {
        const msg = (respBody && respBody.message) || '';
        if (/does not match|sha|not a fast-forward/i.test(msg)) {
          throw makeError('ConflictError', msg, { status: 422, message: msg });
        }
        throw makeError('ValidationError', msg || 'validation failed', { status: 422, message: msg });
      }
      if (resp.status === 401) {
        throw makeError('AuthError', 'Unauthorized', { status: 401 });
      }
      if (resp.status === 403) {
        const h = resp.headers;
        const rateRem = h && h.get && h.get('X-RateLimit-Remaining');
        const rateReset = h && h.get && h.get('X-RateLimit-Reset');
        if (rateRem === '0' && rateReset) {
          throw makeError('RateLimitError', 'GitHub rate limit hit', {
            status: 403,
            resetEpoch: Number(rateReset),
          });
        }
        throw makeError('ForbiddenError', (respBody && respBody.message) || 'Forbidden', {
          status: 403,
        });
      }
      if (!resp.ok) {
        throw makeError('RequestError', 'PUT contents failed: ' + resp.status, {
          status: resp.status,
          message: respBody && respBody.message,
        });
      }
      return respBody;
    }

    async function deleteFile(path, sha, message) {
      const url = API_BASE + REPO_PATH + '/contents/' + encodePath(path);
      const body = {
        message: appendAuditSuffix(message),
        sha: sha,
        branch: 'main',
      };
      const resp = await request(url, {
        method: 'DELETE',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const respBody = await safeJson(resp);
      if (resp.status === 409 || (resp.status === 422 && /sha|match/i.test((respBody && respBody.message) || ''))) {
        throw makeError('ConflictError', (respBody && respBody.message) || 'Conflict', { status: resp.status });
      }
      if (!resp.ok) {
        throw makeError('RequestError', 'DELETE contents failed: ' + resp.status, { status: resp.status });
      }
      return respBody;
    }

    async function dispatchWorkflow(workflowFile, inputs) {
      const url = API_BASE + REPO_PATH + '/actions/workflows/' + encodeURIComponent(workflowFile) + '/dispatches';
      const body = { ref: 'main', inputs: inputs || {} };
      const resp = await request(url, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (resp.status === 204) return { ok: true };
      const respBody = await safeJson(resp);
      if (resp.status === 403) {
        // May be rate-limit, may be scope-missing.
        const h = resp.headers;
        const rateRem = h && h.get && h.get('X-RateLimit-Remaining');
        if (rateRem === '0') {
          throw makeError('RateLimitError', 'GitHub rate limit hit', { status: 403 });
        }
        // Actions:write missing → surface specifically.
        throw makeError('ForbiddenError', (respBody && respBody.message) || 'Forbidden — is Actions: Write granted?', {
          status: 403,
        });
      }
      throw makeError('RequestError', 'dispatch failed: ' + resp.status, { status: resp.status, message: respBody && respBody.message });
    }

    // Fetch workflow metadata including declared workflow_dispatch inputs.
    // GitHub does NOT expose the inputs map directly on the workflow GET
    // endpoint — we have to pull the YAML file contents and parse the
    // `on.workflow_dispatch.inputs` block ourselves. This is kept small
    // and narrow (supports the subset of YAML our workflows use).
    async function getWorkflowInputs(workflowFile) {
      const path = '.github/workflows/' + workflowFile;
      try {
        const file = await readFile(path);
        return parseWorkflowDispatchInputs(file.content);
      } catch (_) {
        return [];
      }
    }

    return {
      validatePat: validatePat,
      readFile: readFile,
      writeFile: writeFile,
      deleteFile: deleteFile,
      dispatchWorkflow: dispatchWorkflow,
      getWorkflowInputs: getWorkflowInputs,
      setPat: setPat,
      getPat: function () { return pat; },
      constants: CONSTANTS,
      _appendAuditSuffix: appendAuditSuffix, // exposed for commit-message tests
    };
  }

  // Tiny YAML subset parser: extracts the workflow_dispatch inputs block so
  // the editor can render a matching form. We only support the fields we
  // use in this repo's workflows:
  //   on:
  //     workflow_dispatch:
  //       inputs:
  //         <name>:
  //           description: "..."
  //           required: true|false
  //           default: "..."
  //           type: string|boolean|choice
  //           options: [a, b, c]         # only when type=choice
  //
  // Returns an array of { name, description, required, default, type, options }.
  function parseWorkflowDispatchInputs(yamlSource) {
    const src = String(yamlSource || '');
    const lines = src.split(/\r?\n/);
    // Locate "workflow_dispatch:" anchor and the "inputs:" block nested under it.
    let inputsIdx = -1;
    let inputsIndent = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const m = ln.match(/^(\s*)workflow_dispatch:\s*$/);
      if (!m) continue;
      const wdIndent = m[1].length;
      // Walk forward to find a matching inputs: block.
      for (let j = i + 1; j < lines.length; j++) {
        const ln2 = lines[j];
        if (!ln2.trim()) continue;
        const indent = ln2.match(/^(\s*)/)[1].length;
        if (indent <= wdIndent) break;
        const im = ln2.match(/^(\s*)inputs:\s*$/);
        if (im) { inputsIdx = j; inputsIndent = im[1].length; break; }
      }
      if (inputsIdx >= 0) break;
    }
    if (inputsIdx < 0) return [];

    const results = [];
    let current = null;
    let baseIndent = -1; // indent of a named input key (e.g. dry_run:)
    for (let i = inputsIdx + 1; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.trim()) continue;
      const indent = ln.match(/^(\s*)/)[1].length;
      if (indent <= inputsIndent) break;
      if (baseIndent < 0) baseIndent = indent;
      // Named input line: `  <name>:`
      if (indent === baseIndent && /^\s*[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(ln)) {
        if (current) results.push(current);
        const name = ln.trim().replace(/:$/, '');
        current = { name: name, description: '', required: false, default: '', type: 'string', options: [] };
        continue;
      }
      if (!current) continue;
      const kv = ln.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      let val = kv[2].trim();
      // Strip surrounding quotes (single or double).
      val = val.replace(/^['"]|['"]$/g, '');
      if (key === 'description') current.description = val;
      else if (key === 'required') current.required = (val === 'true');
      else if (key === 'default') current.default = val;
      else if (key === 'type') current.type = val || 'string';
      else if (key === 'options') {
        // YAML flow-style inline list `[a, b, c]`.
        const m = val.match(/^\[(.*)\]$/);
        if (m) current.options = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      }
    }
    if (current) results.push(current);
    return results;
  }

  const api = { createClient: createClient, constants: CONSTANTS, parseWorkflowDispatchInputs: parseWorkflowDispatchInputs };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.github = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
