/* ============================================================
   Bible Counter — renders the Bibles Given Away milestone counter.
   Reads assets/data/site-config.json for:
     biblesGivenAway  — current count
     biblesGoal2026   — 2026 annual goal (default 70000)

   Mounts into any element with:
     id="bible-counter"         → full milestone card (news.html)
     id="bible-counter-inline"  → compact inline stat (store.html)
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

    const pct   = Math.min(100, Math.round((count / goal) * 100 * 10) / 10);
    const fmtCount = count.toLocaleString('en-US');
    const fmtGoal  = goal.toLocaleString('en-US');

    if (full) renderFull(full, count, goal, pct, fmtCount, fmtGoal);
    if (inline) renderInline(inline, fmtCount);
  }

  function renderFull(el, count, goal, pct, fmtCount, fmtGoal) {
    el.innerHTML =
      '<div class="bible-counter glass-morphism" role="region" aria-label="Bibles given away counter">' +
        '<div class="bible-counter__icon" aria-hidden="true">📖</div>' +
        '<div class="bible-counter__body">' +
          '<p class="bible-counter__eyebrow">Bibles Given Away</p>' +
          '<div class="bible-counter__number" aria-label="' + fmtCount + ' Bibles given away">' +
            '<span class="bible-counter__num" id="bible-counter-num">' + fmtCount + '</span>' +
          '</div>' +
          '<p class="bible-counter__goal">and counting — goal: ' + fmtGoal + ' for 2026</p>' +
          '<div class="bible-counter__bar-wrap" role="progressbar" aria-valuenow="' + count + '" aria-valuemin="0" aria-valuemax="' + goal + '" aria-label="' + pct + '% toward 2026 goal">' +
            '<div class="bible-counter__bar" style="width:' + pct + '%"></div>' +
          '</div>' +
          '<p class="bible-counter__pct">' + pct + '% toward 2026 goal</p>' +
        '</div>' +
      '</div>';

    // Animate the number counting up
    animateCount(el.querySelector('#bible-counter-num'), 0, count, 1200);
  }

  function renderInline(el, fmtCount) {
    el.innerHTML =
      '<div class="bible-counter-store glass-morphism">' +
        '<div class="bible-counter-store__top">' +
          '<span class="bible-counter-store__emoji" aria-hidden="true">🙌</span>' +
          '<div>' +
            '<p class="bible-counter-store__eyebrow">Bibles Given Away — and counting</p>' +
            '<div class="bible-counter-store__number">' + fmtCount + '</div>' +
            '<p class="bible-counter-store__sub">' +
              'By Seed the Word Ministry &amp; our partners, ' +
              'made possible through <strong>Gideon\'s International</strong>' +
            '</p>' +
          '</div>' +
        '</div>' +
        '<p class="bible-counter-store__call">' +
          'Every Bible you sponsor through this page goes into someone\'s hands — ' +
          'personally packed, prayed over, and shipped with a handwritten note. ' +
          'This number grows with you.' +
        '</p>' +
      '</div>';
  }

  function animateCount(el, from, to, durationMs) {
    if (!el || to === 0) return;
    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      el.textContent = current.toLocaleString('en-US');
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
