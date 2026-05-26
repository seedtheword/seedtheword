/* ============================================================
   Layered Bible Reading Plan — companion streams to the NT walk
   --------------------------------------------------------------
   Renders the "Going Deeper Today" row on community.html.
   Lookup functions are pure and re-used by the Python and Apps
   Script ports for the daily Bible bot's Mon-Fri footer.

   Sequences (in canonical order):
     OT_HISTORY_BOOKS         Genesis through Esther    (436 ch)
     POETRY_PROPHECY_BOOKS    Job, Ecc, SoS, Isa..Mal   (312 ch)
   Psalms and Proverbs are deliberately excluded from the
   Poetry & Prophecy walk because they have their own daily
   formula-driven streams (psalmOfDay, proverbOfDay).

   Saturday/Sunday: the row never renders (R2.7, R2.8, L4, L5).
   The NT walk in bible-plan.js is FROZEN — this module never
   touches it.
   ============================================================ */

const OT_HISTORY_BOOKS = [
  { name: 'Genesis',        chapters: 50 },
  { name: 'Exodus',         chapters: 40 },
  { name: 'Leviticus',      chapters: 27 },
  { name: 'Numbers',        chapters: 36 },
  { name: 'Deuteronomy',    chapters: 34 },
  { name: 'Joshua',         chapters: 24 },
  { name: 'Judges',         chapters: 21 },
  { name: 'Ruth',           chapters: 4  },
  { name: '1 Samuel',       chapters: 31 },
  { name: '2 Samuel',       chapters: 24 },
  { name: '1 Kings',        chapters: 22 },
  { name: '2 Kings',        chapters: 25 },
  { name: '1 Chronicles',   chapters: 29 },
  { name: '2 Chronicles',   chapters: 36 },
  { name: 'Ezra',           chapters: 10 },
  { name: 'Nehemiah',       chapters: 13 },
  { name: 'Esther',         chapters: 10 }
];

const POETRY_PROPHECY_BOOKS = [
  { name: 'Job',              chapters: 42 },
  { name: 'Ecclesiastes',     chapters: 12 },
  { name: 'Song of Solomon',  chapters: 8  },
  { name: 'Isaiah',           chapters: 66 },
  { name: 'Jeremiah',         chapters: 52 },
  { name: 'Lamentations',     chapters: 5  },
  { name: 'Ezekiel',          chapters: 48 },
  { name: 'Daniel',           chapters: 12 },
  { name: 'Hosea',            chapters: 14 },
  { name: 'Joel',             chapters: 3  },
  { name: 'Amos',             chapters: 9  },
  { name: 'Obadiah',          chapters: 1  },
  { name: 'Jonah',            chapters: 4  },
  { name: 'Micah',            chapters: 7  },
  { name: 'Nahum',            chapters: 3  },
  { name: 'Habakkuk',         chapters: 3  },
  { name: 'Zephaniah',        chapters: 3  },
  { name: 'Haggai',           chapters: 2  },
  { name: 'Zechariah',        chapters: 14 },
  { name: 'Malachi',          chapters: 4  }
];

const OT_HISTORY_SEQUENCE = (() => {
  const seq = [];
  for (const b of OT_HISTORY_BOOKS) {
    for (let c = 1; c <= b.chapters; c++) seq.push({ book: b.name, chapter: c });
  }
  return seq;
})();

const POETRY_PROPHECY_SEQUENCE = (() => {
  const seq = [];
  for (const b of POETRY_PROPHECY_BOOKS) {
    for (let c = 1; c <= b.chapters; c++) seq.push({ book: b.name, chapter: c });
  }
  return seq;
})();

/* ---------- Date math (locally redeclared from bible-plan.js) -------- */

/**
 * Count Mon-Fri days between two dates. Signed: positive when toDate
 * is after fromDate, negative when before. Same algorithm as
 * bible-plan.js's weekdaysBetween — duplicated here so this module
 * survives a bible-plan.js load failure (parity asserted by L2).
 */
function weekdaysBetween(fromDate, toDate) {
  const from = new Date(fromDate); from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);     to.setHours(0, 0, 0, 0);
  if (from.getTime() === to.getTime()) return 0;
  const direction = to >= from ? 1 : -1;
  let count = 0;
  const cursor = new Date(from);
  while (cursor.getTime() !== to.getTime()) {
    cursor.setDate(cursor.getDate() + direction);
    const day = cursor.getDay();
    if (day >= 1 && day <= 5) count += direction;
  }
  return count;
}

function parseAnchorDate(isoDate) {
  // 'YYYY-MM-DD' → local-midnight Date. Avoids the new Date(string)
  // UTC-shift footgun that bites when the user's tz is west of UTC.
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ---------- Walk lookups (R5, R6) ---------- */

function _getWalkReading(date, anchorCfg, sequence) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return null;                 // R5.4, R6.4 (weekend)
  if (!anchorCfg || !anchorCfg.date || !anchorCfg.book || !anchorCfg.chapter) return null;
  const anchorDate = parseAnchorDate(anchorCfg.date);
  const anchorIndex = sequence.findIndex(
    r => r.book === anchorCfg.book && r.chapter === anchorCfg.chapter
  );
  if (anchorIndex < 0) return null;                         // bad config — silent omit
  const offset = weekdaysBetween(anchorDate, d);
  const idx = anchorIndex + offset;
  if (idx < 0 || idx >= sequence.length) return null;       // R5.7, R5.8
  return { book: sequence[idx].book, chapter: sequence[idx].chapter, date: d };
}

function getOtHistoryReading(date, anchorCfg) {
  return _getWalkReading(date, anchorCfg, OT_HISTORY_SEQUENCE);
}

function getPoetryProphecyReading(date, anchorCfg) {
  return _getWalkReading(date, anchorCfg, POETRY_PROPHECY_SEQUENCE);
}

/* ---------- Daily formulas (R7) ---------- */

function _ymdInTimezone(date, timezone) {
  // Returns { year, month (1-12), day (1-31) } for the date as
  // observed in the configured IANA timezone. Uses Intl.DateTimeFormat
  // with the parts API for portability across browsers and Node.
  const tz = timezone || 'America/Los_Angeles';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(new Date(date));
    const get = (t) => Number(parts.find(p => p.type === t).value);
    return { year: get('year'), month: get('month'), day: get('day') };
  } catch (_err) {
    // Bad timezone string — fall back to local interpretation.
    const d = new Date(date);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
}

function _dayOfYearFromYMD(year, month, day) {
  // Compute 1-indexed ordinal day of year purely from Y/M/D, no tz.
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeap) monthDays[1] = 29;
  let doy = day;
  for (let i = 0; i < month - 1; i++) doy += monthDays[i];
  return doy;
}

function psalmOfDay(date, timezone) {
  const { year, month, day } = _ymdInTimezone(date, timezone);
  const doy = _dayOfYearFromYMD(year, month, day);
  return ((doy - 1) % 150) + 1;                              // R7.1, L1
}

function proverbOfDay(date, timezone) {
  const { day } = _ymdInTimezone(date, timezone);
  return Math.min(day, 31);                                  // R7.4, L1
}

/* ---------- Going Deeper row renderer (§4.1.7) ---------- */

const HEADING_COPY = '🌿 Going deeper today';

function _audioUrlFor(audioMap, key) {
  if (!audioMap || typeof audioMap !== 'object') return null;
  // Try the four optional buckets in canonical order; first hit wins.
  const buckets = ['oldTestamentChapters', 'poetryProphecyChapters',
                   'psalmChapters', 'proverbsChapters'];
  for (const b of buckets) {
    const bucket = audioMap[b];
    if (bucket && Object.prototype.hasOwnProperty.call(bucket, key)) {
      const val = bucket[key];
      if (val && typeof val === 'string' &&
          !/REPLACE_WITH/i.test(val) && !key.startsWith('__')) return val;
    }
  }
  return null;
}

function _escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _pillHtml(label, ref, audioUrl) {
  const refSafe = _escapeHtml(ref);
  const labelHtml = label
    ? `<span class="going-deeper__pill-label">${_escapeHtml(label)}:</span> `
    : '';
  const listenHtml = audioUrl
    ? `<span class="going-deeper__pill-listen">🎧</span>`
    : '';
  if (audioUrl) {
    return `<a class="going-deeper__pill" href="${_escapeHtml(audioUrl)}" `
         + `target="_blank" rel="noopener" `
         + `aria-label="Listen to ${refSafe}">`
         + `${labelHtml}${refSafe}${listenHtml}</a>`;
  }
  return `<span class="going-deeper__pill">${labelHtml}${refSafe}</span>`;
}

function renderGoingDeeperRow(containerId, layeredCfg, audioMap) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Step 1 — master-disable gate (R1.7)
  if (!layeredCfg || layeredCfg.enabled === false) { container.innerHTML = ''; return; }
  // Step 2 — weekend gate (R2.7, R2.8, L4, L5)
  const today = new Date();
  const dow = today.getDay();
  if (dow === 0 || dow === 6) { container.innerHTML = ''; return; }

  const tz = layeredCfg.timezone || 'America/Los_Angeles';
  const streams = layeredCfg.streams || {};

  // Step 3 — build pills in canonical order (R9.3, L9)
  const pills = [];

  if (streams.otHistory && streams.otHistory.enabled !== false) {
    const r = getOtHistoryReading(today, streams.otHistory.anchor);
    if (r) {
      const ref = `${r.book} ${r.chapter}`;
      const audioUrl = _audioUrlFor(audioMap, ref);
      pills.push(_pillHtml('OT walk', ref, audioUrl));
    }
  }

  if (streams.poetryProphecy && streams.poetryProphecy.enabled !== false) {
    const r = getPoetryProphecyReading(today, streams.poetryProphecy.anchor);
    if (r) {
      const ref = `${r.book} ${r.chapter}`;
      const audioUrl = _audioUrlFor(audioMap, ref);
      pills.push(_pillHtml('Poetry & Prophecy', ref, audioUrl));
    }
  }

  if (streams.psalm && streams.psalm.enabled !== false) {
    const ref = `Psalm ${psalmOfDay(today, tz)}`;
    const audioUrl = _audioUrlFor(audioMap, ref);
    pills.push(_pillHtml(null, ref, audioUrl));
  }

  if (streams.proverbs && streams.proverbs.enabled !== false) {
    const ref = `Proverbs ${proverbOfDay(today, tz)}`;
    const audioUrl = _audioUrlFor(audioMap, ref);
    pills.push(_pillHtml(null, ref, audioUrl));
  }

  // Step 4 — empty-row guard (R1.9)
  if (pills.length === 0) { container.innerHTML = ''; return; }

  // Step 5 — atomic DOM injection
  container.innerHTML = `
    <section class="going-deeper">
      <p class="going-deeper__heading">${_escapeHtml(HEADING_COPY)}</p>
      <div class="going-deeper__pills">${pills.join('')}</div>
    </section>
  `;
}

/* ---------- DOMContentLoaded glue (§4.1.8) ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('going-deeper-container');
  if (!container) return;
  let cfg = null;
  let audioMap = {};
  try {
    const cfgRes = await fetch('assets/data/telegram-bot.json?t=' + Date.now(), { cache: 'no-store' });
    if (!cfgRes.ok) throw new Error('HTTP ' + cfgRes.status);
    const json = await cfgRes.json();
    cfg = (json && json.bible && json.bible.layeredPlan) || null;
  } catch (err) {
    console.warn('[layered-plan] config unavailable:', err.message);
    return;
  }
  try {
    const mapRes = await fetch('assets/data/bible-spotify-map.json?t=' + Date.now(), { cache: 'no-store' });
    if (mapRes.ok) audioMap = await mapRes.json();
  } catch (_err) {
    audioMap = {};
  }
  renderGoingDeeperRow('going-deeper-container', cfg, audioMap);
});

/* ---------- Public surface for console / tests ---------- */

window.LayeredPlan = {
  OT_HISTORY_BOOKS,
  POETRY_PROPHECY_BOOKS,
  OT_HISTORY_SEQUENCE,
  POETRY_PROPHECY_SEQUENCE,
  weekdaysBetween,
  parseAnchorDate,
  getOtHistoryReading,
  getPoetryProphecyReading,
  psalmOfDay,
  proverbOfDay,
  renderGoingDeeperRow,
  HEADING_COPY
};
