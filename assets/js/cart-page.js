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
  var paypalClientId = '';
  var paypalMode = 'sandbox';
  var currency = 'USD';
  var paypalSdkLoaded = false;
  var paypalButtonsRendered = false;

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
    // Keep the payment path in sync if the checkout form is already open.
    if (form && !form.hidden && typeof updatePaymentUI === 'function') updatePaymentUI();
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

    // Prefill from the logged-in account when available.
    try {
      var sess = JSON.parse(localStorage.getItem('stwm-team-session'));
      if (sess) {
        var n = document.getElementById('co-name');
        var em = document.getElementById('co-email');
        var ph = document.getElementById('co-phone');
        if (n && !n.value && sess.name) n.value = sess.name;
        if (em && !em.value && sess.email) em.value = sess.email;
        if (ph && !ph.value && sess.phone) ph.value = sess.phone;
      }
    } catch (e) {}

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var nameEl = document.getElementById('co-name');
    if (nameEl) nameEl.focus();

    // Decide pay-now vs quote vs free and render PayPal if applicable.
    updatePaymentUI();
  }

  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
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
        isCustom: !!l.isCustom,
        customizationId: l.customizationId || null,
        customSpec: l.customSpec || null,
        artworkData: l.artworkData || ''
      };
    });
    var wantsShipping = document.getElementById('co-ship').checked;
    var address = '';
    if (wantsShipping) {
      var countrySel = document.getElementById('co-country');
      var country = countrySel ? countrySel.value : '';
      if (country === 'Other') {
        country = (document.getElementById('co-country-other').value || '').trim();
      }
      address = [
        (document.getElementById('co-addr').value || '').trim(),
        (document.getElementById('co-city').value || '').trim(),
        (document.getElementById('co-state').value || '').trim(),
        (document.getElementById('co-zip').value || '').trim(),
        country
      ].filter(Boolean).join(', ');
    }
    var sess = null;
    try { sess = JSON.parse(localStorage.getItem('stwm-team-session')); } catch (e) {}
    var promoEl = document.getElementById('co-promo');
    return {
      action: 'placeOrder',
      token: (sess && sess.token) || '',
      name: (document.getElementById('co-name').value || '').trim(),
      email: (document.getElementById('co-email').value || '').trim(),
      phone: (document.getElementById('co-phone').value || '').trim(),
      wantsShipping: wantsShipping,
      shippingAddress: address,
      notes: (document.getElementById('co-notes').value || '').trim(),
      promoCode: promoEl ? (promoEl.value || '').trim().toUpperCase() : '',
      items: lines,
      subtotalCents: Cart.getSubtotalCents(),
      currency: 'USD'
    };
  }

  // Basic pre-submit validation shared by both paths (plain + PayPal).
  function validateCheckout() {
    if (document.getElementById('co-gotcha').value) return false; // bot
    var name = (document.getElementById('co-name').value || '').trim();
    var email = (document.getElementById('co-email').value || '').trim();
    if (!name || !email) { setStatus('Please enter your name and email.', 'error'); return false; }
    if (!Cart.getItems().length) { setStatus('Your cart is empty.', 'error'); return false; }
    if (!orderHandlerUrl) { setStatus('We could not reach the order service. Please try again shortly or contact us.', 'error'); return false; }
    return true;
  }

  // POST placeOrder to the backend and show the success/failure UI. `extra`
  // carries verified PayPal payment fields (captureId etc.) when paid online.
  function recordOrder(extra) {
    var payload = buildOrderPayload();
    if (extra) { for (var k in extra) payload[k] = extra[k]; }
    var name = payload.name;

    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'begin_checkout', valueCents: payload.subtotalCents, itemCount: Cart.getCount() });
    } catch (_) {}

    return fetch(orderHandlerUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          try { window.dataLayer.push({ event: 'purchase', orderId: res.orderId || '', valueCents: payload.subtotalCents }); } catch (_) {}
          Cart.clear();
          layoutEl.hidden = true;
          emptyEl.hidden = true;
          if (res.orderId) {
            var tail;
            if (res.paymentStatus === 'paid') {
              tail = ' — payment received. A receipt is on the way' + (payload.wantsShipping ? ' and we\'ll arrange shipping.' : '.');
            } else if (res.comped) {
              tail = ' — your team code was applied, there\'s no charge. A team member will follow up.';
            } else if (payload.wantsShipping) {
              tail = ' — we\'ll email you an itemized invoice (with shipping) to approve and pay.';
            } else {
              tail = ' — check your email, and a team member will follow up.';
            }
            successMsgEl.textContent = 'Thank you, ' + name + '. Your order (' + res.orderId + ') is confirmed' + tail;
          }
          successEl.hidden = false;
          successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return { ok: true };
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place order →';
        if (res && res.code === 'promo-invalid') {
          setStatus((res.error || 'That code could not be applied.') + ' Remove it or fix it to continue.', 'error');
          var promoEl = document.getElementById('co-promo');
          if (promoEl) promoEl.focus();
        } else {
          setStatus('Order error: ' + ((res && res.error) || 'Please try again.'), 'error');
        }
        return { ok: false, res: res };
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place order →';
        setStatus('Order failed: ' + (err.message || 'Network error. Please try again.'), 'error');
        return { ok: false, error: err };
      });
  }

  // Plain "Place order" path — used for comped/free orders and shipping
  // (quote-first) orders. Online card/PayPal payment goes through the PayPal
  // Buttons instead (see wirePayPal).
  function submitOrder(e) {
    e.preventDefault();
    if (!validateCheckout()) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Placing order…';
    setStatus('', null);
    recordOrder(null);
  }

  function setStatus(msg, kind) {
    if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.className = 'checkout-status' + (kind ? ' checkout-status--' + kind : '');
  }

  // ── PayPal payment ───────────────────────────────────────────
  // Load the PayPal JS SDK once (buttons + hosted card fields + pay-later).
  function loadPayPalSdk() {
    if (paypalSdkLoaded || !paypalClientId) return Promise.resolve(!!window.paypal);
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(paypalClientId) +
        '&currency=' + encodeURIComponent(currency) + '&intent=capture&components=buttons&enable-funding=venmo,paylater';
      s.onload = function () { paypalSdkLoaded = true; resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  // Decide which checkout path to present based on the CURRENT form state.
  //   - wants shipping ....... quote-first (no pay now); button "Request quote & invoice"
  //   - promo code entered ... comped path; plain "Place order"
  //   - $0 subtotal .......... free; plain "Place order"
  //   - otherwise ............ pay now via PayPal Buttons (pickup, balance due)
  function updatePaymentUI() {
    var payWrap = document.getElementById('checkout-pay');
    var payNote = document.getElementById('checkout-pay-note');
    var wantsShipping = shipToggle && shipToggle.checked;
    var promoEl = document.getElementById('co-promo');
    var hasPromo = promoEl && promoEl.value.trim().length > 0;
    var subtotal = Cart ? Cart.getSubtotalCents() : 0;
    var canPayNow = paypalClientId && !wantsShipping && !hasPromo && subtotal > 0;

    if (wantsShipping) {
      submitBtn.textContent = 'Request quote & invoice →';
    } else {
      submitBtn.textContent = 'Place order →';
    }

    if (canPayNow) {
      if (payWrap) payWrap.hidden = false;
      submitBtn.style.display = 'none';           // pay via PayPal instead
      if (payNote) {
        payNote.hidden = false;
        payNote.textContent = 'Have a team code or prefer to pay another way? Enter a code above, or choose shipping to get an invoice.';
      }
      renderPayPalButtons();
    } else {
      if (payWrap) payWrap.hidden = true;
      submitBtn.style.display = '';
      if (payNote) payNote.hidden = true;
    }
  }

  function renderPayPalButtons() {
    loadPayPalSdk().then(function (ok) {
      if (!ok || !window.paypal || paypalButtonsRendered) return;
      var container = document.getElementById('paypal-buttons');
      if (!container) return;
      paypalButtonsRendered = true;
      window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
        // Ask OUR backend to create the order (amount computed server-side).
        createOrder: function () {
          if (!validateCheckout()) return Promise.reject(new Error('validation'));
          setStatus('', null);
          var payload = buildOrderPayload();
          return fetch(orderHandlerUrl, {
            method: 'POST', mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'createPayPalOrder', kind: 'order', items: payload.items, currency: currency })
          }).then(function (r) { return r.json(); })
            .then(function (res) {
              if (res && res.ok && res.id) return res.id;
              throw new Error((res && res.error) || 'create-failed');
            });
        },
        // After buyer approval, capture on OUR backend (verifies the amount),
        // then record the order as paid.
        onApprove: function (data) {
          setStatus('Confirming your payment…', null);
          var payload = buildOrderPayload();
          return fetch(orderHandlerUrl, {
            method: 'POST', mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'capturePayPalOrder', paypalOrderId: data.orderID, kind: 'order', items: payload.items, currency: currency })
          }).then(function (r) { return r.json(); })
            .then(function (res) {
              if (!res || !res.ok) throw new Error((res && res.error) || 'capture-failed');
              // Payment verified server-side — now record the order as paid.
              return recordOrder({
                paymentMethod: 'paypal',
                paypalOrderId: res.paypalOrderId || data.orderID,
                captureId: res.captureId,
                amountPaidCents: res.amountCents
              });
            })
            .catch(function (err) {
              setStatus('Payment could not be completed: ' + (err.message || 'please try again.'), 'error');
            });
        },
        onError: function () {
          setStatus('Payment error — please try again or choose another method.', 'error');
        }
      }).render('#paypal-buttons');
    });
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
    shipToggle.addEventListener('change', function () { shipFields.hidden = !shipToggle.checked; updatePaymentUI(); });
    form.addEventListener('submit', submitOrder);

    // Re-evaluate which payment path to show when the team-code field changes.
    var promoEl = document.getElementById('co-promo');
    if (promoEl) promoEl.addEventListener('input', debounce(updatePaymentUI, 300));

    // International address: show a free-text country field for "Other", and
    // relabel State/ZIP to neutral terms when the country isn't the US.
    var countrySel = document.getElementById('co-country');
    if (countrySel) {
      countrySel.addEventListener('change', function () {
        var otherField = document.getElementById('co-country-other-field');
        if (otherField) otherField.hidden = (countrySel.value !== 'Other');
        var stateLabel = document.getElementById('co-state-label');
        var zipLabel = document.getElementById('co-zip-label');
        var isUS = (countrySel.value === 'United States');
        if (stateLabel) stateLabel.textContent = isUS ? 'State' : 'State / Province / Region';
        if (zipLabel) zipLabel.textContent = isUS ? 'ZIP code' : 'Postal code';
      });
    }

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
      .then(function (cfg) {
        orderHandlerUrl = cfg.orderHandlerUrl || '';
        paypalClientId = cfg.paypalClientId || '';
        paypalMode = cfg.paypalMode || 'sandbox';
        currency = cfg.currency || 'USD';
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
