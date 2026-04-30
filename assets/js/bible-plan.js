/* ============================================================
   Bible Study Plan — auto-computing 1 chapter/day, Mon–Fri
   Anchored on: Thu Apr 30 2026 = Mark 11
   ============================================================ */

// New Testament books in reading order, with chapter counts
const NT_BOOKS = [
  { name: 'Matthew',         chapters: 28 },
  { name: 'Mark',            chapters: 16 },
  { name: 'Luke',            chapters: 24 },
  { name: 'John',            chapters: 21 },
  { name: 'Acts',            chapters: 28 },
  { name: 'Romans',          chapters: 16 },
  { name: '1 Corinthians',   chapters: 16 },
  { name: '2 Corinthians',   chapters: 13 },
  { name: 'Galatians',       chapters: 6  },
  { name: 'Ephesians',       chapters: 6  },
  { name: 'Philippians',     chapters: 4  },
  { name: 'Colossians',      chapters: 4  },
  { name: '1 Thessalonians', chapters: 5  },
  { name: '2 Thessalonians', chapters: 3  },
  { name: '1 Timothy',       chapters: 6  },
  { name: '2 Timothy',       chapters: 4  },
  { name: 'Titus',           chapters: 3  },
  { name: 'Philemon',        chapters: 1  },
  { name: 'Hebrews',         chapters: 13 },
  { name: 'James',           chapters: 5  },
  { name: '1 Peter',         chapters: 5  },
  { name: '2 Peter',         chapters: 3  },
  { name: '1 John',          chapters: 5  },
  { name: '2 John',          chapters: 1  },
  { name: '3 John',          chapters: 1  },
  { name: 'Jude',            chapters: 1  },
  { name: 'Revelation',      chapters: 22 }
];

// Anchor: the reading on this specific date
const ANCHOR = {
  date: new Date(2026, 3, 30), // Thu Apr 30 2026 (month is 0-indexed)
  book: 'Mark',
  chapter: 11
};

// Flat sequence of readings [{ book, chapter }, ...] spanning the whole NT
const NT_SEQUENCE = (() => {
  const seq = [];
  for (const b of NT_BOOKS) {
    for (let c = 1; c <= b.chapters; c++) {
      seq.push({ book: b.name, chapter: c });
    }
  }
  return seq;
})();

// Index of anchor reading in the sequence
const ANCHOR_INDEX = NT_SEQUENCE.findIndex(
  r => r.book === ANCHOR.book && r.chapter === ANCHOR.chapter
);

/**
 * Count the number of weekdays (Mon-Fri) between two dates, inclusive.
 * Returns positive if toDate is after fromDate, negative if before.
 */
function weekdaysBetween(fromDate, toDate) {
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(toDate);
  to.setHours(0, 0, 0, 0);

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

/**
 * Get the reading for a given date. Returns null for weekends (no reading).
 */
function getReadingForDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null; // Sat/Sun: no reading

  const offset = weekdaysBetween(ANCHOR.date, d);
  const idx = ANCHOR_INDEX + offset;

  if (idx < 0 || idx >= NT_SEQUENCE.length) return null;
  return { ...NT_SEQUENCE[idx], date: d };
}

/**
 * Get the current week's readings (Mon-Fri).
 */
function getWeekReadings(referenceDate = new Date()) {
  const ref = new Date(referenceDate);
  ref.setHours(0, 0, 0, 0);

  // Find the Monday of this week
  const day = ref.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - daysFromMonday);

  const readings = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    readings.push(getReadingForDate(d));
  }
  return readings;
}

/**
 * Render the current week's plan into the given container.
 */
function renderBiblePlan(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const readings = getWeekReadings(today);

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  const cardsHtml = readings.map((reading, i) => {
    if (!reading) return '';
    const isToday = reading.date.getTime() === today.getTime();
    const isPast = reading.date < today;
    const dateLabel = reading.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return `
      <div class="bible-day-card ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}">
        <div class="bible-day-card__label">${dayLabels[i]} · ${dateLabel}</div>
        <div class="bible-day-card__reading">${reading.book} ${reading.chapter}</div>
        ${isToday ? '<div class="bible-day-card__badge">Today</div>' : ''}
      </div>
    `;
  }).join('');

  const todayReading = readings.find(r => r && r.date.getTime() === today.getTime());
  const todayText = todayReading
    ? `Today: <strong>${todayReading.book} ${todayReading.chapter}</strong>`
    : 'Rest day — catch up on missed readings or reflect.';

  container.innerHTML = `
    <div class="bible-plan">
      <div class="bible-plan__today-banner">${todayText}</div>
      <div class="bible-plan__week">${cardsHtml}</div>
      <p class="bible-plan__note">
        Reading 1 chapter a day, Monday through Friday, through the New Testament.
      </p>
    </div>
  `;
}

// Auto-render if target container exists on page
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('bible-plan-container')) {
    renderBiblePlan('bible-plan-container');
  }
});

// Expose for manual calls
window.BiblePlan = { renderBiblePlan, getReadingForDate, getWeekReadings };
