/**
 * Seed the Word — Order Email Handler (Google Apps Script Web App)
 * ────────────────────────────────────────────────────────────────
 *
 * Receives one POST per order from bundle-builder.html, appends a
 * row to the Order Ledger Sheet, and sends 1–3 emails:
 *   - Gifter receipt (always)
 *   - Team notification to seedthewordministry@gmail.com (always)
 *   - Giftee heads-up (only when bundle is essentials/lifegroup AND
 *     the gifter ticked the opt-in box)
 *
 * Spec: .kiro/specs/order-emails-apps-script/
 *
 * Deployment procedure (also documented on admin-help.html):
 *   1. Sign in to script.google.com as seedthewordministry@gmail.com.
 *   2. Click + New project, rename to "STW Order Handler".
 *   3. Open sheets.new in another tab. Name the new sheet
 *      "STW Order Ledger". Rename its first tab to "Orders".
 *      The Sheet ID is already populated in LEDGER_SHEET_ID below;
 *      you only need to do step 3 if you create a fresh Sheet.
 *   4. (skip — Sheet ID is already filled in)
 *   4. Open this file (docs/apps-script/order-handler.gs) and copy
 *      its full contents.
 *   5. In the Apps Script editor, select all in Code.gs and paste over.
 *   6. (skip — LEDGER_SHEET_ID is already populated)
 *   7. Save (disk icon), then click Deploy → New deployment → Web app.
 *      Set Description = "v1", Execute as = "Me",
 *      Who has access = "Anyone". Click Deploy.
 *   8. Authorize when prompted (Sheets + Gmail scopes).
 *   9. Copy the Web app URL. Open the admin editor → Site config →
 *      paste it into orderHandlerUrl → Save & commit.
 *
 * MailApp.sendEmail does NOT need a Gmail App Password — the script
 * sends as the script owner via Google's session.
 */

// ── CONFIG ──────────────────────────────────────────────────────
const LEDGER_SHEET_ID = '17j5TDDTZ-58MuZ7VO7c1ohPkyHw2LZ2GCWYMFb-CJ50';
const TEAM_INBOX = 'seedthewordministry@gmail.com';
const LEDGER_TAB = 'Orders';

// ── Display labels for human-readable emails / Sheet rows ───────
const BUNDLE_DISPLAY = {
  essentials: 'Essentials Welcome',
  lifegroup: 'Life Group Starter',
  ministry: 'Ministry Calling',
};

const LEDGER_HEADERS = [
  'order_id', 'received_at', 'bundle',
  'gifter_name', 'gifter_email', 'gifter_phone',
  'delivery_details', 'dedication',
  'giftee_opt_in', 'giftee_name', 'giftee_email',
  'configuration', 'emails_sent', 'route',
];

// ── Entry point ──────────────────────────────────────────────────
function doPost(e) {
  let payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    console.log('JSON parse failed:', err);
    return jsonResponse({ ok: false, error: 'invalid-payload' });
  }

  // Honeypot — if a bot filled the _gotcha field, lie about success
  // and don't write/email anything. The browser sees it as ok and
  // moves on; we never see the spam.
  if (payload && payload._gotcha) {
    console.log('Honeypot triggered for payload:', JSON.stringify(payload).slice(0, 200));
    return jsonResponse({ ok: true, orderId: 'ignored', emailsSent: 0, route: 'honeypot' });
  }

  const valid = validatePayload(payload);
  if (!valid.ok) {
    console.log('Validation failed:', valid.reason);
    return jsonResponse({ ok: false, error: 'invalid-payload' });
  }

  let orderId = '';
  try {
    const sheet = openLedger();
    ensureHeaderRow(sheet);
    orderId = nextOrderId(sheet);
  } catch (err) {
    console.log('Sheet open / ID failed:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  // Append row first — if mail fails, the row at least lets the team
  // recover the order manually from the Sheet.
  let emailsSent = ['gifter', 'team'];
  if (
    (payload.bundle === 'essentials' || payload.bundle === 'lifegroup') &&
    payload.giftee && payload.giftee.optIn === true
  ) {
    emailsSent.push('giftee');
  }

  try {
    const sheet = openLedger();
    appendLedgerRow(sheet, payload, orderId, emailsSent);
  } catch (err) {
    console.log('Append failed:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  try {
    sendEmails(payload, orderId, emailsSent);
  } catch (err) {
    console.log('Mail send failed:', err);
    return jsonResponse({ ok: false, error: 'mail-send-failed', orderId: orderId });
  }

  return jsonResponse({
    ok: true,
    orderId: orderId,
    emailsSent: emailsSent.length,
    route: 'apps-script',
  });
}

// ── Validation ───────────────────────────────────────────────────
function validatePayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  if (['essentials', 'lifegroup', 'ministry'].indexOf(p.bundle) === -1) {
    return { ok: false, reason: 'bad-bundle' };
  }
  if (!p.gifter || typeof p.gifter !== 'object') return { ok: false, reason: 'no-gifter' };
  if (typeof p.gifter.name !== 'string' || !p.gifter.name.trim()) return { ok: false, reason: 'no-name' };
  if (typeof p.gifter.email !== 'string' || p.gifter.email.indexOf('@') === -1) return { ok: false, reason: 'bad-email' };
  if (typeof p.gifter.deliveryDetails !== 'string') return { ok: false, reason: 'no-delivery' };
  // Empty delivery is allowed for ministry; required for the others.
  if (p.bundle !== 'ministry' && !p.gifter.deliveryDetails.trim()) {
    return { ok: false, reason: 'empty-delivery' };
  }
  if (typeof p.configText !== 'string' || !p.configText.trim()) {
    return { ok: false, reason: 'no-config-text' };
  }
  if (p.bundle === 'ministry') {
    if (p.giftee !== null && p.giftee !== undefined) {
      return { ok: false, reason: 'ministry-with-giftee' };
    }
  } else {
    if (p.giftee !== null && p.giftee !== undefined) {
      if (typeof p.giftee !== 'object') return { ok: false, reason: 'giftee-not-object' };
      if (p.giftee.optIn !== true) return { ok: false, reason: 'giftee-not-opted-in' };
      if (typeof p.giftee.name !== 'string' || !p.giftee.name.trim()) return { ok: false, reason: 'no-giftee-name' };
      if (typeof p.giftee.email !== 'string' || p.giftee.email.indexOf('@') === -1) return { ok: false, reason: 'bad-giftee-email' };
    }
  }
  return { ok: true };
}

// ── Sheet helpers ────────────────────────────────────────────────
function openLedger() {
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  let sheet = ss.getSheetByName(LEDGER_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LEDGER_TAB);
  }
  return sheet;
}

function ensureHeaderRow(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LEDGER_HEADERS);
    return;
  }
  const range = sheet.getRange(1, 1, 1, LEDGER_HEADERS.length);
  const current = range.getValues()[0];
  let mismatch = false;
  for (let i = 0; i < LEDGER_HEADERS.length; i++) {
    if (current[i] !== LEDGER_HEADERS[i]) { mismatch = true; break; }
  }
  if (mismatch) {
    range.setValues([LEDGER_HEADERS]);
  }
}

function nextOrderId(sheet) {
  const today = formatYYYYMMDD(new Date());
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return 'STW-' + today + '-1';
  }
  const lastIdCell = sheet.getRange(lastRow, 1).getValue();
  const parts = String(lastIdCell || '').split('-');
  if (parts.length !== 3 || parts[0] !== 'STW') {
    return 'STW-' + today + '-1';
  }
  const prevDate = parts[1];
  const prevN = parseInt(parts[2], 10) || 0;
  return prevDate === today
    ? 'STW-' + today + '-' + (prevN + 1)
    : 'STW-' + today + '-1';
}

function appendLedgerRow(sheet, p, orderId, emailsSent) {
  const optInLabel =
    p.bundle === 'ministry' ? 'n/a' :
    (p.giftee && p.giftee.optIn) ? 'yes' : 'no';
  const row = [
    orderId,
    new Date(),
    p.bundle,
    p.gifter.name || '',
    p.gifter.email || '',
    p.gifter.phone || '',
    p.gifter.deliveryDetails || '',
    p.gifter.dedication || '',
    optInLabel,
    (p.giftee && p.giftee.name) || '',
    (p.giftee && p.giftee.email) || '',
    p.configText || '',
    emailsSent.join(','),
    'apps-script',
  ];
  sheet.appendRow(row);
}

function formatYYYYMMDD(date) {
  const tz = Session.getScriptTimeZone() || 'America/Los_Angeles';
  return Utilities.formatDate(date, tz, 'yyyyMMdd');
}

// ── Email composition ────────────────────────────────────────────
function sendEmails(p, orderId, emailsSent) {
  // Gifter receipt
  const gifter = buildGifterEmail(p, orderId);
  MailApp.sendEmail({
    to: gifter.to,
    subject: gifter.subject,
    body: gifter.body,
    replyTo: gifter.replyTo,
    name: 'Seed the Word Ministry',
  });

  // Team notification
  const team = buildTeamEmail(p, orderId);
  MailApp.sendEmail({
    to: team.to,
    subject: team.subject,
    body: team.body,
    replyTo: team.replyTo,
    name: 'STW Order Bot',
  });

  // Giftee heads-up — only when included in emailsSent
  if (emailsSent.indexOf('giftee') !== -1) {
    const giftee = buildGifteeEmail(p, orderId);
    MailApp.sendEmail({
      to: giftee.to,
      subject: giftee.subject,
      body: giftee.body,
      replyTo: giftee.replyTo,
      name: 'Seed the Word Ministry',
    });
  }
}

function buildGifterEmail(p, orderId) {
  const isMinistry = p.bundle === 'ministry';
  const subject = isMinistry
    ? 'STW Ministry Calling — we received your story, ' + p.gifter.name
    : 'STW Bundle — we got your order, ' + p.gifter.name;

  const lines = [];
  lines.push('Hi ' + p.gifter.name + ',');
  lines.push('');
  if (isMinistry) {
    lines.push('Thank you for sharing this with us. This isn\'t a checkout — it\'s an');
    lines.push('invitation, and we read every story personally before walking it');
    lines.push('through with you.');
    lines.push('');
    lines.push('Your story');
  } else {
    lines.push('We got your order. Below is what you sent us. We confirm every gift');
    lines.push('personally before any charge — you\'ll hear back from us by email');
    lines.push('within a few days.');
    lines.push('');
    lines.push('Your gift');
  }
  lines.push('─────────');
  lines.push(p.configText || '');
  lines.push('');

  if (!isMinistry && p.gifter.deliveryDetails) {
    lines.push('Where to send it');
    lines.push('─────────');
    lines.push(p.gifter.deliveryDetails);
    lines.push('');
  }

  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push(isMinistry ? "What you'd like us to know" : 'Dedication');
    lines.push('─────────');
    lines.push(p.gifter.dedication.trim());
    lines.push('');
  }

  if (!isMinistry && p.giftee && p.giftee.optIn === true) {
    lines.push('Heads-up to ' + (p.giftee.name || 'them'));
    lines.push('─────────');
    lines.push('We sent ' + (p.giftee.email || 'them') + ' a short note letting them know a gift is on the way.');
    lines.push('');
  }

  lines.push(isMinistry
    ? 'One of us will reach out by email within a few days. No automatic charge, no rush.'
    : 'Order reference: ' + orderId);
  if (isMinistry) {
    lines.push('');
    lines.push('Reference: ' + orderId);
  }
  lines.push('');
  lines.push(isMinistry
    ? 'Thank you for partnering with us.'
    : 'Thank you for partnering with us.');
  lines.push('');
  lines.push('— The Seed the Word team');

  return {
    to: p.gifter.email,
    subject: subject,
    body: lines.join('\n'),
    replyTo: TEAM_INBOX,
  };
}

function buildTeamEmail(p, orderId) {
  const display = BUNDLE_DISPLAY[p.bundle] || p.bundle;
  const lines = [];
  lines.push('New order received.');
  lines.push('');
  lines.push('Order ID:   ' + orderId);
  lines.push('Bundle:     ' + display);
  lines.push('Received:   ' + new Date().toISOString());
  lines.push('');
  lines.push('Gifter');
  lines.push('─────────');
  lines.push('Name:    ' + p.gifter.name);
  lines.push('Email:   ' + p.gifter.email);
  lines.push('Phone:   ' + (p.gifter.phone || '(none)'));
  lines.push('');
  if (p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    lines.push('Delivery');
    lines.push('─────────');
    lines.push(p.gifter.deliveryDetails);
    lines.push('');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push('Dedication / note to team');
    lines.push('─────────');
    lines.push(p.gifter.dedication.trim());
    lines.push('');
  }
  if (p.giftee && p.giftee.optIn === true) {
    lines.push('Giftee (heads-up sent)');
    lines.push('─────────');
    lines.push('Name:  ' + (p.giftee.name || ''));
    lines.push('Email: ' + (p.giftee.email || ''));
    lines.push('');
  }
  lines.push('Configuration');
  lines.push('─────────');
  lines.push(p.configText || '');
  lines.push('');
  lines.push('— Logged to the Order Ledger sheet, row appended.');

  return {
    to: TEAM_INBOX,
    subject: '[STW Order] ' + display + ' — ' + p.gifter.name + ' (' + orderId + ')',
    body: lines.join('\n'),
    replyTo: p.gifter.email,
  };
}

function buildGifteeEmail(p, orderId) {
  const lines = [];
  lines.push('Hi ' + (p.giftee.name || 'friend') + ',');
  lines.push('');
  lines.push((p.gifter.name || 'A friend') +
    ' asked us to send you a heads-up: a Bible bundle from Seed the Word');
  lines.push("Ministry is on its way to you. We'll be in touch soon to coordinate delivery.");
  lines.push('');
  lines.push("If anything's unclear, just reply to this email — it goes straight to our team.");
  lines.push('');
  lines.push('— The Seed the Word team');
  lines.push(TEAM_INBOX);

  return {
    to: p.giftee.email,
    subject: 'A gift is on its way to you',
    body: lines.join('\n'),
    replyTo: TEAM_INBOX,
  };
}

// ── HTTP response helper ────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
