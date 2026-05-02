/* ============================================================
   Recommendations: "What We're Listening To" + "Partner Ministries"
   Both sections read from the config lists below. Admins: add/remove
   items by editing these arrays and committing. See admin-help page
   for the full walkthrough.
   ============================================================ */

// --- What We're Listening To -----------------------------------------------
// Each item represents external content (podcast, sermon, video, etc.) the
// ministry endorses and wants members to check out. Supported `kind` values:
//   'spotify'  -> type: 'episode' | 'show'  — renders a Spotify embed
//   'youtube'  -> renders a YouTube embed
//   'link'     -> renders a plain card with an external link
const LISTENING_ITEMS = [
  {
    kind: 'spotify',
    type: 'episode',
    id: '1Y4cct2gyvhYJYLIxwuley',
    title: "Intimacy With God Is Everything",
    source: 'After the Heart Podcast — Episode 38',
    note: "Sam Petrov and Enoch Walter on intimacy with God, discerning His voice, and reaching youth with the Gospel.",
  },
  // Add more items below. Examples:
  // {
  //   kind: 'spotify', type: 'show', id: 'SPOTIFY_SHOW_ID',
  //   title: 'Show Name', source: 'Host Name', note: 'Why we recommend this.'
  // },
  // {
  //   kind: 'youtube', id: 'YOUTUBE_VIDEO_ID',
  //   title: 'Video Title', source: 'Channel Name', note: 'Why this stood out.'
  // },
  // {
  //   kind: 'link', url: 'https://example.com',
  //   title: 'Article / Sermon Title', source: 'Author / Ministry',
  //   note: 'Why it matters.',
  //   image: 'assets/images/featured/some-image.jpg'  // optional thumbnail
  // },
];

// --- Partner Ministries ----------------------------------------------------
// Formal partners or ministries Seed the Word works alongside. Keep this list
// small and genuine — every entry publicly affiliates the ministry with them.
const PARTNER_MINISTRIES = [
  // {
  //   name: 'Partner Name',
  //   url: 'https://partner-site.com',
  //   logo: 'assets/images/partners/partner-logo.png', // optional
  //   description: 'One sentence about what they do together with STW.',
  // },
];

// -------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------
function renderListening(container) {
  if (!LISTENING_ITEMS.length) {
    container.innerHTML = `
      <div class="reco-empty glass-morphism">
        <p>Recommendations will appear here once admins add items.</p>
      </div>
    `;
    return;
  }
  container.innerHTML =
    '<div class="reco-grid">' +
    LISTENING_ITEMS.map(renderListeningCard).join('') +
    '</div>';
}

function renderListeningCard(item) {
  switch (item.kind) {
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
  const embedSrc = `https://open.spotify.com/embed/${path}/${item.id}?utm_source=generator`;
  const openUrl = `https://open.spotify.com/${path}/${item.id}`;
  return `
    <article class="reco-card glass-morphism reco-card--spotify">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--spotify">🎙️ Spotify</span>
        <h4 class="reco-card__title">${escapeHtml(item.title)}</h4>
        <p class="reco-card__source">${escapeHtml(item.source)}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed">
        <iframe
          title="${escapeHtml(item.title)} on Spotify"
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
  const embedSrc = `https://www.youtube.com/embed/${item.id}`;
  const openUrl = `https://www.youtube.com/watch?v=${item.id}`;
  return `
    <article class="reco-card glass-morphism reco-card--youtube">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--youtube">📺 YouTube</span>
        <h4 class="reco-card__title">${escapeHtml(item.title)}</h4>
        <p class="reco-card__source">${escapeHtml(item.source)}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed reco-card__embed--video">
        <iframe
          title="${escapeHtml(item.title)}"
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
    ? `<div class="reco-card__thumb" style="background-image:url('${item.image}')"></div>`
    : '';
  return `
    <article class="reco-card glass-morphism reco-card--link">
      ${img}
      <header class="reco-card__header">
        <span class="reco-card__badge">🔗 Link</span>
        <h4 class="reco-card__title">${escapeHtml(item.title)}</h4>
        <p class="reco-card__source">${escapeHtml(item.source)}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <a class="reco-card__link" href="${item.url}" target="_blank" rel="noopener">
        Open link <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

function renderPartners(container) {
  if (!PARTNER_MINISTRIES.length) {
    container.innerHTML = `
      <div class="reco-empty glass-morphism">
        <p><strong>We're building this out.</strong> Partner ministries we walk alongside will be listed here.</p>
      </div>
    `;
    return;
  }
  container.innerHTML =
    '<div class="partners-grid">' +
    PARTNER_MINISTRIES.map(p => `
      <a class="partner-card glass-morphism" href="${p.url}" target="_blank" rel="noopener">
        ${p.logo ? `<img class="partner-card__logo" src="${p.logo}" alt="${escapeHtml(p.name)}">` : ''}
        <h4 class="partner-card__name">${escapeHtml(p.name)}</h4>
        ${p.description ? `<p class="partner-card__desc">${escapeHtml(p.description)}</p>` : ''}
      </a>
    `).join('') +
    '</div>';
}

// -------------------------------------------------------------------------
// Utility
// -------------------------------------------------------------------------
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const listeningEl = document.getElementById('listening-container');
  if (listeningEl) renderListening(listeningEl);

  const partnersEl = document.getElementById('partners-container');
  if (partnersEl) renderPartners(partnersEl);
});
