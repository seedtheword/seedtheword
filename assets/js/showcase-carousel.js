/* ============================================================
   Showcase Carousel — Homepage "Featured Ministry Feed"
   Rotates through 9 categories, each with live data when available
   and a curated fallback when not:
     1. Announcements              — next 3 upcoming events from Google Calendar
     2. Ministry Outreach          — latest entry from ministry-outreach.json
     3. Ministry Highlights        — Featured posts (FALLBACK_SLIDES)
     4. Store                      — "Gift a Bible" promo + link to /store.html
     5. Ministry Initiatives       — recurring events / ongoing service
     6. Friends in Jesus           — partner ministries, listening tos, friend messages
     7. Daily Verse / Today's Chapter — rotates from daily-verses.json
     8. How We S.E.E.D.            — one of the 5 About-page pillars per visit
     9. Tips / Reminders / Resources — daily tips, fun facts, encouragement
   Plus Instagram posts are still layered in when available.
   ============================================================ */

// --- Curated fallback slides shown until Instagram scraping works -----------
const FALLBACK_SLIDES = [
  {
    kind: 'ministry',
    eyebrow: 'Ministry Highlight',
    title: 'Bible Bundle Giveaway',
    body:
      "Hundreds of personalized Bibles have made their way into the hands of newcomers to faith — each with a handwritten note, highlighted verses, and prayer.",
    image: 'assets/images/featured/stw-bibles-giveaway.jpg',
    ctaLabel: 'See Our Bundles',
    ctaHref: 'store.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Behind the Scenes',
    title: 'Pack & Ship Nights',
    body:
      'Our volunteers pray over every Bible before it ships. Each package leaves with a blessing, a verse, and the love of our community behind it.',
    image: 'assets/images/featured/bible-ministry-1.jpg',
    ctaLabel: 'Meet the Team',
    ctaHref: 'about.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Community',
    title: 'Study Saturday Live',
    body:
      'Every Saturday, 7 PM Pacific, we gather on Twitch for Bible study, prayer, and fellowship with members from around the world.',
    image: 'assets/images/featured/stw-bibles-giveaway.jpg',
    ctaLabel: 'Join the Community',
    ctaHref: 'community.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Outreach',
    title: 'Meeting People Where They Are',
    body:
      "We don't wait for people to find us — we bring the Gospel into streets, campuses, and coffee shops. Every seed matters.",
    image: 'assets/images/backgrounds/gideon-background.jpg',
    ctaLabel: 'Support the Mission',
    ctaHref: 'community.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Story',
    title: "Zander's Bible",
    body:
      "A simple hand-off. A personalized Bible. A story that keeps unfolding. This is what Seed the Word is about — one life, one verse, one seed at a time.",
    image: 'assets/images/featured/bible-ministry-gift-zander.jpg',
    ctaLabel: 'Read More Stories',
    ctaHref: 'news.html',
  },
];

// --- Daily Bible content (migrated from old daily-content-banner) -----------
const DAILY_CONTENT = {
  verses: [
    { text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.", ref: "John 3:16" },
    { text: "Trust in the LORD with all your heart and lean not on your own understanding.", ref: "Proverbs 3:5" },
    { text: "I can do all this through him who gives me strength.", ref: "Philippians 4:13" },
    { text: "The LORD is my shepherd, I lack nothing.", ref: "Psalm 23:1" },
    { text: "And we know that in all things God works for the good of those who love him.", ref: "Romans 8:28" },
    { text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.", ref: "Joshua 1:9" },
    { text: "I planted the seed, Apollos watered it, but God has been making it grow.", ref: "1 Corinthians 3:6" },
  ],
  tips: [
    { text: "Start your day with just 5 minutes of Bible reading. Consistency matters more than duration.", ref: "Daily Habit" },
    { text: "When gifting a Bible, include a handwritten note with your favorite verse. Personal touches make all the difference.", ref: "Gifting Tip" },
    { text: "Highlight verses that speak to you. Your Bible should become a personal conversation with God.", ref: "Study Tip" },
  ],
  facts: [
    { text: "The Bible has been translated into over 3,400 languages — the most translated book in history.", ref: "Did You Know?" },
    { text: "The shortest verse in the Bible is 'Jesus wept' (John 11:35), showing His deep compassion.", ref: "Did You Know?" },
    { text: "The Bible was written by approximately 40 authors over a span of 1,500 years.", ref: "Did You Know?" },
  ],
  encouragement: [
    { text: "God is writing your story, and every chapter has purpose. Trust His timing and His plan.", ref: "A Word for You" },
    { text: "You are fearfully and wonderfully made. Never forget your worth in God's eyes.", ref: "A Word for You" },
    { text: "God's grace is new every morning. Yesterday's mistakes don't define today's possibilities.", ref: "A Word for You" },
  ],
};

// --- State ------------------------------------------------------------------
let SLIDES = [];
let currentIndex = 0;
let autoRotateTimer = null;
const AUTO_ROTATE_MS = 7000;

// --- Build the rotating slide pool -----------------------------------------
//
// Builder order matches the "Featured Ministry Feed" outline on the homepage.
// Each builder is wrapped in try/catch so one missing data file never breaks
// the whole rotation — we just fall through to the next category.
//
async function buildSlides() {
  const slides = [];

  // 1. Announcements (next 3 upcoming Google Calendar events)
  try { slides.push(...await buildAnnouncementSlides()); } catch (_) {}

  // 2. Ministry Outreach (latest entry from ministry-outreach.json)
  try { slides.push(...await buildOutreachSlides()); } catch (_) {}

  // 2.5 Testimonies (one rotating tile when published entries exist)
  try { slides.push(...await buildTestimonySlides()); } catch (_) {}

  // 3. Ministry Highlights (curated FALLBACK_SLIDES)
  try { slides.push(...buildHighlightSlides()); } catch (_) {}

  // 4. Store ("Gift a Bible" promo)
  try { slides.push(buildStoreSlide()); } catch (_) {}

  // 5. Ministry Initiatives (recurring / ongoing service)
  try { slides.push(buildInitiativesSlide()); } catch (_) {}

  // 6. Friends in Jesus (partner ministries / listening tos)
  try { slides.push(buildFriendsSlide()); } catch (_) {}

  // 7. Today's Verse / chapter (live from daily-verses.json, falls back
  //    to the embedded DAILY_CONTENT pool)
  try { slides.push(await buildVerseSlide()); } catch (_) { slides.push(getDailyBibleSlide()); }

  // 8. How We S.E.E.D. (one pillar per visit)
  try { slides.push(buildHowWeSeedSlide()); } catch (_) {}

  // 9. Tips / Reminders / Resources
  try { slides.push(buildTipSlide()); } catch (_) {}

  // Layer in Instagram on top when available — user engagement content
  // should ride alongside curated content, not replace it.
  try { slides.push(...await buildInstagramSlides()); } catch (_) {}

  return slides.filter(Boolean);
}

// -----------------------------------------------------------------
// Per-category builders
// -----------------------------------------------------------------

async function buildInstagramSlides() {
  const res = await fetch(`assets/data/instagram.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  const posts = Array.isArray(data.posts) ? data.posts : [];
  if (!posts.length) return [];
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  return posts
    .filter(p => p.date && new Date(p.date).getTime() >= cutoff)
    .sort((a, b) => {
      const aLikes = a.likes, bLikes = b.likes;
      if (aLikes != null && bLikes != null) return bLikes - aLikes;
      return new Date(b.date) - new Date(a.date);
    })
    .slice(0, 2)
    .map(p => ({
      kind: 'instagram',
      eyebrow: 'From Instagram',
      title: (p.caption || 'New on Instagram').split('\n')[0].slice(0, 80),
      body: p.caption || '',
      image: p.thumbnail,
      ctaLabel: 'View on Instagram',
      ctaHref: p.url,
    }));
}

async function buildAnnouncementSlides() {
  // Google Calendar feed (public iCal). The news page hits the same
  // endpoint; we reuse the google-calendar.js script when it's loaded.
  // Fall back to a single curated announcement when no calendar data
  // is available so the slot still feels alive.
  const fallback = [{
    kind: 'announcement',
    eyebrow: 'Announcement',
    title: 'Study Saturday — every week, 7 PM PT',
    body: 'Join us every Saturday for Bible study, fellowship, and prayer with members around the world. Livestream on Twitch.',
    image: 'assets/images/featured/stw-bibles-giveaway.jpg',
    ctaLabel: 'See the calendar',
    ctaHref: 'news.html#calendar-section',
  }];
  if (!window.googleCalendarEvents || !Array.isArray(window.googleCalendarEvents)) {
    return fallback;
  }
  const now = Date.now();
  const upcoming = window.googleCalendarEvents
    .filter(e => e && e.startDate && new Date(e.startDate).getTime() > now)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
    .slice(0, 2);
  if (!upcoming.length) return fallback;
  return upcoming.map(e => ({
    kind: 'announcement',
    eyebrow: 'Announcement',
    title: e.summary || 'Upcoming event',
    body: `${formatEventDate(e.startDate)}${e.location ? ' · ' + e.location : ''}${e.description ? ' — ' + e.description.slice(0, 140) : ''}`,
    image: 'assets/images/backgrounds/bible-in-background.jpg',
    ctaLabel: 'See the calendar',
    ctaHref: 'news.html#calendar-section',
  }));
}

async function buildOutreachSlides() {
  const res = await fetch(`assets/data/ministry-outreach.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  const events = Array.isArray(data.events) ? data.events : [];
  if (!events.length) return [];
  const latest = events[0];
  // Try to pick a cover image from the event folder manifest. Falls
  // back to a sensible ministry background if the manifest is missing.
  let image = 'assets/images/featured/bible-ministry-1.jpg';
  if (latest.folder) {
    try {
      const mr = await fetch(`assets/images/ministry-outreach/${latest.folder}/images.json?t=${Date.now()}`, { cache: 'no-store' });
      if (mr.ok) {
        const m = await mr.json();
        const imgs = Array.isArray(m.images) ? m.images : [];
        if (imgs.length && imgs[0].file) {
          image = `assets/images/ministry-outreach/${latest.folder}/${imgs[0].file}`;
        }
      }
    } catch (_) {}
  }
  return [{
    kind: 'outreach',
    eyebrow: 'Ministry Outreach',
    title: latest.title || 'Latest outreach',
    body: `${latest.date || ''}${latest.location ? ' · ' + latest.location : ''} — ${latest.body || ''}`,
    image: image,
    ctaLabel: 'Read the story',
    ctaHref: 'news.html#ministry-outreach',
  }];
}

async function buildTestimonySlides() {
  // Only render a testimony slide when STWTestimonies (testimonies.js)
  // is present and has at least one published entry. Picks one at
  // random from the 5 most recently published so repeat visitors see
  // variety. Never throws — failures are swallowed by the try/catch
  // in buildSlides() above.
  if (!window.STWTestimonies || typeof window.STWTestimonies.pickShowcaseTestimony !== 'function') {
    return [];
  }
  const t = await window.STWTestimonies.pickShowcaseTestimony();
  if (!t) return [];
  const author = (t.anonymous === true)
    ? 'Anonymous'
    : ((t.name && String(t.name).trim()) || 'Anonymous');
  // Rotate through the testimony image folder so visitors don't always
  // see the same backdrop. Falls back to a brand image when the manifest
  // is empty or unreachable.
  const image = await pickTestimonyImage();
  return [{
    kind: 'testimony',
    eyebrow: 'Testimony',
    title: '"' + (t.excerpt || '') + '"',
    body: author + ' · ' + (t.anchorVerse || ''),
    image: image,
    ctaLabel: 'Read more testimonies',
    ctaHref: 'news.html#testimonies-section',
  }];
}

// Lazily fetch + memoize the testimony image manifest. Returns the path
// to one image picked deterministically by today's date so the same
// visitor sees the same picture across page loads. Empty manifest =
// brand-image fallback. Network errors = brand-image fallback.
let _testimonyImagesPromise = null;
function loadTestimonyImages() {
  if (_testimonyImagesPromise) return _testimonyImagesPromise;
  _testimonyImagesPromise = fetch('assets/images/testimonies/images.json?t=' + Date.now(), { cache: 'no-store' })
    .then((res) => res.ok ? res.json() : { images: [] })
    .then((data) => Array.isArray(data && data.images) ? data.images : [])
    .catch(() => []);
  return _testimonyImagesPromise;
}
async function pickTestimonyImage() {
  const fallback = 'assets/images/featured/stw-bibles-giveaway.jpg';
  try {
    const list = await loadTestimonyImages();
    if (!list.length) return fallback;
    const seed = Math.floor(Date.now() / 86400000); // day-granularity
    const entry = list[seed % list.length];
    if (entry && entry.file) return 'assets/images/testimonies/' + entry.file;
  } catch (_) { /* fall through */ }
  return fallback;
}

function buildHighlightSlides() {
  // Rotate through 2 of the curated highlights each visit to keep the
  // rotation feeling fresh without drowning newer content.
  const seed = Math.floor(Date.now() / 86400000); // day-granularity seed
  const offset = seed % FALLBACK_SLIDES.length;
  const out = [];
  for (let i = 0; i < 2; i++) {
    out.push(FALLBACK_SLIDES[(offset + i) % FALLBACK_SLIDES.length]);
  }
  return out;
}

function buildStoreSlide() {
  return {
    kind: 'store',
    eyebrow: 'From the Store',
    title: 'Gift a Bible — sponsor a bundle',
    body: "Every bundle you sponsor becomes someone's first Bible. Hand-packed, prayed over, and shipped with a handwritten note.",
    image: 'assets/images/backgrounds/store.jpg',
    ctaLabel: 'Visit the Store',
    ctaHref: 'store.html',
  };
}

function buildInitiativesSlide() {
  // Ministry Initiatives = the ongoing rhythms of the ministry. One
  // initiative is surfaced per day so it feels like a weekly digest.
  const initiatives = [
    {
      title: 'Tuesdays — welcoming newcomers',
      body: 'Every Tuesday we make space for newcomers to faith. Gentle, honest conversation. Questions welcome. Bibles on the table.',
      image: 'assets/images/featured/stw-bibles-giveaway.jpg',
    },
    {
      title: 'Fridays — young adult fellowship',
      body: 'Fridays we gather as young adults to study, break bread, pray for each other, and encourage one another in Christ.',
      image: 'assets/images/featured/stw-ministry-team.jpg',
    },
    {
      title: 'Sundays — in a local church',
      body: 'We go to church Sundays. Bring a friend, or ask us to come with you to yours — just reach out.',
      image: 'assets/images/backgrounds/bible-in-background.jpg',
    },
    {
      title: 'Study Saturdays — the weekly review',
      body: 'Saturdays we recap the week\'s reading and dive deeper as a community — in person and on Twitch.',
      image: 'assets/images/backgrounds/stw-background.jpg',
    },
  ];
  const pick = initiatives[Math.floor(Date.now() / 86400000) % initiatives.length];
  return {
    kind: 'initiative',
    eyebrow: 'Ministry Initiative',
    title: pick.title,
    body: pick.body,
    image: pick.image,
    ctaLabel: 'Explore our rhythm',
    ctaHref: 'about.html#how-we-seed',
  };
}

function buildFriendsSlide() {
  return {
    kind: 'friends',
    eyebrow: 'Friends in Jesus',
    title: 'Voices we walk with',
    body: "Partner ministries, brothers and sisters we listen to, and friends we share the road with — see who we're walking alongside.",
    image: 'assets/images/featured/bible-ministry-gift-zander.jpg',
    ctaLabel: 'Meet our friends',
    ctaHref: 'community.html#friends-in-jesus',
  };
}

async function buildVerseSlide() {
  const res = await fetch(`assets/data/daily-verses.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('verses unavailable');
  const data = await res.json();
  const verses = Array.isArray(data.verses) ? data.verses : [];
  if (!verses.length) throw new Error('no verses');
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const v = verses[dayOfYear % verses.length];
  return {
    kind: 'scripture',
    eyebrow: "Today's Verse",
    title: v.ref + (v.version ? ` (${v.version})` : ''),
    body: v.text,
    image: 'assets/images/backgrounds/john-3-16.jpg',
    ctaLabel: 'Share',
    ctaHref: '#',
    isShare: true,
  };
}

function buildHowWeSeedSlide() {
  const pillars = [
    {
      title: 'How We Read Our Bible',
      body: 'Monday–Friday we read one chapter a day together. Saturdays we review. We began in the New Testament for newcomers; the Old Testament is woven into Study Saturdays.',
      image: 'assets/images/backgrounds/bible-in-background.jpg',
    },
    {
      title: 'Embrace Fellowship',
      body: "Tuesdays for newcomers, Fridays as young adults, Sundays in church. Bring a friend, or ask us to come with you — just reach out.",
      image: 'assets/images/featured/stw-bibles-giveaway.jpg',
    },
    {
      title: 'Encounter Jesus + Study Saturdays',
      body: 'Tuesdays are for welcoming newcomers. Saturdays are for going deeper — recapping the week and letting the Word shape the next.',
      image: 'assets/images/backgrounds/stw-background.jpg',
    },
    {
      title: 'Prayer & Worship',
      body: 'Prayer and worship are woven into everything we do. Philippians 4:6-8. John 4:23-24. Got an idea for how we can do this better?',
      image: 'assets/images/backgrounds/john-3-16.jpg',
    },
    {
      title: 'How We Outreach',
      body: "We give away Bibles — on the street, to newcomers, to anyone who wants one. Our whole goal is finding creative, faithful ways to put God's Word into people's hands.",
      image: 'assets/images/backgrounds/gideon-background.jpg',
    },
  ];
  const pick = pillars[Math.floor(Date.now() / 86400000) % pillars.length];
  return {
    kind: 'howwe',
    eyebrow: 'How We S.E.E.D.',
    title: pick.title,
    body: pick.body,
    image: pick.image,
    ctaLabel: 'Read the full breakdown',
    ctaHref: 'about.html#how-we-seed',
  };
}

function buildTipSlide() {
  const pool = [
    ...DAILY_CONTENT.tips.map(t => ({ ...t, cat: 'Daily Tip', image: 'assets/images/backgrounds/bible-in-background.jpg' })),
    ...DAILY_CONTENT.facts.map(t => ({ ...t, cat: 'Did You Know?', image: 'assets/images/backgrounds/gideon-background-3.jpg' })),
    ...DAILY_CONTENT.encouragement.map(t => ({ ...t, cat: 'A Word for You', image: 'assets/images/backgrounds/bible-in-background.jpg' })),
  ];
  const pick = pool[Math.floor(Date.now() / 86400000) % pool.length];
  return {
    kind: 'tip',
    eyebrow: pick.cat,
    title: pick.ref || pick.cat,
    body: pick.text,
    image: pick.image,
    ctaLabel: 'More resources',
    ctaHref: 'community.html#help',
  };
}

function formatEventDate(d) {
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (_) {
    return '';
  }
}

function getDailyBibleSlide() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const categories = Object.keys(DAILY_CONTENT);
  const category = categories[dayOfYear % categories.length];
  const items = DAILY_CONTENT[category];
  const item = items[dayOfYear % items.length];

  const eyebrowMap = {
    verses: "Today's Verse",
    tips: 'Daily Tip',
    facts: 'Did You Know?',
    encouragement: "A Word for You",
  };

  return {
    kind: 'scripture',
    eyebrow: eyebrowMap[category] || "Today's Word",
    title: item.ref,
    body: item.text,
    image: 'assets/images/backgrounds/john-3-16.jpg',
    ctaLabel: 'Share',
    ctaHref: '#',
    isShare: true,
  };
}

// --- Render -----------------------------------------------------------------
function render(container) {
  const slidesHtml = SLIDES.map((slide, i) => {
    const isScripture = slide.kind === 'scripture';
    const isInstagram = slide.kind === 'instagram';
    const isTestimony = slide.kind === 'testimony';
    const ctaAttrs = slide.isShare
      ? `href="javascript:void(0)" onclick="window.shareShowcaseSlide(${i})"`
      : `href="${slide.ctaHref}"${slide.ctaHref?.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}`;

    return `
      <article class="showcase-slide ${i === currentIndex ? 'active' : ''} ${isScripture ? 'is-scripture' : ''} ${isInstagram ? 'is-instagram' : ''} ${isTestimony ? 'is-testimony' : ''}" data-index="${i}">
        <div class="showcase-slide__image" style="background-image: url('${slide.image}');"></div>
        <div class="showcase-slide__vignette"></div>
        <div class="showcase-slide__content">
          <span class="showcase-slide__eyebrow">${escapeHtml(slide.eyebrow)}</span>
          <h3 class="showcase-slide__title">${escapeHtml(slide.title)}</h3>
          <p class="showcase-slide__body">${escapeHtml(truncate(slide.body, 220))}</p>
          <a class="showcase-slide__cta" ${ctaAttrs}>
            ${escapeHtml(slide.ctaLabel)}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </article>
    `;
  }).join('');

  const dotsHtml = SLIDES.map((_, i) =>
    `<button class="showcase-dot ${i === currentIndex ? 'active' : ''}" data-index="${i}" aria-label="Slide ${i + 1}"></button>`
  ).join('');

  container.innerHTML = `
    <div class="showcase">
      <div class="showcase__peek showcase__peek--left" aria-hidden="true"></div>
      <div class="showcase__peek showcase__peek--right" aria-hidden="true"></div>

      <div class="showcase__stage">
        <button class="showcase__nav showcase__nav--prev" aria-label="Previous slide">‹</button>
        <div class="showcase__slides">${slidesHtml}</div>
        <button class="showcase__nav showcase__nav--next" aria-label="Next slide">›</button>
      </div>

      <div class="showcase__dots">${dotsHtml}</div>
    </div>
  `;

  updatePeekImages(container);
  wireControls(container);
}

function updatePeekImages(container) {
  const peekLeft = container.querySelector('.showcase__peek--left');
  const peekRight = container.querySelector('.showcase__peek--right');
  if (!peekLeft || !peekRight) return;

  const total = SLIDES.length;
  const prev = SLIDES[(currentIndex - 1 + total) % total];
  const next = SLIDES[(currentIndex + 1) % total];

  peekLeft.style.backgroundImage = `url('${prev?.image || ''}')`;
  peekRight.style.backgroundImage = `url('${next?.image || ''}')`;
}

function wireControls(container) {
  const prevBtn = container.querySelector('.showcase__nav--prev');
  const nextBtn = container.querySelector('.showcase__nav--next');
  const dots = container.querySelectorAll('.showcase-dot');

  prevBtn?.addEventListener('click', () => go(-1));
  nextBtn?.addEventListener('click', () => go(1));
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      goTo(parseInt(dot.dataset.index, 10));
    });
  });

  // Pause auto-rotate on hover
  const showcaseEl = container.querySelector('.showcase');
  showcaseEl?.addEventListener('mouseenter', stopAutoRotate);
  showcaseEl?.addEventListener('mouseleave', startAutoRotate);
}

function go(delta) {
  const total = SLIDES.length;
  goTo((currentIndex + delta + total) % total);
}

function goTo(index) {
  const total = SLIDES.length;
  if (index < 0 || index >= total || index === currentIndex) return;
  currentIndex = index;

  const container = document.getElementById('showcase-container');
  if (!container) return;

  container.querySelectorAll('.showcase-slide').forEach((el, i) => {
    el.classList.toggle('active', i === currentIndex);
  });
  container.querySelectorAll('.showcase-dot').forEach((el, i) => {
    el.classList.toggle('active', i === currentIndex);
  });
  updatePeekImages(container);
}

function startAutoRotate() {
  stopAutoRotate();
  autoRotateTimer = setInterval(() => go(1), AUTO_ROTATE_MS);
}
function stopAutoRotate() {
  if (autoRotateTimer) clearInterval(autoRotateTimer);
  autoRotateTimer = null;
}

// --- Utilities --------------------------------------------------------------
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

// --- Share action (for scripture slides) ------------------------------------
window.shareShowcaseSlide = function (index) {
  const slide = SLIDES[index];
  if (!slide) return;
  const shareText = `${slide.title ? slide.title + '\n\n' : ''}"${slide.body}"\n\n— Seed the Word Ministry`;
  if (navigator.share) {
    navigator.share({ title: slide.eyebrow || 'Seed the Word', text: shareText }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(shareText).then(() => {
      alert('Copied to clipboard!');
    });
  }
};

// --- Init -------------------------------------------------------------------
async function initShowcase() {
  const container = document.getElementById('showcase-container');
  if (!container) return;

  SLIDES = await buildSlides();
  if (!SLIDES.length) {
    container.innerHTML = '';
    return;
  }
  render(container);
  startAutoRotate();
}

document.addEventListener('DOMContentLoaded', initShowcase);
