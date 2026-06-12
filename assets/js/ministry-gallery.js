/* ============================================================
   Ministry Gallery — testimonies.html #ministry-gallery
   Aggregates every photo from every ministry-outreach event
   folder plus assets/images/ministry-highlights/ into a
   full-bleed masonry thumbnail grid. Clicking any photo opens
   a full-size lightbox with prev/next navigation and caption.
   ============================================================ */

const OUTREACH_INDEX_URL  = 'assets/data/ministry-outreach.json';
const OUTREACH_BASE_PATH  = 'assets/images/ministry-outreach';
const HIGHLIGHTS_MANIFEST = 'assets/images/ministry-highlights/images.json';
const HIGHLIGHTS_BASE     = 'assets/images/ministry-highlights';

// ── Init ───────────────────────────────────────────────────────────────────
async function initMinistryGallery() {
  const mount = document.getElementById('ministry-gallery-grid');
  if (!mount) return;

  // Show loading state
  mount.innerHTML = '<p class="gallery-loading">Loading gallery…</p>';

  let allPhotos = [];

  // 1. Load outreach event photos
  try {
    const res = await fetch(`${OUTREACH_INDEX_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const index = await res.json();
      const events = Array.isArray(index.events) ? index.events : [];
      const manifests = await Promise.all(events.map(async ev => {
        try {
          const mr = await fetch(`${OUTREACH_BASE_PATH}/${ev.folder}/images.json?t=${Date.now()}`, { cache: 'no-store' });
          if (!mr.ok) return [];
          const m = await mr.json();
          const media = Array.isArray(m.media) ? m.media : [];
          return media
            .filter(item => item && item.file && item.type === 'photo')
            .map(item => ({
              src: `${OUTREACH_BASE_PATH}/${ev.folder}/${encodeURIComponent(item.file)}`,
              caption: item.caption || '',
              group: ev.title || ev.folder,
              date: ev.date || '',
              location: ev.location || '',
            }));
        } catch (_) { return []; }
      }));
      manifests.forEach(group => allPhotos.push(...group));
    }
  } catch (_) {}

  // 2. Load ministry highlights photos
  try {
    const res = await fetch(`${HIGHLIGHTS_MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const images = Array.isArray(data.images) ? data.images : [];
      images.filter(item => item && item.file).forEach(item => {
        allPhotos.push({
          src: `${HIGHLIGHTS_BASE}/${item.file}`,
          caption: item.body || item.title || '',
          group: 'Ministry Highlights',
          date: '',
          location: '',
        });
      });
    }
  } catch (_) {}

  if (!allPhotos.length) {
    mount.innerHTML = '<p class="gallery-empty">Photos will appear here as we add them.</p>';
    return;
  }

  // Render grid
  mount.innerHTML = allPhotos.map((photo, idx) => `
    <button
      class="gallery-thumb"
      data-index="${idx}"
      aria-label="Open photo${photo.caption ? ': ' + escapeHtml(photo.caption) : ''} from ${escapeHtml(photo.group)}"
      style="background-image:url('${escapeAttr(photo.src)}')">
      ${photo.group ? `<span class="gallery-thumb__group">${escapeHtml(photo.group)}</span>` : ''}
    </button>
  `).join('');

  // Wire lightbox
  mount.addEventListener('click', e => {
    const btn = e.target.closest('.gallery-thumb');
    if (!btn) return;
    openLightbox(allPhotos, parseInt(btn.dataset.index, 10));
  });

  // If page loaded with #ministry-gallery in the hash, scroll to it
  if (window.location.hash === '#ministry-gallery') {
    mount.closest('section')?.scrollIntoView({ behavior: 'smooth' });
  }
}

// ── Lightbox ───────────────────────────────────────────────────────────────
let _lightboxEl = null;
let _currentPhotos = [];
let _currentIdx = 0;

function openLightbox(photos, startIdx) {
  _currentPhotos = photos;
  _currentIdx    = startIdx;

  if (!_lightboxEl) _lightboxEl = buildLightbox();
  document.body.appendChild(_lightboxEl);
  document.body.style.overflow = 'hidden';

  renderLightboxSlide();
  _lightboxEl.hidden = false;
  _lightboxEl.querySelector('.lightbox__close').focus();
}

function closeLightbox() {
  if (_lightboxEl) {
    _lightboxEl.hidden = true;
    _lightboxEl.remove();
  }
  document.body.style.overflow = '';
}

function renderLightboxSlide() {
  if (!_lightboxEl) return;
  const photo   = _currentPhotos[_currentIdx];
  const imgEl   = _lightboxEl.querySelector('.lightbox__img');
  const captEl  = _lightboxEl.querySelector('.lightbox__caption');
  const groupEl = _lightboxEl.querySelector('.lightbox__group');
  const counterEl = _lightboxEl.querySelector('.lightbox__counter');

  imgEl.src = photo.src;
  imgEl.alt = photo.caption || photo.group || 'Ministry photo';
  captEl.textContent = photo.caption || '';
  captEl.hidden = !photo.caption;

  const meta = [photo.group, photo.date, photo.location].filter(Boolean).join(' · ');
  groupEl.textContent = meta;
  groupEl.hidden = !meta;

  counterEl.textContent = `${_currentIdx + 1} / ${_currentPhotos.length}`;

  // Prev/next button visibility
  _lightboxEl.querySelector('.lightbox__prev').disabled = _currentIdx === 0;
  _lightboxEl.querySelector('.lightbox__next').disabled = _currentIdx === _currentPhotos.length - 1;
}

function buildLightbox() {
  const el = document.createElement('div');
  el.className = 'ministry-lightbox';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Photo viewer');
  el.hidden = true;
  el.innerHTML = `
    <div class="lightbox__backdrop"></div>
    <div class="lightbox__shell">
      <button class="lightbox__close" aria-label="Close photo viewer">✕</button>
      <button class="lightbox__prev" aria-label="Previous photo">‹</button>
      <div class="lightbox__stage">
        <img class="lightbox__img" src="" alt="" loading="eager">
      </div>
      <button class="lightbox__next" aria-label="Next photo">›</button>
      <div class="lightbox__meta">
        <p class="lightbox__counter"></p>
        <p class="lightbox__group" hidden></p>
        <p class="lightbox__caption" hidden></p>
      </div>
    </div>
  `;

  el.querySelector('.lightbox__backdrop').addEventListener('click', closeLightbox);
  el.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
  el.querySelector('.lightbox__prev').addEventListener('click', () => {
    if (_currentIdx > 0) { _currentIdx--; renderLightboxSlide(); }
  });
  el.querySelector('.lightbox__next').addEventListener('click', () => {
    if (_currentIdx < _currentPhotos.length - 1) { _currentIdx++; renderLightboxSlide(); }
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (_lightboxEl && !_lightboxEl.hidden) {
      if (e.key === 'ArrowLeft')  { if (_currentIdx > 0) { _currentIdx--; renderLightboxSlide(); } }
      if (e.key === 'ArrowRight') { if (_currentIdx < _currentPhotos.length - 1) { _currentIdx++; renderLightboxSlide(); } }
      if (e.key === 'Escape') closeLightbox();
    }
  });

  return el;
}

/* ── Utilities ────────────────────────────────────────────────────────────── */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMinistryGallery);
} else {
  initMinistryGallery();
}
