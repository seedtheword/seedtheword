/* ============================================================
   Store Catalog — Category navigation, search, product grid
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
  var products = [];
  var categories = [];
  var searchIndex = [];
  var activeCategory = 'bibles';
  var searchResultIds = null; // null = no search active

  // DOM refs
  var gridEl, sidebarEl, overlayEl, searchInput, clearBtn, countBadge, categoryHeaderEl;

  // ── Search index builder ────────────────────────────────────
  function buildSearchIndex(prods) {
    return prods.map(function (p) {
      var parts = [
        p.name,
        p.description || '',
        p.category,
        (p.tags || []).join(' '),
        p.seller || '',
        p.language || ''
      ];
      return {
        id: p.id,
        name: p.name.toLowerCase(),
        text: parts.join(' ').toLowerCase(),
        category: p.category
      };
    });
  }

  // ── Search algorithm ────────────────────────────────────────
  function searchProducts(query, index) {
    var normalized = query.trim().toLowerCase();
    if (!normalized) return null; // null = show all

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

  // ── Filter products ─────────────────────────────────────────
  function filterProducts(allProducts, categoryKey, resultIds) {
    var filtered = allProducts.filter(function (p) {
      if (p.category !== categoryKey) return false;
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

  // ── Render product card ─────────────────────────────────────
  function getCategoryPlaceholder(category) {
    var map = { bibles: '📖', amazon: '📦', tracts: '📜', merch: '🎁' };
    return map[category] || '📋';
  }

  function renderProductCard(p) {
    var imageHTML;
    if (p.image) {
      imageHTML = '<div class="store-card__image"><img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy"></div>';
    } else {
      imageHTML = '<div class="store-card__image">' + getCategoryPlaceholder(p.category) + '</div>';
    }

    var sellerHTML = p.seller ? '<span class="store-card__seller">' + esc(p.seller) + '</span>' : '';

    var stockHTML = '';
    if (p.category === 'bibles' && p.stockCount !== null && p.stockCount !== undefined) {
      if (p.stockCount === 0) {
        stockHTML = '<span class="store-card__stock store-card__stock--out">Out of Stock</span>';
      } else {
        var stockClass = p.stockCount <= 5 ? 'store-card__stock store-card__stock--low' : 'store-card__stock';
        stockHTML = '<span class="' + stockClass + '">' + p.stockCount + ' in stock</span>';
      }
    }

    var actionHTML;
    if (p.category === 'amazon' && p.url) {
      actionHTML = '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" class="store-card__action store-card__action--amazon">View on Amazon →</a>';
    } else if (p.category === 'bibles') {
      if (p.stockCount === 0) {
        actionHTML = '<span class="store-card__action store-card__action--disabled">Out of Stock</span>';
      } else {
        actionHTML = '<a href="bundle-builder.html?bundle=essentials" class="store-card__action store-card__action--primary">Add to Bundle</a>';
      }
    } else {
      actionHTML = '<span class="store-card__action store-card__action--secondary">Learn More</span>';
    }

    return (
      '<article class="store-card">' +
        imageHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(p.name) + '</h3>' +
          '<p class="store-card__desc">' + esc(p.description) + '</p>' +
          '<div class="store-card__meta">' +
            '<span class="store-card__price">' + esc(p.price || 'Free') + '</span>' +
            sellerHTML +
            stockHTML +
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
          '<h3 class="store-empty__title">No products match your search</h3>' +
          '<p class="store-empty__hint">Try searching for &ldquo;bible&rdquo;, &ldquo;spanish&rdquo;, or &ldquo;tract&rdquo;</p>' +
          '<button class="store-empty__btn" onclick="window.STW_StoreCatalog.clearSearch()">Clear search</button>' +
        '</div>';
      return;
    }

    var bundleHtml = '';
    if (activeCategory === 'bibles') {
      bundleHtml = '<div class="store-bundle-section" style="grid-column:1/-1; margin-bottom:1.5rem;">' +
        '<h3 style="font-size:1.3rem; font-weight:800; color:var(--dark); margin:0 0 0.5rem; text-align:center;">Choose Your Bundle</h3>' +
        '<p style="color:var(--muted); font-size:0.9rem; margin:0 0 1.5rem; text-align:center;">Curated packages for every stage of faith — customize in our builder.</p>' +
        '<div class="bundle-cards">' +
          '<a href="bundle-builder.html?bundle=essentials" class="bundle-card-v2 bundle-card-v2--essentials">' +
            '<span class="bundle-card-v2__eyebrow">Essentials</span>' +
            '<div class="bundle-slideshow" data-bundle="essentials"></div>' +
            '<div class="bundle-card-v2__overlay">' +
              '<h3 class="bundle-card-v2__title">Essentials Welcome</h3>' +
              '<p class="bundle-card-v2__pitch">A pocket New Testament, a welcome tract, and everything a newcomer needs to start their walk.</p>' +
              '<span class="bundle-card-v2__see-more">Build yours <span class="bundle-card-v2__see-more-arrow">\u2192</span></span>' +
            '</div>' +
          '</a>' +
          '<a href="bundle-builder.html?bundle=lifegroup" class="bundle-card-v2 bundle-card-v2--lifegroup bundle-card-v2--featured">' +
            '<span class="bundle-card-v2__flag">Most Given</span>' +
            '<span class="bundle-card-v2__eyebrow">Life Group</span>' +
            '<div class="bundle-slideshow" data-bundle="lifegroup"></div>' +
            '<div class="bundle-card-v2__overlay">' +
              '<h3 class="bundle-card-v2__title">Life Group Starter</h3>' +
              '<p class="bundle-card-v2__pitch">2\u20135 Bibles with personalized name labels \u2014 perfect for a small group, family, or Bible study.</p>' +
              '<span class="bundle-card-v2__see-more">Build yours <span class="bundle-card-v2__see-more-arrow">\u2192</span></span>' +
            '</div>' +
          '</a>' +
          '<a href="bundle-builder.html?bundle=ministry" class="bundle-card-v2 bundle-card-v2--ministry">' +
            '<span class="bundle-card-v2__eyebrow">Ministry</span>' +
            '<div class="bundle-slideshow" data-bundle="ministry"></div>' +
            '<div class="bundle-card-v2__overlay">' +
              '<span class="bundle-card-v2__verse-line">\u201cGo ye therefore, and teach all nations\u2026\u201d</span>' +
              '<h3 class="bundle-card-v2__title">Ministry Calling</h3>' +
              '<p class="bundle-card-v2__pitch">Bulk Bibles at our $2 ministry rate \u2014 plan your outreach, name your event, and share the Word.</p>' +
              '<span class="bundle-card-v2__see-more">Build yours <span class="bundle-card-v2__see-more-arrow">\u2192</span></span>' +
            '</div>' +
          '</a>' +
        '</div>' +
      '</div>';
      // Re-init bundle slideshows after render
      setTimeout(function() {
        if (window.initBundleSlideshows) window.initBundleSlideshows();
      }, 100);
    }
    gridEl.innerHTML = bundleHtml + filtered.map(renderProductCard).join('');
  }

  // ── Render sidebar ──────────────────────────────────────────
  function renderSidebar() {
    var html = '<p class="store-sidebar__title">BROWSE</p><ul class="store-sidebar__list">';
    categories.forEach(function (cat) {
      var activeClass = cat.key === activeCategory ? ' is-active' : '';
      html +=
        '<li class="store-sidebar__item' + activeClass + '" data-category="' + esc(cat.key) + '">' +
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
    if (['bibles', 'amazon', 'tracts', 'merch'].indexOf(key) === -1) return;
    activeCategory = key;
    window.location.hash = key;
    renderSidebar();
    renderGrid();
    // Scroll to top of catalog
    var catalogArea = document.querySelector('.store-layout');
    if (catalogArea) {
      catalogArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── Search handling ─────────────────────────────────────────
  function handleSearch() {
    var query = searchInput.value;
    searchResultIds = searchProducts(query, searchIndex);

    // Show/hide clear button
    if (query.trim()) {
      clearBtn.classList.add('is-visible');
    } else {
      clearBtn.classList.remove('is-visible');
    }

    // Update count badge
    if (searchResultIds !== null) {
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
    // Find DOM elements
    gridEl = document.getElementById('store-grid');
    sidebarEl = document.getElementById('store-sidebar');
    overlayEl = document.getElementById('store-sidebar-overlay');
    searchInput = document.getElementById('store-search-input');
    clearBtn = document.getElementById('store-search-clear');
    countBadge = document.getElementById('store-search-count');
    categoryHeaderEl = document.getElementById('store-category-header');

    if (!gridEl || !sidebarEl) return;

    // Fetch product data
    try {
      var res = await fetch('assets/data/store-products.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load products');
      var data = await res.json();
      categories = data.categories || [];
      products = (data.products || []).filter(function (p) {
        if (!p.id || !p.name || !p.category) {
          console.warn('[StoreCatalog] Skipping malformed product:', p);
          return false;
        }
        return true;
      });
    } catch (err) {
      console.warn('[StoreCatalog] Fetch error:', err);
      gridEl.innerHTML =
        '<div class="store-error">' +
          '<p>Products unavailable right now.</p>' +
          '<button class="store-error__btn" onclick="window.STW_StoreCatalog.refresh()">Try again</button>' +
        '</div>';
      return;
    }

    // Build search index
    searchIndex = buildSearchIndex(products);

    // Check URL hash for deep link
    var hash = window.location.hash.replace('#', '');
    if (['bibles', 'amazon', 'tracts', 'merch'].indexOf(hash) !== -1) {
      activeCategory = hash;
    }

    // Check URL param for search
    var params = new URLSearchParams(window.location.search);
    if (params.get('q')) {
      searchInput.value = params.get('q');
      searchResultIds = searchProducts(params.get('q'), searchIndex);
      clearBtn.classList.add('is-visible');
    }

    // Render
    renderSidebar();
    renderGrid();

    // Wire search
    var debouncedSearch = debounce(handleSearch, 250);
    searchInput.addEventListener('input', debouncedSearch);
    clearBtn.addEventListener('click', clearSearch);

    // Wire category tiles
    document.querySelectorAll('.store-category-tile[data-cat]').forEach(function(tile) {
      tile.addEventListener('click', function(e) {
        e.preventDefault();
        var cat = tile.getAttribute('data-cat');
        setCategory(cat);
      });
    });

    // Wire mobile sidebar toggle
    var toggleBtn = document.getElementById('store-sidebar-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', openSidebar);
    }
    if (overlayEl) {
      overlayEl.addEventListener('click', closeSidebar);
    }

    // Listen for hash changes
    window.addEventListener('hashchange', function () {
      var h = window.location.hash.replace('#', '');
      if (['bibles', 'amazon', 'tracts', 'merch'].indexOf(h) !== -1 && h !== activeCategory) {
        activeCategory = h;
        renderSidebar();
        renderGrid();
      }
    });

    // Fetch live stock data
    updateLiveStock();
  }

  // ── Live stock update for Bible products ────────────────────
  async function updateLiveStock() {
    try {
      var cfgRes = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' });
      if (!cfgRes.ok) return;
      var cfg = await cfgRes.json();
      var inStock = cfg.biblesInStock || [];
      
      // Try live API
      if (cfg.orderHandlerUrl) {
        try {
          var liveRes = await fetch(cfg.orderHandlerUrl + '?action=getMinistryStats', { cache: 'no-store' });
          if (liveRes.ok) {
            var live = await liveRes.json();
            if (live.ok && live.inStock) inStock = live.inStock;
          }
        } catch(_) {}
      }
      
      // Update products array with live stock counts
      if (inStock.length) {
        products.forEach(function(p) {
          if (p.category !== 'bibles' || !p.language) return;
          var match = inStock.find(function(s) {
            return s.language && s.language.toLowerCase() === p.language.toLowerCase();
          });
          if (match) {
            p.stockCount = match.count;
            p.inStock = match.count > 0;
          }
        });
        // Re-render if currently viewing Bibles
        if (activeCategory === 'bibles') renderGrid();
      }
    } catch(_) {}
  }

  // ── Public API ──────────────────────────────────────────────
  window.STW_StoreCatalog = {
    init: init,
    setCategory: setCategory,
    search: function (query) {
      if (searchInput) searchInput.value = query;
      handleSearch();
    },
    clearSearch: clearSearch,
    getProducts: function (categoryKey) {
      return filterProducts(products, categoryKey, null);
    },
    refresh: function () {
      init();
    }
  };

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
