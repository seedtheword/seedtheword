/* ============================================================
   Content Studio — full-page super-admin dashboard
   SocialPulse-styled. Combines the field-log admin dashboard
   (Stats / Inventory / Members / Messages) with the Team Portal
   super-admin content publishing (Outreach Stories / Testimonies).

   Auth model:
   - Gate: requires a logged-in super_admin (localStorage
     'stwm-team-session' with role === 'super_admin').
   - Content actions authenticate with the session TOKEN.
   - Admin-dashboard actions (getAdminStats/Inventory/Members,
     setMemberRole, adminPostAnnouncement, getAnnouncements,
     getMemberNotes, editInventoryRow, adminDeleteInventoryRow)
     authenticate with the embedded ADMIN_HASH (same constant the
     legacy admin/field-log.html uses), so no backend change needed.
   ============================================================ */
(function () {
  'use strict';

  var CONFIG_URL = '../assets/data/site-config.json';
  var SESSION_KEY = 'stwm-team-session';
  // Same passphrase hash the legacy admin dashboard uses (field-log.html).
  var ADMIN_HASH = '2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440';

  var handlerUrl = null;
  var session = null;
  var activeSection = 'overview';
  var currentSub = 'stories';
  var storiesCache = [];
  var testimoniesCache = [];

  // ── Helpers ──
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }
  function isSuper(s) { return s && String(s.role || '').toLowerCase() === 'super_admin'; }
  async function getUrl() {
    if (handlerUrl) return handlerUrl;
    var cfg = await fetch(CONFIG_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); });
    handlerUrl = cfg.orderHandlerUrl;
    return handlerUrl;
  }
  async function post(data) {
    var url = await getUrl();
    var res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) });
    var text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new Error('Server error'); }
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : s); return d.innerHTML; }
  function boolYes(v) { return String(v).toUpperCase() === 'YES' || v === true; }
  function fmtDate(ts) { try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return String(ts || ''); } }
  function initials(name) { return String(name || '?').split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2); }
  function statusPill(pub) { return pub ? '<span class="sp-pill-tag sp-pill-tag--live">● Live</span>' : '<span class="sp-pill-tag sp-pill-tag--draft">Draft</span>'; }

  // ── Gate ──
  function renderGate(msg) {
    document.getElementById('sp-root').innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;">' +
      '<div class="sp-card" style="max-width:400px;width:100%;text-align:center;">' +
      '<div style="width:52px;height:52px;border-radius:14px;margin:0 auto 0.75rem;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.5rem;">✨</div>' +
      '<h1 style="font-family:var(--serif);font-size:1.3rem;font-weight:600;margin:0 0 0.3rem;">Content Studio</h1>' +
      '<p style="font-size:0.85rem;color:var(--sp-muted);margin:0 0 1.1rem;">' + esc(msg || 'Super-admin access required.') + '</p>' +
      '<a class="sp-pill sp-pill--green" href="../team.html" style="display:inline-flex;">Go to Team Portal</a>' +
      '</div></div>';
  }

  // ── Shell ──
  var SECTIONS = [
    { group: 'Workspace', items: [
      { id: 'overview', ico: '📊', label: 'Overview' }
    ]},
    { group: 'Content', items: [
      { id: 'content', ico: '✨', label: 'Content Studio' }
    ]},
    { group: 'Operations', items: [
      { id: 'inventory', ico: '📦', label: 'Inventory' },
      { id: 'members', ico: '👥', label: 'Members' },
      { id: 'messages', ico: '💬', label: 'Messages' }
    ]}
  ];

  function sectionMeta(id) {
    switch (id) {
      case 'overview': return { title: 'Overview', sub: 'Ministry performance at a glance', newLabel: null };
      case 'content': return { title: 'Content Studio', sub: 'Publish live across your News page', newLabel: '＋ New' };
      case 'inventory': return { title: 'Inventory', sub: 'Bibles & items logged in the field', newLabel: null };
      case 'members': return { title: 'Members', sub: 'Team roster & roles', newLabel: null };
      case 'messages': return { title: 'Messages', sub: 'Announcements & team requests', newLabel: null };
      default: return { title: '', sub: '', newLabel: null };
    }
  }

  function renderShell() {
    var navHtml = SECTIONS.map(function (grp) {
      return '<div class="sp-nav__group">' + esc(grp.group) + '</div>' +
        grp.items.map(function (it) {
          return '<button class="sp-nav__item" data-section="' + it.id + '"><span class="sp-nav__ico">' + it.ico + '</span>' + esc(it.label) + '</button>';
        }).join('');
    }).join('');

    document.getElementById('sp-root').innerHTML =
      '<div class="sp-app">' +
        '<aside class="sp-side">' +
          '<div class="sp-brand"><div class="sp-brand__mark">✦</div><div><div class="sp-brand__name">Seed the Word</div><div class="sp-brand__sub">Content Studio</div></div></div>' +
          '<nav class="sp-nav" id="sp-nav">' + navHtml + '</nav>' +
          '<div class="sp-side__foot">' +
            '<div class="sp-tip"><b>Tip</b> — Published content goes live on the public site within a couple of minutes.</div>' +
            '<div class="sp-user"><div class="sp-user__av">' + esc(initials(session.name)) + '</div><div><div class="sp-user__name">' + esc(session.name || 'Super-admin') + '</div><div class="sp-user__role">Super-admin</div></div></div>' +
          '</div>' +
        '</aside>' +
        '<div class="sp-main">' +
          '<div class="sp-top"><div><h1 class="sp-top__title" id="sp-title">Overview</h1><p class="sp-top__sub" id="sp-sub"></p></div>' +
          '<div class="sp-top__actions" id="sp-actions">' +
            '<a class="sp-pill" href="../team.html">← Portal</a>' +
          '</div></div>' +
          '<div class="sp-content" id="sp-section"></div>' +
        '</div>' +
      '</div>';

    document.getElementById('sp-nav').addEventListener('click', function (e) {
      var btn = e.target.closest('.sp-nav__item');
      if (btn) selectSection(btn.dataset.section);
    });

    selectSection('overview');
  }

  function selectSection(id) {
    activeSection = id;
    document.querySelectorAll('.sp-nav__item').forEach(function (b) {
      b.classList.toggle('sp-nav__item--active', b.dataset.section === id);
    });
    var meta = sectionMeta(id);
    document.getElementById('sp-title').textContent = meta.title;
    document.getElementById('sp-sub').textContent = meta.sub;
    // Rebuild top actions: keep Portal link, add a New pill for Content
    var actions = document.getElementById('sp-actions');
    actions.innerHTML = (meta.newLabel ? '<button class="sp-pill sp-pill--green" id="sp-new">' + esc(meta.newLabel) + '</button>' : '') +
      '<a class="sp-pill" href="../team.html">← Portal</a>';
    if (meta.newLabel) {
      var nb = document.getElementById('sp-new');
      if (nb) nb.addEventListener('click', onNew);
    }
    var host = document.getElementById('sp-section');
    host.innerHTML = '<div class="sp-card"><p class="sp-empty">Loading…</p></div>';
    if (id === 'overview') renderOverview(host);
    else if (id === 'content') renderContent(host);
    else if (id === 'inventory') renderInventory(host);
    else if (id === 'members') renderMembers(host);
    else if (id === 'messages') renderMessages(host);
  }

  function onNew() {
    if (activeSection !== 'content') return;
    if (currentSub === 'stories') { resetStoryForm(); var t = document.getElementById('story-title'); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.focus(); } }
    else { resetTestimonyForm(); var n = document.getElementById('testimony-name'); if (n) { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n.focus(); } }
  }

  // ══ OVERVIEW (getAdminStats via ADMIN_HASH) ══
  async function renderOverview(host) {
    try {
      var res = await post({ action: 'getAdminStats', passphrase_hash: ADMIN_HASH });
      if (!res.ok) throw new Error(res.error || 'Failed');
      var html =
        '<div class="sp-stats">' +
          '<div class="sp-stat"><span class="sp-stat__dot"></span><p class="sp-stat__label">Total Scans</p><div class="sp-stat__num">' + esc(res.total_scans || 0) + '</div><p class="sp-stat__hint"><b>' + esc(res.today_scans || 0) + '</b> today</p></div>' +
          '<div class="sp-stat"><span class="sp-stat__dot sp-stat__dot--blue"></span><p class="sp-stat__label">Team Members</p><div class="sp-stat__num">' + esc(res.total_members || 0) + '</div><p class="sp-stat__hint">active roster</p></div>' +
          '<div class="sp-stat"><span class="sp-stat__dot sp-stat__dot--amber"></span><p class="sp-stat__label">Total Value</p><div class="sp-stat__num">$' + esc((res.total_cost || 0).toFixed(2)) + '</div><p class="sp-stat__hint">items logged</p></div>' +
          '<div class="sp-stat"><span class="sp-stat__dot"></span><p class="sp-stat__label">Today</p><div class="sp-stat__num">' + esc(res.today_scans || 0) + '</div><p class="sp-stat__hint">scans today</p></div>' +
        '</div>';
      if (res.per_member && res.per_member.length) {
        html += '<div class="sp-card"><h3 class="sp-card__title">Per-member breakdown</h3><p class="sp-card__sub">Scans and value by team member</p>' +
          '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Member</th><th>Scans</th><th>Value</th><th>Last active</th></tr></thead><tbody>' +
          res.per_member.map(function (m) {
            return '<tr><td><strong>' + esc(m.name) + '</strong></td><td>' + esc(m.scans) + '</td><td>$' + esc((m.cost || 0).toFixed(2)) + '</td><td>' + esc(m.last_date || '—') + '</td></tr>';
          }).join('') +
          '</tbody></table></div></div>';
      }
      host.innerHTML = html;
    } catch (e) { host.innerHTML = '<div class="sp-card"><p class="sp-err">Error: ' + esc(e.message) + '</p></div>'; }
  }

  // ══ INVENTORY (getAdminInventory / editInventoryRow / adminDeleteInventoryRow via ADMIN_HASH) ══
  async function renderInventory(host) {
    try {
      var res = await post({ action: 'getAdminInventory', passphrase_hash: ADMIN_HASH });
      if (!res.ok) throw new Error(res.error || 'Failed');
      if (!res.rows || !res.rows.length) { host.innerHTML = '<div class="sp-card"><p class="sp-empty">No inventory records yet.</p></div>'; return; }
      host.innerHTML = '<div class="sp-card"><h3 class="sp-card__title">Recent inventory</h3><p class="sp-card__sub">Last 100 logged items</p>' +
        '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Member</th><th>Event</th><th></th></tr></thead><tbody>' +
        res.rows.map(function (r) {
          return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.item_name) + '</td><td>' + esc(r.qty) + '</td><td>' + esc(r.member) + '</td><td>' + esc(r.event) + '</td>' +
            '<td style="white-space:nowrap;"><button class="sp-iconbtn inv-edit" data-row="' + esc(r.row_id) + '" title="Edit qty">✏️</button> ' +
            '<button class="sp-iconbtn sp-iconbtn--danger inv-del" data-row="' + esc(r.row_id) + '" data-name="' + esc(r.item_name) + '" title="Delete">×</button></td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
      host.querySelectorAll('.inv-edit').forEach(function (b) {
        b.addEventListener('click', function () {
          var qty = prompt('New quantity:', 1); if (!qty) return;
          post({ action: 'editInventoryRow', token: 'admin', passphrase_hash: ADMIN_HASH, row_id: this.dataset.row, new_qty: parseInt(qty) || 1 }).then(function () { renderInventory(host); }).catch(function (e) { alert(e.message); });
        });
      });
      host.querySelectorAll('.inv-del').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Delete "' + this.dataset.name + '"?')) return;
          post({ action: 'adminDeleteInventoryRow', passphrase_hash: ADMIN_HASH, row_id: this.dataset.row }).then(function () { renderInventory(host); }).catch(function (e) { alert(e.message); });
        });
      });
    } catch (e) { host.innerHTML = '<div class="sp-card"><p class="sp-err">Error: ' + esc(e.message) + '</p></div>'; }
  }

  // ══ MEMBERS (getAdminMembers / setMemberRole via ADMIN_HASH) ══
  async function renderMembers(host) {
    try {
      var res = await post({ action: 'getAdminMembers', passphrase_hash: ADMIN_HASH });
      if (!res.ok) throw new Error(res.error || 'Failed');
      if (!res.members || !res.members.length) { host.innerHTML = '<div class="sp-card"><p class="sp-empty">No members.</p></div>'; return; }
      host.innerHTML = '<div class="sp-card"><h3 class="sp-card__title">Team members</h3><p class="sp-card__sub">Change a role to promote or demote</p>' +
        '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Scans</th></tr></thead><tbody>' +
        res.members.map(function (m) {
          return '<tr><td><strong>' + esc(m.name) + '</strong></td>' +
            '<td><select class="sp-select role-select" data-name="' + esc(m.name) + '" style="padding:0.3rem 0.5rem;font-size:0.76rem;width:auto;">' +
            '<option value="member"' + (m.role === 'member' ? ' selected' : '') + '>Member</option>' +
            '<option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '<option value="super_admin"' + (m.role === 'super_admin' ? ' selected' : '') + '>Super Admin</option>' +
            '</select></td><td>' + esc(m.email || '—') + '</td><td>' + esc(m.scans) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div>';
      host.querySelectorAll('.role-select').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var name = this.dataset.name, role = this.value;
          post({ action: 'setMemberRole', passphrase_hash: ADMIN_HASH, member_name: name, new_role: role }).then(function () { alert('Role updated.'); }).catch(function (e) { alert(e.message); });
        });
      });
    } catch (e) { host.innerHTML = '<div class="sp-card"><p class="sp-err">Error: ' + esc(e.message) + '</p></div>'; }
  }

  // ══ MESSAGES (adminPostAnnouncement / getAnnouncements / getMemberNotes via ADMIN_HASH) ══
  function renderMessages(host) {
    host.innerHTML =
      '<div class="sp-card"><h3 class="sp-card__title">Post announcement</h3><p class="sp-card__sub">Shown in the portal and optionally sent to Telegram</p>' +
        '<div class="sp-field"><label>Priority</label><select class="sp-select" id="ann-pri"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div>' +
        '<div class="sp-field"><label>Subject</label><input class="sp-input" id="ann-subj" placeholder="Subject…"></div>' +
        '<div class="sp-field"><label>Message</label><textarea class="sp-textarea" id="ann-body" rows="3" placeholder="Message…"></textarea></div>' +
        '<label class="sp-check" style="margin-bottom:0.7rem;"><input type="checkbox" id="ann-tg" checked> Send to Telegram</label>' +
        '<div class="sp-status" id="ann-status"></div>' +
        '<button class="sp-btn sp-btn--green" id="ann-send">Post announcement</button>' +
      '</div>' +
      '<div class="sp-card"><h3 class="sp-card__title">Recent announcements</h3><div id="ann-feed"><p class="sp-empty">Loading…</p></div></div>' +
      '<div class="sp-card"><h3 class="sp-card__title">Edit requests from team</h3><div id="edit-reqs"><p class="sp-empty">Loading…</p></div></div>';

    document.getElementById('ann-send').addEventListener('click', async function () {
      var subj = document.getElementById('ann-subj').value.trim();
      var body = document.getElementById('ann-body').value.trim();
      var pri = document.getElementById('ann-pri').value;
      var tg = document.getElementById('ann-tg').checked;
      var status = document.getElementById('ann-status');
      if (!subj || !body) { status.textContent = 'Fill in subject and message.'; status.style.color = 'var(--sp-red)'; return; }
      this.disabled = true; this.textContent = 'Posting…'; status.textContent = '';
      try {
        await post({ action: 'adminPostAnnouncement', passphrase_hash: ADMIN_HASH, subject: subj, body: body, priority: pri, send_telegram: tg, author: session.name || 'Admin' });
        document.getElementById('ann-subj').value = ''; document.getElementById('ann-body').value = '';
        status.textContent = '✓ Posted'; status.style.color = 'var(--sp-green-dark)';
        loadAnnouncements();
      } catch (e) { status.textContent = e.message; status.style.color = 'var(--sp-red)'; }
      this.disabled = false; this.textContent = 'Post announcement';
    });

    loadAnnouncements();
    loadEditRequests();
  }
  async function loadAnnouncements() {
    var feed = document.getElementById('ann-feed'); if (!feed) return;
    try {
      var res = await post({ action: 'getAnnouncements', passphrase_hash: ADMIN_HASH });
      if (res.ok && res.announcements && res.announcements.length) {
        feed.innerHTML = res.announcements.slice(0, 20).map(function (a) {
          return '<div class="sp-listrow"><div class="sp-listrow__info"><div class="sp-listrow__title">' + esc(a.subject) + '</div>' +
            '<div class="sp-listrow__meta">' + esc(a.priority) + ' · ' + esc(a.author) + ' · ' + esc(fmtDate(a.timestamp)) + '</div>' +
            '<p style="font-size:0.82rem;color:var(--sp-ink2);margin:0.3rem 0 0;line-height:1.5;">' + esc(a.body) + '</p></div></div>';
        }).join('');
      } else { feed.innerHTML = '<p class="sp-empty">No announcements.</p>'; }
    } catch (e) { feed.innerHTML = '<p class="sp-err">Error loading announcements.</p>'; }
  }
  async function loadEditRequests() {
    var c = document.getElementById('edit-reqs'); if (!c) return;
    try {
      var res = await post({ action: 'getMemberNotes', passphrase_hash: ADMIN_HASH, member: 'Edit Requests' });
      if (res.ok && res.notes && res.notes.length) {
        c.innerHTML = res.notes.map(function (n) {
          return '<div class="sp-listrow"><div class="sp-listrow__info"><div class="sp-listrow__title">' + esc(n.author) + '</div><div class="sp-listrow__meta">' + esc(fmtDate(n.timestamp)) + '</div><p style="font-size:0.82rem;color:var(--sp-ink2);margin:0.3rem 0 0;">' + esc(n.text) + '</p></div></div>';
        }).join('');
      } else { c.innerHTML = '<p class="sp-empty">No pending edit requests.</p>'; }
    } catch (e) { c.innerHTML = '<p class="sp-err">Error loading requests.</p>'; }
  }

  // ══ CONTENT (Outreach stories + Testimonies via session TOKEN) ══
  function renderContent(host) {
    host.innerHTML =
      '<div class="sp-metrics">' +
        '<button type="button" class="sp-stat csub csub--active" data-csub="stories" style="cursor:pointer;text-align:left;">' +
          '<span class="sp-stat__dot"></span><p class="sp-stat__label">📸 Outreach Stories</p><div class="sp-stat__num" id="c-stories-count">–</div><p class="sp-stat__hint"><b id="c-stories-live">0</b> live</p></button>' +
        '<button type="button" class="sp-stat csub" data-csub="testimonies" style="cursor:pointer;text-align:left;">' +
          '<span class="sp-stat__dot sp-stat__dot--blue"></span><p class="sp-stat__label">🗣️ Testimonies</p><div class="sp-stat__num" id="c-testimonies-count">–</div><p class="sp-stat__hint"><b id="c-testimonies-live">0</b> live</p></button>' +
      '</div>' +

      // Stories sub-panel
      '<div id="sub-stories">' +
        '<div class="sp-card"><h3 class="sp-card__title">➕ <span id="story-mode">New</span> outreach story</h3>' +
          '<form id="story-form">' +
            '<input type="hidden" id="story-id">' +
            '<div class="sp-row"><div class="sp-field"><label>Date</label><input type="date" class="sp-input" id="story-date"></div>' +
            '<div class="sp-field"><label>Sort order</label><input type="number" class="sp-input" id="story-sort" placeholder="0" step="1"></div></div>' +
            '<div class="sp-field"><label>Title</label><input class="sp-input" id="story-title" placeholder="e.g. Bellevue Park Outreach"></div>' +
            '<div class="sp-field"><label>Location</label><input class="sp-input" id="story-location" placeholder="e.g. Bellevue, WA"></div>' +
            '<div class="sp-field"><label>Story</label><textarea class="sp-textarea" id="story-body" rows="3" placeholder="What happened? A few sentences."></textarea></div>' +
            '<div class="sp-field"><label>Image URL</label><input type="url" class="sp-input" id="story-image" placeholder="https://… public image link"></div>' +
            '<label class="sp-check" style="margin-bottom:0.7rem;"><input type="checkbox" id="story-pub"> Published (visible on News)</label>' +
            '<div class="sp-status" id="story-status"></div>' +
            '<div style="display:flex;gap:0.5rem;"><button type="submit" class="sp-btn sp-btn--green" style="flex:1;">💾 Save story</button><button type="button" class="sp-btn sp-btn--ghost" id="story-reset">Clear</button></div>' +
          '</form></div>' +
        '<div class="sp-card"><h3 class="sp-card__title">All outreach stories</h3><div id="stories-list"><p class="sp-empty">Loading…</p></div></div>' +
      '</div>' +

      // Testimonies sub-panel
      '<div id="sub-testimonies" class="sp-sub-hidden">' +
        '<div class="sp-card"><h3 class="sp-card__title">➕ <span id="testimony-mode">New</span> testimony</h3>' +
          '<form id="testimony-form">' +
            '<input type="hidden" id="testimony-id">' +
            '<div class="sp-row"><div class="sp-field"><label>Name</label><input class="sp-input" id="testimony-name" placeholder="First or full name"></div>' +
            '<div class="sp-field"><label>Published date</label><input type="date" class="sp-input" id="testimony-date"></div></div>' +
            '<label class="sp-check" style="margin-bottom:0.7rem;"><input type="checkbox" id="testimony-anon"> Show as anonymous</label>' +
            '<div class="sp-field"><label>Short excerpt</label><input class="sp-input" id="testimony-excerpt" placeholder="One-line pull quote"></div>' +
            '<div class="sp-field"><label>Full testimony</label><textarea class="sp-textarea" id="testimony-body" rows="4" placeholder="The full story in their words."></textarea></div>' +
            '<div class="sp-row"><div class="sp-field"><label>Anchor verse</label><input class="sp-input" id="testimony-verse" placeholder="e.g. John 3:16"></div>' +
            '<div class="sp-field"><label>Media URL</label><input type="url" class="sp-input" id="testimony-media" placeholder="https://… optional"></div></div>' +
            '<label class="sp-check" style="margin-bottom:0.7rem;"><input type="checkbox" id="testimony-pub"> Published (visible on site)</label>' +
            '<div class="sp-status" id="testimony-status"></div>' +
            '<div style="display:flex;gap:0.5rem;"><button type="submit" class="sp-btn sp-btn--green" style="flex:1;">💾 Save testimony</button><button type="button" class="sp-btn sp-btn--ghost" id="testimony-reset">Clear</button></div>' +
          '</form></div>' +
        '<div class="sp-card"><h3 class="sp-card__title">All testimonies</h3><div id="testimonies-list"><p class="sp-empty">Loading…</p></div></div>' +
      '</div>';

    // Sub-tab switching
    host.querySelectorAll('.csub').forEach(function (btn) {
      btn.addEventListener('click', function () { showSub(this.dataset.csub); });
    });
    // Story form
    document.getElementById('story-form').addEventListener('submit', onSaveStory);
    document.getElementById('story-reset').addEventListener('click', resetStoryForm);
    // Testimony form
    document.getElementById('testimony-form').addEventListener('submit', onSaveTestimony);
    document.getElementById('testimony-reset').addEventListener('click', resetTestimonyForm);

    showSub(currentSub);
    loadStories();
    loadTestimonies();
  }

  function showSub(which) {
    currentSub = which;
    document.querySelectorAll('.csub').forEach(function (b) { b.classList.toggle('csub--active', b.dataset.csub === which); b.classList.toggle('sp-stat--active', b.dataset.csub === which); });
    var st = document.getElementById('sub-stories');
    var te = document.getElementById('sub-testimonies');
    if (st) st.classList.toggle('sp-sub-hidden', which !== 'stories');
    if (te) te.classList.toggle('sp-sub-hidden', which !== 'testimonies');
  }

  // ── Stories ──
  async function loadStories() {
    var list = document.getElementById('stories-list'); if (!list) return;
    try {
      var res = await post({ action: 'listOutreachStories', token: session.token });
      if (res.ok && res.stories) { storiesCache = res.stories; renderStoriesList(); }
      else { list.innerHTML = '<p class="sp-err">' + esc(res.error || 'Could not load stories.') + '</p>'; }
    } catch (e) { list.innerHTML = '<p class="sp-empty">Backend not reachable. Deploy the content handler and try again.</p>'; }
  }
  function renderStoriesList() {
    var list = document.getElementById('stories-list'); if (!list) return;
    var cnt = document.getElementById('c-stories-count'); var live = document.getElementById('c-stories-live');
    if (cnt) cnt.textContent = storiesCache.length;
    if (live) live.textContent = storiesCache.filter(function (s) { return boolYes(s.published); }).length;
    if (!storiesCache.length) { list.innerHTML = '<p class="sp-empty">No stories yet.</p>'; return; }
    list.innerHTML = storiesCache.map(function (s, i) {
      return '<div class="sp-listrow"><div class="sp-listrow__ico">📸</div><div class="sp-listrow__info">' +
        '<div class="sp-listrow__title">' + esc(s.title || 'Untitled') + '</div>' +
        '<div class="sp-listrow__meta">' + esc(s.date || '') + (s.location ? ' · ' + esc(s.location) : '') + ' ' + statusPill(boolYes(s.published)) + '</div></div>' +
        '<button class="sp-iconbtn story-edit" data-idx="' + i + '" title="Edit">✏️</button>' +
        '<button class="sp-iconbtn sp-iconbtn--danger story-del" data-idx="' + i + '" title="Delete">×</button></div>';
    }).join('');
    list.querySelectorAll('.story-edit').forEach(function (b) { b.addEventListener('click', function () { editStory(parseInt(this.dataset.idx)); }); });
    list.querySelectorAll('.story-del').forEach(function (b) { b.addEventListener('click', function () { deleteStory(parseInt(this.dataset.idx)); }); });
  }
  function editStory(idx) {
    var s = storiesCache[idx]; if (!s) return;
    document.getElementById('story-id').value = s.id || '';
    document.getElementById('story-date').value = s.date || '';
    document.getElementById('story-sort').value = s.sort_order || '';
    document.getElementById('story-title').value = s.title || '';
    document.getElementById('story-location').value = s.location || '';
    document.getElementById('story-body').value = s.body || '';
    document.getElementById('story-image').value = s.image_url || '';
    document.getElementById('story-pub').checked = boolYes(s.published);
    document.getElementById('story-mode').textContent = 'Edit';
    document.getElementById('story-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function resetStoryForm() {
    var f = document.getElementById('story-form'); if (!f) return; f.reset();
    document.getElementById('story-id').value = '';
    document.getElementById('story-mode').textContent = 'New';
    document.getElementById('story-status').textContent = '';
  }
  async function deleteStory(idx) {
    var s = storiesCache[idx]; if (!s) return;
    if (!confirm('Delete story "' + (s.title || 'Untitled') + '"?')) return;
    try { var res = await post({ action: 'deleteOutreachStory', token: session.token, id: s.id }); if (res.ok) loadStories(); else alert(res.error || 'Delete failed.'); }
    catch (e) { alert('Could not delete: ' + e.message); }
  }
  async function onSaveStory(e) {
    e.preventDefault();
    var status = document.getElementById('story-status');
    var title = document.getElementById('story-title').value.trim();
    if (!title) { status.textContent = 'Title is required.'; status.style.color = 'var(--sp-red)'; return; }
    var story = {
      id: document.getElementById('story-id').value.trim(),
      date: document.getElementById('story-date').value,
      title: title,
      location: document.getElementById('story-location').value.trim(),
      body: document.getElementById('story-body').value.trim(),
      image_url: document.getElementById('story-image').value.trim(),
      sort_order: document.getElementById('story-sort').value,
      published: document.getElementById('story-pub').checked ? 'YES' : 'NO'
    };
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving…'; status.textContent = '';
    try {
      var res = await post({ action: 'saveOutreachStory', token: session.token, story: story });
      if (res.ok) { status.textContent = '✓ Saved'; status.style.color = 'var(--sp-green-dark)'; resetStoryForm(); loadStories(); }
      else { status.textContent = res.error || 'Save failed.'; status.style.color = 'var(--sp-red)'; }
    } catch (err) { status.textContent = 'Could not save: ' + err.message; status.style.color = 'var(--sp-red)'; }
    finally { btn.disabled = false; btn.textContent = '💾 Save story'; }
  }

  // ── Testimonies ──
  async function loadTestimonies() {
    var list = document.getElementById('testimonies-list'); if (!list) return;
    try {
      var res = await post({ action: 'listTestimonies', token: session.token });
      if (res.ok && res.testimonies) { testimoniesCache = res.testimonies; renderTestimoniesList(); }
      else { list.innerHTML = '<p class="sp-err">' + esc(res.error || 'Could not load testimonies.') + '</p>'; }
    } catch (e) { list.innerHTML = '<p class="sp-empty">Backend not reachable. Deploy the content handler and try again.</p>'; }
  }
  function renderTestimoniesList() {
    var list = document.getElementById('testimonies-list'); if (!list) return;
    var cnt = document.getElementById('c-testimonies-count'); var live = document.getElementById('c-testimonies-live');
    if (cnt) cnt.textContent = testimoniesCache.length;
    if (live) live.textContent = testimoniesCache.filter(function (t) { return boolYes(t.published); }).length;
    if (!testimoniesCache.length) { list.innerHTML = '<p class="sp-empty">No testimonies yet.</p>'; return; }
    list.innerHTML = testimoniesCache.map(function (t, i) {
      var anon = boolYes(t.anonymous);
      var name = anon ? 'Anonymous' : (t.name || 'Unnamed');
      return '<div class="sp-listrow"><div class="sp-listrow__ico">🗣️</div><div class="sp-listrow__info">' +
        '<div class="sp-listrow__title">' + esc(name) + '</div>' +
        '<div class="sp-listrow__meta">' + esc(t.excerpt || (t.body || '').slice(0, 50)) + ' ' + statusPill(boolYes(t.published)) + '</div></div>' +
        '<button class="sp-iconbtn t-edit" data-idx="' + i + '" title="Edit">✏️</button>' +
        '<button class="sp-iconbtn sp-iconbtn--danger t-del" data-idx="' + i + '" title="Delete">×</button></div>';
    }).join('');
    list.querySelectorAll('.t-edit').forEach(function (b) { b.addEventListener('click', function () { editTestimony(parseInt(this.dataset.idx)); }); });
    list.querySelectorAll('.t-del').forEach(function (b) { b.addEventListener('click', function () { deleteTestimony(parseInt(this.dataset.idx)); }); });
  }
  function editTestimony(idx) {
    var t = testimoniesCache[idx]; if (!t) return;
    document.getElementById('testimony-id').value = t.id || '';
    document.getElementById('testimony-name').value = t.name || '';
    document.getElementById('testimony-date').value = t.published_at || '';
    document.getElementById('testimony-anon').checked = boolYes(t.anonymous);
    document.getElementById('testimony-excerpt').value = t.excerpt || '';
    document.getElementById('testimony-body').value = t.body || '';
    document.getElementById('testimony-verse').value = t.anchor_verse || '';
    document.getElementById('testimony-media').value = t.media_url || '';
    document.getElementById('testimony-pub').checked = boolYes(t.published);
    document.getElementById('testimony-mode').textContent = 'Edit';
    document.getElementById('testimony-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function resetTestimonyForm() {
    var f = document.getElementById('testimony-form'); if (!f) return; f.reset();
    document.getElementById('testimony-id').value = '';
    document.getElementById('testimony-mode').textContent = 'New';
    document.getElementById('testimony-status').textContent = '';
  }
  async function deleteTestimony(idx) {
    var t = testimoniesCache[idx]; if (!t) return;
    if (!confirm('Delete this testimony?')) return;
    try { var res = await post({ action: 'deleteTestimony', token: session.token, id: t.id }); if (res.ok) loadTestimonies(); else alert(res.error || 'Delete failed.'); }
    catch (e) { alert('Could not delete: ' + e.message); }
  }
  async function onSaveTestimony(e) {
    e.preventDefault();
    var status = document.getElementById('testimony-status');
    var anon = document.getElementById('testimony-anon').checked;
    var name = document.getElementById('testimony-name').value.trim();
    if (!anon && !name) { status.textContent = 'Add a name or mark anonymous.'; status.style.color = 'var(--sp-red)'; return; }
    var testimony = {
      id: document.getElementById('testimony-id').value.trim(),
      name: name,
      anonymous: anon ? 'YES' : 'NO',
      published_at: document.getElementById('testimony-date').value,
      excerpt: document.getElementById('testimony-excerpt').value.trim(),
      body: document.getElementById('testimony-body').value.trim(),
      anchor_verse: document.getElementById('testimony-verse').value.trim(),
      media_url: document.getElementById('testimony-media').value.trim(),
      published: document.getElementById('testimony-pub').checked ? 'YES' : 'NO'
    };
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Saving…'; status.textContent = '';
    try {
      var res = await post({ action: 'saveTestimony', token: session.token, testimony: testimony });
      if (res.ok) { status.textContent = '✓ Saved'; status.style.color = 'var(--sp-green-dark)'; resetTestimonyForm(); loadTestimonies(); }
      else { status.textContent = res.error || 'Save failed.'; status.style.color = 'var(--sp-red)'; }
    } catch (err) { status.textContent = 'Could not save: ' + err.message; status.style.color = 'var(--sp-red)'; }
    finally { btn.disabled = false; btn.textContent = '💾 Save testimony'; }
  }

  // ── Boot ──
  session = getSession();
  if (!session || !session.name) { renderGate('Please log in to the Team Portal first.'); return; }
  if (!isSuper(session)) { renderGate('This studio is for super-admins only.'); return; }
  renderShell();

})();
