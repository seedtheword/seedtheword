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
    htmlBody: gifter.html,
    replyTo: gifter.replyTo,
    name: 'Seed the Word Ministry',
  });

  // Team notification
  const team = buildTeamEmail(p, orderId);
  MailApp.sendEmail({
    to: team.to,
    subject: team.subject,
    body: team.body,
    htmlBody: team.html,
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
      htmlBody: giftee.html,
      replyTo: giftee.replyTo,
      name: 'Seed the Word Ministry',
    });
  }
}

// ── HTML helpers ────────────────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

// Email-safe wrapper. Inline styles only — Gmail strips <style> blocks.
const STW_GREEN = '#2C5F2E';
const STW_GOLD  = '#d4a574';
const STW_CREAM = '#fdf3e3';
const STW_TEXT  = '#2b2b2b';
const STW_MUTED = '#666';
const STW_BORDER = '#e8e4de';

function emailShell(opts) {
  // opts: { headerEmoji, headerTitle, headerSubtitle, bodyHtml, footerHtml, accentColor }
  const accent = opts.accentColor || STW_GREEN;
  return '' +
    '<div style="margin:0;padding:24px 12px;background:#f7f3ec;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:' + STW_TEXT + ';line-height:1.55;">' +
      '<div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + STW_BORDER + ';box-shadow:0 4px 18px rgba(31,38,135,0.10);">' +
        // Header strip
        '<div style="background:linear-gradient(135deg,' + accent + ' 0%,' + STW_GOLD + ' 100%);padding:20px 24px;color:#fff;">' +
          '<div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.92;">' + escapeHtml(opts.headerEmoji + ' Seed the Word Ministry') + '</div>' +
          '<div style="font-size:22px;font-weight:800;margin-top:4px;">' + escapeHtml(opts.headerTitle) + '</div>' +
          (opts.headerSubtitle
            ? '<div style="font-size:14px;font-weight:500;margin-top:6px;opacity:0.95;">' + escapeHtml(opts.headerSubtitle) + '</div>'
            : '') +
        '</div>' +
        // Body
        '<div style="padding:24px 26px 18px 26px;font-size:15px;color:' + STW_TEXT + ';">' +
          opts.bodyHtml +
        '</div>' +
        // Footer
        '<div style="padding:14px 26px 22px 26px;border-top:1px solid ' + STW_BORDER + ';font-size:12.5px;color:' + STW_MUTED + ';">' +
          (opts.footerHtml || '— The Seed the Word team') +
        '</div>' +
      '</div>' +
    '</div>';
}

function emailSection(label, valueHtml, opts) {
  // opts: { accent: color, monospace: bool }
  const accent = (opts && opts.accent) || STW_GOLD;
  const valueStyle = (opts && opts.monospace)
    ? 'font-family:Consolas,Menlo,Monaco,Courier New,monospace;font-size:13.5px;white-space:pre-wrap;'
    : '';
  return '' +
    '<div style="margin:0 0 16px 0;padding:12px 14px 14px 14px;background:' + STW_CREAM + ';border-left:4px solid ' + accent + ';border-radius:8px;">' +
      '<div style="font-size:11.5px;letter-spacing:0.10em;text-transform:uppercase;font-weight:800;color:' + STW_GREEN + ';margin-bottom:6px;">' + escapeHtml(label) + '</div>' +
      '<div style="font-size:14.5px;color:' + STW_TEXT + ';' + valueStyle + '">' + valueHtml + '</div>' +
    '</div>';
}

function emailKeyValueRow(rows) {
  // rows: [{label, value}, ...]
  return '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' +
    rows.map(function (r) {
      return '<tr>' +
        '<td style="padding:4px 12px 4px 0;color:' + STW_MUTED + ';font-weight:700;font-size:13px;width:120px;vertical-align:top;">' + escapeHtml(r.label) + '</td>' +
        '<td style="padding:4px 0;color:' + STW_TEXT + ';font-size:14.5px;vertical-align:top;">' + r.value + '</td>' +
      '</tr>';
    }).join('') +
  '</table>';
}

function buildGifterEmail(p, orderId) {
  const isMinistry = p.bundle === 'ministry';
  const subject = isMinistry
    ? 'STW Ministry Calling — we received your story, ' + p.gifter.name
    : 'STW Bundle — we got your order, ' + p.gifter.name;

  // ── Plain-text body (fallback for clients that don't render HTML) ──
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
    lines.push('Where to send it'); lines.push('─────────');
    lines.push(p.gifter.deliveryDetails); lines.push('');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push(isMinistry ? "What you'd like us to know" : 'Dedication');
    lines.push('─────────');
    lines.push(p.gifter.dedication.trim()); lines.push('');
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
  if (isMinistry) { lines.push(''); lines.push('Reference: ' + orderId); }
  lines.push(''); lines.push('Thank you for partnering with us.');
  lines.push(''); lines.push('— The Seed the Word team');

  // ── HTML body ────────────────────────────────────────────────
  let body = '';
  body += '<p style="margin:0 0 14px;">Hi <strong>' + escapeHtml(p.gifter.name) + '</strong>,</p>';
  if (isMinistry) {
    body += '<p style="margin:0 0 18px;">Thank you for sharing this with us. This isn\'t a checkout — it\'s an invitation, and we read every story personally before walking it through with you.</p>';
  } else {
    body += '<p style="margin:0 0 18px;">We got your order. Below is what you sent us. We confirm every gift personally before any charge — you\'ll hear back from us by email within a few days.</p>';
  }
  body += emailSection(isMinistry ? 'Your story' : 'Your gift', '<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;">' + escapeHtml(p.configText || '') + '</div>');
  if (!isMinistry && p.gifter.deliveryDetails) {
    body += emailSection('Where to send it', '<div style="white-space:pre-wrap;">' + escapeHtml(p.gifter.deliveryDetails) + '</div>');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    body += emailSection(isMinistry ? "What you'd like us to know" : 'Dedication',
      '<em>' + nl2br(p.gifter.dedication.trim()) + '</em>');
  }
  if (!isMinistry && p.giftee && p.giftee.optIn === true) {
    body += emailSection('Heads-up sent to ' + escapeHtml(p.giftee.name || 'them'),
      'We sent <a href="mailto:' + escapeHtml(p.giftee.email || '') + '" style="color:' + STW_GREEN + ';">' + escapeHtml(p.giftee.email || '') + '</a> a short note letting them know a gift is on the way.',
      { accent: STW_GREEN });
  }
  body += '<p style="margin:18px 0 8px;font-size:13.5px;color:' + STW_MUTED + ';">' +
    (isMinistry
      ? 'One of us will reach out by email within a few days. No automatic charge, no rush.'
      : 'Order reference: <code style="background:#f4ece0;padding:2px 6px;border-radius:4px;color:' + STW_TEXT + ';">' + escapeHtml(orderId) + '</code>') +
    '</p>';
  if (isMinistry) {
    body += '<p style="margin:6px 0 0;font-size:13.5px;color:' + STW_MUTED + ';">Reference: <code style="background:#f4ece0;padding:2px 6px;border-radius:4px;color:' + STW_TEXT + ';">' + escapeHtml(orderId) + '</code></p>';
  }
  body += '<p style="margin:18px 0 0;">Thank you for partnering with us.</p>';

  const html = emailShell({
    headerEmoji: isMinistry ? '🌾' : '🌱',
    headerTitle: isMinistry ? 'We received your story' : 'We got your order',
    headerSubtitle: isMinistry ? 'Ministry Calling — invitation received' : BUNDLE_DISPLAY[p.bundle] + ' — gift received',
    bodyHtml: body,
    footerHtml: '— The Seed the Word team · <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: STW_GREEN,
  });

  return {
    to: p.gifter.email,
    subject: subject,
    body: lines.join('\n'),
    html: html,
    replyTo: TEAM_INBOX,
  };
}

function buildTeamEmail(p, orderId) {
  const display = BUNDLE_DISPLAY[p.bundle] || p.bundle;

  // ── Plain-text body ──
  const lines = [];
  lines.push('New order received.'); lines.push('');
  lines.push('Order ID:   ' + orderId);
  lines.push('Bundle:     ' + display);
  lines.push('Received:   ' + new Date().toISOString()); lines.push('');
  lines.push('Gifter'); lines.push('─────────');
  lines.push('Name:    ' + p.gifter.name);
  lines.push('Email:   ' + p.gifter.email);
  lines.push('Phone:   ' + (p.gifter.phone || '(none)')); lines.push('');
  if (p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    lines.push('Delivery'); lines.push('─────────');
    lines.push(p.gifter.deliveryDetails); lines.push('');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push('Dedication / note to team'); lines.push('─────────');
    lines.push(p.gifter.dedication.trim()); lines.push('');
  }
  if (p.giftee && p.giftee.optIn === true) {
    lines.push('Giftee (heads-up sent)'); lines.push('─────────');
    lines.push('Name:  ' + (p.giftee.name || ''));
    lines.push('Email: ' + (p.giftee.email || '')); lines.push('');
  }
  lines.push('Configuration'); lines.push('─────────');
  lines.push(p.configText || ''); lines.push('');
  lines.push('— Logged to the Order Ledger sheet, row appended.');

  // ── HTML body ────────────────────────────────────────────────
  let body = '';
  // At-a-glance summary header
  body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;">' +
    '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(display) + '</span>' +
    '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(orderId) + '</span>' +
    '<span style="display:inline-block;background:#f4ece0;color:' + STW_TEXT + ';padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;">Received ' + escapeHtml(new Date().toISOString()) + '</span>' +
  '</div>';

  // Gifter card
  body += emailSection('Gifter',
    emailKeyValueRow([
      { label: 'Name',  value: '<strong>' + escapeHtml(p.gifter.name) + '</strong>' },
      { label: 'Email', value: '<a href="mailto:' + escapeHtml(p.gifter.email) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(p.gifter.email) + '</a>' },
      { label: 'Phone', value: p.gifter.phone ? escapeHtml(p.gifter.phone) : '<span style="color:' + STW_MUTED + ';">(none)</span>' },
    ]),
    { accent: STW_GREEN });

  // Delivery card
  if (p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    body += emailSection('📦 Delivery',
      '<div style="white-space:pre-wrap;">' + escapeHtml(p.gifter.deliveryDetails) + '</div>');
  }

  // Dedication card
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    body += emailSection('💌 Dedication / note to team',
      '<em>' + nl2br(p.gifter.dedication.trim()) + '</em>');
  }

  // Giftee card
  if (p.giftee && p.giftee.optIn === true) {
    body += emailSection('🎁 Giftee — heads-up sent',
      emailKeyValueRow([
        { label: 'Name',  value: escapeHtml(p.giftee.name || '') },
        { label: 'Email', value: '<a href="mailto:' + escapeHtml(p.giftee.email || '') + '" style="color:' + STW_GREEN + ';">' + escapeHtml(p.giftee.email || '') + '</a>' },
      ]),
      { accent: STW_GOLD });
  }

  // Configuration card
  body += emailSection('🧾 Configuration',
    '<div style="white-space:pre-wrap;font-family:Consolas,Menlo,Monaco,Courier New,monospace;font-size:13px;color:' + STW_TEXT + ';">' + escapeHtml(p.configText || '') + '</div>',
    { accent: STW_GOLD, monospace: true });

  body += '<p style="margin:18px 0 0;font-size:12.5px;color:' + STW_MUTED + ';font-style:italic;">' +
    'Logged to the Order Ledger sheet · row appended.' +
  '</p>';

  const html = emailShell({
    headerEmoji: '📬',
    headerTitle: 'New order received',
    headerSubtitle: display + ' — from ' + p.gifter.name,
    bodyHtml: body,
    footerHtml: 'Reply to this email goes directly to the gifter.',
    accentColor: STW_GREEN,
  });

  return {
    to: TEAM_INBOX,
    subject: '[STW Order] ' + display + ' — ' + p.gifter.name + ' (' + orderId + ')',
    body: lines.join('\n'),
    html: html,
    replyTo: p.gifter.email,
  };
}

function buildGifteeEmail(p, orderId) {
  const lines = [];
  lines.push('Hi ' + (p.giftee.name || 'friend') + ',');
  lines.push('');
  lines.push((p.gifter.name || 'A friend') + ' asked us to send you a heads-up: a Bible bundle from Seed the Word');
  lines.push("Ministry is on its way to you. We'll be in touch soon to coordinate delivery.");
  lines.push('');
  lines.push("If anything's unclear, just reply to this email — it goes straight to our team.");
  lines.push(''); lines.push('— The Seed the Word team');
  lines.push(TEAM_INBOX);

  let body = '';
  body += '<p style="margin:0 0 14px;">Hi <strong>' + escapeHtml(p.giftee.name || 'friend') + '</strong>,</p>';
  body += '<p style="margin:0 0 14px;font-size:15.5px;line-height:1.6;">' +
    '<strong>' + escapeHtml(p.gifter.name || 'A friend') + '</strong> asked us to send you a heads-up: a Bible bundle from Seed the Word Ministry is on its way to you. We\'ll be in touch soon to coordinate delivery.</p>';
  body += '<div style="margin:18px 0;padding:14px 16px;background:' + STW_CREAM + ';border-left:4px solid ' + STW_GOLD + ';border-radius:8px;font-style:italic;color:' + STW_TEXT + ';">' +
    'If anything\'s unclear, just reply to this email — it goes straight to our team.' +
  '</div>';

  const html = emailShell({
    headerEmoji: '🎁',
    headerTitle: 'A gift is on its way to you',
    headerSubtitle: 'From ' + (p.gifter.name || 'a friend') + ' · via Seed the Word Ministry',
    bodyHtml: body,
    footerHtml: '— The Seed the Word team · <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: STW_GOLD,
  });

  return {
    to: p.giftee.email,
    subject: 'A gift is on its way to you',
    body: lines.join('\n'),
    html: html,
    replyTo: TEAM_INBOX,
  };
}

// ── HTTP response helper ────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
