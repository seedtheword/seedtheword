/* ============================================================
   study-saturday.js

   Injects a "This Saturday's Review" block INSIDE the Twitch
   livestream card on community.html, so the live/offline state
   and the weekly review render as one unified card.

   Reads weekly config from assets/data/study-saturday.json. Each
   entry has:
     weekOf        — YYYY-MM-DD (Monday of the week by convention)
     oldTestament  — Rendered as "This week's study focus"
                     ("Genesis 15 — Abram's covenant")
     newTestament  — Rendered as "This week's reading"
                     ("Mark 11 — Jesus enters Jerusalem")

   The JSON keys intentionally keep their biblical-canon names so
   existing data + the admin editor schema keep working after the
   display-label rename.

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

    // Optional: study focus from the OT side. Only renders when the
    // admin explicitly sets `oldTestament` in study-saturday.json — we
    // don't auto-derive this because the OT pull-quote is editorial.
    if (entry.oldTestament) {
      passages.appendChild(pill("🎯 This week's study focus", entry.oldTestament));
    }

    // Required: this week's reading. Prefer the admin-set
    // `newTestament` override, otherwise derive from bible-plan.js so
    // the card stays in sync with the actual Mon-Fri plan without
    // manual editing every week.
    const reading = entry.newTestament || deriveWeekReadingLabel();
    if (reading) {
      passages.appendChild(pill("📖 This week's reading", reading));
    }

    // If neither field is set AND the plan can't be derived, we don't
    // show the review at all — an empty review block would look broken.
    if (!passages.childElementCount) return;

    review.appendChild(passages);

    // Insert the review BEFORE the actions row so the card reads:
    // header (pill + title), description, THEN the review block,
    // THEN actions (Follow on Twitch / Get Notified) at the bottom.
    const actions = card.querySelector('.livestream-card__actions');
    if (actions && actions.parentNode === card) {
      card.insertBefore(review, actions);
    } else {
      card.appendChild(review);
    }
  }

  /**
   * Build an abbreviated label for this week's Mon-Fri readings by
   * pulling from window.BiblePlan.getWeekReadings(). Output shape:
   *   - all five days in same book → "Luke 7-11"
   *   - book transitions mid-week  → "Luke 24, John 1-4"
   *   - missing data               → returns "" (caller falls back)
   *
   * Read-only — never mutates anything.
   */
  function deriveWeekReadingLabel() {
    if (!window.BiblePlan || typeof window.BiblePlan.getWeekReadings !== 'function') {
      return '';
    }
    let readings;
    try {
      readings = window.BiblePlan.getWeekReadings();
    } catch (_) {
      return '';
    }
    const valid = (readings || []).filter(r => r && r.book && r.chapter);
    if (!valid.length) return '';

    // Group consecutive readings by book, preserving order.
    const groups = [];
    for (const r of valid) {
      const last = groups[groups.length - 1];
      if (last && last.book === r.book) {
        last.end = r.chapter;
      } else {
        groups.push({ book: r.book, start: r.chapter, end: r.chapter });
      }
    }
    return groups
      .map(g => g.start === g.end ? g.book + ' ' + g.start : g.book + ' ' + g.start + '-' + g.end)
      .join(', ');
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
