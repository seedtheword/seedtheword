/* ============================================================
   Recommendations: "What We're Listening To" + "Partner Ministries"
   Both sections read from assets/data/recommendations.json so admins
   can add/remove items via the admin-help builder tool — no JS edits.
   Supported listening 'kind' values:
     'spotify'  -> type: 'episode' | 'show'  — renders a Spotify embed
     'youtube'  -> renders a YouTube embed
     'link'     -> renders a plain card with an external link
   ============================================================ */

const RECO_DATA_URL = 'assets/data/recommendations.json';

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function renderListening(container, items) {
  if (!items || !items.length) {
    container.innerHTML = `
      <div class="reco-empty glass-morphism">
        <p>Recommendations will appear here once admins add items.</p>
      </div>
    `;
    return;
  }
  container.innerHTML =
    '<div class="reco-grid">' +
    items.map(renderListeningCard).join('') +
    '</div>';
}

function renderListeningCard(item) {
  switch (item && item.kind) {
    case 'spotify':
      return renderSpotifyCard(item);
    case 'youtube':
      return renderYouTubeCard(item);
    case 'link':
    default:
      return renderLinkCard(item);
  }
}

function renderSpotifyCard(item) {
  const path = item.type === 'show' ? 'show' : 'episode';
  const embedSrc = `https://open.spotify.com/embed/${path}/${encodeURIComponent(item.id)}?utm_source=generator`;
  const openUrl = `https://open.spotify.com/${path}/${encodeURIComponent(item.id)}`;
  return `
    <article class="reco-card glass-morphism reco-card--spotify">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--spotify">🎙️ Spotify</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed">
        <iframe
          title="${escapeHtml(item.title || 'Spotify')} on Spotify"
          src="${embedSrc}"
          width="100%"
          height="152"
          frameborder="0"
          allowfullscreen=""
          allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"></iframe>
      </div>
      <a class="reco-card__link" href="${openUrl}" target="_blank" rel="noopener">
        Open on Spotify <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

function renderYouTubeCard(item) {
  const embedSrc = `https://www.youtube.com/embed/${encodeURIComponent(item.id)}`;
  const openUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`;
  return `
    <article class="reco-card glass-morphism reco-card--youtube">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--youtube">📺 YouTube</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed reco-card__embed--video">
        <iframe
          title="${escapeHtml(item.title || 'YouTube video')}"
          src="${embedSrc}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          loading="lazy"></iframe>
      </div>
      <a class="reco-card__link" href="${openUrl}" target="_blank" rel="noopener">
        Open on YouTube <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

function renderLinkCard(item) {
  const img = item.image
    ? `<div class="reco-card__thumb" style="background-image:url('${escapeAttr(item.image)}')"></div>`
    : '';
  return `
    <article class="reco-card glass-morphism reco-card--link">
      ${img}
      <header class="reco-card__header">
        <span class="reco-card__badge">🔗 Link</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <a class="reco-card__link" href="${escapeAttr(item.url || '#')}" target="_blank" rel="noopener">
        Open link <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

function renderPartners(container, partners) {
  if (!partners || !partners.length) {
    container.innerHTML = `
      <div class="reco-empty glass-morphism">
        <p><strong>We're building this out.</strong> Partner ministries we walk alongside will be listed here.</p>
      </div>
    `;
    return;
  }
  container.innerHTML =
    '<div class="partners-grid">' +
    partners.map(p => `
      <a class="partner-card glass-morphism" href="${escapeAttr(p.url || '#')}" target="_blank" rel="noopener">
        ${p.logo ? `<img class="partner-card__logo" src="${escapeAttr(p.logo)}" alt="${escapeHtml(p.name || '')}">` : ''}
        <h4 class="partner-card__name">${escapeHtml(p.name || '')}</h4>
        ${p.description ? `<p class="partner-card__desc">${escapeHtml(p.description)}</p>` : ''}
      </a>
    `).join('') +
    '</div>';
}

// -------------------------------------------------------------------------
// Public helpers consumed by other scripts (e.g. homepage dashboard)
// -------------------------------------------------------------------------
async function fetchRecommendationsData() {
  try {
    const res = await fetch(`${RECO_DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return {
      listening: Array.isArray(data.listening) ? data.listening : [],
      partners:  Array.isArray(data.partners)  ? data.partners  : [],
    };
  } catch (err) {
    console.warn('Recommendations data could not be loaded:', err.message);
    return { listening: [], partners: [] };
  }
}
// Expose globally so the homepage dashboard and tests can reuse it.
window.fetchRecommendationsData = fetchRecommendationsData;
// Also expose the card renderers so the admin-help builder tool can
// preview entries using the exact same markup the site uses.
window.renderListeningCard = renderListeningCard;
window.renderPartners = renderPartners;

// -------------------------------------------------------------------------
// Utility
// -------------------------------------------------------------------------
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const listeningEl = document.getElementById('listening-container');
  const partnersEl  = document.getElementById('partners-container');
  if (!listeningEl && !partnersEl) return;

  const data = await fetchRecommendationsData();
  if (listeningEl) renderListening(listeningEl, data.listening);
  if (partnersEl)  renderPartners(partnersEl, data.partners);
});
