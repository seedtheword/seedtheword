/* ============================================================
   Seed the Word - Built-in Admin Panel
   Static, Portable Content Management System
   ============================================================ */

class AdminPanel {
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
      events: '_data/events.json',
      testimonies: '_data/testimonies.json',
      team: '_data/team.json'
    };
    
    this.init();
  }
  
  init() {
    // Check if already logged in
    const savedCredentials = localStorage.getItem('admin_credentials');
    if (savedCredentials) {
      this.credentials = JSON.parse(savedCredentials);
      this.showAdminPanel();
    }
    
    // Bind form events
    this.bindEvents();
  }
  
  bindEvents() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.login();
    });
    
    // Admin forms
    document.getElementById('livestream-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.updateLivestream();
    });
    
    document.getElementById('testimony-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addTestimony();
    });
    
    document.getElementById('team-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.addTeamMember();
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
    
    // Test GitHub API access
    try {
      const response = await fetch(`${this.githubAPI}/repos/${this.repoOwner}/${this.repoName}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
      }
      
      // Save credentials
      this.credentials = { username, token };
      localStorage.setItem('admin_credentials', JSON.stringify(this.credentials));
      
      this.showStatus('login-status', 'Login successful! Loading admin panel...', 'success');
      
      setTimeout(() => {
        this.showAdminPanel();
      }, 1000);
      
    } catch (error) {
      console.error('Login error:', error);
      this.showStatus('login-status', `Login failed: ${error.message}`, 'error');
    }
  }
  
  logout() {
    localStorage.removeItem('admin_credentials');
    this.credentials = { username: null, token: null };
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('github-username').value = '';
    document.getElementById('github-token').value = '';
  }
  
  showAdminPanel() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('admin-user-info').textContent = `Logged in as: ${this.credentials.username}`;
    
    // Load initial data
    this.loadAllData();
  }
  
  // GitHub API Methods
  async makeGitHubRequest(endpoint, method = 'GET', data = null) {
    const url = `${this.githubAPI}/repos/${this.repoOwner}/${this.repoName}${endpoint}`;
    
    const options = {
      method,
      headers: {
        'Authorization': `token ${this.credentials.token}`,
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
      throw new Error(`GitHub API Error: ${response.status} ${response.statusText} - ${errorText}`);
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
      await this.loadTestimoniesData();
      await this.loadTeamData();
      await this.loadEventsData();
      
      // Update repository info
      const repoInfo = await this.makeGitHubRequest('');
      document.getElementById('repo-info').textContent = repoInfo.full_name;
      document.getElementById('last-updated').textContent = new Date(repoInfo.updated_at).toLocaleString();
      
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
        document.getElementById('stream-description').value = data.description || '';
        
        if (data.scheduledTime) {
          const date = new Date(data.scheduledTime);
          document.getElementById('stream-time').value = date.toISOString().slice(0, 16);
        }
      }
    } catch (error) {
      console.error('Error loading livestream data:', error);
    }
  }
  
  async updateLivestream() {
    try {
      const data = {
        status: document.getElementById('stream-status').value,
        title: document.getElementById('stream-title').value,
        url: document.getElementById('stream-url').value,
        description: document.getElementById('stream-description').value,
        scheduledTime: document.getElementById('stream-time').value ? new Date(document.getElementById('stream-time').value).toISOString() : null,
        lastUpdated: new Date().toISOString()
      };
      
      await this.updateFile(this.dataFiles.livestream, data, 'Update livestream status');
      this.showStatus('admin-status', 'Livestream updated successfully!', 'success');
      
    } catch (error) {
      console.error('Error updating livestream:', error);
      this.showStatus('admin-status', `Error updating livestream: ${error.message}`, 'error');
    }
  }
  
  async loadTestimoniesData() {
    try {
      const data = await this.getFileContent(this.dataFiles.testimonies);
      const testimonies = data?.testimonies || [];
      
      const listContainer = document.getElementById('testimonies-list');
      listContainer.innerHTML = '';
      
      if (testimonies.length === 0) {
        listContainer.innerHTML = '<div class="data-item">No testimonies yet. Add your first testimony above.</div>';
        return;
      }
      
      testimonies.forEach((testimony, index) => {
        const item = document.createElement('div');
        item.className = 'data-item';
        item.innerHTML = `
          <div>
            <strong>${testimony.name}</strong>
            ${testimony.location ? `<span style="color: var(--muted);"> - ${testimony.location}</span>` : ''}
            ${testimony.featured ? '<span style="color: var(--gold); font-weight: 600;"> ⭐ Featured</span>' : ''}
            <div style="margin-top: 0.5rem; color: var(--muted); font-size: 0.9rem;">
              ${testimony.text.substring(0, 100)}${testimony.text.length > 100 ? '...' : ''}
            </div>
          </div>
          <div class="data-actions">
            <button onclick="adminPanel.editTestimony(${index})" class="btn-admin secondary btn-small">Edit</button>
            <button onclick="adminPanel.deleteTestimony(${index})" class="btn-admin danger btn-small">Delete</button>
          </div>
        `;
        listContainer.appendChild(item);
      });
      
    } catch (error) {
      console.error('Error loading testimonies:', error);
    }
  }
  
  async addTestimony() {
    try {
      const name = document.getElementById('testimony-name').value;
      const location = document.getElementById('testimony-location').value;
      const text = document.getElementById('testimony-text').value;
      const featured = document.getElementById('testimony-featured').value === 'true';
      
      if (!name || !text) {
        this.showStatus('admin-status', 'Please fill in name and testimony text', 'error');
        return;
      }
      
      const currentData = await this.getFileContent(this.dataFiles.testimonies) || { testimonies: [] };
      
      const newTestimony = {
        id: Date.now(),
        name,
        location: location || null,
        text,
        featured,
        dateAdded: new Date().toISOString()
      };
      
      currentData.testimonies.push(newTestimony);
      
      await this.updateFile(this.dataFiles.testimonies, currentData, `Add testimony from ${name}`);
      
      this.clearTestimonyForm();
      this.loadTestimoniesData();
      this.showStatus('admin-status', 'Testimony added successfully!', 'success');
      
    } catch (error) {
      console.error('Error adding testimony:', error);
      this.showStatus('admin-status', `Error adding testimony: ${error.message}`, 'error');
    }
  }
  
  async deleteTestimony(index) {
    if (!confirm('Are you sure you want to delete this testimony?')) return;
    
    try {
      const currentData = await this.getFileContent(this.dataFiles.testimonies) || { testimonies: [] };
      const testimony = currentData.testimonies[index];
      
      currentData.testimonies.splice(index, 1);
      
      await this.updateFile(this.dataFiles.testimonies, currentData, `Delete testimony from ${testimony.name}`);
      
      this.loadTestimoniesData();
      this.showStatus('admin-status', 'Testimony deleted successfully!', 'success');
      
    } catch (error) {
      console.error('Error deleting testimony:', error);
      this.showStatus('admin-status', `Error deleting testimony: ${error.message}`, 'error');
    }
  }
  
  clearTestimonyForm() {
    document.getElementById('testimony-name').value = '';
    document.getElementById('testimony-location').value = '';
    document.getElementById('testimony-text').value = '';
    document.getElementById('testimony-featured').value = 'false';
  }
  
  async loadTeamData() {
    try {
      const data = await this.getFileContent(this.dataFiles.team);
      const team = data?.team || [];
      
      const listContainer = document.getElementById('team-list');
      listContainer.innerHTML = '';
      
      if (team.length === 0) {
        listContainer.innerHTML = '<div class="data-item">No team members yet. Add your first team member above.</div>';
        return;
      }
      
      team.forEach((member, index) => {
        const item = document.createElement('div');
        item.className = 'data-item';
        item.innerHTML = `
          <div>
            <strong>${member.name}</strong> - <span style="color: var(--green);">${member.role}</span>
            ${member.photo ? `<span style="color: var(--muted);"> 📷 ${member.photo}</span>` : ''}
            <div style="margin-top: 0.5rem; color: var(--muted); font-size: 0.9rem;">
              ${member.description.substring(0, 100)}${member.description.length > 100 ? '...' : ''}
            </div>
          </div>
          <div class="data-actions">
            <button onclick="adminPanel.editTeamMember(${index})" class="btn-admin secondary btn-small">Edit</button>
            <button onclick="adminPanel.deleteTeamMember(${index})" class="btn-admin danger btn-small">Delete</button>
          </div>
        `;
        listContainer.appendChild(item);
      });
      
    } catch (error) {
      console.error('Error loading team data:', error);
    }
  }
  
  async addTeamMember() {
    try {
      const name = document.getElementById('team-name').value;
      const role = document.getElementById('team-role').value;
      const description = document.getElementById('team-description').value;
      const photo = document.getElementById('team-photo').value;
      
      if (!name || !role || !description) {
        this.showStatus('admin-status', 'Please fill in name, role, and description', 'error');
        return;
      }
      
      const currentData = await this.getFileContent(this.dataFiles.team) || { team: [] };
      
      const newMember = {
        id: Date.now(),
        name,
        role,
        description,
        photo: photo || null,
        dateAdded: new Date().toISOString()
      };
      
      currentData.team.push(newMember);
      
      await this.updateFile(this.dataFiles.team, currentData, `Add team member: ${name}`);
      
      this.clearTeamForm();
      this.loadTeamData();
      this.showStatus('admin-status', 'Team member added successfully!', 'success');
      
    } catch (error) {
      console.error('Error adding team member:', error);
      this.showStatus('admin-status', `Error adding team member: ${error.message}`, 'error');
    }
  }
  
  async deleteTeamMember(index) {
    if (!confirm('Are you sure you want to delete this team member?')) return;
    
    try {
      const currentData = await this.getFileContent(this.dataFiles.team) || { team: [] };
      const member = currentData.team[index];
      
      currentData.team.splice(index, 1);
      
      await this.updateFile(this.dataFiles.team, currentData, `Delete team member: ${member.name}`);
      
      this.loadTeamData();
      this.showStatus('admin-status', 'Team member deleted successfully!', 'success');
      
    } catch (error) {
      console.error('Error deleting team member:', error);
      this.showStatus('admin-status', `Error deleting team member: ${error.message}`, 'error');
    }
  }
  
  clearTeamForm() {
    document.getElementById('team-name').value = '';
    document.getElementById('team-role').value = '';
    document.getElementById('team-description').value = '';
    document.getElementById('team-photo').value = '';
  }
  
  async loadEventsData() {
    try {
      // For events, we show Google Calendar integration status
      const statusContainer = document.getElementById('calendar-status');
      const listContainer = document.getElementById('events-list');
      
      statusContainer.innerHTML = `
        <div class="status-message status-success">
          <strong>✅ Google Calendar Integration Active</strong><br>
          Your events are managed through Google Calendar (seedthewordministry@gmail.com).
          Changes made in Google Calendar will automatically appear on your website.
        </div>
      `;
      
      // Try to load some recent events to show
      if (window.googleCalendar && window.googleCalendar.events) {
        const events = window.googleCalendar.events.slice(0, 5);
        
        listContainer.innerHTML = '';
        
        if (events.length === 0) {
          listContainer.innerHTML = '<div class="data-item">No events found. Add events in Google Calendar.</div>';
          return;
        }
        
        events.forEach(event => {
          const startDate = new Date(event.start.dateTime);
          const item = document.createElement('div');
          item.className = 'data-item';
          item.innerHTML = `
            <div>
              <strong>${event.summary || event.title}</strong>
              <div style="margin-top: 0.5rem; color: var(--muted); font-size: 0.9rem;">
                📅 ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString()}
                ${event.location ? `<br>📍 ${event.location}` : ''}
              </div>
            </div>
            <div class="data-actions">
              <a href="https://calendar.google.com" target="_blank" class="btn-admin secondary btn-small">Edit in Calendar</a>
            </div>
          `;
          listContainer.appendChild(item);
        });
      } else {
        listContainer.innerHTML = '<div class="data-item">Loading events from Google Calendar...</div>';
      }
      
    } catch (error) {
      console.error('Error loading events data:', error);
    }
  }
  
  // Utility Methods
  showStatus(containerId, message, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        container.innerHTML = '';
      }, 5000);
    }
  }
  
  // Export/Import Functions
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
      
      this.showStatus('admin-status', 'Data exported successfully!', 'success');
      
    } catch (error) {
      console.error('Export error:', error);
      this.showStatus('admin-status', `Export failed: ${error.message}`, 'error');
    }
  }
  
  async importData() {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    
    if (!file) {
      this.showStatus('admin-status', 'Please select a file to import', 'error');
      return;
    }
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      for (const [key, content] of Object.entries(data)) {
        if (this.dataFiles[key] && content) {
          await this.updateFile(this.dataFiles[key], content, `Import ${key} data`);
        }
      }
      
      this.loadAllData();
      this.showStatus('admin-status', 'Data imported successfully!', 'success');
      
    } catch (error) {
      console.error('Import error:', error);
      this.showStatus('admin-status', `Import failed: ${error.message}`, 'error');
    }
  }
  
  async clearAllData() {
    if (!confirm('⚠️ This will delete ALL data (testimonies, team, livestream settings). This cannot be undone!\n\nAre you absolutely sure?')) {
      return;
    }
    
    if (!confirm('Last chance! This will permanently delete all your content. Continue?')) {
      return;
    }
    
    try {
      const emptyData = {
        livestream: { status: 'offline', title: '', url: '', description: '', scheduledTime: null },
        testimonies: { testimonies: [] },
        team: { team: [] },
        events: { events: [] }
      };
      
      for (const [key, content] of Object.entries(emptyData)) {
        await this.updateFile(this.dataFiles[key], content, `Clear ${key} data`);
      }
      
      this.loadAllData();
      this.showStatus('admin-status', 'All data cleared successfully!', 'success');
      
    } catch (error) {
      console.error('Clear data error:', error);
      this.showStatus('admin-status', `Clear data failed: ${error.message}`, 'error');
    }
  }
}

// Global Functions
function showPanel(panelName) {
  // Hide all panels
  document.querySelectorAll('.admin-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  // Remove active class from all tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected panel
  document.getElementById(`${panelName}-panel`).classList.add('active');
  
  // Add active class to selected tab
  event.target.classList.add('active');
}

function logout() {
  adminPanel.logout();
}

async function testCalendarAPI() {
  if (window.testGoogleCalendarAPI) {
    await window.testGoogleCalendarAPI();
  } else {
    alert('Google Calendar integration not loaded. Please check the main website.');
  }
}

async function refreshCalendarData() {
  if (window.refreshGoogleCalendar) {
    await window.refreshGoogleCalendar();
    adminPanel.loadEventsData();
  } else {
    alert('Google Calendar integration not loaded. Please check the main website.');
  }
}

function exportData() {
  adminPanel.exportData();
}

function importData() {
  adminPanel.importData();
}

function clearAllData() {
  adminPanel.clearAllData();
}

// Initialize admin panel when page loads
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
  adminPanel = new AdminPanel();
});