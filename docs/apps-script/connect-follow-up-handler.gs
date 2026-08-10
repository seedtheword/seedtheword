/**
 * ═══════════════════════════════════════════════════════════════
 * CONNECT FOLLOW-UP HANDLER
 * ═══════════════════════════════════════════════════════════════
 * 
 * Paste this into your existing order-handler.gs (or a new .gs file
 * in the same Apps Script project).
 * 
 * What it does:
 * 1. Handles 'connectIntake' action from connect.html form submissions
 * 2. Stores contact info + notification preference in a "Contacts" sheet
 * 3. Sends Telegram notification to @seedtheword (which texts your phone)
 * 4. Provides a follow-up function that can be run on a schedule
 * 
 * Sheet setup needed:
 * - Create a sheet tab named "Contacts" with these columns in row 1:
 *   timestamp | name | email | phone | type | body | notify_pref | 
 *   followed_up | follow_up_date | notes
 * 
 * Script Properties needed:
 * - TELEGRAM_BOT_TOKEN (already set)
 * 
 * To wire up: In your doPost(e) router, add:
 *   case 'connectIntake': return handleConnectIntake_(payload);
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Handle incoming connect.html form submissions.
 * Called from doPost router with the parsed JSON payload.
 * 
 * Expected payload fields:
 *   action: 'connectIntake'
 *   kind: 'prayer' | 'thanksgiving' | 'bible'
 *   name, email, phone, body/story, notify_pref, anonymous
 */
function handleConnectIntake_(payload) {
  var kind = String(payload.kind || 'prayer');
  var name = String(payload.name || '').trim();
  var email = String(payload.email || '').trim();
  var phone = String(payload.phone || '').trim();
  var body = String(payload.body || payload.story || '').trim();
  var notifyPref = String(payload.notify_pref || 'email');
  var anonymous = payload.anonymous === 'on' || payload.anonymous === true;

  // Validate
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
    sheet.getRange(1, 1, 1, 10).setValues([[
      'timestamp', 'name', 'email', 'phone', 'type', 'body',
      'notify_pref', 'followed_up', 'follow_up_date', 'notes'
    ]]);
  }

  var now = new Date();
  sheet.appendRow([
    now.toISOString(),
    anonymous ? '(anonymous)' : name,
    email,
    phone,
    kind,
    body.substring(0, 2000),
    notifyPref,
    'no',
    '',
    ''
  ]);

  // Send Telegram notification to admin (you get this as a text)
  try {
    sendConnectNotification_(kind, name, email, phone, body, notifyPref, anonymous);
  } catch (e) {
    Logger.log('Telegram notification failed: ' + e.message);
  }

  // Also forward to the existing prayer-intake or requestBible handler
  // so it enters the existing pipeline too
  if (kind === 'prayer' || kind === 'thanksgiving') {
    try {
      // Forward to existing prayer pipeline
      var prayerPayload = {
        action: 'prayer-intake',
        kind: kind,
        name: anonymous ? '' : name,
        email: email,
        body: body,
        anonymous: anonymous,
        extra_field_2: ''
      };
      handlePrayerIntake_(prayerPayload);
    } catch (e) {
      Logger.log('Prayer pipeline forward failed: ' + e.message);
    }
  } else if (kind === 'bible') {
    try {
      var biblePayload = {
        action: 'requestBible',
        name: name,
        email: email,
        phone: phone,
        city: String(payload.city || '').trim(),
        state: String(payload.state || 'WA').trim(),
        story: body,
        extra_field_2: ''
      };
      handleRequestBible_(biblePayload);
    } catch (e) {
      Logger.log('Bible request forward failed: ' + e.message);
    }
  }

  return jsonResponse_({ ok: true, status: 'ok' });
}

/**
 * Send Telegram notification about new connect submission.
 * This goes to @seedtheword thread 553 (Announcements) which
 * triggers a push notification to your phone.
 */
function sendConnectNotification_(kind, name, email, phone, body, pref, anonymous) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return;

  var icons = { prayer: '🙏', thanksgiving: '🎉', bible: '📖' };
  var labels = { prayer: 'Prayer Request', thanksgiving: 'Thanksgiving', bible: 'Bible Request' };

  var message = (icons[kind] || '📬') + ' *New ' + (labels[kind] || 'Submission') + '* (via connect page)\n\n';
  
  if (!anonymous && name) message += '👤 ' + name + '\n';
  if (email) message += '📧 ' + email + '\n';
  if (phone) message += '📱 ' + phone + '\n';
  message += '🔔 Notify: ' + pref + '\n\n';
  message += '💬 ' + body.substring(0, 500);

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: '@seedtheword',
      message_thread_id: 553,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });
}

/**
 * ═══════════════════════════════════════════════════════════════
 * SCHEDULED FOLLOW-UP (run daily via time trigger)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Setup: In Apps Script, go to Triggers → Add Trigger:
 *   Function: runConnectFollowUp
 *   Event source: Time-driven
 *   Type: Day timer
 *   Time: 9am-10am
 * 
 * What it does:
 * - Checks Contacts sheet for entries not yet followed up
 * - For entries older than 24h with notify_pref != 'none':
 *   - Sends a follow-up Telegram message to the admin thread
 *     reminding the team to reach out
 * - Marks them as followed_up = 'reminded'
 * 
 * For email follow-ups (if you want to email the visitor directly):
 * - Uncomment the GmailApp.sendEmail section below
 */
function runConnectFollowUp() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contacts');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return; // header only

  var now = new Date();
  var oneDayMs = 24 * 60 * 60 * 1000;
  var reminders = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var timestamp = new Date(row[0]);
    var name = row[1];
    var email = row[2];
    var phone = row[3];
    var type = row[4];
    var body = row[5];
    var notifyPref = row[6];
    var followedUp = row[7];

    // Skip if already followed up or no follow-up wanted
    if (followedUp === 'done' || followedUp === 'reminded' || notifyPref === 'none') continue;

    // Only follow up after 24 hours
    if ((now.getTime() - timestamp.getTime()) < oneDayMs) continue;

    reminders.push({
      row: i + 1, // 1-indexed sheet row
      name: name,
      email: email,
      phone: phone,
      type: type,
      body: String(body).substring(0, 100),
      notifyPref: notifyPref
    });

    // Mark as reminded
    sheet.getRange(i + 1, 8).setValue('reminded');
    sheet.getRange(i + 1, 9).setValue(now.toISOString());
  }

  if (reminders.length === 0) return;

  // Send consolidated reminder to admin via Telegram
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return;

  var message = '📋 *Follow-up Reminder* (' + reminders.length + ' pending)\n\n';
  reminders.forEach(function(r, idx) {
    var icons = { prayer: '🙏', thanksgiving: '🎉', bible: '📖' };
    message += (idx + 1) + '. ' + (icons[r.type] || '📬') + ' ';
    message += (r.name || 'Anonymous') + ' — ' + r.type;
    if (r.email) message += '\n   📧 ' + r.email;
    if (r.notifyPref !== 'email') message += ' (prefers: ' + r.notifyPref + ')';
    message += '\n   💬 "' + r.body + '..."\n\n';
  });

  message += '_Reply to each person per their preference. Mark as done in the Contacts sheet._';

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: '@seedtheword',
      message_thread_id: 553,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });

  // ═══ OPTIONAL: Send email follow-ups to visitors ═══
  // Uncomment below to auto-email visitors who chose "email" preference.
  // Customize the subject/body as needed.
  /*
  reminders.forEach(function(r) {
    if (r.notifyPref === 'email' && r.email) {
      GmailApp.sendEmail(r.email, 
        'We\'re praying for you — Seed the Word',
        'Hi ' + (r.name || 'friend') + ',\n\n' +
        'Thank you for sharing with us. We wanted you to know our team is praying for you.\n\n' +
        'If you ever want to talk, reply to this email or join us on Telegram: https://t.me/seedtheword\n\n' +
        'God bless,\nSeed the Word Ministry\nhttps://seedtheword.org',
        { name: 'Seed the Word Ministry' }
      );
    }
  });
  */
}

/**
 * ═══════════════════════════════════════════════════════════════
 * EVENT REMINDER FOLLOW-UP (run before events)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Setup: Trigger this function ~3 hours before your regular events
 * (e.g., Monday 3:30pm for the 6:30pm fellowship, Saturday 4pm for study)
 * 
 * Sends a Telegram message to @seedtheword reminding contacts
 * who chose "events" preference about tonight's gathering.
 */
function sendEventReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Contacts');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var eventContacts = [];

  for (var i = 1; i < data.length; i++) {
    var notifyPref = data[i][6];
    var email = data[i][2];
    var name = data[i][1];
    if (notifyPref === 'events' && email) {
      eventContacts.push({ name: name, email: email });
    }
  }

  if (eventContacts.length === 0) return;

  // Notify admin about who to invite
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return;

  var today = new Date();
  var dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][today.getDay()];

  var message = '📅 *Event Reminder Contacts* (' + dayName + ')\n\n';
  message += eventContacts.length + ' people asked for event reminders:\n\n';
  eventContacts.forEach(function(c, i) {
    message += (i + 1) + '. ' + (c.name || 'Someone') + ' — ' + c.email + '\n';
  });
  message += '\n_Send them a quick invite email or Telegram message!_';

  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: '@seedtheword',
      message_thread_id: 553,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });
}


/* ═══════════════════════════════════════════════════════════════
   ROUTER ADDITION
   ═══════════════════════════════════════════════════════════════
   
   Add this case to your existing doPost(e) switch/if-else block
   in order-handler.gs:

   case 'connectIntake':
     return handleConnectIntake_(payload);

   That's it. The connect.html frontend will send:
     { action: 'connectIntake', kind: 'prayer|thanksgiving|bible', ... }

   ═══════════════════════════════════════════════════════════════ */
