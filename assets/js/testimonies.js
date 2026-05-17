/* ============================================================
   Testimony renderer — Seed the Word Ministry
   Reads assets/data/testimonies.json and renders into one of:
     - #testimonies-grid    (news.html — full grid of all published)
     - #testimonies-strip   (about.html — compact 1-2 tile soft strip)
     - showcase-carousel.js  uses STWTestimonies.pickShowcaseTestimony
        to pick one rotating tile for the homepage
   Spec: .kiro/specs/ministry-ops-and-testimonies/
   ============================================================ */
(function () {
  'use strict';

  const MANIFEST_URL = 'assets/data/testimonies.json';
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

  // Render full grid (news.html). All published, recent first. When
  // there are no published entries, hide the whole section (find the
  // nearest <section> ancestor and remove it from the page) instead
  // of rendering an empty-state message that looks like a bug.
  async function renderGrid(container) {
    const list = sortRecent(await loadManifest());
    if (!list.length) {
      const section = container.closest('section');
      if (section) section.remove();
      else container.remove();
      return;
    }
    container.innerHTML = list.map(renderGridCard).join('');
  }

  // Render compact strip (about.html). 1 or 2 tiles, recent first.
  // Same hide-the-section behavior on empty state.
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

  // Auto-wire on DOMContentLoaded based on which container exists.
  function autoWire() {
    const grid  = document.getElementById('testimonies-grid');
    const strip = document.getElementById('testimonies-strip');
    if (grid)  renderGrid(grid);
    if (strip) renderStrip(strip, 2);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWire);
  } else {
    autoWire();
  }
})();
