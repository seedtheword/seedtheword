/* ============================================================
   Site-wide Nav Auth State
   - Shows first name badge when logged in (all pages)
   - Dropdown with Profile Settings + Log out
   - Session expiry after 30 min of inactivity
   - Works on any page with .nav-login element
   ============================================================ */
(function () {
  'use strict';

  var SESSION_KEY = 'stwm-team-session';
  var ACTIVITY_KEY = 'stwm-last-activity';
  var EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
    location.reload();
  }

  function touchActivity() {
    try { localStorage.setItem(ACTIVITY_KEY, Date.now().toString()); } catch (e) {}
  }

  function checkExpiry() {
    var last = parseInt(localStorage.getItem(ACTIVITY_KEY), 10);
    if (!last) { touchActivity(); return false; }
    if (Date.now() - last > EXPIRY_MS) {
      clearSession();
      return true;
    }
    return false;
  }

  function init() {
    var session = getSession();
    if (!session || !session.name) return;

    // Check expiry
    if (checkExpiry()) return;
    touchActivity();

    // Track activity
    ['click', 'keydown', 'scroll', 'mousemove'].forEach(function (evt) {
      document.addEventListener(evt, touchActivity, { passive: true, once: false });
    });

    // Periodic expiry check (every 60s)
    setInterval(function () { if (getSession()) checkExpiry(); }, 60000);

    // Find the nav login link
    var loginLink = document.querySelector('.nav-login');
    if (!loginLink) return;
    var parentLi = loginLink.parentElement;

    // Build the auth badge + dropdown
    var firstName = session.name.split(' ')[0];
    parentLi.classList.add('nav-auth-wrap');
    parentLi.id = 'nav-auth-wrap';

    // Replace the login link with badge (profile pic + name)
    var profilePic = session.profilePic || session.profilePicUrl || '';
    if (profilePic) {
      loginLink.innerHTML = '<img class="nav-auth-avatar" src="' + profilePic + '" alt=""> ' + firstName;
    } else {
      loginLink.textContent = firstName;
    }
    loginLink.href = '#';
    loginLink.id = 'nav-auth-btn';
    loginLink.classList.add('nav-login--authed');

    // Create dropdown
    var dropdown = document.createElement('div');
    dropdown.className = 'nav-auth-dropdown';
    dropdown.id = 'nav-auth-dropdown';
    dropdown.innerHTML =
      '<a class="nav-auth-dropdown__item" href="team.html" style="text-decoration:none;color:inherit;">Team Portal</a>' +
      '<button class="nav-auth-dropdown__item" id="nav-auth-profile">Profile Settings</button>' +
      '<button class="nav-auth-dropdown__item nav-auth-dropdown__item--danger" id="nav-auth-logout">Log out</button>';
    parentLi.appendChild(dropdown);

    // Toggle dropdown on click
    loginLink.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      parentLi.classList.toggle('is-open');
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!parentLi.contains(e.target)) parentLi.classList.remove('is-open');
    });

    // Profile settings
    document.getElementById('nav-auth-profile').addEventListener('click', function () {
      parentLi.classList.remove('is-open');
      if (window.stwProfile) window.stwProfile.open();
    });

    // Log out
    document.getElementById('nav-auth-logout').addEventListener('click', clearSession);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
