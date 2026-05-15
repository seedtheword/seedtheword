/* ============================================================
   Store Bundle Journey — store.html stepwise reveal runtime
   Spec: .kiro/specs/store-bundle-journey/
   Layered: .kiro/specs/bundle-customization-tiers/

   Reads its item catalog from window.STW_ITEM_CATALOG (loaded
   by bundle-item-catalog.js BEFORE this file).
   ============================================================ */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────
  var STORAGE_KEY = 'stw.bundleJourney.v1';
  var BUNDLE_KEYS = ['essentials', 'lifegroup', 'ministry'];
  var BUNDLE_DISPLAY = {
    essentials: 'Essentials Welcome',
    lifegroup:  'Life Group Starter',
    ministry:   'Ministry Calling'
  };

  var COVER_THEMES = [
    { key: 'cream', label: 'Cream' },
    { key: 'kraft', label: 'Kraft' },
    { key: 'green', label: 'Ministry green' },
    { key: 'none',  label: 'No theme' }
  ];
  var COVER_THEME_KEYS = COVER_THEMES.map(function (c) { return c.key; });

  var ANCHOR_VERSES = [
    { key: 'psalm-119-105',     display: 'Psalm 119:105',     text: '"Thy word is a lamp unto my feet, and a light unto my path."' },
    { key: 'matthew-16-24',     display: 'Matthew 16:24',     text: '"If anyone would come after me, let him deny himself and take up his cross and follow me."' },
    { key: 'philippians-4-6-8', display: 'Philippians 4:6-8', text: '"Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God."' },
    { key: '1-timothy-1-5',     display: '1 Timothy 1:5',     text: '"The aim of our charge is love that issues from a pure heart and a good conscience and a sincere faith."' },
    { key: 'john-17-3',         display: 'John 17:3',         text: '"And this is eternal life, that they know you, the only true God, and Jesus Christ whom you have sent."' }
  ];
  var ANCHOR_VERSE_KEYS = ANCHOR_VERSES.map(function (v) { return v.key; }).concat(['none']);

  var MINISTRY_TIERS = [25, 50, 100, 200];
  var MINISTRY_CUSTOM_MIN = 25;
  var MINISTRY_CUSTOM_MAX = 200;

  // Section heading labels (mirror catalog `groupingSection`).
  var SECTION_HEADING = {
    bible:     'On the Bible itself',
    inside:    'Inside the Bible',
    kit:       'Companion kit',
    guides:    'Guides & QR cards',
    packaging: 'Packaging',
    outreach:  'Outreach materials'
  };

  // Items that need a free-text "describe what you'd like" prompt
  // when toggled on. Keys are catalog item keys.
  var CUSTOM_DETAIL_KEYS = [
    'engraving', 'cover-painting', 'edge-spray-painting',
    'verse-highlighting', 'pressed-flowers', 'dedication-page',
    'study-notes', 'packaging-burlap', 'packaging-gift-box'
  ];

  function customDetailPlaceholder(key) {
    switch (key) {
      case 'engraving':            return 'e.g. "Sarah Johnson — John 3:16"';
      case 'cover-painting':       return 'e.g. "watercolor sunflowers across the cover"';
      case 'edge-spray-painting':  return 'e.g. "ocean teal with Psalm 23 along the bottom"';
      case 'verse-highlighting':   return 'List the verses you\'d like marked, e.g. "John 3:16, Romans 8:28, Psalm 23"';
      case 'pressed-flowers':      return 'e.g. "a small lavender sprig near Psalm 23"';
      case 'dedication-page':      return 'e.g. "To Sarah on her baptism, May 2026 — From the STW Tuesday group"';
      case 'study-notes':          return 'Which passages would you like notes on?';
      case 'packaging-burlap':     return 'e.g. "monogram embroidered in cream thread"';
      case 'packaging-gift-box':   return 'e.g. "kraft box with a green ribbon and pressed leaf"';
      default:                     return 'Anything specific you\'d like us to know?';
    }
  }

  // ── Catalog access (defensive — fall back if not loaded) ─────
  function CATALOG() {
    return Array.isArray(window.STW_ITEM_CATALOG) ? window.STW_ITEM_CATALOG : [];
  }
  function findItem(key) {
    return (window.STW_findItem && window.STW_findItem(key)) || null;
  }
  function filterByScope(bundleKey) {
    if (window.STW_filterByScope) return window.STW_filterByScope(bundleKey);
    return CATALOG().filter(function (i) { return i.bundleScope.indexOf(bundleKey) !== -1; });
  }
  function groupBySection(items) {
    if (window.STW_groupBySection) return window.STW_groupBySection(items);
    var out = {};
    items.forEach(function (it) {
      if (!out[it.groupingSection]) out[it.groupingSection] = [];
      out[it.groupingSection].push(it);
    });
    return out;
  }
  function isKnownKey(k) { return !!findItem(k); }

  // ── State ───────────────────────────────────────────────────
  var state = blankState();
  var furthestStepIndex = 0;
  var journeyRoot = null;
  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function blankState() { return { bundle: null }; }

  // Build the initial selected-items array for Essentials: every item
  // with groupingSection 'kit' and bundleScope 'essentials' is on by
  // default (the "full kit" experience). The pocket-NT label is
  // implicit (catalog doesn't have a separate pocket-nt entry — it's
  // baked in as "always included" via UI copy).
  function defaultEssentialsKit() {
    return filterByScope('essentials')
      .filter(function (it) { return it.groupingSection === 'kit' && it.tier === 'standard'; })
      .map(function (it) { return it.key; });
  }

  function defaultStateForBundle(key) {
    if (key === 'essentials') {
      return {
        bundle: 'essentials',
        recipient: null,
        essentialsItems: defaultEssentialsKit(),
        personalization: [],
        packaging: [],
        guides: [],
        customDetails: {},
        signOptOut: false
      };
    }
    if (key === 'lifegroup') {
      return {
        bundle: 'lifegroup',
        quantity: null,
        perBibleNames: [],
        groupIdentity: { groupName: '', coverTheme: 'none' },
        essentialsAddOns: [],
        personalization: [],
        packaging: [],
        guides: [],
        customDetails: {},
        signOptOut: false
      };
    }
    if (key === 'ministry') {
      return {
        bundle: 'ministry',
        volumeTier: null,
        customQuantity: null,
        outreach: { eventName: '', location: '', eventDate: '', anchorVerse: 'none' },
        addOns: [],
        guides: []
      };
    }
    return blankState();
  }

  function loadState() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!validateConfig(parsed)) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function saveState() {
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function clearState() {
    state = blankState();
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ── Helpers ─────────────────────────────────────────────────
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isStringArray(arr) {
    if (!Array.isArray(arr)) return false;
    for (var i = 0; i < arr.length; i++) if (typeof arr[i] !== 'string') return false;
    return true;
  }

  // Validation is additive — missing new fields get defaults at
  // hydration time. Unknown catalog keys are filtered out (with a
  // console warning) rather than rejecting the whole config.
  function validateConfig(c) {
    if (!c || typeof c !== 'object') return false;
    if (BUNDLE_KEYS.indexOf(c.bundle) === -1) return c.bundle === null;
    if (c.bundle === 'essentials') {
      if (c.recipient !== null && ['self','friend','newcomer'].indexOf(c.recipient) === -1) return false;
      if (!isStringArray(c.essentialsItems)) return false;
      if (!isStringArray(c.personalization)) return false;
      if (c.packaging !== undefined && !isStringArray(c.packaging)) return false;
      if (c.guides !== undefined && !isStringArray(c.guides)) return false;
      if (c.customDetails !== undefined && (c.customDetails === null || typeof c.customDetails !== 'object')) return false;
      if (c.signOptOut !== undefined && typeof c.signOptOut !== 'boolean') return false;
      filterUnknownKeys(c, ['essentialsItems','personalization','packaging','guides']);
      return true;
    }
    if (c.bundle === 'lifegroup') {
      if (c.quantity !== null && [2,3,4,5].indexOf(c.quantity) === -1) return false;
      if (c.quantity !== null && (!Array.isArray(c.perBibleNames) || c.perBibleNames.length !== c.quantity)) return false;
      if (Array.isArray(c.perBibleNames)) {
        for (var i = 0; i < c.perBibleNames.length; i++) {
          if (typeof c.perBibleNames[i] !== 'string') return false;
        }
      }
      if (!c.groupIdentity || typeof c.groupIdentity !== 'object') return false;
      if (typeof c.groupIdentity.groupName !== 'string' || c.groupIdentity.groupName.length > 40) return false;
      if (COVER_THEME_KEYS.indexOf(c.groupIdentity.coverTheme) === -1) return false;
      if (!isStringArray(c.essentialsAddOns)) return false;
      if (c.personalization !== undefined && !isStringArray(c.personalization)) return false;
      if (c.packaging !== undefined && !isStringArray(c.packaging)) return false;
      if (c.guides !== undefined && !isStringArray(c.guides)) return false;
      if (c.customDetails !== undefined && (c.customDetails === null || typeof c.customDetails !== 'object')) return false;
      if (c.signOptOut !== undefined && typeof c.signOptOut !== 'boolean') return false;
      filterUnknownKeys(c, ['essentialsAddOns','personalization','packaging','guides']);
      return true;
    }
    if (c.bundle === 'ministry') {
      var validTiers = MINISTRY_TIERS.concat(['custom']);
      if (c.volumeTier !== null && validTiers.indexOf(c.volumeTier) === -1) return false;
      if (c.volumeTier === 'custom') {
        if (typeof c.customQuantity !== 'number' || c.customQuantity < MINISTRY_CUSTOM_MIN || c.customQuantity > MINISTRY_CUSTOM_MAX) return false;
      }
      if (!c.outreach || typeof c.outreach !== 'object') return false;
      if (typeof c.outreach.eventName !== 'string' || c.outreach.eventName.length > 60) return false;
      if (typeof c.outreach.location !== 'string') return false;
      if (typeof c.outreach.eventDate !== 'string') return false;
      if (ANCHOR_VERSE_KEYS.indexOf(c.outreach.anchorVerse) === -1) return false;
      if (!isStringArray(c.addOns)) return false;
      if (c.guides !== undefined && !isStringArray(c.guides)) return false;
      filterUnknownKeys(c, ['addOns','guides']);
      return true;
    }
    return false;
  }

  function filterUnknownKeys(c, fields) {
    fields.forEach(function (f) {
      if (!Array.isArray(c[f])) return;
      var before = c[f].length;
      c[f] = c[f].filter(function (k) {
        var ok = isKnownKey(k);
        if (!ok) console.warn('[bundle-journey] dropping unknown catalog key from state.' + f + ':', k);
        return ok;
      });
      if (c[f].length !== before) saveState();
    });
  }

  function encodePayload(s) { return btoa(encodeURIComponent(JSON.stringify(s))); }

  // ── DOM utilities ────────────────────────────────────────────
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function makePickCard(title, sub, isSelected, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'journey-pick' + (isSelected ? ' journey-pick--selected' : '');
    b.innerHTML = '<span class="journey-pick__title">' + escapeHtml(title) + '</span>' +
                  (sub ? '<span class="journey-pick__sub">' + escapeHtml(sub) + '</span>' : '');
    b.addEventListener('click', onClick);
    return b;
  }
  function makeContinueRow(opts) {
    var row = document.createElement('div');
    row.className = 'journey-actions';
    var primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'btn btn-gold';
    primary.textContent = opts.primaryLabel || 'Continue →';
    primary.addEventListener('click', opts.onPrimary);
    row.appendChild(primary);
    if (opts.skipLabel) {
      var skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'journey-skip';
      skip.textContent = opts.skipLabel;
      skip.addEventListener('click', opts.onSkip || opts.onPrimary);
      row.appendChild(skip);
    }
    return row;
  }
  function showInlineError(body, msg) {
    var existing = body.querySelector('.journey-notice--error');
    if (existing) existing.remove();
    var n = el('<p class="journey-notice journey-notice--error">' + escapeHtml(msg) + '</p>');
    body.appendChild(n);
  }

  // ── Tiered pill row (pill + info-icon + tooltip) ────────────
  // Returns the wrapping <span class="journey-pill-row"> element.
  // The tier comes from the catalog item; the toggle state is read
  // from the membership in `chosenArr`. Clicking the pill calls
  // `onToggle` with the item key; clicking the info icon toggles
  // its tooltip.
  function makeTieredPillRow(item, isOn, onToggle) {
    var row = document.createElement('span');
    row.className = 'journey-pill-row';

    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'journey-pill' + (isOn ? ' journey-pill--on' : '');
    pill.setAttribute('data-tier', item.tier);
    pill.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    pill.setAttribute('aria-describedby', 'info-' + item.key);
    if (item.madeToOrder) {
      pill.innerHTML = escapeHtml(item.label) +
        ' <span style="display:inline-block;margin-left:0.4rem;padding:1px 6px;border-radius:999px;background:rgba(212,165,116,0.25);color:#7a5a2a;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">made-to-order</span>';
    } else {
      pill.textContent = item.label;
    }
    pill.addEventListener('click', function () { onToggle(item.key, pill); });
    row.appendChild(pill);

    var info = document.createElement('button');
    info.type = 'button';
    info.className = 'info-icon';
    info.setAttribute('aria-label', 'What is ' + item.label + '?');
    info.setAttribute('aria-expanded', 'false');
    info.setAttribute('aria-controls', 'info-' + item.key);
    info.textContent = 'i';
    row.appendChild(info);

    var tooltip = document.createElement('span');
    tooltip.id = 'info-' + item.key;
    tooltip.className = 'info-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    tooltip.textContent = item.description || item.label;
    row.appendChild(tooltip);

    info.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = info.getAttribute('aria-expanded') === 'true';
      info.setAttribute('aria-expanded', open ? 'false' : 'true');
      tooltip.hidden = open;
    });

    return row;
  }

  // ── Section renderer ────────────────────────────────────────
  // Renders one grouping section: a heading, recommended/standard
  // pills first, then a single collapsed <details> card holding all
  // special-tier items for that section. Returns the section's
  // root element so callers can post-process if needed.
  function renderGroupingSection(opts) {
    // opts: { section, items, chosenArr, onToggle, body }
    var section = opts.section;
    var items = opts.items;
    var chosenArr = opts.chosenArr;
    var onToggle = opts.onToggle;
    var body = opts.body;
    if (!items || !items.length) return null;

    var heading = SECTION_HEADING[section] || section;
    body.appendChild(el('<h3 class="journey-subhead">' + escapeHtml(heading) + '</h3>'));

    var recommended = items.filter(function (i) { return i.tier === 'recommended'; });
    var standard    = items.filter(function (i) { return i.tier === 'standard'; });
    var special     = items.filter(function (i) { return i.tier === 'special'; });

    // Recommended + Standard live in a single .journey-pills row.
    if (recommended.length || standard.length) {
      var pills = document.createElement('div');
      pills.className = 'journey-pills';
      recommended.concat(standard).forEach(function (item) {
        var on = chosenArr.indexOf(item.key) !== -1;
        pills.appendChild(makeTieredPillRow(item, on, onToggle));
      });
      body.appendChild(pills);
    }

    // Special-order items live inside a collapsed <details> card,
    // one card per section. Pre-open the card if any contained item
    // is currently chosen.
    if (special.length) {
      var anyChosen = special.some(function (it) { return chosenArr.indexOf(it.key) !== -1; });
      var details = document.createElement('details');
      details.className = 'journey-special-card';
      if (anyChosen) details.open = true;
      details.innerHTML =
        '<summary class="journey-special-card__summary">' +
          '<span class="journey-special-card__icon" aria-hidden="true">🛎</span>' +
          '<span class="journey-special-card__title">Special-order options</span>' +
          '<span class="journey-special-card__hint">— talk with our team</span>' +
          '<span class="journey-special-card__chevron" aria-hidden="true">▾</span>' +
        '</summary>' +
        '<div class="journey-special-card__body">' +
          '<p class="journey-special-card__warn">' +
            'Picking any of these means we\'ll reach out before any work starts — no rush, no commitment yet.' +
          '</p>' +
          '<div class="journey-pills" data-special-pills></div>' +
        '</div>';
      var spillsRow = details.querySelector('[data-special-pills]');
      special.forEach(function (item) {
        var on = chosenArr.indexOf(item.key) !== -1;
        spillsRow.appendChild(makeTieredPillRow(item, on, function (key, btn) {
          onToggle(key, btn);
          // Auto-stay-open: if any special-tier pill is now pressed,
          // keep the details open. If all are unpressed, leave the
          // user's current open/closed state as-is (don't slam it
          // closed when they're mid-deselect).
          var anyOnNow = special.some(function (it) { return chosenArr.indexOf(it.key) !== -1; });
          if (anyOnNow) details.open = true;
        }));
      });
      body.appendChild(details);
    }

    return null;
  }

  // ── Custom-detail textareas ─────────────────────────────────
  // Render an inline textarea for each chosen item key whose key is
  // in CUSTOM_DETAIL_KEYS, so the gifter can describe what they'd
  // like. Values write to state.customDetails.
  function renderCustomDetailTextareas(body, chosenKeys, scopedToSection) {
    if (!state.customDetails) state.customDetails = {};
    var needsDetail = chosenKeys.filter(function (k) {
      if (CUSTOM_DETAIL_KEYS.indexOf(k) === -1) return false;
      if (scopedToSection) {
        var item = findItem(k);
        return item && item.groupingSection === scopedToSection;
      }
      return true;
    });
    if (!needsDetail.length) return;

    var wrap = document.createElement('div');
    wrap.style.marginTop = '1rem';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '0.7rem';
    needsDetail.forEach(function (key) {
      var def = findItem(key);
      if (!def) return;
      var row = document.createElement('div');
      var lbl = document.createElement('label');
      lbl.className = 'journey-field-label';
      lbl.htmlFor = 'jrn-detail-' + key;
      lbl.textContent = def.label + ' — describe what you\'d like';
      var ta = document.createElement('textarea');
      ta.id = 'jrn-detail-' + key;
      ta.className = 'journey-textarea';
      ta.placeholder = customDetailPlaceholder(key);
      ta.maxLength = 400;
      ta.value = state.customDetails[key] || '';
      ta.addEventListener('input', function () {
        if (!state.customDetails) state.customDetails = {};
        state.customDetails[key] = ta.value;
        saveState();
      });
      row.appendChild(lbl);
      row.appendChild(ta);
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  }

  // ── Guides cards (3 named cards, not pills) ─────────────────
  function renderGuidesSection(body, items, chosenArr, onToggle) {
    if (!items.length) return;
    body.appendChild(el('<h3 class="journey-subhead">' + escapeHtml(SECTION_HEADING.guides) + '</h3>'));
    var row = document.createElement('div');
    row.className = 'journey-guides-row';
    items.forEach(function (item) {
      var on = chosenArr.indexOf(item.key) !== -1;
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'journey-guide-card';
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.setAttribute('data-key', item.key);
      var icon = item.key.indexOf('audio') !== -1 ? '🎧' :
                 item.key.indexOf('lifegroup') !== -1 ? '🤝' : '📱';
      card.innerHTML =
        '<span class="journey-guide-card__icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="journey-guide-card__title">' + escapeHtml(item.label) + '</span>' +
        '<span class="journey-guide-card__desc">' + escapeHtml(item.description || '') + '</span>';
      card.addEventListener('click', function () { onToggle(item.key, card); });
      row.appendChild(card);
    });
    body.appendChild(row);
  }

  // ── Sign-opt-out toggle ─────────────────────────────────────
  function renderSignOptOut(body) {
    var wrap = document.createElement('div');
    wrap.style.marginTop = '1rem';
    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'journey-toggle';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'sign-optout';
    cb.checked = !!state.signOptOut;
    cb.addEventListener('change', function () {
      state.signOptOut = cb.checked;
      saveState();
    });
    var lblTxt = document.createElement('span');
    lblTxt.className = 'journey-toggle__label';
    lblTxt.textContent = 'Skip the back-cover ministry signing';
    toggleLabel.appendChild(cb);
    toggleLabel.appendChild(lblTxt);
    wrap.appendChild(toggleLabel);
    var hint = document.createElement('p');
    hint.className = 'journey-toggle__hint';
    hint.textContent = 'By default our ministry signs the back of every Bible — Bible number, recipient name, ministry signature. Tick this to skip.';
    wrap.appendChild(hint);
    body.appendChild(wrap);
  }

  // ── Step renderers ──────────────────────────────────────────

  // Essentials Step 1: Recipient
  function renderEssentialsRecipient(body, advanceFn) {
    body.innerHTML = '<p>Pick the recipient — we tailor the warmth of the message accordingly.</p>';
    var grid = document.createElement('div');
    grid.className = 'journey-pick-grid';
    var options = [
      { key: 'self',     title: 'For myself',          sub: "I want to walk through the Word with one in hand." },
      { key: 'friend',   title: 'For a specific friend', sub: 'A heartfelt gift for someone you know.' },
      { key: 'newcomer', title: 'For a newcomer',      sub: 'For someone just getting curious about Jesus.' }
    ];
    options.forEach(function (opt) {
      grid.appendChild(makePickCard(opt.title, opt.sub, state.recipient === opt.key, function () {
        state.recipient = opt.key;
        saveState();
        advanceFn();
      }));
    });
    body.appendChild(grid);
  }

  // Essentials Step 2: Items + Personalization + Packaging + Guides + sign-opt-out
  function renderEssentialsItems(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Each Essentials gift starts with the pocket Gideon. Below are the options — toggle anything you\'d like to include.</p>'));

    // Always-included pocket NT line.
    var fixedRow = document.createElement('div');
    fixedRow.className = 'journey-pills';
    fixedRow.style.marginBottom = '0.5rem';
    var fixed = document.createElement('span');
    fixed.className = 'journey-pill journey-pill--on';
    fixed.style.cursor = 'default';
    fixed.style.opacity = '0.95';
    fixed.innerHTML = 'Pocket Gideon NT' +
      ' <span style="display:inline-block;margin-left:0.4rem;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,0.25);color:#fff;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">always included</span>';
    fixedRow.appendChild(fixed);
    body.appendChild(fixedRow);

    var items = filterByScope('essentials');
    var grouped = groupBySection(items);

    // bible + inside go into state.personalization
    ['bible', 'inside'].forEach(function (sec) {
      renderGroupingSection({
        section: sec, items: grouped[sec] || [],
        chosenArr: state.personalization,
        onToggle: function (key) {
          toggle(state.personalization, key);
          if (state.personalization.indexOf(key) === -1 && state.customDetails) {
            delete state.customDetails[key];
          }
          saveState();
          renderEssentialsItems(body, advanceFn);
        },
        body: body
      });
    });

    // kit goes into state.essentialsItems
    renderGroupingSection({
      section: 'kit', items: grouped.kit || [],
      chosenArr: state.essentialsItems,
      onToggle: function (key) {
        toggle(state.essentialsItems, key);
        saveState();
        renderEssentialsItems(body, advanceFn);
      },
      body: body
    });

    // guides — render as named cards, not pills
    renderGuidesSection(body, grouped.guides || [], state.guides, function (key) {
      toggle(state.guides, key);
      saveState();
      renderEssentialsItems(body, advanceFn);
    });

    // packaging
    renderGroupingSection({
      section: 'packaging', items: grouped.packaging || [],
      chosenArr: state.packaging,
      onToggle: function (key) {
        toggle(state.packaging, key);
        if (state.packaging.indexOf(key) === -1 && state.customDetails) {
          delete state.customDetails[key];
        }
        saveState();
        renderEssentialsItems(body, advanceFn);
      },
      body: body
    });

    // Custom-detail textareas for any chosen item that needs one.
    var allChosen = []
      .concat(state.personalization || [])
      .concat(state.essentialsItems || [])
      .concat(state.packaging || []);
    renderCustomDetailTextareas(body, allChosen);

    // Back-cover signing opt-out toggle
    renderSignOptOut(body);

    // Soft "you stripped it down" notice (only when most items are off)
    if ((state.essentialsItems || []).length === 0) {
      body.appendChild(el('<p class="journey-notice">Heads up — shipping a single Bible alone is roughly the same $7 as shipping the full kit, and we can\'t guarantee bulk rates. Most folks add the items so the gift feels complete.</p>'));
    }

    body.appendChild(makeContinueRow({ primaryLabel: 'Continue to review →', onPrimary: advanceFn }));
  }

  // Essentials Step 3: Review
  function renderEssentialsReview(body) {
    body.innerHTML = '';
    var review = document.createElement('div');
    review.className = 'journey-review';
    var kitText = (state.essentialsItems || []).length
      ? state.essentialsItems.map(function (k) { return labelOf(k); }).join(', ')
      : 'Bible only (no extras)';
    var persText = (state.personalization || []).length
      ? state.personalization.map(function (k) { return labelOf(k); }).join(', ')
      : 'None';
    var pkgText = (state.packaging || []).length
      ? state.packaging.map(function (k) { return labelOf(k); }).join(', ')
      : 'Standard wrap';
    var guidesText = (state.guides || []).length
      ? state.guides.map(function (k) { return labelOf(k); }).join(', ')
      : 'None';
    var signLine = state.signOptOut
      ? '<dt>Back-cover signing</dt><dd>SKIPPED (per gifter request)</dd>'
      : '<dt>Back-cover signing</dt><dd>included (default)</dd>';
    review.innerHTML =
      '<h3 class="journey-review__title">Your Essentials gift</h3>' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.essentials) + '</dd>' +
        '<dt>Recipient</dt><dd>' + escapeHtml(summarizeRecipient()) + '</dd>' +
        '<dt>What\'s included</dt><dd>' + escapeHtml(kitText) + '</dd>' +
        '<dt>Personal touches</dt><dd>' + escapeHtml(persText) + '</dd>' +
        '<dt>Packaging</dt><dd>' + escapeHtml(pkgText) + '</dd>' +
        '<dt>Guides</dt><dd>' + escapeHtml(guidesText) + '</dd>' +
        signLine +
      '</dl>' +
      '<p style="margin:0 0 1rem;color:var(--muted);font-size:0.9rem;line-height:1.55">' +
        'Bible at our $2 ministry rate · roughly $7 shipping with the full kit · we\'ll confirm the exact total with you before charging.' +
      '</p>';
    var ctaRow = document.createElement('div');
    ctaRow.className = 'journey-review__cta';
    var continueBtn = el('<button type="button" class="btn btn-primary btn-green-call">Continue to checkout →</button>');
    continueBtn.addEventListener('click', goToBuilder);
    ctaRow.appendChild(continueBtn);
    review.appendChild(ctaRow);
    body.appendChild(review);
  }

  // Life Group Step 1: Quantity
  function renderLifegroupQuantity(body, advanceFn) {
    body.innerHTML = '<p>How many Bibles to start the group? You can pick 2 to 5.</p>';
    var grid = document.createElement('div');
    grid.className = 'journey-pick-grid';
    [2, 3, 4, 5].forEach(function (n) {
      grid.appendChild(makePickCard(n + ' Bibles', '$' + (2 * n) + ' base · $2 each', state.quantity === n, function () {
        state.quantity = n;
        if (!Array.isArray(state.perBibleNames)) state.perBibleNames = [];
        while (state.perBibleNames.length < n) state.perBibleNames.push('');
        state.perBibleNames.length = n;
        saveState();
        advanceFn();
      }));
    });
    body.appendChild(grid);
  }

  // Life Group Step 2: Per-Bible names
  function renderLifegroupNames(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Add a name for each Bible you\'d like engraved (or leave blank to skip that one).</p>'));
    var list = document.createElement('div');
    list.className = 'journey-name-list';
    var n = state.quantity || 0;
    if (!Array.isArray(state.perBibleNames)) state.perBibleNames = [];
    while (state.perBibleNames.length < n) state.perBibleNames.push('');
    state.perBibleNames.length = n;
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var row = document.createElement('div');
        row.className = 'journey-name-row';
        var lbl = document.createElement('span');
        lbl.className = 'journey-name-row__label';
        lbl.textContent = 'Bible ' + (idx + 1);
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'journey-input';
        input.placeholder = 'First name (or leave blank)';
        input.maxLength = 30;
        input.value = state.perBibleNames[idx] || '';
        input.addEventListener('input', function () {
          state.perBibleNames[idx] = input.value;
          saveState();
        });
        row.appendChild(lbl);
        row.appendChild(input);
        list.appendChild(row);
      })(i);
    }
    body.appendChild(list);
    body.appendChild(makeContinueRow({
      primaryLabel: 'Continue →',
      skipLabel: 'Skip all — no engraving',
      onPrimary: advanceFn,
      onSkip: function () {
        for (var j = 0; j < state.perBibleNames.length; j++) state.perBibleNames[j] = '';
        saveState();
        advanceFn();
      }
    }));
  }

  // Life Group Step 3: Identity
  function renderLifegroupIdentity(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Give the group a shared identity — a name to engrave on every Bible, and a cover theme so they match.</p>'));
    var grid = document.createElement('div');
    grid.className = 'journey-field-grid';
    var nameWrap = document.createElement('div');
    nameWrap.innerHTML = '<label class="journey-field-label" for="jrn-group-name">Group name (optional, max 40 chars)</label>';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'jrn-group-name';
    nameInput.className = 'journey-input';
    nameInput.maxLength = 40;
    nameInput.placeholder = 'e.g. Tuesday Night Crew';
    nameInput.value = state.groupIdentity.groupName || '';
    nameInput.addEventListener('input', function () {
      state.groupIdentity.groupName = nameInput.value;
      saveState();
    });
    nameWrap.appendChild(nameInput);
    grid.appendChild(nameWrap);

    var themeWrap = document.createElement('div');
    themeWrap.innerHTML = '<label class="journey-field-label">Cover theme</label>';
    var themeRow = document.createElement('div');
    themeRow.className = 'journey-pills';
    COVER_THEMES.forEach(function (t) {
      var on = state.groupIdentity.coverTheme === t.key;
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'journey-pill' + (on ? ' journey-pill--on' : '');
      pill.setAttribute('aria-pressed', on ? 'true' : 'false');
      pill.textContent = t.label;
      pill.addEventListener('click', function () {
        state.groupIdentity.coverTheme = t.key;
        saveState();
        renderLifegroupIdentity(body, advanceFn);
      });
      themeRow.appendChild(pill);
    });
    themeWrap.appendChild(themeRow);
    grid.appendChild(themeWrap);
    body.appendChild(grid);
    body.appendChild(makeContinueRow({ primaryLabel: 'Continue →', onPrimary: advanceFn }));
  }

  // Life Group Step 4: per-Bible add-ons + personalization + packaging + guides + sign-opt-out
  function renderLifegroupAddons(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Want to include any items for each member? We multiply your selection by your group size — every Bible gets the same items.</p>'));

    var items = filterByScope('lifegroup');
    var grouped = groupBySection(items);

    // bible + inside personal touches
    ['bible', 'inside'].forEach(function (sec) {
      renderGroupingSection({
        section: sec, items: grouped[sec] || [],
        chosenArr: state.personalization,
        onToggle: function (key) {
          toggle(state.personalization, key);
          if (state.personalization.indexOf(key) === -1 && state.customDetails) {
            delete state.customDetails[key];
          }
          saveState();
          renderLifegroupAddons(body, advanceFn);
        },
        body: body
      });
    });

    // Per-Bible kit add-ons
    renderGroupingSection({
      section: 'kit', items: grouped.kit || [],
      chosenArr: state.essentialsAddOns,
      onToggle: function (key) {
        toggle(state.essentialsAddOns, key);
        saveState();
        renderLifegroupAddons(body, advanceFn);
      },
      body: body
    });

    // Guides
    renderGuidesSection(body, grouped.guides || [], state.guides, function (key) {
      toggle(state.guides, key);
      saveState();
      renderLifegroupAddons(body, advanceFn);
    });

    // Packaging
    renderGroupingSection({
      section: 'packaging', items: grouped.packaging || [],
      chosenArr: state.packaging,
      onToggle: function (key) {
        toggle(state.packaging, key);
        if (state.packaging.indexOf(key) === -1 && state.customDetails) {
          delete state.customDetails[key];
        }
        saveState();
        renderLifegroupAddons(body, advanceFn);
      },
      body: body
    });

    var allChosen = []
      .concat(state.personalization || [])
      .concat(state.essentialsAddOns || [])
      .concat(state.packaging || []);
    renderCustomDetailTextareas(body, allChosen);

    renderSignOptOut(body);

    body.appendChild(makeContinueRow({
      primaryLabel: 'Continue to review →',
      skipLabel: 'Skip — Bibles only',
      onPrimary: advanceFn,
      onSkip: function () {
        state.essentialsAddOns = []; state.personalization = []; state.packaging = []; state.guides = [];
        saveState();
        advanceFn();
      }
    }));
  }

  // Life Group Step 5: Review
  function renderLifegroupReview(body) {
    body.innerHTML = '';
    var review = document.createElement('div');
    review.className = 'journey-review';
    var namesList = (state.perBibleNames || []).map(function (n, i) {
      return '<li>' + (i + 1) + '. ' + (n.trim() ? escapeHtml(n.trim()) : '<em>(no engraving)</em>') + '</li>';
    }).join('');
    var theme = COVER_THEMES.find(function (t) { return t.key === state.groupIdentity.coverTheme; });
    var addonText = (state.essentialsAddOns || []).length
      ? state.essentialsAddOns.map(function (k) { return labelOf(k); }).join(', ') + ' × ' + state.quantity
      : 'None';
    var persText = (state.personalization || []).length
      ? state.personalization.map(function (k) { return labelOf(k); }).join(', ')
      : 'None';
    var pkgText = (state.packaging || []).length
      ? state.packaging.map(function (k) { return labelOf(k); }).join(', ')
      : 'Standard wrap';
    var guidesText = (state.guides || []).length
      ? state.guides.map(function (k) { return labelOf(k); }).join(', ')
      : 'None';
    var signLine = state.signOptOut
      ? '<dt>Back-cover signing</dt><dd>SKIPPED (per gifter request)</dd>'
      : '<dt>Back-cover signing</dt><dd>included (default)</dd>';
    review.innerHTML =
      '<h3 class="journey-review__title">Your Life Group set</h3>' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.lifegroup) + '</dd>' +
        '<dt>Quantity</dt><dd>' + state.quantity + ' Bibles ($' + (2 * state.quantity) + ' base)</dd>' +
        '<dt>Group name</dt><dd>' + (state.groupIdentity.groupName ? escapeHtml(state.groupIdentity.groupName) : '<em>None</em>') + '</dd>' +
        '<dt>Cover theme</dt><dd>' + escapeHtml(theme ? theme.label : 'No theme') + '</dd>' +
        '<dt>Engraving</dt><dd><ol style="margin:0;padding-left:1.4rem">' + namesList + '</ol></dd>' +
        '<dt>Personal touches</dt><dd>' + escapeHtml(persText) + '</dd>' +
        '<dt>Add-ons (per Bible)</dt><dd>' + escapeHtml(addonText) + '</dd>' +
        '<dt>Packaging</dt><dd>' + escapeHtml(pkgText) + '</dd>' +
        '<dt>Guides</dt><dd>' + escapeHtml(guidesText) + '</dd>' +
        signLine +
      '</dl>' +
      '<p style="margin:0 0 1rem;color:var(--muted);font-size:0.9rem;line-height:1.55">' +
        'Bibles at our $2 ministry rate · we\'ll confirm shipping and engraving total with you directly.' +
      '</p>';
    var ctaRow = document.createElement('div');
    ctaRow.className = 'journey-review__cta';
    var continueBtn = el('<button type="button" class="btn btn-primary btn-green-call">Continue to checkout →</button>');
    continueBtn.addEventListener('click', goToBuilder);
    ctaRow.appendChild(continueBtn);
    review.appendChild(ctaRow);
    body.appendChild(review);
  }

  // Ministry Step 1: Volume tier
  function renderMinistryVolume(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>How many Bibles will you carry into the field? Pick a tier or set a custom number (25–200).</p>'));
    var grid = document.createElement('div');
    grid.className = 'journey-pick-grid';
    MINISTRY_TIERS.forEach(function (n) {
      grid.appendChild(makePickCard(n + ' Bibles', '$' + (2 * n) + ' base', state.volumeTier === n, function () {
        state.volumeTier = n;
        state.customQuantity = null;
        saveState();
        advanceFn();
      }));
    });
    var customCard = makePickCard('Custom', '25–200, set your own', state.volumeTier === 'custom', function () {
      state.volumeTier = 'custom';
      saveState();
      renderMinistryVolume(body, advanceFn);
    });
    grid.appendChild(customCard);
    body.appendChild(grid);

    if (state.volumeTier === 'custom') {
      var customWrap = document.createElement('div');
      customWrap.style.marginTop = '0.5rem';
      customWrap.innerHTML = '<label class="journey-field-label" for="jrn-custom-qty">Set quantity</label>';
      var input = document.createElement('input');
      input.type = 'number';
      input.id = 'jrn-custom-qty';
      input.className = 'journey-input journey-input--inline';
      input.min = String(MINISTRY_CUSTOM_MIN);
      input.max = String(MINISTRY_CUSTOM_MAX);
      input.step = '5';
      input.placeholder = '25–200';
      if (state.customQuantity) input.value = String(state.customQuantity);
      input.addEventListener('input', function () {
        var v = parseInt(input.value, 10);
        state.customQuantity = (!isNaN(v) && v >= MINISTRY_CUSTOM_MIN && v <= MINISTRY_CUSTOM_MAX) ? v : null;
        saveState();
      });
      customWrap.appendChild(input);
      var setBtn = el('<button type="button" class="btn btn-gold" style="margin-left:0.5rem">Set quantity</button>');
      setBtn.addEventListener('click', function () {
        if (!state.customQuantity || state.customQuantity < MINISTRY_CUSTOM_MIN || state.customQuantity > MINISTRY_CUSTOM_MAX) {
          showInlineError(body, 'Please enter a quantity between ' + MINISTRY_CUSTOM_MIN + ' and ' + MINISTRY_CUSTOM_MAX + '.');
          input.focus();
          return;
        }
        advanceFn();
      });
      customWrap.appendChild(setBtn);
      body.appendChild(customWrap);
    }
  }

  // Ministry Step 2: Outreach details
  function renderMinistryOutreach(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Tell us a bit about the outreach. We\'ll engrave a single shared phrase on every Bible.</p>'));

    var grid = document.createElement('div');
    grid.className = 'journey-field-grid journey-field-grid--2';

    var nameWrap = document.createElement('div');
    nameWrap.innerHTML = '<label class="journey-field-label" for="jrn-event-name">Event / outreach name (max 60 chars) *</label>';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'jrn-event-name';
    nameInput.className = 'journey-input';
    nameInput.maxLength = 60;
    nameInput.placeholder = 'e.g. Bellevue Park Outreach July 2026';
    nameInput.value = state.outreach.eventName || '';
    nameInput.addEventListener('input', function () { state.outreach.eventName = nameInput.value; saveState(); });
    nameWrap.appendChild(nameInput);
    grid.appendChild(nameWrap);

    var locWrap = document.createElement('div');
    locWrap.innerHTML = '<label class="journey-field-label" for="jrn-event-loc">Location *</label>';
    var locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.id = 'jrn-event-loc';
    locInput.className = 'journey-input';
    locInput.placeholder = 'City or venue';
    locInput.value = state.outreach.location || '';
    locInput.addEventListener('input', function () { state.outreach.location = locInput.value; saveState(); });
    locWrap.appendChild(locInput);
    grid.appendChild(locWrap);

    var dateWrap = document.createElement('div');
    dateWrap.innerHTML = '<label class="journey-field-label" for="jrn-event-date">Event date *</label>';
    var dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'jrn-event-date';
    dateInput.className = 'journey-input';
    dateInput.value = state.outreach.eventDate || '';
    dateInput.addEventListener('input', function () { state.outreach.eventDate = dateInput.value; saveState(); });
    dateWrap.appendChild(dateInput);
    grid.appendChild(dateWrap);

    body.appendChild(grid);

    body.appendChild(el('<h3 class="journey-subhead">Anchor verse</h3>'));
    body.appendChild(el('<p style="margin-top:-0.4rem">Pick a verse to carry alongside the engraving — or none if you\'ll choose later.</p>'));
    var verseRow = document.createElement('div');
    verseRow.className = 'journey-pills';
    ANCHOR_VERSES.forEach(function (v) {
      var on = state.outreach.anchorVerse === v.key;
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'journey-pill' + (on ? ' journey-pill--on' : '');
      pill.setAttribute('aria-pressed', on ? 'true' : 'false');
      pill.textContent = v.display;
      pill.addEventListener('click', function () {
        state.outreach.anchorVerse = v.key;
        saveState();
        renderMinistryOutreach(body, advanceFn);
      });
      verseRow.appendChild(pill);
    });
    var noneOn = state.outreach.anchorVerse === 'none';
    var nonePill = document.createElement('button');
    nonePill.type = 'button';
    nonePill.className = 'journey-pill' + (noneOn ? ' journey-pill--on' : '');
    nonePill.setAttribute('aria-pressed', noneOn ? 'true' : 'false');
    nonePill.textContent = 'None / I\'ll choose later';
    nonePill.addEventListener('click', function () {
      state.outreach.anchorVerse = 'none';
      saveState();
      renderMinistryOutreach(body, advanceFn);
    });
    verseRow.appendChild(nonePill);
    body.appendChild(verseRow);

    body.appendChild(makeContinueRow({
      primaryLabel: 'Continue →',
      onPrimary: function () {
        if (!state.outreach.eventName.trim()) { showInlineError(body, 'Event name is required.'); nameInput.focus(); return; }
        if (!state.outreach.location.trim())  { showInlineError(body, 'Location is required.');   locInput.focus(); return; }
        if (!state.outreach.eventDate)        { showInlineError(body, 'Event date is required.'); dateInput.focus(); return; }
        advanceFn();
      }
    }));
  }

  // Ministry Step 3: Outreach materials + Guides
  function renderMinistryAddons(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Anything to send along for the field?</p>'));

    var items = filterByScope('ministry');
    var grouped = groupBySection(items);

    // Outreach materials
    renderGroupingSection({
      section: 'outreach', items: grouped.outreach || [],
      chosenArr: state.addOns,
      onToggle: function (key) {
        toggle(state.addOns, key);
        saveState();
        renderMinistryAddons(body, advanceFn);
      },
      body: body
    });

    // Guides
    renderGuidesSection(body, grouped.guides || [], state.guides, function (key) {
      toggle(state.guides, key);
      saveState();
      renderMinistryAddons(body, advanceFn);
    });

    body.appendChild(makeContinueRow({
      primaryLabel: 'Continue to review →',
      skipLabel: 'Skip — Bibles only',
      onPrimary: advanceFn,
      onSkip: function () { state.addOns = []; state.guides = []; saveState(); advanceFn(); }
    }));
  }

  // Ministry Step 4: Review (with anchor verse blockquote)
  function renderMinistryReview(body) {
    body.innerHTML = '';
    var review = document.createElement('div');
    review.className = 'journey-review';

    var anchor = ANCHOR_VERSES.find(function (v) { return v.key === state.outreach.anchorVerse; });
    var anchorHtml = anchor
      ? '<blockquote class="journey-review__verse">' + escapeHtml(anchor.text) + '<cite>— ' + escapeHtml(anchor.display) + '</cite></blockquote>'
      : '';

    var qty = state.volumeTier === 'custom' ? state.customQuantity : state.volumeTier;
    var addonText = (state.addOns || []).length
      ? state.addOns.map(function (k) { return labelOf(k); }).join(', ')
      : 'None';
    var guidesText = (state.guides || []).length
      ? state.guides.map(function (k) { return labelOf(k); }).join(', ')
      : 'None';

    review.innerHTML =
      anchorHtml +
      '<h3 class="journey-review__title">Your calling, summarized</h3>' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.ministry) + '</dd>' +
        '<dt>Quantity</dt><dd>' + qty + ' Bibles at our $2 ministry rate</dd>' +
        '<dt>Outreach</dt><dd>' + escapeHtml(state.outreach.eventName) + '</dd>' +
        '<dt>Location</dt><dd>' + escapeHtml(state.outreach.location) + '</dd>' +
        '<dt>Event date</dt><dd>' + escapeHtml(state.outreach.eventDate) + '</dd>' +
        '<dt>Add-ons</dt><dd>' + escapeHtml(addonText) + '</dd>' +
        '<dt>Guides</dt><dd>' + escapeHtml(guidesText) + '</dd>' +
      '</dl>' +
      '<p style="margin:0 0 1rem;color:var(--muted);font-size:0.9rem;line-height:1.55">' +
        'This is a calling, not a checkout. We\'ll read your story personally and walk it through with you before any commitment is made.' +
      '</p>';

    var ctaRow = document.createElement('div');
    ctaRow.className = 'journey-review__cta';
    var continueBtn = el('<button type="button" class="btn btn-primary btn-green-call">Continue to share your story →</button>');
    continueBtn.addEventListener('click', goToBuilder);
    ctaRow.appendChild(continueBtn);
    review.appendChild(ctaRow);
    body.appendChild(review);
  }

  // ── Step definitions ────────────────────────────────────────
  var STEPS = {
    essentials: [
      { id: 'essentials-1', label: 'Recipient', title: "Who's it for?",       render: renderEssentialsRecipient, summarize: summarizeRecipient },
      { id: 'essentials-2', label: 'Items',     title: 'Make it yours',       render: renderEssentialsItems,     summarize: summarizeEssentialsItems },
      { id: 'essentials-3', label: 'Review',    title: 'Your Essentials gift', render: renderEssentialsReview,    summarize: function () { return ''; } }
    ],
    lifegroup: [
      { id: 'lifegroup-1', label: 'Group size', title: 'How many in your group?',           render: renderLifegroupQuantity, summarize: summarizeLifegroupQuantity },
      { id: 'lifegroup-2', label: 'Names',      title: 'Names for engraving',               render: renderLifegroupNames,    summarize: summarizeLifegroupNames },
      { id: 'lifegroup-3', label: 'Identity',   title: 'Group identity',                    render: renderLifegroupIdentity, summarize: summarizeLifegroupIdentity },
      { id: 'lifegroup-4', label: 'Add-ons',    title: 'Add items? (per Bible)',            render: renderLifegroupAddons,   summarize: summarizeLifegroupAddons },
      { id: 'lifegroup-5', label: 'Review',     title: 'Your Life Group set',               render: renderLifegroupReview,   summarize: function () { return ''; } }
    ],
    ministry: [
      { id: 'ministry-1', label: 'Volume',   title: 'How many Bibles will you carry?', render: renderMinistryVolume,   summarize: summarizeMinistryVolume },
      { id: 'ministry-2', label: 'Outreach', title: 'Tell us about the outreach',       render: renderMinistryOutreach, summarize: summarizeMinistryOutreach },
      { id: 'ministry-3', label: 'Add-ons',  title: 'Add-ons for the field',            render: renderMinistryAddons,   summarize: summarizeMinistryAddons },
      { id: 'ministry-4', label: 'Review',   title: 'Your calling, summarized',         render: renderMinistryReview,   summarize: function () { return ''; } }
    ]
  };

  // ── Summarizers ─────────────────────────────────────────────
  function summarizeRecipient() {
    if (!state.recipient) return '(not set)';
    return state.recipient === 'self' ? 'For myself' : state.recipient === 'friend' ? 'For a specific friend' : 'For a newcomer';
  }
  function summarizeEssentialsItems() {
    var items = state.essentialsItems || [];
    var pers  = state.personalization || [];
    var pkg   = state.packaging || [];
    var parts = [];
    if (items.length === 0) parts.push('Bible only');
    else parts.push(items.length + ' kit items');
    if (pers.length) parts.push(pers.length + ' personal');
    if (pkg.length) parts.push(pkg.length + ' packaging');
    if (state.signOptOut) parts.push('no signing');
    return parts.join(' · ') || '(none)';
  }
  function summarizeLifegroupQuantity() { return state.quantity ? state.quantity + ' Bibles' : '(not set)'; }
  function summarizeLifegroupNames() {
    var names = state.perBibleNames || [];
    var filled = names.filter(function (n) { return n.trim(); });
    if (filled.length === 0) return '(no engraving)';
    if (filled.length === names.length) return filled.join(', ');
    return filled.join(', ') + ' (+ ' + (names.length - filled.length) + ' skipped)';
  }
  function summarizeLifegroupIdentity() {
    var g = state.groupIdentity || {};
    var bits = [];
    if (g.groupName && g.groupName.trim()) bits.push('"' + g.groupName.trim() + '"');
    var t = COVER_THEMES.find(function (x) { return x.key === g.coverTheme; });
    if (t && t.key !== 'none') bits.push(t.label);
    return bits.length ? bits.join(' · ') : '(no identity set)';
  }
  function summarizeLifegroupAddons() {
    var a = state.essentialsAddOns || [];
    var p = state.personalization || [];
    var k = state.packaging || [];
    var parts = [];
    if (a.length) parts.push(a.length + ' add-ons');
    if (p.length) parts.push(p.length + ' personal');
    if (k.length) parts.push(k.length + ' packaging');
    if (state.signOptOut) parts.push('no signing');
    return parts.length ? parts.join(' · ') : '(skipped)';
  }
  function summarizeMinistryVolume() {
    if (state.volumeTier === 'custom') return state.customQuantity + ' Bibles (custom)';
    return state.volumeTier ? state.volumeTier + ' Bibles' : '(not set)';
  }
  function summarizeMinistryOutreach() {
    var o = state.outreach || {};
    return o.eventName ? o.eventName + (o.location ? ' · ' + o.location : '') : '(outreach not set)';
  }
  function summarizeMinistryAddons() {
    var a = state.addOns || [];
    var g = state.guides || [];
    var parts = [];
    if (a.length) parts.push(a.length + ' add-ons');
    if (g.length) parts.push(g.length + ' guides');
    return parts.length ? parts.join(' · ') : '(skipped)';
  }

  // ── Misc helpers ─────────────────────────────────────────────
  function toggle(arr, key) {
    var i = arr.indexOf(key);
    if (i === -1) arr.push(key); else arr.splice(i, 1);
  }
  function labelOf(key) {
    var item = findItem(key);
    return item ? item.label : key;
  }

  function goToBuilder() {
    var url = 'bundle-builder.html?c=' + encodePayload(state);
    window.location.assign(url);
  }

  // ── Renderer machinery ───────────────────────────────────────
  function makeStep(stepDef, index) {
    var section = document.createElement('section');
    section.className = 'journey-step journey-step--active journey-step--entering';
    section.setAttribute('data-step-id', stepDef.id);
    var h = document.createElement('header');
    h.className = 'journey-step__head';
    h.innerHTML = '<span class="journey-step__num">' + (index + 1) + '</span>' +
                  '<h2 class="journey-step__title" tabindex="-1">' + escapeHtml(stepDef.title) + '</h2>';
    var body = document.createElement('div');
    body.className = 'journey-step__body';
    section.appendChild(h);
    section.appendChild(body);
    stepDef.render(body, function () { advance(index); });
    return section;
  }

  function makeChip(stepDef, index) {
    var section = document.createElement('section');
    section.className = 'journey-step journey-step--chip';
    section.setAttribute('data-step-id', stepDef.id);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'journey-chip';
    btn.setAttribute('data-action', 'reopen-step');
    btn.setAttribute('data-step-index', String(index));
    btn.setAttribute('aria-label', 'Edit step ' + (index + 1) + ': ' + stepDef.label);
    btn.innerHTML =
      '<span class="journey-chip__num">' + (index + 1) + '</span>' +
      '<span class="journey-chip__label">' + escapeHtml(stepDef.label) + '</span>' +
      '<span class="journey-chip__value">' + escapeHtml(stepDef.summarize()) + '</span>' +
      '<span class="journey-chip__edit" aria-hidden="true">edit</span>';
    section.appendChild(btn);
    return section;
  }

  function selectBundle(key) {
    if (BUNDLE_KEYS.indexOf(key) === -1) return;
    if (state.bundle && state.bundle !== key && furthestStepIndex > 0) {
      var ok = window.confirm('Switching bundles will clear your current selections. Continue?');
      if (!ok) return;
    }
    clearState();
    state = defaultStateForBundle(key);
    furthestStepIndex = 0;
    saveState();
    renderJourney(true);
  }

  function renderJourney(focusActive) {
    if (!journeyRoot) return;
    journeyRoot.innerHTML = '';
    if (!state.bundle) return;
    var defs = STEPS[state.bundle];
    for (var i = 0; i < furthestStepIndex; i++) {
      journeyRoot.appendChild(makeChip(defs[i], i));
    }
    if (furthestStepIndex < defs.length) {
      var activeStep = makeStep(defs[furthestStepIndex], furthestStepIndex);
      journeyRoot.appendChild(activeStep);
      requestAnimationFrame(function () { activeStep.classList.remove('journey-step--entering'); });
      var heading = activeStep.querySelector('.journey-step__title');
      if (heading) {
        if (prefersReducedMotion) {
          heading.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (focusActive && furthestStepIndex > 0) {
          setTimeout(function () { try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); } }, 350);
        }
      }
    }
  }

  function advance(fromIndex) {
    if (!state.bundle) return;
    var defs = STEPS[state.bundle];
    if (fromIndex >= defs.length - 1) return;
    furthestStepIndex = Math.max(furthestStepIndex, fromIndex + 1);
    saveState();
    renderJourney(true);
  }

  function reopenStep(stepIndex) {
    if (!state.bundle) return;
    if (stepIndex < 0 || stepIndex >= furthestStepIndex) return;
    furthestStepIndex = stepIndex;
    renderJourney(true);
  }

  function computeFurthest(s) {
    if (!s.bundle) return 0;
    var defs = STEPS[s.bundle];
    if (s.bundle === 'essentials') {
      if (!s.recipient) return 0;
      return defs.length - 1;
    }
    if (s.bundle === 'lifegroup') {
      if (!s.quantity) return 0;
      if (!Array.isArray(s.perBibleNames) || s.perBibleNames.length !== s.quantity) return 1;
      return defs.length - 1;
    }
    if (s.bundle === 'ministry') {
      if (!s.volumeTier) return 0;
      if (s.volumeTier === 'custom' && !s.customQuantity) return 0;
      if (!s.outreach || !s.outreach.eventName) return 1;
      return defs.length - 1;
    }
    return 0;
  }

  // ── Bootstrap ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    journeyRoot = document.getElementById('journey-root');
    if (!journeyRoot) return;
    if (!CATALOG().length) {
      console.warn('[bundle-journey] STW_ITEM_CATALOG not loaded — items will not render.');
    }

    document.querySelectorAll('[data-bundle-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectBundle(btn.getAttribute('data-bundle-pick'));
      });
    });

    journeyRoot.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-action="reopen-step"]');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-step-index'), 10);
      if (!isNaN(idx)) reopenStep(idx);
    });

    var saved = loadState();
    if (saved) {
      state = saved;
      furthestStepIndex = computeFurthest(state);
      renderJourney(false);
    }
  });
})();
