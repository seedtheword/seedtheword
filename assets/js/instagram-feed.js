/* ============================================================
   Instagram Feed Reader
   Reads posts from assets/data/instagram.json (updated nightly
   by a GitHub Action that scrapes the public Instagram profile).
   ============================================================ */

const INSTAGRAM_HANDLE = 'seedtheword';
const DATA_URL = 'assets/data/instagram.json';

async function loadInstagramData() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Instagram feed unavailable:', err.message);
    return { updated: null, posts: [] };
  }
}

function renderInstagramGrid(container, posts) {
  if (!posts || posts.length === 0) {
    container.innerHTML = `
      <div class="ig-empty glass-morphism">
        <p>Instagram posts will appear here once they're synced.</p>
        <a href="https://www.instagram.com/${INSTAGRAM_HANDLE}/" target="_blank" rel="noopener" class="btn btn-instagram">
          Visit @${INSTAGRAM_HANDLE}
        </a>
      </div>
    `;
    return;
  }

  const items = posts.slice(0, 6).map(post => `
    <a class="ig-card glass-morphism" href="${post.url}" target="_blank" rel="noopener">
      <div class="ig-card__image" style="background-image: url('${post.thumbnail}')"></div>
      <div class="ig-card__body">
        <p class="ig-card__caption">${escapeHtml(truncate(post.caption, 120))}</p>
        <div class="ig-card__meta">
          <span>❤️ ${post.likes ?? 0}</span>
          <span>${formatDate(post.date)}</span>
        </div>
      </div>
    </a>
  `).join('');

  container.innerHTML = `<div class="ig-grid">${items}</div>`;
}

function renderFeaturedSlideshow(container, posts) {
  if (!posts || posts.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  // Top 5 by likes from the last 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const featured = posts
    .filter(p => new Date(p.date).getTime() >= cutoff)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, 5);

  if (featured.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  const slides = featured.map((post, i) => `
    <a class="featured-slide ${i === 0 ? 'active' : ''}"
       href="${post.url}" target="_blank" rel="noopener"
       data-slide="${i}"
       style="background-image: url('${post.thumbnail}')">
      <div class="featured-slide__overlay">
        <p class="featured-slide__caption">${escapeHtml(truncate(post.caption, 140))}</p>
        <div class="featured-slide__meta">
          <span>❤️ ${post.likes ?? 0}</span>
          <span>${formatDate(post.date)}</span>
        </div>
      </div>
    </a>
  `).join('');

  const dots = featured.map((_, i) => `
    <button class="featured-dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Slide ${i + 1}"></button>
  `).join('');

  container.innerHTML = `
    <div class="featured-slideshow glass-morphism">
      <div class="featured-slideshow__slides">${slides}</div>
      <div class="featured-slideshow__dots">${dots}</div>
    </div>
  `;

  // Basic auto-rotate
  let current = 0;
  const slideEls = container.querySelectorAll('.featured-slide');
  const dotEls = container.querySelectorAll('.featured-dot');

  function show(index) {
    slideEls.forEach((el, i) => el.classList.toggle('active', i === index));
    dotEls.forEach((el, i) => el.classList.toggle('active', i === index));
    current = index;
  }

  dotEls.forEach(dot => {
    dot.addEventListener('click', e => {
      e.preventDefault();
      show(parseInt(dot.dataset.index, 10));
    });
  });

  if (featured.length > 1) {
    setInterval(() => show((current + 1) % featured.length), 6000);
  }
}

// Utilities
function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Auto-init on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  const gridTarget = document.getElementById('instagram-grid-container');
  const featuredTarget = document.getElementById('featured-slideshow-container');

  if (!gridTarget && !featuredTarget) return;

  const data = await loadInstagramData();

  if (gridTarget) renderInstagramGrid(gridTarget, data.posts);
  if (featuredTarget) renderFeaturedSlideshow(featuredTarget, data.posts);
});
