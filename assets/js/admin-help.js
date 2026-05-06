/* ============================================================
   Admin Help page — gate, search, TOC, recommendations builder,
   and Mermaid flowchart loader.

   The page itself is gated by a simple SHA-256 hash check (client
   side only — not meant to be strong security). Once unlocked,
   the TOC + search + reco-builder all activate lazily.
   ============================================================ */

(function () {
  'use strict';

  const SALT = 'stwm-2026-admin-gate';
  const EXPECTED_HASH = '2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440';
  const SESSION_KEY = 'stwm-admin-unlocked';

  const gate      = document.getElementById('admin-gate');
  const content   = document.getElementById('admin-content');
  const form      = document.getElementById('gate-form');
  const input     = document.getElementById('gate-input');
  const errorEl   = document.getElementById('gate-error');
  const logoutBtn = document.getElementById('admin-logout');

  if (!gate || !content || !form) {
    console.error('Admin help: required gate elements missing.');
    return;
  }

  // ── Gate logic ─────────────────────────────────────────────
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function unlock() {
    gate.style.display = 'none';
    content.classList.add('visible');
    const shell = document.getElementById('admin-shell');
    if (shell) shell.classList.add('visible');
    // Each init is idempotent and failure-tolerant so one broken
    // feature doesn't kill the others.
    safeRun('search', initAdminSearch);
    safeRun('reco-builder', initRecoBuilder);
    safeRun('mermaid', loadMermaid);
  }

  function lock() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  function safeRun(name, fn) {
    try { fn(); } catch (err) {
      console.error('[admin-help] ' + name + ' init failed:', err);
    }
  }

  // Auto-unlock if we've already authenticated this session
  try {
    if (sessionStorage.getItem(SESSION_KEY) === '1') unlock();
  } catch (e) { /* ignore */ }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = '';
    const attempt = (input && input.value) || '';
    const hash = await sha256(SALT + attempt);
    if (hash === EXPECTED_HASH) {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (err) { /* ignore */ }
      unlock();
    } else {
      if (errorEl) errorEl.textContent = 'Incorrect password. Try again.';
      if (input) { input.value = ''; input.focus(); }
    }
  });

  if (logoutBtn) logoutBtn.addEventListener('click', lock);

  // ── Search + Table of Contents ────────────────────────────
  let searchInit = false;
  function initAdminSearch() {
    if (searchInit) return;

    const searchEl = document.getElementById('admin-search-input');
    const clearBtn = document.getElementById('admin-search-clear');
    const kbdHint  = document.getElementById('admin-search-kbd');
    const metaEl   = document.getElementById('admin-search-meta');
    const tocList  = document.getElementById('admin-toc-list');
    const sideList = document.getElementById('admin-side-list');
    if (!searchEl || !tocList) return;
    searchInit = true;

    // Build sections: each h2 heading + its siblings up to the next h2
    const sections = [];
    const h2s = content.querySelectorAll('main#admin-content > h2');
    h2s.forEach((h2) => {
      const id = slugify(h2.textContent);
      h2.id = id;
      const nodes = [h2];
      let n = h2.nextElementSibling;
      while (n && n.tagName !== 'H2') {
        nodes.push(n);
        n = n.nextElementSibling;
      }
      // Haystack excludes .mermaid source so raw graph syntax doesn't match
      const parts = [];
      nodes.forEach((nd) => {
        const clone = nd.cloneNode(true);
        clone.querySelectorAll('.mermaid').forEach((m) => m.remove());
        parts.push(clone.textContent || '');
      });
      sections.push({
        id: id,
        title: h2.textContent.trim(),
        nodes: nodes,
        haystack: parts.join(' ').toLowerCase()
      });
    });

    // Render TOC chips (mobile-inline list) + side list (desktop sticky)
    const tocChipsHtml = sections.map((s) => (
      '<li><a class="admin-toc__link" href="#' + s.id +
      '" data-section-id="' + s.id + '">' +
      escapeHtml(s.title) + '</a></li>'
    )).join('');
    tocList.innerHTML = tocChipsHtml;

    if (sideList) {
      sideList.innerHTML = sections.map((s) => (
        '<li><a class="admin-side__link" href="#' + s.id +
        '" data-section-id="' + s.id + '">' +
        escapeHtml(s.title) + '</a></li>'
      )).join('');
    }

    function clearHighlights() {
      content.querySelectorAll('mark.admin-search-hit').forEach((mark) => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      });
    }

    function highlight(query) {
      const re = new RegExp(escapeRegExp(query), 'gi');
      sections.forEach((s) => {
        if (s.nodes[0].getAttribute('data-search-hidden') === 'true') return;
        s.nodes.slice(1).forEach((root) => walkAndMark(root, re));
      });
    }

    function walkAndMark(root, re) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.nodeName === 'MARK' && p.classList.contains('admin-search-hit')) return NodeFilter.FILTER_REJECT;
          if (p.closest('#admin-search')) return NodeFilter.FILTER_REJECT;
          if (p.closest('.mermaid')) return NodeFilter.FILTER_REJECT;
          if (p.closest('svg')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const targets = [];
      let n;
      while ((n = walker.nextNode())) {
        if (re.test(n.nodeValue)) { re.lastIndex = 0; targets.push(n); }
      }
      targets.forEach((node) => {
        const frag = document.createDocumentFragment();
        const text = node.nodeValue;
        let last = 0;
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const mark = document.createElement('mark');
          mark.className = 'admin-search-hit';
          mark.textContent = m[0];
          frag.appendChild(mark);
          last = m.index + m[0].length;
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    }

    function applyFilter(raw) {
      const q = (raw || '').trim().toLowerCase();
      if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';
      if (kbdHint)  kbdHint.style.display  = q ? 'none' : 'inline-flex';
      clearHighlights();

      if (!q) {
        sections.forEach((s) => s.nodes.forEach((n) => n.removeAttribute('data-search-hidden')));
        tocList.querySelectorAll('.admin-toc__link').forEach((a) => a.removeAttribute('hidden'));
        if (sideList) sideList.querySelectorAll('.admin-side__link').forEach((a) => a.removeAttribute('hidden'));
        if (metaEl) { metaEl.classList.remove('is-no-results'); metaEl.textContent = ''; }
        return;
      }

      let matches = 0;
      sections.forEach((s) => {
        const hit = s.haystack.includes(q);
        s.nodes.forEach((n) => {
          if (hit) n.removeAttribute('data-search-hidden');
          else     n.setAttribute('data-search-hidden', 'true');
        });
        // Filter both the inline TOC chips and the side rail
        const link = tocList.querySelector('[data-section-id="' + s.id + '"]');
        if (link) {
          if (hit) link.removeAttribute('hidden');
          else     link.setAttribute('hidden', '');
        }
        if (sideList) {
          const sideLink = sideList.querySelector('[data-section-id="' + s.id + '"]');
          if (sideLink) {
            if (hit) sideLink.removeAttribute('hidden');
            else     sideLink.setAttribute('hidden', '');
          }
        }
        if (hit) matches++;
      });

      if (matches > 0) highlight(q);

      if (metaEl) {
        if (matches === 0) {
          metaEl.classList.add('is-no-results');
          metaEl.textContent = 'No tutorials found for "' + raw.trim() + '". Try a different term.';
        } else {
          metaEl.classList.remove('is-no-results');
          metaEl.textContent = (matches === 1 ? '1 section' : matches + ' sections') + ' match "' + raw.trim() + '"';
        }
      }
    }

    // Events
    let debounce;
    searchEl.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => applyFilter(e.target.value), 60);
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchEl.value = '';
        applyFilter('');
        searchEl.blur();
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchEl.value = '';
        applyFilter('');
        searchEl.focus();
      });
    }

    // Global "/" shortcut focuses the search
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/') return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
    });

    // Smooth scroll for TOC chips + side rail
    function handleTocClick(e) {
      const link = e.target.closest('.admin-toc__link, .admin-side__link');
      if (!link) return;
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    tocList.addEventListener('click', handleTocClick);
    if (sideList) sideList.addEventListener('click', handleTocClick);
  }

  // ── Recommendations builder ───────────────────────────────
  let recoBuilderInit = false;
  let recoKind = 'spotify';
  let recoRendererLoaded = false;

  function ensureRecoRenderer() {
    if (recoRendererLoaded) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'assets/js/recommendations.js?t=' + Date.now();
      s.onload = () => { recoRendererLoaded = true; resolve(); };
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  const recoSchemas = {
    spotify: {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'Spotify URL',             placeholder: 'https://open.spotify.com/episode/1Y4cct2…', hint: 'Paste the full URL — ID and type (episode/show) auto-detected.' },
        { name: 'type',   label: 'Type (auto-detected)',    kind: 'select', options: [['episode', 'Episode'], ['show', 'Show']] },
        { name: 'title',  label: 'Title',                   placeholder: 'Intimacy With God Is Everything' },
        { name: 'source', label: 'Source / show name',      placeholder: 'After the Heart Podcast — Episode 38' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' }
      ]
    },
    youtube: {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'YouTube URL',        placeholder: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', hint: "watch?v=, youtu.be/, and /embed/ all work." },
        { name: 'title',  label: 'Title',              placeholder: 'Sermon on the Mount — Part 1' },
        { name: 'source', label: 'Source / channel',   placeholder: 'The Bible Project' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' }
      ]
    },
    link: {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'Full URL',           placeholder: 'https://example.com/sermon' },
        { name: 'title',  label: 'Title',              placeholder: 'Article or sermon title' },
        { name: 'source', label: 'Source / author',    placeholder: 'Author or ministry name' },
        { name: 'note',   label: 'Why it matters (optional)', kind: 'textarea', placeholder: 'One line about why we recommend this.' },
        { name: 'image',  label: 'Thumbnail image path (optional)', placeholder: 'assets/images/featured/some-image.jpg', hint: 'Leave blank for a generic card.' }
      ]
    },
    partner: {
      destination: 'Paste inside the <code>"partners"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'name',        label: 'Partner name',                    placeholder: 'Slavic Christian Awakening' },
        { name: 'url',         label: 'Partner website',                 placeholder: 'https://partner-site.com' },
        { name: 'logo',        label: 'Logo path (optional)',            placeholder: 'assets/images/partners/partner-logo.png', hint: 'Upload logo first, then put its path here.' },
        { name: 'description', label: 'One-sentence description (optional)', kind: 'textarea', placeholder: 'One sentence about what they do together with STW.' }
      ]
    }
  };

  function initRecoBuilder() {
    if (recoBuilderInit) return;
    const fieldsEl  = document.getElementById('reco-builder-fields');
    const output    = document.getElementById('reco-builder-output');
    const destEl    = document.getElementById('reco-builder-destination');
    const copyBtn   = document.getElementById('reco-builder-copy');
    const resetBtn  = document.getElementById('reco-builder-reset');
    const statusEl  = document.getElementById('reco-builder-status');
    const previewEl = document.getElementById('reco-builder-preview');
    const tabs      = document.querySelectorAll('.reco-builder__tab');
    if (!fieldsEl || !output || !copyBtn || !previewEl) return;
    recoBuilderInit = true;

    ensureRecoRenderer();

    function renderFields() {
      const schema = recoSchemas[recoKind];
      fieldsEl.innerHTML = '<div class="reco-builder__grid">' +
        schema.fields.map(renderField).join('') + '</div>';
      fieldsEl.querySelectorAll('input, select, textarea').forEach((el) => {
        el.addEventListener('input', updateAll);
        el.addEventListener('change', updateAll);
      });
      if (destEl) {
        destEl.innerHTML = schema.destination + ' Add a comma after the previous block\'s closing <code>}</code>. The last item in the array should NOT have a trailing comma.';
      }
      updateAll();
    }

    function renderField(f) {
      const id = 'reco-f-' + f.name;
      const hint = f.hint ? '<span class="hint">' + escapeHtml(f.hint) + '</span>' : '';
      const isFull = f.kind === 'textarea' || f.name === 'url' || f.name === 'note' || f.name === 'description' || f.name === 'logo' || f.name === 'image';
      const fullCls = isFull ? ' reco-builder__field--full' : '';

      if (f.kind === 'select') {
        const opts = f.options.map((o) => '<option value="' + escapeAttr(o[0]) + '">' + escapeHtml(o[1]) + '</option>').join('');
        return '<div class="reco-builder__field' + fullCls + '">' +
          '<label for="' + id + '">' + escapeHtml(f.label) + '</label>' +
          '<select id="' + id + '" data-name="' + escapeAttr(f.name) + '">' + opts + '</select>' +
          hint +
          '</div>';
      }
      if (f.kind === 'textarea') {
        return '<div class="reco-builder__field' + fullCls + '">' +
          '<label for="' + id + '">' + escapeHtml(f.label) + '</label>' +
          '<textarea id="' + id + '" data-name="' + escapeAttr(f.name) + '" rows="2" placeholder="' + escapeAttr(f.placeholder || '') + '"></textarea>' +
          hint +
          '</div>';
      }
      return '<div class="reco-builder__field' + fullCls + '">' +
        '<label for="' + id + '">' + escapeHtml(f.label) + '</label>' +
        '<input id="' + id + '" data-name="' + escapeAttr(f.name) + '" type="text" placeholder="' + escapeAttr(f.placeholder || '') + '">' +
        hint +
        '</div>';
    }

    function getValues() {
      const v = {};
      fieldsEl.querySelectorAll('[data-name]').forEach((el) => {
        v[el.dataset.name] = (el.value || '').trim();
      });
      return v;
    }

    function extractSpotifyId(url) {
      const m = String(url).match(/\/(episode|show)\/([A-Za-z0-9]+)/);
      if (!m) return { id: '', type: '' };
      return { id: m[2], type: m[1] };
    }
    function extractYouTubeId(url) {
      const s = String(url);
      let m = s.match(/[?&]v=([A-Za-z0-9_\-]{6,})/); if (m) return m[1];
      m = s.match(/youtu\.be\/([A-Za-z0-9_\-]{6,})/); if (m) return m[1];
      m = s.match(/\/embed\/([A-Za-z0-9_\-]{6,})/); if (m) return m[1];
      return '';
    }

    function buildObject() {
      const v = getValues();
      if (recoKind === 'spotify') {
        const parsed = extractSpotifyId(v.url || '');
        if (parsed.type) {
          const sel = fieldsEl.querySelector('[data-name="type"]');
          if (sel && sel.value !== parsed.type) sel.value = parsed.type;
        }
        return { kind: 'spotify', type: parsed.type || v.type || 'episode', id: parsed.id, title: v.title, source: v.source, note: v.note };
      }
      if (recoKind === 'youtube') {
        return { kind: 'youtube', id: extractYouTubeId(v.url || ''), title: v.title, source: v.source, note: v.note };
      }
      if (recoKind === 'link') {
        const o = { kind: 'link', url: v.url, title: v.title, source: v.source, note: v.note };
        if (v.image) o.image = v.image;
        return o;
      }
      if (recoKind === 'partner') {
        const o = { name: v.name, url: v.url };
        if (v.logo) o.logo = v.logo;
        if (v.description) o.description = v.description;
        return o;
      }
      return {};
    }

    function formatJson(obj) {
      const cleaned = {};
      Object.keys(obj).forEach((k) => {
        if (obj[k] != null && obj[k] !== '') cleaned[k] = obj[k];
      });
      return JSON.stringify(cleaned, null, 2);
    }

    function readiness(obj) {
      if (recoKind === 'spotify' || recoKind === 'youtube') {
        if (!obj.id) return 'needs-url';
      }
      if (recoKind === 'partner') {
        if (!obj.name || !obj.url) return 'incomplete';
      } else {
        if (!obj.title && !obj.name) return 'incomplete';
      }
      return 'ready';
    }

    function updatePreview(obj, state) {
      if (state !== 'ready') {
        previewEl.innerHTML = '<div class="reco-empty">' + (
          state === 'needs-url'
            ? 'Paste a URL above to see the live embed preview.'
            : 'Fill out the form above to preview.'
        ) + '</div>';
        return;
      }

      if (recoKind === 'partner') {
        if (typeof window.renderPartners === 'function') {
          const tmp = document.createElement('div');
          window.renderPartners(tmp, [obj]);
          previewEl.innerHTML = '';
          previewEl.appendChild(tmp);
        } else {
          previewEl.innerHTML = '<div class="reco-empty">Renderer not loaded yet — try again in a moment.</div>';
        }
        return;
      }

      if (typeof window.renderListeningCard === 'function') {
        previewEl.innerHTML = '<div class="reco-grid">' + window.renderListeningCard(obj) + '</div>';
      } else {
        previewEl.innerHTML = '<div class="reco-empty">Loading preview renderer…</div>';
        setTimeout(() => updatePreview(obj, state), 400);
      }
    }

    function updateAll() {
      const obj = buildObject();
      const state = readiness(obj);
      if (state === 'needs-url') {
        output.textContent = '// Paste a valid Spotify or YouTube URL above to auto-extract the ID.';
      } else if (state === 'incomplete') {
        output.textContent = '// Fill out the form above to generate a JSON block.';
      } else {
        output.textContent = formatJson(obj);
      }
      updatePreview(obj, state);
    }

    function switchKind(kind) {
      if (!recoSchemas[kind]) return;
      recoKind = kind;
      tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.kind === kind));
      renderFields();
    }

    tabs.forEach((t) => t.addEventListener('click', () => switchKind(t.dataset.kind)));

    copyBtn.addEventListener('click', async () => {
      const txt = output.textContent;
      if (!txt || txt.startsWith('//')) {
        if (statusEl) {
          statusEl.textContent = '⚠️ Nothing to copy yet';
          setTimeout(() => { statusEl.textContent = ''; }, 2200);
        }
        return;
      }
      const ok = await copyToClipboard(txt);
      if (statusEl) {
        statusEl.textContent = ok ? '✅ Copied to clipboard' : '📋 Select the text above and press Ctrl+C';
        setTimeout(() => { statusEl.textContent = ''; }, 2500);
      }
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        fieldsEl.querySelectorAll('input, textarea').forEach((el) => { el.value = ''; });
        fieldsEl.querySelectorAll('select').forEach((el) => { el.selectedIndex = 0; });
        updateAll();
      });
    }

    renderFields();
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  // ── Mermaid flowchart rendering ───────────────────────────
  let mermaidLoaded = false;
  function loadMermaid() {
    if (mermaidLoaded) return;
    if (!document.querySelector('.admin-flowchart .mermaid')) return;
    mermaidLoaded = true;

    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    s.defer = true;
    s.onload = () => {
      if (!window.mermaid) return;
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#fdf8f1',
          primaryTextColor: '#2b2b2b',
          primaryBorderColor: '#d4a574',
          lineColor: '#8a6a3a',
          fontFamily: 'inherit'
        },
        flowchart: { curve: 'basis', nodeSpacing: 45, rankSpacing: 55, padding: 14 }
      });
      try {
        window.mermaid.run({ querySelector: '.admin-flowchart .mermaid' });
      } catch (err) { console.warn('Mermaid render failed:', err); }
    };
    s.onerror = () => console.warn('Mermaid failed to load — flowchart source will display as plain text.');
    document.head.appendChild(s);
  }

  // ── Utilities ─────────────────────────────────────────────
  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80) || 'section';
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
})();
