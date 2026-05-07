/* ============================================================
   Admin Help — v3
   Handles the password gate, and (after unlock) sets up the top
   navigation: category tabs, alphabet-rail jump-menu, and the
   search box. Also wires up the recommendations builder and
   Mermaid flowchart rendering.

   Each subsystem is isolated in its own init function wrapped in
   safeRun(), so a bug in one feature can't kill the others.
   ============================================================ */

(function () {
  'use strict';

  const SALT = 'stwm-2026-admin-gate';
  const EXPECTED_HASH = '2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440';
  const SESSION_KEY = 'stwm-admin-unlocked';

  const gate      = document.getElementById('admin-gate');
  const content   = document.getElementById('admin-content');
  const shell     = document.getElementById('admin-shell');
  const form      = document.getElementById('gate-form');
  const input     = document.getElementById('gate-input');
  const errorEl   = document.getElementById('gate-error');
  const logoutBtn = document.getElementById('admin-logout');

  if (!gate || !content || !form) {
    console.error('Admin help: required gate elements missing.');
    return;
  }

  // ── Category definitions ────────────────────────────────────
  // Each section h2 is slotted into one of these buckets. Matching
  // is done by substring against the lower-cased heading text; the
  // first rule that matches wins. Any heading that doesn't match
  // falls into 'howto' by default.
  const CATEGORIES = [
    { id: 'overview',       label: '📋 Overview',    match: [/overview/i, /operations schedule/i, /recent changes/i] },
    { id: 'howto',          label: '🧰 How-tos',     match: [/^how to/i, /managing/i, /updating images/i, /add a /i, /images/i, /outreach/i, /bundle/i, /media drop/i, /recommendation/i, /homepage/i, /walking the path/i, /announcing events/i] },
    { id: 'bots',           label: '🤖 Bots',        match: [/telegram bot/i, /telegram bots/i, /auto-post/i] },
    { id: 'troubleshoot',   label: '🧯 Troubleshoot', match: [/troubleshoot/i, /everything is on fire/i, /secrets/i] },
  ];
  const DEFAULT_CATEGORY = 'howto';
  const ALL_CATEGORY = { id: 'all', label: '📚 All' };

  // ── Sections collected from the page ────────────────────────
  // Each section = h2 + all following siblings up to the next h2
  const sections = [];  // { id, title, category, nodes, haystack, titleLetter }

  // ── Gate logic ──────────────────────────────────────────────
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function unlock() {
    gate.style.display = 'none';
    document.body.classList.add('admin-unlocked');
    if (shell) shell.classList.add('visible');
    content.classList.add('visible');
    collectSections();
    safeRun('tabs',        initTabs);
    safeRun('alphabet',    initAlphabet);
    safeRun('search',      initSearch);
    safeRun('reco',        initRecoBuilder);
    safeRun('mermaid',     loadMermaid);
  }

  function lock() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }

  function safeRun(name, fn) {
    try { fn(); }
    catch (err) { console.error('[admin-help] ' + name + ' init failed:', err); }
  }

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

  // ── Collect sections from the DOM ───────────────────────────
  function collectSections() {
    sections.length = 0;
    const h2s = content.querySelectorAll('main#admin-content > h2');
    h2s.forEach((h2) => {
      const title = h2.textContent.trim();
      const id = slugify(title);
      h2.id = id;

      const nodes = [h2];
      let n = h2.nextElementSibling;
      while (n && n.tagName !== 'H2') {
        nodes.push(n);
        n = n.nextElementSibling;
      }

      // Category assignment
      const cat = matchCategory(title) || DEFAULT_CATEGORY;

      // Haystack for search — skip rendered flowchart text to avoid matching graph syntax
      const parts = [];
      nodes.forEach((nd) => {
        const clone = nd.cloneNode(true);
        clone.querySelectorAll('.mermaid').forEach((m) => m.remove());
        parts.push(clone.textContent || '');
      });

      // First letter for alphabet rail — strip leading emoji/punctuation
      const letter = getPrimaryLetter(title);

      sections.push({
        id, title, category: cat, nodes,
        haystack: parts.join(' ').toLowerCase(),
        letter,
      });

      // Tag every section node with its category so we can CSS-filter
      nodes.forEach((nd) => nd.setAttribute('data-category', cat));
    });
  }

  function matchCategory(title) {
    for (const cat of CATEGORIES) {
      for (const re of cat.match) {
        if (re.test(title)) return cat.id;
      }
    }
    return null;
  }

  function getPrimaryLetter(title) {
    // Strip leading emoji + whitespace, look at the first alpha char
    const stripped = title.replace(/^[^A-Za-z]+/, '');
    const c = (stripped[0] || '').toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  // ── Tabs ────────────────────────────────────────────────────
  let activeCategory = 'all';

  function initTabs() {
    const tabsEl = document.getElementById('admin-tabs');
    if (!tabsEl) return;

    const cats = [ALL_CATEGORY, ...CATEGORIES];
    const counts = {};
    sections.forEach((s) => { counts[s.category] = (counts[s.category] || 0) + 1; });
    counts.all = sections.length;

    tabsEl.innerHTML = cats.map((c) => {
      const count = counts[c.id] || 0;
      if (count === 0 && c.id !== 'all') return '';
      const active = c.id === activeCategory ? ' is-active' : '';
      return (
        '<button type="button" class="admin-tab' + active +
        '" data-cat="' + c.id + '" role="tab">' +
        escapeHtml(c.label) +
        '<span class="admin-tab__count">' + count + '</span>' +
        '</button>'
      );
    }).join('');

    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.admin-tab');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      tabsEl.querySelectorAll('.admin-tab').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.cat === activeCategory);
      });
      applyFilters();
    });
  }

  // ── Alphabet rail ───────────────────────────────────────────
  function initAlphabet() {
    const rail = document.getElementById('admin-alpha');
    if (!rail) return;

    // Group section titles by starting letter
    const byLetter = {};
    sections.forEach((s) => {
      const L = s.letter;
      if (!byLetter[L]) byLetter[L] = [];
      byLetter[L].push(s);
    });

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    // If any sections start with a non-alpha char, add '#'
    const hasHash = sections.some((s) => s.letter === '#');

    const letterButtons = letters.map((L) => {
      const items = byLetter[L] || [];
      const isEmpty = items.length === 0;
      const popup = isEmpty
        ? ''
        : '<div class="admin-alpha__popup">' +
            items.map((s) =>
              '<a class="admin-alpha__popup-link" href="#' + s.id +
              '" data-section-id="' + s.id + '">' + escapeHtml(s.title) + '</a>'
            ).join('') +
          '</div>';
      return (
        '<span class="admin-alpha__letter' + (isEmpty ? ' is-empty' : '') +
        '" data-letter="' + L + '" tabindex="' + (isEmpty ? '-1' : '0') + '">' +
        L + popup + '</span>'
      );
    });

    if (hasHash) {
      const items = byLetter['#'] || [];
      const popup = '<div class="admin-alpha__popup">' +
        items.map((s) =>
          '<a class="admin-alpha__popup-link" href="#' + s.id +
          '" data-section-id="' + s.id + '">' + escapeHtml(s.title) + '</a>'
        ).join('') + '</div>';
      letterButtons.push(
        '<span class="admin-alpha__letter" data-letter="#" tabindex="0">#' + popup + '</span>'
      );
    }

    rail.innerHTML = letterButtons.join('');

    // Hover to open, click/tap to toggle (mobile-friendly)
    rail.addEventListener('mouseenter', (e) => {
      const el = e.target.closest('.admin-alpha__letter');
      if (!el || el.classList.contains('is-empty')) return;
      closeAllExcept(el);
      el.classList.add('is-open');
    }, true);

    rail.addEventListener('mouseleave', (e) => {
      const el = e.target.closest('.admin-alpha__letter');
      if (!el) return;
      // Delay so the user can mouse into the popup
      setTimeout(() => {
        if (!el.matches(':hover') && !el.querySelector('.admin-alpha__popup:hover')) {
          el.classList.remove('is-open');
        }
      }, 120);
    }, true);

    rail.addEventListener('click', (e) => {
      const link = e.target.closest('.admin-alpha__popup-link');
      if (link) {
        // Let the anchor nav happen; just close the popup
        const el = link.closest('.admin-alpha__letter');
        if (el) el.classList.remove('is-open');
        // Smooth-scroll
        const id = link.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Reset any filters so the section is visible
          clearSearch(true);
        }
        return;
      }
      // Tapping the letter itself toggles the popup (for touch users)
      const letter = e.target.closest('.admin-alpha__letter');
      if (letter && !letter.classList.contains('is-empty')) {
        const wasOpen = letter.classList.contains('is-open');
        closeAllExcept(null);
        if (!wasOpen) letter.classList.add('is-open');
      }
    });

    // Close all popups on outside click
    document.addEventListener('click', (e) => {
      if (!rail.contains(e.target)) closeAllExcept(null);
    });
    // Esc closes them too
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllExcept(null);
    });

    function closeAllExcept(keep) {
      rail.querySelectorAll('.admin-alpha__letter.is-open').forEach((n) => {
        if (n !== keep) n.classList.remove('is-open');
      });
    }
  }

  // ── Search ──────────────────────────────────────────────────
  let currentQuery = '';

  function initSearch() {
    const searchEl = document.getElementById('admin-search-input');
    const clearBtn = document.getElementById('admin-search-clear');
    if (!searchEl) return;

    let debounce;
    searchEl.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentQuery = e.target.value.trim();
        applyFilters();
      }, 60);
    });
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') clearSearch();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { clearSearch(); searchEl.focus(); });
    }

    // Global "/" shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/') return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
    });
  }

  function clearSearch(silent) {
    const searchEl = document.getElementById('admin-search-input');
    if (searchEl) searchEl.value = '';
    currentQuery = '';
    if (!silent) applyFilters();
  }

  // ── The single filter applicator — runs on tab OR search change ──
  function applyFilters() {
    const q = currentQuery.toLowerCase();
    const clearBtn = document.getElementById('admin-search-clear');
    const metaEl = document.getElementById('admin-search-meta');
    if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';

    clearHighlights();

    let matches = 0;
    sections.forEach((s) => {
      const catOk = activeCategory === 'all' || s.category === activeCategory;
      const qOk = !q || s.haystack.includes(q);
      const show = catOk && qOk;
      s.nodes.forEach((n) => {
        if (show) n.removeAttribute('data-hidden');
        else      n.setAttribute('data-hidden', 'true');
      });
      if (show && q) matches++;
      else if (show) matches++;
    });

    // Highlight matches
    if (q && matches > 0) highlightMatches(q);

    if (metaEl) {
      if (q) {
        if (matches === 0) {
          metaEl.classList.add('is-no-results');
          metaEl.textContent = 'No tutorials found for "' + currentQuery + '". Try a different term.';
        } else {
          metaEl.classList.remove('is-no-results');
          metaEl.textContent = (matches === 1 ? '1 section' : matches + ' sections') +
            ' match "' + currentQuery + '"' +
            (activeCategory !== 'all' ? ' in ' + getCatLabel(activeCategory) : '');
        }
      } else if (activeCategory !== 'all') {
        metaEl.classList.remove('is-no-results');
        metaEl.textContent = 'Showing ' + matches + ' sections in ' + getCatLabel(activeCategory);
      } else {
        metaEl.classList.remove('is-no-results');
        metaEl.textContent = '';
      }
    }
  }

  function getCatLabel(id) {
    const c = CATEGORIES.find((x) => x.id === id);
    return c ? c.label : id;
  }

  function clearHighlights() {
    content.querySelectorAll('mark.admin-search-hit').forEach((mark) => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function highlightMatches(q) {
    const re = new RegExp(escapeRegExp(q), 'gi');
    sections.forEach((s) => {
      if (s.nodes[0].getAttribute('data-hidden') === 'true') return;
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
        if (p.closest('#admin-shell .admin-nav')) return NodeFilter.FILTER_REJECT;
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

  // ── Recommendations builder ─────────────────────────────────
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
        { name: 'url',    label: 'Spotify URL',             placeholder: 'https://open.spotify.com/episode/1Y4cct2…', hint: 'Paste the full URL — ID and type auto-detected.' },
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
      if (destEl) destEl.innerHTML = schema.destination + ' Add a comma after the previous block\'s closing <code>}</code>. The last item in the array should NOT have a trailing comma.';
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
          hint + '</div>';
      }
      if (f.kind === 'textarea') {
        return '<div class="reco-builder__field' + fullCls + '">' +
          '<label for="' + id + '">' + escapeHtml(f.label) + '</label>' +
          '<textarea id="' + id + '" data-name="' + escapeAttr(f.name) + '" rows="2" placeholder="' + escapeAttr(f.placeholder || '') + '"></textarea>' +
          hint + '</div>';
      }
      return '<div class="reco-builder__field' + fullCls + '">' +
        '<label for="' + id + '">' + escapeHtml(f.label) + '</label>' +
        '<input id="' + id + '" data-name="' + escapeAttr(f.name) + '" type="text" placeholder="' + escapeAttr(f.placeholder || '') + '">' +
        hint + '</div>';
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
          state === 'needs-url' ? 'Paste a URL above to see the live embed preview.' : 'Fill out the form above to preview.'
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
      if (state === 'needs-url') output.textContent = '// Paste a valid Spotify or YouTube URL above to auto-extract the ID.';
      else if (state === 'incomplete') output.textContent = '// Fill out the form above to generate a JSON block.';
      else output.textContent = formatJson(obj);
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
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { /* fall through */ }
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
    } catch (e) { return false; }
  }

  // ── Mermaid ─────────────────────────────────────────────────
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
          primaryColor: '#ffffff',
          primaryTextColor: '#0a0a0a',
          primaryBorderColor: '#0a0a0a',
          lineColor: '#0a0a0a',
          fontFamily: 'inherit'
        },
        flowchart: { curve: 'basis', nodeSpacing: 45, rankSpacing: 55, padding: 14 }
      });
      try { window.mermaid.run({ querySelector: '.admin-flowchart .mermaid' }); }
      catch (err) { console.warn('Mermaid render failed:', err); }
    };
    s.onerror = () => console.warn('Mermaid failed to load — flowchart source will display as plain text.');
    document.head.appendChild(s);
  }

  // ── Utilities ───────────────────────────────────────────────
  function slugify(s) {
    return String(s).toLowerCase()
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

  // Must run AFTER all module let/const declarations above — otherwise unlock() -> initRecoBuilder/loadMermaid hit TDZ.
  try {
    if (sessionStorage.getItem(SESSION_KEY) === '1') unlock();
  } catch (e) { /* ignore */ }
})();
