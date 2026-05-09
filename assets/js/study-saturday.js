/* ============================================================
   study-saturday.js

   Injects a "This Saturday's Review" block INSIDE the Twitch
   livestream card on community.html, so the live/offline state
   and the weekly review render as one unified card.

   Reads weekly config from assets/data/study-saturday.json. Each
   entry has:
     weekOf        — YYYY-MM-DD (Monday of the week by convention)
     oldTestament  — Old Testament passage ("Genesis 15 — Abram's covenant")
     newTestament  — New Testament passage ("Mark 11 — Jesus enters Jerusalem")

   Selection rule: pick the entry whose weekOf date is today-or-earlier
   AND closest to today. If no entry qualifies or the file is missing,
   nothing is injected — the livestream card renders untouched.
   ============================================================ */

(function () {
  'use strict';

  const DATA_URL = 'assets/data/study-saturday.json';
  const HOST_ID = 'livestream-card-container';

  document.addEventListener('DOMContentLoaded', async () => {
    const host = document.getElementById(HOST_ID);
    if (!host) return;

    let entry;
    try {
      const res = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const weeks = Array.isArray(data && data.weeks) ? data.weeks : [];
      entry = pickCurrentWeek(weeks);
    } catch (err) {
      console.warn('[study-saturday] config unavailable:', err && err.message);
      return;
    }
    if (!entry) return;

    // The Twitch card also renders on DOMContentLoaded; wait for its
    // element to exist before we inject our review block inside it.
    const card = await waitForLivestreamCard(host, 3000);
    if (!card) return;

    inject(card, entry);
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

  // Polls until the livestream card appears (twitch-integration.js renders
  // asynchronously inside the same DOMContentLoaded tick). Bails after
  // `timeoutMs` so a missing card never hangs anything.
  function waitForLivestreamCard(host, timeoutMs) {
    return new Promise((resolve) => {
      const existing = host.querySelector('.livestream-card');
      if (existing) return resolve(existing);
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        const found = host.querySelector('.livestream-card');
        if (found) return resolve(found);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, 60);
      };
      setTimeout(tick, 60);
    });
  }

  function inject(card, entry) {
    const review = document.createElement('div');
    review.className = 'study-review';

    const heading = document.createElement('p');
    heading.className = 'study-review__heading';
    heading.textContent = "This Saturday's Review";
    review.appendChild(heading);

    const passages = document.createElement('div');
    passages.className = 'study-review__passages';

    if (entry.oldTestament) {
      passages.appendChild(pill('📜 Old Testament', entry.oldTestament));
    }
    if (entry.newTestament) {
      passages.appendChild(pill('✝️ New Testament', entry.newTestament));
    }

    // If neither field is set, we don't show the review at all — an
    // empty review block would look broken.
    if (!passages.childElementCount) return;

    review.appendChild(passages);

    // Append the review AFTER the actions row so the card reads:
    // header (pill + title), description, actions (Watch / Follow /
    // Get Notified), THEN the review block at the bottom.
    card.appendChild(review);
  }

  function pill(label, value) {
    const wrap = document.createElement('div');
    wrap.className = 'study-review__pill';
    const l = document.createElement('span');
    l.className = 'study-review__pill-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'study-review__pill-value';
    v.textContent = value;
    wrap.appendChild(l);
    wrap.appendChild(v);
    return wrap;
  }
})();
