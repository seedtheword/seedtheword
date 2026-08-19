/* ============================================================
   Profile Settings Modal
   Shared between community.html and team.html.
   - Edit name, email, phone, carrier, notification preferences
   - Saves to localStorage + posts to backend for persistence
   ============================================================ */
(function () {
  'use strict';

  var CONFIG_URL = 'assets/data/site-config.json';
  var modal = null;
  var handlerUrl = null;

  async function getUrl() {
    if (handlerUrl) return handlerUrl;
    var cfg = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
    handlerUrl = cfg.orderHandlerUrl;
    return handlerUrl;
  }

  async function post(data) {
    var url = await getUrl();
    var res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) });
    return res.json();
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem('stwm-team-session')); } catch (e) { return null; }
  }

  function saveSession(session) {
    try { localStorage.setItem('stwm-team-session', JSON.stringify(session)); } catch (e) {}
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── Build and inject modal ──
  function ensureModal() {
    if (modal) return modal;
    var div = document.createElement('div');
    div.innerHTML =
      '<div id="profile-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;padding:1rem;">' +
        '<div style="background:var(--color-bg-elevated,#fff);border-radius:18px;width:100%;max-width:440px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);padding:0;">' +
          '<!-- Header -->' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid var(--color-border,#e0dbd6);">' +
            '<h2 style="font-family:Fraunces,Georgia,serif;font-size:1.15rem;font-weight:700;margin:0;color:var(--color-text,#1A1E24);">Profile Settings</h2>' +
            '<button id="profile-modal-close" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--color-border,#e0dbd6);background:var(--color-bg-subtle,#f8f6f3);font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--color-text-muted,#6b7280);">×</button>' +
          '</div>' +
          '<!-- Form -->' +
          '<form id="profile-form" style="padding:1.5rem;" novalidate>' +
            '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem;">' +
              '<div id="profile-modal-avatar" style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#2C4A3E,#3a5f4e);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;color:#fff;flex-shrink:0;"></div>' +
              '<div><div id="profile-modal-name-display" style="font-weight:700;font-size:0.95rem;color:var(--color-text,#1A1E24);"></div><div id="profile-modal-role-display" style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#D97736;"></div></div>' +
            '</div>' +
            '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem;color:var(--color-text,#1A1E24);">Full Name</label>' +
            '<input type="text" name="name" id="profile-name" style="width:100%;padding:0.7rem 0.85rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;font-size:0.9rem;font-family:Inter,sans-serif;margin-bottom:0.75rem;color:var(--color-text,#1A1E24);background:var(--color-surface,#fff);" autocomplete="name">' +
            '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem;color:var(--color-text,#1A1E24);">Email</label>' +
            '<input type="email" name="email" id="profile-email" style="width:100%;padding:0.7rem 0.85rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;font-size:0.9rem;font-family:Inter,sans-serif;margin-bottom:0.75rem;color:var(--color-text,#1A1E24);background:var(--color-surface,#fff);" autocomplete="email">' +
            '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem;color:var(--color-text,#1A1E24);">Phone</label>' +
            '<input type="tel" name="phone" id="profile-phone" style="width:100%;padding:0.7rem 0.85rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;font-size:0.9rem;font-family:Inter,sans-serif;margin-bottom:0.75rem;color:var(--color-text,#1A1E24);background:var(--color-surface,#fff);" autocomplete="tel">' +
            '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem;color:var(--color-text,#1A1E24);">Telegram Username</label>' +
            '<input type="text" name="telegram_username" id="profile-telegram" style="width:100%;padding:0.7rem 0.85rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;font-size:0.9rem;font-family:Inter,sans-serif;margin-bottom:0.75rem;color:var(--color-text,#1A1E24);background:var(--color-surface,#fff);" placeholder="@yourusername">' +
            '<fieldset style="border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;padding:1rem;margin:0 0 1rem;">' +
              '<legend style="font-size:0.75rem;font-weight:700;padding:0 0.4rem;color:#2C4A3E;">Notification Preference</legend>' +
              '<label style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem;font-size:0.82rem;cursor:pointer;"><input type="radio" name="notify_pref" value="email" style="width:auto;margin:0;"> Email</label>' +
              '<label style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem;font-size:0.82rem;cursor:pointer;"><input type="radio" name="notify_pref" value="sms" style="width:auto;margin:0;"> Text message</label>' +
              '<label style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem;font-size:0.82rem;cursor:pointer;"><input type="radio" name="notify_pref" value="telegram" style="width:auto;margin:0;"> Telegram</label>' +
              '<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.82rem;cursor:pointer;"><input type="radio" name="notify_pref" value="none" style="width:auto;margin:0;"> No notifications</label>' +
              '<div id="profile-carrier-wrap" style="display:none;margin-top:0.6rem;padding-top:0.5rem;border-top:1px solid var(--color-border,#e0dbd6);">' +
                '<label style="font-size:0.72rem;font-weight:600;margin-bottom:0.2rem;display:block;">Phone carrier</label>' +
                '<select name="carrier" id="profile-carrier" style="width:100%;padding:0.55rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:8px;font-size:0.82rem;font-family:Inter,sans-serif;background:var(--color-surface,#fff);color:var(--color-text,#1A1E24);"><option value="">Select...</option><option value="tmobile">T-Mobile</option><option value="att">AT&T</option><option value="verizon">Verizon</option><option value="sprint">Sprint</option><option value="metro">Metro</option><option value="boost">Boost</option><option value="cricket">Cricket</option><option value="mint">Mint</option><option value="visible">Visible</option><option value="fi">Google Fi</option><option value="other">Other</option></select>' +
              '</div>' +
            '</fieldset>' +
            '<!-- Password Change -->' +
            '<fieldset style="border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;padding:1rem;margin:0 0 1rem;">' +
              '<legend style="font-size:0.75rem;font-weight:700;padding:0 0.4rem;color:#2C4A3E;">Change Password</legend>' +
              '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem;color:var(--color-text,#1A1E24);">New Password</label>' +
              '<input type="password" name="new_password" id="profile-new-pass" placeholder="Leave blank to keep current" style="width:100%;padding:0.7rem 0.85rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;font-size:0.9rem;font-family:Inter,sans-serif;margin-bottom:0.5rem;color:var(--color-text,#1A1E24);background:var(--color-surface,#fff);" autocomplete="new-password">' +
              '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.2rem;color:var(--color-text,#1A1E24);">Confirm New Password</label>' +
              '<input type="password" name="confirm_password" id="profile-confirm-pass" placeholder="Confirm new password" style="width:100%;padding:0.7rem 0.85rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:10px;font-size:0.9rem;font-family:Inter,sans-serif;color:var(--color-text,#1A1E24);background:var(--color-surface,#fff);" autocomplete="new-password">' +
            '</fieldset>' +
            '<!-- Profile Picture -->' +
            '<div style="margin-bottom:1rem;">' +
              '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:0.4rem;color:var(--color-text,#1A1E24);">Profile Picture</label>' +
              '<div id="profile-pic-preview" style="width:64px;height:64px;border-radius:50%;background:var(--color-bg-subtle,#f5f3f0);border:2px dashed var(--color-border,#e0dbd6);display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;overflow:hidden;cursor:pointer;" title="Click to change">' +
                '<span id="profile-pic-placeholder" style="font-size:1.5rem;">📷</span>' +
                '<img id="profile-pic-img" style="width:100%;height:100%;object-fit:cover;display:none;" alt="Profile picture">' +
              '</div>' +
              '<input type="file" id="profile-pic-input" accept="image/*" style="display:none;">' +
              '<button type="button" id="profile-pic-btn" style="font-size:0.75rem;padding:0.4rem 0.75rem;border:1.5px solid var(--color-border,#e0dbd6);border-radius:8px;background:var(--color-surface,#fff);cursor:pointer;color:var(--color-text-muted,#6b7280);font-family:Inter,sans-serif;">Change Photo</button>' +
            '</div>' +
            '<div id="profile-status" style="text-align:center;font-size:0.82rem;min-height:1.2rem;margin-bottom:0.5rem;"></div>' +
            '<button type="submit" style="width:100%;padding:0.85rem;border:none;border-radius:12px;font-size:0.92rem;font-weight:700;font-family:Inter,sans-serif;cursor:pointer;background:linear-gradient(135deg,#2C4A3E,#3a5f4e);color:#fff;box-shadow:0 4px 16px rgba(44,74,62,0.25);transition:transform 0.15s;">Save Settings</button>' +
          '</form>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div.firstElementChild);
    modal = document.getElementById('profile-modal');

    // Close handlers
    document.getElementById('profile-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });

    // Carrier show/hide
    modal.querySelectorAll('input[name="notify_pref"]').forEach(function (r) {
      r.addEventListener('change', function () {
        document.getElementById('profile-carrier-wrap').style.display = this.value === 'sms' ? 'block' : 'none';
      });
    });

    // Submit
    document.getElementById('profile-form').addEventListener('submit', handleSave);

    // Profile picture
    var picBtn = document.getElementById('profile-pic-btn');
    var picInput = document.getElementById('profile-pic-input');
    var picPreview = document.getElementById('profile-pic-preview');
    var picImg = document.getElementById('profile-pic-img');
    var picPlaceholder = document.getElementById('profile-pic-placeholder');

    picBtn.addEventListener('click', function () { picInput.click(); });
    picPreview.addEventListener('click', function () { picInput.click(); });
    picInput.addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        picImg.src = ev.target.result;
        picImg.style.display = 'block';
        picPlaceholder.style.display = 'none';
        // Store locally
        var session = getSession();
        if (session) {
          session.profilePic = ev.target.result;
          saveSession(session);
        }
      };
      reader.readAsDataURL(file);
    });

    return modal;
  }

  function openModal() {
    ensureModal();
    var session = getSession();
    if (!session) { alert('Please log in first.'); return; }

    // Populate fields
    document.getElementById('profile-name').value = session.name || '';
    document.getElementById('profile-email').value = session.email || '';
    document.getElementById('profile-phone').value = session.phone || '';
    document.getElementById('profile-telegram').value = session.telegram_username || '';
    document.getElementById('profile-modal-avatar').textContent = (session.name || '?').split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
    document.getElementById('profile-modal-name-display').textContent = session.name || 'Member';
    document.getElementById('profile-modal-role-display').textContent = session.role || 'member';

    // Set notification pref radio
    var pref = session.notify_pref || 'email';
    var radio = modal.querySelector('input[name="notify_pref"][value="' + pref + '"]');
    if (radio) radio.checked = true;
    document.getElementById('profile-carrier-wrap').style.display = pref === 'sms' ? 'block' : 'none';
    if (session.carrier) document.getElementById('profile-carrier').value = session.carrier;

    // Clear status
    document.getElementById('profile-status').textContent = '';

    // Load profile picture if saved
    if (session.profilePic) {
      var picImg = document.getElementById('profile-pic-img');
      var picPlaceholder = document.getElementById('profile-pic-placeholder');
      if (picImg) { picImg.src = session.profilePic; picImg.style.display = 'block'; }
      if (picPlaceholder) picPlaceholder.style.display = 'none';
    }

    // Clear password fields
    document.getElementById('profile-new-pass').value = '';
    document.getElementById('profile-confirm-pass').value = '';

    modal.style.display = 'flex';
  }

  function closeModal() {
    if (modal) modal.style.display = 'none';
  }

  async function handleSave(e) {
    e.preventDefault();
    var session = getSession();
    if (!session) return;

    var form = e.target;
    var data = new FormData(form);
    var updates = {};
    data.forEach(function (v, k) { updates[k] = v; });

    var statusEl = document.getElementById('profile-status');
    statusEl.textContent = '';
    statusEl.style.color = '';

    // Password change validation
    var newPass = document.getElementById('profile-new-pass').value;
    var confirmPass = document.getElementById('profile-confirm-pass').value;
    var passwordHash = null;
    if (newPass) {
      if (newPass.length < 4) {
        statusEl.textContent = 'Password must be at least 4 characters.';
        statusEl.style.color = '#c0392b';
        return;
      }
      if (newPass !== confirmPass) {
        statusEl.textContent = 'Passwords do not match.';
        statusEl.style.color = '#c0392b';
        return;
      }
      // Hash it the same way login does
      var buf = new TextEncoder().encode('stwm-team-' + session.name.toLowerCase() + '-' + newPass);
      var digest = await crypto.subtle.digest('SHA-256', buf);
      passwordHash = Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    }

    // Update local session
    session.name = updates.name || session.name;
    session.email = updates.email || '';
    session.phone = updates.phone || '';
    session.telegram_username = updates.telegram_username || '';
    session.notify_pref = updates.notify_pref || 'email';
    session.carrier = updates.carrier || '';
    saveSession(session);

    // Post to backend
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      var payload = {
        action: 'updateProfile',
        token: session.token,
        email: session.email,
        phone: session.phone,
        telegram_username: session.telegram_username,
        notify_pref: session.notify_pref,
        carrier: session.carrier
      };
      if (passwordHash) payload.new_password_hash = passwordHash;

      var res = await post(payload);
      if (res.ok) {
        statusEl.textContent = passwordHash ? '✓ Settings & password saved' : '✓ Settings saved';
        statusEl.style.color = '#2C4A3E';
        setTimeout(closeModal, 1200);
      } else {
        statusEl.textContent = res.error || 'Could not save. Changes saved locally.';
        statusEl.style.color = '#D97736';
      }
    } catch (err) {
      // Still saved locally
      statusEl.textContent = '✓ Saved locally (will sync when online)';
      statusEl.style.color = '#D97736';
      setTimeout(closeModal, 1500);
    }
    btn.disabled = false;
    btn.textContent = 'Save Settings';
  }

  // ── Public API ──
  window.stwProfile = { open: openModal, close: closeModal };

  // ── Auto-bind triggers ──
  function bindTriggers() {
    // Any element with data-action="open-profile" or id containing "profile-settings"
    document.querySelectorAll('[data-action="open-profile"], .profile-settings-btn').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTriggers);
  } else {
    bindTriggers();
  }
})();
