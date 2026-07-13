/* ============================================================
   Ministry Impact — Bible counter + outreach slideshow
   Performance: counter loads immediately from cache/config,
   live Apps Script fetch is deferred. Slideshow loads lazily
   via IntersectionObserver so it never blocks first paint.
   ============================================================ */
(function () {
  'use strict';

  var CACHE_KEY   = 'stw_ministry_stats';
  var CACHE_TTL   = 5 * 60 * 1000; // 5 min

  // ── Helpers ─────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (_) { return {}; }
  }

  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  // ── Counter HTML builder ─────────────────────────────────────
  function buildCounterHTML(mount, count, goal, inStock) {
    var pct = Math.min(100, Math.round(count / goal * 1000) / 10);
    var stockCount = inStock.filter(function(i){ return i && i.language && (i.count === undefined || i.count > 0); }).length;

    mount.innerHTML =
      '<div class="impact-strip">' +
        '<div class="impact-strip__header">' +
          '<span class="impact-strip__count">' + count.toLocaleString('en-US') + '</span>' +
          '<span class="impact-strip__separator">/</span>' +
          '<span class="impact-strip__goal">' + goal.toLocaleString('en-US') + '</span>' +
          '<span class="impact-strip__label">Bibles for 2026</span>' +
        '</div>' +
        '<div class="impact-strip__bar"><div class="impact-strip__fill" style="width:' + pct + '%"></div></div>' +
        '<div class="impact-strip__footer">' +
          '<span class="impact-strip__stat">' + stockCount + ' languages in stock</span>' +
          '<span class="impact-strip__dot">\u00b7</span>' +
          '<span class="impact-strip__stat">Updated live</span>' +
          '<a href="donate.html#give" class="impact-strip__cta">Give \u2192</a>' +
        '</div>' +
      '</div>';
  }

  function animateCounters(count, goal) {
    var pct = Math.min(100, Math.round(count / goal * 1000) / 10);
    document.querySelectorAll('.impact-strip__count').forEach(function(numEl) {
      var from = parseInt(numEl.textContent.replace(/,/g, ''), 10) || 0;
      if (from === count) return;
      var start = performance.now(), dur = 1600;
      function step(now) {
        var prog  = Math.min((now - start) / dur, 1);
        var eased = 1 - Math.pow(1 - prog, 3);
        numEl.textContent = Math.round(from + (count - from) * eased).toLocaleString('en-US');
        if (prog < 1) { requestAnimationFrame(step); }
        else {
          numEl.textContent = count.toLocaleString('en-US');
          numEl.style.animation = 'counter-glow-store 3s ease-in-out infinite';
        }
      }
      requestAnimationFrame(step);
    });
    document.querySelectorAll('.impact-strip__fill').forEach(function(barEl) {
      barEl.style.width = pct + '%';
    });
  }

  function updateStockTags(inStock) {
    var items = inStock.filter(function(i){ return i && i.language && (i.count === undefined || i.count > 0); });
    document.querySelectorAll('.impact-strip__stat').forEach(function(el) {
      if (el.textContent.indexOf('languages') !== -1) {
        el.textContent = items.length + ' languages in stock';
      }
    });
  }

  // ── Counter init ─────────────────────────────────────────────
  async function initCounter() {
    var mounts = document.querySelectorAll('#homepage-counter');
    if (!mounts.length) return;

    // 1. Load from cache first for instant render
    var cached  = readCache();
    var count   = cached.total   || 123;
    var goal    = cached.goal    || 70000;
    var inStock = cached.inStock || [];

    mounts.forEach(function(m) { buildCounterHTML(m, count, goal, inStock); });
    animateCounters(count, goal);

    // 2. Fetch config for Apps Script URL (no-store but not blocking render)
    var orderHandlerUrl = '';
    try {
      var cfgRes = await fetch('assets/data/site-config.json', { cache: 'no-store' });
      if (cfgRes.ok) {
        var cfg = await cfgRes.json();
        orderHandlerUrl = cfg.orderHandlerUrl || '';
        // Only use config values if cache is stale/empty
        if (!cached.total) {
          count   = typeof cfg.biblesGivenAway === 'number' ? cfg.biblesGivenAway : count;
          goal    = typeof cfg.biblesGoal2026  === 'number' ? cfg.biblesGoal2026  : goal;
          inStock = Array.isArray(cfg.biblesInStock)        ? cfg.biblesInStock   : inStock;
          mounts.forEach(function(m) { buildCounterHTML(m, count, goal, inStock); });
          animateCounters(count, goal);
        }
      }
    } catch (_) {}

    // 3. Fetch live stats — but only if cache is older than TTL
    var cacheAge = cached.ts ? Date.now() - cached.ts : Infinity;
    if (orderHandlerUrl && cacheAge > CACHE_TTL) {
      try {
        var liveRes = await fetch(orderHandlerUrl + '?action=getMinistryStats', { cache: 'no-store' });
        if (liveRes.ok) {
          var live = await liveRes.json();
          if (live.ok) {
            count   = live.total   || count;
            goal    = live.goal    || goal;
            inStock = live.inStock || inStock;
            writeCache({ total: count, goal: goal, inStock: inStock, ts: Date.now() });
            updateStockTags(inStock);
            animateCounters(count, goal);
          }
        }
      } catch (_) {}
    }
  }

  // ── Slideshow (lazy — only loads when section is visible) ────
  var SLIDES = [];
  var currentSlide = 0;
  var autoTimer    = null;
  var AUTO_MS      = 6000;
  var slideshowReady = false;

  var FALLBACK_SLIDES = [
    { img: 'assets/images/ministry-highlights/stw-bibles-giveaway.jpg',   title: 'Bibles Going Out',   location: 'Pacific Northwest', body: 'Every Bible packed with prayer and a handwritten note.' },
    { img: 'assets/images/ministry-highlights/bible-ministry-1.jpg',       title: 'Pack & Ship Nights', location: 'Seed the Word HQ',   body: 'Volunteers gather to pack, pray, and ship.' },
    { img: 'assets/images/backgrounds/gideon-background.jpg',              title: 'Out in the Field',   location: 'Streets & Campuses', body: 'We bring the Gospel wherever God opens a door.' }
  ];

  async function loadSlides() {
    if (slideshowReady) return;
    slideshowReady = true;
    try {
      var res = await fetch('assets/data/ministry-outreach.json', { cache: 'default' });
      if (!res.ok) throw new Error();
      var data   = await res.json();
      var events = Array.isArray(data.events) ? data.events.slice(0, 5) : [];

      // Load image manifests in parallel but cap at 5 events
      var loaded = await Promise.all(events.map(async function(ev) {
        try {
          var mr = await fetch('assets/images/ministry-outreach/' + ev.folder + '/images.json', { cache: 'default' });
          if (!mr.ok) return null;
          var m      = await mr.json();
          var photos = Array.isArray(m.media) ? m.media.filter(function(x){ return x && x.file && x.type === 'photo'; }) : [];
          if (!photos.length) return null;
          return {
            img:      'assets/images/ministry-outreach/' + ev.folder + '/' + encodeURIComponent(photos[0].file),
            title:    ev.title    || 'Outreach',
            date:     ev.date     || '',
            location: ev.location || '',
            body:     ev.body     || '',
            folder:   ev.folder
          };
        } catch (_) { return null; }
      }));
      SLIDES = loaded.filter(Boolean);
    } catch (_) {}

    if (!SLIDES.length) SLIDES = FALLBACK_SLIDES;

    var track = document.getElementById('oss-track');
    var dots  = document.getElementById('oss-dots');
    if (!track) return;
    renderSlides(track, dots);
    startAuto();
  }

  function initSlideshow() {
    var section = document.getElementById('outreach-slideshow');
    if (!section) return;

    // Wire up controls immediately (they're empty but harmless)
    var prev = document.getElementById('oss-prev');
    var next = document.getElementById('oss-next');
    if (prev) prev.addEventListener('click', function(){ go(-1); });
    if (next) next.addEventListener('click', function(){ go(1);  });

    // Lazy-load slide data when slideshow scrolls into view
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting) { io.disconnect(); loadSlides(); }
      }, { rootMargin: '200px' });
      io.observe(section);
    } else {
      // Fallback: load after 1s idle
      setTimeout(loadSlides, 1000);
    }
  }

  function renderSlides(track, dots) {
    track.innerHTML = SLIDES.map(function(s, i) {
      var dateLine = (s.date ? s.date + (s.location ? ' \xb7 ' : '') : '') + (s.location || '');
      var bodyText = s.body ? s.body.slice(0, 120) + (s.body.length > 120 ? '\u2026' : '') : '';
      return (
        '<div class="oss-slide' + (i === 0 ? ' active' : '') + '" data-index="' + i + '">' +
          '<div class="oss-slide__img" style="background-image:url(\'' + esc(s.img) + '\')">' +
            '<div class="oss-slide__content">' +
              (dateLine ? '<p class="oss-slide__date">' + esc(dateLine) + '</p>' : '') +
              '<h3 class="oss-slide__title">' + esc(s.title) + '</h3>' +
              (bodyText ? '<p class="oss-slide__body">' + esc(bodyText) + '</p>' : '') +
              (s.folder ? '<a class="oss-slide__link" href="news.html#ministry-outreach">Read the full story \u2192</a>' : '') +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    if (dots) {
      dots.innerHTML = SLIDES.map(function(_, i) {
        return '<button class="oss-dot' + (i === 0 ? ' active' : '') + '" data-index="' + i +
               '" aria-label="Slide ' + (i + 1) + '"></button>';
      }).join('');
      dots.addEventListener('click', function(e) {
        var btn = e.target.closest('.oss-dot');
        if (btn) goTo(parseInt(btn.dataset.index, 10));
      });
    }
  }

  function go(dir)  { goTo((currentSlide + dir + SLIDES.length) % SLIDES.length); }
  function goTo(idx) {
    var track = document.getElementById('oss-track');
    var dots  = document.getElementById('oss-dots');
    if (!track || !SLIDES.length) return;
    track.querySelectorAll('.oss-slide').forEach(function(el, i){ el.classList.toggle('active', i === idx); });
    if (dots) dots.querySelectorAll('.oss-dot').forEach(function(el, i){ el.classList.toggle('active', i === idx); });
    currentSlide = idx;
    resetAuto();
  }
  function startAuto() { if (SLIDES.length > 1) autoTimer = setInterval(function(){ go(1); }, AUTO_MS); }
  function resetAuto() { clearInterval(autoTimer); startAuto(); }

  // ── Boot ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ initCounter(); initSlideshow(); });
  } else {
    initCounter(); initSlideshow();
  }
})();
