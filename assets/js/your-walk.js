/* ============================================================
   your-walk.js — Your Walk reading tracker

   Lives on community.html. Renders the "Your Walk" panel just
   under the hero, before the existing "📖 This Week in God's Word"
   section. State machine (mutually exclusive states):

     no-token-no-email   → CTA "Save your walk"
     email-modal-open    → modal with email input
     link-request-pending→ submitting walkLinkRequest
     check-your-inbox    → server returned ok:true,status:'sent'
     email-modal-error   → rate-limited or network error
     has-token-syncing   → token present, awaiting walkSync
     has-token-active    → walkSync ok; streak callout + stamp btn
     token-expired       → walkSync returned bad-token
     stamping            → between stamp click and response
     celebration-shown   → small in-panel card after a new badge
     share-modal-open    → opt-in share modal
     share-submitting    → POSTing the story
     revoking            → POSTing walkRevoke

   Reads:
     assets/data/telegram-bot.json#yourWalk
     assets/data/badges.json
   Posts to:
     yourWalk.endpointUrl  (action: walkLinkRequest|Stamp|Sync|Revoke)
     yourWalk.endpointUrl  (type:   story  — for the opt-in share)
   localStorage:
     stw.walk.token   stw.walk.email   stw.walk.shown   stw.walk.lastSync

   Spec: .kiro/specs/your-walk-tracker/
   ============================================================ */
(function () {
  'use strict';

  // ── Module-level state ────────────────────────────────────────
  var cfg = null;
  var badgeCatalog = [];        // Array of badge objects from badges.json
  var state = 'boot';
  var panelEl = null;
  var emailModal = null;
  var shareModal = null;
  var lastFocus = null;
  var lastSync = null;          // last successful walkSync / walkStamp snapshot
  var alreadyStampedToday = false;

  // ── Bootstrap ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  async function boot() {
    cfg = await loadConfig();
    if (!cfg || cfg.enabled !== true || !cfg.endpointUrl) return;

    badgeCatalog = await loadBadges();

    panelEl = document.getElementById('your-walk');
    if (!panelEl) return;

    // 1. URL token extraction (must happen before any other state read).
    try {
      var url = new URL(window.location.href);
      var fromUrl = url.searchParams.get('walk');
      if (fromUrl && /^[0-9a-f]{64}$/.test(fromUrl)) {
        localStorage.setItem('stw.walk.token', fromUrl);
        url.searchParams.delete('walk');
        history.replaceState(null, '', url.toString());
      }
    } catch (_) { /* URL constructor failed — proceed without */ }

    var token = safeGet('stw.walk.token');

    if (!token) {
      setState('no-token-no-email');
      return;
    }

    // 2. Render last-known snapshot immediately (offline-friendly), then sync.
    lastSync = readCachedSync();
    if (lastSync) {
      // Mark "already stamped today" using cached today vs. lastStampDate.
      var todayLocal = ymdLocal_(new Date());
      alreadyStampedToday = !!(lastSync.streak && lastSync.streak.lastStampDate === todayLocal);
      setState('has-token-active', lastSync);
    } else {
      setState('has-token-syncing');
    }

    syncWithServer();
  }

  async function loadConfig() {
    try {
      var r = await fetch('assets/data/telegram-bot.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      var j = await r.json();
      var y = (j && j.yourWalk) || null;
      if (!y) return null;
      return {
        enabled: y.enabled === true,
        endpointUrl: String(y.endpointUrl || '').trim(),
        tokenTtlDays: Number(y.tokenTtlDays) || 30,
        graceDays: Number(y.graceDays) || 3,
        linkRateLimitPerDay: Number(y.linkRateLimitPerDay) || 3,
      };
    } catch (_) { return null; }
  }

  async function loadBadges() {
    try {
      var r = await fetch('assets/data/badges.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return [];
      var j = await r.json();
      return Array.isArray(j && j.badges) ? j.badges : [];
    } catch (_) { return []; }
  }

  // ── Networking ────────────────────────────────────────────────
  async function postJson(url, body) {
    var r = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async function syncWithServer() {
    var token = safeGet('stw.walk.token');
    if (!token) { setState('no-token-no-email'); return; }
    var resp;
    try {
      resp = await postJson(cfg.endpointUrl, {
        action: 'walkSync',
        token: token,
        extra_field_2: '',
      });
    } catch (_) {
      // Network unavailable — keep showing whatever we already rendered.
      return;
    }
    if (resp && resp.ok === true) {
      lastSync = resp;
      writeCachedSync(resp);
      // Sync the shown set so any badge already in resp.badges.all is
      // not later re-fired by a buggy walkStamp response.
      mergeShownFromAll((resp.badges && resp.badges.all) || []);
      var todayLocal = resp.today || ymdLocal_(new Date());
      alreadyStampedToday = !!(resp.streak && resp.streak.lastStampDate === todayLocal);
      setState('has-token-active', resp);
      return;
    }
    if (resp && resp.error === 'bad-token') {
      try { localStorage.removeItem('stw.walk.token'); } catch (_) {}
      setState('token-expired');
      return;
    }
    // Other errors: leave the cached panel in place, do nothing loud.
  }

  // ── State machine + render ───────────────────────────────────
  function setState(next, ctx) {
    state = next;
    switch (next) {
      case 'no-token-no-email':  renderNotSaved(); break;
      case 'has-token-syncing':  renderSyncing(); break;
      case 'has-token-active':   renderActive(ctx || lastSync || {}); break;
      case 'token-expired':      renderTokenExpired(); break;
      case 'check-your-inbox':   renderCheckInbox(ctx); break;
      case 'stamping':           renderStamping(); break;
      // email-modal-open / share-modal-open / link-request-pending /
      // email-modal-error / share-submitting / revoking are
      // modal-internal states; the panel keeps its current render.
    }
    // Reveal the panel once we know what to draw.
    if (panelEl && panelEl.hasAttribute('hidden')) panelEl.removeAttribute('hidden');
  }

  function renderNotSaved() {
    panelEl.innerHTML =
      '<div class="your-walk__inner your-walk__inner--cta">' +
        '<h2 class="your-walk__title">Your Walk</h2>' +
        '<p class="your-walk__lede">' +
          'Save your walk and we will keep your streak quietly across devices — ' +
          'no account, just a magic link from your inbox.' +
        '</p>' +
        '<button type="button" class="your-walk__cta" data-walk-action="open-email-modal">' +
          'Save your walk' +
        '</button>' +
      '</div>';
    bindActions(panelEl);
  }

  function renderSyncing() {
    panelEl.innerHTML =
      '<div class="your-walk__inner your-walk__inner--syncing">' +
        '<h2 class="your-walk__title">Your Walk</h2>' +
        '<p class="your-walk__lede">Loading your walk…</p>' +
      '</div>';
  }

  function renderActive(snapshot) {
    var streak = (snapshot && snapshot.streak) || { current: 0 };
    var totals = (snapshot && snapshot.totals) || { stamps: 0 };
    var callout = streakCalloutCopy(streak.current || 0);
    var disabled = alreadyStampedToday;
    var stampLabel = disabled ? 'Read today — see you tomorrow' : 'I read today';

    panelEl.innerHTML =
      '<div class="your-walk__inner your-walk__inner--active">' +
        '<button type="button" class="your-walk__settings" ' +
                'data-walk-action="open-settings" aria-label="Walk settings">···</button>' +
        '<h2 class="your-walk__title">Your Walk</h2>' +
        '<p class="your-walk__streak" data-streak-current="' + escapeHtml(String(streak.current || 0)) + '">' +
          escapeHtml(callout) +
        '</p>' +
        '<p class="your-walk__totals">' +
          escapeHtml(totalsLine(totals)) +
        '</p>' +
        '<button type="button" class="your-walk__cta" data-walk-action="stamp"' +
          (disabled ? ' disabled aria-disabled="true"' : '') + '>' +
          escapeHtml(stampLabel) +
        '</button>' +
      '</div>';
    bindActions(panelEl);
  }

  function renderTokenExpired() {
    panelEl.innerHTML =
      '<div class="your-walk__inner your-walk__inner--cta">' +
        '<h2 class="your-walk__title">Your Walk</h2>' +
        '<p class="your-walk__lede">' +
          'This link has expired. Save your walk again and we will email a fresh one.' +
        '</p>' +
        '<button type="button" class="your-walk__cta" data-walk-action="open-email-modal">' +
          'Save your walk again' +
        '</button>' +
      '</div>';
    bindActions(panelEl);
  }

  function renderCheckInbox(opts) {
    var email = (opts && opts.email) || safeGet('stw.walk.email') || '';
    panelEl.innerHTML =
      '<div class="your-walk__inner your-walk__inner--inbox">' +
        '<h2 class="your-walk__title">Your Walk</h2>' +
        '<p class="your-walk__lede">' +
          'Check your inbox' + (email ? ' (' + escapeHtml(email) + ')' : '') +
          ' — the link is on its way. Open it on the device you read on.' +
        '</p>' +
      '</div>';
  }

  function renderStamping() {
    // Render in-place: leave the active layout but visually mark the button.
    var btn = panelEl.querySelector('[data-walk-action="stamp"]');
    if (btn) {
      btn.setAttribute('disabled', 'disabled');
      btn.setAttribute('aria-disabled', 'true');
      btn.textContent = 'Stamping…';
    }
  }

  // ── Streak callout copy table (Requirement 2.4 + design §5.3) ─
  // EXACT — do not adjust without spec change.
  //   0 → "Welcome."
  //   1 → "first day back — welcome."
  //   n ≥ 2 → "n days in a row · keep going"
  // The em-dash is U+2014; the middle dot is U+00B7.
  function streakCalloutCopy(n) {
    if (n <= 0)  return 'Welcome.';
    if (n === 1) return 'first day back \u2014 welcome.';
    return n + ' days in a row \u00b7 keep going';
  }

  function totalsLine(totals) {
    var n = Number((totals && totals.stamps) || 0);
    return n + ' day' + (n === 1 ? '' : 's') + ' read so far.';
  }

  // ── Action binding (event delegation for one-action buttons) ──
  function bindActions(root) {
    if (!root) return;
    var nodes = root.querySelectorAll('[data-walk-action]');
    for (var i = 0; i < nodes.length; i++) {
      var btn = nodes[i];
      // Avoid double-binding by replacing the listener.
      btn.addEventListener('click', onActionClick);
    }
  }

  function onActionClick(e) {
    var btn = e.currentTarget;
    var action = btn && btn.getAttribute('data-walk-action');
    switch (action) {
      case 'open-email-modal':       openEmailModal(); break;
      case 'stamp':                  stampToday(); break;
      case 'open-settings':          openSettings(); break;
      case 'share-open':             openShareModal(btn.getAttribute('data-walk-badge')); break;
      case 'celebration-dismiss':    dismissCelebration(btn); break;
    }
  }

  // ── Email modal lifecycle ─────────────────────────────────────
  function ensureEmailModal() {
    if (emailModal) return emailModal;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="your-walk-modal" class="your-walk-modal" role="dialog" ' +
           'aria-modal="true" aria-labelledby="your-walk-modal-title" hidden>' +
        '<div class="your-walk-modal__backdrop" id="your-walk-modal-backdrop"></div>' +
        '<div class="your-walk-modal__dialog" role="document">' +
          '<button type="button" class="your-walk-modal__close" ' +
                  'id="your-walk-modal-close" aria-label="Close">×</button>' +
          '<h2 id="your-walk-modal-title">Save your walk</h2>' +
          '<p class="your-walk-form__lede">' +
            'We will email you a one-tap link. The link is the credential — no password, ' +
            'no account. The link follows you to whichever device you click it on.' +
          '</p>' +
          '<form id="your-walk-form" novalidate>' +
            '<label class="your-walk-form__field">' +
              '<span>Your email</span>' +
              '<input type="email" name="email" autocomplete="email" maxlength="200" required>' +
            '</label>' +
            '<input type="text" name="extra_field_2" tabindex="-1" autocomplete="off" ' +
                   'aria-hidden="true" class="your-walk-form__honeypot">' +
            '<div class="your-walk-form__actions">' +
              '<button type="submit" id="your-walk-form-submit">Send my link</button>' +
              '<p id="your-walk-form-error" class="your-walk-form__error" hidden></p>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);

    emailModal = document.getElementById('your-walk-modal');
    var backdrop = document.getElementById('your-walk-modal-backdrop');
    var closeBtn = document.getElementById('your-walk-modal-close');
    var form = document.getElementById('your-walk-form');

    backdrop.addEventListener('click', closeEmailModal);
    closeBtn.addEventListener('click', closeEmailModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && emailModal && !emailModal.hidden) closeEmailModal();
    });
    emailModal.addEventListener('keydown', function (e) { trapFocus(emailModal, e); });
    form.addEventListener('submit', onEmailSubmit);

    return emailModal;
  }

  function openEmailModal() {
    ensureEmailModal();
    lastFocus = document.activeElement;
    emailModal.hidden = false;
    emailModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('your-walk-modal-open');

    var form = document.getElementById('your-walk-form');
    form.reset();
    var submitBtn = document.getElementById('your-walk-form-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send my link';
    var errorEl = document.getElementById('your-walk-form-error');
    errorEl.hidden = true;
    errorEl.textContent = '';

    setTimeout(function () {
      var input = form.querySelector('input[name="email"]');
      if (input) input.focus();
    }, 30);
  }

  function closeEmailModal() {
    if (!emailModal || emailModal.hidden) return;
    emailModal.hidden = true;
    emailModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('your-walk-modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
  }

  async function onEmailSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var submitBtn = document.getElementById('your-walk-form-submit');
    var errorEl = document.getElementById('your-walk-form-error');
    errorEl.hidden = true;
    errorEl.textContent = '';

    var data = new FormData(form);
    var email = String(data.get('email') || '').trim().toLowerCase();
    var honeypot = String(data.get('extra_field_2') || '');

    if (!email) {
      errorEl.hidden = false;
      errorEl.textContent = 'Please enter your email.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.hidden = false;
      errorEl.textContent = 'That email looks off — please check it.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    state = 'link-request-pending';

    var resp;
    try {
      resp = await postJson(cfg.endpointUrl, {
        action: 'walkLinkRequest',
        email: email,
        extra_field_2: honeypot,
      });
    } catch (_) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send my link';
      errorEl.hidden = false;
      errorEl.textContent = 'Something went wrong. Please try again in a moment.';
      state = 'email-modal-error';
      return;
    }

    if (resp && resp.ok === true) {
      try { localStorage.setItem('stw.walk.email', email); } catch (_) {}
      closeEmailModal();
      setState('check-your-inbox', { email: email });
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send my link';
    state = 'email-modal-error';
    if (resp && resp.error === 'rate-limited') {
      errorEl.hidden = false;
      errorEl.textContent = 'You can request another link in a few hours. ' +
        'Check your inbox for the most recent one.';
      return;
    }
    if (resp && resp.error === 'disabled') {
      errorEl.hidden = false;
      errorEl.textContent = 'The walk tracker is paused right now.';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = 'Something went wrong. Please try again, or message us on Telegram.';
  }

  // ── Stamp action ──────────────────────────────────────────────
  async function stampToday() {
    if (state === 'stamping') return;
    if (alreadyStampedToday) return;
    setState('stamping');
    var token = safeGet('stw.walk.token');
    if (!token) { setState('no-token-no-email'); return; }
    var today = ymdLocal_(new Date());
    var anchor = currentLayeredPlanAnchor_();

    var resp;
    try {
      resp = await postJson(cfg.endpointUrl, {
        action: 'walkStamp',
        token: token,
        today: today,
        anchor: anchor,
        extra_field_2: '',
      });
    } catch (_) {
      // Soft-degrade: render the cached snapshot back as-is.
      setState('has-token-active', lastSync || {});
      return;
    }

    if (!resp || resp.ok !== true) {
      if (resp && resp.error === 'bad-token') {
        try { localStorage.removeItem('stw.walk.token'); } catch (_) {}
        setState('token-expired');
        return;
      }
      setState('has-token-active', lastSync || {});
      return;
    }

    // Persist as last sync.
    var merged = Object.assign({}, lastSync || {}, resp);
    lastSync = merged;
    writeCachedSync(merged);
    alreadyStampedToday = true;
    setState('has-token-active', merged);

    // Celebration: at most one card per page load, in catalog order.
    var newly = (resp.badges && resp.badges.newlyUnlocked) || [];
    if (!newly.length) return;
    var ordered = orderByCatalog(newly);
    for (var i = 0; i < ordered.length; i++) {
      var bid = ordered[i];
      if (!hasBeenShown(bid)) {
        markShown(bid);
        showCelebration(bid);
        break;
      }
    }
  }

  // ── Celebration card (design §5.5) ────────────────────────────
  // Rendered INSIDE the panel, never as a separate modal.
  // Auto-collapses after 8 seconds.
  // Two buttons: "share what you noticed" (opens share modal) and "not now".
  function showCelebration(badgeId) {
    var badge = (badgeCatalog || []).find(function (b) { return b && b.id === badgeId; });
    if (!badge) return;
    var inner = panelEl.querySelector('.your-walk__inner');
    if (!inner) return;
    var card = document.createElement('div');
    card.className = 'your-walk__celebration';
    card.setAttribute('data-walk-badge', badgeId);
    card.innerHTML =
      '<p class="your-walk__celebration-headline">' + escapeHtml(badge.name || '') + '</p>' +
      '<p class="your-walk__celebration-desc">' + escapeHtml(badge.description || '') + '</p>' +
      '<div class="your-walk__celebration-actions">' +
        '<button type="button" class="your-walk__celebration-share" ' +
                'data-walk-action="share-open" data-walk-badge="' + escapeHtml(badgeId) + '">' +
          'share what you noticed' +
        '</button>' +
        '<button type="button" class="your-walk__celebration-dismiss" ' +
                'data-walk-action="celebration-dismiss">' +
          'not now' +
        '</button>' +
      '</div>';
    inner.appendChild(card);
    state = 'celebration-shown';
    setTimeout(function () {
      card.classList.add('your-walk__celebration--collapsed');
    }, 8000);
    bindActions(card);
  }

  function dismissCelebration(btn) {
    var card = btn && btn.closest && btn.closest('.your-walk__celebration');
    if (card) card.classList.add('your-walk__celebration--collapsed');
    state = 'has-token-active';
  }

  // ── Share modal (design §5.6) — opt-in only, posts to existing
  //    Stories intake (type:'story'). NO new server handler.
  function ensureShareModal() {
    if (shareModal) return shareModal;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="your-walk-share-modal" class="your-walk-modal your-walk-share-modal" ' +
           'role="dialog" aria-modal="true" aria-labelledby="your-walk-share-title" hidden>' +
        '<div class="your-walk-modal__backdrop" id="your-walk-share-backdrop"></div>' +
        '<div class="your-walk-modal__dialog" role="document">' +
          '<button type="button" class="your-walk-modal__close" ' +
                  'id="your-walk-share-close" aria-label="Close">×</button>' +
          '<h2 id="your-walk-share-title">Share what you noticed</h2>' +
          '<p class="your-walk-form__lede">' +
            'A short paragraph — anything the Word stirred this round. ' +
            'It will go to the Stories team for a quiet read.' +
          '</p>' +
          '<form id="your-walk-share-form" novalidate>' +
            '<input type="hidden" name="badgeId" value="">' +
            '<label class="your-walk-form__field">' +
              '<span id="your-walk-share-label">What you noticed</span>' +
              '<textarea name="story" rows="6" maxlength="1500" required></textarea>' +
              '<span class="your-walk-form__counter" aria-live="polite">' +
                '<span id="your-walk-share-count">0</span> / 1500' +
              '</span>' +
            '</label>' +
            '<input type="text" name="extra_field_2" tabindex="-1" autocomplete="off" ' +
                   'aria-hidden="true" class="your-walk-form__honeypot">' +
            '<div class="your-walk-form__actions">' +
              '<button type="submit" id="your-walk-share-submit">Send</button>' +
              '<p id="your-walk-share-error" class="your-walk-form__error" hidden></p>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);

    shareModal = document.getElementById('your-walk-share-modal');
    var backdrop = document.getElementById('your-walk-share-backdrop');
    var closeBtn = document.getElementById('your-walk-share-close');
    var textarea = shareModal.querySelector('textarea[name="story"]');
    var countEl = document.getElementById('your-walk-share-count');
    var form = document.getElementById('your-walk-share-form');

    backdrop.addEventListener('click', closeShareModal);
    closeBtn.addEventListener('click', closeShareModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && shareModal && !shareModal.hidden) closeShareModal();
    });
    shareModal.addEventListener('keydown', function (e) { trapFocus(shareModal, e); });
    textarea.addEventListener('input', function () {
      countEl.textContent = String(textarea.value.length);
    });
    form.addEventListener('submit', onShareSubmit);

    return shareModal;
  }

  function openShareModal(badgeId) {
    ensureShareModal();
    lastFocus = document.activeElement;
    shareModal.hidden = false;
    shareModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('your-walk-modal-open');

    var form = document.getElementById('your-walk-share-form');
    form.reset();
    var hidden = form.querySelector('input[name="badgeId"]');
    if (hidden) hidden.value = badgeId || '';
    var submitBtn = document.getElementById('your-walk-share-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send';
    var errorEl = document.getElementById('your-walk-share-error');
    errorEl.hidden = true;
    errorEl.textContent = '';
    var countEl = document.getElementById('your-walk-share-count');
    countEl.textContent = '0';

    state = 'share-modal-open';

    setTimeout(function () {
      var ta = form.querySelector('textarea[name="story"]');
      if (ta) ta.focus();
    }, 30);
  }

  function closeShareModal() {
    if (!shareModal || shareModal.hidden) return;
    shareModal.hidden = true;
    shareModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('your-walk-modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
    state = 'has-token-active';
  }

  async function onShareSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var submitBtn = document.getElementById('your-walk-share-submit');
    var errorEl = document.getElementById('your-walk-share-error');
    errorEl.hidden = true;
    errorEl.textContent = '';

    var data = new FormData(form);
    var badgeId = String(data.get('badgeId') || '').trim();
    var story = String(data.get('story') || '').trim();
    var honeypot = String(data.get('extra_field_2') || '');

    if (!story) {
      errorEl.hidden = false;
      errorEl.textContent = 'Please write a few words first.';
      return;
    }
    if (story.length > 1500) {
      errorEl.hidden = false;
      errorEl.textContent = 'Please trim down to 1500 characters.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    state = 'share-submitting';

    var email = safeGet('stw.walk.email') || '';
    var name = 'A walker' + (email ? ' (' + email + ')' : '');

    var resp;
    try {
      resp = await postJson(cfg.endpointUrl, {
        type: 'story',
        name: name,
        email: email,
        story: story,
        consent: true,
        context: 'walk-badge:' + badgeId,
        extra_field_2: honeypot,
      });
    } catch (_) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
      errorEl.hidden = false;
      errorEl.textContent = 'Something went wrong. Please try again in a moment.';
      state = 'share-modal-open';
      return;
    }

    if (resp && resp.ok === true) {
      var dialog = shareModal.querySelector('.your-walk-modal__dialog');
      dialog.innerHTML =
        '<button type="button" class="your-walk-modal__close" aria-label="Close">×</button>' +
        '<h2>Thank you for sharing.</h2>' +
        '<p class="your-walk-form__lede">' +
          'The Stories team will read it quietly. Walk in peace.' +
        '</p>';
      var newClose = dialog.querySelector('.your-walk-modal__close');
      if (newClose) newClose.addEventListener('click', closeShareModal);
      setTimeout(closeShareModal, 3500);
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send';
    state = 'share-modal-open';
    errorEl.hidden = false;
    errorEl.textContent = 'Something went wrong. Please try again, or message us on Telegram.';
  }

  // ── Settings + revoke (design §5.8) ──────────────────────────
  function openSettings() {
    // No separate modal — design pins window.confirm() so the
    // irreversible action feels weighty without dressing up.
    revokeWalk();
  }

  async function revokeWalk() {
    var ok = window.confirm(
      'Stop tracking your walk and delete your data? Your streak, badges, and ' +
      'every day you stamped will be removed from our Sheet. There is no undo.'
    );
    if (!ok) return;
    var token = safeGet('stw.walk.token');
    state = 'revoking';
    try {
      if (token) {
        await postJson(cfg.endpointUrl, {
          action: 'walkRevoke',
          token: token,
          extra_field_2: '',
        });
      }
    } catch (_) { /* still proceed with local clear */ }

    // Clear ALL four slots regardless of server response (Requirement 9.7).
    try { localStorage.removeItem('stw.walk.token'); } catch (_) {}
    try { localStorage.removeItem('stw.walk.email'); } catch (_) {}
    try { localStorage.removeItem('stw.walk.shown'); } catch (_) {}
    try { localStorage.removeItem('stw.walk.lastSync'); } catch (_) {}
    lastSync = null;
    alreadyStampedToday = false;

    setState('no-token-no-email');
    var inner = panelEl.querySelector('.your-walk__inner');
    if (inner) {
      inner.insertAdjacentHTML('beforeend',
        '<p class="your-walk__revoke-confirm">' +
          'Your walk has been removed from our records. Walk in peace.' +
        '</p>');
    }
  }

  // ── Layered-plan anchor (design §5.7) ────────────────────────
  // Reads window.BiblePlan / window.LayeredPlan in the order the panel
  // visually shows them: NT walk first, then OT history, Poetry &
  // Prophecy, Psalm of the day, Proverb of the day. Returns
  // { book, chapter, stream } where stream ∈
  // {'nt','otHistory','poetryProphecy','psalm','proverbs',''}.
  function currentLayeredPlanAnchor_() {
    var today = new Date();

    // 1. NT walk anchor — the most prominent reading on the page.
    try {
      if (window.BiblePlan && typeof window.BiblePlan.getReadingForDate === 'function') {
        var nt = window.BiblePlan.getReadingForDate(today);
        if (nt && nt.book) {
          return { book: nt.book, chapter: nt.chapter || null, stream: 'nt' };
        }
      }
    } catch (_) {}

    var lp = window.LayeredPlan;
    if (!lp) return { book: '', chapter: null, stream: '' };

    // Pull the layered-plan config block we share with telegram-bot.json.
    var lpCfg = null;
    try {
      // Config is fetched on every page load by layered-plan.js, so we
      // re-fetch the same JSON synchronously via the cached config above.
      // We don't have the layered-plan cfg in scope here, so just call
      // each accessor with reasonable fallbacks; the accessors themselves
      // handle anchor=null gracefully or return null, which we skip.
    } catch (_) {}
    void lpCfg;

    // 2. OT history.
    try {
      if (typeof lp.getOtHistoryReading === 'function') {
        var oh = lp.getOtHistoryReading(today, null);
        if (oh && oh.book) {
          return { book: oh.book, chapter: oh.chapter || null, stream: 'otHistory' };
        }
      }
    } catch (_) {}

    // 3. Poetry & Prophecy.
    try {
      if (typeof lp.getPoetryProphecyReading === 'function') {
        var pp = lp.getPoetryProphecyReading(today, null);
        if (pp && pp.book) {
          return { book: pp.book, chapter: pp.chapter || null, stream: 'poetryProphecy' };
        }
      }
    } catch (_) {}

    // 4. Psalm of the day.
    try {
      if (typeof lp.psalmOfDay === 'function') {
        var psNum = lp.psalmOfDay(today, undefined);
        if (psNum) return { book: 'Psalm', chapter: psNum, stream: 'psalm' };
      }
    } catch (_) {}

    // 5. Proverb of the day.
    try {
      if (typeof lp.proverbOfDay === 'function') {
        var pvNum = lp.proverbOfDay(today, undefined);
        if (pvNum) return { book: 'Proverbs', chapter: pvNum, stream: 'proverbs' };
      }
    } catch (_) {}

    return { book: '', chapter: null, stream: '' };
  }

  // ── localStorage helpers ─────────────────────────────────────
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function readCachedSync() {
    try {
      var raw = localStorage.getItem('stw.walk.lastSync');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function writeCachedSync(snapshot) {
    try {
      // Strip newlyUnlocked before caching — celebrations should not
      // re-fire on a future page load even if the cache survives.
      var copy = Object.assign({}, snapshot);
      if (copy.badges) {
        copy.badges = Object.assign({}, copy.badges, { newlyUnlocked: [] });
      }
      localStorage.setItem('stw.walk.lastSync', JSON.stringify(copy));
    } catch (_) {}
  }

  function readShown() {
    try {
      var raw = localStorage.getItem('stw.walk.shown');
      if (!raw) return {};
      var j = JSON.parse(raw);
      return (j && typeof j === 'object') ? j : {};
    } catch (_) { return {}; }
  }

  function writeShown(map) {
    try { localStorage.setItem('stw.walk.shown', JSON.stringify(map || {})); } catch (_) {}
  }

  function hasBeenShown(badgeId) {
    return readShown()[badgeId] === 'celebrated';
  }

  function markShown(badgeId) {
    var m = readShown();
    m[badgeId] = 'celebrated';
    writeShown(m);
  }

  function mergeShownFromAll(allBadgeIds) {
    // Defense-in-depth (design §2.11): a badge already on the server
    // should never re-trigger a local celebration even if the server's
    // newlyUnlocked field is wrong.
    var m = readShown();
    var changed = false;
    for (var i = 0; i < (allBadgeIds || []).length; i++) {
      var bid = allBadgeIds[i];
      if (m[bid] !== 'celebrated') { m[bid] = 'celebrated'; changed = true; }
    }
    if (changed) writeShown(m);
  }

  function orderByCatalog(badgeIds) {
    var ids = badgeIds || [];
    if (!badgeCatalog || !badgeCatalog.length) return ids.slice();
    var out = [];
    for (var i = 0; i < badgeCatalog.length; i++) {
      var cid = badgeCatalog[i] && badgeCatalog[i].id;
      if (cid && ids.indexOf(cid) !== -1) out.push(cid);
    }
    // Append any ids the catalog did not know about, preserving input order.
    for (var j = 0; j < ids.length; j++) {
      if (out.indexOf(ids[j]) === -1) out.push(ids[j]);
    }
    return out;
  }

  // ── Date helpers ─────────────────────────────────────────────
  // Returns 'YYYY-MM-DD' in the browser's local timezone (not UTC).
  function ymdLocal_(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ── Focus trap shared by both modals ─────────────────────────
  function trapFocus(modalEl, e) {
    if (e.key !== 'Tab' || !modalEl || modalEl.hidden) return;
    var focusables = modalEl.querySelectorAll(
      'a[href], button:not([disabled]), ' +
      'input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), ' +
      'textarea:not([disabled]), select:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ── XSS guard ────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
