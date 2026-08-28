/**
 * ═══════════════════════════════════════════════════════════════
 * CONNECT FOLLOW-UP HANDLER
 * ═══════════════════════════════════════════════════════════════
 * 
 * New file in the same Apps Script project as order-handler.gs.
 * 
 * What it does:
 * 1. Handles 'connectIntake' action from connect.html
 * 2. Stores contact + notification preference in "Contacts" sheet
 * 3. Notifies admin via Telegram on new submission
 * 4. Handles 'pushNotifyContacts' from team portal (admin pushes
 *    updates to contacts — prayer updates, announcements, etc.)
 * 5. Saturday weekly digest of upcoming events
 * 6. Monday event reminder for fellowship
 * 
 * IMPORTANT: The daily trigger does NOT spam contacts with generic
 * follow-ups. Contacts only receive messages when:
 *   - An admin pushes a notification (prayer update, announcement)
 *   - The Saturday weekly digest fires
 *   - The Monday event reminder fires (events-pref contacts only)
 * 
 * Sheet: "Contacts" — auto-created with columns:
 *   timestamp | name | email | phone | type | body |
 *   notify_pref | followed_up | follow_up_date | notes | carrier
 * 
 * Router addition needed in doPost:
 *   case 'connectIntake': return handleConnectIntake_(payload);
 *   case 'pushNotifyContacts': return handlePushNotify_(payload);
 * ═══════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════
// 1. INTAKE HANDLER (from connect.html)
// ═══════════════════════════════════════════════════════════════

function handleConnectIntake_(payload) {
  var kind = String(payload.kind || 'prayer');
  var name = String(payload.name || '').trim();
  var email = String(payload.email || '').trim();
  var phone = String(payload.phone || '').trim();
  var body = String(payload.body || payload.story || '').trim();
  var notifyPref = String(payload.notify_pref || 'email');
  var anonymous = payload.anonymous === 'on' || payload.anonymous === true;
  var carrier = String(payload.carrier || '').trim();

  if (!body || body.length < 10) {
    return jsonResponse_({ ok: false, error: 'Please share at least a few words.' });
  }
  if (kind === 'bible') {
    if (!name) return jsonResponse_({ ok: false, error: 'Please share your name.' });
    if (!email) return jsonResponse_({ ok: false, error: 'We need your email to reach you.' });
    if (body.length < 80) return jsonResponse_({ ok: false, error: 'Please share a bit more (a couple sentences).' });
  }

  // Store in Contacts sheet
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contacts');
  if (!sheet) {
    sheet = ss.insertSheet('Contacts');
    sheet.getRange(1, 1, 1, 11).setValues([[
      'timestamp', 'name', 'email', 'phone', 'type', 'body',
      'notify_pref', 'followed_up', 'follow_up_date', 'notes', 'carrier'
    ]]);
  }

  sheet.appendRow([
    new Date().toISOString(),
    anonymous ? '(anonymous)' : name,
    email, phone, kind,
    body.substring(0, 2000),
    notifyPref, 'new', '', '', carrier
  ]);

  // Notify admin via Telegram
  try { sendConnectNotification_(kind, name, email, phone, body, notifyPref, anonymous); }
  catch (e) { Logger.log('Telegram notify failed: ' + e.message); }

  // Forward to existing pipelines
  if (kind === 'prayer' || kind === 'thanksgiving') {
    try { handlePrayerIntake_({ action:'prayer-intake', kind:kind, name:anonymous?'':name, email:email, body:body, anonymous:anonymous, extra_field_2:'' }); }
    catch (e) { Logger.log('Prayer forward failed: ' + e.message); }
  } else if (kind === 'bible') {
    try { handleRequestBible_({ action:'requestBible', name:name, email:email, phone:phone, city:String(payload.city||'').trim(), state:String(payload.state||'WA').trim(), story:body, extra_field_2:'' }); }
    catch (e) { Logger.log('Bible forward failed: ' + e.message); }
  }

  return jsonResponse_({ ok: true, status: 'ok' });
}

// ═══════════════════════════════════════════════════════════════
// 2. ADMIN PUSH NOTIFICATIONS (from team portal)
// ═══════════════════════════════════════════════════════════════
//
// Admins/super_admins can push a message to all contacts (or filtered
// by type) via the team portal. This is the ONLY way contacts get
// notified outside of the weekly digest and Monday reminder.
//
// Payload: { action:'pushNotifyContacts', token, subject, message,
//            filter:'all'|'prayer'|'thanksgiving'|'bible' }

function handlePushNotify_(payload) {
  // Verify admin role
  var session = verifyToken_(payload.token);
  if (!session || (session.role !== 'admin' && session.role !== 'super_admin')) {
    return jsonResponse_({ ok: false, error: 'Admin access required.' });
  }

  var subject = String(payload.subject || '').trim();
  var message = String(payload.message || '').trim();
  var filter = String(payload.filter || 'all');

  if (!subject || !message) {
    return jsonResponse_({ ok: false, error: 'Subject and message required.' });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contacts');
  if (!sheet) return jsonResponse_({ ok: false, error: 'No contacts yet.' });

  var data = sheet.getDataRange().getValues();
  var sent = 0;

  for (var i = 1; i < data.length; i++) {
    var email = data[i][2];
    var phone = data[i][3];
    var type = data[i][4];
    var notifyPref = data[i][6];
    var carrier = data[i][10] || '';
    var name = data[i][1];

    if (notifyPref === 'none') continue;
    if (filter !== 'all' && type !== filter) continue;

    try {
      sendToContact_(name, email, phone, carrier, notifyPref, subject, message);
      sent++;
    } catch (e) { Logger.log('Push failed row ' + (i+1) + ': ' + e.message); }
  }

  // Confirm to admin
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (token) {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ chat_id:'@seedtheword', message_thread_id:553,
        text:'📨 Admin push sent to ' + sent + ' contact(s).\nSubject: ' + subject,
        disable_web_page_preview:true }),
      muteHttpExceptions: true
    });
  }

  return jsonResponse_({ ok: true, sent: sent });
}

// ═══════════════════════════════════════════════════════════════
// 3. SEND TO CONTACT (shared helper)
// ═══════════════════════════════════════════════════════════════

function sendToContact_(name, email, phone, carrier, pref, subject, message) {
  var personalMsg = message.replace(/\{name\}/g, name || 'friend');

  if ((pref === 'email' || pref === 'events') && email) {
    GmailApp.sendEmail(email, subject + ' — Seed the Word', personalMsg, { name: 'Seed the Word Ministry' });
  } else if (pref === 'sms' && phone) {
    var smsAddr = buildSmsGateway_(phone, carrier);
    if (smsAddr) {
      // SMS: short version (160 char limit)
      var smsText = 'Seed the Word: ' + subject + ' — ' + personalMsg.substring(0, 120);
      GmailApp.sendEmail(smsAddr, '', smsText, { name: 'Seed the Word', noReply: true });
    } else if (email) {
      // Fallback to email
      GmailApp.sendEmail(email, subject + ' — Seed the Word', personalMsg, { name: 'Seed the Word Ministry' });
    }
  } else if (pref === 'telegram') {
    // Can't auto-DM on Telegram — log for manual outreach
    Logger.log('Telegram pref contact (manual): ' + (name||'?') + ' — ' + (email||phone));
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. EMAIL-TO-SMS GATEWAY
// ═══════════════════════════════════════════════════════════════

function buildSmsGateway_(phone, carrier) {
  var digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.substring(1);
  if (digits.length !== 10) return null;

  var gateways = {
    'tmobile':    digits + '@tmomail.net',
    'att':        digits + '@txt.att.net',
    'verizon':    digits + '@vtext.com',
    'sprint':     digits + '@messaging.sprintpcs.com',
    'uscellular': digits + '@email.uscc.net',
    'metro':      digits + '@mymetropcs.com',
    'boost':      digits + '@sms.myboostmobile.com',
    'cricket':    digits + '@sms.cricketwireless.net',
    'mint':       digits + '@tmomail.net',
    'visible':    digits + '@vtext.com',
    'fi':         digits + '@msg.fi.google.com'
  };
  return gateways[carrier] || null;
}

// ═══════════════════════════════════════════════════════════════
// 5. ADMIN TELEGRAM NOTIFICATION (on new submission)
// ═══════════════════════════════════════════════════════════════

function sendConnectNotification_(kind, name, email, phone, body, pref, anonymous) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return;

  var icons = { prayer:'🙏', thanksgiving:'🎉', bible:'📖' };
  var labels = { prayer:'Prayer Request', thanksgiving:'Thanksgiving', bible:'Bible Request' };

  var msg = (icons[kind]||'📬') + ' *New ' + (labels[kind]||'Submission') + '* (connect page)\n\n';
  if (!anonymous && name) msg += '👤 ' + name + '\n';
  if (email) msg += '📧 ' + email + '\n';
  if (phone) msg += '📱 ' + phone + '\n';
  msg += '🔔 Pref: ' + pref + '\n\n💬 ' + body.substring(0, 500);

  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method:'post', contentType:'application/json',
    payload: JSON.stringify({ chat_id:'@seedtheword', message_thread_id:553, text:msg, parse_mode:'Markdown', disable_web_page_preview:true }),
    muteHttpExceptions: true
  });
}

// ═══════════════════════════════════════════════════════════════
// 6. SATURDAY WEEKLY DIGEST (what's coming next week)
// ═══════════════════════════════════════════════════════════════

function sendWeeklyDigest_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contacts');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var contacts = [];

  for (var i = 1; i < data.length; i++) {
    var pref = data[i][6];
    if (pref === 'none') continue;
    var email = data[i][2];
    var phone = data[i][3];
    var carrier = data[i][10] || '';
    var name = data[i][1];
    if (email || (phone && carrier)) {
      contacts.push({ name:name, email:email, phone:phone, carrier:carrier, pref:pref });
    }
  }
  if (contacts.length === 0) return;

  var nextMon = getNextWeekday_(1);
  var nextSat = getNextWeekday_(6);

  var subject = 'This week at Seed the Word';
  var body = 'Hey {name}!\n\n' +
    'Here\'s what\'s coming this week:\n\n' +
    '📅 Monday ' + fmtDate_(nextMon) + ' — Fellowship & Worship (6:30 PM)\n' +
    '📺 Saturday ' + fmtDate_(nextSat) + ' — Study Saturday livestream (7 PM PT)\n' +
    '📖 Daily Bible reading Mon–Fri\n\n' +
    'Join us online: https://seedtheword.org/community\n' +
    'Telegram: https://t.me/seedtheword\n\n' +
    'See you there!\n— Seed the Word Ministry';

  var sent = 0;
  contacts.forEach(function(c) {
    try { sendToContact_(c.name, c.email, c.phone, c.carrier, c.pref, subject, body); sent++; }
    catch(e) { Logger.log('Digest fail: ' + e.message); }
  });

  // Admin confirmation
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (token) {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method:'post', contentType:'application/json',
      payload: JSON.stringify({ chat_id:'@seedtheword', message_thread_id:553, text:'📨 Weekly digest sent to ' + sent + ' contact(s).', disable_web_page_preview:true }),
      muteHttpExceptions: true
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. MONDAY EVENT REMINDER (fellowship tonight)
// ═══════════════════════════════════════════════════════════════

function sendMondayReminder_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contacts');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var contacts = [];

  for (var i = 1; i < data.length; i++) {
    var pref = data[i][6];
    if (pref !== 'events' && pref !== 'email' && pref !== 'sms') continue;
    var email = data[i][2];
    var phone = data[i][3];
    var carrier = data[i][10] || '';
    var name = data[i][1];
    if (email || (phone && carrier)) {
      contacts.push({ name:name, email:email, phone:phone, carrier:carrier, pref:pref });
    }
  }
  if (contacts.length === 0) return;

  var subject = 'Tonight: Fellowship & Worship';
  var body = 'Hey {name}! Just a reminder — we have Fellowship & Worship tonight at 6:30 PM.\n\n' +
    'Come as you are. Everyone is welcome.\n\n' +
    'Community page: https://seedtheword.org/community\n' +
    'Questions? Message us: https://t.me/seedtheword\n\n' +
    '— Seed the Word Ministry';

  contacts.forEach(function(c) {
    try { sendToContact_(c.name, c.email, c.phone, c.carrier, c.pref, subject, body); }
    catch(e) { Logger.log('Monday reminder fail: ' + e.message); }
  });
}

// ═══════════════════════════════════════════════════════════════
// 8. HELPERS
// ═══════════════════════════════════════════════════════════════

function getNextWeekday_(targetDay) {
  var d = new Date();
  var diff = targetDay - d.getDay();
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function fmtDate_(d) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

// ═══════════════════════════════════════════════════════════════
// 9. AUTO-INSTALL TRIGGERS
// ═══════════════════════════════════════════════════════════════
//
// Run ONCE manually: Run → installConnectTriggers
// Creates all scheduled triggers automatically.

function installConnectTriggers() {
  // Clean up existing
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendWeeklyDigest_' || fn === 'sendMondayReminder_') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Saturday 10am PT — weekly digest (what's coming next week)
  ScriptApp.newTrigger('sendWeeklyDigest_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(10)
    .inTimezone('America/Los_Angeles')
    .create();

  // Monday 3pm PT — tonight's fellowship reminder
  ScriptApp.newTrigger('sendMondayReminder_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(15)
    .inTimezone('America/Los_Angeles')
    .create();

  Logger.log('✅ Triggers installed: Saturday 10am (weekly digest), Monday 3pm (event reminder)');
}


// ═══════════════════════════════════════════════════════════════
// 10. UPDATE PROFILE (from profile-settings.js)
// ═══════════════════════════════════════════════════════════════
//
// Router: case 'updateProfile': return handleUpdateProfile_(payload);
//
// Updates TeamMembers sheet with contact/notification preferences.

function handleUpdateProfile_(payload) {
  var user = validateTeamToken_(String(payload.token || ''));
  if (!user) return jsonResponse({ ok: false, error: 'Invalid session.' });

  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('TeamMembers');
  if (!sheet) return jsonResponse({ ok: false, error: 'Sheet not found.' });

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find the member row by token
  var tokenCol = headers.indexOf('token');
  if (tokenCol === -1) {
    // Try first column as token (standard layout)
    tokenCol = 0;
  }
  var emailCol = headers.indexOf('email');
  var phoneCol = headers.indexOf('phone');
  var telegramCol = headers.indexOf('telegram_username');

  // Add notify_pref and carrier columns if they don't exist
  var notifyCol = headers.indexOf('notify_pref');
  if (notifyCol === -1) {
    notifyCol = headers.length;
    sheet.getRange(1, notifyCol + 1).setValue('notify_pref');
  }
  var carrierCol = headers.indexOf('carrier');
  if (carrierCol === -1) {
    carrierCol = (notifyCol >= headers.length ? headers.length + 1 : headers.length);
    sheet.getRange(1, carrierCol + 1).setValue('carrier');
  }

  // Newsletter opt-in column (add if missing).
  var newsletterCol = headers.indexOf('newsletter_opt_in');
  if (newsletterCol === -1) {
    newsletterCol = sheet.getLastColumn(); // append after current last used column
    sheet.getRange(1, newsletterCol + 1).setValue('newsletter_opt_in');
  }

  var token = String(payload.token || '').trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][tokenCol]).trim() === token) {
      var row = i + 1;
      if (emailCol >= 0 && payload.email !== undefined) sheet.getRange(row, emailCol + 1).setValue(String(payload.email || '').trim());
      if (phoneCol >= 0 && payload.phone !== undefined) sheet.getRange(row, phoneCol + 1).setValue(String(payload.phone || '').trim());
      if (telegramCol >= 0 && payload.telegram_username !== undefined) sheet.getRange(row, telegramCol + 1).setValue(String(payload.telegram_username || '').trim());
      sheet.getRange(row, notifyCol + 1).setValue(String(payload.notify_pref || 'email'));
      sheet.getRange(row, carrierCol + 1).setValue(String(payload.carrier || ''));
      if (payload.newsletter_opt_in !== undefined) {
        var nlVal = (payload.newsletter_opt_in === 'YES' || payload.newsletter_opt_in === true) ? 'YES' : 'no';
        sheet.getRange(row, newsletterCol + 1).setValue(nlVal);
      }

      // Also update the name if provided
      var nameCol = headers.indexOf('name');
      if (nameCol === -1) nameCol = 1; // Standard layout: column B
      if (payload.name && payload.name.trim()) {
        sheet.getRange(row, nameCol + 1).setValue(String(payload.name).trim());
      }

      // Password change if new_password_hash provided
      if (payload.new_password_hash) {
        var passCol = headers.indexOf('password_hash');
        if (passCol === -1) passCol = 2; // Standard layout: column C
        sheet.getRange(row, passCol + 1).setValue(String(payload.new_password_hash));
      }

      // Profile picture upload to Drive
      if (payload.profile_pic_data && payload.profile_pic_data.indexOf('data:') === 0) {
        try {
          var picUrl = uploadProfilePicToDrive_(payload.profile_pic_data, String(data[i][nameCol]));
          // Store URL in a profile_pic_url column (add if missing)
          var picCol = headers.indexOf('profile_pic_url');
          if (picCol === -1) {
            picCol = headers.length;
            sheet.getRange(1, picCol + 1).setValue('profile_pic_url');
          }
          sheet.getRange(row, picCol + 1).setValue(picUrl);
        } catch(picErr) { /* non-fatal */ }
      }

      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: false, error: 'Member not found.' });
}

// ── Upload Profile Picture to Google Drive ───────────────────────
// Stores in "STW Profile Pictures" folder, replaces previous if exists
function uploadProfilePicToDrive_(dataUrl, memberName) {
  var parts = dataUrl.split(',');
  var mimeMatch = parts[0].match(/data:(.*?);/);
  var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  var base64Data = parts[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType);

  var ext = mimeType.split('/')[1] || 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  var safeName = (memberName || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
  var fileName = 'profile_' + safeName + '.' + ext;
  blob.setName(fileName);

  // Find or create the profile pictures folder
  var folders = DriveApp.getFoldersByName('STW Profile Pictures');
  var folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder('STW Profile Pictures');
  }

  // Delete previous profile pic for this member if exists
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }

  // Upload new
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return file.getDownloadUrl();
}
