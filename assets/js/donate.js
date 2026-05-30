/* ============================================================
   donate.js

   Lazy modal + form for donate.html. Mirrors prayer-intake.js.
   Self-invoking module:
     1. On DOMContentLoaded, fetch assets/data/telegram-bot.json.
     2. If bibleDonate.enabled !== true, disable the CTA buttons
        (page still renders) — admins testing layout still see it.
     3. Read ?sign=<id> from the URL and attach to every payload.
     4. Lazy-inject the modal on the first CTA click.

   Posts to cfg.endpointUrl as JSON:
     { action: 'donateBible' | 'requestBible', signId, ...fields }

   Spec: .kiro/specs/bible-donate-request/
   ============================================================ */

(function () {
  'use strict';

  var cfg = null;
  var modal = null;
  var lastFocus = null;
  var signId = '';
  var currentFlow = 'donate';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  async function boot() {
    cfg = await loadConfig();

    // Read ?sign=<id> regardless of cfg state so we still capture
    // attribution even on a disabled-config page-load (the page is
    // not rendered with disabled cfg, but if a sign was scanned and
    // we're about to enable, we want the URL parameter accepted).
    try {
      var params = new URLSearchParams(window.location.search);
      signId = String(params.get('sign') || '').slice(0, 50);
    } catch (_) { signId = ''; }

    var ctas = document.querySelectorAll('[data-donate-flow]');
    if (!cfg || cfg.enabled !== true) {
      ctas.forEach(function (btn) {
        btn.disabled = true;
        btn.title = 'Form is being prepared — please check back soon.';
      });
      return;
    }
    ctas.forEach(function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn.getAttribute('data-donate-flow') || 'donate');
      });
    });
  }

  async function loadConfig() {
    try {
      var resp = await fetch('assets/data/telegram-bot.json?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return null;
      var json = await resp.json();
      var b = (json && json.bibleDonate) || null;
      if (!b) return null;
      return {
        enabled: b.enabled === true,
        endpointUrl: String(b.endpointUrl || '').trim(),
        storyMinChars: Number(b.storyMinChars) || 80,
        storyMaxChars: Number(b.storyMaxChars) || 1500,
      };
    } catch (_) { return null; }
  }

  // ── Modal lifecycle ─────────────────────────────────────────
  function ensureModal() {
    if (modal) return modal;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="donate-modal" class="donate-modal" role="dialog" aria-modal="true" ' +
           'aria-labelledby="donate-modal-title" hidden>' +
        '<div class="donate-modal__backdrop" id="donate-modal-backdrop"></div>' +
        '<div class="donate-modal__dialog" role="document">' +
          '<button type="button" class="donate-modal__close" id="donate-modal-close" aria-label="Close">×</button>' +
          '<h2 id="donate-modal-title">…</h2>' +
          '<p id="donate-modal-lead" class="donate-modal__lead"></p>' +
          '<form id="donate-form" novalidate>' +
            '<div id="donate-form-fields" class="donate-form__grid"></div>' +
            '<input type="text" name="extra_field_2" tabindex="-1" autocomplete="off" ' +
                   'aria-hidden="true" class="donate-form__honeypot">' +
            '<div class="donate-form__actions">' +
              '<button type="submit" id="donate-form-submit">Send</button>' +
              '<p id="donate-form-error" class="donate-form__error" hidden></p>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);

    modal = document.getElementById('donate-modal');
    document.getElementById('donate-modal-backdrop').addEventListener('click', closeModal);
    document.getElementById('donate-modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
    modal.addEventListener('keydown', trapFocus);
    document.getElementById('donate-form').addEventListener('submit', onSubmit);
    return modal;
  }

  function openModal(flow) {
    ensureModal();
    currentFlow = (flow === 'receive') ? 'receive' : 'donate';
    lastFocus = document.activeElement;
    var form = document.getElementById('donate-form');
    form.reset();
    form.dataset.flow = currentFlow;
    renderFormFields(currentFlow);
    var errorEl = document.getElementById('donate-form-error');
    errorEl.hidden = true;
    errorEl.textContent = '';
    var submit = document.getElementById('donate-form-submit');
    submit.disabled = false;
    submit.textContent = 'Send';
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('donate-modal-open');
    setTimeout(function () {
      var first = form.querySelector('input[name="name"]');
      if (first) first.focus();
    }, 30);
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('donate-modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
  }

  function trapFocus(e) {
    if (e.key !== 'Tab' || modal.hidden) return;
    var focusables = modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([aria-hidden="true"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  // ── Form fields per flow ────────────────────────────────────
  //
  // Each field is a self-contained .donate-form__field block:
  //   <div class="donate-form__field [donate-form__field--full]">
  //     <label for="...">Label <small class="donate-form__hint">…</small></label>
  //     <input ... />
  //   </div>
  //
  // The grid container (.donate-form__grid) lays them out 2-up on
  // wide screens, 1-up on phones. Fields that should span the whole
  // row carry --full.
  function renderFormFields(flow) {
    var fields = document.getElementById('donate-form-fields');
    var title = document.getElementById('donate-modal-title');
    var lead = document.getElementById('donate-modal-lead');

    if (flow === 'donate') {
      title.textContent = 'Offer a Bible';
      lead.textContent = "Tell us how to reach you and we'll coordinate the handoff. Most fields take a single tap.";
      fields.innerHTML =
        // Row 1: name (full)
        field({ name: 'name', label: 'Your name', required: true,
                type: 'text', autocomplete: 'name', maxLength: 80, full: true }) +
        // Row 2: email + phone (50/50)
        field({ name: 'email', label: 'Email', hint: 'Or phone',
                type: 'email', autocomplete: 'email', maxLength: 200 }) +
        field({ name: 'phone', label: 'Phone', hint: 'Or email',
                type: 'tel', autocomplete: 'tel', maxLength: 50 }) +
        // Row 3: count + city (50/50)
        field({ name: 'count', label: 'How many Bibles?', required: true,
                type: 'number', min: 1, max: 500, value: 1 }) +
        field({ name: 'city', label: 'City', hint: 'Optional',
                type: 'text', autocomplete: 'address-level2', maxLength: 60,
                placeholder: 'Everett' }) +
        // Row 4: state (full, narrow)
        field({ name: 'state', label: 'State',
                type: 'text', autocomplete: 'address-level1', maxLength: 2,
                value: 'WA' }) +
        // Spacer to leave the grid at 1 column for the remaining rows.
        '<div class="donate-form__field" aria-hidden="true"></div>' +
        // Row 5: handoff radio cards (full)
        radioCardsBlock({
          legend: 'How do you want to hand them off?',
          name: 'handoffMethod',
          required: true,
          options: [
            {
              value: 'dropoff',
              icon: '📍',
              title: "I'll drop them off",
              note: 'At a meeting, cookout, or a spot we coordinate.',
            },
            {
              value: 'pickup',
              icon: '🏠',
              title: "Pickup at my place",
              note: "We'll come to you. We text first to confirm.",
            },
          ],
        }) +
        // Row 6: note (full)
        field({ name: 'note', label: 'Anything you want to share with the team?',
                hint: 'Optional', textarea: true, rows: 3, maxLength: 500, full: true });
    } else {
      title.textContent = 'Request a Bible';
      lead.textContent = "Tell us a little about why you'd like a Bible. A couple of honest sentences are enough — we read every one.";
      fields.innerHTML =
        // Row 1: first name + email (50/50)
        field({ name: 'name', label: 'First name', required: true,
                type: 'text', autocomplete: 'given-name', maxLength: 60 }) +
        field({ name: 'email', label: 'Email', required: true,
                type: 'email', autocomplete: 'email', maxLength: 200 }) +
        // Row 2: phone + city (50/50)
        field({ name: 'phone', label: 'Phone', hint: 'Optional',
                type: 'tel', autocomplete: 'tel', maxLength: 50 }) +
        field({ name: 'city', label: 'City', required: true,
                type: 'text', autocomplete: 'address-level2', maxLength: 60,
                placeholder: 'Everett' }) +
        // Row 3: state (left half; right half empty)
        field({ name: 'state', label: 'State',
                type: 'text', autocomplete: 'address-level1', maxLength: 2,
                value: 'WA' }) +
        '<div class="donate-form__field" aria-hidden="true"></div>' +
        // Row 4: story (full)
        '<div class="donate-form__field donate-form__field--full">' +
          '<label for="donate-field-story" class="donate-form__label">' +
            "Why you'd like a Bible " +
            '<small class="donate-form__hint">A couple of honest sentences. We read every one.</small>' +
          '</label>' +
          '<textarea id="donate-field-story" name="story" rows="6" required ' +
            'minlength="' + cfg.storyMinChars + '" maxlength="' + cfg.storyMaxChars + '"></textarea>' +
          '<span class="donate-form__counter" aria-live="polite">' +
            '<span id="donate-story-count">0</span> / ' + cfg.storyMaxChars +
          '</span>' +
        '</div>';

      // Wire the live character counter on the story field.
      var ta = fields.querySelector('textarea[name="story"]');
      var counter = fields.querySelector('.donate-form__counter');
      var countEl = document.getElementById('donate-story-count');
      var submit = document.getElementById('donate-form-submit');
      ta.addEventListener('input', function () {
        var len = ta.value.trim().length;
        countEl.textContent = String(len);
        counter.classList.remove('donate-form__counter--warn', 'donate-form__counter--over');
        if (len > cfg.storyMaxChars) {
          counter.classList.add('donate-form__counter--over');
          submit.disabled = true;
        } else if (len > (cfg.storyMaxChars - 200)) {
          counter.classList.add('donate-form__counter--warn');
          submit.disabled = false;
        } else if (len > 0 && len < cfg.storyMinChars) {
          counter.classList.add('donate-form__counter--warn');
          submit.disabled = false;
        } else {
          submit.disabled = false;
        }
      });
    }
  }

  // Render a single labeled field (input or textarea).
  function field(opts) {
    var id = 'donate-field-' + opts.name;
    var labelHtml = escapeHtml(opts.label) +
      (opts.hint ? ' <small class="donate-form__hint">' + escapeHtml(opts.hint) + '</small>' : '');
    var wrapClass = 'donate-form__field' + (opts.full ? ' donate-form__field--full' : '');

    var inputAttrs =
      ' id="' + id + '"' +
      ' name="' + escapeHtml(opts.name) + '"' +
      (opts.required ? ' required' : '') +
      (opts.autocomplete ? ' autocomplete="' + escapeHtml(opts.autocomplete) + '"' : '') +
      (opts.maxLength != null ? ' maxlength="' + opts.maxLength + '"' : '') +
      (opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : '');

    var control;
    if (opts.textarea) {
      control = '<textarea' + inputAttrs +
        (opts.rows ? ' rows="' + opts.rows + '"' : '') +
        '></textarea>';
    } else {
      var typeAttr = ' type="' + escapeHtml(opts.type || 'text') + '"';
      var minAttr = (opts.min != null) ? ' min="' + opts.min + '"' : '';
      var maxAttr = (opts.max != null) ? ' max="' + opts.max + '"' : '';
      var valAttr = (opts.value != null) ? ' value="' + escapeHtml(String(opts.value)) + '"' : '';
      control = '<input' + typeAttr + inputAttrs + minAttr + maxAttr + valAttr + '>';
    }
    return '<div class="' + wrapClass + '">' +
      '<label for="' + id + '" class="donate-form__label">' + labelHtml + '</label>' +
      control +
    '</div>';
  }

  function radioCardsBlock(opts) {
    var cards = opts.options.map(function (o, i) {
      var id = 'donate-radio-' + opts.name + '-' + i;
      return '<label class="donate-form__radio-card" for="' + id + '">' +
        '<input type="radio" id="' + id + '" name="' + escapeHtml(opts.name) + '" ' +
          'value="' + escapeHtml(o.value) + '"' + (opts.required && i === 0 ? ' required' : '') + '>' +
        '<span class="donate-form__radio-card-icon" aria-hidden="true">' + escapeHtml(o.icon || '') + '</span>' +
        '<span class="donate-form__radio-card-body">' +
          '<strong>' + escapeHtml(o.title) + '</strong>' +
          (o.note ? '<small>' + escapeHtml(o.note) + '</small>' : '') +
        '</span>' +
      '</label>';
    }).join('');
    return '<fieldset>' +
      '<legend>' + escapeHtml(opts.legend) + '</legend>' +
      '<div class="donate-form__radio-grid">' + cards + '</div>' +
    '</fieldset>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Submit ──────────────────────────────────────────────────
  async function onSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var flow = form.dataset.flow || currentFlow;
    var submit = document.getElementById('donate-form-submit');
    var errorEl = document.getElementById('donate-form-error');
    errorEl.hidden = true;
    errorEl.textContent = '';

    var data = new FormData(form);
    var payload = {
      action: flow === 'donate' ? 'donateBible' : 'requestBible',
      signId: signId,
    };
    data.forEach(function (v, k) { payload[k] = v; });

    // Client-side validation matching the server's validators.
    if (flow === 'donate') {
      if (!String(payload.name || '').trim()) return showError('Please share your name.');
      if (!String(payload.email || '').trim() && !String(payload.phone || '').trim()) {
        return showError('Please share an email or a phone number so we can reach you.');
      }
      var c = parseInt(String(payload.count || ''), 10);
      if (!isFinite(c) || c < 1 || c > 500) return showError('Please share how many Bibles (1-500).');
      if (payload.handoffMethod !== 'dropoff' && payload.handoffMethod !== 'pickup') {
        return showError('Please pick drop-off or pickup.');
      }
    } else {
      if (!String(payload.name || '').trim()) return showError('Please share your first name.');
      if (!String(payload.email || '').trim()) return showError('We need an email to reach you.');
      if (!String(payload.city || '').trim()) return showError('Please share your city.');
      var storyLen = String(payload.story || '').trim().length;
      if (storyLen < cfg.storyMinChars) {
        return showError('Please share a little more — a couple of honest sentences.');
      }
      if (storyLen > cfg.storyMaxChars) {
        return showError('Please trim down to ' + cfg.storyMaxChars + ' characters.');
      }
    }

    if (!cfg.endpointUrl) {
      return showError('The form is not yet wired up. Please reach us via Telegram or our contact page.');
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';

    var resp;
    try {
      var r = await fetch(cfg.endpointUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      resp = await r.json();
    } catch (_) {
      submit.disabled = false;
      submit.textContent = 'Send';
      return showError('Something went wrong. Please try again, or message us on Telegram.');
    }

    if (resp && resp.ok === true) {
      renderSuccess(flow, resp);
      return;
    }

    submit.disabled = false;
    submit.textContent = 'Send';

    if (resp && resp.error === 'rate-limit') {
      return showError("You've sent a few of these recently. Please wait a bit before submitting again.");
    }
    if (resp && resp.error === 'disabled') {
      return showError('The form is currently paused. Please reach us via our contact page.');
    }
    if (resp && resp.error) {
      var humanCopy = ({
        'name-required':       'Please share your name.',
        'email-required':      'We need an email to reach you.',
        'bad-email':           'That email looks off — please check it.',
        'contact-required':    'Please share an email or a phone number.',
        'bad-count':           'Please share how many Bibles (1-500).',
        'bad-handoff':         'Please pick drop-off or pickup.',
        'note-too-long':       'Please trim your note.',
        'city-required':       'Please share your city.',
        'story-too-short':     'Please share a little more — a couple of honest sentences.',
        'story-too-long':      'Please trim your story.',
        'sheet-write-failed':  'Something went wrong on our side. Please try again.',
        'not-object':          'The form did not send correctly. Please refresh the page and try again.',
        'invalid-payload':     'The form did not send correctly. Please refresh the page and try again.',
      })[resp.error];
      // Diagnostic: log full response to the console so a user reporting
      // a problem can copy/paste it. Visible message includes the raw
      // error code when we don't have a friendly translation, so the
      // admin team can tell at a glance what went wrong on the wire.
      try { console.error('[donate] server response:', resp); } catch (_) {}
      return showError(humanCopy || ('Server error: ' + String(resp.error) +
        '. Please refresh and try again, or message us on Telegram if it keeps happening.'));
    }
    try { console.error('[donate] unexpected response:', resp); } catch (_) {}
    showError('Something went wrong. Please try again, or message us on Telegram.');
  }

  function showError(msg) {
    var errorEl = document.getElementById('donate-form-error');
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function renderSuccess(flow, resp) {
    var dialog = modal.querySelector('.donate-modal__dialog');
    var inner;
    if (flow === 'donate') {
      inner =
        '<h2>Thank you 📚</h2>' +
        '<div class="donate-form__success">' +
          (resp.idempotent
            ? '<p>We already received your offer in the last day. The team is on it — no need to resubmit.</p>'
            : '<p>Our team will reach out within 48 hours to coordinate ' +
              (resp.handoffMethod === 'pickup' ? 'pickup' : 'drop-off') + '.</p>') +
          '<p>If you\'d like to see how these Bibles get used, take a look at ' +
            '<a href="how-to-seed.html">how we seed the Word</a> or ' +
            '<a href="store.html">the bundles we send to gifters</a>.</p>' +
        '</div>';
    } else {
      inner =
        '<h2>Received 📖</h2>' +
        '<div class="donate-form__success">' +
          (resp.idempotent
            ? '<p>We already have your story from the last week. The team is reading it; no need to resubmit.</p>'
            : '<p>We read every story. Our team will be in touch within 48 hours.</p>') +
          '<p>While you wait, you might enjoy seeing ' +
            '<a href="how-to-seed.html">how we seed the Word</a>, or ' +
            '<a href="start-here.html">the 30-day reading plan</a> we use with new readers.</p>' +
        '</div>';
    }
    dialog.innerHTML =
      '<button type="button" class="donate-modal__close" id="donate-modal-close-2" aria-label="Close">×</button>' +
      inner;
    document.getElementById('donate-modal-close-2').addEventListener('click', closeModal);
  }
})();
