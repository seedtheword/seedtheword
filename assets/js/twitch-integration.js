/* ============================================================
   Twitch Live Status — glass styled
   No credentials: uses the Twitch public page to check live status.
   ============================================================ */

const TWITCH_CHANNEL = 'seedtheword';

class TwitchLiveCard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.isLive = false;
    this.init();
  }

  async init() {
    await this.checkLive();
    this.render();
    // Re-check every 5 minutes
    setInterval(async () => {
      const wasLive = this.isLive;
      await this.checkLive();
      if (wasLive !== this.isLive) this.render();
    }, 5 * 60 * 1000);
  }

  async checkLive() {
    // Primary: ask decapi.me (a free community Twitch-proxy) whether
    // the channel is live right now. Returns plain text like:
    //   "2 hours, 14 minutes"        → live, uptime as text
    //   "seedtheword is offline"     → offline
    //   "User not found"             → wrong channel name
    // Free, unauthenticated, rate-limited politely. If it ever goes
    // down or rate-limits us, we fall back to the schedule heuristic.
    try {
      const res = await fetch('https://decapi.me/twitch/uptime/' + TWITCH_CHANNEL, {
        cache: 'no-store',
      });
      if (res.ok) {
        const text = (await res.text()).trim().toLowerCase();
        // Decapi returns uptime text when live, or a string containing
        // "offline" / "not found" otherwise. Treat any explicit negative
        // as offline; everything else is considered live.
        const isNegative =
          text.includes('offline') ||
          text.includes('not found') ||
          text.includes('error') ||
          text === '';
        this.isLive = !isNegative;
        return;
      }
    } catch (_) {
      /* fall through to the schedule heuristic */
    }

    // Fallback heuristic: Saturday 7-10 PM Pacific is when we stream.
    // Used only when the decapi.me call above fails or rate-limits.
    const now = new Date();
    const dayPT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const day = dayPT.getDay();   // 0 = Sun, 6 = Sat
    const hour = dayPT.getHours();
    this.isLive = (day === 6 && hour >= 19 && hour < 22);
  }

  render() {
    this.container.innerHTML = this.isLive
      ? this.liveMarkup()
      : this.offlineMarkup();
  }

  liveMarkup() {
    return `
      <div class="livestream-card glass-morphism live">
        <div class="livestream-card__header">
          <span class="live-pill">
            <span class="live-pill__dot"></span>
            LIVE NOW
          </span>
          <h3 class="livestream-card__title">Study Saturday Live</h3>
        </div>
        <p class="livestream-card__desc">
          Join us right now for Bible study, fellowship, and prayer with members worldwide.
        </p>
        <div class="livestream-card__actions">
          <a href="https://twitch.tv/${TWITCH_CHANNEL}" target="_blank" rel="noopener" class="btn btn-primary">
            Watch on Twitch
          </a>
          <a href="https://t.me/seedtheword" target="_blank" rel="noopener" class="btn btn-telegram">
            Join Telegram
          </a>
        </div>
      </div>
    `;
  }

  offlineMarkup() {
    const next = this.getNextSaturday();
    const tonightSoon = this.isTonightBeforeLive();
    return `
      <div class="livestream-card glass-morphism offline">
        <div class="livestream-card__header">
          <span class="offline-pill">${tonightSoon ? 'TONIGHT' : 'OFFLINE'}</span>
          <h3 class="livestream-card__title">Study Saturday Live</h3>
        </div>
        <p class="livestream-card__desc">
          ${tonightSoon
            ? `We're going live <strong>tonight at 7:00 PM PT</strong> — Bible study,
               fellowship, and prayer with members worldwide. See you there.`
            : `Our weekly livestream returns <strong>${next}</strong> — Bible study,
               fellowship, and prayer with members worldwide.`}
        </p>
        <div class="livestream-card__actions">
          <a href="https://twitch.tv/${TWITCH_CHANNEL}" target="_blank" rel="noopener" class="btn btn-secondary">
            Follow on Twitch
          </a>
          <a href="https://t.me/seedtheword" target="_blank" rel="noopener" class="btn btn-telegram">
            Get Notified
          </a>
        </div>
      </div>
    `;
  }

  /** True when we're on a Saturday in PT but the 7 PM stream hasn't started yet. */
  isTonightBeforeLive() {
    const pt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    return pt.getDay() === 6 && pt.getHours() < 19;
  }

  getNextSaturday() {
    const now = new Date();
    const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const next = new Date(pt);
    const day = pt.getDay();
    const hour = pt.getHours();

    if (day === 6 && hour < 19) {
      // Saturday before 7 PM PT — stream is TODAY, not next week.
      // Keep `next` as today.
    } else if (day === 6 && hour >= 19 && hour < 22) {
      // Saturday during the live window — shouldn't reach here (we'd be in liveMarkup),
      // but if it does, fall through to today.
    } else {
      // Jump to the upcoming Saturday (1-7 days out).
      const diff = (6 - day + 7) % 7 || 7;
      next.setDate(next.getDate() + diff);
    }
    next.setHours(19, 0, 0, 0);
    return next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' at 7:00 PM PT';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TwitchLiveCard('livestream-card-container');
});
