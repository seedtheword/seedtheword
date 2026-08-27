/* ============================================================
   Seed the Word — Header cart badge (sitewide)
   ------------------------------------------------------------
   Injects a cart icon + live item count into the site header and
   keeps it in sync with STW_Cart. Links to the cart page.

   Depends on cart.js (window.STW_Cart) being loaded first.
   Mirrors the injection approach of nav-auth.js so it works on
   every page that shares the standard header, without editing
   each page's markup.
   ============================================================ */
(function () {
  'use strict';

  var CART_URL = 'cart.html';

  function buildBadge() {
    var wrap = document.createElement('a');
    wrap.className = 'nav-cart';
    wrap.href = CART_URL;
    wrap.setAttribute('aria-label', 'View cart');
    wrap.innerHTML =
      '<span class="nav-cart__icon" aria-hidden="true">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="9" cy="21" r="1"></circle>' +
          '<circle cx="20" cy="21" r="1"></circle>' +
          '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>' +
        '</svg>' +
      '</span>' +
      '<span class="nav-cart__count" data-cart-count hidden>0</span>';
    return wrap;
  }

  function updateCount(badge) {
    var countEl = badge.querySelector('[data-cart-count]');
    if (!countEl || !window.STW_Cart) return;
    var n = window.STW_Cart.getCount();
    countEl.textContent = n > 99 ? '99+' : String(n);
    if (n > 0) {
      countEl.hidden = false;
      badge.classList.add('has-items');
    } else {
      countEl.hidden = true;
      badge.classList.remove('has-items');
    }
  }

  function init() {
    // Avoid double-injection.
    if (document.querySelector('.nav-cart')) return;

    var header = document.querySelector('.site-header');
    if (!header) return;

    var badge = buildBadge();

    // Preferred slot: start of .header-social. Fallbacks keep it robust
    // across pages whose header markup varies slightly.
    var social = header.querySelector('.header-social');
    var hamburger = header.querySelector('.hamburger');
    if (social) {
      social.insertBefore(badge, social.firstChild);
    } else if (hamburger && hamburger.parentNode) {
      hamburger.parentNode.insertBefore(badge, hamburger);
    } else {
      var nav = header.querySelector('#site-nav') || header.querySelector('.container') || header;
      nav.appendChild(badge);
    }

    updateCount(badge);
    if (window.STW_Cart && window.STW_Cart.onChange) {
      window.STW_Cart.onChange(function () { updateCount(badge); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
