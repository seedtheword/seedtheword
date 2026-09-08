/**
 * Team Messaging Handlers — Paste into order-handler.gs
 * ─────────────────────────────────────────────────────
 *
 * ADD these routing lines to the doPost() function (after the existing
 * teamSignup/teamLogin checks):
 *
 *   if ((payload && payload.action) === 'postAnnouncement') return handlePostAnnouncement_(payload);
 *   if ((payload && payload.action) === 'getAnnouncements') return handleGetAnnouncements_(payload);
 *   if ((payload && payload.action) === 'sendDm') return handleSendDm_(payload);
 *   if ((payload && payload.action) === 'getDmContacts') return handleGetDmContacts_(payload);
 *   if ((payload && payload.action) === 'getDmMessages') return handleGetDmMessages_(payload);
 *   if ((payload && payload.action) === 'addMemberNote') return handleAddMemberNote_(payload);
 *   if ((payload && payload.action) === 'getMemberNotes') return handleGetMemberNotes_(payload);
 *   if ((payload && payload.action) === 'getNoteMembers') return handleGetNoteMembers_(payload);
 *
 * ALSO update handleTeamLogin_ to return role and telegram_username:
 *   Change the success return to:
 *     return jsonResponse({ ok: true, route: 'teamLogin', token: data[i][0], name: data[i][1],
 *       role: data[i][5] || 'member', total_scans: parseInt(data[i][7]) || 0,
 *       telegram_username: data[i][8] || '' });
 *
 * ALSO update handleTeamSignup_ to accept telegram_username:
 *   After the line that creates the row array, add telegram_username as col 9:
 *     var telegram = String(payload.telegram_username || '').trim();
 *   And add it to the row: [...existing, telegram]
 *
 * SHEET TABS NEEDED (auto-created if missing):
 *   - Announcements: timestamp | author | subject | body | priority | telegram_sent | dedup_key
 *   - DirectMessages: timestamp | from_user | to_user | text | telegram_notified
 *   - MemberNotes: timestamp | member | author | category | text
 *
 * TELEGRAM CONFIG:
 *   The bot token is in Script Properties as 'TELEGRAM_BOT_TOKEN'.
 *   Announcements go to @seedtheword thread 553.
 *   DM notifications go as private messages via the recipient's telegram username.
 */

// ── Sheet helpers ─────────────────────────────────────────────────────

function getAnnouncementsSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('Announcements');
  if (!sheet) {
    sheet = ss.insertSheet('Announcements');
    sheet.getRange(1,1,1,7).setValues([['timestamp','author','subject','body','priority','telegram_sent','dedup_key']]);
    sheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getDmSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('DirectMessages');
  if (!sheet) {
    sheet = ss.insertSheet('DirectMessages');
    sheet.getRange(1,1,1,6).setValues([['timestamp','from_user','to_user','text','telegram_notified','read_at']]);
    sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  // Ensure the read_at column exists on pre-existing sheets (unread tracking).
  try { ensureColumn_(sheet, 'read_at'); } catch (e) {}
  return sheet;
}

// ── Phase 2 DM: per-member settings (blocking + reachability) ──────────
// DmSettings: member | blocked_json (array of names they've blocked) |
//             restricted ('YES'|'') | allowed_json (array of names allowed
//             to reach them when restricted)
function getDmSettingsSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('DmSettings');
  if (!sheet) {
    sheet = ss.insertSheet('DmSettings');
    sheet.getRange(1,1,1,4).setValues([['member','blocked_json','restricted','allowed_json']]);
    sheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// DmReports: timestamp | reporter | reported | reason | status
function getDmReportsSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('DmReports');
  if (!sheet) {
    sheet = ss.insertSheet('DmReports');
    sheet.getRange(1,1,1,5).setValues([['timestamp','reporter','reported','reason','status']]);
    sheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// NotifyLog: throttle stamps so we email at most once per (recipient,
// counterparty, kind) per day. kind = 'dm' | 'prayer' | 'thanksgiving'.
// key columns: recipient | counterparty | kind | date(YYYY-MM-DD)
function getNotifyLogSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('NotifyLog');
  if (!sheet) {
    sheet = ss.insertSheet('NotifyLog');
    sheet.getRange(1,1,1,4).setValues([['recipient','counterparty','kind','date']]);
    sheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Look up a team member's email + notify preference by display name.
// Returns { email, notify_pref } (email '' if none). Cached per execution.
var _teamEmailCache = null;
function getTeamMemberEmail_(name) {
  if (!name) return { email: '', notify_pref: 'email' };
  if (!_teamEmailCache) {
    _teamEmailCache = {};
    try {
      var sh = getTeamSheet_();
      if (sh.getLastRow() >= 2) {
        var lastCol = sh.getLastColumn();
        var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
        var notifyIdx = -1;
        for (var h = 0; h < headers.length; h++) {
          if (String(headers[h]).trim().toLowerCase() === 'notify_pref') { notifyIdx = h; break; }
        }
        var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
        for (var i = 0; i < d.length; i++) {
          _teamEmailCache[String(d[i][1]).toLowerCase().trim()] = {
            email: String(d[i][3] || '').trim(),                 // col D
            notify_pref: notifyIdx >= 0 ? String(d[i][notifyIdx] || 'email') : 'email'
          };
        }
      }
    } catch (e) {}
  }
  return _teamEmailCache[String(name).toLowerCase().trim()] || { email: '', notify_pref: 'email' };
}

// Read a member's DM settings row → { blocked:[], restricted:bool, allowed:[] }.
function getDmSettingsFor_(name) {
  var out = { blocked: [], restricted: false, allowed: [] };
  if (!name) return out;
  try {
    var sheet = getDmSettingsSheet_();
    if (sheet.getLastRow() < 2) return out;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    var lc = String(name).toLowerCase().trim();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === lc) {
        try { out.blocked = JSON.parse(data[i][1] || '[]') || []; } catch (e) {}
        out.restricted = String(data[i][2]).toUpperCase() === 'YES';
        try { out.allowed = JSON.parse(data[i][3] || '[]') || []; } catch (e) {}
        break;
      }
    }
  } catch (e) {}
  return out;
}

// Upsert a member's DmSettings row (partial: only provided fields change).
function setDmSettingsFor_(name, patch) {
  var sheet = getDmSettingsSheet_();
  var lc = String(name).toLowerCase().trim();
  var last = sheet.getLastRow();
  var rowIdx = -1, cur = { blocked: [], restricted: false, allowed: [] };
  if (last >= 2) {
    var data = sheet.getRange(2, 1, last - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase().trim() === lc) {
        rowIdx = i + 2;
        try { cur.blocked = JSON.parse(data[i][1] || '[]') || []; } catch (e) {}
        cur.restricted = String(data[i][2]).toUpperCase() === 'YES';
        try { cur.allowed = JSON.parse(data[i][3] || '[]') || []; } catch (e) {}
        break;
      }
    }
  }
  if (patch.blocked !== undefined) cur.blocked = patch.blocked;
  if (patch.restricted !== undefined) cur.restricted = !!patch.restricted;
  if (patch.allowed !== undefined) cur.allowed = patch.allowed;
  var row = [name, JSON.stringify(cur.blocked), cur.restricted ? 'YES' : '', JSON.stringify(cur.allowed)];
  if (rowIdx > 0) sheet.getRange(rowIdx, 1, 1, 4).setValues([row]);
  else sheet.appendRow(row);
  return cur;
}

// Can sender A reach recipient B? Enforces block + reachability rules.
// super_admin sender always allowed. Returns { ok:bool, reason }.
function dmCanReach_(fromUser, fromRole, toUser) {
  if (String(fromRole || '').toLowerCase() === 'super_admin') return { ok: true };
  var st = getDmSettingsFor_(toUser);
  var fromLc = String(fromUser).toLowerCase().trim();
  // Blocked?
  for (var i = 0; i < st.blocked.length; i++) {
    if (String(st.blocked[i]).toLowerCase().trim() === fromLc) return { ok: false, reason: 'blocked' };
  }
  // Restricted → sender must be in allow-list.
  if (st.restricted) {
    var allowed = false;
    for (var j = 0; j < st.allowed.length; j++) {
      if (String(st.allowed[j]).toLowerCase().trim() === fromLc) { allowed = true; break; }
    }
    if (!allowed) return { ok: false, reason: 'restricted' };
  }
  return { ok: true };
}

// Throttled notify: emails `recipientName` at most once per (counterparty,kind)
// per day, and only when there's real new activity. Never sends "no messages".
// kind = 'dm' | 'prayer' | 'thanksgiving'. Returns true if an email went out.
function notifyThrottled_(recipientName, counterparty, kind, subject, htmlBody, plainBody) {
  try {
    var info = getTeamMemberEmail_(recipientName);
    if (!info.email || info.email.indexOf('@') === -1) return false;
    var pref = String(info.notify_pref || 'email').toLowerCase();
    if (pref === 'none') return false; // opted out
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var log = getNotifyLogSheet_();
    var last = log.getLastRow();
    var rl = String(recipientName).toLowerCase().trim();
    var cl = String(counterparty || '').toLowerCase().trim();
    if (last >= 2) {
      var d = log.getRange(2, 1, last - 1, 4).getValues();
      for (var i = 0; i < d.length; i++) {
        if (String(d[i][0]).toLowerCase().trim() === rl &&
            String(d[i][1]).toLowerCase().trim() === cl &&
            String(d[i][2]).toLowerCase().trim() === String(kind).toLowerCase() &&
            String(d[i][3]) === today) {
          return false; // already emailed for this counterparty+kind today
        }
      }
    }
    MailApp.sendEmail({ to: info.email, subject: subject, htmlBody: htmlBody, body: plainBody || subject, name: 'Seed the Word Ministry', noReply: true });
    log.appendRow([recipientName, counterparty || '', kind, today]);
    return true;
  } catch (e) { Logger.log('notifyThrottled_ error: ' + e); return false; }
}

function getMemberNotesSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('MemberNotes');
  if (!sheet) {
    sheet = ss.insertSheet('MemberNotes');
    sheet.getRange(1,1,1,5).setValues([['timestamp','member','author','category','text']]);
    sheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Token validation ──────────────────────────────────────────────────

function validateTeamToken_(token) {
  if (!token) return null;
  var sheet = getTeamSheet_();
  if (sheet.getLastRow() < 2) return null;
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 9).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === token) {
      return { name: data[i][1], role: data[i][5] || 'member', telegram_username: data[i][8] || '' };
    }
  }
  return null;
}

function getTeamMemberTelegram_(name) {
  var sheet = getTeamSheet_();
  if (sheet.getLastRow() < 2) return '';
  var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 9).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase().trim() === name.toLowerCase().trim()) {
      return String(data[i][8] || '').trim();
    }
  }
  return '';
}

// ── Telegram helpers ──────────────────────────────────────────────────

function sendTelegramFromAppsScript_(chatId, text, threadId) {
  // REQUIRED: Add TELEGRAM_BOT_TOKEN to Script Properties:
  //   Apps Script → Project settings (gear) → Script properties → Add:
  //   Property: TELEGRAM_BOT_TOKEN
  //   Value: (your bot token from BotFather, same as GitHub Secret)
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) {
    Logger.log('ERROR: TELEGRAM_BOT_TOKEN not found in Script Properties. Go to Project Settings → Script Properties → Add it.');
    // Try fallback: check if token is in the script itself as a constant
    token = typeof TELEGRAM_BOT_TOKEN_FALLBACK !== 'undefined' ? TELEGRAM_BOT_TOKEN_FALLBACK : '';
    if (!token) return false;
  }
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (threadId) payload.message_thread_id = threadId;
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code === 200) return true;
    Logger.log('Telegram API returned ' + code + ': ' + response.getContentText().slice(0, 500));
    return false;
  } catch(e) {
    Logger.log('Telegram send exception: ' + e.toString());
    return false;
  }
}

/**
 * Send a private Telegram message to a user by their @username.
 * Uses Telegram's limitation: bots can only message users who have
 * started a conversation with the bot. If the user hasn't done so,
 * this falls back to posting a nudge in the main group tagging them.
 */
function sendTelegramPrivateNudge_(username, text) {
  if (!username) return false;
  // Clean the @ prefix
  var clean = username.replace(/^@/, '');
  // We can't send a private message without a chat_id (numeric).
  // Instead, tag them in the main group's General topic.
  var groupMsg = '<b>📨 New message for @' + clean + '</b>\n' + text;
  return sendTelegramFromAppsScript_('@seedtheword', groupMsg, null);
}

// ── Anti-spam: 1 announcement per event per day ───────────────────────

function getAnnouncementDedupKey_(subject, date) {
  // Normalize: lowercase, trim, remove non-alpha
  return (subject || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40) + '_' + date;
}

function hasAnnouncementBeenSentToday_(sheet, dedupKey) {
  if (sheet.getLastRow() < 2) return false;
  var keys = sheet.getRange(2, 7, sheet.getLastRow()-1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === dedupKey) return true;
  }
  return false;
}

// ── Announcement Handlers ─────────────────────────────────────────────

function handlePostAnnouncement_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    if (user.role !== 'admin') return jsonResponse({ ok: false, error: 'Admin only' });

    var subject = String(payload.subject || '').trim();
    var body = String(payload.body || '').trim();
    var priority = String(payload.priority || 'normal').trim();
    var sendTelegram = payload.send_telegram !== false;
    if (!subject || !body) return jsonResponse({ ok: false, error: 'Subject and body required' });

    var sheet = getAnnouncementsSheet_();
    var now = new Date();
    var today = now.toISOString().split('T')[0];
    var dedupKey = getAnnouncementDedupKey_(subject, today);
    var telegramSent = false;

    // Anti-spam: only send to Telegram if this exact subject hasn't been sent today
    if (sendTelegram && !hasAnnouncementBeenSentToday_(sheet, dedupKey)) {
      var priorityEmoji = priority === 'emergency' ? '🚨' : priority === 'urgent' ? '⚠️' : '📢';
      var telegramText = priorityEmoji + ' <b>' + subject + '</b>\n\n' + body + '\n\n— ' + user.name;
      telegramSent = sendTelegramFromAppsScript_('@seedtheword', telegramText, 553);
    }

    // Always save to sheet
    sheet.appendRow([now.toISOString(), user.name, subject, body, priority, telegramSent ? 'yes' : 'no', dedupKey]);
    return jsonResponse({ ok: true, route: 'postAnnouncement', telegram_sent: telegramSent });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetAnnouncements_(payload) {
  try {
    // Allow public read for community page (passphrase_hash='public-read' or valid token or admin hash)
    var user = validateTeamToken_(String(payload.token || ''));
    var isPublicRead = String(payload.passphrase_hash || '') === 'public-read';
    var isAdmin = validateAdminPassphrase_(payload);
    if (!user && !isPublicRead && !isAdmin) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getAnnouncementsSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, announcements: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 5).getValues();

    // Public read gets last 5; authenticated gets last 30
    var limit = (user || isAdmin) ? 30 : 5;
    var announcements = [];
    for (var i = data.length - 1; i >= 0 && announcements.length < limit; i--) {
      announcements.push({
        timestamp: new Date(data[i][0]).getTime(),
        author: data[i][1],
        subject: data[i][2],
        body: data[i][3],
        priority: data[i][4] || 'normal'
      });
    }
    return jsonResponse({ ok: true, announcements: announcements });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// Super-admin: remove an announcement. id is 'ann-<timestamp-ms>' (from the
// community feed) or a raw timestamp; matched against column A.
function handleDeleteAnnouncement_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user || String(user.role || '').toLowerCase() !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Super-admin only' });
    }
    var raw = String(payload.id || '').replace(/^ann-/, '').trim();
    var targetMs = parseInt(raw, 10);
    if (!targetMs) return jsonResponse({ ok: false, error: 'Missing id' });

    var sheet = getAnnouncementsSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'Not found' });
    var col = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = col.length - 1; i >= 0; i--) {
      if (new Date(col[i][0]).getTime() === targetMs) {
        sheet.deleteRow(i + 2);
        return jsonResponse({ ok: true });
      }
    }
    return jsonResponse({ ok: false, error: 'Not found' });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// ══════════════════════════════════════════════════════════════════════
// Direct Message Handlers (Phase 2 — Instagram-style inbox)
// DirectMessages: timestamp | from_user | to_user | text | telegram_notified | read_at
// Enforces block + reachability. Unread = rows to me with empty read_at.
// Email notify is throttled once-per-conversation-per-day (no empty emails).
// ══════════════════════════════════════════════════════════════════════

function handleSendDm_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var toUser = String(payload.to_user || '').trim();
    var text = String(payload.text || '').trim();
    if (!toUser || !text) return jsonResponse({ ok: false, error: 'Recipient and text required' });
    if (text.length > 4000) return jsonResponse({ ok: false, error: 'Message too long' });

    // Recipient must be a real team member.
    if (!teamMemberExists_(toUser)) return jsonResponse({ ok: false, error: 'Recipient not found' });

    // Enforce block + reachability (super-admin bypasses).
    var reach = dmCanReach_(user.name, user.role, toUser);
    if (!reach.ok) {
      var msg = reach.reason === 'blocked'
        ? 'You can\'t message this person.'
        : 'This person only accepts messages from selected contacts.';
      return jsonResponse({ ok: false, error: msg, code: reach.reason });
    }

    var sheet = getDmSheet_();
    var now = new Date();

    // Telegram nudge (best-effort).
    var telegramNotified = false;
    var recipientTg = getTeamMemberTelegram_(toUser);
    if (recipientTg) {
      var nudge = '💬 New message from ' + user.name + ': "' + text.slice(0, 80) + (text.length > 80 ? '…' : '') + '"\n\nCheck the Team Portal to reply.';
      telegramNotified = sendTelegramPrivateNudge_(recipientTg, nudge);
    }

    sheet.appendRow([now.toISOString(), user.name, toUser, text, telegramNotified ? 'yes' : 'no', '']);

    // Throttled email: at most once per (recipient, sender) per day, only on
    // real new activity — never a "no messages" email.
    try {
      var subj = '💬 New message from ' + user.name + ' — Seed the Word';
      var html = emailShell ? emailShell({
        headerTitle: 'You have a new message',
        headerSubtitle: 'from ' + user.name,
        bodyHtml: '<p><strong>' + escapeHtml(user.name) + '</strong> sent you a message in the Team Portal:</p>' +
          '<blockquote style="margin:0.5rem 1rem;padding:0.75rem 1rem;border-left:4px solid #2C5F2E;background:#f7f3ec;font-style:italic;">' +
          escapeHtml(text.slice(0, 240)) + (text.length > 240 ? '…' : '') + '</blockquote>' +
          '<p>Open the Team Portal → Chat to reply.</p>',
        footerHtml: '<p>— Seed the Word</p>'
      }) : ('<p>' + escapeHtml(user.name) + ' sent you a message. Open the Team Portal to reply.</p>');
      notifyThrottled_(toUser, user.name, 'dm', subj, html, user.name + ' sent you a message. Open the Team Portal → Chat to reply.');
    } catch (e) { Logger.log('DM notify failed (non-fatal): ' + e); }

    return jsonResponse({ ok: true, route: 'sendDm', telegram_notified: telegramNotified });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function teamMemberExists_(name) {
  var sheet = getTeamSheet_();
  if (sheet.getLastRow() < 2) return false;
  var members = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  var lc = String(name).toLowerCase().trim();
  for (var i = 0; i < members.length; i++) {
    if (String(members[i][0]).toLowerCase().trim() === lc) return true;
  }
  return false;
}

function handleGetDmContacts_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getDmSheet_();
    var contacts = [];
    var meLc = user.name.toLowerCase();
    if (sheet.getLastRow() >= 2) {
      var lastCol = sheet.getLastColumn();
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      // read_at column index (5 by default; discover in case of shift).
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var readIdx = 5;
      for (var h = 0; h < headers.length; h++) { if (String(headers[h]).toLowerCase().trim() === 'read_at') { readIdx = h; break; } }

      // Build per-contact: last message text, last timestamp, unread count.
      var byContact = {};
      for (var i = 0; i < data.length; i++) {
        var from = String(data[i][1]).trim(), to = String(data[i][2]).trim(), txt = String(data[i][3]).trim();
        var ts = new Date(data[i][0]).getTime();
        var other = null, incoming = false;
        if (from.toLowerCase() === meLc) { other = to; }
        else if (to.toLowerCase() === meLc) { other = from; incoming = true; }
        if (!other) continue;
        if (!byContact[other]) byContact[other] = { name: other, last_message: '', last_ts: 0, unread: 0 };
        if (ts >= byContact[other].last_ts) { byContact[other].last_ts = ts; byContact[other].last_message = txt; }
        if (incoming && !String(data[i][readIdx] || '').trim()) byContact[other].unread++;
      }
      // Attach each contact's profile picture (via social pic lookup if available).
      contacts = Object.keys(byContact).map(function (k) {
        var c = byContact[k];
        c.pic = (typeof socialPicOf_ === 'function') ? socialPicOf_(c.name) : '';
        return c;
      }).sort(function (a, b) { return b.last_ts - a.last_ts; });
    }
    return jsonResponse({ ok: true, contacts: contacts });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetDmMessages_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var withUser = String(payload.with_user || '').trim();
    if (!withUser) return jsonResponse({ ok: false, error: 'Specify with_user' });

    var sheet = getDmSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, messages: [] });
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var readIdx = 5;
    for (var h = 0; h < headers.length; h++) { if (String(headers[h]).toLowerCase().trim() === 'read_at' ) { readIdx = h; break; } }
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

    var meLc = user.name.toLowerCase(), withLc = withUser.toLowerCase();
    var messages = [];
    var nowIso = new Date().toISOString();
    var markRows = [];
    for (var i = 0; i < data.length; i++) {
      var from = String(data[i][1]).trim(), to = String(data[i][2]).trim();
      var relevant = (from.toLowerCase() === meLc && to.toLowerCase() === withLc) ||
                     (to.toLowerCase() === meLc && from.toLowerCase() === withLc);
      if (!relevant) continue;
      messages.push({ timestamp: new Date(data[i][0]).getTime(), from: from, text: String(data[i][3]).trim() });
      // Mark incoming (to me) unread rows as read now.
      if (to.toLowerCase() === meLc && !String(data[i][readIdx] || '').trim()) markRows.push(i + 2);
    }
    // Persist read stamps (batch).
    for (var m = 0; m < markRows.length; m++) { try { sheet.getRange(markRows[m], readIdx + 1).setValue(nowIso); } catch (e) {} }
    return jsonResponse({ ok: true, messages: messages });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// ── Block / reachability / report actions ─────────────────────────────

// { action:'getDmSettings', token } → my block list + restricted/allowed +
// whether I'm restricted. Used by the inbox to gray-out unreachable contacts.
function handleGetDmSettings_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var mine = getDmSettingsFor_(user.name);
    return jsonResponse({ ok: true, blocked: mine.blocked, restricted: mine.restricted, allowed: mine.allowed });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// { action:'blockUser'|'unblockUser', token, target }
function handleBlockUser_(payload, block) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var target = String(payload.target || '').trim();
    if (!target) return jsonResponse({ ok: false, error: 'Missing target' });
    var mine = getDmSettingsFor_(user.name);
    var lc = target.toLowerCase();
    var next = mine.blocked.filter(function (n) { return String(n).toLowerCase() !== lc; });
    if (block) next.push(target);
    setDmSettingsFor_(user.name, { blocked: next });
    return jsonResponse({ ok: true, blocked: next });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// Super-admin: set a member's DM restriction + allow-list.
// { action:'setDmRestriction', token, member, restricted:bool, allowed:[names] }
function handleSetDmRestriction_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user || String(user.role || '').toLowerCase() !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Super-admin only' });
    }
    var member = String(payload.member || '').trim();
    if (!member) return jsonResponse({ ok: false, error: 'Missing member' });
    var allowed = Array.isArray(payload.allowed) ? payload.allowed.map(function (n) { return String(n).trim(); }).filter(Boolean) : [];
    var restricted = (payload.restricted === true || payload.restricted === 'true' || payload.restricted === 'YES');
    setDmSettingsFor_(member, { restricted: restricted, allowed: allowed });
    return jsonResponse({ ok: true });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// { action:'reportUser', token, reported, reason } → logs + notifies
// super-admins and moderation-permission admins.
function handleReportUser_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var reported = String(payload.reported || '').trim();
    var reason = String(payload.reason || '').trim().slice(0, 1000);
    if (!reported) return jsonResponse({ ok: false, error: 'Missing reported user' });
    getDmReportsSheet_().appendRow([new Date().toISOString(), user.name, reported, reason, 'open']);
    // Notify moderators (super-admins + admins with the 'moderation' permission).
    try {
      var recipients = getModerationEmails_();
      if (recipients.length) {
        var html = (typeof emailShell === 'function') ? emailShell({
          headerTitle: 'New user report', headerSubtitle: reported,
          bodyHtml: '<p><strong>' + escapeHtml(user.name) + '</strong> reported <strong>' + escapeHtml(reported) + '</strong>.</p>' +
            (reason ? '<blockquote style="margin:0.5rem 1rem;padding:0.75rem 1rem;border-left:4px solid #a6251f;background:#faf0ef;">' + escapeHtml(reason) + '</blockquote>' : '') +
            '<p>Review in Content Studio → Moderation.</p>',
          footerHtml: '<p>— Seed the Word</p>'
        }) : ('<p>' + escapeHtml(user.name) + ' reported ' + escapeHtml(reported) + '. Reason: ' + escapeHtml(reason) + '</p>');
        MailApp.sendEmail({ to: recipients.join(','), subject: '🚩 User report: ' + reported, htmlBody: html, body: user.name + ' reported ' + reported + '. ' + reason, name: 'Seed the Word Ministry', noReply: true });
      }
    } catch (e) { Logger.log('report notify failed: ' + e); }
    return jsonResponse({ ok: true });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// Emails of super-admins + admins granted the 'moderation' permission.
function getModerationEmails_() {
  var out = [];
  try {
    var sheet = getTeamSheet_();
    if (sheet.getLastRow() < 2) return out;
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var permIdx = -1;
    for (var h = 0; h < headers.length; h++) { if (String(headers[h]).toLowerCase().trim() === 'permissions') { permIdx = h; break; } }
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      var role = String(data[i][5] || 'member').toLowerCase();
      var email = String(data[i][3] || '').trim();
      if (!email || email.indexOf('@') === -1) continue;
      var isMod = (role === 'super_admin');
      if (!isMod && permIdx >= 0) {
        try { var perms = JSON.parse(data[i][permIdx] || '[]'); if (Array.isArray(perms) && perms.indexOf('moderation') !== -1) isMod = true; } catch (e) {}
      }
      if (isMod && out.indexOf(email) === -1) out.push(email);
    }
  } catch (e) {}
  return out;
}

// { action:'listDmReports', token } → reports list for moderators (super-admin
// or admin with 'moderation' permission). Powers Content Studio → Moderation.
function handleListDmReports_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var role = String(user.role || 'member').toLowerCase();
    var isMod = (role === 'super_admin');
    if (!isMod) {
      // Check moderation permission on the caller's row.
      try {
        var sh = getTeamSheet_();
        var lastCol = sh.getLastColumn();
        var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
        var permIdx = -1;
        for (var h = 0; h < headers.length; h++) { if (String(headers[h]).toLowerCase().trim() === 'permissions') { permIdx = h; break; } }
        if (permIdx >= 0 && sh.getLastRow() >= 2) {
          var d = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
          for (var i = 0; i < d.length; i++) {
            if (String(d[i][1]).toLowerCase().trim() === user.name.toLowerCase()) {
              try { var perms = JSON.parse(d[i][permIdx] || '[]'); if (Array.isArray(perms) && perms.indexOf('moderation') !== -1) isMod = true; } catch (e) {}
              break;
            }
          }
        }
      } catch (e) {}
    }
    if (!isMod) return jsonResponse({ ok: false, error: 'Moderators only' });
    var sheet = getDmReportsSheet_();
    var reports = [];
    if (sheet.getLastRow() >= 2) {
      var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
      for (var r = rows.length - 1; r >= 0 && reports.length < 100; r--) {
        reports.push({ timestamp: new Date(rows[r][0]).getTime(), reporter: rows[r][1], reported: rows[r][2], reason: rows[r][3], status: rows[r][4] || 'open' });
      }
    }
    return jsonResponse({ ok: true, reports: reports });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// ── Member Notes Handlers ─────────────────────────────────────────────

function handleAddMemberNote_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var member = String(payload.member || '').trim();
    var text = String(payload.text || '').trim();
    var category = String(payload.category || 'general').trim();
    if (!member || !text) return jsonResponse({ ok: false, error: 'Member and text required' });

    var sheet = getMemberNotesSheet_();
    var now = new Date();
    sheet.appendRow([now.toISOString(), member, user.name, category, text]);
    return jsonResponse({ ok: true, route: 'addMemberNote' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetMemberNotes_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var member = String(payload.member || '').trim();
    if (!member) return jsonResponse({ ok: false, error: 'Specify member' });

    var sheet = getMemberNotesSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, notes: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 5).getValues();

    var notes = [];
    for (var i = data.length - 1; i >= 0 && notes.length < 50; i--) {
      if (String(data[i][1]).toLowerCase().trim() === member.toLowerCase()) {
        notes.push({
          timestamp: new Date(data[i][0]).getTime(),
          author: data[i][2],
          category: data[i][3],
          text: data[i][4]
        });
      }
    }
    return jsonResponse({ ok: true, notes: notes });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetNoteMembers_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    // Get all team members
    var tmSheet = getTeamSheet_();
    var members = [];
    if (tmSheet.getLastRow() > 1) {
      var data = tmSheet.getRange(2, 2, tmSheet.getLastRow()-1, 1).getValues();
      for (var i = 0; i < data.length; i++) {
        var name = String(data[i][0]).trim();
        if (name) members.push(name);
      }
    }
    return jsonResponse({ ok: true, members: members });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}


// ══════════════════════════════════════════════════════════════════════
// INVENTORY EDIT/DELETE HANDLERS
// ══════════════════════════════════════════════════════════════════════
//
// ADD these routing lines to doPost() alongside the messaging routes:
//
//   if ((payload && payload.action) === 'deleteScan') return handleDeleteScan_(payload);
//   if ((payload && payload.action) === 'editScan') return handleEditScan_(payload);
//   if ((payload && payload.action) === 'getScanHistory') return handleGetScanHistory_(payload);
//   if ((payload && payload.action) === 'deleteInventoryRow') return handleDeleteInventoryRow_(payload);
//   if ((payload && payload.action) === 'editInventoryRow') return handleEditInventoryRow_(payload);
//   if ((payload && payload.action) === 'suggestScanEdit') return handleSuggestScanEdit_(payload);

function handleDeleteScan_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var itemId = String(payload.item_id || '').trim();
    var date = String(payload.date || '').trim();
    var eventLabel = String(payload.event_label || '').trim();
    if (!itemId) return jsonResponse({ ok: false, error: 'No item_id' });

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: true, route: 'deleteScan', deleted: false });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    // Find the most recent matching row for this user+item+date+event
    // Date comparison: normalize both to YYYY-MM-DD since Sheets may auto-format
    for (var i = data.length - 1; i >= 0; i--) {
      var rowDate = data[i][0] instanceof Date ? data[i][0].toISOString().split('T')[0] : String(data[i][0]).trim().split('T')[0];
      var rowItem = String(data[i][2]).trim();
      var rowMember = String(data[i][9]).toLowerCase().trim();
      if (rowItem === itemId && rowDate === date && rowMember === user.name.toLowerCase()) {
        sheet.deleteRow(i + 2);
        // Decrement total_scans
        var tmSheet = getTeamSheet_();
        if (tmSheet.getLastRow() > 1) {
          var tmData = tmSheet.getRange(2, 1, tmSheet.getLastRow()-1, 8).getValues();
          for (var j = 0; j < tmData.length; j++) {
            if (String(tmData[j][1]).toLowerCase().trim() === user.name.toLowerCase()) {
              tmSheet.getRange(j+2, 8).setValue(Math.max(0, (parseInt(tmData[j][7]) || 0) - 1));
              break;
            }
          }
        }
        return jsonResponse({ ok: true, route: 'deleteScan', deleted: true });
      }
    }
    return jsonResponse({ ok: true, route: 'deleteScan', deleted: false });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleEditScan_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var itemId = String(payload.item_id || '').trim();
    var date = String(payload.date || '').trim();
    var newQty = parseInt(payload.new_qty) || 1;
    if (!itemId) return jsonResponse({ ok: false, error: 'No item_id' });

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'No inventory' });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      var rowDate = data[i][0] instanceof Date ? data[i][0].toISOString().split('T')[0] : String(data[i][0]).trim().split('T')[0];
      if (String(data[i][2]).trim() === itemId &&
          rowDate === date &&
          String(data[i][9]).toLowerCase().trim() === user.name.toLowerCase()) {
        var oldQty = parseInt(data[i][4]) || 1;
        var unitCost = parseFloat(data[i][7]) || 0;
        // Column 5 is quantity (index 4), Column 9 is total_cost (index 8)
        sheet.getRange(i + 2, 5).setValue(newQty);
        sheet.getRange(i + 2, 9).setValue(unitCost * newQty);

        // Log discrepancy to AuditLog sheet
        var auditSheet = ss.getSheetByName('AuditLog');
        if (!auditSheet) {
          auditSheet = ss.insertSheet('AuditLog');
          auditSheet.getRange(1, 1, 1, 7).setValues([['timestamp', 'action', 'member', 'item_id', 'old_qty', 'new_qty', 'notes']]);
          auditSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
        }
        auditSheet.appendRow([
          new Date().toISOString(),
          'editScan',
          user.name,
          itemId,
          oldQty,
          newQty,
          'Event: ' + (String(payload.event_label || '') || 'N/A') + ' | Date: ' + date
        ]);

        return jsonResponse({ ok: true, route: 'editScan', updated: true, old_qty: oldQty, new_qty: newQty });
      }
    }
    return jsonResponse({ ok: false, error: 'Row not found' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetScanHistory_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: true, scans: [] });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g, '') === 'rowid') { rowIdCol = h; break; }
    }

    var scans = [];
    for (var i = data.length - 1; i >= 0 && scans.length < 100; i--) {
      // Column 9 (index 9) is team_member
      if (String(data[i][9]).toLowerCase().trim() === user.name.toLowerCase()) {
        var rowDate = data[i][0] instanceof Date ? data[i][0].toISOString().split('T')[0] : String(data[i][0]).trim().split('T')[0];
        scans.push({
          row_id: rowIdCol >= 0 ? String(data[i][rowIdCol]) : 'ROW-' + (i+2),
          date: rowDate,
          item_id: String(data[i][2]),
          item_name: String(data[i][3]),
          qty: parseInt(data[i][4]) || 1,
          event: String(data[i][6] || '')
        });
      }
    }
    return jsonResponse({ ok: true, scans: scans });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleDeleteInventoryRow_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var rowId = String(payload.row_id || '').trim();
    if (!rowId) return jsonResponse({ ok: false, error: 'No row_id' });

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'No data' });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g, '') === 'rowid') { rowIdCol = h; break; }
    }
    if (rowIdCol < 0) return jsonResponse({ ok: false, error: 'No row_id column' });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    var today = new Date().toISOString().split('T')[0];

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][rowIdCol]).trim() === rowId) {
        // Non-admins can only delete today's entries and only their own
        if (user.role !== 'admin') {
          if (String(data[i][0]).trim() !== today) return jsonResponse({ ok: false, error: 'Can only delete today\'s entries' });
          if (String(data[i][9]).toLowerCase().trim() !== user.name.toLowerCase()) return jsonResponse({ ok: false, error: 'Can only delete your own entries' });
        }
        sheet.deleteRow(i + 2);
        return jsonResponse({ ok: true, route: 'deleteInventoryRow' });
      }
    }
    return jsonResponse({ ok: false, error: 'Row not found' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleEditInventoryRow_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var rowId = String(payload.row_id || '').trim();
    var newQty = parseInt(payload.new_qty) || 1;
    if (!rowId) return jsonResponse({ ok: false, error: 'No row_id' });

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'No data' });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g, '') === 'rowid') { rowIdCol = h; break; }
    }
    if (rowIdCol < 0) return jsonResponse({ ok: false, error: 'No row_id column' });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    var today = new Date().toISOString().split('T')[0];

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][rowIdCol]).trim() === rowId) {
        // Non-admins can only edit today's entries and only their own
        if (user.role !== 'admin') {
          var rowDate = data[i][0] instanceof Date ? data[i][0].toISOString().split('T')[0] : String(data[i][0]).trim().split('T')[0];
          if (rowDate !== today) return jsonResponse({ ok: false, error: 'Can only edit today\'s entries' });
          if (String(data[i][9]).toLowerCase().trim() !== user.name.toLowerCase()) return jsonResponse({ ok: false, error: 'Can only edit your own entries' });
        }
        var oldQty = parseInt(data[i][4]) || 1;
        var unitCost = parseFloat(data[i][7]) || 0;
        sheet.getRange(i + 2, 5).setValue(newQty); // Column 5 = qty
        sheet.getRange(i + 2, 9).setValue(unitCost * newQty); // Column 9 = total_cost

        // Audit log
        var auditSheet = ss.getSheetByName('AuditLog');
        if (!auditSheet) {
          auditSheet = ss.insertSheet('AuditLog');
          auditSheet.getRange(1, 1, 1, 7).setValues([['timestamp', 'action', 'member', 'item_id', 'old_qty', 'new_qty', 'notes']]);
          auditSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
        }
        auditSheet.appendRow([new Date().toISOString(), 'editInventoryRow', user.name, String(data[i][2]), oldQty, newQty, 'row_id: ' + rowId]);

        return jsonResponse({ ok: true, route: 'editInventoryRow', old_qty: oldQty, new_qty: newQty });
      }
    }
    return jsonResponse({ ok: false, error: 'Row not found' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleSuggestScanEdit_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var rowId = String(payload.row_id || '').trim();
    var itemName = String(payload.item_name || '').trim();
    var note = String(payload.note || '').trim();
    if (!note) return jsonResponse({ ok: false, error: 'Note required' });

    // Store as a member note on a special "Edit Requests" member
    var sheet = getMemberNotesSheet_();
    var now = new Date();
    var text = '[EDIT REQUEST] Row ' + rowId + ' (' + itemName + '): ' + note;
    sheet.appendRow([now.toISOString(), 'Edit Requests', user.name, 'followup', text]);

    // Notify admins via email
    try {
      MailApp.sendEmail({
        to: TEAM_INBOX,
        subject: '✏️ Scan edit request from ' + user.name,
        body: user.name + ' requests a change:\n\nRow: ' + rowId + '\nItem: ' + itemName + '\nNote: ' + note
      });
    } catch(e) {}

    return jsonResponse({ ok: true, route: 'suggestScanEdit' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}


// ══════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD HANDLERS
// ══════════════════════════════════════════════════════════════════════
//
// ADD these routing lines to doPost():
//   if ((payload && payload.action) === 'getAdminStats') return handleGetAdminStats_(payload);
//   if ((payload && payload.action) === 'getAdminInventory') return handleGetAdminInventory_(payload);
//   if ((payload && payload.action) === 'getAdminMembers') return handleGetAdminMembers_(payload);
//   if ((payload && payload.action) === 'adminPostAnnouncement') return handleAdminPostAnnouncement_(payload);
//   if ((payload && payload.action) === 'adminDeleteInventoryRow') return handleAdminDeleteInventoryRow_(payload);
//   if ((payload && payload.action) === 'setMemberRole') return handleSetMemberRole_(payload);

var FIELD_LOG_EXPECTED_HASH_DASH = '2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440';

function validateAdminPassphrase_(payload) {
  var h = String(payload.passphrase_hash || '').toLowerCase().trim();
  return h === FIELD_LOG_EXPECTED_HASH_DASH;
}

function handleGetAdminStats_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var invSheet = ss.getSheetByName('Inventory');
    var tmSheet = getTeamSheet_();
    var totalScans = 0, totalCost = 0, todayScans = 0;
    var today = new Date().toISOString().split('T')[0];
    var memberMap = {};

    if (invSheet && invSheet.getLastRow() > 1) {
      var data = invSheet.getRange(2, 1, invSheet.getLastRow()-1, invSheet.getLastColumn()).getValues();
      for (var i = 0; i < data.length; i++) {
        var qty = parseInt(data[i][4]) || 1;
        var cost = parseFloat(data[i][7]) || 0;
        var member = String(data[i][9] || '').trim();
        var date = String(data[i][0] || '').trim();
        totalScans += qty;
        totalCost += cost;
        if (date === today) todayScans += qty;
        if (member) {
          if (!memberMap[member]) memberMap[member] = { name: member, scans: 0, cost: 0, last_date: '' };
          memberMap[member].scans += qty;
          memberMap[member].cost += cost;
          if (date > memberMap[member].last_date) memberMap[member].last_date = date;
        }
      }
    }

    var totalMembers = tmSheet.getLastRow() > 1 ? tmSheet.getLastRow() - 1 : 0;
    var perMember = Object.keys(memberMap).map(function(k) { return memberMap[k]; })
      .sort(function(a, b) { return b.scans - a.scans; });

    return jsonResponse({ ok: true, total_scans: totalScans, total_cost: totalCost, today_scans: todayScans, total_members: totalMembers, per_member: perMember });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetAdminInventory_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: true, rows: [] });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g, '') === 'rowid') { rowIdCol = h; break; }
    }

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    var rows = [];
    for (var i = data.length - 1; i >= 0 && rows.length < 100; i--) {
      rows.push({
        row_id: rowIdCol >= 0 ? String(data[i][rowIdCol]) : 'ROW-' + (i+2),
        date: String(data[i][0]),
        item_id: String(data[i][2]),
        item_name: String(data[i][3]),
        qty: parseInt(data[i][4]) || 1,
        event: String(data[i][6] || ''),
        member: String(data[i][9] || '')
      });
    }
    return jsonResponse({ ok: true, rows: rows });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetAdminMembers_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var sheet = getTeamSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, members: [] });
    // Read full width so the 'permissions' column (if present) is included.
    var lastCol = Math.max(9, sheet.getLastColumn());
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var permIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).trim().toLowerCase() === 'permissions') { permIdx = h; break; }
    }
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).getValues();
    var members = data.map(function(row) {
      var role = row[5] || 'member';
      var perms = (typeof resolveMemberPermissions_ === 'function')
        ? resolveMemberPermissions_(permIdx >= 0 ? row[permIdx] : '', role)
        : [];
      // DM reachability settings (for the Content Studio → Moderation screen).
      var dm = (typeof getDmSettingsFor_ === 'function') ? getDmSettingsFor_(row[1]) : { restricted: false, allowed: [] };
      return { name: row[1], email: row[3], phone: row[4], role: role, scans: parseInt(row[7]) || 0, telegram: row[8] || '', permissions: perms,
        dm_restricted: dm.restricted ? 'YES' : 'no', dm_allowed: dm.allowed || [] };
    });
    return jsonResponse({ ok: true, members: members });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleAdminPostAnnouncement_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var subject = String(payload.subject || '').trim();
    var body = String(payload.body || '').trim();
    var priority = String(payload.priority || 'normal').trim();
    var author = String(payload.author || 'Admin').trim();
    var sendTelegram = payload.send_telegram !== false;
    if (!subject || !body) return jsonResponse({ ok: false, error: 'Subject and body required' });

    var sheet = getAnnouncementsSheet_();
    var now = new Date();
    var today = now.toISOString().split('T')[0];
    var dedupKey = getAnnouncementDedupKey_(subject, today);
    var telegramSent = false;

    if (sendTelegram && !hasAnnouncementBeenSentToday_(sheet, dedupKey)) {
      var emoji = priority === 'emergency' ? '🚨' : priority === 'urgent' ? '⚠️' : '📢';
      var msg = emoji + ' <b>' + subject + '</b>\n\n' + body + '\n\n— ' + author;
      telegramSent = sendTelegramFromAppsScript_('@seedtheword', msg, 553);
    }

    sheet.appendRow([now.toISOString(), author, subject, body, priority, telegramSent ? 'yes' : 'no', dedupKey]);
    return jsonResponse({ ok: true, route: 'adminPostAnnouncement', telegram_sent: telegramSent });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleAdminDeleteInventoryRow_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var rowId = String(payload.row_id || '').trim();
    if (!rowId) return jsonResponse({ ok: false, error: 'No row_id' });

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'No data' });

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g, '') === 'rowid') { rowIdCol = h; break; }
    }
    if (rowIdCol < 0) return jsonResponse({ ok: false, error: 'No row_id column' });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][rowIdCol]).trim() === rowId) {
        sheet.deleteRow(i + 2);
        return jsonResponse({ ok: true, route: 'adminDeleteInventoryRow' });
      }
    }
    return jsonResponse({ ok: false, error: 'Row not found' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleSetMemberRole_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var memberName = String(payload.member_name || '').trim();
    var newRole = String(payload.new_role || '').trim();
    if (!memberName || !newRole) return jsonResponse({ ok: false, error: 'Name and role required' });
    if (['member', 'admin', 'super_admin'].indexOf(newRole) < 0) return jsonResponse({ ok: false, error: 'Invalid role' });

    var sheet = getTeamSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'No members' });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 6).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase().trim() === memberName.toLowerCase()) {
        sheet.getRange(i + 2, 6).setValue(newRole);
        return jsonResponse({ ok: true, route: 'setMemberRole' });
      }
    }
    return jsonResponse({ ok: false, error: 'Member not found' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

// Super-admin: set a member's per-section permissions (JSON array). Writes to
// the TeamMembers 'permissions' column (created on demand). super_admin members
// always have all permissions regardless of what's stored, so this is really
// the member-vs-admin dial. Validates keys against ALL_PERMISSIONS (defined in
// order-handler.gs; same Apps Script project shares globals).
function handleSetMemberPermissions_(payload) {
  if (!validateAdminPassphrase_(payload)) return jsonResponse({ ok: false, error: 'Unauthorized' });
  try {
    var memberName = String(payload.member_name || '').trim();
    var perms = payload.permissions;
    if (!memberName) return jsonResponse({ ok: false, error: 'Name required' });
    if (!Array.isArray(perms)) return jsonResponse({ ok: false, error: 'permissions must be an array' });

    // Whitelist against the known permission keys.
    var allowed = (typeof ALL_PERMISSIONS !== 'undefined') ? ALL_PERMISSIONS
      : ['scanner', 'finance', 'orders', 'chat_admin', 'training_admin', 'content_studio', 'members_admin'];
    var clean = perms.map(function (p) { return String(p).trim(); })
                     .filter(function (p) { return allowed.indexOf(p) !== -1; });

    var sheet = getTeamSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: false, error: 'No members' });
    var permCol = ensureColumn_(sheet, 'permissions');
    var names = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues(); // col B = name
    for (var i = 0; i < names.length; i++) {
      if (String(names[i][0]).toLowerCase().trim() === memberName.toLowerCase()) {
        sheet.getRange(i + 2, permCol).setValue(JSON.stringify(clean));
        return jsonResponse({ ok: true, route: 'setMemberPermissions', permissions: clean });
      }
    }
    return jsonResponse({ ok: false, error: 'Member not found' });
  } catch (err) { return jsonResponse({ ok: false, error: String(err) }); }
}


// ══════════════════════════════════════════════════════════════════════
// TRAINING TRACKER HANDLERS
// ══════════════════════════════════════════════════════════════════════
//
// ADD these routing lines to doPost():
//   if ((payload && payload.action) === 'getTrainingProgress') return handleGetTrainingProgress_(payload);
//   if ((payload && payload.action) === 'getTrainingRecord') return handleGetTrainingRecord_(payload);
//   if ((payload && payload.action) === 'addTrainingRecord') return handleAddTrainingRecord_(payload);

function getTrainingSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('TrainingRecords');
  if (!sheet) {
    sheet = ss.insertSheet('TrainingRecords');
    sheet.getRange(1,1,1,6).setValues([['timestamp','member','author','type','text','module_id']]);
    sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function handleGetTrainingProgress_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getTrainingSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, completed: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 6).getValues();

    // Find completed modules for this user
    var completed = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase().trim() === user.name.toLowerCase() &&
          String(data[i][3]).trim() === 'training' &&
          String(data[i][5]).trim()) {
        completed.push(String(data[i][5]).trim());
      }
    }
    return jsonResponse({ ok: true, completed: completed });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetTrainingRecord_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    // Members see their own records; admins can request specific member
    var targetMember = String(payload.member || user.name).trim();
    if (targetMember.toLowerCase() !== user.name.toLowerCase() && user.role !== 'admin' && user.role !== 'super_admin') {
      targetMember = user.name; // Non-admins can only see their own
    }

    var sheet = getTrainingSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, records: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 6).getValues();

    var records = [];
    for (var i = data.length - 1; i >= 0 && records.length < 50; i--) {
      if (String(data[i][1]).toLowerCase().trim() === targetMember.toLowerCase()) {
        records.push({
          timestamp: new Date(data[i][0]).getTime(),
          author: data[i][2],
          type: data[i][3],
          text: data[i][4],
          module_id: data[i][5] || ''
        });
      }
    }
    return jsonResponse({ ok: true, records: records });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleAddTrainingRecord_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Admin only' });
    }

    var member = String(payload.member || '').trim();
    var type = String(payload.type || 'feedback').trim();
    var text = String(payload.text || '').trim();
    var moduleId = String(payload.module_id || '').trim();
    if (!member || !text) return jsonResponse({ ok: false, error: 'Member and text required' });

    var sheet = getTrainingSheet_();
    var now = new Date();
    sheet.appendRow([now.toISOString(), member, user.name, type, text, moduleId]);
    return jsonResponse({ ok: true, route: 'addTrainingRecord' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}


// ══════════════════════════════════════════════════════════════════════
// CHAT MESSAGE HANDLERS (Telegram-style channels)
// ══════════════════════════════════════════════════════════════════════
//
// ADD these routing lines to doPost():
//   if ((payload && payload.action) === 'sendChatMessage') return handleSendChatMessage_(payload);
//   if ((payload && payload.action) === 'getChatMessages') return handleGetChatMessages_(payload);

function getChatSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('ChatMessages');
  if (!sheet) {
    sheet = ss.insertSheet('ChatMessages');
    sheet.getRange(1,1,1,6).setValues([['timestamp','channel','from_user','text','msg_type','to_user']]);
    sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function handleSendChatMessage_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var channel = String(payload.channel || 'main').trim();
    var text = String(payload.text || '').trim();
    var msgType = String(payload.msg_type || 'message').trim();
    var toUser = String(payload.to_user || '').trim();
    if (!text) return jsonResponse({ ok: false, error: 'Empty message' });

    // Validate DM recipient exists
    if (channel.indexOf('dm_') === 0 && toUser) {
      var tmSheet = getTeamSheet_();
      if (tmSheet.getLastRow() > 1) {
        var members = tmSheet.getRange(2, 2, tmSheet.getLastRow()-1, 1).getValues();
        var found = false;
        for (var i = 0; i < members.length; i++) {
          if (String(members[i][0]).toLowerCase().trim() === toUser.toLowerCase()) { found = true; break; }
        }
        if (!found) return jsonResponse({ ok: false, error: 'Recipient not found in team members' });
      }
    }

    var sheet = getChatSheet_();
    var now = new Date();
    sheet.appendRow([now.toISOString(), channel, user.name, text, msgType, toUser]);

    // Forward prayer requests to Telegram Prayer & Thanksgiving topic
    if (msgType === 'prayer' || msgType === 'thanksgiving') {
      var emoji = msgType === 'prayer' ? '🙏' : '🎉';
      var label = msgType === 'prayer' ? 'Prayer Request' : 'Thanksgiving';
      var tgMsg = emoji + ' <b>' + label + ' from ' + user.name + '</b>\n\n' + text;
      sendTelegramFromAppsScript_('@seedtheword', tgMsg, 21); // thread 21 = Prayer & Thanksgiving
    }

    // Forward DMs as Telegram nudge
    if (channel.indexOf('dm_') === 0 && toUser) {
      var recipientTg = getTeamMemberTelegram_(toUser);
      if (recipientTg) {
        var nudge = '💬 New message from ' + user.name + '. Check the Team Portal to reply.';
        sendTelegramPrivateNudge_(recipientTg, nudge);
      }
    }

    return jsonResponse({ ok: true, route: 'sendChatMessage' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetChatMessages_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    var isPublicRead = String(payload.passphrase_hash || '') === 'public-read';
    if (!user && !isPublicRead) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var channel = String(payload.channel || 'main').trim();
    // Public read only allows main channel (no DMs)
    if (isPublicRead && channel.indexOf('dm_') === 0) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getChatSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, messages: [] });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 6).getValues();
    var messages = [];

    for (var i = 0; i < data.length; i++) {
      var rowChannel = String(data[i][1]).trim();
      var fromUser = String(data[i][2]).trim();
      var toUser = String(data[i][5]).trim();

      // Channel match logic
      var match = false;
      if (channel.indexOf('dm_') === 0) {
        // DM channel: show messages between current user and the target
        var dmTarget = channel.replace('dm_', '');
        match = (rowChannel === channel) ||
                (rowChannel === 'dm_' + user.name && toUser.toLowerCase() === dmTarget.toLowerCase()) ||
                (fromUser.toLowerCase() === dmTarget.toLowerCase() && toUser.toLowerCase() === user.name.toLowerCase());
      } else {
        match = (rowChannel === channel);
      }

      if (match) {
        messages.push({
          timestamp: new Date(data[i][0]).getTime(),
          from: fromUser,
          text: String(data[i][3]).trim(),
          msg_type: String(data[i][4]).trim()
        });
      }
    }

    // Return last 50 messages
    if (messages.length > 50) messages = messages.slice(messages.length - 50);
    return jsonResponse({ ok: true, messages: messages });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}


// ══════════════════════════════════════════════════════════════════════
// LMS PROGRESS SYNC HANDLERS
// ══════════════════════════════════════════════════════════════════════
//
// Stores/retrieves per-user LMS course progress so it syncs across
// devices. Uses a dedicated "LmsProgress" tab with columns:
//   token | name | progress_json | last_updated
//
// ADD these routing lines to doPost():
//   if ((payload && payload.action) === 'saveLmsProgress') return handleSaveLmsProgress_(payload);
//   if ((payload && payload.action) === 'getLmsProgress') return handleGetLmsProgress_(payload);

function getLmsSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('LmsProgress');
  if (!sheet) {
    sheet = ss.insertSheet('LmsProgress');
    sheet.getRange(1,1,1,4).setValues([['token','name','progress_json','last_updated']]);
    sheet.getRange(1,1,1,4).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function handleSaveLmsProgress_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var progress = payload.progress;
    if (!progress || typeof progress !== 'object') {
      return jsonResponse({ ok: false, error: 'No progress data' });
    }

    var progressJson = JSON.stringify(progress);
    var sheet = getLmsSheet_();
    var now = new Date().toISOString();

    // Find existing row for this user
    if (sheet.getLastRow() > 1) {
      var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 4).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][1]).toLowerCase().trim() === user.name.toLowerCase()) {
          // Update existing row
          sheet.getRange(i + 2, 3).setValue(progressJson);
          sheet.getRange(i + 2, 4).setValue(now);
          return jsonResponse({ ok: true, route: 'saveLmsProgress' });
        }
      }
    }

    // No existing row — insert new one
    var token = String(payload.token || '').trim();
    sheet.appendRow([token, user.name, progressJson, now]);
    return jsonResponse({ ok: true, route: 'saveLmsProgress' });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetLmsProgress_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getLmsSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, progress: {} });

    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase().trim() === user.name.toLowerCase()) {
        var json = String(data[i][2] || '{}');
        try {
          var progress = JSON.parse(json);
          return jsonResponse({ ok: true, progress: progress });
        } catch(e) {
          return jsonResponse({ ok: true, progress: {} });
        }
      }
    }

    return jsonResponse({ ok: true, progress: {} });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}
