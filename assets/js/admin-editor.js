/* ============================================================
   admin-editor.js — browser orchestrator

   Depends on (all loaded via <script> before this one):
     window.AdminEditor.schemas        (admin-editor-schemas.js)
     window.AdminEditor.github         (admin-editor-github.js)
     window.AdminEditor.diff           (admin-editor-diff.js)
     window.AdminEditor.drafts         (admin-editor-drafts.js)
     window.AdminEditor.validate       (admin-editor-validate.js)
     window.AdminEditor.commitMessage  (admin-editor-commit-message.js)

   Entry point:
     window.AdminEditor.mount(rootEl)

   Exposes a tiny state machine driving:
     locked  -> pat-onboarding -> content-picker -> editing -> diff ->
                confirm -> committing -> success | conflict

   Phase A scope: recommendations content type only; other schemas are
   marked `wip: true` in the registry and skipped by the content picker.

   All HTML rendered here is built via textContent / safe innerHTML of
   renderer output (renderers already escape). Schema-driven form fields
   are built via createElement — never by string templating against raw
   user input.
   ============================================================ */

(function (global) {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────
  const PAT_KEY = 'stwm-admin-pat-v1';
  const PAT_META_KEY = 'stwm-admin-pat-meta-v1';
  const DRY_RUN_KEY = 'stwm-admin-editor-dry-run';

  // The pre-filled GitHub PAT creation URL. Task 1.19 will confirm that
  // Candidate A still pre-fills; if not, fall back to Candidate B.
  const PAT_CREATE_URL_A = 'https://github.com/settings/personal-access-tokens/new?type=beta&target_name=seedtheword&target_repos=seedtheword/seedtheword';
  const PAT_CREATE_URL_B = 'https://github.com/settings/personal-access-tokens/new';
  const COLLABORATORS_URL = 'https://github.com/seedtheword/seedtheword/settings/access';

  // ── Mount / state ───────────────────────────────────────────────────────
  const editor = {
    root: null,
    state: 'idle',
    schemaId: null,
    schema: null,
    form: null,
    baseSha: null,
    origContent: null, // pristine content string from GitHub, for diff
    client: null,
    patMeta: null, // { login, createdAt }
    dryRun: false,
    drafts: null,
    statusEl: null,
  };

  function mount(rootEl) {
    if (!rootEl) {
      console.error('[admin-editor] mount called without a root element');
      return;
    }
    if (editor.root === rootEl) return; // already mounted
    editor.root = rootEl;
    editor.root.classList.add('ae-root');
    editor.drafts = window.AdminEditor.drafts.createStore({});
    editor.dryRun = (localStorage.getItem(DRY_RUN_KEY) || '').toLowerCase() === 'true';
    const pat = localStorage.getItem(PAT_KEY) || '';
    if (editor.dryRun) {
      editor.client = makeDryRunClient();
      editor.patMeta = { login: 'dry-run@local', permissions: { push: true } };
      goto('content-picker');
    } else if (pat) {
      editor.client = window.AdminEditor.github.createClient({ pat: pat });
      goto('validating');
      validateAndContinue(pat);
    } else {
      goto('pat-onboarding');
    }
  }

  function goto(next) {
    editor.state = next;
    render();
  }

  // ── Renderer entry ──────────────────────────────────────────────────────
  function render() {
    if (!editor.root) return;
    clear(editor.root);
    // Dry-run banner
    if (editor.dryRun) {
      const banner = el('div', { className: 'ae-banner ae-banner--dry' });
      banner.textContent = '🧪 DRY RUN — edits log to the console and never touch GitHub. ' +
        'Toggle off with the button at the top of the content picker.';
      editor.root.appendChild(banner);
    }
    const view = {
      'pat-onboarding': renderPatOnboarding,
      'validating': renderValidating,
      'scope-warning': renderScopeWarning,
      'content-picker': renderContentPicker,
      'loading': renderLoading,
      'editing': renderEditing,
      'diff': renderDiff,
      'confirm': renderConfirm,
      'committing': renderCommitting,
      'success': renderSuccess,
      'conflict': renderConflict,
      'workflow-dispatch': renderWorkflowDispatch,
    }[editor.state] || renderIdle;
    view();
    // If a legacy-builder handoff is waiting and we just landed on the content
    // picker, apply it now.
    if (editor.state === 'content-picker' && editor.pendingPrefill) {
      applyPendingPrefillAndOpen();
    }
  }

  function renderIdle() {
    editor.root.appendChild(el('p', { className: 'ae-muted', text: 'Editor is booting…' }));
  }

  function renderLoading() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('p', { className: 'ae-muted', text: 'Loading ' + (editor.schema && editor.schema.path ? editor.schema.path : '') + '…' }));
    editor.root.appendChild(box);
  }

  // ── PAT onboarding ──────────────────────────────────────────────────────
  function renderPatOnboarding() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: '🔐 Connect your GitHub account' }));
    box.appendChild(el('p', {
      text: 'First time? Walk through the 5 steps below. Returning admin? Scroll to step 5.',
      className: 'ae-muted',
    }));

    // Walkthrough
    const ol = el('ol', { className: 'ae-steps' });

    const s1 = el('li', { className: 'ae-step' });
    s1.appendChild(el('strong', { text: 'Step 1 — Confirm you are a Collaborator. ' }));
    s1.appendChild(tagA(COLLABORATORS_URL, 'Open repo Collaborators →'));
    s1.appendChild(el('p', { className: 'ae-muted', text: 'If you are not on the list, ask the team lead to add you (Write access) before continuing.' }));
    ol.appendChild(s1);

    const s2 = el('li', { className: 'ae-step' });
    s2.appendChild(el('strong', { text: 'Step 2 — Open GitHub\'s fine-grained token page. ' }));
    s2.appendChild(tagA(PAT_CREATE_URL_A, 'Open PAT creation page →'));
    s2.appendChild(el('p', { className: 'ae-muted' }));
    s2.lastChild.appendChild(document.createTextNode('If that link does not pre-fill the repo, use '));
    s2.lastChild.appendChild(tagA(PAT_CREATE_URL_B, 'the plain link'));
    s2.lastChild.appendChild(document.createTextNode(' and pick seedtheword/seedtheword manually.'));
    ol.appendChild(s2);

    const s3 = el('li', { className: 'ae-step' });
    s3.appendChild(el('strong', { text: 'Step 3 — Set exactly these permissions:' }));
    const ul = el('ul', { className: 'ae-checklist' });
    ul.appendChild(el('li', { text: 'Repository access → Only select repositories → seedtheword/seedtheword' }));
    ul.appendChild(el('li', { text: 'Repository permissions → Contents: Read and write' }));
    ul.appendChild(el('li', { text: 'Repository permissions → Actions: Read and write' }));
    ul.appendChild(el('li', { text: 'Everything else → No access' }));
    s3.appendChild(ul);
    ol.appendChild(s3);

    const s4 = el('li', { className: 'ae-step' });
    s4.appendChild(el('strong', { text: 'Step 4 — Set expiration to 90 days.' }));
    s4.appendChild(el('p', { className: 'ae-muted', text: 'Admins rotate their tokens every 90 days. Mark the start date below so this page can warn you when rotation is due.' }));
    const dateWrap = el('label', { className: 'ae-field' });
    dateWrap.appendChild(el('span', { text: 'Created on (today):' }));
    const dateInput = el('input', { attrs: { type: 'date', id: 'ae-pat-createdAt', value: new Date().toISOString().slice(0, 10) } });
    dateWrap.appendChild(dateInput);
    s4.appendChild(dateWrap);
    ol.appendChild(s4);

    const s5 = el('li', { className: 'ae-step' });
    s5.appendChild(el('strong', { text: 'Step 5 — Paste the token (starts with github_pat_…):' }));
    const patWrap = el('div', { className: 'ae-paste' });
    const patInput = el('input', { attrs: { type: 'password', id: 'ae-pat-input', placeholder: 'github_pat_...', autocomplete: 'off', spellcheck: 'false' } });
    patWrap.appendChild(patInput);
    const connectBtn = el('button', { className: 'ae-btn ae-btn--primary', text: 'Connect & validate', attrs: { type: 'button' } });
    patWrap.appendChild(connectBtn);
    s5.appendChild(patWrap);
    const errEl = el('p', { className: 'ae-error' });
    s5.appendChild(errEl);
    ol.appendChild(s5);

    connectBtn.addEventListener('click', async () => {
      errEl.textContent = '';
      const pat = (patInput.value || '').trim();
      if (!pat) { errEl.textContent = 'Paste your PAT into the field first.'; return; }
      connectBtn.disabled = true;
      connectBtn.textContent = 'Validating…';
      const client = window.AdminEditor.github.createClient({ pat: pat });
      const result = await client.validatePat(pat);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect & validate';
      if (!result.ok) {
        if (result.reason === 'invalid') {
          errEl.textContent = 'GitHub rejected this token. Check permissions (Contents: Read and Write on seedtheword/seedtheword) and try again.';
        } else if (result.reason === 'no-repo-access') {
          errEl.textContent = 'Token is valid but lacks access to seedtheword/seedtheword. Ask the team lead to add you as a Collaborator.';
        } else if (result.reason === 'network') {
          errEl.textContent = 'Network error reaching GitHub. Check your connection.';
        } else {
          errEl.textContent = 'Validation failed (reason: ' + result.reason + ').';
        }
        return;
      }
      // Success — persist PAT + metadata.
      localStorage.setItem(PAT_KEY, pat);
      const meta = {
        login: result.user && result.user.login,
        createdAt: dateInput.value || new Date().toISOString().slice(0, 10),
        permissions: result.permissions || {},
      };
      localStorage.setItem(PAT_META_KEY, JSON.stringify(meta));
      editor.client = client;
      editor.patMeta = meta;
      goto('content-picker');
    });

    box.appendChild(ol);
    editor.root.appendChild(box);
  }

  async function validateAndContinue(pat) {
    const result = await editor.client.validatePat(pat);
    if (!result.ok) {
      localStorage.removeItem(PAT_KEY);
      localStorage.removeItem(PAT_META_KEY);
      editor.client = null;
      goto('pat-onboarding');
      return;
    }
    try {
      const meta = JSON.parse(localStorage.getItem(PAT_META_KEY) || '{}');
      editor.patMeta = meta && meta.login ? meta : { login: result.user && result.user.login };
    } catch (_) {
      editor.patMeta = { login: result.user && result.user.login };
    }
    goto('content-picker');
  }

  function renderValidating() {
    editor.root.appendChild(el('p', { className: 'ae-muted', text: 'Validating stored PAT with GitHub…' }));
  }

  function renderScopeWarning() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: '⚠️ Missing permission' }));
    box.appendChild(el('p', { text: 'Your token works, but does not have Contents: Read and Write on this repo.' }));
    const row = el('div', { className: 'ae-row' });
    const rotate = el('button', { className: 'ae-btn ae-btn--primary', text: 'Rotate token', attrs: { type: 'button' } });
    rotate.addEventListener('click', () => {
      localStorage.removeItem(PAT_KEY);
      localStorage.removeItem(PAT_META_KEY);
      goto('pat-onboarding');
    });
    row.appendChild(rotate);
    box.appendChild(row);
    editor.root.appendChild(box);
  }

  // ── Content picker ──────────────────────────────────────────────────────
  function renderContentPicker() {
    const box = el('section', { className: 'ae-panel' });

    // Header row with connected username + rotation banner
    const head = el('div', { className: 'ae-head' });
    const who = editor.patMeta && editor.patMeta.login ? editor.patMeta.login : 'connected';
    head.appendChild(el('p', { className: 'ae-muted', text: '👋 Connected as @' + who }));

    const headActions = el('div', { className: 'ae-row' });
    // Friendly dry-run toggle — no devtools required.
    const dryToggle = el('button', {
      className: 'ae-btn ae-btn--ghost',
      text: editor.dryRun ? '🧪 Dry-run ON — click to turn off' : '🧪 Dry-run OFF — click to turn on',
      attrs: { type: 'button', title: 'Dry-run: commits are simulated only. Toggle via localStorage "stwm-admin-editor-dry-run".' },
    });
    dryToggle.addEventListener('click', () => {
      if (editor.dryRun) {
        localStorage.removeItem(DRY_RUN_KEY);
      } else {
        localStorage.setItem(DRY_RUN_KEY, 'true');
      }
      location.reload();
    });
    headActions.appendChild(dryToggle);

    const logout = el('button', { className: 'ae-btn ae-btn--ghost', text: 'Disconnect', attrs: { type: 'button' } });
    logout.addEventListener('click', () => {
      if (!confirm('Disconnect and clear your PAT from this device?')) return;
      localStorage.removeItem(PAT_KEY);
      localStorage.removeItem(PAT_META_KEY);
      editor.client = null;
      editor.patMeta = null;
      goto('pat-onboarding');
    });
    headActions.appendChild(logout);
    head.appendChild(headActions);
    box.appendChild(head);

    // Rotation warning
    const daysLeft = daysUntilRotation();
    if (daysLeft != null && daysLeft <= 30) {
      const warn = el('div', { className: 'ae-banner ae-banner--warn' });
      warn.textContent = '⏰ Your PAT expires in ~' + daysLeft + ' days. Rotate it soon.';
      box.appendChild(warn);
    }

    box.appendChild(el('h2', { text: 'What do you want to edit?' }));

    const list = el('div', { className: 'ae-picker' });
    const active = window.AdminEditor.schemas.listActive();
    for (const schema of active) {
      const card = el('button', { className: 'ae-picker__card', attrs: { type: 'button' } });
      card.appendChild(el('div', { className: 'ae-picker__label', text: schema.label }));
      card.appendChild(el('div', { className: 'ae-picker__path', text: schema.path || '' }));
      card.addEventListener('click', () => openContent(schema.id));
      list.appendChild(card);
    }
    // Show WIP entries as muted disabled cards so admins see what's planned.
    for (const s of Object.values(window.AdminEditor.schemas.SCHEMAS)) {
      if (!s.wip) continue;
      const card = el('div', { className: 'ae-picker__card ae-picker__card--wip' });
      card.appendChild(el('div', { className: 'ae-picker__label', text: s.label }));
      list.appendChild(card);
    }
    box.appendChild(list);
    editor.root.appendChild(box);
  }

  function daysUntilRotation() {
    if (!editor.patMeta || !editor.patMeta.createdAt) return null;
    const createdMs = new Date(editor.patMeta.createdAt).getTime();
    if (!createdMs) return null;
    const DAY = 24 * 60 * 60 * 1000;
    const expiresAt = createdMs + 90 * DAY;
    const left = Math.floor((expiresAt - Date.now()) / DAY);
    return left;
  }

  async function openContent(schemaId) {
    const schema = window.AdminEditor.schemas.SCHEMAS[schemaId];
    if (!schema) return;
    editor.schemaId = schemaId;
    editor.schema = schema;
    editor.form = null;
    editor.baseSha = null;
    editor.origContent = null;
    // Workflow dispatch schemas don't commit a file — they POST to a
    // workflow dispatch endpoint. Route them to the dispatch view.
    if (schema.kind === 'workflow-dispatch') {
      goto('workflow-dispatch');
      loadWorkflowInputs(schema);
      return;
    }
    // Show a "loading" state synchronously; only transition to 'editing'
    // AFTER readFile resolves so the form renderer has a non-null form.
    goto('loading');
    try {
      const file = await editor.client.readFile(schema.path);
      editor.baseSha = file.sha;
      editor.origContent = file.content;
      try {
        editor.form = JSON.parse(file.content);
      } catch (_) {
        // Malformed JSON on the server — fall back to an empty shape so the
        // admin can fix it rather than crashing. Flag it visually.
        editor.form = { listening: [], partners: [] };
        console.warn('[admin-editor] ' + schema.path + ' contains malformed JSON; starting from an empty shape.');
      }
      // Legacy rows for recommendations stored the extracted `id`/`type` but
      // not the original `url`. To keep the editor's single-source-of-truth
      // the URL field, we synthesize a URL for any existing row that has an
      // id but no url. The commit step will re-extract id/type from the URL
      // so the on-disk shape stays consistent.
      if (schemaId === 'recommendations' && editor.form && Array.isArray(editor.form.listening)) {
        editor.form.listening.forEach(function (row) {
          if (!row.url && row.id) {
            if (row.kind === 'spotify') {
              row.url = 'https://open.spotify.com/' + (row.type || 'episode') + '/' + row.id;
            } else if (row.kind === 'youtube') {
              row.url = 'https://www.youtube.com/watch?v=' + row.id;
            }
          }
        });
      }
      // Offer draft restore if applicable
      const draft = editor.drafts.restore(schema.path);
      if (draft && draft.schemaId === schemaId) {
        if (confirm('You have unsaved changes from a previous session. Restore them?')) {
          editor.form = draft.form;
        } else {
          editor.drafts.discard(schema.path);
        }
      }
      goto('editing');
    } catch (err) {
      showError(err);
    }
  }

  // ── Editing view ────────────────────────────────────────────────────────
  function renderEditing() {
    if (!editor.form || !editor.schema) {
      // Safety belt: if we somehow ended up here without a loaded form,
      // bounce back to the content picker rather than crashing.
      goto('content-picker');
      return;
    }
    const box = el('section', { className: 'ae-panel' });

    const head = el('div', { className: 'ae-head' });
    const back = el('button', { className: 'ae-btn ae-btn--ghost', text: '← Back', attrs: { type: 'button' } });
    back.addEventListener('click', () => {
      if (hasUnsavedChanges() && !confirm('Discard unsaved changes?')) return;
      resetEditingState();
      goto('content-picker');
    });
    head.appendChild(back);
    head.appendChild(el('h2', { text: editor.schema.label }));
    box.appendChild(head);

    // Left: form. Right: preview.
    const grid = el('div', { className: 'ae-grid' });

    const formCol = el('div', { className: 'ae-col' });
    formCol.appendChild(el('h3', { text: 'Edit' }));
    const formEl = el('div', { className: 'ae-form' });
    renderForm(formEl, editor.schema, editor.form, onFormChange);
    formCol.appendChild(formEl);
    grid.appendChild(formCol);

    const prevCol = el('div', { className: 'ae-col' });
    prevCol.appendChild(el('h3', { text: 'Live preview' }));
    const prevBody = el('div', { className: 'ae-preview', attrs: { id: 'ae-preview' } });
    prevCol.appendChild(prevBody);
    grid.appendChild(prevCol);

    box.appendChild(grid);

    // Validation status + actions
    const status = el('p', { className: 'ae-status', attrs: { 'aria-live': 'polite' } });
    editor.statusEl = status;
    box.appendChild(status);

    const actions = el('div', { className: 'ae-row ae-row--actions' });
    const reviewBtn = el('button', { className: 'ae-btn ae-btn--primary', text: 'Review changes →', attrs: { type: 'button' } });
    reviewBtn.addEventListener('click', () => {
      const v = window.AdminEditor.validate.validate(editor.schema, editor.form);
      if (!v.ok) {
        status.textContent = '⚠ Fix the highlighted errors before continuing.';
        showValidationErrors(formEl, v.errors);
        return;
      }
      goto('diff');
    });
    actions.appendChild(reviewBtn);
    box.appendChild(actions);

    editor.root.appendChild(box);

    // Initial preview render
    updatePreview();
  }

  function resetEditingState() {
    editor.schemaId = null;
    editor.schema = null;
    editor.form = null;
    editor.baseSha = null;
    editor.origContent = null;
  }

  function hasUnsavedChanges() {
    try {
      return JSON.stringify(editor.form) !== editor.origContent &&
             JSON.stringify(editor.form, null, 2) !== editor.origContent;
    } catch (_) { return false; }
  }

  // Normalize the form state into the shape that should actually be written
  // to the JSON file on disk. The form carries richer/friendlier shapes
  // (e.g. a `url` field on each listening row) than what the site's
  // renderers consume (`id` + `type` for Spotify, `id` for YouTube). We
  // translate at commit time so the on-disk JSON matches what the rest of
  // the site already expects.
  function normalizeFormForCommit(schemaId, form) {
    if (!form) return form;
    if (schemaId !== 'recommendations') {
      // Every other Phase B schema writes the form shape as-is. The `_help`
      // key on each file is preserved because it's part of form (it was
      // parsed in at readFile and never touched by the form UI).
      return form;
    }
    const s = window.AdminEditor.schemas;
    const out = { listening: [], partners: Array.isArray(form.partners) ? form.partners.slice() : [] };
    const listening = Array.isArray(form.listening) ? form.listening : [];
    for (const raw of listening) {
      const row = Object.assign({}, raw);
      if (row.kind === 'spotify') {
        const parsed = s.extractSpotify(row.url || '') || {};
        // Drop the URL field — the site stores id + type, not url.
        delete row.url;
        row.type = parsed.type || row.type || 'episode';
        if (parsed.id) row.id = parsed.id;
      } else if (row.kind === 'youtube') {
        const id = s.extractYouTube(row.url || '');
        delete row.url;
        if (id) row.id = id;
      } else if (row.kind === 'link') {
        // Link rows keep their url as-is.
      }
      // Strip undefined/empty strings for a tidier on-disk file.
      for (const k of Object.keys(row)) {
        if (row[k] == null || row[k] === '') delete row[k];
      }
      out.listening.push(row);
    }
    // Preserve the _help key and any other top-level fields we don't manage.
    for (const k of Object.keys(form)) {
      if (k !== 'listening' && k !== 'partners' && !(k in out)) out[k] = form[k];
    }
    return out;
  }

  function onFormChange() {
    // Debounced draft flush
    editor.drafts.flushDebounced(editor.schemaId, editor.schema.path, editor.baseSha, editor.form);
    // Re-render preview within the next ~250ms (we just call synchronously here)
    updatePreview();
  }

  function updatePreview() {
    const host = document.getElementById('ae-preview');
    if (!host) return;
    clear(host);
    // Pick the first renderer-equipped group that has items, else show JSON.
    const schema = editor.schema;
    const groups = schema.groups || [];
    let rendered = false;
    for (const g of groups) {
      if (!g.renderer) continue;
      const rows = (editor.form && editor.form[g.name]) || [];
      if (!rows.length) continue;
      rendered = true;
      const title = el('p', { className: 'ae-preview__label', text: g.label });
      host.appendChild(title);
      if (g.rendererMode === 'bulk' && typeof window[g.renderer] === 'function') {
        const wrap = el('div');
        try { window[g.renderer](wrap, rows); } catch (err) {
          wrap.textContent = 'Renderer error: ' + (err && err.message);
        }
        host.appendChild(wrap);
      } else if (typeof window[g.renderer] === 'function') {
        const wrap = el('div', { className: 'reco-grid' });
        for (const item of rows) {
          try {
            const html = window[g.renderer](resolveItemForRenderer(g, item));
            const frag = document.createElement('div');
            frag.innerHTML = html; // renderer output is already escaped
            while (frag.firstChild) wrap.appendChild(frag.firstChild);
          } catch (err) {
            const errEl = el('div', { className: 'ae-error', text: 'Renderer error: ' + (err && err.message) });
            wrap.appendChild(errEl);
          }
        }
        host.appendChild(wrap);
      }
    }
    if (!rendered) {
      const pre = el('pre', { className: 'ae-json-preview' });
      pre.textContent = JSON.stringify(editor.form, null, 2);
      host.appendChild(pre);
    }
  }

  function resolveItemForRenderer(group, item) {
    // For listening, the renderer wants { kind, id, type, title, source, note } and
    // the form stores url+title+... We call schemas' helpers to extract the id/type.
    if (group.name !== 'listening') return item;
    const s = window.AdminEditor.schemas;
    if (item.kind === 'spotify') {
      const parsed = s.extractSpotify(item.url || '') || {};
      return { kind: 'spotify', type: parsed.type || 'episode', id: parsed.id || '', title: item.title, source: item.source, note: item.note };
    }
    if (item.kind === 'youtube') {
      return { kind: 'youtube', id: s.extractYouTube(item.url || ''), title: item.title, source: item.source, note: item.note };
    }
    // link
    return { kind: 'link', url: item.url, title: item.title, source: item.source, note: item.note, image: item.image };
  }

  function showValidationErrors(formEl, errors) {
    // Clear previous
    formEl.querySelectorAll('.ae-field__error').forEach((n) => n.remove());
    formEl.querySelectorAll('.ae-field--invalid').forEach((n) => n.classList.remove('ae-field--invalid'));
    for (const path of Object.keys(errors)) {
      const field = formEl.querySelector('[data-path="' + cssEscape(path) + '"]');
      if (!field) continue;
      field.classList.add('ae-field--invalid');
      const err = el('span', { className: 'ae-field__error', text: errors[path] });
      field.appendChild(err);
    }
  }

  // ── Form rendering ──────────────────────────────────────────────────────
  function renderForm(container, schema, form, onChange) {
    // rawJson schemas — skip the schema-driven form, show a single textarea
    // of formatted JSON. Live validation via JSON.parse; on commit the raw
    // textarea content is what gets written. Used for schemas whose shape
    // is too heterogeneous (or too configuration-heavy) to warrant a full
    // structured form in v1.
    if (schema.rawJson) {
      const wrap = el('div', { className: 'ae-field ae-field--rawjson' });
      wrap.appendChild(el('span', { className: 'ae-field__label', text: 'JSON content (edit directly)' }));
      const ta = el('textarea', { attrs: { rows: '24', spellcheck: 'false' } });
      ta.value = JSON.stringify(form, null, 2);
      ta.style.fontFamily = 'SFMono-Regular, Consolas, monospace';
      ta.style.fontSize = '0.9rem';
      ta.addEventListener('input', () => {
        try {
          const parsed = JSON.parse(ta.value);
          // Replace the in-memory form wholesale — the editor's draft autosave
          // and commit path both re-read editor.form.
          editor.form = parsed;
          wrap.classList.remove('ae-field--invalid');
          onChange();
        } catch (err) {
          // Invalid JSON — mark the field, keep the LAST valid form state.
          wrap.classList.add('ae-field--invalid');
        }
      });
      wrap.appendChild(ta);
      wrap.appendChild(el('span', { className: 'ae-hint', text: 'Changes are saved locally as you type; commit validates and writes to GitHub.' }));
      container.appendChild(wrap);
      return;
    }

    const groups = schema.groups || [];
    for (const group of groups) {
      const block = el('fieldset', { className: 'ae-group' });
      block.appendChild(el('legend', { text: group.label || group.name }));
      if (group.kind === 'repeating-group') {
        renderRepeatingGroup(block, group, form, onChange);
      } else if (Array.isArray(group.fields)) {
        for (const field of group.fields) {
          const fieldEl = renderField(field, (form && form[field.name]) || '', (val) => {
            form[field.name] = val;
            onChange();
          }, field.name);
          block.appendChild(fieldEl);
        }
      }
      container.appendChild(block);
    }
  }

  function renderRepeatingGroup(container, group, form, onChange) {
    if (!form || typeof form !== 'object') return; // safety belt
    if (!form[group.name]) form[group.name] = [];
    const rows = form[group.name];
    const listEl = el('ol', { className: 'ae-repeating' });
    container.appendChild(listEl);

    function redraw() {
      clear(listEl);
      rows.forEach((row, idx) => {
        const rowEl = el('li', { className: 'ae-row-card' });
        const header = el('div', { className: 'ae-row-card__head' });
        header.appendChild(el('strong', { text: (group.label || group.name) + ' #' + (idx + 1) }));
        const actions = el('div', { className: 'ae-row-actions' });
        const up = el('button', { text: '↑', attrs: { type: 'button', title: 'Move up' }, className: 'ae-btn ae-btn--ghost' });
        const down = el('button', { text: '↓', attrs: { type: 'button', title: 'Move down' }, className: 'ae-btn ae-btn--ghost' });
        const rm = el('button', { text: '✕', attrs: { type: 'button', title: 'Remove' }, className: 'ae-btn ae-btn--ghost' });
        up.addEventListener('click', () => { if (idx > 0) { const t = rows[idx-1]; rows[idx-1] = row; rows[idx] = t; onChange(); redraw(); } });
        down.addEventListener('click', () => { if (idx < rows.length-1) { const t = rows[idx+1]; rows[idx+1] = row; rows[idx] = t; onChange(); redraw(); } });
        rm.addEventListener('click', () => { if (confirm('Remove this entry?')) { rows.splice(idx, 1); onChange(); redraw(); } });
        actions.appendChild(up); actions.appendChild(down); actions.appendChild(rm);
        header.appendChild(actions);
        rowEl.appendChild(header);

        // Variant selector for listening
        const fields = resolveRowFields(group, row);
        if (group.variants && group.variants.length > 1) {
          const vField = renderField(
            { name: group.variantKey || 'kind', label: 'Kind', kind: 'select', required: true,
              options: group.variants.map((v) => ({ value: v, label: labelForVariant(v) })) },
            row[group.variantKey] || group.variants[0],
            (val) => { row[group.variantKey] = val; onChange(); redraw(); },
            group.name + '[' + idx + '].' + (group.variantKey || 'kind')
          );
          rowEl.appendChild(vField);
        }
        for (const field of fields) {
          if (field.kind === 'hidden') {
            row[field.name] = field.value;
            continue;
          }
          const f = renderField(field, row[field.name] || '', (val) => {
            row[field.name] = val;
            onChange();
          }, group.name + '[' + idx + '].' + field.name);
          rowEl.appendChild(f);
        }
        listEl.appendChild(rowEl);
      });
    }
    redraw();

    const addBtn = el('button', { className: 'ae-btn ae-btn--ghost', text: group.addLabel || '+ Add', attrs: { type: 'button' } });
    addBtn.addEventListener('click', () => {
      const newRow = {};
      if (group.variants && group.variants.length) newRow[group.variantKey || 'kind'] = group.variants[0];
      rows.push(newRow);
      onChange();
      redraw();
    });
    container.appendChild(addBtn);
  }

  function resolveRowFields(group, row) {
    if (Array.isArray(group.fields)) return group.fields;
    if (group.variants && group.variantFields) {
      const key = row[group.variantKey || 'kind'] || group.variants[0];
      return group.variantFields[key] || [];
    }
    return [];
  }

  function labelForVariant(v) {
    return { spotify: '🎙️ Spotify', youtube: '📺 YouTube', link: '🔗 Link / Article', partner: '🤝 Partner' }[v] || v;
  }

  function renderField(field, value, onInput, path) {
    const wrap = el('label', { className: 'ae-field', attrs: { 'data-path': path } });
    const row = el('span', { className: 'ae-field__label' });
    row.appendChild(el('span', { text: field.label || field.name }));
    if (field.required) row.appendChild(el('span', { className: 'ae-required', text: ' *' }));
    wrap.appendChild(row);

    let input;
    if (field.kind === 'textarea') {
      input = el('textarea', { attrs: { rows: '3', placeholder: field.placeholder || '' } });
      input.value = value || '';
    } else if (field.kind === 'select') {
      input = el('select');
      for (const opt of (field.options || [])) {
        const option = el('option', { text: opt.label || opt.value, attrs: { value: opt.value } });
        input.appendChild(option);
      }
      input.value = value || (field.options && field.options[0] && field.options[0].value) || '';
    } else if (field.kind === 'toggle') {
      input = el('input', { attrs: { type: 'checkbox' } });
      input.checked = !!value;
    } else {
      input = el('input', { attrs: { type: field.kind === 'date' ? 'date' : 'text', placeholder: field.placeholder || '' } });
      input.value = value || '';
    }
    input.addEventListener('input', () => {
      const v = field.kind === 'toggle' ? input.checked : input.value;
      onInput(v);
    });
    input.addEventListener('change', () => {
      const v = field.kind === 'toggle' ? input.checked : input.value;
      onInput(v);
    });
    wrap.appendChild(input);

    if (field.hint) wrap.appendChild(el('span', { className: 'ae-hint', text: field.hint }));
    return wrap;
  }

  // ── Diff view ───────────────────────────────────────────────────────────
  function renderDiff() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: 'Review changes' }));
    const before = editor.origContent;
    const after = JSON.stringify(normalizeFormForCommit(editor.schemaId, editor.form), null, 2);
    const changes = window.AdminEditor.diff.diffLines(before, after);
    const adds = changes.filter((c) => c.kind === 'add').length;
    const removes = changes.filter((c) => c.kind === 'remove').length;
    box.appendChild(el('p', { text: '+' + adds + ' added, -' + removes + ' removed' }));

    const pre = el('pre', { className: 'ae-diff' });
    for (const c of changes) {
      const span = document.createElement('span');
      span.className = 'ae-diff__' + c.kind;
      span.textContent = (c.kind === 'equal' ? ' ' : c.kind === 'add' ? '+' : '-') + c.line + '\n';
      pre.appendChild(span);
    }
    box.appendChild(pre);

    const actions = el('div', { className: 'ae-row ae-row--actions' });
    const back = el('button', { className: 'ae-btn ae-btn--ghost', text: '← Back to edit', attrs: { type: 'button' } });
    back.addEventListener('click', () => goto('editing'));
    const next = el('button', { className: 'ae-btn ae-btn--primary', text: 'Commit →', attrs: { type: 'button' } });
    next.addEventListener('click', () => {
      if (adds === 0 && removes === 0) { alert('No changes to commit.'); return; }
      goto('confirm');
    });
    actions.appendChild(back);
    actions.appendChild(next);
    box.appendChild(actions);
    editor.root.appendChild(box);
  }

  // ── Commit confirmation ────────────────────────────────────────────────
  function renderConfirm() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: 'Confirm commit' }));

    const msgWrap = el('label', { className: 'ae-field' });
    msgWrap.appendChild(el('span', { text: 'Commit message (you can edit):' }));
    const msgInput = el('input', { attrs: { type: 'text' } });
    msgInput.value = window.AdminEditor.commitMessage.prefill(editor.schema, editor.form);
    msgWrap.appendChild(msgInput);
    box.appendChild(msgWrap);

    box.appendChild(el('p', { className: 'ae-muted', text: 'Target: ' + editor.schema.path }));

    const err = el('p', { className: 'ae-error' });
    box.appendChild(err);

    const actions = el('div', { className: 'ae-row ae-row--actions' });
    const cancel = el('button', { className: 'ae-btn ae-btn--ghost', text: 'Cancel', attrs: { type: 'button' } });
    cancel.addEventListener('click', () => goto('diff'));
    const confirm = el('button', { className: 'ae-btn ae-btn--primary', text: 'Yes, commit', attrs: { type: 'button' } });
    confirm.addEventListener('click', async () => {
      err.textContent = '';
      const msg = (msgInput.value || '').trim();
      if (!msg) { err.textContent = 'Commit message required.'; return; }
      // Pre-commit validation (double-check)
      const v = window.AdminEditor.validate.validate(editor.schema, editor.form);
      if (!v.ok) { err.textContent = 'Fix validation errors before committing.'; goto('editing'); return; }
      const proposed = JSON.stringify(normalizeFormForCommit(editor.schemaId, editor.form), null, 2);
      let composed;
      try {
        composed = window.AdminEditor.commitMessage.compose(editor.schema, editor.form, msg);
      } catch (e) { err.textContent = e.message; return; }

      // Force-flush draft before risking a network error.
      editor.drafts.flushNow(editor.schemaId, editor.schema.path, editor.baseSha, editor.form);
      goto('committing');

      try {
        const resp = await editor.client.writeFile(editor.schema.path, proposed, {
          sha: editor.baseSha,
          message: composed,
        });
        editor.lastCommit = resp && resp.commit;
        editor.drafts.discard(editor.schema.path);
        goto('success');
      } catch (e) {
        if (e.name === 'ConflictError') {
          editor.conflictError = e;
          goto('conflict');
        } else if (e.name === 'AuthError') {
          localStorage.removeItem(PAT_KEY);
          localStorage.removeItem(PAT_META_KEY);
          editor.client = null;
          alert('Your PAT was rejected. Your work is saved as a draft — reconnect and resume.');
          goto('pat-onboarding');
        } else if (e.name === 'RateLimitError') {
          alert('GitHub rate limit hit. Try again after ' + new Date(e.resetEpoch * 1000).toLocaleTimeString() + '.');
          goto('editing');
        } else if (e.name === 'ForbiddenError') {
          alert(e.message || 'GitHub refused this action (403).');
          goto('editing');
        } else {
          alert('Commit failed: ' + (e.message || e));
          goto('editing');
        }
      }
    });
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    box.appendChild(actions);
    editor.root.appendChild(box);
  }

  function renderCommitting() {
    editor.root.appendChild(el('p', { className: 'ae-muted', text: 'Committing to GitHub…' }));
  }

  function renderSuccess() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: '✅ Committed' }));
    if (editor.lastCommit && editor.lastCommit.html_url) {
      const p = el('p');
      p.appendChild(document.createTextNode('View commit on GitHub: '));
      p.appendChild(tagA(editor.lastCommit.html_url, editor.lastCommit.sha ? editor.lastCommit.sha.slice(0, 7) : 'open'));
      box.appendChild(p);
    }
    box.appendChild(el('p', { className: 'ae-muted', text: 'GitHub Pages will rebuild the site in about 30-60 seconds.' }));
    const actions = el('div', { className: 'ae-row ae-row--actions' });
    const more = el('button', { className: 'ae-btn ae-btn--primary', text: 'Edit another', attrs: { type: 'button' } });
    more.addEventListener('click', () => { resetEditingState(); goto('content-picker'); });
    actions.appendChild(more);
    box.appendChild(actions);
    editor.root.appendChild(box);
  }

  // ── Workflow dispatch view ──────────────────────────────────────────────
  const DISPATCH_MIN_INTERVAL_MS = 30 * 1000;
  const lastDispatchAt = Object.create(null);

  async function loadWorkflowInputs(schema) {
    editor.workflowInputs = null;
    editor.workflowStatus = 'loading';
    render();
    try {
      const inputs = await editor.client.getWorkflowInputs(schema.workflowFile);
      editor.workflowInputs = inputs || [];
      editor.workflowValues = {};
      for (const inp of editor.workflowInputs) {
        editor.workflowValues[inp.name] = inp.default || (inp.type === 'boolean' ? 'false' : '');
      }
      editor.workflowStatus = 'ready';
    } catch (err) {
      editor.workflowInputs = [];
      editor.workflowStatus = 'error';
      editor.workflowError = err && err.message || String(err);
    }
    render();
  }

  function renderWorkflowDispatch() {
    const box = el('section', { className: 'ae-panel' });
    const head = el('div', { className: 'ae-head' });
    const back = el('button', { className: 'ae-btn ae-btn--ghost', text: '← Back', attrs: { type: 'button' } });
    back.addEventListener('click', () => { goto('content-picker'); });
    head.appendChild(back);
    head.appendChild(el('h2', { text: editor.schema.label }));
    box.appendChild(head);

    box.appendChild(el('p', { className: 'ae-muted', text: 'Trigger ' + editor.schema.workflowFile + ' manually. Requires Actions: Read and Write on your PAT.' }));

    if (editor.workflowStatus === 'loading') {
      box.appendChild(el('p', { className: 'ae-muted', text: 'Loading workflow inputs…' }));
      editor.root.appendChild(box);
      return;
    }
    if (editor.workflowStatus === 'error') {
      box.appendChild(el('pre', { className: 'ae-error', text: 'Could not load workflow inputs: ' + editor.workflowError }));
    }

    const inputs = editor.workflowInputs || [];
    if (inputs.length === 0) {
      box.appendChild(el('p', { className: 'ae-muted', text: 'This workflow has no declared inputs — the run will use defaults.' }));
    } else {
      const group = el('fieldset', { className: 'ae-group' });
      group.appendChild(el('legend', { text: 'Inputs' }));
      for (const inp of inputs) {
        const field = renderWorkflowField(inp, editor.workflowValues[inp.name] || '', (v) => {
          editor.workflowValues[inp.name] = v;
        });
        group.appendChild(field);
      }
      box.appendChild(group);
    }

    const statusEl = el('p', { className: 'ae-status', attrs: { 'aria-live': 'polite' } });
    box.appendChild(statusEl);

    const actions = el('div', { className: 'ae-row ae-row--actions' });
    const runBtn = el('button', { className: 'ae-btn ae-btn--primary', text: '▶ Run workflow now', attrs: { type: 'button' } });
    runBtn.addEventListener('click', async () => {
      // 30 s rate limit per workflow per session.
      const lastAt = lastDispatchAt[editor.schema.workflowFile] || 0;
      const since = Date.now() - lastAt;
      if (since < DISPATCH_MIN_INTERVAL_MS) {
        statusEl.textContent = '⏳ Please wait ' + Math.ceil((DISPATCH_MIN_INTERVAL_MS - since) / 1000) + 's before triggering this workflow again.';
        return;
      }
      runBtn.disabled = true;
      runBtn.textContent = 'Dispatching…';
      statusEl.textContent = '';
      try {
        // Convert boolean strings ('true'/'false') into the string values
        // workflow_dispatch expects (GitHub requires strings in the payload).
        const payload = {};
        for (const inp of inputs) {
          const v = editor.workflowValues[inp.name];
          payload[inp.name] = v == null ? '' : String(v);
        }
        await editor.client.dispatchWorkflow(editor.schema.workflowFile, payload);
        lastDispatchAt[editor.schema.workflowFile] = Date.now();
        statusEl.textContent = '✅ Workflow dispatched. ';
        const link = tagA(
          'https://github.com/seedtheword/seedtheword/actions/workflows/' + encodeURIComponent(editor.schema.workflowFile),
          'Watch the run on GitHub Actions →'
        );
        statusEl.appendChild(link);
      } catch (err) {
        if (err && err.name === 'ForbiddenError') {
          statusEl.textContent = '❌ GitHub refused the dispatch. Your PAT may be missing Actions: Read and Write. Rotate it with that scope.';
        } else if (err && err.name === 'RateLimitError') {
          statusEl.textContent = '⏳ GitHub rate limit hit. Try again in a few minutes.';
        } else {
          statusEl.textContent = '❌ Dispatch failed: ' + (err && err.message || err);
        }
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = '▶ Run workflow now';
      }
    });
    actions.appendChild(runBtn);
    box.appendChild(actions);
    editor.root.appendChild(box);
  }

  function renderWorkflowField(inp, value, onChange) {
    const wrap = el('label', { className: 'ae-field' });
    const head = el('span', { className: 'ae-field__label' });
    head.appendChild(el('span', { text: inp.name }));
    if (inp.required) head.appendChild(el('span', { className: 'ae-required', text: ' *' }));
    wrap.appendChild(head);
    let input;
    if (inp.type === 'boolean') {
      // Render as a dropdown (true/false) since workflow_dispatch booleans
      // arrive as strings anyway.
      input = el('select');
      ['false', 'true'].forEach((v) => {
        const opt = el('option', { text: v, attrs: { value: v } });
        input.appendChild(opt);
      });
      input.value = String(value || 'false');
    } else if (inp.type === 'choice' && Array.isArray(inp.options) && inp.options.length) {
      input = el('select');
      for (const opt of inp.options) {
        input.appendChild(el('option', { text: opt, attrs: { value: opt } }));
      }
      input.value = value || inp.options[0];
    } else {
      input = el('input', { attrs: { type: 'text', placeholder: inp.default || '' } });
      input.value = value || '';
    }
    input.addEventListener('input', () => onChange(input.value));
    input.addEventListener('change', () => onChange(input.value));
    wrap.appendChild(input);
    if (inp.description) wrap.appendChild(el('span', { className: 'ae-hint', text: inp.description }));
    return wrap;
  }

  function renderConflict() {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: '⚠️ Someone else committed first' }));
    box.appendChild(el('p', { text: 'The file has changed on GitHub since you loaded it. Your draft is saved.' }));
    const actions = el('div', { className: 'ae-row ae-row--actions' });
    const reload = el('button', { className: 'ae-btn ae-btn--primary', text: 'Reload and redo', attrs: { type: 'button' } });
    reload.addEventListener('click', async () => {
      try {
        const file = await editor.client.readFile(editor.schema.path);
        editor.baseSha = file.sha;
        editor.origContent = file.content;
        const newBase = JSON.parse(file.content);
        // Simple strategy: keep the admin's form values as-is and let them re-confirm.
        // A smarter replay lives in Phase A task 1.17 polish (post-checkpoint).
        alert('File reloaded. Your edits are preserved in the form; review before committing again.');
        goto('editing');
      } catch (e) { alert('Reload failed: ' + (e.message || e)); }
    });
    const cancel = el('button', { className: 'ae-btn ae-btn--ghost', text: 'Cancel', attrs: { type: 'button' } });
    cancel.addEventListener('click', () => goto('editing'));
    actions.appendChild(reload);
    actions.appendChild(cancel);
    box.appendChild(actions);
    editor.root.appendChild(box);
  }

  function showError(err) {
    const box = el('section', { className: 'ae-panel' });
    box.appendChild(el('h2', { text: 'Error' }));
    box.appendChild(el('pre', { className: 'ae-error', text: String(err && err.message || err) }));
    const back = el('button', { className: 'ae-btn ae-btn--ghost', text: '← Back', attrs: { type: 'button' } });
    back.addEventListener('click', () => goto('content-picker'));
    box.appendChild(back);
    editor.root.appendChild(box);
  }

  // Public programmatic entry — the shadow-period "Commit to GitHub" button in
  // the legacy Recommendations builder calls this with a prefilled listening
  // entry. Ensures the editor is mounted, switches to the recommendations
  // schema, reads the file, appends the prefilled entry as a new draft row,
  // and jumps the admin to the Editing view so they can review & commit.
  async function openRecommendationsWith(prefill) {
    if (!editor.root) {
      // Try to find the mount point ourselves so the caller doesn't have to.
      const root = document.getElementById('admin-editor-root');
      const shell = document.getElementById('admin-editor-shell');
      if (!root) {
        console.warn('[admin-editor] openRecommendationsWith: no #admin-editor-root present.');
        return;
      }
      if (shell) { shell.hidden = false; shell.setAttribute('aria-hidden', 'false'); }
      mount(root);
    }
    // If the user hasn't set up a PAT yet (or dry-run is off), we still want
    // to walk them through onboarding — but remember the prefill so we can
    // apply it as soon as they land on the content picker.
    editor.pendingPrefill = prefill;
    // If we are already authenticated / dry-run, go straight in.
    if (editor.state === 'content-picker') {
      applyPendingPrefillAndOpen();
    }
    // If we're still validating, the prefill will be applied when we land on
    // content-picker (see render() after a state change).
  }

  function applyPendingPrefillAndOpen() {
    const prefill = editor.pendingPrefill;
    if (!prefill) return;
    editor.pendingPrefill = null;
    const bucket = (prefill && prefill._bucket === 'partners') ? 'partners' : 'listening';
    const clean = Object.assign({}, prefill);
    delete clean._bucket;
    openContent('recommendations').then(() => {
      if (editor.state !== 'editing' || !editor.form) return;
      if (!Array.isArray(editor.form[bucket])) editor.form[bucket] = [];
      editor.form[bucket].push(clean);
      render();
    });
  }
  function makeDryRunClient() {
    console.info('[admin-editor] DRY RUN active — GitHub writes are logged, not executed.');
    async function fake(op, args) {
      console.info('[dry-run] ' + op, args);
      if (op === 'readFile') {
        // Serve a minimal plausible shape for recommendations.
        return { content: JSON.stringify({ listening: [], partners: [] }, null, 2), sha: 'dryrun-sha', encoding: 'utf-8' };
      }
      if (op === 'writeFile') return { content: { sha: 'dryrun-new' }, commit: { sha: 'dryrun-commit', html_url: '#' } };
      if (op === 'deleteFile') return { commit: { sha: 'dryrun-commit', html_url: '#' } };
      if (op === 'dispatchWorkflow') return { ok: true };
      return null;
    }
    return {
      validatePat: async (pat) => ({ ok: true, user: { login: 'dry-run@local' }, permissions: { push: true, pull: true } }),
      readFile: (path) => fake('readFile', { path }),
      writeFile: (path, content, opts) => fake('writeFile', { path, bytes: content.length, opts }),
      deleteFile: (path, sha, msg) => fake('deleteFile', { path, sha, msg }),
      dispatchWorkflow: (file, inputs) => fake('dispatchWorkflow', { file, inputs }),
      getWorkflowInputs: async (file) => {
        console.info('[dry-run] getWorkflowInputs', { file });
        // Synthesize a reasonable stub so the UI is testable without GitHub.
        if (file === 'telegram-announcements.yml') {
          return [{ name: 'dry_run', description: "If 'true', build and log the message without posting to Telegram", required: false, default: 'false', type: 'boolean', options: [] }];
        }
        return [];
      },
      setPat: () => {}, getPat: () => '',
    };
  }

  // ── Small DOM helpers ───────────────────────────────────────────────────
  function el(tag, opts) {
    const node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.attrs) for (const k of Object.keys(opts.attrs)) node.setAttribute(k, opts.attrs[k]);
    return node;
  }
  function tagA(href, text) {
    return el('a', { text: text, attrs: { href: href, target: '_blank', rel: 'noopener' } });
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
  }

  // ── Public API ──────────────────────────────────────────────────────────
  const api = { mount: mount, openRecommendationsWith: openRecommendationsWith };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.mount = mount;
    global.AdminEditor.openRecommendationsWith = openRecommendationsWith;
  }
})(typeof window !== 'undefined' ? window : globalThis);
