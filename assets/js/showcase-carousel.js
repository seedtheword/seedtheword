/* ============================================================
   Showcase Carousel — Homepage featured section
   Rotates between:
   - Featured Instagram posts (from assets/data/instagram.json when
     the scraper populates it; falls back to curated content below)
   - Daily Bible content (verses, tips, fun facts — preserved from
     the old daily-content-banner)
   ============================================================ */

// --- Curated fallback slides shown until Instagram scraping works -----------
const FALLBACK_SLIDES = [
  {
    kind: 'ministry',
    eyebrow: 'Ministry Highlight',
    title: 'Bible Bundle Giveaway',
    body:
      "Hundreds of personalized Bibles have made their way into the hands of newcomers to faith — each with a handwritten note, highlighted verses, and prayer.",
    image: 'assets/images/stw-bibles-giveaway.jpg',
    ctaLabel: 'See Our Bundles',
    ctaHref: 'store.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Behind the Scenes',
    title: 'Pack & Ship Nights',
    body:
      'Our volunteers pray over every Bible before it ships. Each package leaves with a blessing, a verse, and the love of our community behind it.',
    image: 'assets/images/bible-ministry-1.jpg',
    ctaLabel: 'Meet the Team',
    ctaHref: 'about.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Community',
    title: 'Study Saturday Live',
    body:
      'Every Saturday, 2 PM Pacific, we gather on Twitch for Bible study, prayer, and fellowship with members from around the world.',
    image: 'assets/images/stw-ministry-team.jpg',
    ctaLabel: 'Join the Community',
    ctaHref: 'community.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Outreach',
    title: 'Meeting People Where They Are',
    body:
      "We don't wait for people to find us — we bring the Gospel into streets, campuses, and coffee shops. Every seed matters.",
    image: 'assets/images/gideon-background-2.jpg',
    ctaLabel: 'Support the Mission',
    ctaHref: 'community.html',
  },
  {
    kind: 'ministry',
    eyebrow: 'Story',
    title: "Zander's Bible",
    body:
      "A simple hand-off. A personalized Bible. A story that keeps unfolding. This is what Seed the Word is about — one life, one verse, one seed at a time.",
    image: 'assets/images/bible-ministry-gift-zander.jpg',
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
async function buildSlides() {
  const slides = [];

  // Try to load Instagram data first
  let igPosts = [];
  try {
    const res = await fetch(`assets/data/instagram.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      igPosts = Array.isArray(data.posts) ? data.posts : [];
    }
  } catch (e) {
    /* ignore; fallback handles it */
  }

  // Pick top 3 Instagram posts by likes from the last 60 days
  if (igPosts.length) {
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const topIg = igPosts
      .filter(p => p.date && new Date(p.date).getTime() >= cutoff)
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .slice(0, 3)
      .map(p => ({
        kind: 'instagram',
        eyebrow: 'From Instagram',
        title: (p.caption || 'New on Instagram').split('\n')[0].slice(0, 80),
        body: p.caption || '',
        image: p.thumbnail,
        ctaLabel: 'View on Instagram',
        ctaHref: p.url,
        meta: {
          likes: p.likes,
          date: p.date,
        },
      }));
    slides.push(...topIg);
  }

  // Always include ministry highlights (fewer if IG loaded, more if not)
  const fallbackCount = slides.length ? 2 : FALLBACK_SLIDES.length;
  slides.push(...FALLBACK_SLIDES.slice(0, fallbackCount));

  // Add one daily Bible verse/tip to keep the rotation interesting
  slides.push(getDailyBibleSlide());

  return slides;
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
    image: 'assets/images/john-3-16.jpg',
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
    const ctaAttrs = slide.isShare
      ? `href="javascript:void(0)" onclick="window.shareShowcaseSlide(${i})"`
      : `href="${slide.ctaHref}"${slide.ctaHref?.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}`;

    return `
      <article class="showcase-slide ${i === currentIndex ? 'active' : ''} ${isScripture ? 'is-scripture' : ''} ${isInstagram ? 'is-instagram' : ''}" data-index="${i}">
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
