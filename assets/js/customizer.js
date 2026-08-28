/* ============================================================
   Seed the Word — Product Customizer (Amazon-style)
   ------------------------------------------------------------
   Opens a modal for a customizable product:
     • Left: live product image with text overlaid at named zones
       (main / secondary / sleeve) + any uploaded artwork overlay.
     • Right: option controls driven by the product's `options`
       (from the CustomOptions sheet tab via getCatalog):
         type: text | style | producttype | image | checkbox
       Each option may add to the price (priceAddCents) and text
       options may enforce a character limit (maxChars).
     • "Must customize before adding to cart": required options are
       validated before Add to Cart.
   Produces an isCustom STW_Cart line carrying the full spec + any
   uploaded artwork (base64, uploaded to Drive at checkout).

   Public API: window.STW_Customizer.open(product)
   Depends on cart.js (window.STW_Cart).
   ============================================================ */
(function () {
  'use strict';

  var overlay = null;
  var current = null;   // { product, values, artworkData }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(c) {
    return window.STW_Cart ? window.STW_Cart.formatCents(c) : ('$' + (Math.round(c) / 100).toFixed(2));
  }

  // Base unit price of a customizable product (single unit retail).
  function baseUnitCents(p) {
    if (typeof p.retailCents === 'number') return p.retailCents;
    var m = p.price && String(p.price).match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (m) {
      var cents = Math.round(parseFloat(m[1]) * 100);
      return window.STW_Cart ? window.STW_Cart.retailCentsFromBase(cents) : cents;
    }
    return 0;
  }

  // Sum the price add-ons of currently-selected options.
  function addOnCents(p, values) {
    var sum = 0;
    (p.options || []).forEach(function (opt) {
      var v = values[opt.key];
      var add = opt.priceAddCents || 0;
      if (!add) return;
      if (opt.type === 'checkbox' && v) sum += add;
      else if (opt.type === 'text' && v && String(v).trim()) sum += add;
      else if ((opt.type === 'style' || opt.type === 'producttype') && v) sum += add;
      else if (opt.type === 'image' && v) sum += add;
    });
    return sum;
  }

  function unitCents(p, values) { return baseUnitCents(p) + addOnCents(p, values); }

  // ── Preview zones ────────────────────────────────────────────
  // A text option's `zone` may be a keyword (main/secondary/sleeve) mapped to a
  // default position, or explicit "x,y,w" percentages. Positions are % of the
  // preview box so they scale. This is an approximation for "show us what you
  // want" — not a print-accurate render.
  var ZONE_PRESETS = {
    main:      { x: 50, y: 42, w: 60, size: 8,   align: 'center' },
    secondary: { x: 50, y: 54, w: 50, size: 4.5, align: 'center' },
    sleeve:    { x: 82, y: 70, w: 22, size: 3,   align: 'center' }
  };
  function zoneFor(opt) {
    var z = (opt.zone || '').trim();
    if (ZONE_PRESETS[z]) return ZONE_PRESETS[z];
    var parts = z.split(',').map(function (n) { return parseFloat(n); });
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { x: parts[0], y: parts[1], w: (parts[2] || 50), size: 6, align: 'center' };
    }
    return null; // no overlay for this option
  }

  // ── Modal build ──────────────────────────────────────────────
  function open(product) {
    if (!product) return;
    close(); // ensure only one

    var values = {};
    (product.options || []).forEach(function (opt) {
      if (opt.type === 'checkbox') values[opt.key] = false;
      else if ((opt.type === 'style' || opt.type === 'producttype') && opt.choices && opt.choices.length) values[opt.key] = opt.choices[0].label;
      else values[opt.key] = '';
    });
    current = { product: product, values: values, artworkData: '' };

    overlay = document.createElement('div');
    overlay.className = 'customizer-modal';
    overlay.innerHTML =
      '<div class="customizer" role="dialog" aria-modal="true" aria-label="Customize ' + esc(product.name) + '">' +
        '<div class="customizer__head">' +
          '<h2 class="customizer__title">Customize</h2>' +
          '<button class="customizer__close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="customizer__cols">' +
          '<div class="customizer__preview">' +
            '<div class="customizer__stage" id="cz-stage">' +
              (previewImg(product)) +
              '<div class="customizer__overlays" id="cz-overlays"></div>' +
            '</div>' +
            '<p class="customizer__preview-note">Live preview — final artwork is arranged by our team.</p>' +
          '</div>' +
          '<div class="customizer__form" id="cz-form">' +
            (product.options || []).map(renderOption).join('') +
          '</div>' +
        '</div>' +
        '<div class="customizer__foot">' +
          '<div class="customizer__price"><span id="cz-price">' + money(unitCents(product, values)) + '</span></div>' +
          '<div class="customizer__qty">' +
            '<label>Qty</label>' +
            '<div class="store-card__qty-control" id="cz-qty" data-qty="1">' +
              '<button class="store-card__qty-btn" type="button" data-dir="-1" aria-label="Decrease">&minus;</button>' +
              '<span class="store-card__qty-value">1</span>' +
              '<button class="store-card__qty-btn" type="button" data-dir="1" aria-label="Increase">+</button>' +
            '</div>' +
          '</div>' +
          '<button class="customizer__add" id="cz-add">Add to Cart</button>' +
        '</div>' +
        '<p class="customizer__err" id="cz-err" hidden></p>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    wire();
    renderOverlays();
  }

  function previewImg(p) {
    var src = (p.image || (p.gallery && p.gallery[0]) || '');
    return src
      ? '<img class="customizer__product-img" src="' + esc(src) + '" alt="' + esc(p.name) + '">'
      : '<div class="customizer__product-ph">🎁</div>';
  }

  function renderOption(opt) {
    var id = 'cz-opt-' + esc(opt.key);
    var add = opt.priceAddCents ? ' <span class="customizer__addon">+' + money(opt.priceAddCents) + '</span>' : '';
    var req = opt.required ? ' <span class="customizer__req">*</span>' : '';
    var label = '<label class="customizer__label" for="' + id + '">' + esc(opt.label) + req + add + '</label>';

    if (opt.type === 'text') {
      var maxAttr = opt.maxChars ? ' maxlength="' + opt.maxChars + '"' : '';
      var counter = opt.maxChars ? '<span class="customizer__counter" data-counter-for="' + esc(opt.key) + '">0/' + opt.maxChars + '</span>' : '';
      return '<div class="customizer__field">' + label +
        '<input type="text" id="' + id + '" class="customizer__input" data-opt="' + esc(opt.key) + '" data-type="text"' + maxAttr + ' placeholder="Type here…">' +
        counter + '</div>';
    }
    if (opt.type === 'style' || opt.type === 'producttype') {
      var swatches = (opt.choices || []).map(function (c, i) {
        var inner = c.image
          ? '<img src="' + esc(c.image) + '" alt="' + esc(c.label) + '">'
          : '<span class="customizer__swatch-txt">' + esc(c.label) + '</span>';
        return '<button type="button" class="customizer__swatch' + (i === 0 ? ' is-selected' : '') + '" data-opt="' + esc(opt.key) + '" data-type="choice" data-value="' + esc(c.label) + '">' +
          inner + '<span class="customizer__swatch-label">' + esc(c.label) + '</span></button>';
      }).join('');
      return '<div class="customizer__field">' + label + '<div class="customizer__swatches">' + swatches + '</div></div>';
    }
    if (opt.type === 'image') {
      return '<div class="customizer__field">' + label +
        '<div class="customizer__upload" data-opt="' + esc(opt.key) + '">' +
          '<input type="file" id="' + id + '" accept="image/*" data-opt="' + esc(opt.key) + '" data-type="image" hidden>' +
          '<button type="button" class="customizer__upload-btn">Upload artwork</button>' +
          '<span class="customizer__upload-name"></span>' +
        '</div></div>';
    }
    if (opt.type === 'checkbox') {
      return '<div class="customizer__field customizer__field--check">' +
        '<label class="customizer__check"><input type="checkbox" id="' + id + '" data-opt="' + esc(opt.key) + '" data-type="checkbox"> ' + esc(opt.label) + req + add + '</label></div>';
    }
    return '';
  }

  // ── Live overlays ────────────────────────────────────────────
  function renderOverlays() {
    var host = overlay.querySelector('#cz-overlays');
    if (!host) return;
    var p = current.product, values = current.values;
    var html = '';
    (p.options || []).forEach(function (opt) {
      if (opt.type === 'text') {
        var z = zoneFor(opt);
        var txt = values[opt.key];
        if (z && txt && String(txt).trim()) {
          html += '<span class="customizer__ov-text" style="left:' + z.x + '%;top:' + z.y + '%;max-width:' + z.w + '%;font-size:' + z.size + 'cqw;text-align:' + z.align + ';">' + esc(txt) + '</span>';
        }
      }
    });
    if (current.artworkData) {
      html += '<img class="customizer__ov-art" src="' + current.artworkData + '" alt="">';
    }
    host.innerHTML = html;
  }

  function updatePrice() {
    var el = overlay.querySelector('#cz-price');
    if (el) el.textContent = money(unitCents(current.product, current.values));
  }

  // ── Wiring ───────────────────────────────────────────────────
  function wire() {
    overlay.querySelector('.customizer__close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', escHandler);

    // Text inputs
    overlay.querySelectorAll('input[data-type="text"]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        current.values[inp.dataset.opt] = inp.value;
        var counter = overlay.querySelector('[data-counter-for="' + inp.dataset.opt + '"]');
        if (counter && inp.maxLength > 0) counter.textContent = inp.value.length + '/' + inp.maxLength;
        renderOverlays();
        updatePrice();
      });
    });
    // Swatch pickers
    overlay.querySelectorAll('.customizer__swatch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.opt;
        current.values[key] = btn.dataset.value;
        overlay.querySelectorAll('.customizer__swatch[data-opt="' + key + '"]').forEach(function (b) { b.classList.remove('is-selected'); });
        btn.classList.add('is-selected');
        renderOverlays();
        updatePrice();
      });
    });
    // Checkboxes
    overlay.querySelectorAll('input[data-type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () { current.values[cb.dataset.opt] = cb.checked; updatePrice(); });
    });
    // Artwork upload
    overlay.querySelectorAll('input[data-type="image"]').forEach(function (fi) {
      var wrap = fi.closest('.customizer__upload');
      var btn = wrap && wrap.querySelector('.customizer__upload-btn');
      var nameEl = wrap && wrap.querySelector('.customizer__upload-name');
      if (btn) btn.addEventListener('click', function () { fi.click(); });
      fi.addEventListener('change', function () {
        var file = fi.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) { alert('Please choose an image under 3 MB.'); return; }
        var reader = new FileReader();
        reader.onload = function (ev) {
          current.artworkData = ev.target.result;
          current.values[fi.dataset.opt] = file.name;
          if (nameEl) nameEl.textContent = file.name;
          renderOverlays();
          updatePrice();
        };
        reader.readAsDataURL(file);
      });
    });
    // Qty
    var qtyCtrl = overlay.querySelector('#cz-qty');
    qtyCtrl.querySelectorAll('.store-card__qty-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = Math.max(1, Math.min(99, (parseInt(qtyCtrl.dataset.qty, 10) || 1) + parseInt(b.dataset.dir, 10)));
        qtyCtrl.dataset.qty = String(q);
        qtyCtrl.querySelector('.store-card__qty-value').textContent = q;
      });
    });
    // Add to cart
    overlay.querySelector('#cz-add').addEventListener('click', addToCart);
  }

  function addToCart() {
    var p = current.product, values = current.values;
    // Validate required options ("must customize before add to cart").
    var missing = (p.options || []).filter(function (opt) {
      if (!opt.required) return false;
      var v = values[opt.key];
      if (opt.type === 'checkbox') return !v;
      return !v || !String(v).trim();
    });
    if (missing.length) {
      showErr('Please complete: ' + missing.map(function (o) { return o.label; }).join(', '));
      return;
    }
    if (!window.STW_Cart) return;

    var qtyCtrl = overlay.querySelector('#cz-qty');
    var qty = parseInt(qtyCtrl.dataset.qty, 10) || 1;

    // Build a readable spec (only non-empty fields) keyed by option label.
    var spec = {};
    (p.options || []).forEach(function (opt) {
      var v = values[opt.key];
      if (v === '' || v === false || v == null) return;
      spec[opt.label] = (opt.type === 'checkbox') ? 'Yes' : v;
    });

    window.STW_Cart.add({
      productId: p.id,
      name: p.name + ' (Custom)',
      description: Object.keys(spec).map(function (k) { return k + ': ' + spec[k]; }).join(', '),
      image: (p.image || (p.gallery && p.gallery[0]) || ''),
      unitPriceCents: unitCents(p, values),
      qty: qty,
      isCustom: true,
      customizationId: 'cz' + Date.now().toString(36),
      customSpec: spec,
      artworkData: current.artworkData || ''
    });

    var addBtn = overlay.querySelector('#cz-add');
    addBtn.textContent = 'Added ✓';
    setTimeout(function () { close(); window.location.href = 'cart.html'; }, 650);
  }

  function showErr(msg) {
    var el = overlay.querySelector('#cz-err');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function escHandler(e) { if (e.key === 'Escape') close(); }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    current = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escHandler);
  }

  window.STW_Customizer = { open: open, close: close };
})();
