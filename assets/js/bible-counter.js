/* ============================================================
   Bible Counter — Bibles Given Away milestone counter.
   Reads assets/data/site-config.json for biblesGivenAway + biblesGoal2026.
   Counts from 0 to the current number on every page load.
   Shows "162+" with a strobe effect during count-up, then settles
   into a gentle pulse once the count reaches its target.

   Mounts into:
     id="bible-counter"         → full milestone card (news.html)
     id="bible-counter-inline"  → store celebration card (store.html)
   ============================================================ */
(function () {
  'use strict';

  const CONFIG_URL = 'assets/data/site-config.json';

  async function init() {
    const full   = document.getElementById('bible-counter');
    const inline = document.getElementById('bible-counter-inline');
    if (!full && !inline) return;

    let count = 0, goal = 70000;
    try {
      const res = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        count = typeof data.biblesGivenAway === 'number' ? data.biblesGivenAway : 0;
        goal  = typeof data.biblesGoal2026  === 'number' ? data.biblesGoal2026  : 70000;
      }
    } catch (_) {}

    const pct      = Math.min(100, Math.round((count / goal) * 100 * 10) / 10);
    const fmtGoal  = goal.toLocaleString('en-US');

    if (full)   renderFull(full, count, goal, pct, fmtGoal);
    if (inline) renderInline(inline, count);
  }

  /* ── Full milestone card ──────────────────────────────────── */
  function renderFull(el, count, goal, pct, fmtGoal) {
    el.innerHTML =
      '<div class="bible-counter glass-morphism bible-counter--counting" role="region" aria-label="Bibles given away counter">' +
        '<div class="bible-counter__icon" aria-hidden="true">📖</div>' +
        '<div class="bible-counter__body">' +
          '<p class="bible-counter__eyebrow">Bibles Given Away</p>' +
          '<div class="bible-counter__number">' +
            '<span class="bible-counter__num">0</span>' +
            '<span class="bible-counter__plus">+</span>' +
          '</div>' +
          '<p class="bible-counter__goal">and counting — goal: ' + fmtGoal + ' for 2026</p>' +
          '<div class="bible-counter__bar-wrap" role="progressbar" ' +
               'aria-valuenow="' + count + '" aria-valuemin="0" aria-valuemax="' + goal + '">' +
            '<div class="bible-counter__bar" style="width:0%;transition:width 1.8s cubic-bezier(0.25,1,0.5,1)"></div>' +
          '</div>' +
          '<p class="bible-counter__pct">' + pct + '% toward 2026 goal</p>' +
        '</div>' +
      '</div>';

    const wrap = el.querySelector('.bible-counter');
    const numEl = el.querySelector('.bible-counter__num');
    const barEl = el.querySelector('.bible-counter__bar');

    animateCount(numEl, 0, count, 1800, function () {
      wrap.classList.remove('bible-counter--counting');
      wrap.classList.add('bible-counter--done');
      if (barEl) barEl.style.width = pct + '%';
    });
  }

  /* ── Store celebration card ───────────────────────────────── */
  function renderInline(el, count) {
    el.innerHTML =
      '<div class="bible-counter-store glass-morphism bible-counter-store--counting">' +
        '<div class="bible-counter-store__top">' +
          '<span class="bible-counter-store__emoji" aria-hidden="true">🙌</span>' +
          '<div>' +
            '<p class="bible-counter-store__eyebrow">Bibles Given Away — and counting</p>' +
            '<div class="bible-counter-store__number">' +
              '<span class="bible-counter-store__num">0</span>' +
              '<span class="bible-counter-store__plus">+</span>' +
            '</div>' +
            '<p class="bible-counter-store__sub">' +
              'By Seed the Word Ministry &amp; our partners, ' +
              'made possible through <strong>Gideon\'s International</strong>' +
            '</p>' +
          '</div>' +
        '</div>' +
        '<p class="bible-counter-store__call">' +
          'Every gift supports our ministry\'s mission — Bible distribution, ' +
          'outreach events, community fellowship, and volunteer care. ' +
          'This number grows with your support.' +
        '</p>' +
      '</div>';

    const wrap = el.querySelector('.bible-counter-store');
    const numEl = el.querySelector('.bible-counter-store__num');

    animateCount(numEl, 0, count, 1800, function () {
      wrap.classList.remove('bible-counter-store--counting');
      wrap.classList.add('bible-counter-store--done');
    });
  }

  /* ── Count-up animation with optional completion callback ─── */
  function animateCount(el, from, to, durationMs, onDone) {
    if (!el) return;
    if (to === 0) {
      el.textContent = '0';
      if (onDone) onDone();
      return;
    }
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(from + (to - from) * eased).toLocaleString('en-US');
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = to.toLocaleString('en-US');
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(step);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
