/* ============================================================
   Telegram Member Count — scrapes the public t.me page
   ============================================================ */

const TG_HANDLE = 'seedtheword';
const CACHE_KEY = 'tgStatsCache-v1';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Best-effort public proxy so the browser can fetch telegram.org
// (the site itself doesn't send permissive CORS headers).
const PROXY_URL = (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`;
const SOURCE_URL = `https://t.me/${TG_HANDLE}`;

async function fetchTgStats() {
  // Try a cached value first
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.ts < CACHE_TTL_MS) {
        return cached.data;
      }
    }
  } catch (e) { /* ignore */ }

  try {
    const res = await fetch(PROXY_URL(SOURCE_URL), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const members = parseMembers(html);
    const online = parseOnline(html);

    const data = { members, online };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) { /* ignore */ }
    return data;
  } catch (err) {
    console.warn('Telegram stats unavailable:', err.message);
    return null;
  }
}

function parseMembers(html) {
  // Matches things like "32 members", "1 234 members", "1,234 members"
  const m = html.match(/([\d\s,]+)\s+members?/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[\s,]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseOnline(html) {
  // "6 online"
  const m = html.match(/([\d,]+)\s+online/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[\s,]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function renderStats(data) {
  const membersEl = document.getElementById('tg-stat-members');
  const onlineEl = document.getElementById('tg-stat-online');
  if (!membersEl || !onlineEl) return;

  if (!data) {
    membersEl.textContent = '—';
    onlineEl.textContent = '—';
    return;
  }

  if (data.members != null) {
    membersEl.textContent = data.members.toLocaleString();
  } else {
    membersEl.textContent = '—';
  }

  if (data.online != null && data.online > 0) {
    onlineEl.textContent = data.online.toLocaleString();
  } else {
    onlineEl.textContent = '—';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('telegram-stats')) return;
  const data = await fetchTgStats();
  renderStats(data);
});
