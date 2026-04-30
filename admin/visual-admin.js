/* ============================================================
   Seed the Word - Visual Admin Interface
   Real-time preview with inline editing
   ============================================================ */

class VisualAdmin {
  constructor() {
    this.githubAPI = 'https://api.github.com';
    this.repoOwner = 'seedtheword'; // Update this to match your GitHub username
    this.repoName = 'seedtheword';   // Update this to match your repository name
    this.branch = 'main';
    
    this.credentials = {
      username: null,
      token: null
    };
    
    this.dataFiles = {
      livestream: '_data/livestream.json',
      testimonies: '_data/testimonies.json',
      team: '_data/team.json'
    };
    
    this.currentPreview = 'home';
    this.previewFrame = null;
    
    this.init();
  }
  
  init() {
    // Check if already logged in
    const savedCredentials = localStorage.getItem('visual_admin_credentials');
    if (savedCredentials) {
      try {
        this.credentials = JSON.parse(savedCredentials);
        this.showAdminInterface();
      } catch (error) {
        console.error('Invalid saved credentials:', error);
        localStorage.removeItem('visual_admin_credentials');
      }
    }
    
    // Bind events
    this.bindEvents();
  }
  
  bindEvents() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.login();
    });
    
    // Preview frame load event
    window.addEventListener('message', (event) => {
      // Handle messages from preview frame if needed
      if (event.data && event.data.type === 'preview-ready') {
        this.updatePreviewData();
      }
    });
  }
  
  // Authentication
  async login() {
    const username = document.getElementById('github-username').value;
    const token = document.getElementById('github-token').value;
    
    if (!username || !token) {
      this.showStatus('login-status', 'Please fill in all fields', 'error');
      return;
    }
    
    // Test GitHub API access with better error handling
    try {
      this.showStatus('login-status', 'Testing GitHub connection...', 'info');
      
      const response = await fetch(`${this.githubAPI}/repos/${this.repoOwner}/${this.repoName}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 404) {
          throw new Error(`Repository '${this.repoOwner}/${this.repoName}' not found. Please check the repository name.`);
        } else if (response.status === 401) {
          throw new Error('Invalid token or insufficient permissions. Make sure your token has "repo" access.');
        } else if (response.status === 403) {
          throw new Error('Access forbidden. Your token needs "repo" permissions for private repositories.');
        } else {
          throw new Error(`GitHub API Error: ${response.status} - ${errorData.message || response.statusText}`);
        }
      }
      
      // Test write access by trying to read a file
      try {
        await this.makeGitHubRequest('/contents/_data', 'GET', null, token);
      } catch (error) {
        if (error.message.includes('404')) {
          // _data directory doesn't exist, that's okay
          console.log('_data directory will be created when needed');
        } else {
          throw new Error('Cannot access repository contents. Check token permissions.');
        }
      }
      
      // Save credentials
      this.credentials = { username, token };
      localStorage.setItem('visual_admin_credentials', JSON.stringify(this.credentials));
      
      this.showStatus('login-status', 'Login successful! Loading admin interface...', 'success');
      
      setTimeout(() => {
        this.showAdminInterface();
      }, 1000);
      
    } catch (error) {
      console.error('Login error:', error);
      this.showStatus('login-status', error.message, 'error');
    }
  }
  
  logout() {
    localStorage.removeItem('visual_admin_credentials');
    this.credentials = { username: null, token: null };
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('admin-interface').classList.add('hidden');
    document.getElementById('github-username').value = '';
    document.getElementById('github-token').value = '';
  }
  
  showAdminInterface() {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('admin-interface').classList.remove('hidden');
    document.getElementById('admin-user-info').textContent = `${this.credentials.username}`;
    
    // Initialize preview frame
    this.previewFrame = document.getElementById('preview-frame');
    
    // Load initial data
    this.loadAllData();
  }
  
  // GitHub API Methods with better error handling
  async makeGitHubRequest(endpoint, method = 'GET', data = null, token = null) {
    const url = `${this.githubAPI}/repos/${this.repoOwner}/${this.repoName}${endpoint}`;
    const authToken = token || this.credentials.token;
    
    const options = {
      method,
      headers: {
        'Authorization': `token ${authToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `GitHub API Error: ${response.status} ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.message) {
          errorMessage += ` - ${errorData.message}`;
        }
        if (errorData.documentation_url) {
          errorMessage += ` (See: ${errorData.documentation_url})`;
        }
      } catch (e) {
        errorMessage += ` - ${errorText}`;
      }
      
      throw new Error(errorMessage);
    }
    
    return response.json();
  }
  
  async getFileContent(path) {
    try {
      const response = await this.makeGitHubRequest(`/contents/${path}`);
      return JSON.parse(atob(response.content));
    } catch (error) {
      if (error.message.includes('404')) {
        return null; // File doesn't exist
      }
      throw error;
    }
  }
  
  async updateFile(path, content, message) {
    try {
      // Get current file to get SHA (required for updates)
      let sha = null;
      try {
        const currentFile = await this.makeGitHubRequest(`/contents/${path}`);
        sha = currentFile.sha;
      } catch (error) {
        // File doesn't exist, that's okay for new files
        if (!error.message.includes('404')) {
          throw error;
        }
      }
      
      const data = {
        message,
        content: btoa(JSON.stringify(content, null, 2)),
        branch: this.branch
      };
      
      if (sha) {
        data.sha = sha;
      }
      
      await this.makeGitHubRequest(`/contents/${path}`, 'PUT', data);
      return true;
    } catch (error) {
      console.error('File update error:', error);
      throw error;
    }
  }
  
  // Data Management
  async loadAllData() {
    try {
      await this.loadLivestreamData();
      this.updateStreamStatus();
      
    } catch (error) {
      console.error('Error loading data:', error);
      this.showStatus('admin-status', `Error loading data: ${error.message}`, 'error');
    }
  }
  
  async loadLivestreamData() {
    try {
      const data = await this.getFileContent(this.dataFiles.livestream);
      if (data) {
        document.getElementById('stream-status').value = data.status || 'offline';
        document.getElementById('stream-title').value = data.title || '';
        document.getElementById('stream-url').value = data.url || '';
        
        this.updateStreamStatus();
      }
    } catch (error) {
      console.error('Error loading livestream data:', error);
    }
  }
  
  updateStreamStatus() {
    const status = document.getElementById('stream-status').value;
    const title = document.getElementById('stream-title').value;
    const indicator = document.getElementById('stream-indicator');
    const statusText = document.getElementById('stream-status-text');
    
    if (status === 'live') {
      indicator.className = 'live-indicator';
      statusText.textContent = `🔴 LIVE: ${title || 'Untitled Stream'}`;
    } else if (status === 'scheduled') {
      indicator.className = 'live-indicator offline';
      statusText.textContent = `📅 SCHEDULED: ${title || 'Untitled Stream'}`;
    } else {
      indicator.className = 'live-indicator offline';
      statusText.textContent = '⏹️ Stream is offline';
    }
  }
  
  async saveStreamData() {
    try {
      const data = {
        status: document.getElementById('stream-status').value,
        title: document.getElementById('stream-title').value,
        url: document.getElementById('stream-url').value,
        description: 'Join us for Bible study, fellowship, and prayer with members worldwide.',
        scheduledTime: null,
        lastUpdated: new Date().toISOString()
      };
      
      await this.updateFile(this.dataFiles.livestream, data, 'Update livestream status via Visual Admin');
      this.showStatus('admin-status', '✅ Stream settings saved!', 'success');
      this.updateStreamStatus();
      this.refreshPreview();
      
    } catch (error) {
      console.error('Error saving stream data:', error);
      this.showStatus('admin-status', `❌ Error saving: ${error.message}`, 'error');
    }
  }
  
  async addTestimony() {
    try {
      const name = document.getElementById('testimony-name').value;
      const text = document.getElementById('testimony-text').value;
      const featured = document.getElementById('testimony-featured').value === 'true';
      
      if (!name || !text) {
        this.showStatus('admin-status', '❌ Please fill in name and testimony text', 'error');
        return;
      }
      
      const currentData = await this.getFileContent(this.dataFiles.testimonies) || { testimonies: [] };
      
      const newTestimony = {
        id: Date.now(),
        name,
        location: null,
        text,
        featured,
        dateAdded: new Date().toISOString()
      };
      
      currentData.testimonies.push(newTestimony);
      
      await this.updateFile(this.dataFiles.testimonies, currentData, `Add testimony from ${name} via Visual Admin`);
      
      // Clear form
      document.getElementById('testimony-name').value = '';
      document.getElementById('testimony-text').value = '';
      document.getElementById('testimony-featured').value = 'false';
      
      this.showStatus('admin-status', '✅ Testimony added successfully!', 'success');
      this.refreshPreview();
      
    } catch (error) {
      console.error('Error adding testimony:', error);
      this.showStatus('admin-status', `❌ Error adding testimony: ${error.message}`, 'error');
    }
  }
  
  async addTeamMember() {
    try {
      const name = document.getElementById('team-name').value;
      const role = document.getElementById('team-role').value;
      const description = document.getElementById('team-description').value;
      
      if (!name || !role || !description) {
        this.showStatus('admin-status', '❌ Please fill in name, role, and description', 'error');
        return;
      }
      
      const currentData = await this.getFileContent(this.dataFiles.team) || { team: [] };
      
      const newMember = {
        id: Date.now(),
        name,
        role,
        description,
        photo: null,
        dateAdded: new Date().toISOString()
      };
      
      currentData.team.push(newMember);
      
      await this.updateFile(this.dataFiles.team, currentData, `Add team member: ${name} via Visual Admin`);
      
      // Clear form
      document.getElementById('team-name').value = '';
      document.getElementById('team-role').value = '';
      document.getElementById('team-description').value = '';
      
      this.showStatus('admin-status', '✅ Team member added successfully!', 'success');
      this.refreshPreview();
      
    } catch (error) {
      console.error('Error adding team member:', error);
      this.showStatus('admin-status', `❌ Error adding team member: ${error.message}`, 'error');
    }
  }
  
  // Preview Management
  switchPreview(page) {
    // Update button states
    document.querySelectorAll('.preview-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Switch preview page
    this.currentPreview = page;
    const pageMap = {
      'home': '../index.html',
      'news': '../news.html',
      'community': '../community.html',
      'about': '../about.html'
    };
    
    if (this.previewFrame) {
      this.previewFrame.src = pageMap[page] || '../index.html';
    }
  }
  
  refreshPreview() {
    if (this.previewFrame) {
      this.previewFrame.src = this.previewFrame.src;
    }
  }
  
  updatePreview() {
    // Update stream status in real-time
    this.updateStreamStatus();
    
    // If we had real-time preview updates, they would go here
    // For now, we'll just update the status display
  }
  
  // Export functionality
  async exportData() {
    try {
      const allData = {};
      
      for (const [key, path] of Object.entries(this.dataFiles)) {
        allData[key] = await this.getFileContent(path);
      }
      
      const dataStr = JSON.stringify(allData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(dataBlob);
      link.download = `seedtheword-backup-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      
      this.showStatus('admin-status', '✅ Data exported successfully!', 'success');
      
    } catch (error) {
      console.error('Export error:', error);
      this.showStatus('admin-status', `❌ Export failed: ${error.message}`, 'error');
    }
  }
  
  // Utility Methods
  showStatus(containerId, message, type) {
    const container = document.getElementById(containerId);
    const className = type === 'error' ? 'status-error' : 
                     type === 'success' ? 'status-success' : 'status-info';
    
    container.innerHTML = `<div class="status-message ${className}">${message}</div>`;
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        container.innerHTML = '';
      }, 5000);
    }
  }
}

// Global Functions
function updatePreview() {
  if (window.visualAdmin) {
    window.visualAdmin.updatePreview();
  }
}

function saveStreamData() {
  if (window.visualAdmin) {
    window.visualAdmin.saveStreamData();
  }
}

function addTestimony() {
  if (window.visualAdmin) {
    window.visualAdmin.addTestimony();
  }
}

function addTeamMember() {
  if (window.visualAdmin) {
    window.visualAdmin.addTeamMember();
  }
}

function switchPreview(page) {
  if (window.visualAdmin) {
    window.visualAdmin.switchPreview(page);
  }
}

function refreshPreview() {
  if (window.visualAdmin) {
    window.visualAdmin.refreshPreview();
  }
}

function exportData() {
  if (window.visualAdmin) {
    window.visualAdmin.exportData();
  }
}

function logout() {
  if (window.visualAdmin) {
    window.visualAdmin.logout();
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  window.visualAdmin = new VisualAdmin();
});