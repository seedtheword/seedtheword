/* ============================================================
   Ministry Gallery — testimonies.html #ministry-gallery
   Wrapped in an IIFE to avoid variable collisions with
   ministry-outreach.js which shares the same page.
   ============================================================ */
(function () {
  'use strict';

  const INDEX_URL        = 'assets/data/ministry-outreach.json';
  const OUTREACH_BASE    = 'assets/images/ministry-outreach';
  const HIGHLIGHTS_JSON  = 'assets/images/ministry-highlights/images.json';
  const HIGHLIGHTS_BASE  = 'assets/images/ministry-highlights';

  // ── Init ─────────────────────────────────────────────────────────────────
  async function initMinistryGallery() {
    const mount = document.getElementById('ministry-gallery-grid');
    if (!mount) return;

    mount.innerHTML = '<p class="gallery-loading">Loading gallery…</p>';

    const allPhotos = [];

    // 1. Outreach event photos
    try {
      const res = await fetch(INDEX_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const index = await res.json();
        const events = Array.isArray(index.events) ? index.events : [];
        const groups = await Promise.all(events.map(async ev => {
          try {
            const mr = await fetch(OUTREACH_BASE + '/' + ev.folder + '/images.json?t=' + Date.now(), { cache: 'no-store' });
            if (!mr.ok) return [];
            const m = await mr.json();
            return (Array.isArray(m.media) ? m.media : [])
              .filter(item => item && item.file && item.type === 'photo')
              .map(item => ({
                src: OUTREACH_BASE + '/' + ev.folder + '/' + encodeURIComponent(item.file),
                caption: item.caption || '',
                group: ev.title || ev.folder,
                date: ev.date || '',
                location: ev.location || '',
              }));
          } catch (_) { return []; }
        }));
        groups.forEach(g => allPhotos.push(...g));
      }
    } catch (_) {}

    // 2. Ministry highlights photos
    try {
      const res = await fetch(HIGHLIGHTS_JSON + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        (Array.isArray(data.images) ? data.images : [])
          .filter(item => item && item.file)
          .forEach(item => allPhotos.push({
            src: HIGHLIGHTS_BASE + '/' + item.file,
            caption: item.body || item.title || '',
            group: 'Ministry Highlights',
            date: '',
            location: '',
          }));
      }
    } catch (_) {}

    if (!allPhotos.length) {
      mount.innerHTML = '<p class="gallery-empty">Photos will appear here as we add them.</p>';
      return;
    }

    // Render grid
    mount.innerHTML = allPhotos.map((photo, idx) =>
      '<button class="gallery-thumb" data-index="' + idx + '"' +
        ' aria-label="Open photo from ' + esc(photo.group) + '"' +
        ' style="background-image:url(\'' + esc(photo.src) + '\')">' +
        (photo.group ? '<span class="gallery-thumb__group">' + esc(photo.group) + '</span>' : '') +
      '</button>'
    ).join('');

    mount.addEventListener('click', function (e) {
      const btn = e.target.closest('.gallery-thumb');
      if (btn) openLightbox(allPhotos, parseInt(btn.dataset.index, 10));
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────
  let _el = null;
  let _photos = [];
  let _idx = 0;

  function openLightbox(photos, startIdx) {
    _photos = photos;
    _idx    = startIdx;
    if (!_el) _el = buildLightbox();
    document.body.appendChild(_el);
    document.body.style.overflow = 'hidden';
    _el.hidden = false;
    renderSlide();
    _el.querySelector('.lightbox__close').focus();
  }

  function closeLightbox() {
    if (_el) { _el.hidden = true; _el.remove(); }
    document.body.style.overflow = '';
  }

  function renderSlide() {
    if (!_el) return;
    const p = _photos[_idx];
    _el.querySelector('.lightbox__img').src = p.src;
    _el.querySelector('.lightbox__img').alt = p.caption || p.group || 'Ministry photo';
    const cap = _el.querySelector('.lightbox__caption');
    cap.textContent = p.caption || '';
    cap.hidden = !p.caption;
    const meta = [p.group, p.date, p.location].filter(Boolean).join(' · ');
    const grp = _el.querySelector('.lightbox__group');
    grp.textContent = meta;
    grp.hidden = !meta;
    _el.querySelector('.lightbox__counter').textContent = (_idx + 1) + ' / ' + _photos.length;
    _el.querySelector('.lightbox__prev').disabled = _idx === 0;
    _el.querySelector('.lightbox__next').disabled = _idx === _photos.length - 1;
  }

  function buildLightbox() {
    const el = document.createElement('div');
    el.className = 'ministry-lightbox';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Photo viewer');
    el.hidden = true;
    el.innerHTML =
      '<div class="lightbox__backdrop"></div>' +
      '<div class="lightbox__shell">' +
        '<button class="lightbox__close" aria-label="Close photo viewer">✕</button>' +
        '<button class="lightbox__prev" aria-label="Previous photo">‹</button>' +
        '<div class="lightbox__stage"><img class="lightbox__img" src="" alt="" loading="eager"></div>' +
        '<button class="lightbox__next" aria-label="Next photo">›</button>' +
        '<div class="lightbox__meta">' +
          '<p class="lightbox__counter"></p>' +
          '<p class="lightbox__group" hidden></p>' +
          '<p class="lightbox__caption" hidden></p>' +
        '</div>' +
      '</div>';

    el.querySelector('.lightbox__backdrop').addEventListener('click', closeLightbox);
    el.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
    el.querySelector('.lightbox__prev').addEventListener('click', function () {
      if (_idx > 0) { _idx--; renderSlide(); }
    });
    el.querySelector('.lightbox__next').addEventListener('click', function () {
      if (_idx < _photos.length - 1) { _idx++; renderSlide(); }
    });
    document.addEventListener('keydown', function (e) {
      if (_el && !_el.hidden) {
        if (e.key === 'ArrowLeft'  && _idx > 0)               { _idx--; renderSlide(); }
        if (e.key === 'ArrowRight' && _idx < _photos.length-1) { _idx++; renderSlide(); }
        if (e.key === 'Escape') closeLightbox();
      }
    });
    return el;
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMinistryGallery);
  } else {
    initMinistryGallery();
  }

})();
