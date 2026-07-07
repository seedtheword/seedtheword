/* ============================================================
   donate-page.js — Interactive logic for the storytelling
   donate page redesign. Handles:
   1. Live stats fetch + counter animation
   2. Outreach card rendering from ministry-outreach.json
   3. Donation amount selector + Bible equivalence
   4. Copy-to-clipboard for Zelle
   5. IntersectionObserver scroll animations
   ============================================================ */
(function () {
  'use strict';

  var CACHE_KEY = 'stw_ministry_stats';
  var COST_PER_BIBLE = 2;
  var statsAnimated = false;

  // ── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function boot() {
    hydrateStatsFromCache();
    fetchLiveStats();
    fetchOutreachEvents();
    initDonationAmounts();
    initClipboard();
    initScrollAnimations();
    initStatsObserver();
  }

  // ── Stats: cache hydration ──────────────────────────────────
  function hydrateStatsFromCache() {
    try {
      var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      if (cached.total) {
        setCounterText('impact-count', cached.total);
      }
    } catch (_) {}
  }

  // ── Stats: live fetch ───────────────────────────────────────
  function fetchLiveStats() {
    fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (cfg) {
        var url = cfg.orderHandlerUrl || '';
        var fallback = typeof cfg.biblesGivenAway === 'number' ? cfg.biblesGivenAway : 123;
        if (!url) {
          setCounterText('impact-count', fallback);
          updateCache(fallback);
          return;
        }
        return fetch(url + '?action=getMinistryStats', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .then(function (live) {
            var count = (live.ok && live.total) ? live.total : fallback;
            updateCache(count);
            // If stats section is already visible, animate now
            if (statsAnimated) {
              animateCounter('impact-count', count);
            } else {
              // Store for later animation trigger
              window.__stwLiveCount = count;
            }
          })
          .catch(function () {
            setCounterText('impact-count', fallback);
            updateCache(fallback);
          });
      })
      .catch(function () {});
  }

  function updateCache(total) {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      c.total = total;
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (_) {}
  }

  function setCounterText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = Number(value).toLocaleString('en-US');
  }

  // ── Counter animation ───────────────────────────────────────
  function animateCounter(elementId, target, duration) {
    duration = duration || 1600;
    var el = document.getElementById(elementId);
    if (!el) return;

    var from = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
    if (from === target) {
      el.textContent = target.toLocaleString('en-US');
      return;
    }

    var start = performance.now();

    function step(now) {
      var progress = Math.min((now - start) / duration, 1);
      // Cubic ease-out
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (target - from) * eased);
      el.textContent = current.toLocaleString('en-US');

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target.toLocaleString('en-US');
      }
    }

    requestAnimationFrame(step);
  }

  // ── Stats IntersectionObserver ──────────────────────────────
  function initStatsObserver() {
    var section = document.getElementById('impact');
    if (!section || !window.IntersectionObserver) {
      // Fallback: animate immediately
      statsAnimated = true;
      if (window.__stwLiveCount) {
        animateCounter('impact-count', window.__stwLiveCount);
      }
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !statsAnimated) {
          statsAnimated = true;
          var target = window.__stwLiveCount ||
            parseInt(document.getElementById('impact-count').textContent.replace(/,/g, ''), 10) || 123;
          animateCounter('impact-count', target);
          // Animate events count too
          animateCounter('impact-events', 4, 1200);
          observer.disconnect();
        }
      });
    }, { threshold: 0.2 });

    observer.observe(section);
  }

  // ── Outreach events: fetch and render ───────────────────────
  function fetchOutreachEvents() {
    var container = document.getElementById('outreach-events');
    var section = document.querySelector('.donate-story-v2');
    if (!container || !section) return;

    fetch('assets/data/ministry-outreach.json?t=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.events || !data.events.length) {
          section.style.display = 'none';
          return;
        }
        renderOutreachCards(data.events.slice(0, 4), container);
        // Update events count
        var eventsEl = document.getElementById('impact-events');
        if (eventsEl) {
          window.__stwEventsCount = data.events.length;
          if (statsAnimated) {
            animateCounter('impact-events', data.events.length, 1200);
          }
        }
      })
      .catch(function () {
        section.style.display = 'none';
      });
  }

  function renderOutreachCards(events, container) {
    var html = events.map(function (event, index) {
      var isReversed = index % 2 === 1;
      var imageUrl = 'assets/images/ministry-outreach/' + escAttr(event.folder) + '/01.jpg';

      return '<article class="story-card' + (isReversed ? ' story-card--reversed' : '') + '"' +
        ' data-animate="fade-up">' +
        '<div class="story-card__image">' +
          '<img src="' + escAttr(imageUrl) + '"' +
          ' alt="' + escAttr(event.title) + '"' +
          ' loading="lazy"' +
          ' onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div class="story-card__content">' +
          '<span class="story-card__date">' + esc(event.date) + ' · ' + esc(event.location) + '</span>' +
          '<h3 class="story-card__title">' + esc(event.title) + '</h3>' +
          '<p class="story-card__body">' + esc(event.body) + '</p>' +
        '</div>' +
      '</article>';
    }).join('');

    container.innerHTML = html;

    // Register new elements for scroll animation
    var cards = container.querySelectorAll('[data-animate]');
    if (window.IntersectionObserver) {
      var cardObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            cardObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });

      cards.forEach(function (card) { cardObserver.observe(card); });
    } else {
      // Fallback: show all immediately
      cards.forEach(function (card) { card.classList.add('is-visible'); });
    }
  }

  // ── Donation amount selector ────────────────────────────────
  function initDonationAmounts() {
    var buttons = document.querySelectorAll('.donate-giving__amount');
    var equivDisplay = document.getElementById('bible-equiv-msg');
    var customWrap = document.getElementById('custom-amount-wrap');
    var customInput = document.getElementById('custom-amount-input');

    if (!buttons.length) return;

    function updateEquivalence(dollars) {
      if (!equivDisplay) return;
      if (!dollars || dollars <= 0) {
        equivDisplay.textContent = '';
        return;
      }
      var bibles = Math.floor(dollars / COST_PER_BIBLE);
      if (bibles > 0) {
        equivDisplay.textContent = 'Your gift of $' + dollars + ' provides ' + bibles + ' Bible' + (bibles !== 1 ? 's' : '') + ' to people who need them.';
      } else {
        equivDisplay.textContent = 'Every dollar brings us closer to our next Bible.';
      }
    }

    function selectButton(btn) {
      buttons.forEach(function (b) {
        b.classList.remove('is-selected');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed', 'true');

      var amount = btn.getAttribute('data-amount');
      if (amount === 'custom') {
        if (customWrap) customWrap.classList.add('is-visible');
        if (customInput) {
          customInput.focus();
          var val = parseInt(customInput.value, 10);
          updateEquivalence(val > 0 ? val : 0);
        }
      } else {
        if (customWrap) customWrap.classList.remove('is-visible');
        updateEquivalence(parseInt(amount, 10));
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectButton(btn);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectButton(btn);
        }
      });
    });

    if (customInput) {
      customInput.addEventListener('input', function () {
        var val = parseInt(customInput.value, 10);
        if (val > 0) {
          updateEquivalence(val);
        } else {
          if (equivDisplay) equivDisplay.textContent = '';
        }
      });
    }
  }

  // ── Clipboard (Zelle copy) ──────────────────────────────────
  function initClipboard() {
    var copyBtns = document.querySelectorAll('[data-copy]');
    copyBtns.forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var value = el.getAttribute('data-copy') || '';
        var label = el.querySelector('[data-copy-label]');

        function copyDone(ok) {
          if (!label) return;
          var original = label.getAttribute('data-original') || label.textContent;
          label.setAttribute('data-original', original);
          label.textContent = ok ? 'Copied! ✓' : 'Copy failed — long-press to copy';
          el.classList.add('is-copied');
          setTimeout(function () {
            label.textContent = original;
            el.classList.remove('is-copied');
          }, 2200);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value)
            .then(function () { copyDone(true); })
            .catch(function () { fallbackCopy(value, copyDone); });
        } else {
          fallbackCopy(value, copyDone);
        }
      });
    });
  }

  function fallbackCopy(value, callback) {
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      callback(ok);
    } catch (_) {
      callback(false);
    }
  }

  // ── Scroll animations (IntersectionObserver) ────────────────
  function initScrollAnimations() {
    if (!window.IntersectionObserver) {
      // No IO support: show everything
      var els = document.querySelectorAll('[data-animate]');
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    var animElements = document.querySelectorAll('[data-animate]');
    animElements.forEach(function (el) { observer.observe(el); });
  }

  // ── Helpers ─────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

})();
