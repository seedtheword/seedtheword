/* ============================================================
   eLibrary Catalog — Data-driven catalog for reading plans,
   guides, and books using store-catalog card design
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

  // ── State ───────────────────────────────────────────────────
  var categories = [];
  var products = [];
  var searchIndex = [];
  var activeCategory = 'all';
  var searchResultIds = null;

  // DOM refs
  var gridEl, sidebarEl, searchInput, clearBtn, countBadge, categoryHeaderEl;

  // ── Build search index ──────────────────────────────────────
  function buildSearchIndex(items) {
    return items.map(function (p) {
      var parts = [p.name, p.description, p.author, p.format, (p.tags || []).join(' '), p.category];
      return { id: p.id, name: (p.name || '').toLowerCase(), text: parts.join(' ').toLowerCase() };
    });
  }

  // ── Search ──────────────────────────────────────────────────
  function searchProducts(query, index) {
    var normalized = query.trim().toLowerCase();
    if (!normalized) return null;

    var terms = normalized.split(/\s+/);
    var scored = [];

    for (var i = 0; i < index.length; i++) {
      var entry = index[i];
      var score = 0;

      for (var t = 0; t < terms.length; t++) {
        if (entry.text.indexOf(terms[t]) !== -1) {
          score += 1;
          if (entry.name.indexOf(terms[t]) !== -1) score += 2;
        } else {
          score = 0;
          break;
        }
      }

      if (score > 0) scored.push({ id: entry.id, score: score });
    }

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (s) { return s.id; });
  }

  // ── Filter ──────────────────────────────────────────────────
  function filterProducts(allProducts, categoryKey, resultIds) {
    var filtered = allProducts.filter(function (p) {
      if (categoryKey !== 'all' && p.category !== categoryKey) return false;
      if (resultIds !== null && resultIds.indexOf(p.id) === -1) return false;
      return true;
    });

    if (resultIds !== null) {
      filtered.sort(function (a, b) {
        return resultIds.indexOf(a.id) - resultIds.indexOf(b.id);
      });
    }

    return filtered;
  }

  // ── Render card ─────────────────────────────────────────────
  function renderCard(p) {
    var imageHTML;
    if (p.image) {
      imageHTML = '<div class="store-card__image"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy"></div>';
    } else {
      imageHTML = '<div class="store-card__image elibrary-card__icon-image"><span class="elibrary-card__big-icon">' + (p.icon || '📄') + '</span></div>';
    }

    var formatBadge = p.format ? '<span class="elibrary-card__format">' + esc(p.format) + '</span>' : '';
    var authorHTML = p.author ? '<span class="elibrary-card__author">' + esc(p.author) + '</span>' : '';

    var actionHTML = '';
    if (p.url && p.downloadUrl) {
      actionHTML =
        '<div class="elibrary-card__actions">' +
          '<a href="' + esc(p.url) + '" class="store-card__action store-card__action--primary elibrary-card__action">Read Online</a>' +
          '<a href="' + esc(p.downloadUrl) + '" target="_blank" class="store-card__action store-card__action--secondary elibrary-card__action">🖨 Print / PDF</a>' +
        '</div>';
    } else if (p.url) {
      actionHTML = '<a href="' + esc(p.url) + '" class="store-card__action store-card__action--primary">Read Online →</a>';
    } else if (p.downloadUrl) {
      actionHTML = '<a href="' + esc(p.downloadUrl) + '" target="_blank" class="store-card__action store-card__action--primary">Download PDF →</a>';
    } else {
      actionHTML = '<span class="store-card__action store-card__action--disabled">Coming Soon</span>';
    }

    return (
      '<article class="store-card elibrary-card">' +
        imageHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(p.name) + '</h3>' +
          '<p class="store-card__desc">' + esc(p.description) + '</p>' +
          '<div class="store-card__meta">' +
            '<span class="store-card__price">' + esc(p.price || 'Free') + '</span>' +
            formatBadge +
            authorHTML +
          '</div>' +
          actionHTML +
        '</div>' +
      '</article>'
    );
  }

  // ── Render grid ─────────────────────────────────────────────
  function renderGrid() {
    var filtered = filterProducts(products, activeCategory, searchResultIds);

    // Update category header
    if (categoryHeaderEl) {
      if (activeCategory === 'all') {
        categoryHeaderEl.innerHTML =
          '<h2 class="store-category-header__title">📚 All Resources</h2>' +
          '<p class="store-category-header__desc">Browse our full collection of free resources for your walk</p>';
      } else {
        var cat = categories.find(function (c) { return c.key === activeCategory; });
        if (cat) {
          categoryHeaderEl.innerHTML =
            '<h2 class="store-category-header__title">' + esc(cat.icon) + ' ' + esc(cat.label) + '</h2>' +
            '<p class="store-category-header__desc">' + esc(cat.description) + '</p>';
        }
      }
    }

    if (!filtered.length) {
      gridEl.innerHTML =
        '<div class="store-empty">' +
          '<div class="store-empty__icon">🔍</div>' +
          '<h3 class="store-empty__title">No resources match your search</h3>' +
          '<p class="store-empty__hint">Try &ldquo;reading plan&rdquo;, &ldquo;evangelism&rdquo;, or &ldquo;guide&rdquo;</p>' +
          '<button class="store-empty__btn" onclick="window.STW_eLibrary.clearSearch()">Clear search</button>' +
        '</div>';
      return;
    }

    gridEl.innerHTML = filtered.map(renderCard).join('');
  }

  // ── Render sidebar ──────────────────────────────────────────
  function renderSidebar() {
    var allCount = products.length;
    var html = '<h4 class="store-sidebar__title">Categories</h4><ul class="store-sidebar__list">';
    html += '<li class="store-sidebar__item' + (activeCategory === 'all' ? ' is-active' : '') + '" data-cat="all">All Resources <span class="store-sidebar__count">' + allCount + '</span></li>';

    categories.forEach(function (cat) {
      var count = products.filter(function (p) { return p.category === cat.key; }).length;
      var activeClass = activeCategory === cat.key ? ' is-active' : '';
      html += '<li class="store-sidebar__item' + activeClass + '" data-cat="' + esc(cat.key) + '">' + esc(cat.icon) + ' ' + esc(cat.label) + ' <span class="store-sidebar__count">' + count + '</span></li>';
    });

    html += '</ul>';
    sidebarEl.innerHTML = html;

    // Bind clicks
    sidebarEl.querySelectorAll('.store-sidebar__item').forEach(function (item) {
      item.addEventListener('click', function () {
        activeCategory = item.dataset.cat;
        renderSidebar();
        renderGrid();
      });
    });
  }

  // ── Search handlers ─────────────────────────────────────────
  function onSearch() {
    var val = searchInput.value.trim();
    searchResultIds = val ? searchProducts(val, searchIndex) : null;

    if (clearBtn) {
      clearBtn.classList.toggle('is-visible', val.length > 0);
    }
    if (countBadge && searchResultIds !== null) {
      countBadge.textContent = searchResultIds.length + ' found';
      countBadge.classList.add('is-visible');
    } else if (countBadge) {
      countBadge.classList.remove('is-visible');
    }

    renderGrid();
  }

  function clearSearch() {
    searchInput.value = '';
    searchResultIds = null;
    if (clearBtn) clearBtn.classList.remove('is-visible');
    if (countBadge) countBadge.classList.remove('is-visible');
    renderGrid();
  }

  // ── Mobile sidebar toggle ───────────────────────────────────
  function initMobileToggle() {
    var toggle = document.getElementById('elibrary-mobile-toggle');
    var overlay = document.getElementById('elibrary-sidebar-overlay');
    if (!toggle) return;

    function openSidebar() {
      sidebarEl.classList.add('is-open');
      if (overlay) overlay.classList.add('is-visible');
      document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
      sidebarEl.classList.remove('is-open');
      if (overlay) overlay.classList.remove('is-visible');
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', function () {
      if (sidebarEl.classList.contains('is-open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    if (overlay) {
      overlay.addEventListener('click', closeSidebar);
    }

    // Close sidebar when category selected on mobile
    sidebarEl.addEventListener('click', function (e) {
      if (e.target.closest('.store-sidebar__item') && window.innerWidth <= 767) {
        closeSidebar();
      }
    });
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    gridEl = document.getElementById('elibrary-grid');
    sidebarEl = document.getElementById('elibrary-sidebar');
    searchInput = document.getElementById('elibrary-search-input');
    clearBtn = document.getElementById('elibrary-search-clear');
    countBadge = document.getElementById('elibrary-search-count');
    categoryHeaderEl = document.getElementById('elibrary-category-header');

    if (!gridEl) return; // Section not on page

    fetch('assets/data/elibrary-products.json?t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        categories = data.categories || [];
        products = data.products || [];
        searchIndex = buildSearchIndex(products);

        renderSidebar();
        renderGrid();

        // Bind search
        if (searchInput) {
          searchInput.addEventListener('input', debounce(onSearch, 200));
        }
        if (clearBtn) {
          clearBtn.addEventListener('click', clearSearch);
        }

        initMobileToggle();
      })
      .catch(function (err) {
        console.warn('[eLibrary] Failed to load catalog:', err);
        gridEl.innerHTML = '<p style="text-align:center;color:var(--color-text-muted);">Unable to load library. Please refresh.</p>';
      });
  }

  // Public API
  window.STW_eLibrary = { clearSearch: clearSearch };

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
