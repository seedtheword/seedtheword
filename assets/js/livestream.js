/* ============================================================
   Live Stream Integration
   ============================================================ */

class LiveStreamManager {
  constructor() {
    this.twitchChannel = 'seedtheword'; // Replace with your actual Twitch channel
    this.youtubeChannelId = 'YOUR_YOUTUBE_CHANNEL_ID'; // Replace with your YouTube channel ID
    this.checkInterval = 60000; // Check every minute
    this.isLive = false;
    
    this.init();
  }
  
  async init() {
    await this.checkLiveStatus();
    this.startPeriodicCheck();
    this.updateUI();
  }
  
  async checkLiveStatus() {
    try {
      // Check if we have live stream data from CMS
      const cmsData = await this.fetchCMSLiveStatus();
      if (cmsData && cmsData.is_live) {
        this.isLive = true;
        this.liveData = cmsData;
        return;
      }
      
      // Fallback: Check Twitch API (requires backend proxy due to CORS)
      // For now, we'll use the CMS data as the source of truth
      this.isLive = false;
      
    } catch (error) {
      console.log('Could not check live status:', error);
      this.isLive = false;
    }
  }
  
  async fetchCMSLiveStatus() {
    try {
      // Fetch from the CMS data file
      const response = await fetch('/site/_data/livestream.json');
      if (!response.ok) throw new Error('CMS data not available');
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.log('CMS livestream data not available, using fallback');
      // Fallback data structure
      return {
        is_live: false,
        title: 'Study Saturday Live',
        twitch_url: 'https://twitch.tv/seedtheword',
        youtube_url: '',
        started_at: new Date().toISOString()
      };
    }
  }
  
  updateUI() {
    // Update live status badges in announcements
    const liveItems = document.querySelectorAll('.announcement-item');
    liveItems.forEach(item => {
      const title = item.querySelector('h4');
      const status = item.querySelector('.announcement-item__status');
      
      if (title && title.textContent.includes('Study Saturday') && this.isLive) {
        status.className = 'announcement-item__status';
        status.innerHTML = '🔴 LIVE NOW';
        item.className = 'announcement-item live';
        
        // Update button to go to live stream
        const button = item.querySelector('.btn');
        if (button && this.liveData) {
          button.textContent = 'Watch Live';
          button.href = this.liveData.twitch_url || this.liveData.youtube_url;
          button.target = '_blank';
        }
      }
    });
    
    // Update calendar if available
    if (window.ministryCalendar) {
      window.ministryCalendar.updateLiveStatus(this.isLive);
    }
    
    // Update any live stream embeds
    this.updateStreamEmbeds();
  }
  
  updateStreamEmbeds() {
    const streamContainer = document.getElementById('live-stream-container');
    if (!streamContainer) return;
    
    if (this.isLive && this.liveData) {
      streamContainer.innerHTML = `
        <div class="live-stream-embed">
          <div class="stream-header">
            <h3>🔴 Live Now: ${this.liveData.title}</h3>
            <div class="stream-engagement">
              <span class="live-indicator">LIVE</span>
              <span class="viewer-count" id="viewer-count">• Join the conversation</span>
            </div>
          </div>
          
          <div class="stream-player-container">
            <iframe 
              src="https://player.twitch.tv/?channel=${this.twitchChannel}&parent=${window.location.hostname}"
              height="400"
              width="100%"
              allowfullscreen>
            </iframe>
            
            <!-- Interactive Stream Overlays -->
            <div class="stream-overlays" id="stream-overlays">
              <!-- These will be populated by showStreamOverlay() -->
            </div>
          </div>
          
          <div class="stream-info">
            <div class="stream-description">
              <p><strong>What to Expect:</strong> Bible study, fellowship, prayer, and community discussion. We review weekly readings, share testimonies, and pray for member requests.</p>
            </div>
            
            <div class="stream-engagement-panel">
              <div class="engagement-section">
                <h4>📖 Today's Focus</h4>
                <p>New Testament reading • Community prayer • Testimony sharing</p>
              </div>
              
              <div class="engagement-section">
                <h4>💬 Join the Conversation</h4>
                <div class="engagement-buttons">
                  <a href="https://t.me/seedtheword" target="_blank" class="btn btn-telegram btn-sm">
                    <span>💬</span> Chat on Telegram
                  </a>
                  <a href="#prayer-request" class="btn btn-secondary btn-sm" onclick="showPrayerForm()">
                    <span>🙏</span> Prayer Request
                  </a>
                  <a href="store.html" class="btn btn-gold btn-sm">
                    <span>📖</span> Get Your Bible
                  </a>
                </div>
              </div>
            </div>
          </div>
          
          <div class="stream-links">
            <a href="${this.liveData.twitch_url}" target="_blank" class="btn btn-primary">
              <span>📺</span> Watch on Twitch
            </a>
            ${this.liveData.youtube_url ? `<a href="${this.liveData.youtube_url}" target="_blank" class="btn btn-secondary"><span>▶️</span> Watch on YouTube</a>` : ''}
            <a href="about.html#contact" class="btn btn-green-call">
              <span>❤️</span> Support Ministry
            </a>
          </div>
        </div>
      `;
      
      // Start showing periodic overlays
      this.startStreamOverlays();
    } else {
      streamContainer.innerHTML = `
        <div class="stream-offline">
          <div class="offline-content">
            <h3>📺 Next Live Stream</h3>
            <div class="next-stream-info">
              <div class="stream-schedule">
                <h4>🗓️ Study Saturday Live</h4>
                <p><strong>Every Saturday at 2:00 PM PST</strong></p>
                <p>Bible study • Fellowship • Prayer • Community discussion</p>
              </div>
              
              <div class="stream-preview">
                <h4>📋 What We Cover</h4>
                <ul class="stream-agenda">
                  <li><span>📖</span> Weekly Bible reading review</li>
                  <li><span>💭</span> Community discussion & insights</li>
                  <li><span>🙏</span> Prayer requests & thanksgiving</li>
                  <li><span>❤️</span> Testimony sharing</li>
                  <li><span>📞</span> Ministry updates & calls to serve</li>
                </ul>
              </div>
              
              <div class="offline-actions">
                <a href="https://t.me/seedtheword" target="_blank" class="btn btn-telegram">
                  <span>🔔</span> Get Notified
                </a>
                <a href="store.html" class="btn btn-gold">
                  <span>📖</span> Browse Bible Bundles
                </a>
                <a href="about.html#contact" class="btn btn-secondary">
                  <span>🙏</span> Submit Prayer Request
                </a>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }
  
  startStreamOverlays() {
    // Show periodic overlays during live stream (like news broadcasting)
    const overlayInterval = setInterval(() => {
      if (!this.isLive) {
        clearInterval(overlayInterval);
        return;
      }
      
      const overlays = [
        {
          type: 'bible-bundle',
          title: '📖 Customize Your Bible Bundle',
          message: 'Starting at just $2 - personalized for newcomers to faith',
          button: 'Browse Bundles',
          link: 'store.html'
        },
        {
          type: 'testimony',
          title: '❤️ Share Your Testimony',
          message: 'How has God\'s Word impacted your life?',
          button: 'Share Story',
          link: 'about.html#contact'
        },
        {
          type: 'prayer',
          title: '🙏 Prayer & Thanksgiving',
          message: 'Submit your prayer needs - our community prays together',
          button: 'Prayer Request',
          link: 'about.html#contact'
        },
        {
          type: 'community',
          title: '💬 Join Our Community',
          message: 'Daily Bible reading & encouragement on Telegram',
          button: 'Join Telegram',
          link: 'https://t.me/seedtheword'
        }
      ];
      
      const randomOverlay = overlays[Math.floor(Math.random() * overlays.length)];
      this.showStreamOverlay(randomOverlay);
    }, 45000); // Show overlay every 45 seconds
  }
  
  showStreamOverlay(overlay) {
    const overlaysContainer = document.getElementById('stream-overlays');
    if (!overlaysContainer) return;
    
    const overlayEl = document.createElement('div');
    overlayEl.className = `stream-overlay stream-overlay--${overlay.type}`;
    overlayEl.innerHTML = `
      <div class="stream-overlay__content">
        <button class="stream-overlay__close" onclick="this.parentElement.parentElement.remove()">&times;</button>
        <h4 class="stream-overlay__title">${overlay.title}</h4>
        <p class="stream-overlay__message">${overlay.message}</p>
        <a href="${overlay.link}" target="_blank" class="btn btn-primary btn-sm stream-overlay__button">
          ${overlay.button}
        </a>
      </div>
    `;
    
    overlaysContainer.appendChild(overlayEl);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (overlayEl.parentElement) {
        overlayEl.classList.add('fade-out');
        setTimeout(() => overlayEl.remove(), 500);
      }
    }, 8000);
  }
  
  startPeriodicCheck() {
    setInterval(() => {
      this.checkLiveStatus().then(() => {
        this.updateUI();
      });
    }, this.checkInterval);
  }
  
  // Manual methods for CMS integration
  setLiveStatus(isLive, data = {}) {
    this.isLive = isLive;
    this.liveData = data;
    this.updateUI();
  }
  
  goLive(streamData) {
    this.setLiveStatus(true, streamData);
    
    // Show notification
    this.showLiveNotification(streamData.title || 'We\'re Live!');
  }
  
  goOffline() {
    this.setLiveStatus(false);
  }
  
  showLiveNotification(title) {
    // Create a notification banner
    const notification = document.createElement('div');
    notification.className = 'live-notification';
    notification.innerHTML = `
      <div class="live-notification__content">
        <span class="live-notification__icon">🔴</span>
        <span class="live-notification__text">${title}</span>
        <a href="#live-stream-container" class="btn btn-sm btn-primary">Watch Now</a>
        <button class="live-notification__close">&times;</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      notification.remove();
    }, 10000);
    
    // Close button
    notification.querySelector('.live-notification__close').addEventListener('click', () => {
      notification.remove();
    });
  }
}

// Initialize live stream manager
document.addEventListener('DOMContentLoaded', () => {
  window.liveStreamManager = new LiveStreamManager();
});

// Export for manual control
window.LiveStreamManager = LiveStreamManager;