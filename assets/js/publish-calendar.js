/* ============================================================
   Publish Calendar — iCal reader for the Publish tab.

   Fetches the ministry Google Calendar via the Apps Script web app
   (server-side iCal fetch → no API key, no CORS issues, no key to
   revoke) and renders an upcoming-events list.  Picking an event
   auto-fills the announcement composer so a human can review, edit,
   and send (or schedule).

   This file is intentionally self-contained — it reuses the global
   helpers from team-portal.js (postAction, session, escapeHtml) but
   keeps its own image-extraction + HTML-stripping logic so it never
   depends on google-calendar.js (which isn't loaded in team.html).
   ============================================================ */

window.PublishCalendar = (function () {
  'use strict';

  var events = [];   // cached parsed events [{id,summary,description,location,startMs,endMs,allDay}]
  var loaded = false;

  // ── Image extraction (mirrors google-calendar.js + post_calendar_to_telegram.py) ──
  var IMG_TAG_RE  = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  var DRIVE_FILE_RE = /https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/([A-Za-z0-9_-]+)(?:\/[^\s"'<>]*)?/gi;
  var DRIVE_OPEN_RE = /https?:\/\/drive\.google\.com\/open\?[^\s"'<>]*?id=([A-Za-z0-9_-]+)[^\s"'<>]*/gi;
  var IMAGE_URL_RE  = /https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>]*)?/gi;

  function driveFileToDirectUrl(fileId) {
    return 'https://lh3.googleusercontent.com/d/' + fileId + '=w2000';
  }

  function extractImageUrls(htmlOrText) {
    if (!htmlOrText) return [];
    var seen = {}, urls = [];
    function add(u) { if (u && !seen[u]) { seen[u] = 1; urls.push(u); } }
    var m;
    IMG_TAG_RE.lastIndex = 0;
    while ((m = IMG_TAG_RE.exec(htmlOrText)) !== null) {
      var u = m[1].trim();
      if (u.indexOf('http') === 0) add(u);
    }
    DRIVE_FILE_RE.lastIndex = 0;
    while ((m = DRIVE_FILE_RE.exec(htmlOrText)) !== null) add(driveFileToDirectUrl(m[1]));
    DRIVE_OPEN_RE.lastIndex = 0;
    while ((m = DRIVE_OPEN_RE.exec(htmlOrText)) !== null) add(driveFileToDirectUrl(m[1]));
    IMAGE_URL_RE.lastIndex = 0;
    while ((m = IMAGE_URL_RE.exec(htmlOrText)) !== null) add(m[0].trim().replace(/[).,;]+$/, ''));
    return urls.slice(0, 10);
  }

  // ── HTML → plain text (mirrors google-calendar.js stripHtmlToText) ──
  function stripHtmlToText(html) {
    if (!html) return '';
    var s = String(html);
    s = s.replace(/\|/g, '\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
    s = s.replace(/<li[^>]*>/gi, '• ');
    s = s.replace(/<[^>]+>/g, '');
    s = s
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
    s = s.replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(parseInt(n, 10)); });
    s = s.replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); });
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return s;
  }

  function stripImageUrls(text, urls) {
    var out = text || '';
    urls.forEach(function (u) { out = out.split(u).join(''); });
    out = out.replace(DRIVE_FILE_RE, '').replace(DRIVE_OPEN_RE, '');
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── Date formatting ──
  function statusChip(ms) {
    if (!ms) return '📅 UPCOMING';
    var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    var evMid = new Date(ms); evMid.setHours(0, 0, 0, 0);
    var diff = Math.round((evMid - todayMid) / 86400000);
    if (diff === 0) return '📅 TODAY';
    if (diff === 1) return '📅 TOMORROW';
    if (diff > 1 && diff <= 7) return '📅 ' + new Date(ms).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    return '📅 UPCOMING';
  }

  function formatEventTime(ms, allDay) {
    if (!ms) return '';
    var d = new Date(ms);
    if (allDay) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function smartTrim(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    var hard = text.slice(0, max);
    var soft = hard.replace(/\s+\S*$/, '');
    return (soft.length > max * 0.7 ? soft : hard).trim().replace(/[,;:.\-–—\s]+$/, '') + '…';
  }

  // Snapshot of upcoming events (start within last hour → 6 months out)
  function upcomingSnapshot() {
    var now = Date.now();
    return events
      .filter(function (e) { return e.startMs && e.startMs >= now - 3600000; })
      .sort(function (a, b) { return a.startMs - b.startMs; })
      .slice(0, 30);
  }

  // ── Load events from Apps Script (server-side iCal fetch) ──
  async function loadEvents() {
    var container = document.getElementById('publish-event-list');
    if (container) container.innerHTML = '<p class="dm-empty" style="padding:0.6rem;">Loading calendar…</p>';
    try {
      var token = (typeof session !== 'undefined' && session) ? session.token : '';
      var res;
      // 15-second timeout so it never hangs forever
      var timer;
      var timeoutPromise = new Promise(function(_, reject) {
        timer = setTimeout(function() { reject(new Error('Timed out after 15s — the Apps Script may not be redeployed yet. Go to Apps Script → Deploy → Manage Deployments → pencil → New version → Deploy.')); }, 15000);
      });
      res = await Promise.race([
        postAction({ action: 'getCalendarEvents', token: token }),
        timeoutPromise
      ]);
      clearTimeout(timer);
      console.log('[PublishCalendar] getCalendarEvents response:', JSON.stringify(res).slice(0, 300));
      if (res && res.ok && Array.isArray(res.events)) {
        events = res.events;
        loaded = true;
      } else {
        events = [];
        var errMsg = (res && res.error) ? res.error
          : 'Apps Script action not recognized — redeploy the web app: Deploy → Manage Deployments → pencil → New version → Deploy.';
        if (container) container.innerHTML = '<p class="dm-empty" style="padding:0.6rem;">⚠️ ' + escapeHtml(errMsg) + '</p>';
        return;
      }
      renderEventList();
      populateEventSelect();
    } catch (e) {
      console.error('[PublishCalendar] loadEvents error:', e);
      events = [];
      if (container) container.innerHTML = '<p class="dm-empty" style="padding:0.6rem;">⚠️ ' + escapeHtml(e.message) + '</p>';
    }
  }

  // ── Render the upcoming-events list ──
  function renderEventList() {
    var container = document.getElementById('publish-event-list');
    if (!container) return;
    var upcoming = upcomingSnapshot().slice(0, 12);
    if (!upcoming.length) {
      container.innerHTML = '<p class="dm-empty" style="padding:0.6rem;">No upcoming events. Add events in Google Calendar and they&rsquo;ll appear here automatically.</p>';
      return;
    }
    container.innerHTML = upcoming.map(function (e, i) {
      var images = extractImageUrls(e.description || '');
      var thumb = images.length
        ? '<img src="' + escapeHtml(images[0]) + '" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;" loading="lazy">'
        : '';
      var loc = e.location ? '<span style="font-size:0.72rem;color:var(--color-text-muted);">📍 ' + escapeHtml(smartTrim(e.location, 50)) + '</span>' : '';
      var desc = e.description ? stripImageUrls(stripHtmlToText(e.description), images) : '';
      return '<div class="publish-evt" style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.6rem;border:1px solid var(--color-border);border-radius:10px;margin-bottom:0.5rem;">' +
        thumb +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.66rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-olive);margin-bottom:0.15rem;">' + statusChip(e.startMs) + '</div>' +
          '<div style="font-weight:700;font-size:0.88rem;color:var(--color-text);margin-bottom:0.1rem;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(e.summary || 'Untitled event') + '</div>' +
          '<div style="font-size:0.74rem;color:var(--color-text-muted);margin-bottom:0.15rem;">' + escapeHtml(formatEventTime(e.startMs, e.allDay)) + '</div>' +
          loc +
          (desc ? '<div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.2rem;line-height:1.3;">' + escapeHtml(smartTrim(desc, 100)) + '</div>' : '') +
        '</div>' +
        '<button class="btn btn--outline btn--sm" data-draft="' + i + '" style="flex-shrink:0;white-space:nowrap;">Draft &rarr;</button>' +
      '</div>';
    }).join('');

    container.querySelectorAll('[data-draft]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        draftFromIndex(parseInt(this.getAttribute('data-draft'), 10));
      });
    });
  }

  // ── Populate the event <select> dropdown in the composer ──
  function populateEventSelect() {
    var sel = document.getElementById('ann-event-select');
    if (!sel) return;
    var upcoming = upcomingSnapshot();
    var html = '<option value="">— Pick an event to auto-fill —</option>';
    upcoming.forEach(function (e, i) {
      var label = (e.summary || 'Untitled') + ' — ' + formatEventTime(e.startMs, e.allDay);
      html += '<option value="' + i + '">' + escapeHtml(smartTrim(label, 80)) + '</option>';
    });
    sel.innerHTML = html;
  }

  // ── Auto-fill the composer from an event (by index in the upcoming snapshot) ──
  function draftFromIndex(idx) {
    var e = upcomingSnapshot()[idx];
    if (!e) return;
    draftFromEvent(e);
    var sel = document.getElementById('ann-event-select');
    if (sel) sel.value = String(idx);
  }

  function draftFromEvent(e) {
    var subj = document.getElementById('ann-subject');
    var body = document.getElementById('ann-body');
    if (!subj || !body) return;

    // Reveal the composer if it's hidden
    var compose = document.getElementById('chat-admin-compose');
    if (compose) compose.style.display = '';
    var openBtn = document.getElementById('ann-open-btn');
    if (openBtn) openBtn.style.display = 'none';

    // Subject = event title
    subj.value = e.summary || '';

    // Body = formatted date/time + location + description
    var lines = [];
    var when = formatEventTime(e.startMs, e.allDay);
    if (!e.allDay && e.endMs && e.endMs !== e.startMs) {
      when += ' – ' + new Date(e.endMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    lines.push(when);
    if (e.location) lines.push('📍 ' + e.location);
    var images = extractImageUrls(e.description || '');
    var descText = e.description ? stripImageUrls(stripHtmlToText(e.description), images) : '';
    if (descText) lines.push('', descText);
    body.value = lines.join('\n');

    // Auto-set the first image as the announcement photo (best-effort).
    // annPhotoUrls + annRenderPhotos are globals from team-portal.js.
    if (images.length && typeof annRenderPhotos === 'function') {
      // Replace any existing photos with the event image.
      annPhotoUrls = [images[0]];
      annRenderPhotos();
    }
  }

  // ── Init: wire the refresh button + event-select change ──
  function init() {
    var refresh = document.getElementById('pub-cal-refresh');
    if (refresh) refresh.addEventListener('click', loadEvents);
    var sel = document.getElementById('ann-event-select');
    if (sel) sel.addEventListener('change', function () {
      var idx = parseInt(this.value, 10);
      if (!isNaN(idx)) draftFromIndex(idx);
    });
  }

  // Script loads after HTML, so the DOM is ready.
  init();

  return {
    loadEvents: loadEvents,
    draftFromEvent: draftFromEvent,
    getEvents: function () { return events; },
    isLoaded: function () { return loaded; }
  };
})();
