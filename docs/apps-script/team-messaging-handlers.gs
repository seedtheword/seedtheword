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
      if (String(data[i][2]).trim() === itemId &&
          String(data[i][0]).trim() === date &&
          String(data[i][9]).toLowerCase().trim() === user.name.toLowerCase()) {
        // Column 5 is quantity (index 4)
        sheet.getRange(i + 2, 5).setValue(newQty);
        return jsonResponse({ ok: true, route: 'editScan', updated: true });
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
        scans.push({
          row_id: rowIdCol >= 0 ? String(data[i][rowIdCol]) : 'ROW-' + (i+2),
          date: String(data[i][0]),
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
          if (String(data[i][0]).trim() !== today) return jsonResponse({ ok: false, error: 'Can only edit today\'s entries' });
          if (String(data[i][9]).toLowerCase().trim() !== user.name.toLowerCase()) return jsonResponse({ ok: false, error: 'Can only edit your own entries' });
        }
        sheet.getRange(i + 2, 5).setValue(newQty); // Column 5 = qty
        return jsonResponse({ ok: true, route: 'editInventoryRow' });
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
    var data = sheet.getRange(2, 1, sheet.getLastRow()-1, 9).getValues();
    var members = data.map(function(row) {
      return { name: row[1], email: row[3], phone: row[4], role: row[5] || 'member', scans: parseInt(row[7]) || 0, telegram: row[8] || '' };
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
