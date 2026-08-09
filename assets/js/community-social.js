/* ============================================================
   Community Social Feed — Public post feed with real-time
   Telegram integration and team portal chat activity
   ============================================================ */
(function () {
  'use strict';

  var CONFIG_URL = 'assets/data/site-config.json';
  var handlerUrl = null;

  // ── State ──
  var posts = [];
  var activeChannel = 'home';
  var userSession = null; // null = visitor (read-only)

  // ── Helpers ──
  async function getHandlerUrl() {
    if (handlerUrl) return handlerUrl;
    var cfg = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
    handlerUrl = cfg.orderHandlerUrl;
    return handlerUrl;
  }

  async function postAction(data) {
    var url = await getHandlerUrl();
    var res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) });
    var text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('Server unavailable'); }
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function initials(n) { return n.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2); }
  function timeAgo(ts) {
    var d = Date.now() - ts, m = Math.floor(d / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var days = Math.floor(h / 24);
    if (days < 7) return days + 'd ago';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Check login state ──
  function checkSession() {
    try {
      var stored = localStorage.getItem('stwm-team-session');
      if (stored) { userSession = JSON.parse(stored); }
    } catch (e) {}
    updateUIForAuth();
  }

  function updateUIForAuth() {
    var composeEl = document.getElementById('community-compose');
    var loginPrompt = document.getElementById('community-login-prompt');
    if (composeEl) composeEl.style.display = userSession ? '' : 'none';
    if (loginPrompt) loginPrompt.style.display = userSession ? 'none' : '';
    // Update nav user info
    var navUser = document.querySelector('.community-nav__user');
    if (navUser) {
      if (userSession) {
        navUser.innerHTML = '<div class="community-nav__avatar">' + initials(userSession.name) + '</div><div><div class="community-nav__name">' + escapeHtml(userSession.name) + '</div><div class="community-nav__role">Member</div></div>';
      } else {
        navUser.innerHTML = '<div class="community-nav__avatar">?</div><div><div class="community-nav__name">Guest</div><div class="community-nav__role"><a href="team.html" style="color:var(--color-gold);text-decoration:none;font-weight:600;">Sign in &rarr;</a></div></div>';
      }
    }
  }

  // ── Load announcements (public-read) ──
  async function loadAnnouncements() {
    try {
      var res = await postAction({ action: 'getAnnouncements', passphrase_hash: 'public-read' });
      if (res.ok && res.announcements) {
        return res.announcements.map(function (a) {
          return {
            id: 'ann-' + a.timestamp,
            type: a.priority === 'emergency' ? 'announcement' : (a.priority === 'urgent' ? 'announcement' : 'announcement'),
            author: a.from || 'Seed the Word',
            text: (a.subject ? '**' + a.subject + '**\n\n' : '') + a.body,
            timestamp: a.timestamp,
            priority: a.priority,
            channel: 'announcements',
            likes: Math.floor(Math.random() * 12),
            comments: []
          };
        });
      }
    } catch (e) {}
    return [];
  }

  // ── Load chat messages (public-read) ──
  async function loadChatMessages(channel) {
    try {
      var res = await postAction({ action: 'getChatMessages', passphrase_hash: 'public-read', channel: channel || 'main' });
      if (res.ok && res.messages) {
        return res.messages.map(function (m) {
          var type = m.msg_type || 'message';
          return {
            id: 'chat-' + m.timestamp + '-' + (m.from || '').replace(/\s/g, ''),
            type: type === 'prayer' ? 'prayer' : (type === 'thanksgiving' ? 'thanksgiving' : 'discussion'),
            author: m.from || 'Anonymous',
            text: m.text,
            timestamp: m.timestamp,
            channel: channel || 'main',
            likes: 0,
            comments: []
          };
        });
      }
    } catch (e) {}
    return [];
  }

  // ── Render a single post ──
  function renderPost(post) {
    var typeLabels = {
      announcement: '📢 Announcement',
      prayer: '🙏 Prayer Request',
      thanksgiving: '🎉 Thanksgiving',
      bible: '📖 Bible Study',
      discussion: '💬 Discussion'
    };
    var typeLabel = typeLabels[post.type] || '💬 Post';
    var hasLiked = false; // TODO: persist likes

    return '<article class="post-card" data-post-id="' + post.id + '">' +
      '<div class="post-card__header">' +
        '<div class="post-card__avatar">' + initials(post.author) + '</div>' +
        '<div class="post-card__meta">' +
          '<div class="post-card__author">' + escapeHtml(post.author) + '</div>' +
          '<div class="post-card__time">' + timeAgo(post.timestamp) + '</div>' +
          '<span class="post-card__type post-card__type--' + post.type + '">' + typeLabel + '</span>' +
        '</div>' +
        '<button class="post-card__menu" aria-label="More options">&middot;&middot;&middot;</button>' +
      '</div>' +
      '<div class="post-card__body">' + formatPostBody(post.text) + '</div>' +
      '<div class="post-card__engagement">' +
        '<span class="post-card__stat">' + (post.likes || 0) + ' likes</span>' +
        '<span class="post-card__stat">' + (post.comments ? post.comments.length : 0) + ' comments</span>' +
      '</div>' +
      '<div class="post-card__actions">' +
        '<button class="post-card__action' + (hasLiked ? ' is-liked' : '') + '" data-action="like"><span>&#x2764;</span> Like</button>' +
        '<button class="post-card__action" data-action="comment"><span>&#x1F4AC;</span> Comment</button>' +
        '<button class="post-card__action" data-action="share"><span>&#x1F517;</span> Share</button>' +
      '</div>' +
      (userSession ? '<div class="post-card__comments"><div class="comment-compose"><div class="comment-compose__avatar">' + initials(userSession.name) + '</div><input class="comment-compose__input" placeholder="Write a comment..." data-post-id="' + post.id + '"></div></div>' : '') +
    '</article>';
  }

  function formatPostBody(text) {
    if (!text) return '';
    // Bold with **text**
    var formatted = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Links
    formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return formatted;
  }

  // ── Render feed ──
  function renderFeed(filteredPosts) {
    var feedEl = document.getElementById('community-posts-feed');
    if (!feedEl) return;
    if (!filteredPosts || !filteredPosts.length) {
      feedEl.innerHTML = '<div class="empty-state"><div class="empty-state__icon">📭</div><h3 class="empty-state__title">No posts yet</h3><p class="empty-state__text">Be the first to share something with the community.</p></div>';
      return;
    }
    feedEl.innerHTML = filteredPosts.map(renderPost).join('');
    bindPostActions();
  }

  // ── Filter posts by channel ──
  function filterByChannel(channel) {
    activeChannel = channel;
    var filtered;
    if (channel === 'home') {
      filtered = posts.slice().sort(function (a, b) { return b.timestamp - a.timestamp; });
    } else if (channel === 'prayer') {
      filtered = posts.filter(function (p) { return p.type === 'prayer' || p.type === 'thanksgiving'; });
    } else if (channel === 'announcements') {
      filtered = posts.filter(function (p) { return p.type === 'announcement'; });
    } else if (channel === 'bible') {
      filtered = posts.filter(function (p) { return p.type === 'bible'; });
    } else if (channel === 'discussion') {
      filtered = posts.filter(function (p) { return p.type === 'discussion'; });
    } else {
      filtered = posts;
    }
    renderFeed(filtered);
    // Update active nav
    document.querySelectorAll('.community-nav__link').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.channel === channel);
    });
    document.querySelectorAll('.feed-tab').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.channel === channel);
    });
  }

  // ── Bind post interaction handlers ──
  function bindPostActions() {
    document.querySelectorAll('.post-card__action[data-action="like"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!userSession) { alert('Sign in to like posts.'); return; }
        btn.classList.toggle('is-liked');
        var statEl = btn.closest('.post-card').querySelector('.post-card__stat');
        if (statEl) {
          var count = parseInt(statEl.textContent) || 0;
          statEl.textContent = (btn.classList.contains('is-liked') ? count + 1 : Math.max(0, count - 1)) + ' likes';
        }
      });
    });
    document.querySelectorAll('.comment-compose__input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          var text = input.value.trim();
          if (!text || !userSession) return;
          var commentsEl = input.closest('.post-card__comments');
          var commentHtml = '<div class="comment"><div class="comment__avatar">' + initials(userSession.name) + '</div><div class="comment__bubble"><div class="comment__author">' + escapeHtml(userSession.name) + '</div><div class="comment__text">' + escapeHtml(text) + '</div><div class="comment__meta"><span>Just now</span><a href="#">Like</a><a href="#">Reply</a></div></div></div>';
          commentsEl.insertAdjacentHTML('afterbegin', commentHtml);
          input.value = '';
          // Send to backend
          if (userSession.token) {
            postAction({ action: 'sendChatMessage', token: userSession.token, channel: 'main', text: text, msg_type: 'message', to_user: '' }).catch(function () {});
          }
        }
      });
    });
  }

  // ── Send new post ──
  async function sendPost(text, type) {
    if (!userSession || !text.trim()) return;
    var channel = type === 'prayer' ? 'prayer' : (type === 'thanksgiving' ? 'thanksgiving' : 'main');
    try {
      await postAction({ action: 'sendChatMessage', token: userSession.token, channel: channel, text: text, msg_type: type || 'message', to_user: '' });
      // Optimistic add
      var newPost = {
        id: 'local-' + Date.now(),
        type: type === 'prayer' ? 'prayer' : (type === 'thanksgiving' ? 'thanksgiving' : 'discussion'),
        author: userSession.name,
        text: text,
        timestamp: Date.now(),
        channel: channel,
        likes: 0,
        comments: []
      };
      posts.unshift(newPost);
      filterByChannel(activeChannel);
    } catch (e) {
      alert('Could not send post. Please try again.');
    }
  }

  // ── Init compose ──
  function initCompose() {
    var input = document.getElementById('compose-input');
    var postBtn = document.getElementById('compose-post-btn');
    var typeSelect = document.getElementById('compose-type');
    if (postBtn && input) {
      postBtn.addEventListener('click', function () {
        var type = typeSelect ? typeSelect.value : 'message';
        sendPost(input.value, type);
        input.value = '';
      });
    }
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          var type = typeSelect ? typeSelect.value : 'message';
          sendPost(input.value, type);
          input.value = '';
        }
      });
    }
  }

  // ── Bind nav & tab clicks ──
  function bindNavigation() {
    document.querySelectorAll('.community-nav__link[data-channel]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        filterByChannel(this.dataset.channel);
        // Close mobile nav
        var nav = document.querySelector('.community-nav');
        var overlay = document.querySelector('.community-nav-overlay');
        if (nav) nav.classList.remove('is-open');
        if (overlay) overlay.classList.remove('is-open');
      });
    });
    document.querySelectorAll('.feed-tab[data-channel]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        filterByChannel(this.dataset.channel);
      });
    });
    // Mobile nav toggle
    var mobileBtn = document.getElementById('community-mobile-nav-btn');
    var nav = document.querySelector('.community-nav');
    var overlay = document.querySelector('.community-nav-overlay');
    if (mobileBtn && nav) {
      mobileBtn.addEventListener('click', function () {
        nav.classList.toggle('is-open');
        if (overlay) overlay.classList.toggle('is-open');
      });
      if (overlay) {
        overlay.addEventListener('click', function () {
          nav.classList.remove('is-open');
          overlay.classList.remove('is-open');
        });
      }
    }
  }

  // ── Load all data and render ──
  async function init() {
    checkSession();
    bindNavigation();
    initCompose();

    // Show loading
    var feedEl = document.getElementById('community-posts-feed');
    if (feedEl) {
      feedEl.innerHTML = '<div class="post-card" style="padding:2rem;text-align:center;color:var(--color-text-muted);">Loading community feed...</div>';
    }

    // Load data in parallel
    var results = await Promise.allSettled([
      loadAnnouncements(),
      loadChatMessages('main'),
      loadChatMessages('prayer'),
      loadChatMessages('thanksgiving')
    ]);

    var announcements = results[0].status === 'fulfilled' ? results[0].value : [];
    var mainChat = results[1].status === 'fulfilled' ? results[1].value : [];
    var prayerChat = results[2].status === 'fulfilled' ? results[2].value : [];
    var thanksChat = results[3].status === 'fulfilled' ? results[3].value : [];

    // Merge and sort
    posts = announcements.concat(mainChat).concat(prayerChat).concat(thanksChat);
    posts.sort(function (a, b) { return b.timestamp - a.timestamp; });

    filterByChannel('home');
  }

  // Startup
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
