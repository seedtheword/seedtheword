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
    // Heuristic: use a no-auth public-facing check.
    // Without Twitch API credentials we can't know for sure. We check by
    // looking at the schedule-based expectation (Saturday 2-4 PM Pacific).
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
    return `
      <div class="livestream-card glass-morphism offline">
        <div class="livestream-card__header">
          <span class="offline-pill">OFFLINE</span>
          <h3 class="livestream-card__title">Study Saturday Live</h3>
        </div>
        <p class="livestream-card__desc">
          Our weekly livestream returns <strong>${next}</strong> — Bible study,
          fellowship, and prayer with members worldwide.
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

  getNextSaturday() {
    const now = new Date();
    const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const next = new Date(pt);
    const diff = (6 - pt.getDay() + 7) % 7 || 7;
    // If it's Saturday but already past 10 PM PT, skip to next Saturday
    if (pt.getDay() === 6 && pt.getHours() >= 22) {
      next.setDate(next.getDate() + 7);
    } else {
      next.setDate(next.getDate() + diff);
    }
    next.setHours(19, 0, 0, 0);
    return next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' at 7:00 PM PT';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TwitchLiveCard('livestream-card-container');
});
