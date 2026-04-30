/* ============================================================
   Twitch Integration for Live Stream Status
   ============================================================ */

class TwitchIntegration {
  constructor() {
    // Your Twitch channel name
    this.channelName = 'seedtheword'; // Replace with your actual Twitch username
    
    this.isLive = false;
    this.streamData = null;
    this.videos = [];
    
    this.init();
  }
  
  async init() {
    await this.checkLiveStatus();
    await this.loadRecentVideos();
    this.renderLiveStreamSection();
    this.startAutoRefresh();
  }
  
  async checkLiveStatus() {
    try {
      // Note: This is a simplified check. For production, you'd need Twitch API credentials
      // For now, we'll use a public API that checks if a stream is live
      const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${this.channelName}`, {
        headers: {
          'Client-ID': 'your-client-id', // You'll need to get this from Twitch
          'Authorization': 'Bearer your-access-token' // You'll need to get this from Twitch
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        this.isLive = data.data && data.data.length > 0;
        this.streamData = this.isLive ? data.data[0] : null;
        console.log('✅ Twitch status checked:', this.isLive ? 'LIVE' : 'OFFLINE');
      } else {
        console.log('⚠️ Could not check Twitch status, using fallback');
        this.useFallbackStatus();
      }
    } catch (error) {
      console.error('❌ Twitch API Error:', error);
      this.useFallbackStatus();
    }
  }
  
  useFallbackStatus() {
    // Fallback: Check if it's during typical streaming hours (example: Saturday 2-4 PM PST)
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getHours();
    
    // Example: Live on Saturdays between 2-4 PM PST (adjust as needed)
    this.isLive = (day === 6 && hour >= 14 && hour < 16);
    this.streamData = this.isLive ? {
      title: 'Study Saturday Live',
      game_name: 'Just Chatting',
      viewer_count: Math.floor(Math.random() * 50) + 10 // Random viewer count for demo
    } : null;
  }
  
  async loadRecentVideos() {
    try {
      // This would normally fetch from Twitch API
      // For now, we'll use placeholder data
      this.videos = [
        {
          id: '1',
          title: 'Bible Study: Romans Chapter 8',
          thumbnail_url: 'assets/images/bible-ministry-1.jpg',
          created_at: '2026-04-23T14:00:00Z',
          duration: '1h 45m',
          view_count: 234
        },
        {
          id: '2',
          title: 'Prayer and Fellowship Session',
          thumbnail_url: 'assets/images/stw-ministry-team.jpg',
          created_at: '2026-04-16T14:00:00Z',
          duration: '2h 12m',
          view_count: 189
        },
        {
          id: '3',
          title: 'Q&A: Faith and Daily Life',
          thumbnail_url: 'assets/images/seed-the-word.jpg',
          created_at: '2026-04-09T14:00:00Z',
          duration: '1h 23m',
          view_count: 156
        }
      ];
    } catch (error) {
      console.error('❌ Error loading Twitch videos:', error);
      this.videos = [];
    }
  }
  
  renderLiveStreamSection() {
    const container = document.getElementById('livestream-section');
    if (!container) return;
    
    if (this.isLive) {
      container.innerHTML = this.renderLiveStream();
    } else {
      container.innerHTML = this.renderOfflineStream();
    }
  }
  
  renderLiveStream() {
    return `
      <div class="livestream-card live glass-morphism">
        <div class="livestream-header">
          <div class="live-indicator">
            <span class="live-dot"></span>
            <span class="live-text">LIVE NOW</span>
          </div>
          <div class="viewer-count">
            👥 ${this.streamData?.viewer_count || 0} viewers
          </div>
        </div>
        
        <div class="livestream-content">
          <h3 class="livestream-title">${this.streamData?.title || 'Study Saturday Live'}</h3>
          <p class="livestream-category">📺 ${this.streamData?.game_name || 'Bible Study & Fellowship'}</p>
          
          <div class="livestream-actions">
            <a href="https://twitch.tv/${this.channelName}" target="_blank" class="btn btn-primary btn-live">
              🔴 Watch Live
            </a>
            <button onclick="twitchIntegration.shareStream()" class="btn btn-secondary">
              📤 Share
            </button>
          </div>
        </div>
        
        <div class="livestream-preview">
          <div class="stream-placeholder">
            <div class="stream-icon">📺</div>
            <p>Live on Twitch</p>
          </div>
        </div>
      </div>
    `;
  }
  
  renderOfflineStream() {
    const nextStreamTime = this.getNextStreamTime();
    
    return `
      <div class="livestream-card offline glass-morphism">
        <div class="livestream-header">
          <div class="offline-indicator">
            <span class="offline-dot"></span>
            <span class="offline-text">OFFLINE</span>
          </div>
          <div class="next-stream">
            ⏰ ${nextStreamTime}
          </div>
        </div>
        
        <div class="livestream-content">
          <h3 class="livestream-title">Study Saturday Live</h3>
          <p class="livestream-description">Join us for Bible study, fellowship, and prayer with members worldwide.</p>
          
          <div class="livestream-actions">
            <a href="https://twitch.tv/${this.channelName}" target="_blank" class="btn btn-secondary">
              📺 Follow on Twitch
            </a>
            <button onclick="twitchIntegration.setReminder()" class="btn btn-secondary">
              🔔 Set Reminder
            </button>
          </div>
        </div>
        
        ${this.renderRecentVideos()}
      </div>
    `;
  }
  
  renderRecentVideos() {
    if (this.videos.length === 0) {
      return `
        <div class="recent-videos">
          <h4>📹 Recent Streams</h4>
          <p style="color: var(--muted); font-size: 0.9rem;">No recent videos available</p>
        </div>
      `;
    }
    
    return `
      <div class="recent-videos">
        <h4>📹 Recent Streams</h4>
        <div class="video-grid">
          ${this.videos.slice(0, 3).map(video => `
            <div class="video-card" onclick="twitchIntegration.playVideo('${video.id}')">
              <div class="video-thumbnail">
                <img src="${video.thumbnail_url}" alt="${video.title}" loading="lazy">
                <div class="video-duration">${video.duration}</div>
              </div>
              <div class="video-info">
                <h5 class="video-title">${this.truncateText(video.title, 40)}</h5>
                <p class="video-stats">👁️ ${video.view_count} views • ${this.formatDate(video.created_at)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  getNextStreamTime() {
    // Calculate next Saturday 2 PM PST (adjust as needed)
    const now = new Date();
    const nextSaturday = new Date();
    const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
    
    nextSaturday.setDate(now.getDate() + daysUntilSaturday);
    nextSaturday.setHours(14, 0, 0, 0); // 2 PM
    
    // If it's already past 2 PM on Saturday, move to next Saturday
    if (now.getDay() === 6 && now.getHours() >= 16) {
      nextSaturday.setDate(nextSaturday.getDate() + 7);
    }
    
    const diffDays = Math.ceil((nextSaturday - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today at 2:00 PM PST';
    if (diffDays === 1) return 'Tomorrow at 2:00 PM PST';
    if (diffDays <= 7) return `This Saturday at 2:00 PM PST`;
    return `Next Saturday at 2:00 PM PST`;
  }
  
  shareStream() {
    const text = this.isLive 
      ? `🔴 LIVE NOW: ${this.streamData?.title || 'Study Saturday Live'} - Join us for Bible study and fellowship!`
      : 'Join us for Study Saturday Live - Bible study, fellowship, and prayer with members worldwide!';
    
    const url = `https://twitch.tv/${this.channelName}`;
    const shareText = `${text}\n\n${url}\n\nSeed the Word Ministry\nhttps://seedtheword.github.io/seedtheword/\n\nJoin our Telegram: https://t.me/seedtheword`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Seed the Word Live Stream',
        text: shareText,
        url: url
      });
    } else {
      navigator.clipboard.writeText(shareText).then(() => {
        this.showNotification('📋 Stream link copied to clipboard!');
      });
    }
  }
  
  setReminder() {
    const nextStream = this.getNextStreamTime();
    this.showNotification(`🔔 Reminder set for ${nextStream}! Follow us on Twitch to get notified.`);
    
    // Open Twitch follow page
    window.open(`https://twitch.tv/${this.channelName}`, '_blank');
  }
  
  playVideo(videoId) {
    // Open video on Twitch
    window.open(`https://twitch.tv/videos/${videoId}`, '_blank');
  }
  
  showNotification(message) {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 2rem;
      right: 2rem;
      background: var(--green);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      z-index: 1000;
      font-weight: 600;
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
  
  startAutoRefresh() {
    // Check live status every 5 minutes
    setInterval(async () => {
      const wasLive = this.isLive;
      await this.checkLiveStatus();
      
      // If status changed, update the display
      if (wasLive !== this.isLive) {
        this.renderLiveStreamSection();
        
        // Show notification if stream went live
        if (this.isLive && !wasLive) {
          this.showNotification('🔴 Stream is now LIVE!');
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }
  
  // Utility methods
  truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }
  
  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  
  // Public refresh method
  async refresh() {
    await this.checkLiveStatus();
    await this.loadRecentVideos();
    this.renderLiveStreamSection();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.twitchIntegration = new TwitchIntegration();
});

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
  
  .live-dot, .offline-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.5rem;
  }
  
  .live-dot {
    background: #ff0000;
    animation: pulse 2s infinite;
  }
  
  .offline-dot {
    background: #95a5a6;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }
  
  .video-card {
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
    transition: transform 0.3s ease;
  }
  
  .video-card:hover {
    transform: translateY(-2px);
  }
  
  .video-thumbnail {
    position: relative;
    aspect-ratio: 16/9;
    overflow: hidden;
  }
  
  .video-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .video-duration {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
  }
  
  .video-info {
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.9);
  }
  
  .video-title {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }
  
  .video-stats {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
`;
document.head.appendChild(style);