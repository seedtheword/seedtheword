/* ============================================================
   prayer-intake.js

   Lazy card injection + modal for the Prayer Request Intake on
   community.html. Self-invoking module:
     1. On DOMContentLoaded, fetch assets/data/telegram-bot.json.
     2. If prayer.intake.enabled !== true, no-op (cards never enter
        the DOM — Requirement 2.6).
     3. Inject the .prayer-intake-row directly after the
        #telegram-stats dashboard card and before the existing
        .discussion__actions row.
     4. Lazy-inject the modal on the first card click (pattern
        parity with assets/js/share-story.js).

   Posts to cfg.endpointUrl as JSON:
     { action:"prayer-intake", kind, name, email, body, anonymous,
       extra_field_2 }

   Spec: .kiro/specs/prayer-request-intake/
   ============================================================ */

(function () {
  'use strict';

  let cfg = null;
  let modal = null;
  let lastFocus = null;

  // ── Bootstrap ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  async function boot() {
    cfg = await loadConfig();
    if (!cfg || cfg.enabled !== true) return;
    injectCards();
  }

  async function loadConfig() {
    try {
      const resp = await fetch('assets/data/telegram-bot.json?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return null;
      const json = await resp.json();
      const intake = (json && json.prayer && json.prayer.intake) || null;
      if (!intake) return null;
      return {
        enabled: intake.enabled === true,
        endpointUrl: String(intake.endpointUrl || '').trim(),
        bodyMinChars: Number(intake.bodyMinChars) || 10,
        bodyMaxChars: Number(intake.bodyMaxChars) || 2000,
      };
    } catch (_) {
      return null;
    }
  }

  // ── Card injection ────────────────────────────────────────────
  function injectCards() {
    const stats = document.getElementById('telegram-stats');
    if (!stats) return;
    // Insert the row directly after the .discussion__stats container,
    // which lives inside the .discussion wrapper alongside .discussion__actions.
    const statsWrap = stats.parentElement; // .discussion__stats already has stats; we want to add a sibling
    if (!statsWrap) return;

    const row = document.createElement('div');
    row.className = 'prayer-intake-row';
    row.innerHTML =
      '<article class="prayer-intake-card prayer-intake-card--prayer">' +
        '<div class="prayer-intake-card__icon" aria-hidden="true">🙏</div>' +
        '<h3 class="prayer-intake-card__title">Submit a Prayer Request</h3>' +
        '<p class="prayer-intake-card__subtitle">Quietly. Privately. Anonymously if you want.</p>' +
        '<p class="prayer-intake-card__reassure">' +
          'This stays between you and the prayer team. Posting anonymously is supported.' +
        '</p>' +
        '<button type="button" class="prayer-intake-card__cta" data-prayer-kind="prayer">' +
          'Open the form <span aria-hidden="true">→</span>' +
        '</button>' +
      '</article>' +
      '<article class="prayer-intake-card prayer-intake-card--thanksgiving">' +
        '<div class="prayer-intake-card__icon" aria-hidden="true">🤍</div>' +
        '<h3 class="prayer-intake-card__title">Submit a Thanksgiving Announcement</h3>' +
        '<p class="prayer-intake-card__subtitle">Quietly. Privately. Anonymously if you want.</p>' +
        '<p class="prayer-intake-card__reassure">' +
          'This stays between you and the prayer team. Posting anonymously is supported.' +
        '</p>' +
        '<button type="button" class="prayer-intake-card__cta" data-prayer-kind="thanksgiving">' +
          'Open the form <span aria-hidden="true">→</span>' +
        '</button>' +
      '</article>';

    // Insert directly after the .discussion__stats element (so the row sits
    // between the stats and the .discussion__actions card row).
    stats.insertAdjacentElement('afterend', row);

    // Wire the two CTAs.
    row.querySelectorAll('[data-prayer-kind]').forEach((btn) => {
      btn.addEventListener('click', () => openModal(btn.getAttribute('data-prayer-kind') || 'prayer'));
    });
  }

  // ── Modal (lazy-injected on first card click) ─────────────────
  function ensureModal() {
    if (modal) return modal;
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="prayer-intake-modal" class="prayer-intake-modal" role="dialog" ' +
           'aria-modal="true" aria-labelledby="prayer-intake-modal-title" hidden>' +
        '<div class="prayer-intake-modal__backdrop" id="prayer-intake-modal-backdrop"></div>' +
        '<div class="prayer-intake-modal__dialog" role="document">' +
          '<button type="button" class="prayer-intake-modal__close" ' +
                  'id="prayer-intake-modal-close" aria-label="Close">×</button>' +
          '<h2 id="prayer-intake-modal-title">Share with the prayer team</h2>' +
          '<form id="prayer-intake-form" novalidate>' +
            '<fieldset class="prayer-intake-form__kind">' +
              '<legend>What are you sharing?</legend>' +
              '<label><input type="radio" name="kind" value="prayer"> 🙏 Prayer request</label>' +
              '<label><input type="radio" name="kind" value="thanksgiving"> 🤍 Thanksgiving announcement</label>' +
            '</fieldset>' +
            '<label class="prayer-intake-form__field">' +
              '<span>Your name <em>(or check the box below to post anonymously)</em></span>' +
              '<input type="text" name="name" autocomplete="name" maxlength="120">' +
            '</label>' +
            '<label class="prayer-intake-form__field">' +
              '<span>Your email <em>(optional — get encouraging follow-ups)</em></span>' +
              '<input type="email" name="email" autocomplete="email" maxlength="200">' +
            '</label>' +
            '<label class="prayer-intake-form__field">' +
              '<span id="prayer-intake-body-label">What can we pray with you about?</span>' +
              '<textarea name="body" rows="6" maxlength="2200" required></textarea>' +
              '<span class="prayer-intake-form__counter" aria-live="polite">' +
                '<span id="prayer-intake-body-count">0</span> / 2000' +
              '</span>' +
            '</label>' +
            '<label class="prayer-intake-form__anon">' +
              '<input type="checkbox" name="anonymous">' +
              '<span>Post anonymously in the prayer group</span>' +
              '<small>The team will still see your name in the audit trail. Public Telegram post will say "from Anonymous". If you also share an email, the encouragement emails will start with "Friend" instead of your name.</small>' +
            '</label>' +
            // Honeypot — visually off-screen and aria-hidden.
            '<input type="text" name="extra_field_2" tabindex="-1" autocomplete="off" ' +
                   'aria-hidden="true" class="prayer-intake-form__honeypot">' +
            '<div class="prayer-intake-form__actions">' +
              '<button type="submit" id="prayer-intake-submit">Send</button>' +
              '<p id="prayer-intake-error" class="prayer-intake-form__error" hidden></p>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);

    modal = document.getElementById('prayer-intake-modal');
    const backdrop = document.getElementById('prayer-intake-modal-backdrop');
    const closeBtn = document.getElementById('prayer-intake-modal-close');
    const textarea = modal.querySelector('textarea[name="body"]');
    const counter = modal.querySelector('.prayer-intake-form__counter');
    const countEl = document.getElementById('prayer-intake-body-count');
    const submitBtn = document.getElementById('prayer-intake-submit');
    const form = document.getElementById('prayer-intake-form');

    backdrop.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    // Focus trap inside the dialog.
    modal.addEventListener('keydown', trapFocus);

    // Live char counter (Requirement 3.7, design §5.4).
    textarea.addEventListener('input', () => {
      const len = textarea.value.trim().length;
      countEl.textContent = String(len);
      counter.classList.remove('prayer-intake-form__counter--warn',
                               'prayer-intake-form__counter--over');
      if (len > 2000) {
        counter.classList.add('prayer-intake-form__counter--over');
        submitBtn.disabled = true;
      } else if (len > 1800) {
        counter.classList.add('prayer-intake-form__counter--warn');
        submitBtn.disabled = false;
      } else {
        submitBtn.disabled = false;
      }
    });

    form.addEventListener('submit', onSubmit);

    return modal;
  }

  function openModal(kind) {
    ensureModal();
    lastFocus = document.activeElement;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('prayer-intake-modal-open');

    // Reset form state and apply kind default.
    const form = document.getElementById('prayer-intake-form');
    form.reset();
    const radios = form.querySelectorAll('input[name="kind"]');
    radios.forEach((r) => { r.checked = (r.value === kind); });
    const submitBtn = document.getElementById('prayer-intake-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send';
    const errorEl = document.getElementById('prayer-intake-error');
    errorEl.hidden = true;
    errorEl.textContent = '';
    const countEl = document.getElementById('prayer-intake-body-count');
    countEl.textContent = '0';
    const counter = modal.querySelector('.prayer-intake-form__counter');
    counter.classList.remove('prayer-intake-form__counter--warn',
                             'prayer-intake-form__counter--over');

    // Focus the first natural input — name field.
    setTimeout(() => {
      const firstInput = form.querySelector('input[name="name"]');
      if (firstInput) firstInput.focus();
    }, 30);
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('prayer-intake-modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
  }

  function trapFocus(e) {
    if (e.key !== 'Tab' || modal.hidden) return;
    const focusables = modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ── Submit ────────────────────────────────────────────────────
  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = document.getElementById('prayer-intake-submit');
    const errorEl = document.getElementById('prayer-intake-error');
    errorEl.hidden = true;
    errorEl.textContent = '';

    const data = new FormData(form);
    const kind = String(data.get('kind') || '').trim();
    const name = String(data.get('name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const body = String(data.get('body') || '').trim();
    const anonymous = data.get('anonymous') === 'on';
    const honeypot = String(data.get('extra_field_2') || '');

    // Client-side validation.
    if (kind !== 'prayer' && kind !== 'thanksgiving') {
      return showError('Please pick prayer or thanksgiving.');
    }
    if (!anonymous && !name) {
      return showError('Please tell us your name, or check the anonymous box.');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showError('That email looks off — please check it.');
    }
    if (body.length < (cfg.bodyMinChars || 10)) {
      return showError('Please share a bit more so we know how to pray.');
    }
    if (body.length > (cfg.bodyMaxChars || 2000)) {
      return showError('Please trim down to ' + (cfg.bodyMaxChars || 2000) + ' characters.');
    }
    if (!cfg.endpointUrl) {
      return showError('The form is not yet wired up. Please reach us on Telegram.');
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    let resp;
    try {
      const r = await fetch(cfg.endpointUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'prayer-intake',
          kind: kind,
          name: name,
          email: email,
          body: body,
          anonymous: anonymous,
          extra_field_2: honeypot,
        }),
      });
      resp = await r.json();
    } catch (_) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
      return showError('Something went wrong. Please try again, or message us on Telegram.');
    }

    if (resp && resp.ok === true) {
      renderSuccess(resp, !!email);
      setTimeout(closeModal, 4000);
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send';

    if (resp && resp.error === 'rate-limit') {
      return showError("You've sent a few of these recently. Please wait a bit before submitting again.");
    }
    showError('Something went wrong. Please try again, or message us on Telegram.');
  }

  function showError(msg) {
    const errorEl = document.getElementById('prayer-intake-error');
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function renderSuccess(resp, hasEmail) {
    const dialog = modal.querySelector('.prayer-intake-modal__dialog');
    const truncated = resp && resp.truncated === true;
    const telegramFailed = resp && resp.telegram === 'failed';
    const dripEnabled = resp && resp.dripStatus === 'enabled';

    let inner = '';
    if (truncated) {
      inner +=
        '<p class="prayer-intake-form__error" style="display:block;background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:0.75rem 1rem;border-radius:8px;margin:0 0 1rem;">' +
          'Heads up — your note was a touch long, so we trimmed the tail before posting. The full text is in our audit log.' +
        '</p>';
    }
    if (telegramFailed) {
      inner +=
        '<p>Thank you. We received your note, and the team will see it shortly.</p>' +
        '<p style="color:#666;font-size:0.95em;">It\'s not yet posted into the prayer topic — we\'ll get it up there soon.</p>';
    } else {
      inner +=
        '<p style="font-family:Georgia,serif;font-size:1.2em;color:#2C5F2E;margin:0 0 0.75rem;">Thank you — your prayer is with the team.</p>';
      if (hasEmail && dripEnabled) {
        inner += '<p>We\'ll send you a verse to hold onto today, and a few quiet notes over the next two weeks.</p>';
      } else {
        inner += '<p>We\'re praying with you.</p>';
      }
    }

    dialog.innerHTML =
      '<button type="button" class="prayer-intake-modal__close" id="prayer-intake-modal-close" aria-label="Close">×</button>' +
      '<h2 id="prayer-intake-modal-title">Received 💌</h2>' +
      '<div class="prayer-intake-form__success">' + inner + '</div>';

    const closeBtn = document.getElementById('prayer-intake-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
  }
})();
