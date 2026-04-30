# Seed the Word Ministry - Built-in Admin Panel

## Overview

Your website now includes a completely **portable, static admin panel** that works regardless of where your site is hosted. No external dependencies, no server requirements - just pure HTML, CSS, and JavaScript that stores data directly in your GitHub repository.

## 🚀 Quick Start

1. **Access the Admin Panel**: Visit `https://yourdomain.com/admin/` or `https://yourdomain.com/admin-controls.html`

2. **Get GitHub Credentials**:
   - Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
   - Click "Generate new token (classic)"
   - Give it a name like "Seed the Word Admin"
   - Select the **`repo`** permission (Full control of private repositories)
   - Copy the generated token (starts with `ghp_`)

3. **Login**: Use your GitHub username and the personal access token

4. **Start Managing**: You can now manage livestreams, testimonies, team members, and more!

## 📋 Features

### 📺 Live Stream Management
- Set stream status (Live, Offline, Scheduled)
- Configure stream title, URL, and description
- Schedule future streams
- Real-time updates on your website

### 💬 Testimonies Management
- Add new testimonies from community members
- Mark testimonies as "featured" for homepage display
- Edit and delete existing testimonies
- Automatic date tracking

### 👥 Team Management
- Add team members with roles and descriptions
- Link to team member photos (upload to `assets/images/team/`)
- Edit and remove team members
- Automatic bio formatting

### 📅 Events Integration
- Google Calendar integration (no manual event entry needed!)
- Test calendar API connection
- View upcoming events from your calendar
- Direct links to edit events in Google Calendar

### 💾 Data Management
- **Export**: Download all your data as JSON backup
- **Import**: Restore from backup files
- **Clear**: Reset all data (with confirmation)
- **Portable**: All data stored in your GitHub repo

## 🔧 Technical Details

### Data Storage
All content is stored in JSON files in your repository:
- `_data/livestream.json` - Live stream settings
- `_data/testimonies.json` - Community testimonies
- `_data/team.json` - Team member information
- `_data/events.json` - Reserved for future use

### Security
- Uses GitHub Personal Access Tokens for authentication
- All data stored in your own repository
- No external servers or databases
- Token stored locally in browser (can be cleared anytime)

### Portability
- **100% Static**: No server-side code required
- **Host Anywhere**: Works on GitHub Pages, Netlify, Vercel, or any static host
- **No Dependencies**: No external services except GitHub for storage
- **Easy Migration**: Just copy files to new hosting provider

## 🛠️ Setup Instructions

### 1. Repository Configuration
Make sure these settings are correct in `admin/admin.js`:
```javascript
this.repoOwner = 'seedtheword'; // Your GitHub username
this.repoName = 'seedtheword';   // Your repository name
this.branch = 'main';            // Your default branch
```

### 2. GitHub Token Permissions
Your Personal Access Token needs:
- ✅ **repo** (Full control of private repositories)
- ✅ **workflow** (if you want to trigger deployments)

### 3. File Structure
Ensure these directories exist in your repository:
```
site/
├── _data/
│   ├── livestream.json
│   ├── testimonies.json
│   ├── team.json
│   └── events.json
├── admin/
│   ├── index.html
│   └── admin.js
└── assets/images/team/
    └── (team member photos)
```

## 📱 Usage Guide

### Managing Live Streams
1. Go to **Live Stream** tab
2. Set status: Offline, Live Now, or Scheduled
3. Fill in stream details (title, URL, description)
4. For scheduled streams, set the date/time
5. Click **Update Live Stream**

### Adding Testimonies
1. Go to **Testimonies** tab
2. Fill in name, location (optional), and testimony text
3. Choose if it should be "Featured" (appears on homepage)
4. Click **Add Testimony**

### Managing Team Members
1. Go to **Team** tab
2. Enter name, role, and description
3. Optionally specify photo filename (upload photo to `assets/images/team/` first)
4. Click **Add Team Member**

### Events (Google Calendar)
1. Go to **Events** tab
2. Click **Open Google Calendar** to manage events
3. Use **Test Calendar Connection** to verify integration
4. Events automatically appear on your website

### Backup & Restore
1. Go to **Settings** tab
2. Click **Export All Data** to download backup
3. Use **Import Data** to restore from backup file
4. **Clear All Data** removes everything (use carefully!)

## 🔍 Troubleshooting

### "Permission denied" Error
- Check that your GitHub token has `repo` permissions
- Verify the repository owner and name are correct
- Make sure the repository exists and you have access

### "File not found" Errors
- The admin panel will create missing data files automatically
- Ensure the `_data/` directory exists in your repository

### Changes Not Appearing on Website
- Changes are saved to GitHub immediately
- Your hosting provider may take a few minutes to deploy changes
- Try refreshing the website page (Ctrl+F5 for hard refresh)

### Token Security
- Never share your Personal Access Token
- If compromised, revoke it immediately on GitHub and create a new one
- The token is only stored in your browser's local storage

## 🚀 Migration Benefits

### From Netlify CMS
- ✅ No more hosting dependencies
- ✅ Works on any static host
- ✅ No external authentication services
- ✅ Direct GitHub integration
- ✅ Simpler setup and maintenance

### Hosting Flexibility
- **GitHub Pages**: Works perfectly
- **Netlify**: No special configuration needed
- **Vercel**: Deploy and use immediately
- **Any Static Host**: Just upload files

## 📞 Support

If you need help:
1. Check this documentation first
2. Verify your GitHub token permissions
3. Test with a simple change (like updating stream status)
4. Check browser console for error messages

## 🔄 Updates

To update the admin panel:
1. Replace `admin/index.html` and `admin/admin.js` with new versions
2. Your data files (`_data/*.json`) will remain unchanged
3. No configuration changes needed

---

**🌱 Seed the Word Ministry Admin Panel**  
*Portable • Secure • Simple*