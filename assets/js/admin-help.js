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
  // ── Categories ──────────────────────────────────────────────
  // Each section's category is now set EXPLICITLY via a data-category
  // attribute on its <h2> in admin-help.html. The `match` regexes are
  // only a fallback for any section that forgets to declare one, so a
  // renamed heading can never silently jump tabs. `order` controls the
  // order the groups appear in the sidebar.
  const CATEGORIES = [
    { id: 'start',        label: 'Start here',      icon: '🚀', match: [/start here/i, /quick routing/i, /what's where/i, /site map/i] },
    { id: 'walkthroughs', label: 'Interactive Walkthroughs', icon: '🎬', match: [/walkthrough/i, /interactive tour/i, /record a deposit/i, /add an item.*scan/i, /process.*order/i, /loading .*waiting/i] },
    { id: 'guide',        label: 'Team Portal',     icon: '📖', match: [/^guide:/i, /team portal/i, /announcement/i, /incoming activity/i, /team activity/i, /direct message/i, /\bdms?\b/i, /moderation/i, /permission/i, /prayer/i, /community feed/i, /reply on community/i] },
    { id: 'studio',       label: 'Content Studio',  icon: '✨', match: [/content studio/i, /outreach map/i, /outreach stories/i, /testimon/i, /publish/i, /outreach locations/i] },
    { id: 'media',        label: 'Images & Media',  icon: '🖼️', match: [/updating images/i, /images/i, /media drop/i, /listening to/i, /partner ministr/i, /recommendation/i] },
    { id: 'pages',        label: 'Pages & Content', icon: '📄', match: [/bundle/i, /store\.html/i, /ministry outreach cards/i, /managing the homepage/i, /walking the path/i, /announcing events/i, /^how to/i, /common tasks/i] },
    { id: 'bots',         label: 'Telegram Bots',   icon: '🤖', match: [/telegram bot/i, /telegram bots/i, /auto-post/i] },
    { id: 'overview',     label: 'How It Works',    icon: '📋', match: [/overview/i, /operations schedule/i, /recent changes/i, /what the site depends/i] },
    { id: 'deploy',       label: 'Deploy',          icon: '🚀', match: [/deploy/i, /apps script/i, /redeploy/i, /new version/i, /backend/i] },
    { id: 'troubleshoot', label: 'Troubleshoot',    icon: '🧯', match: [/troubleshoot/i, /everything is on fire/i, /secrets/i] },
  ];
  const DEFAULT_CATEGORY = 'overview';

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
    // Show field tools quick-access strip
    var fieldTools = document.getElementById('admin-field-tools');
    if (fieldTools) fieldTools.removeAttribute('hidden');
    collectSections();
    safeRun('sidebar',     initSidebar);
    safeRun('drawer',      initDrawer);
    safeRun('scrollspy',   initScrollSpy);
    safeRun('search',      initSearch);
    safeRun('reco',        initRecoBuilder);
    safeRun('mermaid',     loadMermaid);
    safeRun('walkthroughs', initWalkthroughs);
    safeRun('helptips',    initHelpTips);
    safeRun('loadingdemos', initLoadingDemos);
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

      // Category assignment — prefer the EXPLICIT data-category on the
      // heading; fall back to regex-matching the title only if it's
      // missing or names an unknown category.
      const declared = (h2.getAttribute('data-category') || '').trim();
      const known = CATEGORIES.some((c) => c.id === declared);
      const cat = known ? declared : (matchCategory(title) || DEFAULT_CATEGORY);

      // A short nav label — prefer an explicit data-nav, else strip the
      // leading emoji + a "Guide:" prefix so the sidebar reads cleanly.
      const navLabel = (h2.getAttribute('data-nav') || '').trim() ||
        title.replace(/^[^A-Za-z0-9]+/, '').replace(/^Guide:\s*/i, '').trim() || title;

      // Haystack for search — skip rendered flowchart text to avoid matching graph syntax
      const parts = [];
      nodes.forEach((nd) => {
        const clone = nd.cloneNode(true);
        clone.querySelectorAll('.mermaid').forEach((m) => m.remove());
        parts.push(clone.textContent || '');
      });

      sections.push({
        id, title, navLabel, category: cat, nodes,
        haystack: parts.join(' ').toLowerCase(),
      });

      // Tag every section node with its category so we can CSS-filter.
      // The h2 itself gets tagged too so the category-color left border
      // renders on the heading (added to nodes[] as the first entry).
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

  // ── Sidebar: grouped, collapsible list of every section ─────
  // Builds one collapsible group per category (in CATEGORIES order),
  // each listing its sections as jump links. This replaces the old
  // horizontal pill tabs + alphabet rail — it scales to any number of
  // sections and always shows the full map of the page.
  function initSidebar() {
    const nav = document.getElementById('admin-sidebar-nav');
    if (!nav) return;

    // Group sections by category, preserving document order within each.
    const byCat = {};
    sections.forEach((s) => {
      (byCat[s.category] = byCat[s.category] || []).push(s);
    });

    const html = CATEGORIES.map((c) => {
      const items = byCat[c.id] || [];
      if (!items.length) return '';
      const links = items.map((s) =>
        '<button type="button" class="admin-navlink" data-section-id="' + s.id + '">' +
        escapeHtml(s.navLabel) + '</button>'
      ).join('');
      return (
        '<div class="admin-navgroup" data-cat="' + c.id + '">' +
          '<button type="button" class="admin-navgroup__title" aria-expanded="true">' +
            '<span class="admin-navgroup__dot"></span>' +
            '<span class="admin-navgroup__label">' + escapeHtml(c.label) + '</span>' +
            '<span class="admin-navgroup__count">' + items.length + '</span>' +
            '<span class="admin-navgroup__chevron">▾</span>' +
          '</button>' +
          '<div class="admin-navgroup__links">' + links + '</div>' +
        '</div>'
      );
    }).join('');
    nav.innerHTML = html;

    // Collapse / expand a group header.
    nav.addEventListener('click', (e) => {
      const title = e.target.closest('.admin-navgroup__title');
      if (title) {
        const group = title.closest('.admin-navgroup');
        const collapsed = group.classList.toggle('is-collapsed');
        title.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        return;
      }
      const link = e.target.closest('.admin-navlink');
      if (link) {
        // Leaving the editor view (if open) so the section is visible.
        hideEditor();
        setEditorButtonActive(false);
        jumpToSection(link.dataset.sectionId);
        closeDrawer();
      }
    });
  }

  // ── Scroll-spy: highlight the section currently in view ─────
  function initScrollSpy() {
    const nav = document.getElementById('admin-sidebar-nav');
    if (!nav || !('IntersectionObserver' in window)) return;
    const visible = new Map();
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) visible.set(en.target.id, en.intersectionRatio);
        else visible.delete(en.target.id);
      });
      // Pick the section closest to the top that's on screen.
      let bestId = null;
      let bestTop = Infinity;
      visible.forEach((_, id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const top = Math.abs(el.getBoundingClientRect().top);
        if (top < bestTop) { bestTop = top; bestId = id; }
      });
      if (bestId) setActiveNavLink(bestId);
    }, { rootMargin: '-120px 0px -55% 0px', threshold: [0, 1] });
    sections.forEach((s) => { if (s.nodes[0]) obs.observe(s.nodes[0]); });
  }

  function setActiveNavLink(id) {
    const nav = document.getElementById('admin-sidebar-nav');
    if (!nav) return;
    nav.querySelectorAll('.admin-navlink.is-active').forEach((n) => n.classList.remove('is-active'));
    const link = nav.querySelector('.admin-navlink[data-section-id="' + id + '"]');
    if (link) {
      link.classList.add('is-active');
      // Make sure the active link stays visible in the scrollable nav.
      link.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── Mobile drawer + editor launch button ────────────────────
  function initDrawer() {
    const toggle  = document.getElementById('admin-drawer-toggle');
    const sidebar = document.getElementById('admin-sidebar');
    const backdrop = document.getElementById('admin-sidebar-backdrop');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => {
        const open = sidebar.classList.toggle('is-open');
        if (backdrop) backdrop.classList.toggle('is-open', open);
      });
    }
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

    // Editor launch button lives in the sidebar foot.
    const editorBtn = document.getElementById('admin-editor-btn');
    if (editorBtn) {
      editorBtn.addEventListener('click', () => {
        const nowActive = !editorBtn.classList.contains('is-active');
        setEditorButtonActive(nowActive);
        if (nowActive) showEditor(); else hideEditor();
        closeDrawer();
      });
    }
  }

  function setEditorButtonActive(on) {
    const editorBtn = document.getElementById('admin-editor-btn');
    if (editorBtn) editorBtn.classList.toggle('is-active', !!on);
  }

  function closeDrawer() {
    const sidebar = document.getElementById('admin-sidebar');
    const backdrop = document.getElementById('admin-sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
  }

  function showEditor() {
    const shell = document.getElementById('admin-editor-shell');
    const root  = document.getElementById('admin-editor-root');
    if (shell) { shell.hidden = false; shell.setAttribute('aria-hidden', 'false'); }
    if (content) content.classList.add('is-hidden-behind-editor');
    if (window.AdminEditor && typeof window.AdminEditor.mount === 'function' && root) {
      window.AdminEditor.mount(root);
    } else if (root) {
      root.textContent = 'Editor failed to load. Hard-refresh (Ctrl+Shift+R) and try again.';
    }
  }

  function hideEditor() {
    const shell = document.getElementById('admin-editor-shell');
    if (shell) { shell.hidden = true; shell.setAttribute('aria-hidden', 'true'); }
    if (content) content.classList.remove('is-hidden-behind-editor');
  }

  // ── Search ──────────────────────────────────────────────────
  let currentQuery = '';

  function initSearch() {
    const searchEl = document.getElementById('admin-search-input');
    const clearBtn = document.getElementById('admin-search-clear');
    const suggestionsEl = document.getElementById('admin-search-suggestions');
    if (!searchEl) return;

    let debounce;
    searchEl.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentQuery = e.target.value.trim();
        applyFilters();
        renderSuggestions();
      }, 60);
    });
    searchEl.addEventListener('focus', () => renderSuggestions());
    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (suggestionsEl && !suggestionsEl.hidden) {
          hideSuggestions();
          searchEl.focus();
        } else {
          clearSearch();
        }
        return;
      }
      if (!suggestionsEl || suggestionsEl.hidden) return;
      const items = Array.from(suggestionsEl.querySelectorAll('.admin-search__suggestion'));
      if (!items.length) return;
      const activeIdx = items.findIndex((el) => el.classList.contains('is-active'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[(activeIdx + 1) % items.length];
        setActiveSuggestion(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[(activeIdx - 1 + items.length) % items.length];
        setActiveSuggestion(prev);
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        jumpToSection(items[activeIdx].dataset.sectionId);
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { clearSearch(); searchEl.focus(); });
    }

    // Close dropdown on outside click.
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('admin-search-wrap');
      if (!wrap) return;
      if (!wrap.contains(e.target)) hideSuggestions();
    });

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

  function renderSuggestions() {
    const searchEl = document.getElementById('admin-search-input');
    const suggestionsEl = document.getElementById('admin-search-suggestions');
    if (!searchEl || !suggestionsEl) return;

    const q = (searchEl.value || '').trim().toLowerCase();
    // Show the dropdown even when the query is empty IF the input is
    // focused — it acts as a full jump-menu of every section. This
    // solves the "I don't know what's on this page" complaint.
    const items = sections.filter((s) => {
      if (!q) return true;
      return s.title.toLowerCase().includes(q) || s.haystack.includes(q);
    }).slice(0, 40);

    if (items.length === 0) {
      suggestionsEl.innerHTML = '<li class="admin-search__suggestions-empty">No matching sections.</li>';
      suggestionsEl.hidden = false;
      searchEl.setAttribute('aria-expanded', 'true');
      return;
    }

    suggestionsEl.innerHTML = items.map((s) => {
      const c = CATEGORIES.find((x) => x.id === s.category);
      const catShort = c ? c.label : s.category;
      return (
        '<li class="admin-search__suggestion" role="option" data-section-id="' + s.id + '">' +
          '<span class="admin-search__suggestion-cat">' + escapeHtml(catShort) + '</span>' +
          '<span class="admin-search__suggestion-title">' + escapeHtml(s.navLabel) + '</span>' +
        '</li>'
      );
    }).join('');

    // Wire clicks on each suggestion.
    suggestionsEl.querySelectorAll('.admin-search__suggestion').forEach((el) => {
      el.addEventListener('mousedown', (ev) => {
        // mousedown (not click) so the input blur doesn't hide the
        // dropdown before the handler fires on some browsers.
        ev.preventDefault();
        jumpToSection(el.dataset.sectionId);
      });
      el.addEventListener('mouseenter', () => setActiveSuggestion(el));
    });

    suggestionsEl.hidden = false;
    searchEl.setAttribute('aria-expanded', 'true');
    // Auto-highlight the first suggestion so Enter works immediately.
    const first = suggestionsEl.querySelector('.admin-search__suggestion');
    if (first) setActiveSuggestion(first);
  }

  function setActiveSuggestion(el) {
    const suggestionsEl = document.getElementById('admin-search-suggestions');
    if (!suggestionsEl) return;
    suggestionsEl.querySelectorAll('.admin-search__suggestion.is-active')
      .forEach((n) => n.classList.remove('is-active'));
    if (el) {
      el.classList.add('is-active');
      // Keep highlighted item in view when arrow-navigating.
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function hideSuggestions() {
    const searchEl = document.getElementById('admin-search-input');
    const suggestionsEl = document.getElementById('admin-search-suggestions');
    if (suggestionsEl) suggestionsEl.hidden = true;
    if (searchEl) searchEl.setAttribute('aria-expanded', 'false');
  }

  function jumpToSection(id) {
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    // Reset filters so the target is visible even if current filters
    // would hide it — the user explicitly asked for this section.
    clearSearch(true);
    hideSuggestions();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Brief visual pulse so the user sees where they landed.
    target.classList.add('admin-jump-flash');
    setTimeout(() => target.classList.remove('admin-jump-flash'), 1600);
  }

  function clearSearch(silent) {
    const searchEl = document.getElementById('admin-search-input');
    if (searchEl) searchEl.value = '';
    currentQuery = '';
    hideSuggestions();
    if (!silent) applyFilters();
  }

  // ── The single filter applicator — runs on tab OR search change ──
  // Pure text search: hides non-matching sections in the content, hides
  // their nav links + empty groups in the sidebar, and shows a count note.
  // With no query, everything is shown (the sidebar is the primary nav).
  function applyFilters() {
    const q = currentQuery.toLowerCase();
    const clearBtn = document.getElementById('admin-search-clear');
    const metaEl = document.getElementById('admin-search-meta');
    const note = document.getElementById('admin-content-searchnote');
    const nav = document.getElementById('admin-sidebar-nav');
    if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';

    clearHighlights();

    let matches = 0;
    const shownIds = {};
    sections.forEach((s) => {
      const show = !q || s.haystack.includes(q);
      s.nodes.forEach((n) => {
        if (show) n.removeAttribute('data-hidden');
        else      n.setAttribute('data-hidden', 'true');
      });
      if (show) { matches++; shownIds[s.id] = true; }
    });

    // Mirror the filter in the sidebar: dim links whose section is hidden,
    // and hide any group that has no visible section left.
    if (nav) {
      nav.querySelectorAll('.admin-navlink').forEach((link) => {
        link.classList.toggle('is-hidden-by-search', !!q && !shownIds[link.dataset.sectionId]);
      });
      nav.querySelectorAll('.admin-navgroup').forEach((group) => {
        const anyVisible = Array.prototype.some.call(
          group.querySelectorAll('.admin-navlink'),
          (l) => !l.classList.contains('is-hidden-by-search')
        );
        group.classList.toggle('is-empty-by-search', !!q && !anyVisible);
      });
    }

    if (q && matches > 0) highlightMatches(q);

    // Count note above the content.
    if (note) {
      if (q && matches > 0) {
        note.textContent = 'Showing ' + matches + (matches === 1 ? ' section' : ' sections') +
          ' matching "' + currentQuery + '". Clear the search to see everything.';
        note.classList.add('is-visible');
      } else {
        note.classList.remove('is-visible');
      }
    }
    if (metaEl) {
      if (q && matches === 0) {
        metaEl.classList.add('is-no-results');
        metaEl.textContent = 'No topics found for "' + currentQuery + '".';
      } else {
        metaEl.classList.remove('is-no-results');
        metaEl.textContent = '';
      }
    }
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
  let recoKind = 'spotify-show';
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
        { name: 'name',           label: 'Partner name',                    placeholder: 'One Heart MVMT' },
        { name: 'url',            label: 'Partner website',                 placeholder: 'https://oneheartmvmt.com' },
        { name: 'slug',           label: 'Slug (kebab-case, required for any rich field)',
                                  placeholder: 'one-heart-mvmt',
                                  hint: 'Lowercase letters, digits, and hyphens. Pattern: ^[a-z0-9][a-z0-9-]{1,40}$' },
        { name: 'logo',           label: 'Logo path (optional)',            placeholder: 'assets/images/partners/<slug>/logo.png',
                                  hint: 'Upload logo first under assets/images/partners/<slug>/, then paste its path here.' },
        { name: 'description',    label: 'Legacy one-sentence description (optional)',
                                  kind: 'textarea',
                                  placeholder: 'One sentence about what they do together with STW.' },
        { name: 'pointOfContact', label: 'Point of contact (display name)',
                                  placeholder: 'Sam Petrov',
                                  hint: 'First and last name only. Never an email or phone number — those go in the private hint below.' },
        { name: 'story',          label: 'Story paragraph (≤ 5 sentences)',
                                  kind: 'textarea',
                                  placeholder: "We met them at... They walked alongside us during... What we do together is...",
                                  hint: 'Plainspoken pastor tone. No exclamation points, no marketing superlatives.' },
        { name: '_pocEmail',      label: '🔒 POC email (private — never written to JSON)',
                                  placeholder: 'sam@oneheartmvmt.com',
                                  hint: 'Hint-only. This field is for your reference inside this builder; it is silently stripped before the JSON is generated.',
                                  private: true }
      ],
      repeatables: {
        socials: {
          label: 'Socials (icon row on the card)',
          fields: [
            { name: 'platform', label: 'Platform', kind: 'select',
              options: [
                ['instagram', 'Instagram'],
                ['youtube',   'YouTube'],
                ['telegram',  'Telegram'],
                ['facebook',  'Facebook'],
                ['twitch',    'Twitch'],
                ['spotify',   'Spotify'],
                ['website',   'Website']
              ] },
            { name: 'handle', label: 'Handle (optional)',  placeholder: '@oneheartmvmt' },
            { name: 'url',    label: 'URL (required)',     placeholder: 'https://www.instagram.com/oneheartmvmt/' }
          ]
        },
        photos: {
          label: 'Photos (grid)',
          fields: [
            { name: 'path', label: 'Image path', placeholder: 'assets/images/partners/<slug>/photo-1.jpg' }
          ]
        },
        videos: {
          label: 'Videos (Drive /preview or YouTube /embed/ only)',
          fields: [
            { name: 'provider', label: 'Provider', kind: 'select', options: [['drive', 'Drive'], ['youtube', 'YouTube']] },
            { name: 'url',      label: 'Embed URL', placeholder: 'https://drive.google.com/file/d/<id>/preview  OR  https://www.youtube.com/embed/<id>' },
            { name: 'title',    label: 'Title (optional)', placeholder: 'Hosted training with Keegan' }
          ]
        },
        contributions: {
          label: 'What they shaped here (internal links)',
          fields: [
            { name: 'href',  label: 'Relative href',       placeholder: 'how-to-grow.html' },
            { name: 'label', label: 'Plainspoken link text', placeholder: 'The four-movement evangelism guide came out of training they hosted at our ministry.' }
          ]
        }
      }
    },
    'spotify-show': {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'Spotify show URL',  placeholder: 'https://open.spotify.com/show/2rK4fCJuHWp8ji7Cj66EXK', hint: 'Paste the full SHOW URL — the card auto-refreshes as new episodes drop.' },
        { name: 'title',  label: 'Show title',        placeholder: 'After the Heart Podcast' },
        { name: 'source', label: 'Host / creator name', placeholder: 'Sam Petrov' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' }
      ]
    },
    'youtube-channel': {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'YouTube channel URL', placeholder: 'https://www.youtube.com/@SomeCreator', hint: 'Channel page URL ending in /channel/UC… or /@handle. The card embeds recent uploads when a UC… ID is captured.' },
        { name: 'title',  label: 'Channel name',        placeholder: 'Some Creator' },
        { name: 'source', label: 'Creator name',        placeholder: 'Friend from worship night' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' }
      ]
    },
    'youtube-playlist': {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'YouTube playlist URL', placeholder: 'https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxxxxxxxx', hint: 'Playlist URL with list=PL… The card embeds the playlist as a series.' },
        { name: 'title',  label: 'Playlist title',       placeholder: 'Worship together' },
        { name: 'source', label: 'Creator name',         placeholder: 'Some Creator' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' }
      ]
    },
    instagram: {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'Instagram profile URL', placeholder: 'https://instagram.com/somecreator', hint: 'Full profile URL or @handle — handle is auto-extracted.' },
        { name: 'title',  label: 'Display name',          placeholder: 'Some Creator' },
        { name: 'source', label: 'Source / context',      placeholder: 'Friend from worship night' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' },
        { name: 'avatar', label: 'Avatar path (optional)', placeholder: 'assets/images/featured/somecreator.jpg', hint: 'Optional thumbnail — Instagram blocks third-party loading of profile pictures, so upload one yourself if you want a face on the card.' }
      ]
    },
    twitch: {
      destination: 'Paste inside the <code>"listening"</code> array in <code>assets/data/recommendations.json</code>.',
      fields: [
        { name: 'url',    label: 'Twitch channel URL', placeholder: 'https://twitch.tv/somecreator', hint: 'Channel URL or bare slug — slug is auto-normalized.' },
        { name: 'title',  label: 'Display name',       placeholder: 'Some Creator' },
        { name: 'source', label: 'Source / context',   placeholder: 'Friend from Wednesday worship' },
        { name: 'note',   label: 'Why we recommend this (optional)', kind: 'textarea', placeholder: 'Why this stood out.' }
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
      let html = '<div class="reco-builder__grid">' +
        schema.fields.map(renderField).join('') + '</div>';

      if (recoKind === 'partner' && schema.repeatables) {
        html += '<div class="reco-builder__repeatables">';
        Object.keys(schema.repeatables).forEach((groupName) => {
          html += renderRepeatableGroup(groupName, schema.repeatables[groupName], []);
        });
        html += '</div>';
      }

      fieldsEl.innerHTML = html;
      fieldsEl.querySelectorAll('input, select, textarea').forEach((el) => {
        el.addEventListener('input', updateAll);
        el.addEventListener('change', updateAll);
      });

      // Wire repeatable +Add / Remove buttons via delegation. Setting
      // fieldsEl.innerHTML above clears any prior listener, so attaching
      // once per render is correct (no double-binding).
      fieldsEl.addEventListener('click', onRepeatableButtonClick);

      if (destEl) destEl.innerHTML = schema.destination + ' Add a comma after the previous block\'s closing <code>}</code>. The last item in the array should NOT have a trailing comma.';
      updateAll();
    }

    // ── Repeatable-row editor (partner builder only) ────────────────
    // Used by the rich partner schema's repeatables (socials, photos,
    // videos, contributions). Self-contained; no other recoKind uses
    // this pattern.
    // Spec: .kiro/specs/partner-ministries-rich-profiles/ §6.1
    function renderRepeatableGroup(groupName, groupSchema, rows) {
      const headerHtml =
        '<div class="reco-builder__repeatable-header">' +
          '<h5>' + escapeHtml(groupSchema.label) + '</h5>' +
          '<button type="button" class="reco-builder__repeatable-add" data-group="' + escapeAttr(groupName) + '">+ Add another</button>' +
        '</div>';
      const rowsHtml = (rows || []).map(function (row, i) {
        return renderRepeatableRow(groupName, groupSchema, i, row);
      }).join('');
      return (
        '<div class="reco-builder__repeatable" data-group="' + escapeAttr(groupName) + '">' +
          headerHtml +
          '<div class="reco-builder__repeatable-rows">' + rowsHtml + '</div>' +
        '</div>'
      );
    }

    function renderRepeatableRow(groupName, groupSchema, index, value) {
      const inputs = groupSchema.fields.map(function (f) {
        const v = (value && value[f.name]) || '';
        if (f.kind === 'select') {
          const opts = f.options.map(function (o) {
            return '<option value="' + escapeAttr(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
          }).join('');
          return (
            '<label class="reco-builder__repeatable-field">' +
              '<span>' + escapeHtml(f.label) + '</span>' +
              '<select data-group="' + escapeAttr(groupName) + '" data-field="' + escapeAttr(f.name) + '">' + opts + '</select>' +
            '</label>'
          );
        }
        return (
          '<label class="reco-builder__repeatable-field">' +
            '<span>' + escapeHtml(f.label) + '</span>' +
            '<input type="text" data-group="' + escapeAttr(groupName) + '" data-field="' + escapeAttr(f.name) + '"' +
              ' value="' + escapeAttr(v) + '" placeholder="' + escapeAttr(f.placeholder || '') + '">' +
          '</label>'
        );
      }).join('');
      return (
        '<div class="reco-builder__repeatable-row" data-index="' + index + '">' +
          inputs +
          '<button type="button" class="reco-builder__repeatable-remove" data-group="' + escapeAttr(groupName) + '">Remove</button>' +
        '</div>'
      );
    }

    function readRepeatableArray(groupName, groupSchema) {
      const rowEls = fieldsEl.querySelectorAll(
        '.reco-builder__repeatable[data-group="' + groupName + '"] .reco-builder__repeatable-row'
      );
      const out = [];
      rowEls.forEach(function (rowEl) {
        const obj = {};
        let anyFilled = false;
        groupSchema.fields.forEach(function (f) {
          const ctl = rowEl.querySelector('[data-field="' + f.name + '"]');
          const v = ctl ? (ctl.value || '').trim() : '';
          if (v) { obj[f.name] = v; anyFilled = true; }
        });
        if (anyFilled) out.push(obj);
      });
      return out;
    }

    function onRepeatableButtonClick(e) {
      const addBtn = e.target.closest && e.target.closest('.reco-builder__repeatable-add');
      if (addBtn) {
        const groupName = addBtn.getAttribute('data-group');
        const schema = recoSchemas[recoKind] && recoSchemas[recoKind].repeatables
          ? recoSchemas[recoKind].repeatables[groupName] : null;
        if (!schema) return;
        const rowsContainer = addBtn.closest('.reco-builder__repeatable')
          .querySelector('.reco-builder__repeatable-rows');
        const newIndex = rowsContainer.children.length;
        const tmp = document.createElement('div');
        tmp.innerHTML = renderRepeatableRow(groupName, schema, newIndex, {});
        const newRow = tmp.firstElementChild;
        rowsContainer.appendChild(newRow);
        // Wire input/change listeners on the new row's controls.
        newRow.querySelectorAll('input, select').forEach(function (el) {
          el.addEventListener('input', updateAll);
          el.addEventListener('change', updateAll);
        });
        updateAll();
        return;
      }
      const removeBtn = e.target.closest && e.target.closest('.reco-builder__repeatable-remove');
      if (removeBtn) {
        const row = removeBtn.closest('.reco-builder__repeatable-row');
        if (row) row.remove();
        updateAll();
        return;
      }
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
    function extractYouTubeChannel(url) {
      const s = String(url);
      let m = s.match(/\/channel\/(UC[A-Za-z0-9_\-]{20,})/);
      if (m) return { id: m[1], handle: '' };
      m = s.match(/youtube\.com\/(@[A-Za-z0-9._\-]+)/);
      if (m) return { id: '', handle: m[1] };
      m = s.match(/\/c\/([A-Za-z0-9._\-]+)/);
      if (m) return { id: '', handle: m[1] };
      return { id: '', handle: '' };
    }
    function extractYouTubePlaylist(url) {
      const m = String(url).match(/[?&]list=([A-Za-z0-9_\-]{10,})/);
      return m ? m[1] : '';
    }
    function extractInstagramHandle(url) {
      let s = String(url || '').trim();
      if (!s) return '';
      // URL form: instagram.com/<handle>/?…
      const m = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/);
      if (m) return m[1];
      // @handle or bare handle
      s = s.replace(/^@/, '');
      if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return s;
      return '';
    }
    function extractTwitchChannel(url) {
      let s = String(url || '').trim();
      if (!s) return '';
      // Strip protocol + optional www. + trailing slash
      const m = s.match(/twitch\.tv\/([A-Za-z0-9_]{4,25})/);
      if (m) return m[1];
      s = s.replace(/\/+$/, '');
      if (/^[A-Za-z0-9_]{4,25}$/.test(s)) return s;
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
        const o = { name: v.name || '', url: v.url || '' };
        if (v.slug)           o.slug           = v.slug;
        if (v.logo)           o.logo           = v.logo;
        if (v.description)    o.description    = v.description;
        if (v.pointOfContact) o.pointOfContact = v.pointOfContact;
        if (v.story)          o.story          = v.story;

        // Repeatables — emit the key only when the array is non-empty.
        const rs = recoSchemas.partner.repeatables;
        const socials       = readRepeatableArray('socials',       rs.socials);
        const photoEntries  = readRepeatableArray('photos',        rs.photos);
        const videos        = readRepeatableArray('videos',        rs.videos);
        const contributions = readRepeatableArray('contributions', rs.contributions);
        if (socials.length)       o.socials       = socials;
        if (photoEntries.length)  o.photos        = photoEntries.map(function (p) { return p.path; }).filter(Boolean);
        if (videos.length)        o.videos        = videos;
        if (contributions.length) o.contributions = contributions;

        // _pocEmail is NEVER written to JSON. It's a private maintainer
        // hint inside the builder UI only (Req 9.3, Req 11.6). Because
        // we copy field-by-field above, it can't leak.
        return o;
      }
      if (recoKind === 'spotify-show') {
        const parsed = extractSpotifyId(v.url || '');
        return { kind: 'spotify', type: 'show', id: parsed.id, title: v.title, source: v.source, note: v.note };
      }
      if (recoKind === 'youtube-channel') {
        const ex = extractYouTubeChannel(v.url || '');
        const o = { kind: 'youtube', feedType: 'channel', title: v.title, source: v.source, note: v.note };
        if (ex.id) o.id = ex.id;
        if (ex.handle) o.handle = ex.handle;
        return o;
      }
      if (recoKind === 'youtube-playlist') {
        return { kind: 'youtube', feedType: 'playlist', id: extractYouTubePlaylist(v.url || ''), title: v.title, source: v.source, note: v.note };
      }
      if (recoKind === 'instagram') {
        const o = { kind: 'instagram', handle: extractInstagramHandle(v.url || ''), title: v.title, source: v.source, note: v.note };
        if (v.avatar) o.avatar = v.avatar;
        return o;
      }
      if (recoKind === 'twitch') {
        return { kind: 'twitch', channel: extractTwitchChannel(v.url || ''), title: v.title, source: v.source, note: v.note };
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
      if (recoKind === 'spotify-show') {
        if (!obj.id) return 'needs-url';
      }
      if (recoKind === 'youtube-channel') {
        if (!obj.id && !obj.handle) return 'needs-url';
      }
      if (recoKind === 'youtube-playlist') {
        if (!obj.id) return 'needs-url';
      }
      if (recoKind === 'instagram') {
        if (!obj.handle) return 'needs-url';
      }
      if (recoKind === 'twitch') {
        if (!obj.channel) return 'needs-url';
      }
      if (recoKind === 'partner') {
        if (!obj.name || !obj.url) return 'incomplete';

        const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
        const richFieldsPresent = !!(obj.pointOfContact || obj.story
          || (obj.socials && obj.socials.length)
          || (obj.photos && obj.photos.length)
          || (obj.videos && obj.videos.length)
          || (obj.contributions && obj.contributions.length));

        if (richFieldsPresent && !obj.slug) return 'incomplete';
        if (obj.slug && !SLUG_RE.test(obj.slug)) return 'incomplete';

        // Reject partial repeatable rows. Empty rows are dropped earlier
        // by readRepeatableArray; partial rows (some sub-field non-empty
        // but a required sub-field missing) surface here.
        if (obj.socials && obj.socials.some(function (s) { return !s.platform || !s.url; })) return 'incomplete';
        if (obj.videos && obj.videos.some(function (v) { return !v.provider || !v.url; })) return 'incomplete';
        if (obj.contributions && obj.contributions.some(function (c) { return !c.href || !c.label; })) return 'incomplete';

        return 'ready';
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

    // ── Shadow-period "Commit to GitHub" handoff ────────────────────────
    // While the new editor is in its two-week shadow period, the builder
    // keeps its Copy button AND gets a new primary button that hands the
    // current entry off to the editor (which commits to GitHub directly).
    // Req 15 AC 2.
    wireCommitHandoff();

    function wireCommitHandoff() {
      // Avoid double-wiring on re-renders.
      if (copyBtn.parentNode && copyBtn.parentNode.querySelector('.reco-builder__btn--commit')) return;

      const commitBtn = document.createElement('button');
      commitBtn.type = 'button';
      commitBtn.className = 'reco-builder__btn reco-builder__btn--primary reco-builder__btn--commit';
      commitBtn.textContent = '🚀 Commit to GitHub';
      commitBtn.title = 'Send this entry to the new Editor to commit straight to GitHub (preview first).';
      // Insert as the new primary action, leaving Copy as a secondary fallback.
      copyBtn.classList.remove('reco-builder__btn--primary');
      copyBtn.classList.add('reco-builder__btn--secondary');
      copyBtn.parentNode.insertBefore(commitBtn, copyBtn);

      commitBtn.addEventListener('click', () => {
        const obj = buildObject();
        const state = readiness(obj);
        if (state !== 'ready') {
          if (statusEl) {
            statusEl.textContent = state === 'needs-url'
              ? '⚠️ Paste a URL first.'
              : '⚠️ Fill the required fields first.';
            setTimeout(() => { statusEl.textContent = ''; }, 2500);
          }
          return;
        }
        if (!window.AdminEditor || typeof window.AdminEditor.openRecommendationsWith !== 'function') {
          if (statusEl) {
            statusEl.textContent = '⚠️ Editor not loaded. Hard-refresh the page and try again.';
            setTimeout(() => { statusEl.textContent = ''; }, 3500);
          }
          return;
        }
        // Partner entries go into partners[], everything else into listening[].
        // The legacy builder's obj shape for partner is { name, url, logo?, description? };
        // the editor's schema expects the same. For listening entries, we pass the
        // shape the new schema stores (kind + url + title + ...), NOT the auto-
        // extracted-id shape the old builder emitted — the new editor does its own
        // id extraction via the schemas helpers. The renderer-side `kind` lives on
        // `obj.kind` (so spotify-show → 'spotify', youtube-channel/-playlist →
        // 'youtube'), and the builder kind is preserved via additional fields like
        // `feedType` (youtube channel/playlist) and `avatar` (instagram).
        const prefill = (recoKind === 'partner')
          ? { _bucket: 'partners', name: obj.name, url: obj.url, logo: obj.logo, description: obj.description }
          : { _bucket: 'listening', kind: obj.kind, url: buildListeningUrl(obj, recoKind), title: obj.title, source: obj.source, note: obj.note, image: obj.image, feedType: obj.feedType, avatar: obj.avatar };

        // Clean undefined.
        Object.keys(prefill).forEach((k) => { if (prefill[k] === undefined) delete prefill[k]; });

        // Jump to the Editor tab and hand off.
        const editorTab = document.querySelector('.admin-tab[data-cat="editor"]');
        if (editorTab) editorTab.click();
        window.AdminEditor.openRecommendationsWith(prefill);

        if (statusEl) {
          statusEl.textContent = '➡️ Opened in Editor — review and commit.';
          setTimeout(() => { statusEl.textContent = ''; }, 2500);
        }
      });
    }

    function buildListeningUrl(obj, kind) {
      // The legacy builder stores the original URL as the admin typed it in
      // a separate form field; `fieldsEl` still has the live inputs.
      const urlInput = fieldsEl.querySelector('[data-name="url"]');
      if (urlInput && urlInput.value) return urlInput.value.trim();
      // Fallback: reconstruct a canonical URL from obj if the input has been
      // reset by the time we got here.
      if (kind === 'spotify' && obj.id) return 'https://open.spotify.com/' + obj.type + '/' + obj.id;
      if (kind === 'youtube' && obj.id) return 'https://www.youtube.com/watch?v=' + obj.id;
      if (kind === 'spotify-show' && obj.id) return 'https://open.spotify.com/show/' + obj.id;
      if (kind === 'youtube-channel') {
        if (obj.id) return 'https://www.youtube.com/channel/' + obj.id;
        if (obj.handle) return 'https://www.youtube.com/' + obj.handle;
      }
      if (kind === 'youtube-playlist' && obj.id) return 'https://www.youtube.com/playlist?list=' + obj.id;
      if (kind === 'instagram' && obj.handle) return 'https://www.instagram.com/' + obj.handle + '/';
      if (kind === 'twitch' && obj.channel) return 'https://www.twitch.tv/' + obj.channel;
      return obj.url || '';
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
  // ── Interactive walkthrough player ─────────────────────────
  // Progressive-enhancement: each `.ah-walk` already contains a
  // simulated UI (`.ah-stage` with `.ah-ctl[data-ctl]` controls) and
  // a list of steps (`.ah-walk__data > .ah-walk-step`). This wires the
  // Back / Next / Replay controls, spotlights the control each step
  // teaches, and animates a little cursor onto it. If the JS fails or
  // is disabled, the step text is still fully readable.
  function initWalkthroughs() {
    var walks = document.querySelectorAll('.ah-walk');
    walks.forEach(function (walk) {
      var stage    = walk.querySelector('.ah-stage');
      var cursor   = walk.querySelector('.ah-cursor');
      var stepEls  = Array.prototype.slice.call(walk.querySelectorAll('.ah-walk__data > .ah-walk-step'));
      var elStepNo = walk.querySelector('.ah-explain__step');
      var elTitle  = walk.querySelector('.ah-explain__title');
      var elBody   = walk.querySelector('.ah-explain__body');
      var elBehind = walk.querySelector('.ah-explain__behind');
      var elDone   = walk.querySelector('.ah-explain__done');
      var elCount  = walk.querySelector('.ah-walk__count');
      var btnBack  = walk.querySelector('.ah-walk__btn--back');
      var btnNext  = walk.querySelector('.ah-walk__btn--next');
      var btnReplay= walk.querySelector('.ah-walk__btn--replay');
      var progress = walk.querySelector('.ah-walk__progress');
      if (!stepEls.length || !elTitle || !btnNext) return;

      var total = stepEls.length;
      var idx = 0;

      if (elCount) elCount.textContent = total + ' steps';
      if (progress) {
        progress.innerHTML = '';
        for (var i = 0; i < total; i++) {
          var d = document.createElement('span');
          d.className = 'ah-walk__dot';
          progress.appendChild(d);
        }
      }

      function reads(step, sel) {
        var n = step.querySelector(sel);
        return n ? n.innerHTML : '';
      }

      function moveCursorTo(ctl) {
        if (!cursor || !stage || !ctl) { if (cursor) cursor.classList.remove('is-on'); return; }
        // Position the cursor near the center-right of the spotlighted control,
        // measured relative to the stage so it works at any width.
        var sRect = stage.getBoundingClientRect();
        var cRect = ctl.getBoundingClientRect();
        var x = (cRect.left - sRect.left) + Math.min(cRect.width - 14, cRect.width * 0.5);
        var y = (cRect.top - sRect.top) + (cRect.height * 0.5);
        cursor.style.left = x + 'px';
        cursor.style.top = y + 'px';
        cursor.classList.add('is-on');
      }

      function render() {
        var step = stepEls[idx];
        var target = step.getAttribute('data-target') || '';
        var tab = step.getAttribute('data-tab') || '';

        // Text panel
        if (elStepNo) elStepNo.textContent = 'Step ' + (idx + 1) + ' of ' + total;
        if (elTitle)  elTitle.innerHTML = reads(step, '.ah-s-title');
        if (elBody)   elBody.innerHTML = reads(step, '.ah-s-body');
        var behind = reads(step, '.ah-s-behind');
        if (elBehind) {
          if (behind) { elBehind.innerHTML = '<b>Behind the scenes:</b> ' + behind; elBehind.style.display = ''; }
          else elBehind.style.display = 'none';
        }

        // Optional simulated tab switch
        if (tab && stage) {
          stage.querySelectorAll('.ah-mini-tab').forEach(function (t) {
            t.classList.toggle('is-active', t.getAttribute('data-tab') === tab);
          });
        }

        // Spotlight the target control; dim the rest.
        var spot = null;
        if (stage) {
          stage.querySelectorAll('.ah-ctl').forEach(function (ctl) {
            var isTarget = target && ctl.getAttribute('data-ctl') === target;
            ctl.classList.toggle('is-spot', !!isTarget);
            ctl.classList.toggle('is-dim', !!target && !isTarget);
            if (isTarget) spot = ctl;
          });
        }
        // Defer cursor move so layout (tab switch) has settled.
        window.requestAnimationFrame(function () { moveCursorTo(spot); });

        // Progress dots
        if (progress) {
          Array.prototype.forEach.call(progress.children, function (dot, i) {
            dot.classList.toggle('is-done', i < idx);
            dot.classList.toggle('is-current', i === idx);
          });
        }

        // Buttons
        if (btnBack) btnBack.disabled = idx === 0;
        var last = idx === total - 1;
        if (btnNext) btnNext.textContent = last ? 'Finish ✓' : 'Next →';
        if (elDone) elDone.classList.toggle('is-visible', last);
      }

      if (btnNext) btnNext.addEventListener('click', function () {
        if (idx < total - 1) { idx++; render(); }
        else { /* finished — keep last step visible, done badge shows */ }
      });
      if (btnBack) btnBack.addEventListener('click', function () {
        if (idx > 0) { idx--; render(); }
      });
      if (btnReplay) btnReplay.addEventListener('click', function () {
        idx = 0; render();
      });

      render();
    });
  }

  // ── Contextual "?" tooltips ─────────────────────────────────
  // Desktop reveals on hover/focus via CSS. This adds click-to-toggle
  // for touch devices (aria-expanded + .is-open on the wrapper).
  function initHelpTips() {
    document.querySelectorAll('.ah-help').forEach(function (btn) {
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');
      function toggle(e) {
        e.preventDefault();
        e.stopPropagation();
        var open = btn.getAttribute('aria-expanded') === 'true';
        // Close any others first.
        document.querySelectorAll('.ah-help[aria-expanded="true"]').forEach(function (o) {
          o.setAttribute('aria-expanded', 'false');
          var w = o.closest('.ah-help-wrap'); if (w) w.classList.remove('is-open');
        });
        if (!open) {
          btn.setAttribute('aria-expanded', 'true');
          var wrap = btn.closest('.ah-help-wrap'); if (wrap) wrap.classList.add('is-open');
        }
      }
      btn.addEventListener('click', toggle);
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') toggle(e);
        if (e.key === 'Escape') { btn.setAttribute('aria-expanded', 'false'); var w = btn.closest('.ah-help-wrap'); if (w) w.classList.remove('is-open'); }
      });
    });
    // Outside click closes open tips.
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.ah-help-wrap')) return;
      document.querySelectorAll('.ah-help[aria-expanded="true"]').forEach(function (o) {
        o.setAttribute('aria-expanded', 'false');
        var w = o.closest('.ah-help-wrap'); if (w) w.classList.remove('is-open');
      });
    });
  }

  // ── Loading / "Please wait…" demos ──────────────────────────
  // Wires the two demo buttons in the "Loading & waiting" section so
  // admins can see the exact spinner + overlay affordances the real
  // tools use while the backend responds.
  function initLoadingDemos() {
    var btn = document.getElementById('ah-demo-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="ah-spinner"></span> Saving…';
        setTimeout(function () {
          btn.innerHTML = '✓ Saved';
          setTimeout(function () { btn.disabled = false; btn.innerHTML = original; }, 1200);
        }, 1600);
      });
    }
    var overlayBtn = document.getElementById('ah-demo-overlay-btn');
    var overlay = document.getElementById('ah-demo-overlay');
    if (overlayBtn && overlay) {
      var veil = overlay.querySelector('.ah-overlay-demo__veil');
      overlayBtn.addEventListener('click', function () {
        if (!veil) return;
        veil.classList.add('is-on');
        setTimeout(function () { veil.classList.remove('is-on'); }, 1800);
      });
    }
  }

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
