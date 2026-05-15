/* ============================================================
   bundle-review.js — handoff page review + Formspree submit.
   Reads ?c=base64(JSON) from the URL, renders a read-only review,
   and submits the gifter form to the existing endpoint.
   Spec: .kiro/specs/store-bundle-journey/
   ============================================================ */
(function () {
  'use strict';

  var BUNDLE_KEYS = ['essentials', 'lifegroup', 'ministry'];
  var BUNDLE_DISPLAY = {
    essentials: 'Essentials Welcome',
    lifegroup:  'Life Group Starter',
    ministry:   'Ministry Calling'
  };
  var ESSENTIALS_ITEMS = [
    { key: 'pocket-nt',            label: 'Pocket Gideon NT' },
    { key: 'highlighter-stickies', label: 'Highlighter & sticky notes' },
    { key: 'mini-notepad',         label: 'Mini pocket notepad' },
    { key: 'pen',                  label: 'Pen' },
    { key: 'bookmarks',            label: 'Bookmarks (set)' },
    { key: 'stickers',             label: 'Stickers' },
    { key: 'welcome-note',         label: 'Welcome note' },
    { key: 'postcards',            label: 'Postcards (with verses)' },
    { key: 'tags',                 label: 'Gift tags' },
    { key: 'card-holder',          label: 'Card holder' },
    { key: 'wrap',                 label: 'Decorative wrap' },
    { key: 'keychain',             label: 'Keychain' },
    { key: 'bracelet',             label: 'Bracelet' },
    { key: 'mini-jesus',           label: 'Mini Jesus figurine' },
    { key: 'stuffed-crochet',      label: 'Stuffed crochet figurine' },
    { key: 'flip-book',            label: 'Flip book' },
    { key: 'qr-card',              label: 'QR card → start a life group' }
  ];
  var ESSENTIALS_ITEM_KEYS = ESSENTIALS_ITEMS.map(function (i) { return i.key; });
  var PERSONALIZATION = [
    { key: 'engraving',           label: 'Custom engraving' },
    { key: 'painting-bible',      label: 'Custom painting on Bible cover' },
    { key: 'painting-separate',   label: 'Custom painting on a separate piece' },
    { key: 'verse-highlighting',  label: 'Verse highlighting' },
    { key: 'custom-cover-color',  label: 'Custom cover color' },
    { key: 'custom-postcards',    label: 'Custom postcards' },
    { key: 'custom-stickers',     label: 'Custom stickers' },
    { key: 'handwritten-note',    label: 'Handwritten note from our team' },
    { key: 'gift-box',            label: 'Gift box upgrade' }
  ];
  var PERSONALIZATION_KEYS = PERSONALIZATION.map(function (p) { return p.key; });
  var COVER_THEMES = [
    { key: 'cream', label: 'Cream' },
    { key: 'kraft', label: 'Kraft' },
    { key: 'green', label: 'Ministry green' },
    { key: 'none',  label: 'No theme' }
  ];
  var COVER_THEME_KEYS = COVER_THEMES.map(function (c) { return c.key; });
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

  // ── Site config (Apps Script handler URL) ────────────────────
  // Loaded from assets/data/site-config.json on DOMContentLoaded.
  // Falls back to Formspree when orderHandlerUrl is empty/null/non-https.
  var siteConfig = { orderHandlerUrl: '' };

  function loadSiteConfig() {
    return fetch('assets/data/site-config.json?v=1', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        if (data && typeof data.orderHandlerUrl === 'string') {
          siteConfig.orderHandlerUrl = data.orderHandlerUrl;
        }
      })
      .catch(function () { /* non-fatal — keep default empty URL */ });
  }

  function isUsableHandlerUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!/^https:\/\//i.test(url)) return false;
    return /script\.google\.com\/macros\//i.test(url) || /googleusercontent\.com\//i.test(url);
  }

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
    if (BUNDLE_KEYS.indexOf(c.bundle) === -1) return false;
    if (c.bundle === 'essentials') {
      if (c.recipient !== null && ['self','friend','newcomer'].indexOf(c.recipient) === -1) return false;
      if (!isStringArrayOf(c.essentialsItems, ESSENTIALS_ITEM_KEYS)) return false;
      if (!isStringArrayOf(c.personalization, PERSONALIZATION_KEYS)) return false;
      return true;
    }
    if (c.bundle === 'lifegroup') {
      if ([2,3,4,5].indexOf(c.quantity) === -1) return false;
      if (!Array.isArray(c.perBibleNames) || c.perBibleNames.length !== c.quantity) return false;
      for (var i = 0; i < c.perBibleNames.length; i++) {
        if (typeof c.perBibleNames[i] !== 'string') return false;
      }
      if (!c.groupIdentity || typeof c.groupIdentity !== 'object') return false;
      if (typeof c.groupIdentity.groupName !== 'string' || c.groupIdentity.groupName.length > 40) return false;
      if (COVER_THEME_KEYS.indexOf(c.groupIdentity.coverTheme) === -1) return false;
      if (!isStringArrayOf(c.essentialsAddOns, ESSENTIALS_ITEM_KEYS)) return false;
      return true;
    }
    if (c.bundle === 'ministry') {
      var validTiers = MINISTRY_TIERS.concat(['custom']);
      if (validTiers.indexOf(c.volumeTier) === -1) return false;
      if (c.volumeTier === 'custom') {
        if (typeof c.customQuantity !== 'number' || c.customQuantity < MINISTRY_CUSTOM_MIN || c.customQuantity > MINISTRY_CUSTOM_MAX) return false;
      }
      if (!c.outreach || typeof c.outreach !== 'object') return false;
      if (typeof c.outreach.eventName !== 'string' || !c.outreach.eventName.trim() || c.outreach.eventName.length > 60) return false;
      if (typeof c.outreach.location !== 'string') return false;
      if (typeof c.outreach.eventDate !== 'string') return false;
      if (ANCHOR_VERSE_KEYS.indexOf(c.outreach.anchorVerse) === -1) return false;
      if (!isStringArrayOf(c.addOns, MINISTRY_ADDON_KEYS)) return false;
      return true;
    }
    return false;
  }

  function decodePayload(str) {
    try {
      var json = decodeURIComponent(atob(str));
      var obj = JSON.parse(json);
      return validateConfig(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function labelFor(items, key) {
    var hit = items.find(function (i) { return i.key === key; });
    return hit ? hit.label : key;
  }

  function recipientLabel(r) {
    return r === 'self' ? 'For myself' : r === 'friend' ? 'For a specific friend' : r === 'newcomer' ? 'For a newcomer' : '(not set)';
  }

  // ── Renderers ────────────────────────────────────────────────
  function renderEssentialsReview(s) {
    var items = s.essentialsItems.length
      ? s.essentialsItems.map(function (k) { return labelFor(ESSENTIALS_ITEMS, k); }).join(', ')
      : 'Bible only (no extras)';
    var pers = s.personalization.length
      ? s.personalization.map(function (k) { return labelFor(PERSONALIZATION, k); }).join(', ')
      : 'None';
    var details = renderCustomDetailsHtml(s.customDetails || {});
    return '' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.essentials) + '</dd>' +
        '<dt>Recipient</dt><dd>' + escapeHtml(recipientLabel(s.recipient)) + '</dd>' +
        '<dt>What\'s included</dt><dd>' + escapeHtml(items) + '</dd>' +
        '<dt>Personal touches</dt><dd>' + escapeHtml(pers) + '</dd>' +
      '</dl>' +
      details +
      '<p style="color:var(--muted);font-size:0.9rem;line-height:1.55;margin:0">Bible at our $2 ministry rate · roughly $7 shipping with the full kit · we\'ll confirm the exact total with you. Made-to-order items take 2-3 weeks.</p>';
  }

  function renderCustomDetailsHtml(details) {
    var keys = Object.keys(details || {}).filter(function (k) { return (details[k] || '').trim(); });
    if (!keys.length) return '';
    var rows = keys.map(function (k) {
      return '<dt>' + escapeHtml(labelFor(PERSONALIZATION, k)) + '</dt><dd><em>' + escapeHtml(details[k].trim()) + '</em></dd>';
    }).join('');
    return '<dl class="journey-review__list" style="margin-top:0.5rem">' + rows + '</dl>';
  }

  function renderLifegroupReview(s) {
    var namesItems = s.perBibleNames.map(function (n, i) {
      var v = (n && n.trim()) ? escapeHtml(n.trim()) : '<em>(no engraving)</em>';
      return '<li>' + (i + 1) + '. ' + v + '</li>';
    }).join('');
    var theme = COVER_THEMES.find(function (t) { return t.key === s.groupIdentity.coverTheme; });
    var addons = s.essentialsAddOns.length
      ? s.essentialsAddOns.map(function (k) { return labelFor(ESSENTIALS_ITEMS, k); }).join(', ') + ' × ' + s.quantity
      : 'None';
    return '' +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.lifegroup) + '</dd>' +
        '<dt>Quantity</dt><dd>' + s.quantity + ' Bibles ($' + (2 * s.quantity) + ' base)</dd>' +
        '<dt>Group name</dt><dd>' + (s.groupIdentity.groupName ? escapeHtml(s.groupIdentity.groupName) : '<em>None</em>') + '</dd>' +
        '<dt>Cover theme</dt><dd>' + escapeHtml(theme ? theme.label : 'No theme') + '</dd>' +
        '<dt>Engraving</dt><dd><ol style="margin:0;padding-left:1.4rem">' + namesItems + '</ol></dd>' +
        '<dt>Add-ons (per Bible)</dt><dd>' + escapeHtml(addons) + '</dd>' +
      '</dl>' +
      '<p style="color:var(--muted);font-size:0.9rem;line-height:1.55;margin:0">Bibles at our $2 ministry rate · we\'ll confirm shipping and engraving total with you directly.</p>';
  }

  function renderMinistryReview(s) {
    var qty = s.volumeTier === 'custom' ? s.customQuantity : s.volumeTier;
    var addons = s.addOns.length
      ? s.addOns.map(function (k) { return labelFor(MINISTRY_ADDONS, k); }).join(', ')
      : 'None';
    var anchor = ANCHOR_VERSES.find(function (v) { return v.key === s.outreach.anchorVerse; });
    var anchorHtml = anchor
      ? '<blockquote class="journey-review__verse">' + escapeHtml(anchor.text) + '<cite>— ' + escapeHtml(anchor.display) + '</cite></blockquote>'
      : '';
    return anchorHtml +
      '<dl class="journey-review__list">' +
        '<dt>Bundle</dt><dd>' + escapeHtml(BUNDLE_DISPLAY.ministry) + '</dd>' +
        '<dt>Quantity</dt><dd>' + qty + ' Bibles at our $2 ministry rate</dd>' +
        '<dt>Outreach</dt><dd>' + escapeHtml(s.outreach.eventName) + '</dd>' +
        '<dt>Location</dt><dd>' + escapeHtml(s.outreach.location) + '</dd>' +
        '<dt>Event date</dt><dd>' + escapeHtml(s.outreach.eventDate) + '</dd>' +
        '<dt>Add-ons</dt><dd>' + escapeHtml(addons) + '</dd>' +
      '</dl>' +
      '<p style="color:var(--muted);font-size:0.9rem;line-height:1.55;margin:0">This is a calling, not a checkout. We\'ll read your story personally and walk it through with you before any commitment is made.</p>';
  }

  // Plain-text version for Formspree configuration field.
  function renderConfigText(s) {
    var lines = [];
    lines.push('Bundle: ' + BUNDLE_DISPLAY[s.bundle]);
    if (s.bundle === 'essentials') {
      lines.push('Recipient: ' + recipientLabel(s.recipient));
      lines.push('Items: ' + (s.essentialsItems.length ? s.essentialsItems.map(function (k) { return labelFor(ESSENTIALS_ITEMS, k); }).join(', ') : 'Bible only'));
      lines.push('Personal touches: ' + (s.personalization.length ? s.personalization.map(function (k) { return labelFor(PERSONALIZATION, k); }).join(', ') : 'None'));
      var det = s.customDetails || {};
      var keys = Object.keys(det).filter(function (k) { return (det[k] || '').trim(); });
      if (keys.length) {
        lines.push('');
        lines.push('Custom details:');
        keys.forEach(function (k) {
          lines.push('  ' + labelFor(PERSONALIZATION, k) + ': ' + det[k].trim());
        });
      }
    }
    if (s.bundle === 'lifegroup') {
      lines.push('Quantity: ' + s.quantity);
      lines.push('Group name: ' + (s.groupIdentity.groupName || '(none)'));
      var t = COVER_THEMES.find(function (x) { return x.key === s.groupIdentity.coverTheme; });
      lines.push('Cover theme: ' + (t ? t.label : 'No theme'));
      lines.push('Engraving:');
      s.perBibleNames.forEach(function (n, i) {
        lines.push('  ' + (i + 1) + '. ' + (n.trim() ? n.trim() : '(skipped)'));
      });
      lines.push('Add-ons (per Bible): ' + (s.essentialsAddOns.length ? s.essentialsAddOns.map(function (k) { return labelFor(ESSENTIALS_ITEMS, k); }).join(', ') : 'None'));
      if (Array.isArray(s.personalization) && s.personalization.length) {
        lines.push('Personal touches: ' + s.personalization.map(function (k) { return labelFor(PERSONALIZATION, k); }).join(', '));
      }
      var lgDet = s.customDetails || {};
      var lgKeys = Object.keys(lgDet).filter(function (k) { return (lgDet[k] || '').trim(); });
      if (lgKeys.length) {
        lines.push('');
        lines.push('Custom details:');
        lgKeys.forEach(function (k) {
          lines.push('  ' + labelFor(PERSONALIZATION, k) + ': ' + lgDet[k].trim());
        });
      }
    }
    if (s.bundle === 'ministry') {
      var qty = s.volumeTier === 'custom' ? s.customQuantity : s.volumeTier;
      lines.push('Quantity: ' + qty + ' Bibles');
      lines.push('Outreach: ' + s.outreach.eventName);
      lines.push('Location: ' + s.outreach.location);
      lines.push('Event date: ' + s.outreach.eventDate);
      var v = ANCHOR_VERSES.find(function (x) { return x.key === s.outreach.anchorVerse; });
      lines.push('Anchor verse: ' + (v ? v.display : 'None'));
      lines.push('Add-ons: ' + (s.addOns.length ? s.addOns.map(function (k) { return labelFor(MINISTRY_ADDONS, k); }).join(', ') : 'None'));
    }
    return lines.join('\n');
  }

  // ── Bootstrap ────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Load site config in parallel — if it lands before submit
    // happens, we use the Apps Script path; otherwise we fall back.
    loadSiteConfig();
    var params = new URLSearchParams(window.location.search);
    var payload = params.get('c');
    var layout = document.getElementById('review-layout');
    var errBox = document.getElementById('review-error');

    if (!payload) {
      if (layout) layout.hidden = true;
      if (errBox) errBox.hidden = false;
      return;
    }

    var state = decodePayload(payload);
    if (!state) {
      if (layout) layout.hidden = true;
      if (errBox) errBox.hidden = false;
      return;
    }

    // Render review summary on the left.
    var summary = document.getElementById('review-summary');
    if (state.bundle === 'essentials')      summary.innerHTML = renderEssentialsReview(state);
    else if (state.bundle === 'lifegroup')  summary.innerHTML = renderLifegroupReview(state);
    else if (state.bundle === 'ministry')   summary.innerHTML = renderMinistryReview(state);

    // Tweak hero / form copy for Ministry.
    if (state.bundle === 'ministry') {
      var heroT = document.getElementById('review-hero-title');
      var heroS = document.getElementById('review-hero-tagline');
      var formT = document.getElementById('review-form-title');
      var dedL  = document.getElementById('review-dedication-label');
      var subBtn = document.getElementById('review-submit-btn');
      if (heroT) heroT.textContent = 'Tell us your story';
      if (heroS) heroS.textContent = 'We read every one personally — no automated billing, no rush.';
      if (formT) formT.textContent = 'Send us your story';
      if (dedL)  dedL.textContent  = 'Anything else you\'d like our team to know?';
      if (subBtn) subBtn.textContent = 'Send my story →';
    }

    // Set the hidden fields used by Formspree.
    var subjectField = document.getElementById('review-subject');
    var configField  = document.getElementById('review-config-text');
    if (subjectField) subjectField.value = 'STW Bundle Order — ' + BUNDLE_DISPLAY[state.bundle];
    if (configField)  configField.value  = renderConfigText(state);

    // Back-to-customize.
    var backBtn = document.getElementById('review-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (window.history.length > 1) window.history.back();
        else window.location.assign('store.html');
      });
    }

    // Render the conditional giftee section (essentials/lifegroup only).
    renderGifteeSection(state);

    // Form submit.
    var form = document.getElementById('review-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name  = form.querySelector('[name="name"]').value.trim();
        var email = form.querySelector('[name="email"]').value.trim();
        var del   = form.querySelector('[name="delivery_details"]').value.trim();
        var errEl = document.getElementById('review-form-error');
        var firstInvalid = null;
        var msgs = [];
        if (!name) { msgs.push('Your name is required.'); firstInvalid = firstInvalid || form.querySelector('[name="name"]'); }
        if (!email || email.indexOf('@') === -1) { msgs.push('A valid email is required.'); firstInvalid = firstInvalid || form.querySelector('[name="email"]'); }
        if (!del && state.bundle !== 'ministry') {
          msgs.push('Delivery details are required.');
          firstInvalid = firstInvalid || form.querySelector('[name="delivery_details"]');
        }

        // Giftee opt-in validation (essentials + lifegroup only).
        var giftee = collectGifteeFromForm(state);
        if (giftee && giftee.optIn) {
          if (!giftee.name) { msgs.push("Recipient's name is required when opting in."); firstInvalid = firstInvalid || document.getElementById('giftee-name'); }
          if (!giftee.email || giftee.email.indexOf('@') === -1) { msgs.push("Recipient's email looks invalid."); firstInvalid = firstInvalid || document.getElementById('giftee-email'); }
        }

        if (msgs.length) {
          errEl.textContent = msgs.join(' ');
          errEl.hidden = false;
          if (firstInvalid) firstInvalid.focus();
          return;
        }
        errEl.hidden = true;

        var btn = document.getElementById('review-submit-btn');
        var origLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending…';

        var jsonPayload = {
          bundle: state.bundle,
          gifter: {
            name: name,
            email: email,
            phone: form.querySelector('[name="phone"]').value.trim(),
            deliveryDetails: del || (state.bundle === 'ministry' ? 'not applicable' : ''),
            dedication: form.querySelector('[name="dedication"]').value.trim(),
          },
          giftee: giftee && giftee.optIn ? { optIn: true, name: giftee.name, email: giftee.email } : null,
          configuration: state,
          configText: renderConfigText(state),
          source: 'bundle-builder',
          submittedAt: new Date().toISOString(),
        };

        submitOrder(jsonPayload, form, btn, origLabel, errEl);
      });
    }
  });

  // ── Submit pipeline (Apps Script primary, Formspree fallback) ──
  function submitOrder(payload, form, btn, origLabel, errEl) {
    var url = siteConfig.orderHandlerUrl;
    if (!isUsableHandlerUrl(url)) {
      // No Apps Script configured — go straight to Formspree.
      return submitToFormspree(form, btn, origLabel, errEl, /*hint*/ true);
    }
    fetch(url, {
      method: 'POST',
      // text/plain avoids the CORS preflight (Apps Script returns
      // permissive Access-Control headers for simple requests only).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || json.ok !== true) throw new Error(json && json.error || 'unknown');
      renderThankYou(/*hint*/ false);
    }).catch(function () {
      // Apps Script path failed — fall back to Formspree so the
      // team still hears about the order.
      submitToFormspree(form, btn, origLabel, errEl, /*hint*/ true);
    });
  }

  function submitToFormspree(form, btn, origLabel, errEl, hint) {
    fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new FormData(form),
    }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      renderThankYou(hint);
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = origLabel; }
      if (errEl) {
        errEl.innerHTML = 'Couldn\'t reach our inbox. Please try again, or <a href="about.html#contact">email us directly</a> with your details.';
        errEl.hidden = false;
      }
    });
  }

  function renderThankYou(showHint) {
    var card = document.querySelector('.review-form-card');
    if (!card) return;
    var hintHtml = showHint
      ? '<p style="margin-top:0.85rem;color:var(--muted);font-size:0.85rem;line-height:1.5">' +
        'Heads-up — your automatic email receipt may not arrive. Our team will still see your order and reply manually.' +
      '</p>'
      : '';
    card.innerHTML = '<div class="review-thanks">' +
      '<h3>Thank you — we\'ve got it.</h3>' +
      '<p>Our team reviews every order personally. You\'ll hear back from us by email within a few days.</p>' +
      hintHtml +
      '<p style="margin-top:1.25rem"><a href="store.html" class="btn btn-secondary">← Back to the store</a></p>' +
    '</div>';
  }

  // ── Conditional giftee section ───────────────────────────────
  function renderGifteeSection(state) {
    var root = document.getElementById('review-giftee-root');
    if (!root) return;
    if (state.bundle === 'ministry') {
      root.innerHTML = '';
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.innerHTML =
      '<fieldset class="review-giftee" style="border:1px dashed rgba(212,165,116,0.5);border-radius:10px;padding:0.85rem 1rem 1rem;margin:1rem 0 0">' +
        '<legend style="padding:0 0.4rem;font-weight:700;font-size:0.92rem;color:var(--text)">Send a heads-up to the recipient?</legend>' +
        '<label style="display:flex;align-items:flex-start;gap:0.5rem;cursor:pointer;font-size:0.92rem;line-height:1.5">' +
          '<input type="checkbox" id="giftee-opt-in" name="giftee_opt_in" style="width:auto;margin-top:0.25rem">' +
          '<span>Yes — email them a short note from us so they know it\'s coming. <small style="color:var(--muted);display:block;margin-top:0.2rem">No follow-up emails, no marketing. One short, kind note.</small></span>' +
        '</label>' +
        '<div id="giftee-fields" hidden style="margin-top:0.85rem;display:flex;flex-direction:column;gap:0.6rem">' +
          '<div class="form-row" style="margin:0">' +
            '<label for="giftee-name">Their name *</label>' +
            '<input type="text" id="giftee-name" name="giftee_name" autocomplete="name">' +
          '</div>' +
          '<div class="form-row" style="margin:0">' +
            '<label for="giftee-email">Their email *</label>' +
            '<input type="email" id="giftee-email" name="giftee_email" autocomplete="email">' +
          '</div>' +
        '</div>' +
      '</fieldset>';
    var optIn = document.getElementById('giftee-opt-in');
    var fields = document.getElementById('giftee-fields');
    if (optIn && fields) {
      optIn.addEventListener('change', function () {
        fields.hidden = !optIn.checked;
        var n = document.getElementById('giftee-name');
        var em = document.getElementById('giftee-email');
        if (n) n.required = optIn.checked;
        if (em) em.required = optIn.checked;
      });
    }
  }

  function collectGifteeFromForm(state) {
    if (state.bundle === 'ministry') return null;
    var optIn = document.getElementById('giftee-opt-in');
    if (!optIn || !optIn.checked) return null;
    var n = document.getElementById('giftee-name');
    var e = document.getElementById('giftee-email');
    return {
      optIn: true,
      name: (n && n.value || '').trim(),
      email: (e && e.value || '').trim(),
    };
  }
})();
