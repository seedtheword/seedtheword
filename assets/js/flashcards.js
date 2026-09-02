/* ============================================================
   Seed the Word — Flashcard deck controller (shared)
   Progressive enhancement: the deck's cards exist in the HTML
   (so it reads fine without JS). This script turns them into a
   flip-to-memorize, swipeable, keyboard-navigable carousel.

   Markup contract:
   <section class="fc-deck" data-fc-deck>
     <article class="fc-card" data-title="Short label for overview">
       <div class="fc-face fc-face--front"> ...front... </div>
       <div class="fc-face fc-face--back"> ...back... </div>   (optional)
     </article>
     ... more cards ...
   </section>
   A card with only a front (no .fc-face--back) is a non-flip info/scripture card.
   ============================================================ */
(function () {
  'use strict';

  function initDeck(deck) {
    var cards = Array.prototype.slice.call(deck.querySelectorAll('.fc-card'));
    if (!cards.length) return;

    // Remove the no-JS fallback styling now that we're enhancing.
    deck.classList.remove('fc-nojs');

    var order = cards.map(function (_, i) { return i; });
    var pos = 0; // index into `order`

    // ── Build chrome (head + stage wrapper + nav + dots + overview) ──
    var head = document.createElement('div');
    head.className = 'fc-deck__head';
    head.innerHTML =
      '<span class="fc-deck__progress" data-fc-progress>1 / ' + cards.length + '</span>' +
      '<div class="fc-deck__tools">' +
        '<button type="button" class="fc-tool" data-fc-shuffle>🔀 Shuffle</button>' +
        '<button type="button" class="fc-tool" data-fc-restart>↺ Restart</button>' +
      '</div>';

    var stage = document.createElement('div');
    stage.className = 'fc-stage';
    // Move the cards into the stage (they start life as deck children).
    cards.forEach(function (c) { stage.appendChild(c); });

    var nav = document.createElement('div');
    nav.className = 'fc-nav';
    nav.innerHTML =
      '<button type="button" class="fc-arrow" data-fc-prev aria-label="Previous card">‹</button>' +
      '<button type="button" class="fc-nav__flip" data-fc-flip>Flip</button>' +
      '<button type="button" class="fc-arrow" data-fc-next aria-label="Next card">›</button>';

    var dots = document.createElement('div');
    dots.className = 'fc-dots';
    cards.forEach(function (_, i) {
      var d = document.createElement('button');
      d.type = 'button'; d.className = 'fc-dot'; d.setAttribute('aria-label', 'Go to card ' + (i + 1));
      d.addEventListener('click', function () { goToCardIndex(i); });
      dots.appendChild(d);
    });

    var overview = document.createElement('div');
    overview.className = 'fc-overview';
    cards.forEach(function (c, i) {
      var m = document.createElement('button');
      m.type = 'button'; m.className = 'fc-mini';
      m.textContent = c.getAttribute('data-title') || ('Card ' + (i + 1));
      m.addEventListener('click', function () { goToCardIndex(i); });
      overview.appendChild(m);
    });

    deck.insertBefore(head, deck.firstChild);
    deck.appendChild(stage);
    deck.appendChild(nav);
    deck.appendChild(dots);
    deck.appendChild(overview);

    var progressEl = head.querySelector('[data-fc-progress]');
    var flipBtn = nav.querySelector('[data-fc-flip]');
    var prevBtn = nav.querySelector('[data-fc-prev]');
    var nextBtn = nav.querySelector('[data-fc-next]');

    function currentCard() { return cards[order[pos]]; }
    function hasBack(card) { return !!card.querySelector('.fc-face--back'); }

    function render() {
      cards.forEach(function (c) { c.style.display = 'none'; c.classList.remove('is-flipped'); });
      var card = currentCard();
      card.style.display = '';
      progressEl.textContent = (pos + 1) + ' / ' + cards.length;
      prevBtn.disabled = pos === 0;
      nextBtn.disabled = pos === cards.length - 1;
      // Flip button only meaningful for two-sided cards.
      flipBtn.style.visibility = hasBack(card) ? 'visible' : 'hidden';
      flipBtn.textContent = 'Flip';
      // Dots
      Array.prototype.forEach.call(dots.children, function (d, i) {
        d.classList.toggle('is-active', i === order[pos]);
      });
      // Overview
      Array.prototype.forEach.call(overview.children, function (m, i) {
        m.classList.toggle('is-active', i === order[pos]);
      });
    }

    function goTo(newPos, dir) {
      if (newPos < 0 || newPos >= cards.length || newPos === pos) return;
      var outgoing = currentCard();
      outgoing.style.setProperty('--fc-slide', (dir < 0 ? '40px' : '-40px'));
      outgoing.classList.add('is-anim-out');
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var delay = reduce ? 0 : 170;
      setTimeout(function () {
        outgoing.classList.remove('is-anim-out');
        pos = newPos;
        render();
      }, delay);
    }
    function goToCardIndex(cardIdx) {
      var p = order.indexOf(cardIdx);
      if (p >= 0 && p !== pos) goTo(p, p > pos ? 1 : -1);
    }
    function next() { goTo(pos + 1, 1); }
    function prev() { goTo(pos - 1, -1); }
    function flip() {
      var card = currentCard();
      if (!hasBack(card)) return;
      var flipped = card.classList.toggle('is-flipped');
      dots.children[order[pos]].classList.toggle('is-flipped', flipped);
    }

    // ── Wire controls ──
    flipBtn.addEventListener('click', flip);
    nextBtn.addEventListener('click', next);
    prevBtn.addEventListener('click', prev);

    // Tap the card to flip (ignore clicks on links/buttons inside it).
    stage.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      flip();
    });

    head.querySelector('[data-fc-shuffle]').addEventListener('click', function () {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      pos = 0; render();
    });
    head.querySelector('[data-fc-restart]').addEventListener('click', function () {
      order = cards.map(function (_, i) { return i; }); pos = 0; render();
    });

    // Keyboard (when the deck is focused/hovered region). Global arrows + space.
    deck.setAttribute('tabindex', '0');
    deck.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    });

    // Swipe (mobile). Horizontal swipe = prev/next; a tap (small move) = flip.
    var sx = 0, sy = 0, moved = false;
    stage.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; moved = false;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        moved = true;
        if (dx < 0) next(); else prev();
      }
    }, { passive: true });

    render();
  }

  function boot() {
    document.querySelectorAll('[data-fc-deck]').forEach(initDeck);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
