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
    sheet.getRange(1,1,1,5).setValues([['timestamp','from_user','to_user','text','telegram_notified']]);
    sheet.getRange(1,1,1,5).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
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
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) { Logger.log('No TELEGRAM_BOT_TOKEN in Script Properties'); return false; }
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (threadId) payload.message_thread_id = threadId;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    return true;
  } catch(e) { Logger.log('Telegram send failed: ' + e); return false; }
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
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getAnnouncementsSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, announcements: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 5).getValues();

    // Return last 30 announcements, newest first
    var announcements = [];
    for (var i = data.length - 1; i >= 0 && announcements.length < 30; i--) {
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

// ── Direct Message Handlers ───────────────────────────────────────────

function handleSendDm_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var toUser = String(payload.to_user || '').trim();
    var text = String(payload.text || '').trim();
    if (!toUser || !text) return jsonResponse({ ok: false, error: 'Recipient and text required' });

    var sheet = getDmSheet_();
    var now = new Date();
    var telegramNotified = false;

    // Send Telegram notification to recipient
    var recipientTg = getTeamMemberTelegram_(toUser);
    if (recipientTg) {
      var nudge = '💬 New message from ' + user.name + ': "' + text.slice(0, 80) + (text.length > 80 ? '…' : '') + '"\n\nCheck the Team Portal to reply.';
      telegramNotified = sendTelegramPrivateNudge_(recipientTg, nudge);
    }

    sheet.appendRow([now.toISOString(), user.name, toUser, text, telegramNotified ? 'yes' : 'no']);
    return jsonResponse({ ok: true, route: 'sendDm', telegram_notified: telegramNotified });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
}

function handleGetDmContacts_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var sheet = getDmSheet_();
    if (sheet.getLastRow() < 2) return jsonResponse({ ok: true, contacts: [] });
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 4).getValues();

    // Find all unique contacts this user has messaged or received from
    var contactMap = {};
    for (var i = 0; i < data.length; i++) {
      var from = String(data[i][1]).trim();
      var to = String(data[i][2]).trim();
      var txt = String(data[i][3]).trim();
      if (from.toLowerCase() === user.name.toLowerCase()) {
        contactMap[to] = txt;
      } else if (to.toLowerCase() === user.name.toLowerCase()) {
        contactMap[from] = txt;
      }
    }
    // Also include all team members for admins
    if (user.role === 'admin') {
      var tmSheet = getTeamSheet_();
      if (tmSheet.getLastRow() > 1) {
        var members = tmSheet.getRange(2, 2, tmSheet.getLastRow()-1, 1).getValues();
        for (var j = 0; j < members.length; j++) {
          var mName = String(members[j][0]).trim();
          if (mName && mName.toLowerCase() !== user.name.toLowerCase() && !contactMap[mName]) {
            contactMap[mName] = '';
          }
        }
      }
    }

    var contacts = Object.keys(contactMap).map(function(name) {
      return { name: name, last_message: contactMap[name] };
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });

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
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 4).getValues();

    var messages = [];
    for (var i = 0; i < data.length; i++) {
      var from = String(data[i][1]).trim();
      var to = String(data[i][2]).trim();
      var isRelevant = (from.toLowerCase() === user.name.toLowerCase() && to.toLowerCase() === withUser.toLowerCase()) ||
                       (to.toLowerCase() === user.name.toLowerCase() && from.toLowerCase() === withUser.toLowerCase());
      if (isRelevant) {
        messages.push({
          timestamp: new Date(data[i][0]).getTime(),
          from: from,
          text: String(data[i][3]).trim()
        });
      }
    }
    return jsonResponse({ ok: true, messages: messages });
  } catch(err) { return jsonResponse({ ok: false, error: String(err) }); }
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
