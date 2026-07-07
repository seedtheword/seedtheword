/* ============================================================
   donate-page.js — Interactive logic for the storytelling
   donate page redesign. Handles:
   1. Live stats fetch + counter animation (ALL 3 stats)
   2. Outreach slideshow (full-size with text overlay)
   3. Donation amount selector + Bible equivalence + glow
   4. Copy-to-clipboard for Zelle
   5. IntersectionObserver scroll animations
   6. Receive a Bible form submission
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
    initOutreachSlideshow();
    initDonationAmounts();
    initClipboard();
    initScrollAnimations();
    initStatsObserver();
    initReceiveForm();
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
            if (statsAnimated) {
              animateCounter('impact-count', count);
            } else {
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
    if (el) {
      var plus = el.querySelector('.donate-impact__plus');
      el.textContent = Number(value).toLocaleString('en-US');
      if (plus) el.appendChild(plus);
    }
  }

  // ── Counter animation (cubic ease-out) ──────────────────────
  function animateCounter(elementId, target, duration) {
    duration = duration || 1600;
    var el = document.getElementById(elementId);
    if (!el) return;

    var plusSpan = el.querySelector('.donate-impact__plus');
    var from = parseInt(el.textContent.replace(/[,+]/g, ''), 10) || 0;
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
      animateCounter('impact-languages', 8, 1200);
      animateCounter('impact-events', 4, 1200);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !statsAnimated) {
          statsAnimated = true;
          var bibleTarget = window.__stwLiveCount ||
            parseInt(document.getElementById('impact-count').textContent.replace(/[,+]/g, ''), 10) || 123;
          animateCounter('impact-count', bibleTarget);
          animateCounter('impact-languages', 8, 1200);
          var eventsTarget = window.__stwEventsCount || 4;
          animateCounter('impact-events', eventsTarget, 1200);
          observer.disconnect();
        }
      });
    }, { threshold: 0.2 });

    observer.observe(section);
  }

  // ── Outreach Slideshow (homepage-style) ─────────────────────
  function initOutreachSlideshow() {
    var track = document.getElementById('oss-track');
    var dotsWrap = document.getElementById('oss-dots');
    if (!track || !dotsWrap) return;

    fetch('assets/data/ministry-outreach.json?t=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.events || !data.events.length) {
          var wrapper = document.getElementById('outreach-slideshow');
          if (wrapper) wrapper.style.display = 'none';
          return;
        }
        buildSlideshow(data.events, track, dotsWrap);
      })
      .catch(function () {
        var wrapper = document.getElementById('outreach-slideshow');
        if (wrapper) wrapper.style.display = 'none';
      });
  }

  function buildSlideshow(events, track, dotsWrap) {
    // Build slides
    var html = events.map(function (ev, i) {
      var imgSrc = 'assets/images/ministry-outreach/' + ev.folder + '/01.jpg';
      return '<div class="oss-track__item' + (i === 0 ? ' is-active' : '') + '">' +
        '<img src="' + escAttr(imgSrc) + '" alt="' + escAttr(ev.title) + '" loading="' + (i === 0 ? 'eager' : 'lazy') + '">' +
        '<div class="oss-track__overlay"></div>' +
        '<div class="oss-track__caption">' +
          '<h3 class="oss-track__caption-title">' + esc(ev.title) + '</h3>' +
          '<p class="oss-track__caption-meta">' + esc(ev.date) + ' · ' + esc(ev.location) + '</p>' +
          '<p class="oss-track__caption-body">' + esc(ev.body) + '</p>' +
        '</div>' +
      '</div>';
    }).join('');
    track.innerHTML = html;

    // Build dots
    var dotsHtml = events.map(function (_, i) {
      return '<button type="button" class="oss-dots__dot' + (i === 0 ? ' is-active' : '') + '" data-idx="' + i + '" aria-label="Show slide ' + (i + 1) + '"></button>';
    }).join('');
    dotsWrap.innerHTML = dotsHtml;

    var slides = track.querySelectorAll('.oss-track__item');
    var dots = dotsWrap.querySelectorAll('.oss-dots__dot');
    var current = 0;
    var total = slides.length;

    function goTo(idx) {
      slides[current].classList.remove('is-active');
      dots[current].classList.remove('is-active');
      current = idx;
      slides[current].classList.add('is-active');
      dots[current].classList.add('is-active');
    }

    // Dot clicks
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var idx = parseInt(dot.getAttribute('data-idx'), 10);
        if (idx !== current) {
          goTo(idx);
          resetInterval();
        }
      });
    });

    // Auto-advance
    var timer = setInterval(function () {
      goTo((current + 1) % total);
    }, 5000);

    function resetInterval() {
      clearInterval(timer);
      timer = setInterval(function () {
        goTo((current + 1) % total);
      }, 5000);
    }

    // Update events count for stats
    window.__stwEventsCount = events.length;
    if (statsAnimated) {
      animateCounter('impact-events', events.length, 1200);
    }
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

    var animElements = document.querySelectorAll('[data-animate]');
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
      var language = form.querySelector('#receive-language').value;
      var address = form.querySelector('#receive-address').value.trim();

      if (!name || !email || !language || !address) {
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

          var params = new URLSearchParams();
          params.append('action', 'receiveBible');
          params.append('name', name);
          params.append('email', email);
          params.append('language', language);
          params.append('address', address);

          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
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

})();
