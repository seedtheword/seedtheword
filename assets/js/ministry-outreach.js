/* ============================================================
   Ministry Outreach cards — news.html + testimonies.html
   Reads assets/data/ministry-outreach.json (master index) and
   each event's images.json (media manifest).

   On news.html (#ministry-outreach-cards):
   - Shows the first NEWS_PAGE_LIMIT events with full slideshows
   - If more events exist, renders a "See more stories →" overflow
     button that expands the remaining cards inline
   - If even more overflow than INLINE_EXPAND_LIMIT, a spillover
     CTA links to testimonies.html#ministry-stories

   On testimonies.html (#ministry-stories-cards):
   - Renders all events BEYOND the first NEWS_PAGE_LIMIT as cards
     (the spillover from news.html)
   ============================================================ */

const OUTREACH_INDEX_URL = 'assets/data/ministry-outreach.json';
const OUTREACH_BASE_PATH = 'assets/images/ministry-outreach';
const PHOTO_HOLD_MS = 5500;

// Events shown on news.html before "See more" kicks in
const NEWS_PAGE_LIMIT = 4;

// Live sheet-backed stories (super-admin published via getPublishedContent).
// These are single-image cards appended after the folder-based photo essays,
// so the rich existing galleries stay intact and new stories publish live.
async function loadLiveOutreachStories() {
  try {
    const cfg = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    if (!cfg || !cfg.orderHandlerUrl) return [];
    const res = await fetch(cfg.orderHandlerUrl + '?action=getPublishedContent', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data && data.ok && Array.isArray(data.stories)) ? data.stories : [];
  } catch (e) { return []; }
}

function renderLiveStoryCard(s) {
  const img = s.image
    ? `<div class="outreach-card__media"><div class="outreach-slide active"><img class="outreach-slide__img" src="${escapeAttr(s.image)}" alt="${escapeAttr(s.title || 'Outreach')}"></div></div>`
    : '';
  return `
    <article class="outreach-card glass-morphism">
      ${img}
      <div class="outreach-card__body">
        <p class="outreach-card__date">${escapeHtml(s.date || '')}</p>
        <h4 class="outreach-card__title">${escapeHtml(s.title || 'Outreach')}</h4>
        <p class="outreach-card__location">${escapeHtml(s.location || '')}</p>
        <p class="outreach-card__body-text">${escapeHtml(s.body || '')}</p>
        <div class="outreach-card__actions">
          <a class="outreach-card__cta" href="about.html#contact">Share your testimony <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </article>
  `;
}

async function initMinistryOutreach() {
  const newsMount       = document.getElementById('ministry-outreach-cards');
  const storiesMount    = document.getElementById('ministry-stories-cards');
  if (!newsMount && !storiesMount) return;

  let index;
  try {
    const res = await fetch(`${OUTREACH_INDEX_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    console.warn('Ministry outreach: could not load master index:', err.message);
    if (newsMount) newsMount.innerHTML = renderInvitationCard(true);
    return;
  }

  const events = Array.isArray(index.events) ? index.events : [];

  // Load ALL manifests in parallel
  const manifests = await Promise.all(
    events.map(async ev => {
      try {
        const res = await fetch(`${OUTREACH_BASE_PATH}/${ev.folder}/images.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = await res.json();
        return { ev, media: Array.isArray(m.media) ? m.media.filter(x => x && x.file) : [] };
      } catch (err) {
        console.warn(`Outreach manifest for ${ev.folder} failed:`, err.message);
        return { ev, media: [] };
      }
    })
  );

  const valid = manifests.filter(x => x.media.length > 0);

  // ── news.html mount ────────────────────────────────────────
  if (newsMount) {
    const primary   = valid.slice(0, NEWS_PAGE_LIMIT);
    const overflow  = valid.slice(NEWS_PAGE_LIMIT);

    const primaryHtml = primary.map(renderOutreachCard).join('');

    let overflowHtml = '';
    if (overflow.length > 0) {
      const overflowCards = overflow.map(renderOutreachCard).join('');
      overflowHtml = `
        <div class="outreach-overflow" id="outreach-overflow" hidden>
          ${overflowCards}
        </div>
        <div class="outreach-overflow-cta">
          <button class="btn btn-secondary outreach-overflow__toggle" id="outreach-overflow-toggle"
            aria-expanded="false" aria-controls="outreach-overflow">
            See ${overflow.length} more stor${overflow.length === 1 ? 'y' : 'ies'}
            <span aria-hidden="true">↓</span>
          </button>
          <a class="outreach-overflow__testimonies-link" href="testimonies.html#ministry-stories">
            📖 Full outreach archive on Testimonies
            <span aria-hidden="true">→</span>
          </a>
        </div>
      `;
    }

    // Invitation card if fewer than 2 primary events
    const filler = primary.length < 2 ? renderInvitationCard(false) : '';

    newsMount.innerHTML = primaryHtml + filler + overflowHtml;

    // Append live super-admin-published stories (single-image cards) at the
    // top, so freshly-published outreach shows first. Graceful: no-op if none.
    loadLiveOutreachStories().then(function (liveStories) {
      if (!liveStories || !liveStories.length) return;
      var html = liveStories.map(renderLiveStoryCard).join('');
      newsMount.insertAdjacentHTML('afterbegin', html);
    });

    // Wire overflow toggle
    const toggleBtn = newsMount.querySelector('#outreach-overflow-toggle');
    const overflowEl = newsMount.querySelector('#outreach-overflow');
    if (toggleBtn && overflowEl) {
      toggleBtn.addEventListener('click', () => {
        const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        overflowEl.hidden = expanded;
        toggleBtn.setAttribute('aria-expanded', String(!expanded));
        toggleBtn.innerHTML = expanded
          ? `See ${overflow.length} more stor${overflow.length === 1 ? 'y' : 'ies'} <span aria-hidden="true">↓</span>`
          : `Hide extra stories <span aria-hidden="true">↑</span>`;
        // Wire slideshows for newly revealed cards
        if (!expanded) {
          overflowEl.querySelectorAll('.outreach-card__media').forEach(startSlideshow);
        }
      });
    }

    // Wire primary slideshows
    newsMount.querySelectorAll(':scope > .outreach-card .outreach-card__media').forEach(startSlideshow);
  }

  // ── testimonies.html mount ─────────────────────────────────
  if (storiesMount) {
    // Show ALL events on the testimonies page (full archive)
    if (!valid.length) {
      storiesMount.innerHTML = `
        <p class="outreach-stories-empty">
          Stories from the field will appear here as we add them.
        </p>`;
      return;
    }
    storiesMount.innerHTML = valid.map(renderOutreachCard).join('');
    storiesMount.querySelectorAll('.outreach-card__media').forEach(startSlideshow);
  }
}

function renderOutreachCard({ ev, media }) {
  const slides = media.map((m, i) => slideMarkup(ev.folder, m, i)).join('');
  const dots = media.map((_, i) =>
    `<button class="outreach-slide-dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Slide ${i + 1}"></button>`
  ).join('');

  const testimonyBlock = ev.testimony && ev.testimony.trim()
    ? `<blockquote class="outreach-card__testimony">${escapeHtml(ev.testimony)}</blockquote>`
    : '';

  // Gallery link — links to testimonies.html#ministry-gallery filtered by this folder
  const galleryLink = `
    <a class="outreach-card__gallery-link" href="testimonies.html#ministry-gallery" data-folder="${escapeAttr(ev.folder)}">
      📷 View all photos
      <span aria-hidden="true">→</span>
    </a>
  `;

  return `
    <article class="outreach-card glass-morphism" data-folder="${escapeAttr(ev.folder)}">
      <div class="outreach-card__media">
        ${slides}
        <div class="outreach-slide-dots">${dots}</div>
      </div>
      <div class="outreach-card__body">
        <p class="outreach-card__date">${escapeHtml(ev.date || '')}</p>
        <h4 class="outreach-card__title">${escapeHtml(ev.title || 'Outreach')}</h4>
        <p class="outreach-card__location">${escapeHtml(ev.location || '')}</p>
        <p class="outreach-card__body-text">${escapeHtml(ev.body || '')}</p>
        ${testimonyBlock}
        <div class="outreach-card__actions">
          ${galleryLink}
          <a class="outreach-card__cta" href="about.html#contact">
            Share your testimony <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </article>
  `;
}

function slideMarkup(folder, m, i) {
  const src = `${OUTREACH_BASE_PATH}/${folder}/${encodeURIComponent(m.file)}`;
  const active = i === 0 ? 'active' : '';
  if (m.type === 'video') {
    return `
      <div class="outreach-slide outreach-slide--video ${active}" data-index="${i}" data-type="video">
        <video class="outreach-slide__video" src="${src}" playsinline muted preload="metadata"></video>
        ${m.caption ? `<div class="outreach-slide__caption">${escapeHtml(m.caption)}</div>` : ''}
      </div>
    `;
  }
  return `
    <div class="outreach-slide ${active}" data-index="${i}" data-type="photo"
         style="background-image:url('${src}')"
         data-src="${escapeAttr(src)}"
         data-caption="${escapeAttr(m.caption || '')}">
      ${m.caption ? `<div class="outreach-slide__caption">${escapeHtml(m.caption)}</div>` : ''}
    </div>
  `;
}

function renderInvitationCard(isFullError) {
  return `
    <article class="outreach-card outreach-card--invite glass-morphism">
      <div class="outreach-card__invite">
        <span class="outreach-card__invite-icon" aria-hidden="true">🤝</span>
        <h4 class="outreach-card__title">Want to join the next one?</h4>
        <p class="outreach-card__body-text">
          Our team hits the streets, parks, and campuses whenever God opens a door.
          ${isFullError ? 'Watch this space for photos and stories from the field.' : 'Pray with us, partner with us, or come along on the next outreach.'}
        </p>
        <div class="outreach-card__invite-actions">
          <a class="btn btn-primary btn-sm" href="about.html#contact">Get Involved</a>
          <a class="btn btn-secondary btn-sm" href="https://t.me/seedtheword" target="_blank" rel="noopener">Join Telegram</a>
        </div>
      </div>
    </article>
  `;
}

/* ── Slideshow driver ─────────────────────────────────────── */
function startSlideshow(container) {
  // Prevent double-wiring
  if (container.dataset.slideshowWired) return;
  container.dataset.slideshowWired = '1';

  const slides = [...container.querySelectorAll('.outreach-slide')];
  const dots   = [...container.querySelectorAll('.outreach-slide-dot')];
  if (slides.length < 2) {
    if (slides[0] && slides[0].dataset.type === 'video') {
      const v = slides[0].querySelector('video');
      if (v) { v.loop = true; v.play().catch(() => {}); }
    }
    return;
  }

  let current = 0;
  let timer = null;
  let paused = false;

  const advance = () => show((current + 1) % slides.length);

  function show(idx) {
    stopCurrent();
    slides[current].classList.remove('active');
    dots[current] && dots[current].classList.remove('active');
    current = idx;
    slides[current].classList.add('active');
    dots[current] && dots[current].classList.add('active');
    startCurrent();
  }

  function startCurrent() {
    if (paused) return;
    const s = slides[current];
    if (s.dataset.type === 'video') {
      const v = s.querySelector('video');
      if (v) {
        v.currentTime = 0;
        const fallback = setTimeout(advance, 45000);
        const onEnded = () => { clearTimeout(fallback); v.removeEventListener('ended', onEnded); advance(); };
        v.addEventListener('ended', onEnded);
        v.play().catch(() => { clearTimeout(fallback); timer = setTimeout(advance, PHOTO_HOLD_MS); });
      } else {
        timer = setTimeout(advance, PHOTO_HOLD_MS);
      }
    } else {
      timer = setTimeout(advance, PHOTO_HOLD_MS);
    }
  }

  function stopCurrent() {
    if (timer) { clearTimeout(timer); timer = null; }
    const s = slides[current];
    if (s && s.dataset.type === 'video') {
      const v = s.querySelector('video');
      if (v) { v.pause(); v.currentTime = 0; }
    }
  }

  container.addEventListener('mouseenter', () => { paused = true; stopCurrent(); });
  container.addEventListener('mouseleave', () => { paused = false; startCurrent(); });
  dots.forEach(dot => dot.addEventListener('click', (e) => {
    e.preventDefault();
    show(parseInt(dot.dataset.index, 10));
  }));

  startCurrent();
}

/* ── Utilities ─────────────────────────────────────────────── */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMinistryOutreach);
} else {
  initMinistryOutreach();
}
