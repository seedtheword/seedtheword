/* ============================================================
   Bundle card slideshows — store.html
   Reads each bundle's images.json manifest and rotates through
   the images on the card. Admins add new photos by uploading to
   the folder and appending an entry to images.json.
   ============================================================ */

const BUNDLE_ROTATE_MS = 5500;

async function initBundleSlideshow(el) {
  const key = el.dataset.bundle;
  if (!key) return;

  const manifestUrl = `assets/images/bundles/${key}/images.json?t=${Date.now()}`;
  let manifest;
  try {
    const res = await fetch(manifestUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.warn(`Bundle slideshow (${key}) could not load manifest:`, err.message);
    el.style.display = 'none';
    return;
  }

  const images = Array.isArray(manifest.images) ? manifest.images.filter(i => i && i.file) : [];
  if (!images.length) {
    el.style.display = 'none';
    return;
  }

  // Build slide elements
  el.innerHTML = images.map((img, i) => `
    <div class="bundle-slide ${i === 0 ? 'active' : ''}"
         data-index="${i}"
         style="background-image:url('assets/images/bundles/${key}/${encodeURIComponent(img.file)}')">
      <div class="bundle-slide__caption">${escapeHtml(img.caption || '')}</div>
    </div>
  `).join('') +
  `<div class="bundle-slide-dots">${images.map((_, i) =>
    `<button class="bundle-slide-dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Slide ${i + 1}"></button>`
  ).join('')}</div>`;

  // Only rotate if there's more than one slide
  if (images.length < 2) return;

  let current = 0;
  const slides = el.querySelectorAll('.bundle-slide');
  const dots = el.querySelectorAll('.bundle-slide-dot');

  function show(idx) {
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');
    current = idx;
    slides[current].classList.add('active');
    dots[current].classList.add('active');
  }

  const timer = setInterval(() => show((current + 1) % images.length), BUNDLE_ROTATE_MS);

  dots.forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      show(parseInt(dot.dataset.index, 10));
    });
  });

  // Pause on hover over the whole slideshow area
  el.addEventListener('mouseenter', () => clearInterval(timer));
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.bundle-slideshow').forEach(initBundleSlideshow);
});

// Expose globally so dynamically-injected bundle cards can re-init
window.initBundleSlideshows = function() {
  document.querySelectorAll('.bundle-slideshow:not([data-initialized])').forEach(function(el) {
    el.setAttribute('data-initialized', 'true');
    initBundleSlideshow(el);
  });
};
