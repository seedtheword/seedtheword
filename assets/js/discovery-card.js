/* ============================================================
   discovery-card.js

   Populates the Discovery card on community.html with this
   week's anchor chapter (and optional one-line note) from
   assets/data/study-saturday.json.

   The four S.E.E.D. discovery questions themselves are baked
   into the HTML — they're the canonical framework, not a
   per-week edit. This script only fills in the chapter name
   + the optional context note.

   Selection rule mirrors study-saturday.js: pick the entry
   whose weekOf date is today-or-earlier AND closest to today.
   If no entry qualifies or the chapter is unset, the card
   shows a generic "Pick a chapter to read together" prompt
   so the page never looks broken.
   ============================================================ */

(function () {
  'use strict';

  const DATA_URL = 'assets/data/study-saturday.json';
  const FALLBACK_CHAPTER = 'Pick a chapter to read together';
  const FALLBACK_NOTE =
    "Open Scripture, read it aloud, then walk through the four questions below.";

  document.addEventListener('DOMContentLoaded', async () => {
    const nameEl = document.getElementById('discovery-chapter-name');
    const noteEl = document.getElementById('discovery-chapter-note');
    if (!nameEl || !noteEl) return; // not on this page

    let entry;
    try {
      const res = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const weeks = Array.isArray(data && data.weeks) ? data.weeks : [];
      entry = pickCurrentWeek(weeks);
    } catch (err) {
      console.warn('[discovery-card] config unavailable:', err && err.message);
    }

    const chapter = (entry && entry.anchorChapter && String(entry.anchorChapter).trim()) || FALLBACK_CHAPTER;
    const note = (entry && entry.anchorNote && String(entry.anchorNote).trim()) ||
      (entry && entry.anchorChapter ? '' : FALLBACK_NOTE);

    nameEl.textContent = chapter;
    noteEl.textContent = note;
  });

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
    candidates.sort((a, b) => b.t - a.t);
    return candidates[0].entry;
  }
})();
