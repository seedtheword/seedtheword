/* Seed the Word — Outreach Reach: spinnable 3D globe + "countries reached" counter.
 * Self-contained, NO dependencies. Renders a draggable orthographic globe on a
 * <canvas> with real (simplified) coastlines and glowing markers on the
 * countries we've reached. Also updates any `.js-countries-count` /
 * `.js-countries-word` elements on the page.
 *
 * USAGE
 *   Counter only: add an element with class "js-countries-count".
 *   Globe widget: add <div id="outreach-reach"></div>. Optional attribute
 *     data-reach-mode="compact" renders just the globe + inline counter (no lists).
 *
 * Presence-only (no per-location numbers), per ministry request.
 */
(function () {
  var CACHE_KEY = 'stw_outreach_locations';
  var TTL = 5 * 60 * 1000;
  var FALLBACK = {
    ok: true,
    countries: [
      { name: 'United States', region: '', iso2: 'US' },
      { name: 'Suriname', region: 'South America', iso2: 'SR' },
      { name: 'Pakistan', region: 'Asia', iso2: 'PK' }
    ],
    states: [
      { name: 'Washington', region: 'United States', iso2: '' },
      { name: 'Texas', region: 'United States', iso2: '' }
    ],
    cities: [
      { name: 'Seattle', region: 'Washington', iso2: '' }, { name: 'Bellevue', region: 'Washington', iso2: '' },
      { name: 'Lynnwood', region: 'Washington', iso2: '' }, { name: 'Everett', region: 'Washington', iso2: '' },
      { name: 'Mukilteo', region: 'Washington', iso2: '' }, { name: 'Federal Way', region: 'Washington', iso2: '' }
    ],
    countriesCount: 3
  };

  // Country centroids [lon, lat] for markers (add more as reach grows).
  var COUNTRY_LATLON = {
    US: [-98, 39], SR: [-56, 4], PK: [69, 30],
    CA: [-106, 56], MX: [-102, 23], BR: [-51, -10], GB: [-2, 54], IN: [79, 22],
    PH: [122, 12], NG: [8, 9], KE: [38, 0], ID: [113, -1], AU: [134, -25],
    UA: [32, 49], RU: [100, 62], FR: [2, 46], DE: [10, 51], ZA: [24, -29],
    EG: [30, 26], TH: [101, 15], CN: [104, 35], JP: [138, 36], KR: [128, 36]
  };

  // Simplified world coastlines as [lon,lat] polylines (recognizable continents,
  // low vertex count so it stays lightweight). Not survey-accurate — decorative.
  var LAND = [
    // North America
    [[-168,65],[-150,70],[-125,70],[-95,72],[-80,68],[-64,60],[-56,52],[-66,45],[-70,42],[-75,35],[-81,25],[-97,26],[-107,23],[-115,30],[-124,40],[-124,48],[-130,54],[-146,60],[-168,65]],
    // Central America / Mexico tail
    [[-92,15],[-84,10],[-78,8],[-83,14],[-90,16],[-92,15]],
    // South America
    [[-80,8],[-70,10],[-60,6],[-50,0],[-44,-3],[-40,-10],[-38,-18],[-48,-25],[-58,-35],[-65,-45],[-72,-52],[-75,-45],[-71,-35],[-70,-25],[-72,-15],[-78,-5],[-80,2],[-80,8]],
    // Africa
    [[-16,15],[-10,25],[10,34],[24,32],[32,31],[43,12],[51,12],[41,-2],[40,-15],[35,-24],[25,-34],[18,-34],[12,-18],[9,4],[-8,5],[-16,15]],
    // Europe
    [[-10,44],[-2,49],[2,51],[8,54],[10,58],[20,60],[28,60],[30,52],[24,46],[14,45],[6,44],[-2,43],[-9,43],[-10,44]],
    // Asia (broad)
    [[30,52],[45,55],[60,58],[80,60],[100,62],[120,60],[140,55],[150,60],[142,50],[135,45],[130,42],[122,40],[120,32],[110,22],[100,12],[92,20],[80,10],[72,20],[66,25],[56,26],[48,30],[44,36],[36,42],[34,46],[30,52]],
    // Australia
    [[114,-22],[122,-18],[132,-12],[142,-12],[150,-24],[153,-30],[146,-38],[138,-35],[129,-32],[118,-34],[114,-22]],
    // Greenland
    [[-45,60],[-30,68],[-20,72],[-30,78],[-45,80],[-58,76],[-55,68],[-45,60]]
  ];

  var GLOBE_TILT = -18 * Math.PI / 180; // slight axial tilt for aesthetics

  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : s); return d.innerHTML; }

  function setCounters(n) {
    document.querySelectorAll('.js-countries-count').forEach(function (el) { el.textContent = String(n); });
    document.querySelectorAll('.js-countries-word').forEach(function (el) { el.textContent = (n === 1 ? 'Country' : 'Countries'); });
  }

  // ── Globe engine ──
  function Globe(canvas, markers) {
    var ctx = canvas.getContext('2d');
    var rot = 0.3;          // longitude rotation (radians)
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    var dragging = false, lastX = 0, autoRot = true, raf = null;
    var R = 0, cx = 0, cy = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var size = Math.max(160, Math.min(rect.width, rect.height || rect.width));
      canvas.width = size * dpr; canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = size * 0.44; cx = size / 2; cy = size / 2;
    }

    // Project lon/lat → screen. Returns {x,y,visible}.
    function project(lon, lat) {
      var la = lat * Math.PI / 180;
      var lo = lon * Math.PI / 180 + rot;
      // rotate around Y (spin) then tilt around X
      var x = Math.cos(la) * Math.sin(lo);
      var y = Math.sin(la);
      var z = Math.cos(la) * Math.cos(lo);
      // tilt
      var y2 = y * Math.cos(GLOBE_TILT) - z * Math.sin(GLOBE_TILT);
      var z2 = y * Math.sin(GLOBE_TILT) + z * Math.cos(GLOBE_TILT);
      return { x: cx + R * x, y: cy - R * y2, visible: z2 >= 0, z: z2 };
    }

    function drawPoly(pts, stroke, fill) {
      var started = false, prevVis = false;
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var p = project(pts[i][0], pts[i][1]);
        if (p.visible) {
          if (!started || !prevVis) { ctx.moveTo(p.x, p.y); }
          else { ctx.lineTo(p.x, p.y); }
          started = true;
        }
        prevVis = p.visible;
      }
      if (fill) { ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }

    function draw() {
      var size = canvas.width / dpr;
      ctx.clearRect(0, 0, size, size);
      // Ocean sphere with soft shading.
      var grd = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.2, cx, cy, R);
      grd.addColorStop(0, '#3b6ea5');
      grd.addColorStop(0.65, '#2b5686');
      grd.addColorStop(1, '#173a5e');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grd; ctx.fill();

      // Graticule (subtle).
      ctx.save();
      ctx.globalAlpha = 0.18; ctx.strokeStyle = '#cfe0f0'; ctx.lineWidth = 0.5;
      for (var lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath(); var first = true;
        for (var lon = -180; lon <= 180; lon += 6) { var p = project(lon, lat); if (p.visible) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); } else first = true; }
        ctx.stroke();
      }
      for (var lon2 = -180; lon2 < 180; lon2 += 30) {
        ctx.beginPath(); var first2 = true;
        for (var la2 = -90; la2 <= 90; la2 += 6) { var p2 = project(lon2, la2); if (p2.visible) { if (first2) { ctx.moveTo(p2.x, p2.y); first2 = false; } else ctx.lineTo(p2.x, p2.y); } else first2 = true; }
        ctx.stroke();
      }
      ctx.restore();

      // Land.
      for (var i = 0; i < LAND.length; i++) drawPoly(LAND[i], 'rgba(30,60,30,0.55)', '#3f7d43');

      // Markers.
      (markers || []).forEach(function (m) {
        var p = project(m.lon, m.lat);
        if (!p.visible) return;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#e0b84e'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        // halo
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(224,184,78,0.35)'; ctx.lineWidth = 3; ctx.stroke();
      });

      // Rim light.
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    function tick() {
      if (autoRot && !dragging) rot += 0.0022;
      draw();
      raf = requestAnimationFrame(tick);
    }

    function onDown(e) { dragging = true; autoRot = false; lastX = (e.touches ? e.touches[0].clientX : e.clientX); }
    function onMove(e) {
      if (!dragging) return;
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      rot += (x - lastX) * 0.008; lastX = x;
      if (e.cancelable) e.preventDefault();
    }
    function onUp() { dragging = false; setTimeout(function () { autoRot = true; }, 2500); }

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: true });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    window.addEventListener('resize', resize);

    resize();
    tick();
    return { destroy: function () { if (raf) cancelAnimationFrame(raf); } };
  }

  var globeInstance = null;

  function markersFor(countries) {
    return (countries || []).map(function (c) {
      var ll = COUNTRY_LATLON[String(c.iso2 || '').toUpperCase()];
      return ll ? { lon: ll[0], lat: ll[1], name: c.name } : null;
    }).filter(Boolean);
  }

  function renderReach(container, data) {
    var countries = data.countries || [];
    var states = data.states || [];
    var cities = data.cities || [];
    var n = (typeof data.countriesCount === 'number') ? data.countriesCount : countries.length;
    var compact = container.getAttribute('data-reach-mode') === 'compact';

    function chips(arr) {
      if (!arr.length) return '<span class="reach-empty">—</span>';
      return arr.map(function (x) { return '<span class="reach-chip">' + esc(x.name) + '</span>'; }).join('');
    }

    var globeBlock =
      '<div class="reach-globe">' +
        '<canvas class="reach-globe__canvas" aria-label="Interactive globe showing where Bibles have been sent"></canvas>' +
        '<div class="reach-globe__hint">Drag to spin 🌍</div>' +
      '</div>';

    var counterInline =
      '<div class="reach__stat reach__stat--inline"><span class="reach__stat-num js-countries-count">' + n + '</span>' +
      '<span class="reach__stat-label"><span class="js-countries-word">' + (n === 1 ? 'Country' : 'Countries') + '</span> Reached</span></div>';

    if (compact) {
      container.innerHTML =
        '<div class="reach reach--compact">' +
          '<div class="reach__eyebrow">Our Reach — Where We\'ve Sent Bibles</div>' +
          globeBlock + counterInline +
        '</div>';
    } else {
      container.innerHTML =
        '<div class="reach">' +
          '<div class="reach__head">' +
            '<div class="reach__eyebrow">Our Reach</div>' +
            '<h2 class="reach__title">Where We\'ve Sent Bibles</h2>' +
            '<p class="reach__sub">From our home base in Washington State to communities around the world — every location is a life God placed in our path.</p>' +
          '</div>' + counterInline + globeBlock +
          '<div class="reach-lists">' +
            '<div class="reach-list"><h3 class="reach-list__label">🌍 Countries</h3><div class="reach-chips">' + chips(countries) + '</div></div>' +
            '<div class="reach-list"><h3 class="reach-list__label">🏳️ States</h3><div class="reach-chips">' + chips(states) + '</div></div>' +
            '<div class="reach-list"><h3 class="reach-list__label">📍 Washington cities</h3><div class="reach-chips">' + chips(cities) + '</div></div>' +
          '</div>' +
        '</div>';
    }

    var canvas = container.querySelector('.reach-globe__canvas');
    if (canvas) {
      if (globeInstance) { try { globeInstance.destroy(); } catch (e) {} }
      globeInstance = Globe(canvas, markersFor(countries));
    }
  }

  function apply(data) {
    var n = (typeof data.countriesCount === 'number') ? data.countriesCount : (data.countries || []).length;
    setCounters(n);
    var container = document.getElementById('outreach-reach');
    if (container) renderReach(container, data);
  }

  async function load() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}
    if (cached && cached.data) apply(cached.data);
    else apply(FALLBACK);

    var url = '';
    try {
      var cfg = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
      url = cfg.orderHandlerUrl || '';
      if (!cached && typeof cfg.outreachCountries === 'number') setCounters(cfg.outreachCountries);
    } catch (e) {}
    if (!url) return;

    if (cached && cached.ts && (Date.now() - cached.ts) < TTL) return;
    try {
      var live = await fetch(url + '?action=getOutreachLocations', { cache: 'no-store' }).then(function (r) { return r.json(); });
      if (live && live.ok && Array.isArray(live.countries)) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: live, ts: Date.now() })); } catch (e) {}
        apply(live);
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
