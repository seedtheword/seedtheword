/* Homepage showcase — daily verse, search, careers carousel */
(function() {
  'use strict';

  // ── Daily Verse ──
  // Reuse bible-plan logic to get today's reading reference
  const NT_BOOKS = [
    { name: 'Matthew', chapters: 28 }, { name: 'Mark', chapters: 16 },
    { name: 'Luke', chapters: 24 }, { name: 'John', chapters: 21 },
    { name: 'Acts', chapters: 28 }, { name: 'Romans', chapters: 16 },
    { name: '1 Corinthians', chapters: 16 }, { name: '2 Corinthians', chapters: 13 },
    { name: 'Galatians', chapters: 6 }, { name: 'Ephesians', chapters: 6 },
    { name: 'Philippians', chapters: 4 }, { name: 'Colossians', chapters: 4 },
    { name: '1 Thessalonians', chapters: 5 }, { name: '2 Thessalonians', chapters: 3 },
    { name: '1 Timothy', chapters: 6 }, { name: '2 Timothy', chapters: 4 },
    { name: 'Titus', chapters: 3 }, { name: 'Philemon', chapters: 1 },
    { name: 'Hebrews', chapters: 13 }, { name: 'James', chapters: 5 },
    { name: '1 Peter', chapters: 5 }, { name: '2 Peter', chapters: 3 },
    { name: '1 John', chapters: 5 }, { name: '2 John', chapters: 1 },
    { name: '3 John', chapters: 1 }, { name: 'Jude', chapters: 1 },
    { name: 'Revelation', chapters: 22 }
  ];
  const ANCHOR = { date: new Date(2026, 3, 30), book: 'Mark', chapter: 11 };
  const NT_SEQ = [];
  NT_BOOKS.forEach(function(b) { for (var c = 1; c <= b.chapters; c++) NT_SEQ.push({ book: b.name, chapter: c }); });
  const ANCHOR_IDX = NT_SEQ.findIndex(function(r) { return r.book === ANCHOR.book && r.chapter === ANCHOR.chapter; });

  function weekdaysBetween(from, to) {
    var f = new Date(from); f.setHours(0,0,0,0);
    var t = new Date(to); t.setHours(0,0,0,0);
    var dir = t >= f ? 1 : -1, count = 0, cur = new Date(f);
    while (cur.getTime() !== t.getTime()) {
      cur.setDate(cur.getDate() + dir);
      var d = cur.getDay();
      if (d >= 1 && d <= 5) count += dir;
    }
    return count;
  }

  function getTodayReading() {
    var now = new Date(); now.setHours(0,0,0,0);
    var dow = now.getDay();
    if (dow === 0 || dow === 6) {
      // Weekend: show Friday's reading
      var fri = new Date(now);
      fri.setDate(now.getDate() - (dow === 0 ? 2 : 1));
      now = fri;
    }
    var offset = weekdaysBetween(ANCHOR.date, now);
    var idx = ANCHOR_IDX + offset;
    if (idx < 0 || idx >= NT_SEQ.length) return null;
    return NT_SEQ[idx];
  }

  function initDailyVerse() {
    var el = document.getElementById('daily-verse');
    if (!el) return;
    var reading = getTodayReading();
    if (!reading) {
      el.querySelector('.showcase-verse__text').textContent = '\u201cThy word is a lamp unto my feet, and a light unto my path.\u201d';
      el.querySelector('.showcase-verse__ref').textContent = '\u2014 Psalm 119:105';
      return;
    }
    var textEl = el.querySelector('.showcase-verse__text');
    var refEl = el.querySelector('.showcase-verse__ref');
    textEl.textContent = "Today\u2019s reading:";
    refEl.textContent = reading.book + ' ' + reading.chapter;
    // Try to fetch a verse snippet from a free API
    fetch('https://bible-api.com/' + encodeURIComponent(reading.book + ' ' + reading.chapter + ':1'))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (data && data.text) {
          textEl.textContent = '\u201c' + data.text.trim().replace(/\n/g, ' ').slice(0, 120) + '\u2026\u201d';
          refEl.textContent = '\u2014 ' + reading.book + ' ' + reading.chapter + ':1';
        }
      })
      .catch(function() {
        textEl.textContent = "Today\u2019s reading: " + reading.book + ' ' + reading.chapter;
        refEl.textContent = 'Read along on Telegram \u2192';
      });
  }

  // ── Search ──
  var SEARCH_INDEX = null;

  function buildSearchIndex() {
    // Pre-built index of pages
    return [
      { title: 'Home', url: 'index.html', desc: 'Ministry homepage, outreach stories, join our team' },
      { title: 'Store', url: 'store.html', desc: 'Bibles in 8+ languages, tracts, merch, gift bundles' },
      { title: 'About', url: 'about.html', desc: 'Who is Jesus, our team, SEED rhythm, careers' },
      { title: 'News', url: 'news.html', desc: 'Ministry outreach stories, events, community updates' },
      { title: 'Community', url: 'community.html', desc: 'Daily Bible reading plan, Telegram, Instagram, Spotify' },
      { title: 'Donate', url: 'donate.html', desc: 'Give, impact stats, outreach stories, payment methods' },
      { title: 'Bundle Builder', url: 'bundle-builder.html', desc: 'Build a custom Bible bundle, order Bibles' },
      { title: 'Join / Apply', url: 'join.html', desc: 'Volunteer application, social media, worship band, greeter' },
      { title: 'How to Seed', url: 'how-to-seed.html', desc: 'Share your faith, evangelism, outreach tips' },
      { title: 'How to Grow', url: 'how-to-grow.html', desc: 'Grow in faith, Bible study, discipleship' },
      { title: 'Start Here', url: 'start-here.html', desc: '20-day reading plan for beginners' },
      { title: 'Prayer', url: 'community.html#prayer', desc: 'Submit a prayer request, prayer community' },
      { title: 'Careers', url: 'about.html#careers', desc: 'Volunteer positions: social media, worship, greeter, audio' },
      { title: 'Donate / Give', url: 'donate.html#give', desc: 'Venmo, Cash App, PayPal, Zelle, support the ministry' },
      { title: 'Free Bible', url: 'donate.html', desc: 'Request a free Bible in 8+ languages' },
    ];
  }

  function initSearch() {
    var toggle = document.querySelector('.showcase-search__toggle');
    var input = document.querySelector('.showcase-search__input');
    var results = document.querySelector('.showcase-search__results');
    if (!toggle || !input || !results) return;

    SEARCH_INDEX = buildSearchIndex();

    input.style.display = 'none';
    results.style.display = 'none';

    toggle.addEventListener('click', function() {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        input.style.display = 'none';
        results.style.display = 'none';
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        input.style.display = 'block';
        input.focus();
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    input.addEventListener('input', function() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { results.style.display = 'none'; return; }
      var matches = SEARCH_INDEX.filter(function(item) {
        return item.title.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q);
      });
      if (!matches.length) {
        results.innerHTML = '<div style="padding:0.75rem;color:rgba(255,255,255,0.5);font-size:0.85rem;">No results found</div>';
      } else {
        results.innerHTML = matches.map(function(m) {
          return '<a href="' + m.url + '"><strong>' + m.title + '</strong><small>' + m.desc + '</small></a>';
        }).join('');
      }
      results.style.display = 'block';
    });

    // Close on click outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.showcase-search')) {
        input.style.display = 'none';
        results.style.display = 'none';
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on Escape
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        input.style.display = 'none';
        results.style.display = 'none';
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── Careers Carousel ──
  function initCarousel() {
    var track = document.querySelector('.careers-carousel__track');
    var leftBtn = document.querySelector('.careers-carousel__arrow--left');
    var rightBtn = document.querySelector('.careers-carousel__arrow--right');
    if (!track || !leftBtn || !rightBtn) return;

    var currentOffset = 0;
    var cardWidth = 316; // 300px card + 16px gap
    var cards = track.querySelectorAll('.glass-role');
    var maxOffset = Math.max(0, (cards.length * cardWidth) - track.parentElement.clientWidth + 100);

    // Apply CSS transition for smooth gliding
    track.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)';
    track.style.display = 'flex';
    track.style.gap = '1.5rem';

    function updatePosition() {
      track.style.transform = 'translateX(' + (-currentOffset) + 'px)';
    }

    leftBtn.addEventListener('click', function() {
      currentOffset = Math.max(0, currentOffset - cardWidth);
      updatePosition();
    });

    rightBtn.addEventListener('click', function() {
      currentOffset = Math.min(maxOffset, currentOffset + cardWidth);
      updatePosition();
    });

    // Recalculate on resize
    window.addEventListener('resize', function() {
      maxOffset = Math.max(0, (cards.length * cardWidth) - track.parentElement.clientWidth + 100);
      if (currentOffset > maxOffset) { currentOffset = maxOffset; updatePosition(); }
    });
  }

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { initDailyVerse(); initSearch(); initCarousel(); });
  } else {
    initDailyVerse(); initSearch(); initCarousel();
  }
})();
