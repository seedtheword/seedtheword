/* Seed the Word — Outreach Reach map + "countries reached" counter.
 * Self-contained, no dependencies. Fetches published outreach locations from
 * the Apps Script backend (?action=getOutreachLocations), renders a lightweight
 * schematic world map with pins on countries we've reached, grouped lists of
 * countries / states / cities, and updates any country-count elements on the page.
 *
 * USAGE
 *   Counter only (news/store/home): add an element with class "js-countries-count".
 *     It gets the number of countries reached (falls back to site-config
 *     `outreachCountries`, then to the seeded 3).
 *   Full reach section: add a container <div id="outreach-reach"></div> and this
 *     script fills it (map + lists). If absent, only counters update.
 *
 * Presence-only (no per-location numbers), per ministry request.
 */
(function () {
  var CACHE_KEY = 'stw_outreach_locations';
  var TTL = 5 * 60 * 1000; // 5 min
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
      { name: 'Seattle', region: 'Washington', iso2: '' },
      { name: 'Bellevue', region: 'Washington', iso2: '' },
      { name: 'Lynnwood', region: 'Washington', iso2: '' },
      { name: 'Everett', region: 'Washington', iso2: '' },
      { name: 'Mukilteo', region: 'Washington', iso2: '' },
      { name: 'Federal Way', region: 'Washington', iso2: '' }
    ],
    countriesCount: 3
  };

  // Approx. lon/lat → percentage position on the schematic world map (equirectangular).
  // Only needs the countries we actually reach; more can be added over time.
  var COUNTRY_POINT = {
    US: { x: 20, y: 40, label: 'United States' },
    SR: { x: 33, y: 58, label: 'Suriname' },
    PK: { x: 67, y: 42, label: 'Pakistan' },
    CA: { x: 21, y: 30 }, MX: { x: 18, y: 48 }, BR: { x: 36, y: 62 },
    GB: { x: 48, y: 33 }, IN: { x: 70, y: 47 }, PH: { x: 83, y: 55 },
    NG: { x: 51, y: 55 }, KE: { x: 57, y: 58 }, ID: { x: 82, y: 62 },
    AU: { x: 85, y: 74 }, UA: { x: 55, y: 34 }, RU: { x: 65, y: 28 }
  };

  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : s); return d.innerHTML; }

  function setCounters(n) {
    document.querySelectorAll('.js-countries-count').forEach(function (el) {
      el.textContent = String(n);
    });
    // Optional label pluralization for elements marked with data-count-word.
    document.querySelectorAll('.js-countries-word').forEach(function (el) {
      el.textContent = (n === 1 ? 'Country' : 'Countries');
    });
  }

  // A soft schematic world silhouette (very lightweight, decorative) so pins
  // have something to sit on without shipping a full GeoJSON map.
  var WORLD_SVG =
    '<svg viewBox="0 0 100 62" preserveAspectRatio="xMidYMid meet" class="reach-map__svg" aria-hidden="true">' +
      '<defs><linearGradient id="reachSea" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#f3efe6"/><stop offset="100%" stop-color="#ece6da"/></linearGradient></defs>' +
      '<rect x="0" y="0" width="100" height="62" fill="url(#reachSea)"/>' +
      // Continents as soft blobs (approximate, decorative only).
      '<g fill="#d8cfbd" opacity="0.9">' +
        '<path d="M8,20 Q14,12 24,16 Q30,22 26,34 Q22,46 14,44 Q6,38 6,30 Z"/>' + // N. America
        '<path d="M28,50 Q34,46 36,54 Q38,64 32,66 Q26,62 28,50 Z"/>' + // S. America
        '<path d="M46,26 Q52,22 56,28 Q54,34 50,34 Q46,32 46,26 Z"/>' + // Europe
        '<path d="M48,38 Q56,34 58,46 Q56,58 50,58 Q46,48 48,38 Z"/>' + // Africa
        '<path d="M60,24 Q74,18 84,26 Q86,40 74,44 Q64,42 60,34 Z"/>' + // Asia
        '<path d="M80,64 Q86,60 90,66 Q88,72 82,70 Q79,68 80,64 Z"/>' + // Australia
      '</g>' +
    '</svg>';

  function renderReach(container, data) {
    var countries = data.countries || [];
    var states = data.states || [];
    var cities = data.cities || [];
    var n = (typeof data.countriesCount === 'number') ? data.countriesCount : countries.length;

    // Pins for countries with a known point.
    var pins = countries.map(function (c) {
      var pt = COUNTRY_POINT[String(c.iso2 || '').toUpperCase()];
      if (!pt) return '';
      return '<span class="reach-map__pin" style="left:' + pt.x + '%;top:' + pt.y + '%;" title="' + esc(c.name) + '">' +
        '<span class="reach-map__pin-dot"></span><span class="reach-map__pin-label">' + esc(c.name) + '</span></span>';
    }).join('');

    function chips(arr) {
      if (!arr.length) return '<span class="reach-empty">—</span>';
      return arr.map(function (x) { return '<span class="reach-chip">' + esc(x.name) + '</span>'; }).join('');
    }

    container.innerHTML =
      '<div class="reach">' +
        '<div class="reach__head">' +
          '<div class="reach__eyebrow">Our Reach</div>' +
          '<h2 class="reach__title">Where We\'ve Sent Bibles</h2>' +
          '<p class="reach__sub">From our home base in Washington State to communities around the world — every location is a life God placed in our path.</p>' +
        '</div>' +
        '<div class="reach__stat"><span class="reach__stat-num js-countries-count">' + n + '</span>' +
          '<span class="reach__stat-label"><span class="js-countries-word">' + (n === 1 ? 'Country' : 'Countries') + '</span> Reached</span></div>' +
        '<div class="reach-map">' + WORLD_SVG + pins + '</div>' +
        '<div class="reach-lists">' +
          '<div class="reach-list"><h3 class="reach-list__label">🌍 Countries</h3><div class="reach-chips">' + chips(countries) + '</div></div>' +
          '<div class="reach-list"><h3 class="reach-list__label">🏳️ States</h3><div class="reach-chips">' + chips(states) + '</div></div>' +
          '<div class="reach-list"><h3 class="reach-list__label">📍 Washington cities</h3><div class="reach-chips">' + chips(cities) + '</div></div>' +
        '</div>' +
      '</div>';
  }

  function apply(data) {
    var n = (typeof data.countriesCount === 'number') ? data.countriesCount : (data.countries || []).length;
    setCounters(n);
    var container = document.getElementById('outreach-reach');
    if (container) renderReach(container, data);
  }

  async function load() {
    // 1) paint from cache/fallback immediately so counters/map never sit empty.
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}
    if (cached && cached.data) apply(cached.data);
    else apply(FALLBACK);

    // 2) resolve the backend URL from site-config, then fetch live (best-effort).
    var url = '';
    try {
      var cfg = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
      url = cfg.orderHandlerUrl || '';
      // If the counter still shows fallback and config has an override, honor it.
      if (!cached && typeof cfg.outreachCountries === 'number') setCounters(cfg.outreachCountries);
    } catch (e) {}
    if (!url) return;

    // Respect TTL to avoid hammering the backend.
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
