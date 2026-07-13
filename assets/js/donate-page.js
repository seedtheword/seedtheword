/* ============================================================
   donate-page.js — Interactive logic for the storytelling
   donate page redesign. Handles:
   1. Live stats fetch + counter animation (ALL 3 stats)
   2. Outreach story cards with per-card slideshows
   3. Donation amount selector + Bible equivalence + glow
   4. Copy-to-clipboard for Zelle
   5. IntersectionObserver scroll animations
   6. Receive a Bible modal form
   7. Dynamic language population from site-config
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
    initStoryCards();
    initDonationAmounts();
    initClipboard();
    initScrollAnimations();
    initStatsObserver();
    initReceiveModal();
    initReceiveForm();
  }

  // ── Modal: Receive a Bible ──────────────────────────────────
  function initReceiveModal() {
    var modal = document.getElementById('receive-bible');
    var openBtn = document.querySelector('[data-open-receive]');
    var closeBtn = modal ? modal.querySelector('.donate-receive-form__close') : null;

    if (!modal || !openBtn) return;

    function openModal(e) {
      if (e) e.preventDefault();
      modal.classList.add('is-open');
      document.body.classList.add('modal-open');
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      modal.classList.remove('is-open');
      document.body.classList.remove('modal-open');
      openBtn.focus();
    }

    openBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) {
        closeModal();
      }
    });
  }


  // ── Dynamic Language Population ─────────────────────────────
  function populateLanguages(biblesInStock) {
    var select = document.getElementById('receive-language');
    if (!select || !biblesInStock || !biblesInStock.length) return;

    var available = biblesInStock.filter(function (item) {
      return item.count > 0;
    });
    if (!available.length) return; // keep static fallback

    // Clear existing options and rebuild
    select.innerHTML = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a language';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    available.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.language;
      opt.textContent = item.language;
      select.appendChild(opt);
    });
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
        // Populate languages dynamically
        if (cfg.biblesInStock) {
          populateLanguages(cfg.biblesInStock);
          // Update languages count for stats
          var inStockCount = cfg.biblesInStock.filter(function (b) { return b.count > 0; }).length;
          window.__stwLanguagesCount = inStockCount;
          if (statsAnimated) {
            animateCounter('impact-languages', inStockCount, 1200);
          }
        }

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
            if (statsAnimated) {
              animateCounter('impact-count', count);
            } else {
              window.__stwLiveCount = count;
            }
            // Update events from live data
            if (live.events) {
              window.__stwEventsCount = live.events;
              if (statsAnimated) animateCounter('impact-events', live.events, 1200);
            }
            // Update languages from live inStock
            if (live.inStock && live.inStock.length) {
              populateLanguages(live.inStock);
              var liveInStockCount = live.inStock.filter(function(b) { return b.count > 0; }).length;
              window.__stwLanguagesCount = liveInStockCount;
              if (statsAnimated) animateCounter('impact-languages', liveInStockCount, 1200);
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
    if (el) {
      var plus = el.querySelector('.donate-impact__plus');
      el.textContent = Number(value).toLocaleString('en-US');
      if (plus) el.appendChild(plus);
    }
  }


  // ── Counter animation (cubic ease-out) — FIXED ──────────────
  function animateCounter(elementId, target, duration) {
    duration = duration || 1600;
    var el = document.getElementById(elementId);
    if (!el) return;

    // FIX: Store plus span reference BEFORE reading textContent
    var plusSpan = el.querySelector('.donate-impact__plus');

    // Reset to 0, preserving the plus span
    el.textContent = '0';
    if (plusSpan) el.appendChild(plusSpan);

    var from = 0;
    if (from === target) {
      el.textContent = target.toLocaleString('en-US');
      if (plusSpan) el.appendChild(plusSpan);
      return;
    }

    var start = performance.now();

    function step(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (target - from) * eased);
      el.textContent = current.toLocaleString('en-US');
      if (plusSpan) el.appendChild(plusSpan);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = target.toLocaleString('en-US');
        if (plusSpan) el.appendChild(plusSpan);
      }
    }

    requestAnimationFrame(step);
  }

  // ── Stats IntersectionObserver — animates ALL 3 stats ──────
  function initStatsObserver() {
    var section = document.getElementById('impact');
    if (!section || !window.IntersectionObserver) {
      statsAnimated = true;
      if (window.__stwLiveCount) animateCounter('impact-count', window.__stwLiveCount);
      animateCounter('impact-languages', window.__stwLanguagesCount || 6, 1200);
      animateCounter('impact-events', window.__stwEventsCount || 4, 1200);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !statsAnimated) {
          statsAnimated = true;
          var bibleTarget = window.__stwLiveCount ||
            parseInt(document.getElementById('impact-count').textContent.replace(/[,+\s]/g, ''), 10) || 123;
          animateCounter('impact-count', bibleTarget);
          var langTarget = window.__stwLanguagesCount || 6;
          animateCounter('impact-languages', langTarget, 1200);
          var eventsTarget = window.__stwEventsCount || 4;
          animateCounter('impact-events', eventsTarget, 1200);
          observer.disconnect();
        }
      });
    }, { threshold: 0.2 });

    observer.observe(section);
  }


  // ── Story Cards with individual slideshows ─────────────────
  function initStoryCards() {
    var container = document.getElementById('story-events');
    if (!container) return;

    fetch('assets/data/ministry-outreach.json?t=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.events || !data.events.length) return;
        buildStoryCards(data.events, container);
        // Update events count for stats
        window.__stwEventsCount = data.events.length;
        if (statsAnimated) {
          animateCounter('impact-events', data.events.length, 1200);
        }
      })
      .catch(function () {});
  }

  function buildStoryCards(events, container) {
    var html = events.map(function (ev, i) {
      var reversed = i % 2 !== 0 ? ' story-card--reversed' : '';
      return '<div class="story-card' + reversed + '" data-animate>' +
        '<div class="story-card__image">' +
          '<div class="story-card__slideshow" data-folder="' + escAttr(ev.folder) + '">' +
            '<img class="is-active" src="assets/images/ministry-outreach/' + escAttr(ev.folder) + '/01.jpg" alt="' + escAttr(ev.title) + '">' +
          '</div>' +
          '<div class="story-card__dots"></div>' +
        '</div>' +
        '<div class="story-card__content">' +
          '<span class="story-card__date">' + esc(ev.date) + (ev.location ? ' · ' + esc(ev.location) : '') + '</span>' +
          '<h3 class="story-card__title">' + esc(ev.title) + '</h3>' +
          '<p class="story-card__body">' + esc(ev.body) + '</p>' +
        '</div>' +
      '</div>';
    }).join('');
    container.innerHTML = html;

    // Load images.json for each card and build per-card slideshow
    var slideshows = container.querySelectorAll('.story-card__slideshow');
    slideshows.forEach(function (ss) {
      var folder = ss.getAttribute('data-folder');
      loadCardSlideshow(ss, folder);
    });

    // Re-init scroll animations for new cards
    initScrollAnimations();

    // Fix: after dynamic content loads, re-scroll to hash target
    // (story cards push sections below them further down the page)
    correctHashScroll();
  }

  function loadCardSlideshow(slideEl, folder) {
    var dotsContainer = slideEl.parentElement.querySelector('.story-card__dots');
    fetch('assets/images/ministry-outreach/' + folder + '/images.json?t=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (manifest) {
        if (!manifest || !manifest.images || manifest.images.length < 2) return;

        var images = manifest.images;
        // Build all image elements
        var imgHtml = images.map(function (img, i) {
          var src = 'assets/images/ministry-outreach/' + folder + '/' + img.file;
          return '<img class="' + (i === 0 ? 'is-active' : '') + '" src="' + escAttr(src) + '" alt="' + escAttr(img.alt || folder + ' photo ' + (i + 1)) + '" loading="lazy">';
        }).join('');
        slideEl.innerHTML = imgHtml;

        // Build dots
        var dotsHtml = images.map(function (_, i) {
          return '<button type="button" class="story-card__dot' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '" aria-label="Show photo ' + (i + 1) + '"></button>';
        }).join('');
        if (dotsContainer) dotsContainer.innerHTML = dotsHtml;

        // Slideshow logic
        var imgEls = slideEl.querySelectorAll('img');
        var dots = dotsContainer ? dotsContainer.querySelectorAll('.story-card__dot') : [];
        var current = 0;
        var total = imgEls.length;

        function goTo(idx) {
          imgEls[current].classList.remove('is-active');
          if (dots[current]) dots[current].classList.remove('is-active');
          current = idx;
          imgEls[current].classList.add('is-active');
          if (dots[current]) dots[current].classList.add('is-active');
        }

        // Dot clicks
        dots.forEach(function (dot) {
          dot.addEventListener('click', function () {
            var idx = parseInt(dot.getAttribute('data-idx'), 10);
            if (idx !== current) { goTo(idx); resetTimer(); }
          });
        });

        // Auto-advance every 3.5s
        var timer = setInterval(function () {
          goTo((current + 1) % total);
        }, 3500);

        function resetTimer() {
          clearInterval(timer);
          timer = setInterval(function () {
            goTo((current + 1) % total);
          }, 3500);
        }
      })
      .catch(function () { /* keep single image fallback */ });
  }


  // ── Donation amount selector + glow ─────────────────────────
  function initDonationAmounts() {
    var buttons = document.querySelectorAll('.donate-giving__amount');
    var equivDisplay = document.getElementById('bible-equiv-msg');
    var customWrap = document.getElementById('custom-amount-wrap');
    var customInput = document.getElementById('custom-amount-input');
    var methodsWrap = document.querySelector('.donate-giving__methods');

    if (!buttons.length) return;

    function updateEquivalence(dollars) {
      if (!equivDisplay) return;
      if (!dollars || dollars <= 0) {
        equivDisplay.textContent = '';
        return;
      }
      var bibles = Math.floor(dollars / COST_PER_BIBLE);
      if (bibles > 0) {
        equivDisplay.textContent = 'Your $' + dollars + ' supports ' + bibles + ' Bible' + (bibles !== 1 ? 's' : '') + ' and our outreach mission.';
      } else {
        equivDisplay.textContent = 'Every dollar brings us closer to our next Bible.';
      }
    }

    function setGlow(active) {
      if (!methodsWrap) return;
      if (active) {
        methodsWrap.classList.add('is-glowing');
      } else {
        methodsWrap.classList.remove('is-glowing');
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
          setGlow(val > 0);
        }
      } else {
        if (customWrap) customWrap.classList.remove('is-visible');
        updateEquivalence(parseInt(amount, 10));
        setGlow(true);
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () { selectButton(btn); });
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
          setGlow(true);
        } else {
          if (equivDisplay) equivDisplay.textContent = '';
          setGlow(false);
        }
      });
      customInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var val = parseInt(customInput.value, 10);
          if (val > 0) {
            window.open('https://venmo.com/u/Vanessamind', '_blank');
          }
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

    var animElements = document.querySelectorAll('[data-animate]:not(.is-visible)');
    animElements.forEach(function (el) { observer.observe(el); });
  }


  // ── Receive a Bible form ─────────────────────────────────────
  function initReceiveForm() {
    var form = document.getElementById('receive-bible-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('receive-form-status');
      var submitBtn = form.querySelector('.donate-receive-form__submit');

      var name = form.querySelector('#receive-name').value.trim();
      var email = form.querySelector('#receive-email').value.trim();
      var phone = form.querySelector('#receive-phone') ? form.querySelector('#receive-phone').value.trim() : '';
      var language = form.querySelector('#receive-language').value;
      var city = form.querySelector('#receive-city') ? form.querySelector('#receive-city').value.trim() : '';
      var state = form.querySelector('#receive-state') ? form.querySelector('#receive-state').value : '';
      var zip = form.querySelector('#receive-zip') ? form.querySelector('#receive-zip').value.trim() : '';
      var story = form.querySelector('#receive-story') ? form.querySelector('#receive-story').value.trim() : '';
      var wantPrayer = form.querySelector('[name="wantPrayer"]') ? form.querySelector('[name="wantPrayer"]').checked : false;
      var wantStudy = form.querySelector('[name="wantStudy"]') ? form.querySelector('[name="wantStudy"]').checked : false;
      var wantVolunteer = form.querySelector('[name="wantVolunteer"]') ? form.querySelector('[name="wantVolunteer"]').checked : false;
      var wantSupport = form.querySelector('[name="wantSupport"]') ? form.querySelector('[name="wantSupport"]').checked : false;

      if (!name || !email || !language || !city || !story) {
        if (status) {
          status.textContent = 'Please fill in all fields.';
          status.className = 'donate-receive-form__status is-error';
        }
        return;
      }

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }
      if (status) { status.textContent = ''; status.className = 'donate-receive-form__status'; }

      fetch('assets/data/site-config.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (cfg) {
          var url = cfg.orderHandlerUrl;
          if (!url) throw new Error('No handler URL configured');

          var body = JSON.stringify({
            action: 'requestBible',
            name: name,
            email: email,
            phone: phone,
            city: city,
            state: state,
            zip: zip,
            language: language,
            story: story,
            interests: [
              wantPrayer ? 'prayer' : '',
              wantStudy ? 'study' : '',
              wantVolunteer ? 'volunteer' : '',
              wantSupport ? 'support' : ''
            ].filter(Boolean).join(',')
          });

          return fetch(url, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: body
          });
        })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.ok || res.success) {
            if (status) {
              status.textContent = '🎉 Your Bible is on its way! Check your email for confirmation.';
              status.className = 'donate-receive-form__status is-success';
            }
            form.reset();
            // Show contextual recommendations based on interests
            var recommendations = [];
            if (wantPrayer) recommendations.push('<a href="https://t.me/seedtheword" target="_blank" rel="noopener" style="color:var(--green);font-weight:600;">Join our Telegram prayer community →</a>');
            if (wantStudy) recommendations.push('<a href="https://www.instagram.com/seedtheword/" target="_blank" rel="noopener" style="color:var(--green);font-weight:600;">Follow us on Instagram for Bible study announcements →</a>');
            if (wantVolunteer) recommendations.push('<span style="color:var(--green);font-weight:600;">We\'ll reach out about volunteer opportunities!</span>');
            if (wantSupport) recommendations.push('<a href="#give" style="color:var(--gold);font-weight:600;">See ways to support the mission →</a>');
            if (recommendations.length && status) {
              status.innerHTML += '<div style="margin-top:0.75rem;font-size:0.88rem;line-height:1.8;">' + recommendations.join('<br>') + '</div>';
            }
            // If they want to support, scroll to giving after a short delay
            if (wantSupport) {
              setTimeout(function() {
                var giveSection = document.getElementById('give');
                if (giveSection) {
                  // Close the modal first
                  var modal = document.getElementById('receive-bible');
                  if (modal) { modal.classList.remove('is-open'); document.body.classList.remove('modal-open'); }
                  giveSection.scrollIntoView({ behavior: 'smooth' });
                }
              }, 3000);
            }
          } else {
            throw new Error(res.error || 'Something went wrong');
          }
        })
        .catch(function (err) {
          if (status) {
            status.textContent = err.message || 'Something went wrong. Please try again.';
            status.className = 'donate-receive-form__status is-error';
          }
        })
        .finally(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send My Free Bible →'; }
        });
    });
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

  // ── Hash scroll correction ──────────────────────────────────
  // After dynamic content (story cards) finishes loading and pushes
  // sections further down, re-scroll to the URL hash target so that
  // e.g. donate.html#give lands on the actual Giving section.
  function correctHashScroll() {
    var hash = window.location.hash;
    if (!hash) return;
    // Small delay to let layout settle after DOM injection
    setTimeout(function () {
      var target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  }

})();
