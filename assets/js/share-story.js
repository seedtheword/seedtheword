/* ============================================================
   share-story.js

   Wires up the "Share your story" primary button on news.html to
   open a modal whose body iframes the Google Form URL declared in
   assets/data/media-drop.json. Falls back to a message with the
   email-the-team CTA when the form URL is not configured.

   The modal:
     - Traps focus inside the dialog while open
     - Closes on backdrop click, close button, or Escape key
     - Lazy-loads the iframe (only created on first open)
     - Does NOT navigate or expose the form URL until the admin has
       configured it (so a bad/stub URL never flashes into view)
   ============================================================ */

(function () {
  'use strict';

  const openBtn   = document.getElementById('share-story-open');
  const modal     = document.getElementById('share-story-modal');
  const backdrop  = document.getElementById('share-story-modal-backdrop');
  const closeBtn  = document.getElementById('share-story-modal-close');
  const body      = document.getElementById('share-story-modal-body');
  if (!openBtn || !modal || !body) return;

  let lastFocus = null;
  let loaded = false;

  async function loadFormUrl() {
    try {
      const resp = await fetch('assets/data/media-drop.json?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const cfg = await resp.json();
      if (!cfg || cfg.enabled === false) return null;
      const url = String(cfg.formUrl || cfg.uploadUrl || '').trim();
      if (!url) return null;
      if (/REPLACE_WITH/i.test(url)) return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  async function buildBodyOnce() {
    if (loaded) return;
    loaded = true;
    const url = await loadFormUrl();
    if (!url) {
      body.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'share-story__fallback';
      p.innerHTML =
        'Our upload form is still being wired up. In the meantime, please ' +
        '<a href="about.html#contact">email the team</a> ' +
        'or share through ' +
        '<a href="https://www.instagram.com/seedtheword/" target="_blank" rel="noopener">Instagram</a> or ' +
        '<a href="https://t.me/seedtheword" target="_blank" rel="noopener">Telegram</a>.';
      body.appendChild(p);
      return;
    }
    // Iframe the Google Form. The embed=true query is Google's standard
    // "show only the form, no header/footer chrome" toggle.
    const embedUrl = toEmbedUrl(url);
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.className = 'share-story-modal__iframe';
    iframe.setAttribute('title', 'Share your story with Seed the Word');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin');
    body.innerHTML = '';
    body.appendChild(iframe);
  }

  function toEmbedUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      // Prefer Google's /viewform?embedded=true format. If the URL is already a
      // /formResponse or uses the /viewform path, keep the path and set the flag.
      u.searchParams.set('embedded', 'true');
      // Kill utm-ish params that the form picker sometimes adds.
      u.searchParams.delete('usp');
      return u.toString();
    } catch (_) {
      return rawUrl;
    }
  }

  function openModal() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('share-story-modal-open');
    buildBodyOnce();
    // Focus the close button so keyboard users can dismiss quickly.
    setTimeout(() => closeBtn && closeBtn.focus(), 10);
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('share-story-modal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  openBtn.addEventListener('click', openModal);
  if (closeBtn)  closeBtn.addEventListener('click', closeModal);
  if (backdrop)  backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
})();
