/* ============================================================
   Testimony renderer — Seed the Word Ministry
   Reads assets/data/testimonies.json and renders into one of:
     - #testimonies-grid    on news.html         → recent N (default 6)
     - #testimonies-grid    on testimonies.html  → ALL published
     - #testimonies-strip   on about.html        → compact 1-2 tile soft strip
     - showcase-carousel.js  uses STWTestimonies.pickShowcaseTestimony
        to pick one rotating tile for the homepage
   Spec: .kiro/specs/ministry-ops-and-testimonies/

   Author filter: when the URL has `?author=Some%20Name` the news-page
   grid is filtered to entries whose `name` matches (case-insensitive,
   trimmed). If no entries match, the filter quietly falls through to
   the default (all published, recent first) so the page never goes
   blank from a stale filter.
   ============================================================ */
(function () {
  'use strict';

  const MANIFEST_URL = 'assets/data/testimonies.json';
  // Cap on the news.html homepage section. testimonies.html is
  // unbounded — it's the archive page.
  const NEWS_GRID_LIMIT = 6;
  let cache = null;

  async function loadManifest() {
    if (cache) return cache;
    try {
      const res = await fetch(MANIFEST_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('http-' + res.status);
      const data = await res.json();
      const all = Array.isArray(data && data.testimonies) ? data.testimonies : [];
      cache = all.filter(function (t) { return t && t.published === true; });
      return cache;
    } catch (err) {
      console.log('[testimonies] manifest load failed:', err);
      cache = [];
      return cache;
    }
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function displayName(t) {
    if (t.anonymous === true) return 'Anonymous';
    return (t.name && String(t.name).trim()) || 'Anonymous';
  }

  // Preserve paragraphs from \n\n in the source; single \n becomes <br>.
  function formatBody(body) {
    return String(body || '')
      .split(/\n{2,}/)
      .map(function (p) {
        return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  // Sort: most recently published first (descending publishedAt).
  function sortRecent(list) {
    return list.slice().sort(function (a, b) {
      return String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
    });
  }

  // Read ?author= from the current URL, normalize for matching.
  function getAuthorFilter() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = (params.get('author') || '').trim().toLowerCase();
      return v || null;
    } catch (_) { return null; }
  }

  // ── card builders ─────────────────────────────────────────────
  function renderGridCard(t) {
    return ''
      + '<article class="testimony-card testimony-card--full" data-id="' + escapeHtml(t.id) + '">'
      +   '<blockquote class="testimony-card__quote">' + formatBody(t.body) + '</blockquote>'
      +   '<footer class="testimony-card__footer">'
      +     '<p class="testimony-card__author">&mdash; ' + escapeHtml(displayName(t)) + '</p>'
      +     '<p class="testimony-card__verse">' + escapeHtml(t.anchorVerse || '') + '</p>'
      +   '</footer>'
      + '</article>';
  }

  function renderStripCard(t) {
    return ''
      + '<article class="testimony-card testimony-card--compact" data-id="' + escapeHtml(t.id) + '">'
      +   '<p class="testimony-card__quote">&ldquo;' + escapeHtml(t.excerpt) + '&rdquo;</p>'
      +   '<p class="testimony-card__author">&mdash; ' + escapeHtml(displayName(t))
      +     ' <span class="testimony-card__verse">&middot; ' + escapeHtml(t.anchorVerse || '') + '</span></p>'
      + '</article>';
  }

  // ── public API ────────────────────────────────────────────────

  // Render a grid of testimonies. By default (no opts) renders all
  // published, recent first — used by the testimonies.html archive
  // page. Pass {limit: 6} to cap the news-page section. Hides the
  // grid container on empty state so surrounding markup (the share
  // CTA on news.html, the empty-state message on testimonies.html)
  // is responsible for what shows up in its place.
  async function renderGrid(container, opts) {
    opts = opts || {};
    const limit = opts.limit || 0;
    const author = opts.respectAuthorFilter ? getAuthorFilter() : null;

    let list = sortRecent(await loadManifest());

    // Author filter — if a match exists, narrow to it. If no entries
    // match, fall through silently to the unfiltered list so the
    // page never goes blank from a stale URL parameter.
    if (author) {
      const matching = list.filter(function (t) {
        const n = (t.name || '').trim().toLowerCase();
        return n === author;
      });
      if (matching.length > 0) list = matching;
    }

    // Apply optional limit (0 = unlimited).
    const displayed = limit > 0 ? list.slice(0, limit) : list;

    // Companion controls — the news.html section has a "Read every
    // testimony →" archive link that should reveal only when:
    //   (a) there are entries to show AND
    //   (b) the displayed slice is shorter than the full list.
    const archiveLink = document.getElementById('testimonies-archive-link');
    if (archiveLink) {
      archiveLink.hidden = !(displayed.length > 0 && displayed.length < list.length);
    }

    // The testimonies.html archive has its own empty-state message
    // that needs to flip on/off based on the published count.
    const archiveEmpty = document.getElementById('testimonies-archive-empty');
    if (archiveEmpty) {
      archiveEmpty.hidden = displayed.length > 0;
    }

    if (!displayed.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    container.innerHTML = displayed.map(renderGridCard).join('');
  }

  // Render compact strip (about.html). 1 or 2 tiles, recent first.
  // The strip lives in its own dedicated section, so on empty state
  // we hide the whole section to avoid an awkward empty heading.
  async function renderStrip(container, count) {
    const n = (typeof count === 'number' && count > 0) ? count : 2;
    const list = sortRecent(await loadManifest()).slice(0, n);
    if (!list.length) {
      const section = container.closest('section');
      if (section) section.remove();
      else container.remove();
      return;
    }
    container.innerHTML = list.map(renderStripCard).join('');
  }

  // Pick one for showcase-carousel. Random among the 5 most recent so
  // repeat visitors see variety.
  async function pickShowcaseTestimony() {
    const list = sortRecent(await loadManifest()).slice(0, 5);
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  // Expose under a single namespace so consumers don't pollute window.
  window.STWTestimonies = {
    renderGrid: renderGrid,
    renderStrip: renderStrip,
    pickShowcaseTestimony: pickShowcaseTestimony,
    displayName: displayName,
  };

  // Auto-wire on DOMContentLoaded based on which page we're on.
  // The decision tree:
  //   - testimonies.html → render the unbounded archive (no limit)
  //   - news.html        → render up to NEWS_GRID_LIMIT, respect ?author
  //   - about.html       → render the compact strip (max 2)
  //   - homepage         → handled by showcase-carousel.js, not here
  function autoWire() {
    const grid  = document.getElementById('testimonies-grid');
    const strip = document.getElementById('testimonies-strip');

    if (grid) {
      // Detect which page we're on by looking at body URL or by
      // checking the page-specific empty-state element. testimonies.html
      // has #testimonies-archive-empty; news.html does not.
      const isArchive = !!document.getElementById('testimonies-archive-empty');
      if (isArchive) {
        renderGrid(grid, { limit: 0 });
      } else {
        renderGrid(grid, { limit: NEWS_GRID_LIMIT, respectAuthorFilter: true });
      }
    }
    if (strip) renderStrip(strip, 2);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWire);
  } else {
    autoWire();
  }
})();
