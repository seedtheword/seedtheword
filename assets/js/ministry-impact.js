/* ============================================================
   Ministry Impact — homepage Bible counter + outreach slideshow
   Replaces the heavy showcase-carousel.js with a fast, focused
   section showing:
   1. Live Bible giveaway counter (from site-config.json,
      upgradeable to Apps Script getMinistryStats endpoint)
   2. Outreach photo slideshow with event titles and stories
   ============================================================ */
(function () {
  'use strict';

  // ── Counter ─────────────────────────────────────────────────
  async function initCounter() {
    // Support multiple counter mounts across pages
    var mounts = document.querySelectorAll('#homepage-counter');
    if (!mounts.length) return;

    var CACHE_KEY = 'stw_ministry_stats';
    var cached = {};
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (_) {}

    var count   = cached.total   || 123;
    var goal    = cached.goal    || 70000;
    var inStock = cached.inStock || [];

    // Render the full counter card into each mount
    mounts.forEach(function(mount) { buildCounterHTML(mount, count, goal, inStock); });
    // Animate with cached values immediately
    animateCounters(count, goal);

    // Fetch live data
    var orderHandlerUrl = '';
    try {
      var cfgRes = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' });
      if (cfgRes.ok) {
        var cfg = await cfgRes.json();
        orderHandlerUrl = cfg.orderHandlerUrl || '';
        if (!cached.total) {
          count   = typeof cfg.biblesGivenAway === 'number' ? cfg.biblesGivenAway : count;
          goal    = typeof cfg.biblesGoal2026  === 'number' ? cfg.biblesGoal2026  : goal;
          inStock = Array.isArray(cfg.biblesInStock) ? cfg.biblesInStock : inStock;
        }
      }
    } catch (_) {}

    if (orderHandlerUrl) {
      try {
        var liveRes = await fetch(orderHandlerUrl + '?action=getMinistryStats', { cache: 'no-store' });
        if (liveRes.ok) {
          var live = await liveRes.json();
          if (live.ok) {
            count   = live.total   || count;
            goal    = live.goal    || goal;
            inStock = live.inStock || inStock;
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ total: count, goal: goal, inStock: inStock, ts: Date.now() })); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    // Update stock tags and animate to live count
    document.querySelectorAll('.impact-counter__stock').forEach(function(stockEl) {
      updateStockTags(stockEl, inStock);
    });
    animateCounters(count, goal);
  }

  function buildCounterHTML(mount, count, goal, inStock) {
    var pct = Math.min(100, Math.round(count / goal * 1000) / 10);
    var stockHTML = inStock.filter(function(i){ return i && i.language && (i.count === undefined || i.count > 0); })
      .map(function(i){ return '<span class="stock-tag">' + esc(i.language) + '</span>'; }).join('');

    mount.innerHTML =
      '<div class="impact-counter glass-morphism">' +
        '<div class="impact-counter__left">' +
          '<p class="impact-counter__eyebrow">Bibles Given Away</p>' +
          '<div class="impact-counter__number">' +
            '<span class="impact-counter__num">' + count.toLocaleString('en-US') + '</span>' +
            '<span class="impact-counter__plus">+</span>' +
          '</div>' +
          '<p class="impact-counter__sub">and counting \u2014 updated live from our outreach records</p>' +
          '<div class="impact-counter__bar-wrap"><div class="impact-counter__bar" style="width:' + pct + '%"></div></div>' +
          '<p class="impact-counter__goal">Goal: ' + goal.toLocaleString('en-US') + ' for 2026</p>' +
        '</div>' +
        '<div class="impact-counter__right">' +
          '<span class="impact-counter__stock-label">In Stock Now</span>' +
          '<div class="impact-counter__stock">' + (stockHTML || '<span class="stock-tag">Restocking soon</span>') + '</div>' +
          '<div class="impact-counter__actions">' +
            '<a href="store.html" class="btn btn-primary btn-sm">\uD83C\uDF81 Gift a Bible</a>' +
            '<a href="news.html#ministry-outreach" class="btn btn-secondary btn-sm">See Outreach</a>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function updateStockTags(stockEl, inStock) {
    if (!stockEl) return;
    var items = inStock.filter(function(i){ return i && i.language && (i.count === undefined || i.count > 0); });
    if (items.length) {
      stockEl.innerHTML = items.map(function(i){ return '<span class="stock-tag">' + esc(i.language) + '</span>'; }).join('');
    }
  }

  function animateCounters(count, goal) {
    var pct = Math.min(100, Math.round(count / goal * 1000) / 10);
    document.querySelectorAll('.impact-counter__num').forEach(function(numEl) {
      var from = parseInt(numEl.textContent.replace(/,/g,''), 10) || 0;
      if (from === count) return;
      numEl.style.animation = 'counter-strobe 0.22s steps(1) infinite';
      var start = performance.now(), dur = 1600;
      function step(now) {
        var prog = Math.min((now - start) / dur, 1);
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
    document.querySelectorAll('.impact-counter__bar').forEach(function(barEl) {
      barEl.style.transition = 'width 1.4s cubic-bezier(0.25,1,0.5,1)';
      barEl.style.width = pct + '%';
    });
  }

  // ── Outreach Slideshow ───────────────────────────────────────
  var SLIDES = [];
  var currentSlide = 0;
  var autoTimer = null;
  var AUTO_MS = 6000;

  async function initSlideshow() {
    var track = document.getElementById('oss-track');
    var dots  = document.getElementById('oss-dots');
    var prev  = document.getElementById('oss-prev');
    var next  = document.getElementById('oss-next');
    if (!track) return;

    // Load outreach events
    try {
      var res = await fetch('assets/data/ministry-outreach.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var events = Array.isArray(data.events) ? data.events : [];

      // Load first photo from each event
      var loaded = await Promise.all(events.slice(0, 6).map(async function(ev) {
        try {
          var mr = await fetch('assets/images/ministry-outreach/' + ev.folder + '/images.json?t=' + Date.now(), { cache: 'no-store' });
          if (!mr.ok) return null;
          var m = await mr.json();
          var photos = Array.isArray(m.media) ? m.media.filter(function(x) { return x && x.file && x.type === 'photo'; }) : [];
          if (!photos.length) return null;
          return {
            img: 'assets/images/ministry-outreach/' + ev.folder + '/' + encodeURIComponent(photos[0].file),
            title: ev.title || 'Outreach',
            date: ev.date || '',
            location: ev.location || '',
            body: ev.body || '',
            folder: ev.folder,
          };
        } catch (_) { return null; }
      }));

      SLIDES = loaded.filter(Boolean);
    } catch (_) {}

    // Fallback slides if no outreach data
    if (!SLIDES.length) {
      SLIDES = [
        { img: 'assets/images/ministry-highlights/stw-bibles-giveaway.jpg', title: 'Bibles Going Out', date: '', location: 'Pacific Northwest', body: 'Every Bible packed with prayer and a handwritten note.' },
        { img: 'assets/images/ministry-highlights/bible-ministry-1.jpg', title: 'Pack & Ship Nights', date: '', location: 'Seed the Word HQ', body: 'Volunteers gather to pack, pray, and ship.' },
        { img: 'assets/images/backgrounds/gideon-background.jpg', title: 'Out in the Field', date: '', location: 'Streets & Campuses', body: 'We bring the Gospel wherever God opens a door.' },
      ];
    }

    renderSlides(track, dots);
    if (prev) prev.addEventListener('click', function() { go(-1); });
    if (next) next.addEventListener('click', function() { go(1); });
    startAuto();
  }

  function renderSlides(track, dots) {
    track.innerHTML = SLIDES.map(function(s, i) {
      return '<div class="oss-slide' + (i === 0 ? ' active' : '') + '" data-index="' + i + '">' +
        '<div class="oss-slide__img" style="background-image:url(\'' + esc(s.img) + '\')">' +
          '<div class="oss-slide__content">' +
            '<p class="oss-slide__date">' + esc((s.date ? s.date + (s.location ? ' \xb7 ' : '') : '') + (s.location || '')) + '</p>' +
            '<h3 class="oss-slide__title">' + esc(s.title) + '</h3>' +
            '<p class="oss-slide__body">' + esc(s.body.slice(0, 120) + (s.body.length > 120 ? '\u2026' : '')) + '</p>' +
            (s.folder ? '<a class="oss-slide__link" href="news.html#ministry-outreach">Read the full story \u2192</a>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    if (dots) {
      dots.innerHTML = SLIDES.map(function(_, i) {
        return '<button class="oss-dot' + (i === 0 ? ' active' : '') + '" data-index="' + i + '" aria-label="Slide ' + (i+1) + '"></button>';
      }).join('');
      dots.addEventListener('click', function(e) {
        var btn = e.target.closest('.oss-dot');
        if (btn) goTo(parseInt(btn.dataset.index, 10));
      });
    }
  }

  function go(dir) { goTo((currentSlide + dir + SLIDES.length) % SLIDES.length); }

  function goTo(idx) {
    var track = document.getElementById('oss-track');
    var dots  = document.getElementById('oss-dots');
    if (!track) return;
    track.querySelectorAll('.oss-slide').forEach(function(el, i) { el.classList.toggle('active', i === idx); });
    if (dots) dots.querySelectorAll('.oss-dot').forEach(function(el, i) { el.classList.toggle('active', i === idx); });
    currentSlide = idx;
    resetAuto();
  }

  function startAuto() { autoTimer = setInterval(function() { go(1); }, AUTO_MS); }
  function resetAuto() { clearInterval(autoTimer); startAuto(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { initCounter(); initSlideshow(); });
  } else {
    initCounter(); initSlideshow();
  }
})();
