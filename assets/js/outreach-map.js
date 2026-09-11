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

  // City coordinates [lon, lat] for zoom-in pins (keyed by lowercased name).
  // Covers the reached WA cities + a few likely future ones; unknown cities are
  // simply skipped (no pin) until added here.
  var CITY_LATLON = {
    'seattle': [-122.33, 47.61], 'bellevue': [-122.20, 47.61], 'lynnwood': [-122.31, 47.82],
    'everett': [-122.20, 47.98], 'mukilteo': [-122.30, 47.94], 'federal way': [-122.31, 47.32],
    'tacoma': [-122.44, 47.25], 'redmond': [-122.12, 47.67], 'kirkland': [-122.21, 47.68],
    'renton': [-122.21, 47.48], 'kent': [-122.23, 47.38], 'shoreline': [-122.34, 47.76],
    'edmonds': [-122.38, 47.81], 'bothell': [-122.21, 47.76], 'seatac': [-122.31, 47.44],
    'houston': [-95.37, 29.76], 'dallas': [-96.80, 32.78], 'austin': [-97.74, 30.27], 'paramaribo': [-55.17, 5.87]
  };

  // World coastlines as [lon,lat] polylines — denser outlines for a more
  // recognizable Earth. Decorative (not survey-accurate) but higher detail.
  var LAND = [
    // North America
    [[-168,66],[-162,70],[-156,71],[-140,70],[-128,70],[-114,69],[-100,70],[-88,70],[-80,67],[-74,63],[-64,60],[-60,55],[-56,51],[-60,47],[-66,44],[-70,42],[-71,41],[-74,40],[-76,37],[-76,34],[-81,31],[-80,27],[-81,25],[-84,30],[-88,30],[-94,29],[-97,28],[-97,26],[-99,22],[-105,22],[-110,24],[-113,29],[-117,32],[-121,35],[-122,37],[-124,40],[-124,43],[-124,48],[-127,51],[-133,55],[-140,59],[-148,60],[-156,58],[-162,60],[-166,62],[-168,66]],
    // Central America
    [[-97,16],[-92,15],[-88,16],[-84,11],[-80,9],[-77,8],[-83,13],[-88,18],[-92,18],[-97,16]],
    // South America
    [[-79,9],[-72,11],[-64,10],[-60,7],[-52,4],[-50,0],[-48,-2],[-44,-3],[-40,-8],[-38,-13],[-39,-18],[-43,-23],[-48,-25],[-53,-34],[-58,-38],[-62,-41],[-65,-45],[-69,-50],[-73,-53],[-75,-49],[-73,-43],[-72,-37],[-71,-30],[-70,-23],[-71,-18],[-75,-14],[-78,-8],[-81,-5],[-80,0],[-78,4],[-79,9]],
    // Africa
    [[-16,15],[-16,20],[-10,26],[-6,31],[0,33],[10,34],[18,32],[24,32],[30,31],[33,28],[35,24],[38,18],[43,12],[48,12],[51,12],[45,5],[42,0],[41,-4],[40,-10],[38,-16],[35,-22],[30,-28],[25,-34],[20,-35],[16,-29],[13,-22],[12,-16],[9,-5],[9,3],[5,5],[-4,6],[-10,8],[-14,11],[-16,15]],
    // Europe
    [[-10,44],[-8,43],[-2,43],[-1,46],[-2,49],[1,50],[4,52],[8,54],[9,57],[6,58],[11,59],[16,56],[13,54],[19,54],[24,57],[28,60],[30,66],[24,66],[22,60],[27,56],[30,52],[28,47],[24,45],[19,45],[14,45],[13,41],[16,41],[18,40],[16,38],[10,44],[6,44],[3,43],[-2,43],[-9,43],[-10,44]],
    // Asia
    [[30,52],[36,55],[42,56],[50,55],[58,55],[66,58],[74,60],[82,60],[92,62],[100,62],[110,60],[120,60],[128,56],[136,56],[142,60],[150,62],[156,62],[160,60],[155,56],[148,52],[142,50],[138,46],[133,44],[130,42],[126,40],[123,38],[122,32],[118,25],[112,22],[108,15],[104,10],[100,8],[100,14],[97,18],[93,22],[89,22],[87,20],[80,13],[77,8],[74,16],[70,22],[66,25],[62,25],[57,25],[52,26],[48,29],[45,36],[41,41],[36,42],[35,45],[30,45],[30,52]],
    // India tip refinement
    [[68,23],[72,20],[73,15],[77,8],[80,13],[82,17],[87,21],[80,22],[74,24],[68,23]],
    // Australia
    [[113,-22],[122,-18],[130,-12],[137,-12],[142,-11],[146,-18],[150,-24],[153,-28],[150,-34],[146,-38],[143,-39],[138,-35],[132,-32],[126,-32],[120,-34],[115,-34],[113,-26],[113,-22]],
    // Greenland
    [[-45,60],[-38,64],[-30,68],[-22,70],[-18,73],[-22,77],[-32,80],[-45,81],[-56,80],[-60,76],[-56,70],[-52,64],[-45,60]],
    // Britain
    [[-5,50],[-3,53],[-3,56],[-5,58],[-6,55],[-5,51],[-5,50]],
    // Madagascar
    [[44,-16],[50,-15],[50,-20],[47,-25],[44,-22],[44,-16]],
    // Japan
    [[130,31],[135,34],[140,36],[142,40],[140,43],[138,38],[133,34],[130,31]],
    // New Zealand
    [[167,-45],[171,-42],[174,-39],[178,-38],[174,-42],[170,-46],[167,-45]],
    // Antarctica hint (bottom rim)
    [[-160,-72],[-120,-74],[-60,-72],[0,-70],[60,-70],[120,-72],[160,-72]]
  ];

  // ── Real geographic data (Natural Earth via CDN) ──────────────────────
  // Loaded at runtime and decoded from TopoJSON with a tiny inline decoder
  // (no library). Until it arrives (or if it fails), we render the hand-drawn
  // LAND fallback above so the globe is never blank/broken.
  var GEO = {
    countries: null,   // array of polygons; each polygon = array of rings; ring = [[lon,lat],...]
    admin1: null,      // same shape, for US states (and any future admin-1)
    loading: false, loaded: false
  };
  var GEO_SOURCES = {
    countries: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
    admin1: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'
  };
  var GEO_CACHE_PREFIX = 'stw_geo_';
  var GEO_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  // Minimal TopoJSON → array-of-polygons decoder.
  // Returns [ [ring, ring...], ... ] with ring = [[lon,lat],...] in degrees.
  function topoToPolygons(topo, objectName) {
    if (!topo || !topo.objects || !topo.objects[objectName]) return null;
    var tf = topo.transform, sx = 1, sy = 1, tx = 0, ty = 0;
    if (tf) { sx = tf.scale[0]; sy = tf.scale[1]; tx = tf.translate[0]; ty = tf.translate[1]; }
    // Pre-decode every arc into absolute [lon,lat] point lists.
    var arcs = topo.arcs.map(function (arc) {
      var x = 0, y = 0, out = [];
      for (var i = 0; i < arc.length; i++) {
        x += arc[i][0]; y += arc[i][1];
        out.push(tf ? [x * sx + tx, y * sy + ty] : [x, y]);
      }
      return out;
    });
    function ringFor(arcIdxList) {
      var pts = [];
      for (var i = 0; i < arcIdxList.length; i++) {
        var idx = arcIdxList[i], rev = idx < 0, a = arcs[rev ? ~idx : idx];
        if (!a) continue;
        var seq = rev ? a.slice().reverse() : a;
        // Skip the duplicated shared endpoint when chaining arcs.
        for (var j = (i === 0 ? 0 : 1); j < seq.length; j++) pts.push(seq[j]);
      }
      return pts;
    }
    var geoms = topo.objects[objectName].geometries || [];
    var polys = [];
    geoms.forEach(function (g) {
      if (g.type === 'Polygon') {
        polys.push(g.arcs.map(ringFor));
      } else if (g.type === 'MultiPolygon') {
        g.arcs.forEach(function (poly) { polys.push(poly.map(ringFor)); });
      }
    });
    return polys;
  }

  function loadGeoLayer(key, onReady) {
    // Try cache first.
    try {
      var raw = localStorage.getItem(GEO_CACHE_PREFIX + key);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.ts && (Date.now() - c.ts) < GEO_TTL && c.topo) {
          var polys = topoToPolygons(c.topo, key === 'admin1' ? 'states' : 'countries');
          if (polys && polys.length) { onReady(polys); return; }
        }
      }
    } catch (e) {}
    // Fetch fresh (best-effort).
    fetch(GEO_SOURCES[key], { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (topo) {
        var objName = key === 'admin1' ? 'states' : 'countries';
        var polys = topoToPolygons(topo, objName);
        if (polys && polys.length) {
          try { localStorage.setItem(GEO_CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), topo: topo })); } catch (e) {}
          onReady(polys);
        }
      })
      .catch(function () { /* stay on fallback */ });
  }

  function loadGeo() {
    if (GEO.loading || GEO.loaded) return;
    GEO.loading = true;
    // The globe's animation loop (tick) repaints every frame, so simply
    // populating GEO.countries / GEO.admin1 makes the real borders appear.
    loadGeoLayer('countries', function (polys) { GEO.countries = polys; GEO.loaded = true; });
    loadGeoLayer('admin1', function (polys) { GEO.admin1 = polys; });
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : s); return d.innerHTML; }

  function setCounters(n) {
    document.querySelectorAll('.js-countries-count').forEach(function (el) { el.textContent = String(n); });
    document.querySelectorAll('.js-countries-word').forEach(function (el) { el.textContent = (n === 1 ? 'Country' : 'Countries'); });
  }

  // ── Globe engine ── spin (lon) + pivot (lat) + zoom (wheel/pinch), quality.
  function Globe(canvas, markers, cityMarkers) {
    var ctx = canvas.getContext('2d');
    var rot = 0.3;          // longitude rotation (radians)
    var pivot = 18 * Math.PI / 180; // latitude tilt (radians); + tips north up
    var PIVOT_MAX = 78 * Math.PI / 180;
    var zoom = 1;           // 1 = full globe; up to ZOOM_MAX zoomed in
    var ZOOM_MIN = 1, ZOOM_MAX = 8;
    var ADMIN1_ZOOM = 2.4;  // above this, US state/province borders fade in
    var CITY_ZOOM = 3.2;    // above this, city pins appear + country pins shrink
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    var dragging = false, lastX = 0, lastY = 0, autoRot = true, raf = null;
    var baseR = 0, R = 0, cx = 0, cy = 0;
    var pinchDist = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var size = Math.max(160, Math.min(rect.width, rect.height || rect.width));
      canvas.width = size * dpr; canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      baseR = size * 0.42; cx = size / 2; cy = size / 2;
      R = baseR * zoom;
    }

    function setZoom(z) {
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
      R = baseR * zoom;
    }

    // Project lon/lat → screen. Spin around Y, then pivot around X. Scaled by zoom.
    function project(lon, lat) {
      var la = lat * Math.PI / 180;
      var lo = lon * Math.PI / 180 + rot;
      var x = Math.cos(la) * Math.sin(lo);
      var y = Math.sin(la);
      var z = Math.cos(la) * Math.cos(lo);
      var y2 = y * Math.cos(pivot) - z * Math.sin(pivot);
      var z2 = y * Math.sin(pivot) + z * Math.cos(pivot);
      return { x: cx + R * x, y: cy - R * y2, visible: z2 >= 0, z: z2 };
    }

    // Draw a lon/lat polyline, splitting into segments across the horizon.
    function drawPath(pts, closed) {
      var pen = false;
      for (var i = 0; i < pts.length; i++) {
        var p = project(pts[i][0], pts[i][1]);
        if (p.visible) { if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y); }
        else pen = false;
      }
    }

    function draw() {
      var size = canvas.width / dpr;
      ctx.clearRect(0, 0, size, size);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      // Atmosphere glow behind the sphere.
      var atm = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.18);
      atm.addColorStop(0, 'rgba(120,170,220,0.35)');
      atm.addColorStop(1, 'rgba(120,170,220,0)');
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2); ctx.fillStyle = atm; ctx.fill();

      // Ocean sphere with day-side lighting (light from upper-left).
      var grd = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.15, cx, cy, R);
      grd.addColorStop(0, '#5b93c9');
      grd.addColorStop(0.55, '#2f6198');
      grd.addColorStop(1, '#123253');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grd; ctx.fill();
      // clip everything else to the sphere for clean edges.
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

      // Graticule (finer).
      ctx.globalAlpha = 0.16; ctx.strokeStyle = '#dbe8f5'; ctx.lineWidth = 0.6;
      for (var lat = -60; lat <= 60; lat += 20) {
        ctx.beginPath(); var first = true;
        for (var lon = -180; lon <= 180; lon += 3) { var p = project(lon, lat); if (p.visible) { if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); } else first = true; }
        ctx.stroke();
      }
      for (var lon2 = -180; lon2 < 180; lon2 += 20) {
        ctx.beginPath(); var first2 = true;
        for (var la2 = -90; la2 <= 90; la2 += 3) { var p2 = project(lon2, la2); if (p2.visible) { if (first2) { ctx.moveTo(p2.x, p2.y); first2 = false; } else ctx.lineTo(p2.x, p2.y); } else first2 = true; }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Land — real country polygons when loaded, else hand-drawn fallback.
      var land = ctx.createLinearGradient(0, cy - R, 0, cy + R);
      land.addColorStop(0, '#4c9a52'); land.addColorStop(1, '#357a3b');
      // When zoomed out, thin every Nth vertex for speed; full detail when close.
      var step = zoom < 1.4 ? 3 : (zoom < 3 ? 2 : 1);

      function drawRing(ring, st) {
        var pen = false;
        for (var k = 0; k < ring.length; k += st) {
          var pt = ring[k]; var p = project(pt[0], pt[1]);
          if (p.visible) { if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y); }
          else pen = false;
        }
      }

      if (GEO.countries) {
        for (var i = 0; i < GEO.countries.length; i++) {
          var poly = GEO.countries[i];
          ctx.beginPath();
          for (var r = 0; r < poly.length; r++) drawRing(poly[r], step);
          ctx.fillStyle = land; ctx.fill('evenodd');
          ctx.strokeStyle = 'rgba(18,46,20,0.55)'; ctx.lineWidth = 0.7; ctx.stroke();
        }
      } else {
        for (var f = 0; f < LAND.length; f++) {
          ctx.beginPath(); drawPath(LAND[f], true);
          ctx.fillStyle = land; ctx.fill();
          ctx.strokeStyle = 'rgba(20,50,22,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }

      // Admin-1 (state/province) borders fade in as you zoom past the threshold.
      if (GEO.admin1 && zoom >= ADMIN1_ZOOM) {
        var a1alpha = Math.min(0.6, (zoom - ADMIN1_ZOOM) / 1.5 * 0.6);
        ctx.save(); ctx.globalAlpha = a1alpha;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.6;
        for (var s = 0; s < GEO.admin1.length; s++) {
          var spoly = GEO.admin1[s];
          ctx.beginPath();
          for (var sr = 0; sr < spoly.length; sr++) drawRing(spoly[sr], zoom < 4 ? 2 : 1);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore(); // unclip

      var zoomedIn = zoom >= CITY_ZOOM;

      function drawPin(p, r, fill, label) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(224,184,78,0.28)'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke();
        if (label) {
          ctx.font = '600 11px "Source Sans 3", system-ui, sans-serif';
          var w = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(p.x - w / 2 - 4, p.y - r - 18, w + 8, 14);
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
          ctx.fillText(label, p.x, p.y - r - 7);
          ctx.textAlign = 'left';
        }
      }

      // Country markers — full size zoomed out; smaller once cities show.
      (markers || []).forEach(function (m) {
        var p = project(m.lon, m.lat);
        if (!p.visible) return;
        drawPin(p, zoomedIn ? 3.5 : 5, '#e8c14f', zoomedIn ? '' : (zoom > 1.3 ? m.name : ''));
      });

      // City markers — only appear when zoomed in past the threshold.
      if (zoomedIn) {
        (cityMarkers || []).forEach(function (m) {
          var p = project(m.lon, m.lat);
          if (!p.visible) return;
          drawPin(p, 4.5, '#d97736', m.name);
        });
      }

      // Soft shadow/terminator on the lower-right for depth.
      var sh = ctx.createRadialGradient(cx + R * 0.5, cy + R * 0.55, R * 0.2, cx, cy, R);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(4,14,28,0.5)');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = sh; ctx.fill();
      // Rim light.
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.4; ctx.stroke();
    }

    function tick() {
      // Auto-rotate only when at (near) full-globe view; when zoomed in the
      // user is inspecting a region, so hold still.
      if (autoRot && !dragging && zoom < 1.15) rot += 0.0020;
      draw();
      raf = requestAnimationFrame(tick);
    }

    function ptXY(e) { return e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }; }
    function onDown(e) {
      // Two-finger touch → start a pinch, not a drag.
      if (e.touches && e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist = Math.sqrt(dx * dx + dy * dy);
        dragging = false; autoRot = false; return;
      }
      dragging = true; autoRot = false; var q = ptXY(e); lastX = q.x; lastY = q.y;
    }
    function onMove(e) {
      // Pinch-zoom.
      if (e.touches && e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (pinchDist) setZoom(zoom * (d / pinchDist));
        pinchDist = d;
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (!dragging) return;
      var q = ptXY(e);
      rot += (q.x - lastX) * 0.008 / Math.max(1, zoom * 0.7); // finer control when zoomed
      pivot += (q.y - lastY) * 0.006 / Math.max(1, zoom * 0.7);
      if (pivot > PIVOT_MAX) pivot = PIVOT_MAX;
      if (pivot < -PIVOT_MAX) pivot = -PIVOT_MAX;
      lastX = q.x; lastY = q.y;
      if (e.cancelable) e.preventDefault();
    }
    function onUp() { dragging = false; pinchDist = 0; setTimeout(function () { autoRot = true; }, 3000); }
    function onWheel(e) {
      autoRot = false;
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 0.89));
      e.preventDefault();
      clearTimeout(onWheel._t); onWheel._t = setTimeout(function () { autoRot = true; }, 3000);
    }

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: true });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', resize);

    loadGeo(); // kick off real-border data load (best-effort; tick() repaints when ready)
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

  // City markers (appear on zoom-in). Geocoded by name via CITY_LATLON; cities
  // not in the table are skipped until added there.
  function cityMarkersFor(cities) {
    return (cities || []).map(function (c) {
      var ll = CITY_LATLON[String(c.name || '').toLowerCase().trim()];
      return ll ? { lon: ll[0], lat: ll[1], name: c.name } : null;
    }).filter(Boolean);
  }

  function renderReach(container, data) {
    var countries = data.countries || [];
    var states = data.states || [];
    var cities = data.cities || [];
    var n = (typeof data.countriesCount === 'number') ? data.countriesCount : countries.length;
    var mode = container.getAttribute('data-reach-mode') || '';
    var compact = mode === 'compact';
    var globeOnly = mode === 'globe-only';

    function chips(arr) {
      if (!arr.length) return '<span class="reach-empty">—</span>';
      return arr.map(function (x) { return '<span class="reach-chip">' + esc(x.name) + '</span>'; }).join('');
    }

    var globeBlock =
      '<div class="reach-globe">' +
        '<canvas class="reach-globe__canvas" aria-label="Interactive globe showing where Bibles have been sent"></canvas>' +
        '<div class="reach-globe__hint">Drag to spin &amp; tilt · scroll / pinch to zoom — borders &amp; cities reveal as you go 🌍</div>' +
      '</div>';

    var counterInline =
      '<div class="reach__stat reach__stat--inline"><span class="reach__stat-num js-countries-count">' + n + '</span>' +
      '<span class="reach__stat-label"><span class="js-countries-word">' + (n === 1 ? 'Country' : 'Countries') + '</span> Reached</span></div>';

    if (globeOnly) {
      // Just the globe — the surrounding page provides its own counts/labels.
      container.innerHTML = '<div class="reach reach--globe-only">' + globeBlock + '</div>';
    } else if (compact) {
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
      globeInstance = Globe(canvas, markersFor(countries), cityMarkersFor(cities));
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
