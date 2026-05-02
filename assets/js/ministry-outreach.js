/* ============================================================
   Ministry Outreach cards — news.html
   Reads assets/data/ministry-outreach.json (master index) and
   each event's images.json (media manifest). Renders up to N
   outreach cards each with its own mixed-media slideshow
   (photos + videos). A third "invitation" card is appended if
   fewer than 3 events exist, inviting members to submit their
   own testimony.
   ============================================================ */

const OUTREACH_INDEX_URL = 'assets/data/ministry-outreach.json';
const OUTREACH_BASE_PATH = 'assets/images/ministry-outreach';
const PHOTO_HOLD_MS = 5500;

async function initMinistryOutreach() {
  const mount = document.getElementById('ministry-outreach-cards');
  if (!mount) return;

  let index;
  try {
    const res = await fetch(`${OUTREACH_INDEX_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    console.warn('Ministry outreach: could not load master index:', err.message);
    mount.innerHTML = renderInvitationCard(true);
    return;
  }

  const events = Array.isArray(index.events) ? index.events : [];
  const cards = events.slice(0, 3);

  // Load each event's media manifest in parallel
  const manifests = await Promise.all(
    cards.map(async ev => {
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

  const rendered = manifests
    .filter(x => x.media.length > 0)
    .map(renderOutreachCard)
    .join('');

  // Append an invitation card when we have fewer than 3 real cards
  const realCount = manifests.filter(x => x.media.length > 0).length;
  const filler = realCount < 3 ? renderInvitationCard(false) : '';

  mount.innerHTML = rendered + filler;

  // Wire each slideshow
  mount.querySelectorAll('.outreach-card__media').forEach(startSlideshow);
}

function renderOutreachCard({ ev, media }) {
  const slides = media.map((m, i) => slideMarkup(ev.folder, m, i)).join('');
  const dots = media.map((_, i) =>
    `<button class="outreach-slide-dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Slide ${i + 1}"></button>`
  ).join('');

  const testimonyBlock = ev.testimony && ev.testimony.trim()
    ? `<blockquote class="outreach-card__testimony">${escapeHtml(ev.testimony)}</blockquote>`
    : '';

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
        <a class="outreach-card__cta" href="about.html#contact">
          Share your testimony <span aria-hidden="true">→</span>
        </a>
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
         style="background-image:url('${src}')">
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
  const slides = [...container.querySelectorAll('.outreach-slide')];
  const dots   = [...container.querySelectorAll('.outreach-slide-dot')];
  if (slides.length < 2) {
    // Single-slide: still play the video if that's what it is
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
        // Schedule a fallback advance in case 'ended' doesn't fire
        const fallback = setTimeout(advance, 45000);
        const onEnded = () => { clearTimeout(fallback); v.removeEventListener('ended', onEnded); advance(); };
        v.addEventListener('ended', onEnded);
        v.play().catch(() => {
          // Autoplay might be blocked if not muted; fallback to photo hold
          clearTimeout(fallback);
          timer = setTimeout(advance, PHOTO_HOLD_MS);
        });
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

  // Pause on hover, resume on leave
  container.addEventListener('mouseenter', () => { paused = true; stopCurrent(); });
  container.addEventListener('mouseleave', () => { paused = false; startCurrent(); });

  // Dot click jumps to a slide
  dots.forEach(dot => dot.addEventListener('click', (e) => {
    e.preventDefault();
    show(parseInt(dot.dataset.index, 10));
  }));

  // Kick off first slide
  startCurrent();
}

/* ── Utilities ─────────────────────────────────────────────── */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

document.addEventListener('DOMContentLoaded', initMinistryOutreach);
