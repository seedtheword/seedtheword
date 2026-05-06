/* ============================================================
   Homepage "Today at Seed the Word" dashboard
   Pulls live content from across the site into a grid of cards.
   Every card degrades gracefully if its source is unavailable.
   ============================================================ */

const CAL_API_KEY = 'AIzaSyA6GMEdyQHxcRCJuun-OIrFlJgG67Zjtpc';
const CAL_ID = 'seedthewordministry@gmail.com';

async function initHomepageDashboard() {
  const mount = document.getElementById('homepage-dashboard');
  if (!mount) return;

  // Three focused cards: Verse, Coming Up, Latest Outreach.
  // The Showcase Carousel above already cycles through Instagram,
  // recommendations, and ministry highlights — so we don't duplicate
  // those here.
  const [verseHtml, eventHtml, outreachHtml] = await Promise.all([
    buildVerseCard(),
    buildEventCard(),
    buildOutreachCard(),
  ]);

  mount.innerHTML = [verseHtml, eventHtml, outreachHtml].filter(Boolean).join('');
}

/* ── Verse of the day ───────────────────────────────────────── */
async function buildVerseCard() {
  let verse = null;
  try {
    const res = await fetch(`assets/data/daily-verses.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const verses = Array.isArray(data.verses) ? data.verses : [];
      if (verses.length) {
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
        verse = verses[dayOfYear % verses.length];
      }
    }
  } catch (_) { /* ignore */ }

  if (!verse) {
    verse = {
      text: 'For God so loved the world, that he gave his only begotten Son.',
      ref: 'John 3:16',
      version: 'KJV'
    };
  }

  return `
    <article class="hd-card hd-card--verse glass-morphism">
      <p class="hd-card__eyebrow">📖 Verse of the Day</p>
      <blockquote class="hd-card__verse">
        <p>"${escapeHtml(verse.text)}"</p>
        <cite>${escapeHtml(verse.ref)}${verse.version ? ` · ${escapeHtml(verse.version)}` : ''}</cite>
      </blockquote>
      <div class="hd-card__actions">
        <button class="hd-chip" onclick="window.shareVerseOfDay()">Share</button>
        <a class="hd-chip" href="community.html#bible-reading">Read along →</a>
      </div>
    </article>
  `;
}

/* ── Next event from Google Calendar ────────────────────────── */
async function buildEventCard() {
  let nextEvent = null;
  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 30 * 86400000).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events?` +
      `key=${CAL_API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=5`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const now = Date.now();
      // Pick the first event that hasn't ended yet
      nextEvent = (data.items || []).find(e => {
        const end = e.end?.dateTime || e.end?.date;
        return end && new Date(end).getTime() > now;
      });
    }
  } catch (_) { /* ignore */ }

  const body = nextEvent
    ? renderEventBody(nextEvent)
    : `<p class="hd-card__fallback">Our next gathering will appear here. For now, check the calendar.</p>
       <a class="hd-card__cta" href="news.html#calendar">Open calendar →</a>`;

  return `
    <article class="hd-card hd-card--event glass-morphism">
      <p class="hd-card__eyebrow">📅 Coming Up</p>
      ${body}
    </article>
  `;
}

function renderEventBody(event) {
  const start = new Date(event.start?.dateTime || event.start?.date);
  const now = new Date();
  const isAllDay = !event.start?.dateTime;

  const startOfDay = d => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
  const dayDiff = Math.round((startOfDay(start) - startOfDay(now)) / 86400000);

  let whenLabel;
  if (dayDiff === 0) whenLabel = 'TODAY';
  else if (dayDiff === 1) whenLabel = 'TOMORROW';
  else if (dayDiff > 1 && dayDiff <= 7) whenLabel = start.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  else whenLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

  const timeStr = isAllDay
    ? 'All day'
    : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return `
    <h3 class="hd-card__title">${escapeHtml(event.summary || 'Ministry Event')}</h3>
    <p class="hd-card__when"><strong>${whenLabel}</strong> · ${escapeHtml(timeStr)}</p>
    ${event.location ? `<p class="hd-card__meta">📍 ${escapeHtml(event.location)}</p>` : ''}
    <a class="hd-card__cta" href="news.html#calendar">See calendar →</a>
  `;
}

/* ── Latest outreach (from news page data) ──────────────────── */
async function buildOutreachCard() {
  try {
    const res = await fetch(`assets/data/ministry-outreach.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const ev = (data.events || [])[0];
    if (!ev) throw new Error();

    // Peek at that event's media to grab a hero image
    let heroImg = '';
    try {
      const m = await fetch(`assets/images/ministry-outreach/${ev.folder}/images.json?t=${Date.now()}`, { cache: 'no-store' });
      if (m.ok) {
        const mani = await m.json();
        const firstPhoto = (mani.media || []).find(x => x.type === 'photo');
        if (firstPhoto) heroImg = `assets/images/ministry-outreach/${ev.folder}/${firstPhoto.file}`;
      }
    } catch (_) { /* keep heroImg empty */ }

    return `
      <article class="hd-card hd-card--outreach glass-morphism">
        ${heroImg ? `<div class="hd-card__image" style="background-image:url('${heroImg}')"></div>` : ''}
        <div class="hd-card__body">
          <p class="hd-card__eyebrow">🙌 Latest Outreach</p>
          <h3 class="hd-card__title">${escapeHtml(ev.title || 'Outreach')}</h3>
          <p class="hd-card__meta">${escapeHtml(ev.date || '')}${ev.location ? ' · ' + escapeHtml(ev.location) : ''}</p>
          <p class="hd-card__body-text">${escapeHtml(truncate(ev.body || '', 120))}</p>
          <a class="hd-card__cta" href="news.html#ministry-outreach">Read more →</a>
        </div>
      </article>
    `;
  } catch (_) {
    return `
      <article class="hd-card hd-card--outreach glass-morphism">
        <div class="hd-card__body">
          <p class="hd-card__eyebrow">🙌 Latest Outreach</p>
          <p class="hd-card__fallback">Photos and stories from our latest outreach will show up here.</p>
          <a class="hd-card__cta" href="news.html#ministry-outreach">See outreach →</a>
        </div>
      </article>
    `;
  }
}

/* ── Recommended listen (podcast/video) from recommendations.js ─ */
async function buildListenCard() {
  // recommendations.js sets its globals synchronously once loaded.
  // We fetch the file here instead of depending on its load order.
  let items = null;
  try {
    const res = await fetch(`assets/js/recommendations.js?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const txt = await res.text();
      const m = txt.match(/LISTENING_ITEMS\s*=\s*(\[[\s\S]*?\n\])/);
      if (m) {
        // Best-effort: evaluate the array in a safe-ish way.
        // It's our own file, committed to the repo, so this is fine.
        // eslint-disable-next-line no-new-func
        items = Function('"use strict"; return ' + m[1])();
      }
    }
  } catch (_) { /* ignore */ }

  const first = items && items.length ? items[0] : null;
  if (!first) {
    return `
      <article class="hd-card hd-card--listen glass-morphism">
        <p class="hd-card__eyebrow">🎧 Now Playing</p>
        <p class="hd-card__fallback">Recommended listens will appear here. Check the Community page for our current picks.</p>
        <a class="hd-card__cta" href="community.html#friends-in-jesus">See recommendations →</a>
      </article>
    `;
  }

  let openUrl, body, kindEmoji;
  if (first.kind === 'spotify') {
    const path = first.type === 'show' ? 'show' : 'episode';
    openUrl = `https://open.spotify.com/${path}/${first.id}`;
    kindEmoji = '🎙️';
  } else if (first.kind === 'youtube') {
    openUrl = `https://www.youtube.com/watch?v=${first.id}`;
    kindEmoji = '📺';
  } else {
    openUrl = first.url || 'community.html#friends-in-jesus';
    kindEmoji = '🔗';
  }
  body = first.note || '';

  return `
    <article class="hd-card hd-card--listen glass-morphism">
      <p class="hd-card__eyebrow">${kindEmoji} Now Playing</p>
      <h3 class="hd-card__title">${escapeHtml(first.title || 'Recommended listen')}</h3>
      <p class="hd-card__meta">${escapeHtml(first.source || '')}</p>
      ${body ? `<p class="hd-card__body-text">${escapeHtml(truncate(body, 110))}</p>` : ''}
      <a class="hd-card__cta" href="${openUrl}" target="_blank" rel="noopener">Open →</a>
    </article>
  `;
}

/* ── Latest Instagram post ──────────────────────────────────── */
async function buildInstagramCard() {
  try {
    const res = await fetch(`assets/data/instagram.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const post = (data.posts || [])[0];
    if (!post) throw new Error();

    const caption = (post.caption || '').trim();
    const firstLine = caption.split('\n')[0].slice(0, 100);

    return `
      <article class="hd-card hd-card--ig glass-morphism">
        <a class="hd-card__ig-image" href="${escapeAttr(post.url)}" target="_blank" rel="noopener"
           style="background-image:url('${escapeAttr(post.thumbnail)}')"
           aria-label="Open on Instagram"></a>
        <div class="hd-card__body">
          <p class="hd-card__eyebrow">📸 From Instagram</p>
          <p class="hd-card__body-text">${escapeHtml(firstLine || 'Latest from @seedtheword')}</p>
          <a class="hd-card__cta" href="${escapeAttr(post.url)}" target="_blank" rel="noopener">View on Instagram →</a>
        </div>
      </article>
    `;
  } catch (_) {
    return `
      <article class="hd-card hd-card--ig glass-morphism">
        <div class="hd-card__body">
          <p class="hd-card__eyebrow">📸 From Instagram</p>
          <p class="hd-card__fallback">Our latest Instagram post will appear here.</p>
          <a class="hd-card__cta" href="https://www.instagram.com/seedtheword/" target="_blank" rel="noopener">Follow us →</a>
        </div>
      </article>
    `;
  }
}

/* ── Gift a bundle (static CTA) ─────────────────────────────── */
async function buildBundleCard() {
  return `
    <article class="hd-card hd-card--bundle glass-morphism">
      <p class="hd-card__eyebrow">🎁 Gift a Bible</p>
      <h3 class="hd-card__title">Love. Gift. Repeat.</h3>
      <p class="hd-card__body-text">
        Starting at $2 per Bible, you can build a warm welcoming gift for someone
        beginning their walk with Jesus. Every dollar above cost pays forward the
        next bundle.
      </p>
      <div class="hd-card__actions">
        <a class="hd-chip hd-chip--primary" href="store.html">Build a Bundle →</a>
        <a class="hd-chip" href="store.html#support">Support Ministry</a>
      </div>
    </article>
  `;
}

/* ── Share Verse of Day (invoked from the verse card button) ─ */
window.shareVerseOfDay = async function () {
  try {
    const res = await fetch('assets/data/daily-verses.json', { cache: 'no-store' });
    const data = await res.json();
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const verse = (data.verses || [])[dayOfYear % data.verses.length];
    if (!verse) return;
    const text = `"${verse.text}"\n— ${verse.ref}${verse.version ? ` (${verse.version})` : ''}\n\nvia Seed the Word Ministry`;
    if (navigator.share) {
      await navigator.share({ title: 'Verse of the Day', text });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      alert('Copied to clipboard.');
    }
  } catch (err) {
    console.warn('Share failed:', err);
  }
};

/* ── Utilities ─────────────────────────────────────────────── */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
function truncate(t, n) {
  if (!t) return '';
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

document.addEventListener('DOMContentLoaded', initHomepageDashboard);
