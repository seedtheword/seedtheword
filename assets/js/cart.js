/* ============================================================
   Seed the Word — Cart + Favorites core (STW_Cart)
   ------------------------------------------------------------
   Shopify/Amazon-style client cart, persisted in localStorage.

   • Money is handled in INTEGER CENTS everywhere. Never do float
     math on prices (0.1 + 0.2 !== 0.3 in JS).
   • Retail rounding mirrors the backend getStoreCatalog_ rule:
     base rounded UP to the next whole dollar minus one cent.
   • Tax is NOT computed here — it is deferred to the payment
     processor (PayPal/Stripe) at checkout, per project decision.
   • Emits a 'stw-cart-change' event on window so the header badge
     and any open cart view can re-render.
   • Fires analytics event stubs (window.dataLayer) so Facebook /
     Google Ads / GA4 can be wired later without touching this file.

   Public API (window.STW_Cart):
     add(item)                 add/increment a line
     remove(lineId)            remove a line
     setQty(lineId, qty)       set a line's quantity (0 removes)
     clear()                   empty the cart
     getItems()                -> array of line items
     getCount()                -> total unit count (for badge)
     getSubtotalCents()        -> integer cents
     getSubtotalDisplay()      -> "$12.99"
     isFavorite(productId)     -> bool
     toggleFavorite(productId) -> bool (new state)
     getFavorites()            -> array of productIds
     onChange(fn)              subscribe; returns an unsubscribe fn
     formatCents(cents)        -> "$X.XX"
     retailCentsFromBase(base) -> integer cents (rounding rule)
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'stw.cart.v1';
  var FAV_KEY = 'stw.favorites.v1';
  var CHANGE_EVENT = 'stw-cart-change';

  // ── Storage helpers ─────────────────────────────────────────
  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // ── Money ────────────────────────────────────────────────────
  function formatCents(cents) {
    var n = Math.round(Number(cents) || 0);
    var sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    return sign + '$' + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
  }

  // Mirror of backend roundUpToRetailCents_: base -> next whole dollar
  // minus a cent, always >= base. 5->99, 200->299, 310->399, 670->699.
  function retailCentsFromBase(baseCents) {
    var c = Math.round(Number(baseCents) || 0);
    if (c <= 0) return 0;
    var dollarsUp = Math.ceil(c / 100);
    if (c % 100 === 0) dollarsUp = (c / 100) + 1;
    return dollarsUp * 100 - 1;
  }

  // ── Line item identity ───────────────────────────────────────
  // A line is uniquely keyed by productId + a variant signature, so the
  // same product bought as "single" and as "pack of 25" are separate
  // lines, and a customized bundle is its own line.
  function lineIdFor(item) {
    var variant = item.variant || (item.packSize && item.packSize > 1 ? 'pack' + item.packSize : 'single');
    var custom = item.customizationId ? ':' + item.customizationId : '';
    return String(item.productId) + ':' + variant + custom;
  }

  // ── State ────────────────────────────────────────────────────
  function loadCart() {
    var arr = readJSON(CART_KEY, []);
    if (!Array.isArray(arr)) return [];
    // Defensive: keep only well-formed lines.
    return arr.filter(function (l) {
      return l && l.lineId && l.productId &&
        typeof l.unitPriceCents === 'number' && typeof l.qty === 'number' && l.qty > 0;
    });
  }

  function loadFavorites() {
    var arr = readJSON(FAV_KEY, []);
    return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }) : [];
  }

  var cart = loadCart();
  var favorites = loadFavorites();

  // ── Change notification ──────────────────────────────────────
  function persistAndNotify() {
    writeJSON(CART_KEY, cart);
    writeJSON(FAV_KEY, favorites);
    var detail = {
      count: getCount(),
      subtotalCents: getSubtotalCents(),
      items: getItems(),
      favorites: favorites.slice()
    };
    try {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: detail }));
    } catch (e) {
      // Older browsers: fall back to a plain Event.
      var evt = document.createEvent('Event');
      evt.initEvent(CHANGE_EVENT, false, false);
      window.dispatchEvent(evt);
    }
  }

  // ── Analytics event stubs (no-op until FB/Google tags are added) ──
  function pushDataLayer(eventName, payload) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: eventName }, payload || {}));
    } catch (e) {}
  }

  // ── Public operations ────────────────────────────────────────
  // add({ productId, name, image, unitPriceCents, qty?, packSize?, variant?,
  //       customizationId?, isBundle?, description? })
  function add(item) {
    if (!item || !item.productId || typeof item.unitPriceCents !== 'number') return;
    var qty = Math.max(1, parseInt(item.qty, 10) || 1);
    var id = lineIdFor(item);
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].lineId === id) { existing = cart[i]; break; }
    }
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({
        lineId: id,
        productId: String(item.productId),
        name: item.name || item.productId,
        description: item.description || '',
        image: item.image || '',
        unitPriceCents: Math.round(item.unitPriceCents),
        qty: qty,
        packSize: item.packSize && item.packSize > 1 ? item.packSize : 1,
        variant: item.variant || null,
        customizationId: item.customizationId || null,
        isBundle: !!item.isBundle
      });
    }
    persistAndNotify();
    pushDataLayer('add_to_cart', {
      productId: String(item.productId),
      quantity: qty,
      valueCents: Math.round(item.unitPriceCents) * qty
    });
  }

  function remove(lineId) {
    var before = cart.length;
    cart = cart.filter(function (l) { return l.lineId !== lineId; });
    if (cart.length !== before) {
      persistAndNotify();
      pushDataLayer('remove_from_cart', { lineId: lineId });
    }
  }

  function setQty(lineId, qty) {
    qty = parseInt(qty, 10);
    if (isNaN(qty)) return;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].lineId === lineId) {
        if (qty <= 0) { remove(lineId); return; }
        cart[i].qty = qty;
        persistAndNotify();
        return;
      }
    }
  }

  function clear() {
    if (!cart.length) return;
    cart = [];
    persistAndNotify();
    pushDataLayer('clear_cart', {});
  }

  function getItems() {
    return cart.map(function (l) {
      return Object.assign({}, l, { lineTotalCents: l.unitPriceCents * l.qty });
    });
  }

  function getCount() {
    return cart.reduce(function (sum, l) { return sum + l.qty; }, 0);
  }

  function getSubtotalCents() {
    return cart.reduce(function (sum, l) { return sum + l.unitPriceCents * l.qty; }, 0);
  }

  function getSubtotalDisplay() {
    return formatCents(getSubtotalCents());
  }

  // ── Favorites ────────────────────────────────────────────────
  function isFavorite(productId) {
    return favorites.indexOf(String(productId)) !== -1;
  }

  function toggleFavorite(productId) {
    productId = String(productId);
    var idx = favorites.indexOf(productId);
    var nowFav;
    if (idx === -1) { favorites.push(productId); nowFav = true; }
    else { favorites.splice(idx, 1); nowFav = false; }
    persistAndNotify();
    pushDataLayer(nowFav ? 'add_to_wishlist' : 'remove_from_wishlist', { productId: productId });
    return nowFav;
  }

  function getFavorites() {
    return favorites.slice();
  }

  // ── Subscription helper ──────────────────────────────────────
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    window.addEventListener(CHANGE_EVENT, fn);
    return function () { window.removeEventListener(CHANGE_EVENT, fn); };
  }

  // Cross-tab sync: if another tab changes the cart, reload + notify.
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY) { cart = loadCart(); persistAndNotify(); }
    if (e.key === FAV_KEY) { favorites = loadFavorites(); persistAndNotify(); }
  });

  // ── Expose ───────────────────────────────────────────────────
  window.STW_Cart = {
    add: add,
    remove: remove,
    setQty: setQty,
    clear: clear,
    getItems: getItems,
    getCount: getCount,
    getSubtotalCents: getSubtotalCents,
    getSubtotalDisplay: getSubtotalDisplay,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    getFavorites: getFavorites,
    onChange: onChange,
    formatCents: formatCents,
    retailCentsFromBase: retailCentsFromBase,
    CHANGE_EVENT: CHANGE_EVENT
  };
})();
