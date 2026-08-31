/* ============================================================
   Community Catalog — Topic navigation, search, content grid
   for the "Friends in Jesus" section on community.html
   ============================================================ */
(function () {
  'use strict';

  // ── Helpers ─────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, ms) {
    var timer;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max).replace(/\s+\S*$/, '') + '…' : str;
  }

  // ── Categories ──────────────────────────────────────────────
  var categories = [
    { key: 'listening', label: 'Listening', icon: '🎧', description: 'Podcasts, episodes, and channels we recommend' },
    { key: 'partners', label: 'Partners', icon: '🤝', description: 'Ministries we walk alongside' },
    { key: 'messages', label: 'Messages', icon: '🎬', description: 'Video teachings from friends' }
  ];

  // ── Hardcoded items ─────────────────────────────────────────
  var messageItems = [
    {
      id: 'msg-pastor-vlad',
      category: 'messages',
      title: 'Why the Church Can\'t Be Neutral Anymore',
      from: 'HungryGen — Pastor Vlad',
      description: 'A challenge to keep walking the line our ministry was built on: there is no neutral ground when it comes to Jesus. Sit with this one.',
      embedType: 'iframe',
      embedSrc: 'https://drive.google.com/file/d/1JjsvIWyNxXVowOwFY_DmpS7-N_Jj4Zag/preview',
      landscape: true
    },
    {
      id: 'msg-ruslan-y',
      category: 'messages',
      title: 'A message from our friend, Ruslan Y.',
      from: 'Sent to Seed the Word with love.',
      description: 'A short encouragement from our friend Ruslan — one of the voices who has walked alongside our ministry. We\'re grateful for his heart for the Gospel and wanted to share his words with you.',
      embedType: 'video',
      embedSrc: 'assets/videos/ruslan-y-message.mp4'
    }
  ];

  var resourceItems = [
    {
      id: 'res-20-day-plan',
      category: 'resources',
      title: '20-Day Reading Plan',
      description: 'A month-long starter plan for brand-new readers — walk through the foundations of faith one chapter at a time.',
      url: 'start-here.html',
      icon: '📅'
    },
    {
      id: 'res-how-to-grow',
      category: 'resources',
      title: 'How to Grow',
      description: 'The four-movement evangelism guide — how to share your faith naturally, meet people where they are, and walk them toward Jesus.',
      url: 'how-to-grow.html',
      icon: '🌱'
    },
    {
      id: 'res-how-to-seed',
      category: 'resources',
      title: 'How to Seed',
      description: 'Our practical guide to seeding the Word — giving Bibles, starting conversations, and planting Gospel seeds in everyday life.',
      url: 'how-to-seed.html',
      icon: '🌾'
    }
  ];

  // ── State ───────────────────────────────────────────────────
  var items = [];
  var rawListening = []; // raw JSON listening array (keeps shelf/tag/featured)
  var searchIndex = [];
  var activeCategory = 'listening';
  var searchResultIds = null;

  // DOM refs
  var gridEl, sidebarEl, overlayEl, searchInput, clearBtn, countBadge, categoryHeaderEl;

  // ── Build items from fetched data ───────────────────────────
  function buildItems(data) {
    var all = [];

    // Listening items — store raw for shelf rendering
    rawListening = data.listening || [];

    rawListening.forEach(function (item, i) {
      var url = '';
      if (item.kind === 'spotify') {
        if (item.type === 'episode') url = 'https://open.spotify.com/episode/' + item.id;
        else if (item.type === 'show') url = 'https://open.spotify.com/show/' + item.id;
      } else if (item.kind === 'youtube') {
        if (item.handle) url = 'https://youtube.com/' + item.handle;
        else if (item.id) url = 'https://youtube.com/channel/' + item.id;
      }

      // Prefer a repo-local image (reliable) → explicit JSON image → JSON
      // thumbnail (fragile external CDN) → letter fallback. Local convention:
      // assets/images/friends/<slug>.jpg  (slug = lowercased title, a-z0-9).
      var slug = String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      var localThumb = slug ? 'assets/images/friends/' + slug + '.jpg' : '';

      all.push({
        id: 'listen-' + i,
        category: 'listening',
        title: item.title || 'Untitled',
        source: item.source || '',
        kind: item.kind || 'link',
        type: item.type || item.feedType || '',
        url: url,
        note: item.note || '',
        localThumb: localThumb,
        thumbnail: item.image || item.thumbnail || '',
        spotifyId: item.id || '',
        youtubeId: item.id || '',
        shelf: item.shelf || '',
        tag: item.tag || '',
        featured: item.featured || false,
        handle: item.handle || ''
      });
    });

    // Partner items
    (data.partners || []).forEach(function (partner, i) {
      all.push({
        id: 'partner-' + i,
        category: 'partners',
        title: partner.name,
        pointOfContact: partner.pointOfContact || '',
        story: partner.story || '',
        photo: (partner.photos && partner.photos.length) ? partner.photos[0] : '',
        url: partner.url || '',
        socials: partner.socials || []
      });
    });

    // Messages (hardcoded)
    all = all.concat(messageItems);

    // Resources (hardcoded)
    all = all.concat(resourceItems);

    return all;
  }

  // ── Search index builder ────────────────────────────────────
  function buildSearchIndex(allItems) {
    return allItems.map(function (item) {
      var parts = [
        item.title || '',
        item.source || '',
        item.description || '',
        item.story || '',
        item.from || '',
        item.pointOfContact || '',
        item.kind || '',
        item.tag || '',
        item.category
      ];
      return {
        id: item.id,
        name: (item.title || '').toLowerCase(),
        text: parts.join(' ').toLowerCase(),
        category: item.category
      };
    });
  }

  // ── Search algorithm ────────────────────────────────────────
  function searchItems(query, index) {
    var normalized = query.trim().toLowerCase();
    if (!normalized) return null;

    var terms = normalized.split(/\s+/);
    var scored = [];

    for (var i = 0; i < index.length; i++) {
      var entry = index[i];
      var score = 0;

      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        if (entry.name.indexOf(term) !== -1) {
          score += 3;
        } else if (entry.text.indexOf(term) !== -1) {
          score += 1;
        } else {
          score = 0;
          break;
        }
      }

      if (score > 0) {
        scored.push({ id: entry.id, score: score });
      }
    }

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (s) { return s.id; });
  }

  // ── Filter items ────────────────────────────────────────────
  function filterItems(allItems, categoryKey, resultIds) {
    var filtered = allItems.filter(function (item) {
      if (item.category !== categoryKey) return false;
      if (resultIds !== null && resultIds.indexOf(item.id) === -1) return false;
      return true;
    });

    if (resultIds !== null) {
      filtered.sort(function (a, b) {
        return resultIds.indexOf(a.id) - resultIds.indexOf(b.id);
      });
    }

    return filtered;
  }

  // ── Netflix-style Listening Layout ──────────────────────────
  function renderListeningShelf() {
    var listening = filterItems(items, 'listening', searchResultIds);
    if (!listening.length) return renderEmpty();

    var featured = listening.filter(function (i) { return i.featured; });
    var channels = listening.filter(function (i) { return i.shelf === 'channels'; });
    var podcasts = listening.filter(function (i) { return i.shelf === 'podcasts'; });

    // Group channels by tag
    var teaching = channels.filter(function (i) { return i.tag === 'teaching'; });
    var worship = channels.filter(function (i) { return i.tag === 'worship'; });
    var entertainment = channels.filter(function (i) { return i.tag === 'entertainment'; });

    var html = '';

    // 1. Featured hero card
    if (featured.length) {
      html += renderFeaturedHero(featured[0]);
    }

    // (Removed the social promo banner — redundant with header/bottom-nav socials.)

    // 3. Channel shelves by tag
    if (teaching.length) {
      html += renderShelf('📖 Teaching & Bible Study', teaching);
    }
    if (worship.length) {
      html += renderShelf('🎵 Worship & Music', worship);
    }
    if (entertainment.length) {
      html += renderShelf('🎬 Entertainment & Animation', entertainment);
    }

    // 4. Podcasts row
    if (podcasts.length) {
      html += renderShelf('🎧 Podcasts & Shows', podcasts);
    }

    return html;
  }

  function renderFeaturedHero(item) {
    var kindLabel = item.kind === 'spotify' ? 'Spotify' : 'YouTube';
    var thumbAttr = '';
    var thumbClass = '';
    if (item.thumbnail) {
      // Static thumbnail — render img directly
      thumbClass = '';
    } else {
      thumbClass = ' store-card__image--loading';
      if (item.kind === 'spotify' && item.spotifyId) {
        thumbAttr = ' data-spotify-id="' + esc(item.spotifyId) + '" data-spotify-type="' + esc(item.type) + '"';
      } else if (item.kind === 'youtube' && item.youtubeId) {
        thumbAttr = ' data-youtube-id="' + esc(item.youtubeId) + '"';
      }
    }

    var thumbContent = item.thumbnail
      ? '<img class="listen-card__img" src="' + esc(item.thumbnail) + '" alt="' + esc(item.title) + '" loading="lazy">'
      : '';

    return (
      '<div class="listen-hero">' +
        '<div class="listen-hero__thumb' + thumbClass + '"' + thumbAttr + '>' +
          thumbContent +
          '<div class="listen-hero__gradient"></div>' +
          '<div class="listen-hero__badge">⭐ Featured</div>' +
        '</div>' +
        '<div class="listen-hero__content">' +
          '<span class="listen-hero__eyebrow">🟢 ' + esc(kindLabel) + ' · ' + esc(item.type) + '</span>' +
          '<h3 class="listen-hero__title">' + esc(item.title) + '</h3>' +
          '<p class="listen-hero__desc">' + esc(item.source) + (item.note ? ' — ' + esc(item.note) : '') + '</p>' +
          (item.url
            ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" class="listen-hero__btn">▶ Listen Now</a>'
            : '') +
        '</div>' +
      '</div>'
    );
  }

  function renderSocialBanner() {
    return (
      '<div class="listen-social-banner">' +
        '<div class="listen-social-banner__text">' +
          '<p class="listen-social-banner__lead">Stay in the loop with our community</p>' +
          '<p class="listen-social-banner__sub">Daily conversation, prayer, and verse cards — join us where we\'re most active.</p>' +
        '</div>' +
        '<div class="listen-social-banner__links">' +
          '<a href="https://t.me/seedtheword" target="_blank" rel="noopener" class="listen-social-banner__link listen-social-banner__link--telegram">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/></svg>' +
            '<span>Join Telegram</span>' +
          '</a>' +
          '<a href="https://www.instagram.com/seedtheword/" target="_blank" rel="noopener" class="listen-social-banner__link listen-social-banner__link--instagram">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>' +
            '<span>Follow @seedtheword</span>' +
          '</a>' +
        '</div>' +
      '</div>'
    );
  }

  function renderShelf(title, shelfItems) {
    var cardsHTML = shelfItems.map(function (item) {
      return renderShelfCard(item);
    }).join('');

    return (
      '<div class="listen-shelf">' +
        '<h4 class="listen-shelf__title">' + title + '</h4>' +
        '<div class="listen-shelf__scroll">' +
          cardsHTML +
        '</div>' +
      '</div>'
    );
  }

  function renderShelfCard(item) {
    var thumbAttr = '';
    var thumbClass = '';
    var thumbContent = '';

    var initial = (item.title || '?').charAt(0).toUpperCase();
    var fallbackSpan = '<span class="listen-card__initial">' + esc(initial) + '</span>';
    // Resilient src chain: local repo image first (reliable), then the JSON
    // thumbnail as data-alt-src (tried once on error), then the letter tile.
    // wireThumbFallbacks() handles the error hops after render.
    var primary = item.localThumb || item.thumbnail;
    if (primary) {
      var altAttr = (item.localThumb && item.thumbnail && item.thumbnail !== item.localThumb)
        ? ' data-alt-src="' + esc(item.thumbnail) + '"' : '';
      thumbContent = '<img class="listen-card__img" src="' + esc(primary) + '"' + altAttr + ' alt="' + esc(item.title) + '" loading="lazy">' + fallbackSpan;
    } else {
      thumbClass = ' listen-card__thumb--initial';
      thumbContent = fallbackSpan;
    }

    var kindPill = item.kind === 'spotify'
      ? '<span class="listen-card__pill listen-card__pill--spotify">Spotify</span>'
      : '<span class="listen-card__pill listen-card__pill--youtube">YouTube</span>';

    var tagLabel = '';
    if (item.tag === 'teaching') tagLabel = '📖 Teaching';
    else if (item.tag === 'worship') tagLabel = '🎵 Worship';
    else if (item.tag === 'entertainment') tagLabel = '🎬 Entertainment';

    return (
      '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" class="listen-card">' +
        '<div class="listen-card__thumb' + thumbClass + '"' + thumbAttr + '>' +
          thumbContent +
        '</div>' +
        '<div class="listen-card__info">' +
          '<h5 class="listen-card__name">' + esc(item.title) + '</h5>' +
          '<p class="listen-card__source">' + esc(item.source) + '</p>' +
          '<div class="listen-card__meta">' +
            kindPill +
            (tagLabel ? '<span class="listen-card__tag">' + tagLabel + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</a>'
    );
  }

  function renderEmpty() {
    return (
      '<div class="store-empty">' +
        '<div class="store-empty__icon">🔍</div>' +
        '<h3 class="store-empty__title">Nothing found</h3>' +
        '<p class="store-empty__hint">Try a different search term or browse another topic</p>' +
        '<button class="store-empty__btn" onclick="window.STW_CommunityCatalog.clearSearch()">Clear search</button>' +
      '</div>'
    );
  }

  // ── Render cards (non-listening categories) ─────────────────
  function renderPartnerCard(item) {
    var imageHTML = item.photo
      ? '<div class="store-card__image"><img src="' + esc(item.photo) + '" alt="' + esc(item.title) + '" loading="lazy"><span class="store-card__image-fallback">🤝</span></div>'
      : '<div class="store-card__image is-fallback"><span class="store-card__image-fallback">🤝</span></div>';

    var actionHTML = item.url
      ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" class="store-card__action store-card__action--primary">Visit →</a>'
      : '';

    return (
      '<article class="store-card">' +
        imageHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(item.title) + '</h3>' +
          '<p class="store-card__desc">' + esc(truncate(item.story, 140)) + '</p>' +
          '<div class="store-card__meta">' +
            '<span class="store-card__price">👤 ' + esc(item.pointOfContact) + '</span>' +
          '</div>' +
          actionHTML +
        '</div>' +
      '</article>'
    );
  }

  function renderMessageCard(item) {
    var embedHTML;
    if (item.embedType === 'iframe') {
      embedHTML =
        '<div class="store-card__image store-card__image--video' + (item.landscape ? ' store-card__image--landscape' : '') + '">' +
          '<iframe src="' + esc(item.embedSrc) + '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" title="' + esc(item.title) + '" style="width:100%;height:100%;border:none;border-radius:8px 8px 0 0;"></iframe>' +
        '</div>';
    } else {
      embedHTML =
        '<div class="store-card__image store-card__image--video">' +
          '<video src="' + esc(item.embedSrc) + '" controls preload="metadata" playsinline style="width:100%;height:100%;border-radius:8px 8px 0 0;object-fit:cover;" aria-label="' + esc(item.title) + '">' +
            'Your browser doesn\'t support embedded video.' +
          '</video>' +
        '</div>';
    }

    return (
      '<article class="store-card">' +
        embedHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(item.title) + '</h3>' +
          '<p class="store-card__desc">' + esc(item.description) + '</p>' +
          '<div class="store-card__meta">' +
            '<span class="store-card__price">🎬 ' + esc(item.from) + '</span>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderResourceCard(item) {
    var iconHTML = '<div class="store-card__image">' + (item.icon || '📖') + '</div>';
    var actionHTML = item.url
      ? '<a href="' + esc(item.url) + '" class="store-card__action store-card__action--primary">Read →</a>'
      : '';

    return (
      '<article class="store-card">' +
        iconHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(item.title) + '</h3>' +
          '<p class="store-card__desc">' + esc(item.description) + '</p>' +
          actionHTML +
        '</div>' +
      '</article>'
    );
  }

  function renderCard(item) {
    switch (item.category) {
      case 'partners': return renderPartnerCard(item);
      case 'messages': return renderMessageCard(item);
      case 'resources': return renderResourceCard(item);
      default: return '';
    }
  }

  // ── Render grid ─────────────────────────────────────────────
  function renderGrid() {
    // Update category header
    var cat = categories.find(function (c) { return c.key === activeCategory; });
    if (categoryHeaderEl && cat) {
      categoryHeaderEl.innerHTML =
        '<h2 class="store-category-header__title">' + esc(cat.icon) + ' ' + esc(cat.label) + '</h2>' +
        '<p class="store-category-header__desc">' + esc(cat.description) + '</p>';
    }

    // Listening gets the Netflix-style shelf layout
    if (activeCategory === 'listening') {
      gridEl.className = 'listen-layout';
      gridEl.innerHTML = renderListeningShelf();
      wireThumbFallbacks(gridEl);
      return;
    }

    // Other categories keep the flat grid
    gridEl.className = 'store-grid';
    var filtered = filterItems(items, activeCategory, searchResultIds);

    if (!filtered.length) {
      gridEl.innerHTML = renderEmpty();
      return;
    }

    gridEl.innerHTML = filtered.map(renderCard).join('');
    wireThumbFallbacks(gridEl);
  }

  // Attach load/error handlers programmatically (no fragile inline onerror).
  // Each thumbnail renders <img> + a fallback tile; we hide whichever is wrong.
  function wireThumbFallbacks(root) {
    root.querySelectorAll('.listen-card__img, .store-card__image img').forEach(function (img) {
      function reveal() { img.style.display = 'none'; var t = img.parentNode; if (t) t.classList.add('is-fallback'); }
      function onErr() {
        // One retry with the alternate source (e.g. the JSON CDN thumbnail),
        // then give up and reveal the branded letter/emoji tile.
        var alt = img.getAttribute('data-alt-src');
        if (alt) { img.removeAttribute('data-alt-src'); img.src = alt; return; }
        reveal();
      }
      if (img.complete && img.naturalWidth === 0) { onErr(); return; } // already errored
      img.addEventListener('error', onErr);
    });
  }

  // ── Render sidebar (now horizontal topic pills) ──────────────
  function renderSidebar() {
    var html = '';
    categories.forEach(function (cat) {
      var activeClass = cat.key === activeCategory ? ' is-active' : '';
      html +=
        '<button class="friends-topic-pill' + activeClass + '" data-category="' + esc(cat.key) + '">' +
          '<span class="friends-topic-pill__icon">' + cat.icon + '</span>' +
          '<span class="friends-topic-pill__label">' + esc(cat.label) + '</span>' +
        '</button>';
    });
    sidebarEl.innerHTML = html;

    sidebarEl.querySelectorAll('.friends-topic-pill').forEach(function (item) {
      item.addEventListener('click', function () {
        setCategory(item.dataset.category);
      });
    });
  }

  // ── Category switching ──────────────────────────────────────
  function setCategory(key) {
    var validKeys = categories.map(function (c) { return c.key; });
    if (validKeys.indexOf(key) === -1) return;
    activeCategory = key;
    renderSidebar();
    renderGrid();
    var section = document.querySelector('.friends-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── Search handling ─────────────────────────────────────────
  function handleSearch() {
    var query = searchInput.value;
    searchResultIds = searchItems(query, searchIndex);

    if (query.trim()) {
      clearBtn.classList.add('is-visible');
    } else {
      clearBtn.classList.remove('is-visible');
    }

    if (searchResultIds !== null) {
      var catCounts = {};
      categories.forEach(function (c) { catCounts[c.key] = 0; });
      searchResultIds.forEach(function (id) {
        var item = items.find(function (it) { return it.id === id; });
        if (item) catCounts[item.category]++;
      });

      var bestCat = activeCategory;
      var bestCount = catCounts[activeCategory] || 0;
      categories.forEach(function (c) {
        if (catCounts[c.key] > bestCount) {
          bestCat = c.key;
          bestCount = catCounts[c.key];
        }
      });
      activeCategory = bestCat;

      var totalMatches = searchResultIds.length;
      countBadge.textContent = totalMatches + ' result' + (totalMatches !== 1 ? 's' : '');
      countBadge.classList.add('is-visible');
    } else {
      countBadge.classList.remove('is-visible');
    }

    renderSidebar();
    renderGrid();
  }

  function clearSearch() {
    searchInput.value = '';
    searchResultIds = null;
    clearBtn.classList.remove('is-visible');
    countBadge.classList.remove('is-visible');
    renderSidebar();
    renderGrid();
  }

  // ── Mobile sidebar toggle (legacy — now pills, no overlay needed) ──
  function openSidebar() {}
  function closeSidebar() {}

  // ── Init ────────────────────────────────────────────────────
  async function init() {
    gridEl = document.getElementById('community-grid');
    sidebarEl = document.getElementById('community-sidebar');
    overlayEl = document.getElementById('community-sidebar-overlay');
    searchInput = document.getElementById('community-search-input');
    clearBtn = document.getElementById('community-search-clear');
    countBadge = document.getElementById('community-search-count');
    categoryHeaderEl = document.getElementById('community-category-header');

    if (!gridEl || !sidebarEl) return;

    try {
      var res = await fetch('assets/data/recommendations.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load recommendations');
      var data = await res.json();
      items = buildItems(data);
    } catch (err) {
      console.warn('[CommunityCatalog] Fetch error:', err);
      items = buildItems({ listening: [], partners: [] });
    }

    searchIndex = buildSearchIndex(items);
    renderSidebar();
    renderGrid();

    var debouncedSearch = debounce(handleSearch, 250);
    searchInput.addEventListener('input', debouncedSearch);
    clearBtn.addEventListener('click', clearSearch);

    var toggleBtn = document.getElementById('community-sidebar-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', openSidebar);
    }
    if (overlayEl) {
      overlayEl.addEventListener('click', closeSidebar);
    }
  }

  // ── Public API ──────────────────────────────────────────────
  window.STW_CommunityCatalog = {
    init: init,
    setCategory: setCategory,
    clearSearch: clearSearch
  };

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
