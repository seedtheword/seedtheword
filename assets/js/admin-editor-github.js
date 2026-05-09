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

  // Binary bytes → base64. Uint8Array input in both environments.
  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined' && Buffer.from) {
      return Buffer.from(bytes).toString('base64');
    }
    // Browser fallback: btoa + raw-byte string via String.fromCharCode chunks.
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // Read a Blob/File into an ArrayBuffer. Uses FileReader in the browser,
  // falls back to a tests-friendly .arrayBuffer() method on stub Blobs.
  function readBlobAsArrayBuffer(blob) {
    if (!blob) return Promise.resolve(new ArrayBuffer(0));
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === 'undefined') {
        reject(new Error('no way to read Blob in this environment'));
        return;
      }
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('blob read failed')); };
      fr.readAsArrayBuffer(blob);
    });
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

    // ── Git Data API — multi-file and large-file commits ──────────────────
    //
    // Commits > 1 MB single-file and > 1 file per commit cannot use the
    // Contents_API path. The Git Data API flow is documented in design
    // Section 7 as a six-step sequence:
    //   1. POST /git/blobs      (per file, returns blob sha)
    //   2. GET  /git/refs/heads/main          (current head sha)
    //   3. GET  /git/commits/{headSha}        (tree sha of head commit)
    //   4. POST /git/trees                    (new tree with base_tree + edits)
    //   5. POST /git/commits                  (new commit with tree + parent)
    //   6. PATCH /git/refs/heads/main         (fast-forward main to new commit)
    //
    // Step 6 rejection (422 "not a fast-forward") means another commit
    // landed between steps 2 and 6. We surface that as a ConflictError
    // with the same UX as the Contents_API conflict path.
    //
    // files: array of { path: string, content: Uint8Array | ArrayBuffer | string }
    //   - binary content: pass Uint8Array / ArrayBuffer. Encoding: 'base64'.
    //   - text content: pass a string. Encoding: 'utf-8'.
    async function commitMultipleFiles(files, message) {
      if (!Array.isArray(files) || files.length === 0) {
        throw makeError('ValidationError', 'commitMultipleFiles: at least one file required');
      }

      // Step 1 — create a blob per file.
      const blobs = [];
      for (const file of files) {
        const isBinary = file.content instanceof Uint8Array || file.content instanceof ArrayBuffer;
        let payload;
        let encoding;
        if (isBinary) {
          const bytes = file.content instanceof ArrayBuffer
            ? new Uint8Array(file.content)
            : file.content;
          payload = bytesToBase64(bytes);
          encoding = 'base64';
        } else {
          payload = b64encode(file.content);
          encoding = 'base64';
        }
        const resp = await request(API_BASE + REPO_PATH + '/git/blobs', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ content: payload, encoding: encoding }),
        });
        const body = await safeJson(resp);
        if (!resp.ok || !body || !body.sha) {
          throw makeError('RequestError', 'blob create failed: ' + resp.status, {
            status: resp.status,
            message: body && body.message,
          });
        }
        blobs.push({ path: file.path, sha: body.sha, mode: file.mode || '100644', type: 'blob' });
      }

      // Step 2 — current head.
      const refResp = await request(API_BASE + REPO_PATH + '/git/refs/heads/main', {
        method: 'GET',
        headers: headers(),
      });
      const refBody = await safeJson(refResp);
      if (!refResp.ok || !refBody || !refBody.object) {
        throw makeError('RequestError', 'ref/heads/main fetch failed: ' + refResp.status, { status: refResp.status });
      }
      const headSha = refBody.object.sha;

      // Step 3 — tree sha of head commit.
      const commitResp = await request(API_BASE + REPO_PATH + '/git/commits/' + headSha, {
        method: 'GET',
        headers: headers(),
      });
      const commitBody = await safeJson(commitResp);
      if (!commitResp.ok || !commitBody || !commitBody.tree) {
        throw makeError('RequestError', 'head commit fetch failed: ' + commitResp.status, { status: commitResp.status });
      }
      const baseTreeSha = commitBody.tree.sha;

      // Step 4 — new tree.
      const treeResp = await request(API_BASE + REPO_PATH + '/git/trees', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ base_tree: baseTreeSha, tree: blobs }),
      });
      const treeBody = await safeJson(treeResp);
      if (!treeResp.ok || !treeBody || !treeBody.sha) {
        throw makeError('RequestError', 'tree create failed: ' + treeResp.status, {
          status: treeResp.status,
          message: treeBody && treeBody.message,
        });
      }
      const newTreeSha = treeBody.sha;

      // Step 5 — new commit.
      const commitCreateResp = await request(API_BASE + REPO_PATH + '/git/commits', {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: appendAuditSuffix(message),
          tree: newTreeSha,
          parents: [headSha],
        }),
      });
      const commitCreateBody = await safeJson(commitCreateResp);
      if (!commitCreateResp.ok || !commitCreateBody || !commitCreateBody.sha) {
        throw makeError('RequestError', 'commit create failed: ' + commitCreateResp.status, {
          status: commitCreateResp.status,
          message: commitCreateBody && commitCreateBody.message,
        });
      }
      const newCommitSha = commitCreateBody.sha;

      // Step 6 — fast-forward main.
      const refUpdateResp = await request(API_BASE + REPO_PATH + '/git/refs/heads/main', {
        method: 'PATCH',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sha: newCommitSha, force: false }),
      });
      const refUpdateBody = await safeJson(refUpdateResp);
      if (refUpdateResp.status === 422) {
        const msg = (refUpdateBody && refUpdateBody.message) || 'not a fast-forward';
        if (/fast-forward|does not match/i.test(msg)) {
          throw makeError('ConflictError', msg, { status: 422, message: msg });
        }
        throw makeError('ValidationError', msg, { status: 422, message: msg });
      }
      if (!refUpdateResp.ok) {
        throw makeError('RequestError', 'ref update failed: ' + refUpdateResp.status, {
          status: refUpdateResp.status,
          message: refUpdateBody && refUpdateBody.message,
        });
      }

      return {
        commit: {
          sha: newCommitSha,
          html_url: 'https://github.com/seedtheword/seedtheword/commit/' + newCommitSha,
        },
      };
    }

    // Upload a single binary blob (image/video). Routes to Contents_API for
    // ≤1 MB images and to Git_Data_API for anything bigger OR any video.
    async function uploadBinary(path, blob, options) {
      options = options || {};
      const mime = (blob && blob.type) || '';
      const size = (blob && blob.size) || 0;
      const isVideo = mime.indexOf('video/') === 0;
      const useGitData = isVideo || size > 1024 * 1024 || options.forceGitData === true;

      // Read bytes. ArrayBuffer → Uint8Array.
      const buf = await readBlobAsArrayBuffer(blob);
      const bytes = new Uint8Array(buf);

      if (useGitData) {
        return commitMultipleFiles([{ path: path, content: bytes }], options.message || 'content: upload');
      }

      // Contents_API path: PUT with base64 body.
      return writeFileBinary(path, bytes, options);
    }

    // writeFile variant that takes raw bytes instead of a UTF-8 string. The
    // existing writeFile() always UTF-8-encodes, which corrupts binary. This
    // uses the same endpoint but with raw base64 payload.
    async function writeFileBinary(path, bytes, options) {
      options = options || {};
      const url = API_BASE + REPO_PATH + '/contents/' + encodePath(path);
      const body = {
        message: appendAuditSuffix(options.message),
        content: bytesToBase64(bytes),
        branch: 'main',
      };
      if (options.sha) body.sha = options.sha;
      const resp = await request(url, {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const respBody = await safeJson(resp);
      if (resp.status === 409) throw makeError('ConflictError', 'File SHA does not match', { status: 409 });
      if (resp.status === 422) {
        const msg = (respBody && respBody.message) || '';
        if (/does not match|sha|not a fast-forward/i.test(msg)) {
          throw makeError('ConflictError', msg, { status: 422, message: msg });
        }
        throw makeError('ValidationError', msg || 'validation failed', { status: 422, message: msg });
      }
      if (resp.status === 401) throw makeError('AuthError', 'Unauthorized', { status: 401 });
      if (resp.status === 403) throw makeError('ForbiddenError', (respBody && respBody.message) || 'Forbidden', { status: 403 });
      if (!resp.ok) throw makeError('RequestError', 'PUT contents failed: ' + resp.status, { status: resp.status });
      return respBody;
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
      uploadBinary: uploadBinary,
      commitMultipleFiles: commitMultipleFiles,
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
