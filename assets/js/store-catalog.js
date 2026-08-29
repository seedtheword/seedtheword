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

  // Resolve a product's per-unit (or per-pack) price in integer cents for the
  // cart. Prefers live sheet pricing (retailCents/packRetailCents from
  // getCatalog); falls back to parsing the display price string; returns null
  // if we truly can't determine a price (then Add to Cart is disabled).
  // SINGLE-unit price (default). Packs are an optional bulk choice, never
  // forced — see packUnitCents / the Single|Pack toggle.
  function productUnitCents(p) {
    if (typeof p.retailCents === 'number') return p.retailCents;
    // Fallback: parse a "$2", "$2.99", "$2 each" style string.
    if (p.price) {
      var m = String(p.price).match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
      if (m) {
        var cents = Math.round(parseFloat(m[1]) * 100);
        return window.STW_Cart ? window.STW_Cart.retailCentsFromBase(cents) : cents;
      }
    }
    return null;
  }

  function hasPack(p) { return p.packSize && p.packSize > 1 && typeof p.packRetailCents === 'number'; }

  // Price of ONE pack (all N units), when the shopper chooses the pack option.
  function packUnitCents(p) {
    if (typeof p.packRetailCents === 'number') return p.packRetailCents;
    var single = productUnitCents(p);
    return single == null ? null : single * (p.packSize || 1);
  }

  // Bundle-eligible = physical items we can personalize/customize via the
  // bundle builder (Bibles today; extendable later to art/hoodies/etc.).
  function isBundleEligible(p) {
    return p.category === 'bibles';
  }

  function fmt(cents) {
    return window.STW_Cart ? window.STW_Cart.formatCents(cents) : ('$' + (Math.round(cents) / 100).toFixed(2));
  }

  // Shows the single price by default; if there's a pack, notes the pack deal.
  function priceDisplay(p) {
    var single = productUnitCents(p);
    if (single == null) return p.price ? esc(p.price) : 'Free';
    var out = fmt(single) + ' each';
    if (hasPack(p)) out += ' · pack of ' + p.packSize + ' ' + fmt(packUnitCents(p));
    return esc(out);
  }

  // ── Custom-painted Bible inspiration slideshow (Bibles category only) ──
  // A promotional gallery shown above "Choose Your Bundle" to encourage
  // people to request a custom-painted Bible via the builder.
  var CUSTOM_BIBLE_INSPO = [
    { src: 'assets/images/store/custom-bible-white-floral-cross.jpg', cap: 'White florals & gold cross' },
    { src: 'assets/images/store/custom-bible-lamb-pastoral.jpg', cap: 'Pastoral scene & lamb' },
    { src: 'assets/images/store/custom-bible-angel.jpg', cap: 'Guardian angel' },
    { src: 'assets/images/store/custom-bible-grey-floral.jpg', cap: 'Grey floral New Testament' },
    { src: 'assets/images/store/custom-bible-pink-russian.jpg', cap: 'Pink leaf motif' }
  ];
  function customBibleInspoHtml() {
    var slides = CUSTOM_BIBLE_INSPO.map(function (it, i) {
      return '<figure class="store-inspo__slide' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '">' +
        '<img src="' + esc(it.src) + '" alt="' + esc(it.cap) + '" loading="lazy">' +
        '<figcaption>' + esc(it.cap) + '</figcaption></figure>';
    }).join('');
    var dots = CUSTOM_BIBLE_INSPO.map(function (_, i) {
      return '<button type="button" class="store-inspo__dot' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '" aria-label="View example ' + (i + 1) + '"></button>';
    }).join('');
    return '<div class="store-inspo" style="grid-column:1/-1;">' +
        '<p class="store-inspo__eyebrow">Made by hand</p>' +
        '<h3 class="store-inspo__title">Custom-Painted Bibles</h3>' +
        '<p class="store-inspo__sub">Every cover is a canvas — florals, scenes, lettering, even your own design. Start a bundle and choose <strong>“Cover painting”</strong> to request one.</p>' +
        '<div class="store-inspo__stage" data-inspo-stage>' +
          '<button type="button" class="store-inspo__arrow store-inspo__arrow--prev" data-dir="-1" aria-label="Previous">&lsaquo;</button>' +
          slides +
          '<button type="button" class="store-inspo__arrow store-inspo__arrow--next" data-dir="1" aria-label="Next">&rsaquo;</button>' +
        '</div>' +
        '<div class="store-inspo__dots">' + dots + '</div>' +
        '<a href="bundle-builder.html" class="store-inspo__cta">Design a custom Bible &rarr;</a>' +
      '</div>';
  }
  function initCustomBibleInspo() {
    var stage = document.querySelector('[data-inspo-stage]');
    if (!stage || stage.dataset.inited) return;
    stage.dataset.inited = 'true';
    var slides = stage.querySelectorAll('.store-inspo__slide');
    var dots = document.querySelectorAll('.store-inspo__dot');
    if (slides.length < 2) return;
    var current = 0, timer = null;
    function show(idx) {
      current = (idx + slides.length) % slides.length;
      slides.forEach(function (s, i) { s.classList.toggle('is-active', i === current); });
      dots.forEach(function (d, i) { d.classList.toggle('is-active', i === current); });
    }
    function start() { timer = setInterval(function () { show(current + 1); }, 4500); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    stage.querySelectorAll('.store-inspo__arrow').forEach(function (a) {
      a.addEventListener('click', function () { stop(); show(current + parseInt(a.dataset.dir, 10)); });
    });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { stop(); show(parseInt(d.dataset.idx, 10)); });
    });
    // Click a slide to open it full-size. Open the CURRENTLY-ACTIVE slide's
    // image (not a per-element closure) so it always matches what's shown.
    slides.forEach(function (s) {
      s.addEventListener('click', function () {
        var activeImg = slides[current] && slides[current].querySelector('img');
        if (activeImg) openLightbox(activeImg.src);
      });
    });
    start();
  }

  function renderProductCard(p) {
    var imageHTML;
    var gallery = p.gallery || (p.image ? [p.image] : []);
    if (gallery.length > 1) {
      var slides = gallery.map(function(src, i) {
        return '<img class="' + (i === 0 ? 'is-active' : '') + '" src="' + esc(src) + '" alt="' + esc(p.name) + ' photo ' + (i+1) + '" loading="lazy">';
      }).join('');
      var dots = gallery.map(function(_, i) {
        return '<span class="store-card__dot' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '"></span>';
      }).join('');
      imageHTML = '<div class="store-card__slideshow" data-product-slideshow>' + slides +
        '<button class="store-card__arrow store-card__arrow--prev" data-dir="-1" aria-label="Previous">&lsaquo;</button>' +
        '<button class="store-card__arrow store-card__arrow--next" data-dir="1" aria-label="Next">&rsaquo;</button>' +
        '<div class="store-card__dots">' + dots + '</div></div>';
    } else if (gallery.length === 1) {
      imageHTML = '<div class="store-card__image"><img src="' + esc(gallery[0]) + '" alt="' + esc(p.name) + '" loading="lazy"></div>';
    } else {
      imageHTML = '<div class="store-card__image">' + getCategoryPlaceholder(p.category) + '</div>';
    }

    // Item number badge (top-right on image)
    var itemNumHTML = '<span class="store-card__item-num">#' + esc(p.id) + '</span>';

    var nativeHTML = p.nativeName ? '<span class="store-card__native">' + esc(p.nativeName) + '</span>' : '';

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

    var unitCents = productUnitCents(p);
    var outOfStock = (p.category === 'bibles' && p.stockCount === 0);

    var actionHTML;
    if (p.category === 'amazon' && p.url) {
      // Third-party items link out; not part of our cart.
      actionHTML = '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" class="store-card__action store-card__action--amazon" data-stop-detail>View on Amazon &rarr;</a>';
    } else if (outOfStock) {
      actionHTML = '<span class="store-card__action store-card__action--disabled">Out of Stock</span>';
    } else if (unitCents == null) {
      // Price not yet available (backend not deployed) — friendly state.
      actionHTML = '<span class="store-card__action store-card__action--disabled">Pricing soon</span>';
    } else {
      // Optional Single / Pack toggle — only when the product has a pack.
      // Single is the DEFAULT so individual purchasing always works.
      var packToggleHTML = hasPack(p)
        ? '<div class="store-card__variant" role="group" aria-label="Buy as single or pack" data-variant-group="' + esc(p.id) + '">' +
            '<button type="button" class="store-card__variant-btn is-selected" data-variant="single" data-stop-detail>Single &middot; ' + fmt(productUnitCents(p)) + '</button>' +
            '<button type="button" class="store-card__variant-btn" data-variant="pack" data-stop-detail>Pack of ' + p.packSize + ' &middot; ' + fmt(packUnitCents(p)) + '</button>' +
          '</div>'
        : '';
      actionHTML =
        packToggleHTML +
        '<div class="store-card__qty-row">' +
          '<div class="store-card__qty-control" data-product-id="' + esc(p.id) + '" data-variant="single">' +
            '<button class="store-card__qty-btn" data-dir="-1" type="button" aria-label="Decrease quantity">&minus;</button>' +
            '<span class="store-card__qty-value">1</span>' +
            '<button class="store-card__qty-btn" data-dir="1" type="button" aria-label="Increase quantity">+</button>' +
          '</div>' +
          '<button type="button" class="store-card__action store-card__action--primary store-card__action--cart" data-add-cart="' + esc(p.id) + '" data-stop-detail>' +
            'Add to Cart' +
          '</button>' +
        '</div>' +
        (p.customizable
          ? '<button type="button" class="store-card__customize" data-customize="' + esc(p.id) + '" data-stop-detail>Customize this &rarr;</button>'
          : (isBundleEligible(p)
              ? '<a href="bundle-builder.html?bundle=essentials&item=' + esc(p.id) + '" class="store-card__customize" data-stop-detail>Customize this &rarr;</a>'
              : ''));
    }

    // Favorite (heart) toggle — top-left on the image.
    var fav = (window.STW_Cart && window.STW_Cart.isFavorite(p.id));
    var favHTML =
      '<button type="button" class="store-card__fav' + (fav ? ' is-fav' : '') + '" ' +
        'data-fav="' + esc(p.id) + '" data-stop-detail aria-pressed="' + (fav ? 'true' : 'false') + '" ' +
        'aria-label="' + (fav ? 'Remove from favorites' : 'Add to favorites') + '" title="Save to favorites">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 21s-6.716-4.297-9.193-7.06C1.07 12.06 1 9.36 2.76 7.67a4.5 4.5 0 0 1 6.36.02L12 10.6l2.88-2.9a4.5 4.5 0 0 1 6.36-.02c1.76 1.69 1.69 4.39-.05 6.27C18.716 16.703 12 21 12 21z"/></svg>' +
      '</button>';

    return (
      '<article class="store-card" data-product-id="' + esc(p.id) + '">' +
        imageHTML +
        itemNumHTML +
        favHTML +
        '<div class="store-card__body">' +
          '<h3 class="store-card__title">' + esc(p.name) + '</h3>' +
          nativeHTML +
          '<p class="store-card__desc">' + esc(p.description) + '</p>' +
          '<div class="store-card__meta">' +
            '<span class="store-card__price">' + priceDisplay(p) + '</span>' +
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
      bundleHtml = customBibleInspoHtml() +
        '<div class="store-bundle-section" style="grid-column:1/-1; margin-bottom:1.5rem;">' +
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
        initCustomBibleInspo();
      }, 100);
    }
    gridEl.innerHTML = bundleHtml + filtered.map(renderProductCard).join('');
    initProductSlideshows();
    initProductDetailClicks();
    initQtyControls();
  }

  // ── Quantity selector + Add to Cart + Favorite controls ─────
  function initQtyControls() {
    // Quantity steppers: track qty on the control element's dataset.
    document.querySelectorAll('.store-card__qty-control').forEach(function(ctrl) {
      if (ctrl.dataset.qtyBound) return;
      ctrl.dataset.qtyBound = 'true';
      ctrl.dataset.qty = '1';
      var valueEl = ctrl.querySelector('.store-card__qty-value');
      var maxQty = 99;
      ctrl.querySelectorAll('.store-card__qty-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var dir = parseInt(btn.dataset.dir, 10);
          var qty = Math.max(1, Math.min(maxQty, (parseInt(ctrl.dataset.qty, 10) || 1) + dir));
          ctrl.dataset.qty = String(qty);
          if (valueEl) valueEl.textContent = qty;
        });
      });
    });

    // Single / Pack variant toggle (only present when the product has a pack).
    document.querySelectorAll('[data-variant-group]').forEach(function(group) {
      if (group.dataset.variantBound) return;
      group.dataset.variantBound = 'true';
      group.querySelectorAll('.store-card__variant-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          group.querySelectorAll('.store-card__variant-btn').forEach(function(b) { b.classList.remove('is-selected'); });
          btn.classList.add('is-selected');
          // Record the choice on the sibling qty-control so Add to Cart reads it.
          var card = group.closest('.store-card');
          var ctrl = card && card.querySelector('.store-card__qty-control');
          if (ctrl) ctrl.dataset.variant = btn.dataset.variant;
        });
      });
    });

    // Add to Cart buttons.
    document.querySelectorAll('[data-add-cart]').forEach(function(btn) {
      if (btn.dataset.cartBound) return;
      btn.dataset.cartBound = 'true';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-add-cart');
        var p = products.find(function(x) { return x.id === id; });
        if (!p || !window.STW_Cart) return;
        var row = btn.closest('.store-card__qty-row');
        var ctrl = row && row.querySelector('.store-card__qty-control');
        var qty = ctrl ? (parseInt(ctrl.dataset.qty, 10) || 1) : 1;
        var variant = (ctrl && ctrl.dataset.variant) || 'single';
        var asPack = (variant === 'pack' && hasPack(p));

        var cents = asPack ? packUnitCents(p) : productUnitCents(p);
        if (cents == null) return;

        window.STW_Cart.add({
          productId: p.id,
          name: p.name + (asPack ? ' (Pack of ' + p.packSize + ')' : ''),
          description: p.description,
          image: (p.image || (p.gallery && p.gallery[0]) || ''),
          unitPriceCents: cents,
          qty: qty,
          packSize: asPack ? p.packSize : 1,
          variant: asPack ? ('pack' + p.packSize) : 'single'
        });
        flashAdded(btn);
        if (ctrl) { ctrl.dataset.qty = '1'; var v = ctrl.querySelector('.store-card__qty-value'); if (v) v.textContent = '1'; }
      });
    });

    // Customize buttons -> open the customizer modal.
    document.querySelectorAll('[data-customize]').forEach(function(btn) {
      if (btn.dataset.czBound) return;
      btn.dataset.czBound = 'true';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-customize');
        var p = products.find(function(x) { return x.id === id; });
        if (p && window.STW_Customizer) window.STW_Customizer.open(p);
      });
    });

    // Favorite (heart) toggles.
    document.querySelectorAll('[data-fav]').forEach(function(btn) {
      if (btn.dataset.favBound) return;
      btn.dataset.favBound = 'true';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!window.STW_Cart) return;
        var id = btn.getAttribute('data-fav');
        var nowFav = window.STW_Cart.toggleFavorite(id);
        btn.classList.toggle('is-fav', nowFav);
        btn.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
        btn.setAttribute('aria-label', nowFav ? 'Remove from favorites' : 'Add to favorites');
      });
    });
  }

  // Brief "Added ✓" confirmation on an Add to Cart button.
  function flashAdded(btn) {
    if (btn.dataset.flashing) return;
    btn.dataset.flashing = '1';
    var original = btn.innerHTML;
    btn.classList.add('is-added');
    btn.innerHTML = 'Added \u2713';
    setTimeout(function() {
      btn.classList.remove('is-added');
      btn.innerHTML = original;
      delete btn.dataset.flashing;
    }, 1100);
  }

  // ── Render sidebar ──────────────────────────────────────────
  function initProductSlideshows() {
    document.querySelectorAll('[data-product-slideshow]').forEach(function(el) {
      if (el.dataset.initialized) return;
      el.dataset.initialized = 'true';
      var imgs = el.querySelectorAll('img');
      var dots = el.querySelectorAll('.store-card__dot');
      if (imgs.length < 2) return;
      var current = 0;
      var timer;
      setTimeout(function() {
        timer = setInterval(function() {
          imgs[current].classList.remove('is-active');
          if (dots[current]) dots[current].classList.remove('is-active');
          current = (current + 1) % imgs.length;
          imgs[current].classList.add('is-active');
          if (dots[current]) dots[current].classList.add('is-active');
        }, 6000);
      }, 3000);
      dots.forEach(function(dot) {
        dot.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = parseInt(dot.dataset.idx, 10);
          imgs[current].classList.remove('is-active');
          if (dots[current]) dots[current].classList.remove('is-active');
          current = idx;
          imgs[current].classList.add('is-active');
          if (dots[current]) dots[current].classList.add('is-active');
          clearInterval(timer);
          timer = null;
        });
      });
      el.querySelectorAll('.store-card__arrow').forEach(function(arrow) {
        arrow.addEventListener('click', function(e) {
          e.stopPropagation();
          clearInterval(timer); timer = null; // stop auto-cycle
          var dir = parseInt(arrow.dataset.dir, 10);
          imgs[current].classList.remove('is-active');
          if (dots[current]) dots[current].classList.remove('is-active');
          current = (current + dir + imgs.length) % imgs.length;
          imgs[current].classList.add('is-active');
          if (dots[current]) dots[current].classList.add('is-active');
        });
      });
    });

    // Lightbox — click opens current active image full-size
    document.querySelectorAll('.store-card__slideshow, .store-card__image').forEach(function(container) {
      if (container.dataset.lightboxBound) return;
      container.dataset.lightboxBound = 'true';
      container.style.cursor = 'pointer';
      container.addEventListener('click', function(e) {
        if (e.target.closest('.store-card__dot') || e.target.closest('.store-card__arrow')) return; // don't open on dot/arrow click
        var activeImg = container.querySelector('img.is-active') || container.querySelector('img');
        if (!activeImg) return;
        openLightbox(activeImg.src);
      });
    });
  }

  function openLightbox(src) {
    var overlay = document.createElement('div');
    overlay.className = 'store-lightbox';
    overlay.innerHTML = '<img src="' + src + '" alt="Full size"><button class="store-lightbox__close">&times;</button>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.classList.contains('store-lightbox__close')) {
        overlay.remove();
        document.body.style.overflow = '';
      }
    });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', handler); }
    });
  }

  function initProductDetailClicks() {
    document.querySelectorAll('.store-card[data-product-id]').forEach(function(card) {
      if (card.dataset.detailBound) return;
      card.dataset.detailBound = 'true';
      card.querySelector('.store-card__body').addEventListener('click', function(e) {
        // Don't open the detail view when an action control was clicked.
        if (e.target.closest('[data-stop-detail]') || e.target.closest('.store-card__qty-control')) return;
        var id = card.dataset.productId;
        var product = products.find(function(p) { return p.id === id; });
        if (product) openProductDetail(product);
      });
    });
  }

  function openProductDetail(p) {
    var gallery = p.gallery || (p.image ? [p.image] : []);
    var mainHTML = gallery.length
      ? gallery.map(function(src, i) {
          return '<img class="store-detail__main-img' + (i === 0 ? ' is-active' : '') + '" src="' + esc(src) + '" alt="' + esc(p.name) + '" data-idx="' + i + '">';
        }).join('')
      : '<div class="store-detail__placeholder">' + getCategoryPlaceholder(p.category) + '</div>';

    // Thumbnail strip (Gideons-style) when there's more than one image.
    var thumbsHTML = gallery.length > 1
      ? '<div class="store-detail__thumbs">' + gallery.map(function(src, i) {
          return '<button type="button" class="store-detail__thumb' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '" aria-label="View image ' + (i + 1) + '">' +
            '<img src="' + esc(src) + '" alt=""></button>';
        }).join('') + '</div>'
      : '';

    var nativeName = p.nativeName ? '<span class="store-detail__native">' + esc(p.nativeName) + '</span>' : '';
    var itemNumber = p.id ? '<span class="store-detail__item-num">Item #' + esc(p.id) + '</span>' : '';

    var unitCents = productUnitCents(p);
    var outOfStock = (p.category === 'bibles' && p.stockCount === 0);
    var isFav = (window.STW_Cart && window.STW_Cart.isFavorite(p.id));

    // Right-column call to action varies by product type.
    var ctaHTML = '';
    if (p.category === 'amazon' && p.url) {
      ctaHTML = '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" class="store-detail__cta store-detail__cta--amazon">View on Amazon &rarr;</a>';
    } else if (outOfStock) {
      ctaHTML = '<span class="store-detail__cta store-detail__cta--disabled">Out of Stock</span>';
    } else if (unitCents == null) {
      ctaHTML = '<span class="store-detail__cta store-detail__cta--disabled">Pricing soon</span>';
    } else {
      ctaHTML =
        '<div class="store-detail__buy">' +
          '<div class="store-detail__qty">' +
            '<label class="store-detail__qty-label">Quantity</label>' +
            '<div class="store-card__qty-control store-detail__qty-control" data-detail-qty>' +
              '<button class="store-card__qty-btn" data-dir="-1" type="button" aria-label="Decrease">&minus;</button>' +
              '<span class="store-card__qty-value">1</span>' +
              '<button class="store-card__qty-btn" data-dir="1" type="button" aria-label="Increase">+</button>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="store-detail__cta store-detail__cta--primary" data-detail-add>Add to Cart</button>' +
          (p.customizable
            ? '<button type="button" class="store-detail__cta store-detail__cta--customize" data-detail-customize>Customize this &rarr;</button>'
            : (isBundleEligible(p)
                ? '<a href="bundle-builder.html?bundle=essentials&item=' + esc(p.id) + '" class="store-detail__cta store-detail__cta--customize">Customize this &rarr;</a>'
                : '')) +
        '</div>';
    }

    var favBtnHTML =
      '<button type="button" class="store-detail__fav' + (isFav ? ' is-fav' : '') + '" data-detail-fav aria-pressed="' + (isFav ? 'true' : 'false') + '">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-6.716-4.297-9.193-7.06C1.07 12.06 1 9.36 2.76 7.67a4.5 4.5 0 0 1 6.36.02L12 10.6l2.88-2.9a4.5 4.5 0 0 1 6.36-.02c1.76 1.69 1.69 4.39-.05 6.27C18.716 16.703 12 21 12 21z"/></svg>' +
        '<span>' + (isFav ? 'Saved to Favorites' : 'Add to Favorites') + '</span>' +
      '</button>';

    // "Other Products" — up to 4 more from the same category.
    var others = products.filter(function(x) { return x.category === p.category && x.id !== p.id; }).slice(0, 4);
    var otherHTML = others.length
      ? '<div class="store-detail__others">' +
          '<h3 class="store-detail__others-title">Other Products</h3>' +
          '<div class="store-detail__others-grid">' +
            others.map(function(o) {
              var img = (o.image || (o.gallery && o.gallery[0]) || '');
              return '<button type="button" class="store-detail__other" data-other-id="' + esc(o.id) + '">' +
                (img ? '<img src="' + esc(img) + '" alt="' + esc(o.name) + '">' : '<span class="store-detail__other-ph">' + getCategoryPlaceholder(o.category) + '</span>') +
                '<span class="store-detail__other-name">' + esc(o.name) + '</span>' +
                '<span class="store-detail__other-price">' + priceDisplay(o) + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    var overlay = document.createElement('div');
    overlay.className = 'store-lightbox store-detail-modal';
    overlay.innerHTML =
      '<div class="store-detail" role="dialog" aria-modal="true" aria-label="' + esc(p.name) + '">' +
        '<button class="store-lightbox__close store-detail__close">&times;</button>' +
        '<div class="store-detail__cols">' +
          '<div class="store-detail__left">' +
            '<div class="store-detail__gallery">' + mainHTML + '</div>' +
            thumbsHTML +
          '</div>' +
          '<div class="store-detail__body">' +
            '<h2 class="store-detail__title">' + esc(p.name) + '</h2>' +
            nativeName +
            itemNumber +
            '<div class="store-detail__meta">' +
              '<span class="store-detail__price">' + priceDisplay(p) + '</span>' +
              (p.stockCount !== null && p.stockCount !== undefined ? '<span class="store-detail__stock' + (p.stockCount === 0 ? ' store-detail__stock--out' : '') + '">' + (p.stockCount === 0 ? 'Out of Stock' : p.stockCount + ' in stock') + '</span>' : '') +
            '</div>' +
            '<p class="store-detail__desc">' + esc(p.description) + '</p>' +
            ctaHTML +
            favBtnHTML +
          '</div>' +
        '</div>' +
        otherHTML +
      '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // ── Gallery: thumbnail select + click-to-lightbox ──
    var mainImgs = overlay.querySelectorAll('.store-detail__main-img');
    var thumbs = overlay.querySelectorAll('.store-detail__thumb');
    function showImg(idx) {
      mainImgs.forEach(function(im) { im.classList.toggle('is-active', parseInt(im.dataset.idx, 10) === idx); });
      thumbs.forEach(function(t) { t.classList.toggle('is-active', parseInt(t.dataset.idx, 10) === idx); });
    }
    thumbs.forEach(function(t) {
      t.addEventListener('click', function(e) { e.stopPropagation(); showImg(parseInt(t.dataset.idx, 10)); });
    });
    mainImgs.forEach(function(im) {
      im.addEventListener('click', function(e) { e.stopPropagation(); openLightbox(im.src); });
    });

    // ── Quantity stepper in detail ──
    var qtyCtrl = overlay.querySelector('[data-detail-qty]');
    if (qtyCtrl) {
      qtyCtrl.dataset.qty = '1';
      var qVal = qtyCtrl.querySelector('.store-card__qty-value');
      qtyCtrl.querySelectorAll('.store-card__qty-btn').forEach(function(b) {
        b.addEventListener('click', function(e) {
          e.stopPropagation();
          var dir = parseInt(b.dataset.dir, 10);
          var q = Math.max(1, Math.min(99, (parseInt(qtyCtrl.dataset.qty, 10) || 1) + dir));
          qtyCtrl.dataset.qty = String(q);
          if (qVal) qVal.textContent = q;
        });
      });
    }

    // ── Add to Cart from detail ──
    var addBtn = overlay.querySelector('[data-detail-add]');
    if (addBtn) {
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!window.STW_Cart || unitCents == null) return;
        var q = qtyCtrl ? (parseInt(qtyCtrl.dataset.qty, 10) || 1) : 1;
        window.STW_Cart.add({
          productId: p.id, name: p.name, description: p.description,
          image: (p.image || gallery[0] || ''), unitPriceCents: unitCents, qty: q, packSize: p.packSize || 1
        });
        flashAdded(addBtn);
      });
    }

    // ── Customize from detail -> open customizer ──
    var czBtn = overlay.querySelector('[data-detail-customize]');
    if (czBtn) {
      czBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (window.STW_Customizer) { closeDetail(); window.STW_Customizer.open(p); }
      });
    }

    // ── Favorite toggle from detail ──
    var favBtn = overlay.querySelector('[data-detail-fav]');
    if (favBtn) {
      favBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!window.STW_Cart) return;
        var now = window.STW_Cart.toggleFavorite(p.id);
        favBtn.classList.toggle('is-fav', now);
        favBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
        var lbl = favBtn.querySelector('span');
        if (lbl) lbl.textContent = now ? 'Saved to Favorites' : 'Add to Favorites';
      });
    }

    // ── Other Products: open that product's detail ──
    overlay.querySelectorAll('[data-other-id]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var oid = btn.getAttribute('data-other-id');
        var op = products.find(function(x) { return x.id === oid; });
        closeDetail();
        if (op) openProductDetail(op);
      });
    });

    function closeDetail() {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', keyHandler);
    }
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.classList.contains('store-detail__close')) closeDetail();
    });
    function keyHandler(e) { if (e.key === 'Escape') closeDetail(); }
    document.addEventListener('keydown', keyHandler);
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

    // Overlay live pricing from the Lists sheet before first render.
    // Graceful: keeps JSON prices if the backend isn't reachable/deployed.
    await mergeLiveCatalog();

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

  // ── Live stock update for all products ───────────────────────
  async function updateLiveStock() {
    try {
      var cfgRes = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' });
      if (!cfgRes.ok) return;
      var cfg = await cfgRes.json();
      var items = [];

      // Use items from site-config if available
      if (cfg.items && cfg.items.length) {
        items = cfg.items;
      }

      // Try live API for most current stock
      if (cfg.orderHandlerUrl) {
        try {
          var liveRes = await fetch(cfg.orderHandlerUrl + '?action=getMinistryStats', { cache: 'no-store' });
          if (liveRes.ok) {
            var live = await liveRes.json();
            if (live.ok && live.items && live.items.length) {
              items = live.items;
            }
          }
        } catch(_) {}
      }

      // Update products by ID
      if (items.length) {
        items.forEach(function(item) {
          var match = products.find(function(p) { return p.id === item.id; });
          if (match) {
            match.stockCount = item.count;
            match.inStock = item.count > 0;
          }
        });
        renderGrid();
      }
    } catch(_) {}
  }

  // ── Live pricing from the Lists sheet (getCatalog) ───────────
  // Overlays live retail/base pricing + pack size onto matching products
  // by id. Fully graceful: on any failure the store keeps its JSON prices.
  async function mergeLiveCatalog() {
    try {
      var cfgRes = await fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' });
      if (!cfgRes.ok) return;
      var cfg = await cfgRes.json();
      if (!cfg.orderHandlerUrl) return;

      var res = await fetch(cfg.orderHandlerUrl + '?action=getCatalog', { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || !data.ok || !Array.isArray(data.items)) return;

      var byId = {};
      data.items.forEach(function (it) { byId[it.id] = it; });

      products.forEach(function (p) {
        var live = byId[p.id];
        if (!live) return; // e.g. Amazon picks not in the sheet — leave as-is
        p.baseCents = live.baseCents;
        p.retailCents = live.retailCents;
        p.packSize = live.packSize || 1;
        p.packBaseCents = live.packBaseCents;
        p.packRetailCents = live.packRetailCents;
        // Display price uses the pack retail when sold in packs, else unit retail.
        var displayCents = p.packSize > 1 ? live.packRetailCents : live.retailCents;
        p.price = formatCents_(displayCents) + (p.packSize > 1 ? ' / pack of ' + p.packSize : '');
        // Prefer the sheet's fuller description when present.
        if (live.description) p.description = live.description;
      });
    } catch (_) { /* keep existing JSON prices */ }
  }

  function formatCents_(cents) {
    if (window.STW_Cart && window.STW_Cart.formatCents) return window.STW_Cart.formatCents(cents);
    var n = Math.round(Number(cents) || 0);
    return '$' + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
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
