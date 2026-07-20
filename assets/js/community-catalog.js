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
    { key: 'messages', label: 'Messages', icon: '🎬', description: 'Video teachings from friends' },
    { key: 'resources', label: 'Resources', icon: '📖', description: 'Reading plans and guides' }
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
  var searchIndex = [];
  var activeCategory = 'listening';
  var searchResultIds = null;

  // DOM refs
  var gridEl, sidebarEl, overlayEl, searchInput, clearBtn, countBadge, categoryHeaderEl;

  // ── Build items from fetched data ───────────────────────────
  function buildItems(data) {
    var all = [];

    // Listening items
    (data.listening || []).forEach(function (item, i) {
      var url = '';
      if (item.kind === 'spotify') {
        if (item.type === 'episode') url = 'https://open.spotify.com/episode/' + item.id;
        else if (item.type === 'show') url = 'https://open.spotify.com/show/' + item.id;
      } else if (item.kind === 'youtube') {
        if (item.handle) url = 'https://youtube.com/' + item.handle;
        else if (item.id) url = 'https://youtube.com/channel/' + item.id;
      }

      all.push({
        id: 'listen-' + i,
        category: 'listening',
        title: item.title || 'Untitled',
        source: item.source || '',
        kind: item.kind || 'link',
        type: item.type || item.feedType || '',
        url: url,
        note: item.note || '',
        thumbnail: item.thumbnail || '',
        spotifyId: item.id || '',
        youtubeId: item.id || ''
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

  // ── Render cards ────────────────────────────────────────────
  function renderListeningCard(item) {
    var kindLabel = item.kind === 'spotify' ? '🟢 Spotify' : item.kind === 'youtube' ? '🔴 YouTube' : '🔗 Link';
    var typeLabel = item.type ? ' · ' + esc(item.type) : '';

    var actionHTML = item.url
      ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" class="store-card__action store-card__action--primary">Open ' + esc(item.kind) + ' →</a>'
      : '<span class="store-card__action store-card__action--secondary">Coming soon</span>';

    // Build image HTML — show thumbnail if available, otherwise show a
    // placeholder that will be replaced by oEmbed fetch
    var imageHTML;
    if (item.thumbnail) {
      imageHTML = '<div class="store-card__image store-card__image--thumb"><img src="' + esc(item.thumbnail) + '" alt="' + esc(item.title) + '" loading="lazy"></div>';
    } else {
      // Placeholder with data attributes for lazy thumbnail fetching
      var dataAttr = '';
      if (item.kind === 'spotify' && item.spotifyId) {
        dataAttr = ' data-spotify-id="' + esc(item.spotifyId) + '" data-spotify-type="' + esc(item.type) + '"';
      } else if (item.kind === 'youtube' && item.youtubeId) {
        dataAttr = ' data-youtube-id="' + esc(item.youtubeId) + '"';
      }
      var fallbackIcon = item.kind === 'spotify' ? '🎧' : '📺';
      imageHTML = '<div class="store-card__image store-card__image--thumb store-card__image--loading"' + dataAttr + '>' + fallbackIcon + '</div>';
    }

    return (
      '<article class="store-card">' +
        imageHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(item.title) + '</h3>' +
          '<p class="store-card__desc">' + esc(item.source) + (item.note ? ' — ' + esc(item.note) : '') + '</p>' +
          '<div class="store-card__meta">' +
            '<span class="store-card__price">' + kindLabel + typeLabel + '</span>' +
          '</div>' +
          actionHTML +
        '</div>' +
      '</article>'
    );
  }

  function renderPartnerCard(item) {
    var imageHTML = item.photo
      ? '<div class="store-card__image"><img src="' + esc(item.photo) + '" alt="' + esc(item.title) + '" loading="lazy"></div>'
      : '<div class="store-card__image">🤝</div>';

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
      case 'listening': return renderListeningCard(item);
      case 'partners': return renderPartnerCard(item);
      case 'messages': return renderMessageCard(item);
      case 'resources': return renderResourceCard(item);
      default: return '';
    }
  }

  // ── Render grid ─────────────────────────────────────────────
  function renderGrid() {
    var filtered = filterItems(items, activeCategory, searchResultIds);

    // Update category header
    var cat = categories.find(function (c) { return c.key === activeCategory; });
    if (categoryHeaderEl && cat) {
      categoryHeaderEl.innerHTML =
        '<h2 class="store-category-header__title">' + esc(cat.icon) + ' ' + esc(cat.label) + '</h2>' +
        '<p class="store-category-header__desc">' + esc(cat.description) + '</p>';
    }

    if (!filtered.length) {
      gridEl.innerHTML =
        '<div class="store-empty">' +
          '<div class="store-empty__icon">🔍</div>' +
          '<h3 class="store-empty__title">Nothing found</h3>' +
          '<p class="store-empty__hint">Try a different search term or browse another topic</p>' +
          '<button class="store-empty__btn" onclick="window.STW_CommunityCatalog.clearSearch()">Clear search</button>' +
        '</div>';
      return;
    }

    gridEl.innerHTML = filtered.map(renderCard).join('');

    // Fetch thumbnails for listening cards without a static image
    fetchMissingThumbnails();
  }

  // ── Fetch missing thumbnails via oEmbed ─────────────────────
  var thumbnailCache = {};

  function fetchMissingThumbnails() {
    var cards = gridEl.querySelectorAll('.store-card__image--loading');
    cards.forEach(function (el) {
      var spotifyId = el.getAttribute('data-spotify-id');
      var spotifyType = el.getAttribute('data-spotify-type');
      var youtubeId = el.getAttribute('data-youtube-id');

      if (spotifyId) {
        fetchSpotifyThumbnail(el, spotifyId, spotifyType);
      } else if (youtubeId) {
        fetchYouTubeThumbnail(el, youtubeId);
      }
    });
  }

  function fetchSpotifyThumbnail(el, id, type) {
    var cacheKey = 'spotify-' + id;
    if (thumbnailCache[cacheKey]) {
      applyThumbnail(el, thumbnailCache[cacheKey]);
      return;
    }

    var spotifyUrl = 'https://open.spotify.com/' + (type || 'episode') + '/' + id;
    var oembedUrl = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(spotifyUrl);

    fetch(oembedUrl)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.thumbnail_url) {
          thumbnailCache[cacheKey] = data.thumbnail_url;
          applyThumbnail(el, data.thumbnail_url);
        }
      })
      .catch(function () { /* keep emoji fallback */ });
  }

  function fetchYouTubeThumbnail(el, channelId) {
    var cacheKey = 'youtube-' + channelId;
    if (thumbnailCache[cacheKey]) {
      applyThumbnail(el, thumbnailCache[cacheKey]);
      return;
    }

    // YouTube oEmbed for channels doesn't reliably return thumbnails,
    // so we use the channel's default avatar URL pattern or try oembed
    // with a video URL. For channels, we'll try the noembed.com service
    // which wraps YouTube's oEmbed.
    var handle = el.closest('.store-card') && el.closest('.store-card').querySelector('.store-card__title');
    var channelUrl = 'https://www.youtube.com/channel/' + channelId;
    var oembedUrl = 'https://noembed.com/embed?url=' + encodeURIComponent(channelUrl);

    fetch(oembedUrl)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.thumbnail_url) {
          thumbnailCache[cacheKey] = data.thumbnail_url;
          applyThumbnail(el, data.thumbnail_url);
        }
      })
      .catch(function () { /* keep emoji fallback */ });
  }

  function applyThumbnail(el, url) {
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.onload = function () {
      el.textContent = '';
      el.appendChild(img);
      el.classList.remove('store-card__image--loading');
    };
  }

  // ── Render sidebar ──────────────────────────────────────────
  function renderSidebar() {
    var html = '<p class="store-sidebar__title">TOPICS</p><ul class="store-sidebar__list">';
    categories.forEach(function (cat) {
      var activeClass = cat.key === activeCategory ? ' is-active' : '';
      html +=
        '<li class="store-sidebar__item' + activeClass + '" data-category="' + esc(cat.key) + '">' +
          '<span class="store-sidebar__icon">' + cat.icon + '</span>' +
          '<span class="store-sidebar__label">' + esc(cat.label) + '</span>' +
        '</li>';
    });
    html += '</ul>';
    sidebarEl.innerHTML = html;

    // Attach click events
    sidebarEl.querySelectorAll('.store-sidebar__item').forEach(function (item) {
      item.addEventListener('click', function () {
        setCategory(item.dataset.category);
        closeSidebar();
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
    // Scroll to top of catalog
    var catalogArea = document.querySelector('#friends-in-jesus .store-layout');
    if (catalogArea) {
      catalogArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      // If searching, show results across ALL categories — pick the best one
      var catCounts = {};
      categories.forEach(function (c) { catCounts[c.key] = 0; });
      searchResultIds.forEach(function (id) {
        var item = items.find(function (it) { return it.id === id; });
        if (item) catCounts[item.category]++;
      });

      // Switch to category with most results
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

  // ── Mobile sidebar toggle ───────────────────────────────────
  function openSidebar() {
    sidebarEl.classList.add('is-open');
    overlayEl.classList.add('is-visible');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebarEl.classList.remove('is-open');
    overlayEl.classList.remove('is-visible');
    document.body.style.overflow = '';
  }

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

    // Fetch recommendations data
    try {
      var res = await fetch('assets/data/recommendations.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load recommendations');
      var data = await res.json();
      items = buildItems(data);
    } catch (err) {
      console.warn('[CommunityCatalog] Fetch error:', err);
      // Still render hardcoded items
      items = buildItems({ listening: [], partners: [] });
    }

    // Build search index
    searchIndex = buildSearchIndex(items);

    // Render
    renderSidebar();
    renderGrid();

    // Wire search
    var debouncedSearch = debounce(handleSearch, 250);
    searchInput.addEventListener('input', debouncedSearch);
    clearBtn.addEventListener('click', clearSearch);

    // Wire mobile sidebar toggle
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
