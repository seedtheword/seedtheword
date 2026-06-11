/* ============================================================
   Recommendations: "What We're Listening To" + "Partner Ministries"
   Both sections read from assets/data/recommendations.json so admins
   can add/remove items via the admin-help builder tool — no JS edits.
   Supported listening 'kind' values:
     'spotify'   -> { kind, type: 'episode' | 'show', id, title, source, note? }
                    Renders the Spotify embed (episode or show).
     'youtube'   -> { kind, feedType?: 'video' | 'channel' | 'playlist',
                       id, handle?, title, source, note? }
                    feedType defaults to 'video' (single video — back-compat).
                    'channel' embeds the channel's auto-uploads playlist when
                    id starts with UC; otherwise renders a link-only card to
                    youtube.com/<handle>. 'playlist' embeds videoseries?list=<id>.
     'instagram' -> { kind, handle, avatar?, title, source?, note? }
                    Link card (no embed) to instagram.com/<handle>/.
     'twitch'    -> { kind, channel, title, source?, note? }
                    Embeds player.twitch.tv with seedtheword parent params;
                    falls back to link-only chrome on hosts not in parent list.
     'link'      -> { kind, url, title, source?, note?, image? }
                    Universal fallback for anything not covered above.
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
    case 'instagram':
      return renderInstagramCard(item);
    case 'twitch':
      return renderTwitchCard(item);
    case 'drive':
      return renderDriveCard(item);
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
  const ft = item.feedType || 'video';
  if (ft === 'video') {
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
  if (ft === 'channel') {
    const id = item.id || '';
    const handle = item.handle || '';
    if (id.startsWith('UC')) {
      const playlistId = 'UU' + id.slice(2);
      const embedSrc = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(playlistId)}`;
      const openUrl = `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
      return `
    <article class="reco-card glass-morphism reco-card--youtube reco-card--youtube-channel">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--youtube-channel">📺 YouTube — Channel</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed reco-card__embed--video">
        <iframe
          title="${escapeHtml(item.title || 'YouTube channel')}"
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
    // Handle-only entry — no embed (we have no UC… id to drive the UU<id> trick).
    const openUrl = `https://www.youtube.com/${escapeAttr(handle)}`;
    return `
    <article class="reco-card glass-morphism reco-card--youtube reco-card--youtube-channel">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--youtube-channel">📺 YouTube — Channel</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <a class="reco-card__link" href="${openUrl}" target="_blank" rel="noopener">
        Open on YouTube <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
  }
  if (ft === 'playlist') {
    const embedSrc = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(item.id)}`;
    const openUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(item.id)}`;
    return `
    <article class="reco-card glass-morphism reco-card--youtube reco-card--youtube-playlist">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--youtube-playlist">📺 YouTube — Playlist</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed reco-card__embed--video">
        <iframe
          title="${escapeHtml(item.title || 'YouTube playlist')}"
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
  // Unknown feedType — degrade safely to the generic link card.
  return renderLinkCard(item);
}

function renderInstagramCard(item) {
  const handle = escapeAttr(item.handle || '');
  const thumb = item.avatar
    ? `<div class="reco-card__thumb" style="background-image:url('${escapeAttr(item.avatar)}')"></div>`
    : '';
  return `
    <article class="reco-card glass-morphism reco-card--instagram">
      ${thumb}
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--instagram">📸 Instagram</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <a class="reco-card__link" href="https://www.instagram.com/${handle}/" target="_blank" rel="noopener noreferrer">
        Open on Instagram <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

function renderTwitchCard(item) {
  const channel = escapeAttr(item.channel || '');
  const embedSrc = `https://player.twitch.tv/?channel=${channel}&parent=seedtheword.github.io&parent=seedtheword.com&muted=true`;
  return `
    <article class="reco-card glass-morphism reco-card--twitch">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--twitch">🎮 Twitch</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed reco-card__embed--video">
        <iframe
          title="${escapeHtml(item.title || 'Twitch stream')}"
          src="${embedSrc}"
          frameborder="0"
          allowfullscreen
          loading="lazy"></iframe>
      </div>
      <a class="reco-card__link" href="https://www.twitch.tv/${channel}" target="_blank" rel="noopener noreferrer">
        Open on Twitch <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

// Google Drive video embed — Drive's /preview iframe gives a clean inline
// player. Files must be shared "Anyone with the link" for the iframe to
// load. The fileId is the long string between /file/d/ and the next slash
// in the share URL.
function renderDriveCard(item) {
  const fileId = escapeAttr(item.fileId || '');
  const embedSrc = `https://drive.google.com/file/d/${fileId}/preview`;
  const openUrl = `https://drive.google.com/file/d/${fileId}/view`;
  return `
    <article class="reco-card glass-morphism reco-card--drive">
      <header class="reco-card__header">
        <span class="reco-card__badge reco-card__badge--drive">🎬 Video</span>
        <h4 class="reco-card__title">${escapeHtml(item.title || '')}</h4>
        <p class="reco-card__source">${escapeHtml(item.source || '')}</p>
      </header>
      ${item.note ? `<p class="reco-card__note">${escapeHtml(item.note)}</p>` : ''}
      <div class="reco-card__embed reco-card__embed--video">
        <iframe
          title="${escapeHtml(item.title || 'Video')}"
          src="${embedSrc}"
          frameborder="0"
          allowfullscreen
          allow="autoplay; encrypted-media; picture-in-picture"
          loading="lazy"></iframe>
      </div>
      <a class="reco-card__link" href="${openUrl}" target="_blank" rel="noopener noreferrer">
        Open on Drive <span aria-hidden="true">→</span>
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
    partners.map(p => isRichPartner(p) ? renderRichCard(p) : renderLegacyCard(p)).join('') +
    '</div>';
}

// Dispatch key — a partner entry is "rich" iff it carries a non-empty
// string `slug`. The slug is required for any rich-only field (Req 3.2)
// and is what the photo subdirectory on disk is keyed by (PM4).
function isRichPartner(p) {
  return !!p && typeof p.slug === 'string' && p.slug.length > 0;
}

// Legacy single-anchor partner card. The DOM shape (whitespace included)
// is pinned by PM5's snapshot — do not touch the template literal's
// indentation, leading newline, or trailing 4 spaces before the closing
// backtick.
function renderLegacyCard(p) {
  return `
      <a class="partner-card glass-morphism" href="${escapeAttr(p.url || '#')}" target="_blank" rel="noopener">
        ${p.logo ? `<img class="partner-card__logo" src="${escapeAttr(p.logo)}" alt="${escapeHtml(p.name || '')}">` : ''}
        <h4 class="partner-card__name">${escapeHtml(p.name || '')}</h4>
        ${p.description ? `<p class="partner-card__desc">${escapeHtml(p.description)}</p>` : ''}
      </a>
    `;
}

// ---------------------------------------------------------------------
// Rich partner cards (slug-bearing entries). See design.md §4 for the
// full DOM contract. All interpolated values pass through escapeHtml
// (text content) or escapeAttr (attribute values).
// ---------------------------------------------------------------------

const DRIVE_PREVIEW_RE = /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/preview$/;
const YOUTUBE_EMBED_RE = /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]+(\?[A-Za-z0-9=&_-]*)?$/;

function isValidVideoEntry(v) {
  if (!v || typeof v.url !== 'string') return false;
  if (v.provider === 'drive')   return DRIVE_PREVIEW_RE.test(v.url);
  if (v.provider === 'youtube') return YOUTUBE_EMBED_RE.test(v.url);
  // Unknown provider — try both shapes; if neither matches, skip.
  return DRIVE_PREVIEW_RE.test(v.url) || YOUTUBE_EMBED_RE.test(v.url);
}

function renderRichCard(p) {
  const name = escapeHtml(p.name || '');
  const url  = escapeAttr(p.url  || '#');

  const logoHtml = p.logo
    ? `<img class="partner-card__logo" src="${escapeAttr(p.logo)}" alt="${name}">`
    : '';

  const pocHtml = p.pointOfContact
    ? `<p class="partner-card__poc">Point of contact: ${escapeHtml(p.pointOfContact)}</p>`
    : '';

  // Optional legacy description, rendered as a small subtitle under the
  // name when both a slug and a description are present (Req 10.3).
  const descHtml = p.description
    ? `<p class="partner-card__desc">${escapeHtml(p.description)}</p>`
    : '';

  const headerHtml =
    `<div class="partner-card__header">` +
      logoHtml +
      `<div class="partner-card__name-row">` +
        `<h4 class="partner-card__name"><a href="${url}" target="_blank" rel="noopener">${name}</a></h4>` +
        pocHtml +
        descHtml +
      `</div>` +
    `</div>`;

  const socialsHtml = renderSocialsRow(p);
  const storyHtml   = p.story ? `<p class="partner-card__story">${escapeHtml(p.story)}</p>` : '';
  const photosHtml  = renderPhotosBlock(p);
  const videosHtml  = renderVideosBlock(p);
  const contribHtml = renderContributionsBlock(p);
  const outreachPreviewHtml = renderOutreachPreviewBlock(p);

  return (
    `<article class="partner-card glass-morphism partner-card--rich" data-slug="${escapeAttr(p.slug)}">` +
      headerHtml +
      socialsHtml +
      storyHtml +
      photosHtml +
      videosHtml +
      contribHtml +
      outreachPreviewHtml +
    `</article>`
  );
}

function renderSocialsRow(p) {
  const list = Array.isArray(p.socials) ? p.socials.filter(s => s && s.url) : [];
  if (!list.length) return '';
  const partnerName = p.name || '';
  return (
    `<div class="partner-card__socials">` +
      list.map(s => {
        const platform = String(s.platform || '').toLowerCase();
        const labelPlatform = platform === 'website' ? 'website' : platform || 'website';
        const aria = `${partnerName} on ${labelPlatform.charAt(0).toUpperCase() + labelPlatform.slice(1)}`;
        const handleLabel = s.handle ? `<span class="partner-card__social-handle">${escapeHtml(s.handle)}</span>` : '';
        const titleAttr = s.handle ? ` title="${escapeAttr(s.handle)}"` : '';
        return (
          `<a class="partner-card__social-link" href="${escapeAttr(s.url)}" target="_blank" rel="noopener"` +
              ` aria-label="${escapeAttr(aria)}"${titleAttr}>` +
            socialIconSvg(platform) +
            handleLabel +
          `</a>`
        );
      }).join('') +
    `</div>`
  );
}

function renderPhotosBlock(p) {
  const list = Array.isArray(p.photos) ? p.photos.filter(x => typeof x === 'string' && x) : [];
  if (!list.length) return '';
  const altBase = `Photo from outreach with ${p.name || ''}`;
  return (
    `<div class="partner-card__photos">` +
      list.map(path =>
        `<img src="${escapeAttr(path)}" alt="${escapeHtml(altBase)}" loading="lazy">`
      ).join('') +
    `</div>`
  );
}

function renderVideosBlock(p) {
  const list = (Array.isArray(p.videos) ? p.videos : []).filter(isValidVideoEntry);
  if (!list.length) return '';
  const partnerName = p.name || '';
  return (
    `<div class="partner-card__videos">` +
      list.map(v => {
        const title = v.title ? String(v.title) : `${partnerName} — video`;
        return (
          `<div class="partner-card__video">` +
            `<iframe` +
              ` src="${escapeAttr(v.url)}"` +
              ` title="${escapeAttr(title)}"` +
              ` allow="autoplay; encrypted-media; picture-in-picture"` +
              ` allowfullscreen` +
              ` loading="lazy"></iframe>` +
          `</div>`
        );
      }).join('') +
    `</div>`
  );
}

function renderContributionsBlock(p) {
  const list = Array.isArray(p.contributions) ? p.contributions.filter(c => c && c.href && c.label) : [];
  if (!list.length) return '';
  return (
    `<div class="partner-card__contributions">` +
      `<h5 class="partner-card__contributions-heading">What they shaped here</h5>` +
      `<ul>` +
        list.map(c =>
          `<li><a href="${escapeAttr(c.href)}">${escapeHtml(c.label)}</a></li>`
        ).join('') +
      `</ul>` +
    `</div>`
  );
}

// -------------------------------------------------------------------------
// Outreach preview strip — rendered with placeholder skeleton tiles,
// then populated once the manifest fetch resolves. Shows up to 3 thumbnails
// from the linked ministry-outreach folder and links to news.html#ministry-outreach.
// -------------------------------------------------------------------------
function renderOutreachPreviewBlock(p) {
  const events = Array.isArray(p.outreachEvents) ? p.outreachEvents.filter(e => e && e.folder) : [];
  if (!events.length) return '';

  return events.map(ev => {
    const previewId = `partner-outreach-preview-${escapeAttr(p.slug)}-${escapeAttr(ev.folder)}`;
    fetchOutreachThumbnails(ev.folder, previewId);
    return (
      `<div class="partner-card__outreach-preview">` +
        `<h5 class="partner-card__outreach-preview-heading">📸 Outreach Together</h5>` +
        `<p class="partner-card__outreach-preview-meta">${escapeHtml(ev.title || '')}` +
          `${ev.date ? ` · ${escapeHtml(ev.date)}` : ''}` +
          `${ev.location ? ` · ${escapeHtml(ev.location)}` : ''}` +
        `</p>` +
        `<div class="partner-card__outreach-thumbs" id="${previewId}">` +
          `<div class="partner-card__outreach-thumb partner-card__outreach-thumb--skeleton"></div>` +
          `<div class="partner-card__outreach-thumb partner-card__outreach-thumb--skeleton"></div>` +
          `<div class="partner-card__outreach-thumb partner-card__outreach-thumb--skeleton"></div>` +
        `</div>` +
        `<a class="partner-card__outreach-cta" href="news.html#ministry-outreach">` +
          `See the full story <span aria-hidden="true">→</span>` +
        `</a>` +
      `</div>`
    );
  }).join('');
}

async function fetchOutreachThumbnails(folder, containerId) {
  const base = `assets/images/ministry-outreach/${folder}`;
  try {
    const res = await fetch(`${base}/images.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const media = Array.isArray(data.media) ? data.media.filter(m => m && m.file && m.type === 'photo') : [];

    const container = document.getElementById(containerId);
    if (!container) return;

    if (!media.length) {
      container.innerHTML =
        `<div class="partner-card__outreach-thumb partner-card__outreach-thumb--empty">` +
          `<span>Photos coming soon</span>` +
        `</div>`;
      return;
    }

    container.innerHTML = media.slice(0, 3).map(m =>
      `<div class="partner-card__outreach-thumb" ` +
        `style="background-image:url('${escapeAttr(base + '/' + m.file)}')" ` +
        `role="img" ` +
        `aria-label="${escapeAttr(m.caption || 'Outreach photo')}">` +
      `</div>`
    ).join('');
  } catch (_) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML =
        `<div class="partner-card__outreach-thumb partner-card__outreach-thumb--empty">` +
          `<span>Photos coming soon</span>` +
        `</div>`;
    }
  }
}

// Inline SVG map for partner-card socials. Path data for Instagram,
// Telegram, Twitch, and Spotify mirrors community.html's site-header
// social row. YouTube, Facebook, and the generic website fallback
// use minimal monochrome paths. Unknown platforms fall back to
// `website` (Req 7.4).
function socialIconSvg(platform) {
  const ICONS = {
    instagram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>',
    telegram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.534-.196 1.005.128.832.941z"/></svg>',
    twitch: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>',
    spotify: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12A12 12 0 0 0 12 0zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.36-2.11-10.54-1.16a.75.75 0 1 1-.34-1.46c4.56-1.04 8.48-.59 11.65 1.34.35.22.46.69.26 1.03zm1.47-3.28a.94.94 0 0 1-1.29.31c-3.23-1.98-8.15-2.56-11.97-1.4a.94.94 0 1 1-.55-1.8c4.36-1.32 9.29-.68 12.99 1.6a.94.94 0 0 1 .31 1.29zm.13-3.42c-3.87-2.3-10.27-2.51-13.97-1.39a1.13 1.13 0 1 1-.66-2.16c4.25-1.29 11.31-1.04 15.78 1.61a1.13 1.13 0 0 1-1.16 1.94z"/></svg>',
    youtube: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z"/></svg>',
    facebook: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M22.675 0H1.325C.593 0 0 .593 0 1.325v21.351C0 23.407.593 24 1.325 24H12.82v-9.294H9.692V11.08h3.128V8.413c0-3.1 1.894-4.788 4.659-4.788 1.325 0 2.464.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.31h3.587l-.467 3.626h-3.12V24h6.116c.732 0 1.325-.593 1.325-1.325V1.325C24 .593 23.407 0 22.675 0z"/></svg>',
    website: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.07c.83 1.2 1.48 2.53 1.91 3.93h-3.82A13.7 13.7 0 0 1 12 4.07zM4.26 14a7.97 7.97 0 0 1 0-4h3.38a16.7 16.7 0 0 0 0 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a8 8 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.02 8zM12 19.93c-.83-1.2-1.48-2.53-1.91-3.93h3.82A13.7 13.7 0 0 1 12 19.93zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8 8 0 0 1-4.33 3.56zM16.36 14a16.7 16.7 0 0 0 0-4h3.38a7.97 7.97 0 0 1 0 4h-3.38z"/></svg>'
  };
  return ICONS[platform] || ICONS.website;
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
