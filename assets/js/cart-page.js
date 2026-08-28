/* ============================================================
   Seed the Word — Cart page logic (cart.html)
   ------------------------------------------------------------
   Renders the cart line items, order summary, favorites strip,
   and the checkout form. Submits orders to the Apps Script
   backend via the `placeOrder` action. Money is in integer cents;
   tax is deferred to the payment processor.
   Depends on cart.js (window.STW_Cart).
   ============================================================ */
(function () {
  'use strict';

  var Cart = window.STW_Cart;
  var products = [];       // from store-products.json (for favorites display)
  var orderHandlerUrl = '';

  // DOM refs
  var emptyEl, layoutEl, itemsEl, subtotalEl, totalEl, favWrap, favGrid,
      proceedBtn, form, shipToggle, shipFields, submitBtn, statusEl,
      successEl, successMsgEl, summaryEl;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) { return Cart ? Cart.formatCents(cents) : ('$' + (cents / 100).toFixed(2)); }

  // ── Render line items ────────────────────────────────────────
  function renderItems() {
    if (!Cart) return;
    var items = Cart.getItems();

    if (!items.length) {
      emptyEl.hidden = false;
      layoutEl.hidden = true;
      successEl.hidden = true;
      renderFavorites();
      return;
    }
    emptyEl.hidden = true;
    layoutEl.hidden = false;

    itemsEl.innerHTML = items.map(function (l) {
      var img = l.image
        ? '<img src="' + esc(l.image) + '" alt="' + esc(l.name) + '">'
        : '<span class="cart-item__ph">' + (l.isBundle ? '✨' : '📦') + '</span>';
      var packNote = l.packSize > 1 ? '<span class="cart-item__pack">Pack of ' + l.packSize + '</span>' : '';
      var bundleNote = l.isBundle ? '<span class="cart-item__badge">Custom bundle</span>' : '';
      var sub = l.description ? '<p class="cart-item__desc">' + esc(l.description) + '</p>' : '';
      return '' +
        '<div class="cart-item" data-line="' + esc(l.lineId) + '">' +
          '<div class="cart-item__img">' + img + '</div>' +
          '<div class="cart-item__info">' +
            '<h3 class="cart-item__name">' + esc(l.name) + ' ' + bundleNote + '</h3>' +
            packNote + sub +
            '<button type="button" class="cart-item__remove" data-remove="' + esc(l.lineId) + '">Remove</button>' +
          '</div>' +
          '<div class="cart-item__qty">' +
            '<div class="store-card__qty-control cart-item__qtyctrl">' +
              '<button class="store-card__qty-btn" type="button" data-qminus="' + esc(l.lineId) + '" aria-label="Decrease">&minus;</button>' +
              '<span class="store-card__qty-value">' + l.qty + '</span>' +
              '<button class="store-card__qty-btn" type="button" data-qplus="' + esc(l.lineId) + '" aria-label="Increase">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="cart-item__price">' +
            '<span class="cart-item__linetotal">' + money(l.lineTotalCents) + '</span>' +
            '<span class="cart-item__unit">' + money(l.unitPriceCents) + ' each</span>' +
          '</div>' +
        '</div>';
    }).join('');

    // Wire qty + remove
    itemsEl.querySelectorAll('[data-qminus]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-qminus');
        var line = Cart.getItems().find(function (x) { return x.lineId === id; });
        if (line) Cart.setQty(id, line.qty - 1);
      });
    });
    itemsEl.querySelectorAll('[data-qplus]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-qplus');
        var line = Cart.getItems().find(function (x) { return x.lineId === id; });
        if (line) Cart.setQty(id, line.qty + 1);
      });
    });
    itemsEl.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () { Cart.remove(b.getAttribute('data-remove')); });
    });

    renderSummary();
    renderFavorites();
  }

  function renderSummary() {
    var sub = Cart.getSubtotalCents();
    subtotalEl.textContent = money(sub);
    totalEl.textContent = money(sub);
  }

  // ── Favorites strip ──────────────────────────────────────────
  function renderFavorites() {
    var favIds = Cart.getFavorites();
    if (!favIds.length || !products.length) { favWrap.hidden = true; return; }
    var favs = favIds.map(function (id) {
      return products.find(function (p) { return p.id === id; });
    }).filter(Boolean);
    if (!favs.length) { favWrap.hidden = true; return; }

    favWrap.hidden = false;
    favGrid.innerHTML = favs.map(function (p) {
      var img = (p.image || (p.gallery && p.gallery[0]) || '');
      return '' +
        '<div class="cart-fav" data-fav-id="' + esc(p.id) + '">' +
          '<a href="store.html#' + esc(p.category) + '" class="cart-fav__link">' +
            (img ? '<img src="' + esc(img) + '" alt="' + esc(p.name) + '">' : '<span class="cart-fav__ph">📦</span>') +
            '<span class="cart-fav__name">' + esc(p.name) + '</span>' +
          '</a>' +
          '<button type="button" class="cart-fav__remove" data-unfav="' + esc(p.id) + '" aria-label="Remove favorite">Remove</button>' +
        '</div>';
    }).join('');

    favGrid.querySelectorAll('[data-unfav]').forEach(function (b) {
      b.addEventListener('click', function () {
        Cart.toggleFavorite(b.getAttribute('data-unfav'));
        renderFavorites();
      });
    });
  }

  // ── Checkout ─────────────────────────────────────────────────
  function showCheckout() {
    form.hidden = false;
    proceedBtn.textContent = 'Checkout ↓';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var nameEl = document.getElementById('co-name');
    if (nameEl) nameEl.focus();
  }

  function buildOrderPayload() {
    var lines = Cart.getItems().map(function (l) {
      return {
        productId: l.productId,
        name: l.name,
        qty: l.qty,
        packSize: l.packSize,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        isBundle: !!l.isBundle,
        customizationId: l.customizationId || null
      };
    });
    var wantsShipping = document.getElementById('co-ship').checked;
    var address = '';
    if (wantsShipping) {
      address = [
        (document.getElementById('co-addr').value || '').trim(),
        (document.getElementById('co-city').value || '').trim(),
        (document.getElementById('co-state').value || '').trim(),
        (document.getElementById('co-zip').value || '').trim()
      ].filter(Boolean).join(', ');
    }
    return {
      action: 'placeOrder',
      name: (document.getElementById('co-name').value || '').trim(),
      email: (document.getElementById('co-email').value || '').trim(),
      phone: (document.getElementById('co-phone').value || '').trim(),
      wantsShipping: wantsShipping,
      shippingAddress: address,
      notes: (document.getElementById('co-notes').value || '').trim(),
      items: lines,
      subtotalCents: Cart.getSubtotalCents(),
      currency: 'USD'
    };
  }

  function submitOrder(e) {
    e.preventDefault();
    if (document.getElementById('co-gotcha').value) return; // bot

    var name = (document.getElementById('co-name').value || '').trim();
    var email = (document.getElementById('co-email').value || '').trim();
    if (!name || !email) {
      setStatus('Please enter your name and email.', 'error');
      return;
    }
    if (!Cart.getItems().length) {
      setStatus('Your cart is empty.', 'error');
      return;
    }

    var payload = buildOrderPayload();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
    setStatus('', null);

    // Analytics stub for future FB/Google ads (begin_checkout / purchase).
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'begin_checkout', valueCents: payload.subtotalCents, itemCount: Cart.getCount() });
    } catch (_) {}

    if (!orderHandlerUrl) {
      // Backend not configured — fail gracefully, keep cart intact.
      submitBtn.disabled = false;
      submitBtn.textContent = 'Place order →';
      setStatus('We could not reach the order service. Please try again shortly or contact us.', 'error');
      return;
    }

    fetch(orderHandlerUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          try {
            window.dataLayer.push({ event: 'purchase', orderId: res.orderId || '', valueCents: payload.subtotalCents });
          } catch (_) {}
          Cart.clear();
          layoutEl.hidden = true;
          emptyEl.hidden = true;
          if (res.orderId) {
            successMsgEl.textContent = 'Thank you, ' + name + '. Your order (' + res.orderId +
              ') is confirmed — check your email, and a team member will follow up' +
              (payload.wantsShipping ? ' to arrange shipping.' : '.');
          }
          successEl.hidden = false;
          successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Place order →';
          setStatus('Order error: ' + ((res && res.error) || 'Please try again.'), 'error');
        }
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place order →';
        setStatus('Order failed: ' + (err.message || 'Network error. Please try again.'), 'error');
      });
  }

  function setStatus(msg, kind) {
    if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.className = 'checkout-status' + (kind ? ' checkout-status--' + kind : '');
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    emptyEl = document.getElementById('cart-empty');
    layoutEl = document.getElementById('cart-layout');
    itemsEl = document.getElementById('cart-items');
    subtotalEl = document.getElementById('cart-subtotal');
    totalEl = document.getElementById('cart-total');
    favWrap = document.getElementById('cart-favorites');
    favGrid = document.getElementById('cart-favorites-grid');
    proceedBtn = document.getElementById('proceed-btn');
    form = document.getElementById('checkout-form');
    shipToggle = document.getElementById('co-ship');
    shipFields = document.getElementById('co-ship-fields');
    submitBtn = document.getElementById('checkout-submit');
    statusEl = document.getElementById('checkout-status');
    successEl = document.getElementById('cart-success');
    successMsgEl = document.getElementById('cart-success-msg');
    summaryEl = document.getElementById('cart-summary');

    if (!Cart || !itemsEl) return;

    proceedBtn.addEventListener('click', showCheckout);
    shipToggle.addEventListener('change', function () { shipFields.hidden = !shipToggle.checked; });
    form.addEventListener('submit', submitOrder);

    // Re-render whenever the cart changes (also covers other-tab edits).
    Cart.onChange(renderItems);

    renderItems();

    // Load products for the favorites display + backend URL.
    fetch('assets/data/store-products.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { products: [] }; })
      .then(function (data) { products = data.products || []; renderFavorites(); })
      .catch(function () {});

    fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (cfg) { orderHandlerUrl = cfg.orderHandlerUrl || ''; })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
