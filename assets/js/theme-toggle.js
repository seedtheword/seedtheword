/* ============================================================
   Site-wide Light / Dark Theme Toggle
   - Persists choice in localStorage ('stw-theme')
   - Respects prefers-color-scheme on first visit
   - Toggles [data-theme="dark"] on <html>
   ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'stw-theme';
  var root = document.documentElement;

  function getSystemPref() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function getTheme() {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (stored === 'dark' || stored === 'light') return stored;
    return getSystemPref();
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
    // Update toggle button icons
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      var sunIcon = btn.querySelector('.theme-toggle__sun');
      var moonIcon = btn.querySelector('.theme-toggle__moon');
      if (sunIcon && moonIcon) {
        sunIcon.style.display = theme === 'dark' ? 'block' : 'none';
        moonIcon.style.display = theme === 'dark' ? 'none' : 'block';
      }
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function toggle() {
    var current = root.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Apply immediately (before paint if possible)
  applyTheme(getTheme());

  // Listen for system preference changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      var stored = null;
      try { stored = localStorage.getItem(STORAGE_KEY); } catch (err) {}
      // Only auto-switch if user hasn't manually set a preference
      if (!stored) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // Bind toggle buttons once DOM is ready
  function bindToggles() {
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', toggle);
    });
    // Re-apply to update icons
    applyTheme(getTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToggles);
  } else {
    bindToggles();
  }

  // Expose for programmatic use
  window.stwTheme = { toggle: toggle, apply: applyTheme, get: getTheme };
})();
