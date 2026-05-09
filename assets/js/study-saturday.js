/* ============================================================
   study-saturday.js

   Renders the "This week we're studying" block inside the Study
   Saturday section on community.html. Reads config from
   assets/data/study-saturday.json, which admins edit through the
   Editor tab on admin-help.html.

   Selection rule: pick the entry in `weeks` whose weekOf date is
   today-or-earlier AND closest to today. That way the current
   week's entry stays up even if the next one hasn't been added yet.

   If no config is available, the block stays hidden — the livestream
   card below it still renders cleanly.
   ============================================================ */

(function () {
  'use strict';

  const host = document.getElementById('study-saturday-topic');
  const passagesEl = document.getElementById('study-saturday-passages');
  const noteEl = document.getElementById('study-saturday-note');
  if (!host || !passagesEl) return;

  (async function () {
    try {
      const res = await fetch('assets/data/study-saturday.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const weeks = Array.isArray(data && data.weeks) ? data.weeks : [];
      const entry = pickCurrentWeek(weeks);
      if (!entry) return; // leave hidden
      render(entry);
    } catch (err) {
      console.warn('[study-saturday] config unavailable:', err.message);
    }
  })();

  function pickCurrentWeek(weeks) {
    const now = Date.now();
    const candidates = [];
    for (const w of weeks) {
      if (!w || !w.weekOf) continue;
      const t = Date.parse(String(w.weekOf));
      if (!Number.isFinite(t)) continue;
      if (t <= now) candidates.push({ t: t, entry: w });
    }
    if (!candidates.length) return null;
    // Largest t ≤ now.
    candidates.sort((a, b) => b.t - a.t);
    return candidates[0].entry;
  }

  function render(entry) {
    const pieces = [];
    if (entry.oldTestament) {
      pieces.push(pill('📜 Old Testament', entry.oldTestament));
    }
    if (entry.gospel) {
      pieces.push(pill('✝️ Gospel', entry.gospel));
    }
    if (entry.scripture) {
      pieces.push(pill('📖 Scripture', entry.scripture));
    }
    if (!pieces.length) return; // nothing to show
    passagesEl.innerHTML = pieces.join('');
    if (noteEl) {
      if (entry.note) {
        noteEl.textContent = entry.note;
        noteEl.hidden = false;
      } else {
        noteEl.textContent = '';
        noteEl.hidden = true;
      }
    }
    host.hidden = false;
  }

  function pill(label, value) {
    return (
      '<div class="study-pill">' +
        '<span class="study-pill__label">' + escapeHtml(label) + '</span>' +
        '<span class="study-pill__value">' + escapeHtml(value) + '</span>' +
      '</div>'
    );
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
