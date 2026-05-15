/* ============================================================
   Store Bundle Journey — store.html stepwise reveal runtime
   Spec: .kiro/specs/store-bundle-journey/
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

  // ── Item catalogs ────────────────────────────────────────────
  // Bundle / kit items — physical things in the box.
  // `madeToOrder: true` = handcraft item, ~2-3 weeks.
  var ESSENTIALS_ITEMS = [
    { key: 'pocket-nt',         label: 'Pocket Gideon NT',                note: 'always included' },
    { key: 'highlighter-stickies', label: 'Highlighter & sticky notes' },
    { key: 'mini-notepad',      label: 'Mini pocket notepad' },
    { key: 'pen',               label: 'Pen' },
    { key: 'bookmarks',         label: 'Bookmarks (set)' },
    { key: 'stickers',          label: 'Stickers' },
    { key: 'welcome-note',      label: 'Welcome note' },
    { key: 'postcards',         label: 'Postcards (with verses)' },
    { key: 'tags',              label: 'Gift tags' },
    { key: 'card-holder',       label: 'Card holder' },
    { key: 'wrap',              label: 'Decorative wrap' },
    { key: 'keychain',          label: 'Keychain' },
    { key: 'bracelet',          label: 'Bracelet' },
    { key: 'mini-jesus',        label: 'Mini Jesus figurine',             madeToOrder: true },
    { key: 'stuffed-crochet',   label: 'Stuffed crochet figurine',        madeToOrder: true },
    { key: 'flip-book',         label: 'Flip book' },
    { key: 'qr-card',           label: 'QR card → start a life group'    }
  ];
  var ESSENTIALS_ITEM_KEYS = ESSENTIALS_ITEMS.map(function (i) { return i.key; });
  // All items pre-selected by default for Essentials (full kit). User
  // toggles off anything they don't want. Pocket NT can't be deselected.
  var ESSENTIALS_ITEM_DEFAULTS = ESSENTIALS_ITEM_KEYS.slice();

  // Personal touches — done to the Bible itself or a single piece.
  // These are EXTRAS on top of the kit, not pre-selected by default.
  var PERSONALIZATION = [
    { key: 'engraving',           label: 'Custom engraving (name / verse / dedication)' },
    { key: 'painting-bible',      label: 'Custom painting on Bible cover',  madeToOrder: true },
    { key: 'painting-separate',   label: 'Custom painting on a separate piece', madeToOrder: true },
    { key: 'verse-highlighting',  label: 'Verse highlighting (specific verses pre-marked)' },
    { key: 'custom-cover-color',  label: 'Custom cover color' },
    { key: 'custom-postcards',    label: 'Custom postcards (handwritten)',  madeToOrder: true },
    { key: 'custom-stickers',     label: 'Custom stickers',                 madeToOrder: true },
    { key: 'handwritten-note',    label: 'Handwritten note from our team' },
    { key: 'gift-box',            label: 'Gift box upgrade' }
  ];
  var PERSONALIZATION_KEYS = PERSONALIZATION.map(function (p) { return p.key; });

  // Subset of personalization that needs a free-text "what would you
  // like?" prompt. Triggered when the user toggles any of these on.
  var CUSTOM_DETAIL_KEYS = [
    'engraving',
    'painting-bible',
    'painting-separate',
    'verse-highlighting',
    'custom-postcards',
    'custom-stickers',
    'handwritten-note'
  ];

  var COVER_THEMES = [
    { key: 'cream', label: 'Cream' },
    { key: 'kraft', label: 'Kraft' },
    { key: 'green', label: 'Ministry green' },
    { key: 'none',  label: 'No theme' }
  ];
  var COVER_THEME_KEYS = COVER_THEMES.map(function (c) { return c.key; });

  // Ministry Calling — bulk-friendly add-ons. Per-Bible handcraft is
  // intentionally NOT offered here (impractical at 25-200 volume).
  var MINISTRY_ADDONS = [
    { key: 'tract-pack',         label: 'Tract pack' },
    { key: 'carrying-case',      label: 'Carrying case' },
    { key: 'prayer-cards',       label: 'Prayer cards' },
    { key: 'leader-guide',       label: 'Leader guide' },
    { key: 'generic-postcards',  label: 'Generic postcards (with verses)' },
    { key: 'generic-stickers',   label: 'Generic stickers' }
  ];
  var MINISTRY_ADDON_KEYS = MINISTRY_ADDONS.map(function (a) { return a.key; });

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

  // ── State ───────────────────────────────────────────────────
  var state = blankState();
  var furthestStepIndex = 0;
  var journeyRoot = null;
  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function blankState() { return { bundle: null }; }

  function defaultStateForBundle(key) {
    if (key === 'essentials') {
      return { bundle: 'essentials', recipient: null, essentialsItems: ESSENTIALS_ITEM_DEFAULTS.slice(), personalization: [], customDetails: {} };
    }
    if (key === 'lifegroup') {
      return { bundle: 'lifegroup', quantity: null, perBibleNames: [], groupIdentity: { groupName: '', coverTheme: 'none' }, essentialsAddOns: [], personalization: [], customDetails: {} };
    }
    if (key === 'ministry') {
      return { bundle: 'ministry', volumeTier: null, customQuantity: null, outreach: { eventName: '', location: '', eventDate: '', anchorVerse: 'none' }, addOns: [] };
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

  function isStringArrayOf(arr, allowed) {
    if (!Array.isArray(arr)) return false;
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== 'string') return false;
      if (allowed && allowed.indexOf(arr[i]) === -1) return false;
    }
    return true;
  }

  function validateConfig(c) {
    if (!c || typeof c !== 'object') return false;
    if (BUNDLE_KEYS.indexOf(c.bundle) === -1) return c.bundle === null;
    if (c.bundle === 'essentials') {
      if (c.recipient !== null && ['self','friend','newcomer'].indexOf(c.recipient) === -1) return false;
      if (!isStringArrayOf(c.essentialsItems, ESSENTIALS_ITEM_KEYS)) return false;
      if (!isStringArrayOf(c.personalization, PERSONALIZATION_KEYS)) return false;
      if (c.customDetails !== undefined && (c.customDetails === null || typeof c.customDetails !== 'object')) return false;
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
      if (!isStringArrayOf(c.essentialsAddOns, ESSENTIALS_ITEM_KEYS)) return false;
      if (c.personalization !== undefined && !isStringArrayOf(c.personalization, PERSONALIZATION_KEYS)) return false;
      if (c.customDetails !== undefined && (c.customDetails === null || typeof c.customDetails !== 'object')) return false;
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
      if (!isStringArrayOf(c.addOns, MINISTRY_ADDON_KEYS)) return false;
      return true;
    }
    return false;
  }

  function encodePayload(s) { return btoa(encodeURIComponent(JSON.stringify(s))); }

  // ── DOM utilities ────────────────────────────────────────────
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function makePill(label, isOn, onClick, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'journey-pill' + (isOn ? ' journey-pill--on' : '');
    b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    if (opts.madeToOrder) {
      b.innerHTML = escapeHtml(label) +
        ' <span style="display:inline-block;margin-left:0.4rem;padding:1px 6px;border-radius:999px;background:rgba(212,165,116,0.25);color:#7a5a2a;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">made-to-order</span>';
    } else {
      b.textContent = label;
    }
    b.addEventListener('click', onClick);
    return b;
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

  // Essentials Step 2: Items + Personalization
  function renderEssentialsItems(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Each Essentials gift starts with the pocket Gideon. Below is the full kit — toggle off anything you don\'t want.</p>'));

    body.appendChild(el('<h3 class="journey-subhead">What\'s in the box</h3>'));
    var itemsRow = document.createElement('div');
    itemsRow.className = 'journey-pills';
    ESSENTIALS_ITEMS.forEach(function (item) {
      // Pocket NT can't be deselected — it's the gift.
      if (item.key === 'pocket-nt') {
        var fixed = document.createElement('span');
        fixed.className = 'journey-pill journey-pill--on';
        fixed.style.cursor = 'default';
        fixed.style.opacity = '0.95';
        fixed.innerHTML = escapeHtml(item.label) +
          ' <span style="display:inline-block;margin-left:0.4rem;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,0.25);color:#fff;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">always included</span>';
        itemsRow.appendChild(fixed);
        return;
      }
      var on = state.essentialsItems.indexOf(item.key) !== -1;
      var pill = makePill(item.label, on, function () {
        toggle(state.essentialsItems, item.key);
        saveState();
        renderEssentialsItems(body, advanceFn);
      }, { madeToOrder: !!item.madeToOrder });
      itemsRow.appendChild(pill);
    });
    body.appendChild(itemsRow);

    if (state.essentialsItems.indexOf('pocket-nt') === -1) state.essentialsItems.unshift('pocket-nt');
    if (state.essentialsItems.length <= 1) {
      body.appendChild(el('<p class="journey-notice">Heads up — shipping a single Bible alone is roughly the same $7 as shipping the full kit, and we can\'t guarantee bulk rates. Most folks add the items so the gift feels complete.</p>'));
    }

    body.appendChild(el('<h3 class="journey-subhead">Personal touches (optional)</h3>'));
    var persRow = document.createElement('div');
    persRow.className = 'journey-pills';
    PERSONALIZATION.forEach(function (p) {
      var on = state.personalization.indexOf(p.key) !== -1;
      persRow.appendChild(makePill(p.label, on, function () {
        toggle(state.personalization, p.key);
        // If we just turned OFF a custom item, also clear its detail.
        if (state.personalization.indexOf(p.key) === -1 && state.customDetails) {
          delete state.customDetails[p.key];
        }
        saveState();
        renderEssentialsItems(body, advanceFn);
      }, { madeToOrder: !!p.madeToOrder }));
    });
    body.appendChild(persRow);

    // Inline "describe what you'd like" textareas for each toggled-on
    // custom item that needs a detail prompt.
    var needsDetail = state.personalization.filter(function (k) {
      return CUSTOM_DETAIL_KEYS.indexOf(k) !== -1;
    });
    if (needsDetail.length) {
      var detailWrap = document.createElement('div');
      detailWrap.style.marginTop = '1rem';
      detailWrap.style.display = 'flex';
      detailWrap.style.flexDirection = 'column';
      detailWrap.style.gap = '0.7rem';
      needsDetail.forEach(function (key) {
        var def = PERSONALIZATION.find(function (x) { return x.key === key; });
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
        if (!state.customDetails) state.customDetails = {};
        ta.value = state.customDetails[key] || '';
        ta.addEventListener('input', function () {
          if (!state.customDetails) state.customDetails = {};
          state.customDetails[key] = ta.value;
          saveState();
        });
        row.appendChild(lbl);
        row.appendChild(ta);
        detailWrap.appendChild(row);
      });
      body.appendChild(detailWrap);
    }

    body.appendChild(makeContinueRow({ primaryLabel: 'Continue to review →', onPrimary: advanceFn }));
  }

  function customDetailPlaceholder(key) {
    switch (key) {
      case 'engraving':           return 'e.g. "Sarah Johnson — John 3:16"';
      case 'painting-bible':      return 'e.g. "watercolor sunflowers across the cover"';
      case 'painting-separate':   return 'e.g. "small canvas, Psalm 23 in calligraphy with green hills"';
      case 'verse-highlighting':  return 'List the verses you\'d like marked, e.g. "John 3:16, Romans 8:28, Psalm 23"';
      case 'custom-postcards':    return 'e.g. "two postcards: one welcome, one with their favorite verse"';
      case 'custom-stickers':     return 'e.g. "a few stickers with their name and a small cross"';
      case 'handwritten-note':    return 'What would you like the note to say?';
      default: return 'Anything specific you\'d like us to know?';
    }
  }

  // Essentials Step 3: Review
  function renderEssentialsReview(body) {
    body.innerHTML = '';
    var review = document.createElement('div');
    review.className = 'journey-review';
    var items = state.essentialsItems.length
      ? state.essentialsItems.map(function (k) { return labelFor(ESSENTIALS_ITEMS, k); }).join(', ')
      : 'Bible only (no extras)';
    var pers = state.personalization.length
      ? state.personalization.map(function (k) { return labelFor(PERSONALIZATION, k); }).join(', ')
      : 'None';
    review.innerHTML =
      '<h3 class="journey-review__title">Your Essentials gift</h3>' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.essentials) + '</dd>' +
        '<dt>Recipient</dt><dd>' + escapeHtml(summarizeRecipient()) + '</dd>' +
        '<dt>What\'s included</dt><dd>' + escapeHtml(items) + '</dd>' +
        '<dt>Personal touches</dt><dd>' + escapeHtml(pers) + '</dd>' +
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
        // Resize names array to match.
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
      themeRow.appendChild(makePill(t.label, on, function () {
        state.groupIdentity.coverTheme = t.key;
        saveState();
        renderLifegroupIdentity(body, advanceFn);
      }));
    });
    themeWrap.appendChild(themeRow);
    grid.appendChild(themeWrap);
    body.appendChild(grid);
    body.appendChild(makeContinueRow({ primaryLabel: 'Continue →', onPrimary: advanceFn }));
  }

  // Life Group Step 4: Essentials add-ons (per Bible)
  function renderLifegroupAddons(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Want to include any Essentials items for each member? We multiply your selection by your group size — every Bible gets the same items.</p>'));
    var pills = document.createElement('div');
    pills.className = 'journey-pills';
    ESSENTIALS_ITEMS.forEach(function (item) {
      // Pocket NT is always included by definition; don't show it as an addon.
      if (item.key === 'pocket-nt') return;
      var on = state.essentialsAddOns.indexOf(item.key) !== -1;
      pills.appendChild(makePill(item.label, on, function () {
        toggle(state.essentialsAddOns, item.key);
        saveState();
        renderLifegroupAddons(body, advanceFn);
      }, { madeToOrder: !!item.madeToOrder }));
    });
    body.appendChild(pills);
    body.appendChild(makeContinueRow({
      primaryLabel: 'Continue to review →',
      skipLabel: 'Skip — Bibles only',
      onPrimary: advanceFn,
      onSkip: function () { state.essentialsAddOns = []; saveState(); advanceFn(); }
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
    var addonText = state.essentialsAddOns.length
      ? state.essentialsAddOns.map(function (k) { return labelFor(ESSENTIALS_ITEMS, k); }).join(', ') + ' × ' + state.quantity
      : 'None';
    review.innerHTML =
      '<h3 class="journey-review__title">Your Life Group set</h3>' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.lifegroup) + '</dd>' +
        '<dt>Quantity</dt><dd>' + state.quantity + ' Bibles ($' + (2 * state.quantity) + ' base)</dd>' +
        '<dt>Group name</dt><dd>' + (state.groupIdentity.groupName ? escapeHtml(state.groupIdentity.groupName) : '<em>None</em>') + '</dd>' +
        '<dt>Cover theme</dt><dd>' + escapeHtml(theme ? theme.label : 'No theme') + '</dd>' +
        '<dt>Engraving</dt><dd><ol style="margin:0;padding-left:1.4rem">' + namesList + '</ol></dd>' +
        '<dt>Add-ons (per Bible)</dt><dd>' + addonText + '</dd>' +
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
      verseRow.appendChild(makePill(v.display, on, function () {
        state.outreach.anchorVerse = v.key;
        saveState();
        renderMinistryOutreach(body, advanceFn);
      }));
    });
    var noneOn = state.outreach.anchorVerse === 'none';
    verseRow.appendChild(makePill('None / I\'ll choose later', noneOn, function () {
      state.outreach.anchorVerse = 'none';
      saveState();
      renderMinistryOutreach(body, advanceFn);
    }));
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

  // Ministry Step 3: Add-ons
  function renderMinistryAddons(body, advanceFn) {
    body.innerHTML = '';
    body.appendChild(el('<p>Anything to send along for the field?</p>'));
    var pills = document.createElement('div');
    pills.className = 'journey-pills';
    MINISTRY_ADDONS.forEach(function (a) {
      var on = state.addOns.indexOf(a.key) !== -1;
      pills.appendChild(makePill(a.label, on, function () {
        toggle(state.addOns, a.key);
        saveState();
        renderMinistryAddons(body, advanceFn);
      }));
    });
    body.appendChild(pills);
    body.appendChild(makeContinueRow({
      primaryLabel: 'Continue to review →',
      skipLabel: 'Skip — Bibles only',
      onPrimary: advanceFn,
      onSkip: function () { state.addOns = []; saveState(); advanceFn(); }
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
    var addonText = state.addOns.length
      ? state.addOns.map(function (k) { return labelFor(MINISTRY_ADDONS, k); }).join(', ')
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
      { id: 'essentials-2', label: 'Items',     title: 'Make it yours',         render: renderEssentialsItems,     summarize: summarizeEssentialsItems },
      { id: 'essentials-3', label: 'Review',    title: 'Your Essentials gift', render: renderEssentialsReview,    summarize: function () { return ''; } }
    ],
    lifegroup: [
      { id: 'lifegroup-1', label: 'Group size', title: 'How many in your group?',           render: renderLifegroupQuantity, summarize: summarizeLifegroupQuantity },
      { id: 'lifegroup-2', label: 'Names',      title: 'Names for engraving',               render: renderLifegroupNames,    summarize: summarizeLifegroupNames },
      { id: 'lifegroup-3', label: 'Identity',   title: 'Group identity',                    render: renderLifegroupIdentity, summarize: summarizeLifegroupIdentity },
      { id: 'lifegroup-4', label: 'Add-ons',    title: 'Add Essentials items? (per Bible)', render: renderLifegroupAddons,   summarize: summarizeLifegroupAddons },
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
    var pers = state.personalization || [];
    var parts = [];
    if (items.length === 0) parts.push('Bible only');
    else if (items.length === ESSENTIALS_ITEM_KEYS.length) parts.push('Full kit');
    else parts.push(items.length + ' items');
    if (pers.length) parts.push(pers.length + ' personal touches');
    return parts.join(' · ');
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
    return a.length ? a.length + ' add-ons (per Bible)' : '(skipped)';
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
    return a.length ? a.length + ' add-ons' : '(skipped)';
  }

  // ── Misc helpers ─────────────────────────────────────────────
  function toggle(arr, key) {
    var i = arr.indexOf(key);
    if (i === -1) arr.push(key); else arr.splice(i, 1);
  }
  function labelFor(items, key) {
    var hit = items.find(function (i) { return i.key === key; });
    return hit ? hit.label : key;
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
