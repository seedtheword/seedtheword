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
const CONTACT_TAB = 'Contact';
const STORIES_TAB = 'Stories';

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
  'is_special_order',
];

// Mirror of the catalog's tier='special' labels — server-side
// defense-in-depth so a forged isSpecialOrder=true can't bypass
// fulfillment without matching at least one known label, and a
// forged false can be flipped back to true if we see a label match.
const SPECIAL_ORDER_LABELS = [
  'Custom cover material / color',
  'Foil stamping (gold / silver / copper)',
  'Edge gilding (gold / silver page edges)',
  'Ribbon markers (single or multiple, custom colors)',
  'Hand-tooled / debossed / stamp designs',
  'Stuffed crochet figurine (custom design)',
  'Devotional books / 30-day prayer guides',
  'Custom painted / fabric-wrapped gift box',
  'Wooden gift crate (premium tier)',
  'Handwritten address label + stamped wax seal',
  'Custom tract bundles in matching covers',
  'Mass-engraved unifying line (event name + date)',
];

const CONTACT_HEADERS = [
  'received_at', 'name', 'email', 'subject', 'message', 'route',
];

const STORIES_HEADERS = [
  'received_at', 'name', 'email', 'consent_to_publish', 'story', 'media_url', 'route',
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
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  // Route on `type` discriminator. Default is 'order' for backward-
  // compat with bundle-builder.html submissions that pre-date the
  // multi-form support.
  const type = (payload && payload.type) || 'order';
  if (type === 'contact') return handleContact(payload);
  if (type === 'story')   return handleStory(payload);
  return handleOrder(payload);
}

// ── Order handler (existing flow, unchanged) ────────────────────
function handleOrder(payload) {
  const valid = validatePayload(payload);
  if (!valid.ok) {
    console.log('Validation failed:', valid.reason);
    return jsonResponse({ ok: false, error: 'invalid-payload' });
  }

  // Reconcile special-order claim against the server's catalog mirror.
  const so = reconcileSpecialOrder(payload);
  payload.isSpecialOrder = so.isSpecialOrder;
  payload.specialOrderItems = so.items;

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
    route: payload.isSpecialOrder ? 'apps-script-special' : 'apps-script',
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
  // New optional fields — additive, accept missing.
  if (p.isSpecialOrder !== undefined && typeof p.isSpecialOrder !== 'boolean') {
    return { ok: false, reason: 'bad-special-order-flag' };
  }
  if (p.specialOrderItems !== undefined && !Array.isArray(p.specialOrderItems)) {
    return { ok: false, reason: 'bad-special-order-items' };
  }
  if (p.signOptOut !== undefined && typeof p.signOptOut !== 'boolean') {
    return { ok: false, reason: 'bad-sign-opt-out' };
  }
  return { ok: true };
}

// Server-side defense-in-depth: cross-check every claimed special-
// order label against our hardcoded list. If the browser claims
// isSpecialOrder=true but no labels match, log + downgrade. If
// browser claims false but at least one label matches our catalog's
// tier=special set, upgrade.
function reconcileSpecialOrder(p) {
  var clientFlag = p.isSpecialOrder === true;
  var labels = Array.isArray(p.specialOrderItems) ? p.specialOrderItems : [];
  var matched = labels.filter(function (l) {
    return SPECIAL_ORDER_LABELS.indexOf(l) !== -1;
  });
  if (clientFlag && matched.length === 0) {
    console.log('[reconcile] client flagged special-order but no labels matched server list — treating as standard.');
    return { isSpecialOrder: false, items: [] };
  }
  if (!clientFlag && matched.length > 0) {
    console.log('[reconcile] client flagged standard but matched server special list — upgrading.');
    return { isSpecialOrder: true, items: matched };
  }
  return { isSpecialOrder: clientFlag, items: matched };
}

// ── Sheet helpers ────────────────────────────────────────────────
function openTab(tabName, headers) {
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  ensureHeadersFor(sheet, headers);
  return sheet;
}

function openLedger() {
  // Backward-compat helper for the order handler.
  return openTab(LEDGER_TAB, LEDGER_HEADERS);
}

function ensureHeadersFor(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }
  const range = sheet.getRange(1, 1, 1, headers.length);
  const current = range.getValues()[0];
  let mismatch = false;
  for (let i = 0; i < headers.length; i++) {
    if (current[i] !== headers[i]) { mismatch = true; break; }
  }
  if (mismatch) {
    range.setValues([headers]);
  }
}

function ensureHeaderRow(sheet) {
  // Backward-compat alias for the order flow.
  ensureHeadersFor(sheet, LEDGER_HEADERS);
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
    p.isSpecialOrder ? 'apps-script-special' : 'apps-script',
    p.isSpecialOrder ? 'yes' : 'no',
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
  const isSpecial = p.isSpecialOrder === true;
  const subject = isSpecial
    ? (isMinistry
        ? 'STW Special Order (Ministry) — we\'ll reach out, ' + p.gifter.name
        : 'STW Special Order — we\'ll reach out, ' + p.gifter.name)
    : (isMinistry
        ? 'STW Ministry Calling — we received your story, ' + p.gifter.name
        : 'STW Bundle — we got your order, ' + p.gifter.name);

  // ── Plain-text body (fallback for clients that don't render HTML) ──
  const lines = [];
  lines.push('Hi ' + p.gifter.name + ',');
  lines.push('');
  if (isSpecial) {
    lines.push('Thank you for sharing your special-order request with us. One of us');
    lines.push('will reach out before any work starts — no rush, no commitment yet.');
    lines.push('');
    lines.push('Special-order items flagged:');
    (p.specialOrderItems || []).forEach(function (l) { lines.push('  • ' + l); });
    lines.push('');
    lines.push(isMinistry ? 'Your story' : 'Your gift');
  } else if (isMinistry) {
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
  if (p.signOptOut === true) {
    lines.push('Per your request, we won\'t sign the back cover of the Bible.');
    lines.push('');
  }
  if (!isMinistry && p.giftee && p.giftee.optIn === true) {
    lines.push('Heads-up to ' + (p.giftee.name || 'them'));
    lines.push('─────────');
    lines.push('We sent ' + (p.giftee.email || 'them') + ' a short note letting them know a gift is on the way.');
    lines.push('');
  }
  if (isSpecial) {
    lines.push('One of us will reach out before any work starts — no rush, no commitment yet.');
    lines.push('');
    lines.push('Reference: ' + orderId);
  } else if (isMinistry) {
    lines.push('One of us will reach out by email within a few days. No automatic charge, no rush.');
    lines.push('');
    lines.push('Reference: ' + orderId);
  } else {
    lines.push('Order reference: ' + orderId);
  }
  lines.push('');
  lines.push('Thank you for partnering with us.');
  lines.push('');
  lines.push('— The Seed the Word team');

  // ── HTML body ────────────────────────────────────────────────
  let body = '';
  body += '<p style="margin:0 0 14px;">Hi <strong>' + escapeHtml(p.gifter.name) + '</strong>,</p>';
  if (isSpecial) {
    body += '<p style="margin:0 0 14px;">Thank you for sharing your special-order request with us. One of us will reach out before any work starts — no rush, no commitment yet.</p>';
    body += emailSection('🛎 Special-order items flagged',
      '<ul style="margin:0;padding-left:1.2rem;">' +
        (p.specialOrderItems || []).map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('') +
      '</ul>',
      { accent: STW_GOLD });
  } else if (isMinistry) {
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
  if (p.signOptOut === true) {
    body += emailSection('🖋 Back-cover signing',
      'Per your request, we won\'t sign the back cover of the Bible.',
      { accent: STW_MUTED });
  }
  if (!isMinistry && p.giftee && p.giftee.optIn === true) {
    body += emailSection('Heads-up sent to ' + escapeHtml(p.giftee.name || 'them'),
      'We sent <a href="mailto:' + escapeHtml(p.giftee.email || '') + '" style="color:' + STW_GREEN + ';">' + escapeHtml(p.giftee.email || '') + '</a> a short note letting them know a gift is on the way.',
      { accent: STW_GREEN });
  }
  body += '<p style="margin:18px 0 8px;font-size:13.5px;color:' + STW_MUTED + ';">' +
    (isSpecial
      ? 'Reference: <code style="background:#f4ece0;padding:2px 6px;border-radius:4px;color:' + STW_TEXT + ';">' + escapeHtml(orderId) + '</code>'
      : isMinistry
        ? 'One of us will reach out by email within a few days. No automatic charge, no rush.'
        : 'Order reference: <code style="background:#f4ece0;padding:2px 6px;border-radius:4px;color:' + STW_TEXT + ';">' + escapeHtml(orderId) + '</code>') +
    '</p>';
  if (isMinistry && !isSpecial) {
    body += '<p style="margin:6px 0 0;font-size:13.5px;color:' + STW_MUTED + ';">Reference: <code style="background:#f4ece0;padding:2px 6px;border-radius:4px;color:' + STW_TEXT + ';">' + escapeHtml(orderId) + '</code></p>';
  }
  body += '<p style="margin:18px 0 0;">Thank you for partnering with us.</p>';

  const accent = isSpecial ? STW_GOLD : STW_GREEN;
  const headerEmoji = isSpecial ? '🛎' : (isMinistry ? '🌾' : '🌱');
  const headerTitle = isSpecial
    ? 'We received your special-order request'
    : (isMinistry ? 'We received your story' : 'We got your order');
  const headerSub = isSpecial
    ? 'We\'ll reach out before any work starts'
    : (isMinistry ? 'Ministry Calling — invitation received' : BUNDLE_DISPLAY[p.bundle] + ' — gift received');

  const html = emailShell({
    headerEmoji: headerEmoji,
    headerTitle: headerTitle,
    headerSubtitle: headerSub,
    bodyHtml: body,
    footerHtml: '— The Seed the Word team · <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: accent,
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
  const isSpecial = p.isSpecialOrder === true;
  const subjectPrefix = isSpecial ? '[STW Special Order]' : '[STW Order]';

  // ── Plain-text body ──
  const lines = [];
  lines.push(isSpecial ? 'New SPECIAL-ORDER request received.' : 'New order received.');
  lines.push('');
  lines.push('Order ID:   ' + orderId);
  lines.push('Bundle:     ' + display);
  lines.push('Received:   ' + new Date().toISOString());
  if (isSpecial) {
    lines.push('');
    lines.push('🛎 SPECIAL-ORDER ITEMS — confirm before fulfilling:');
    (p.specialOrderItems || []).forEach(function (l) { lines.push('  • ' + l); });
  }
  lines.push('');
  lines.push('Gifter');
  lines.push('─────────');
  lines.push('Name:    ' + p.gifter.name);
  lines.push('Email:   ' + p.gifter.email);
  lines.push('Phone:   ' + (p.gifter.phone || '(none)'));
  lines.push('');
  if (p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    lines.push('Delivery'); lines.push('─────────');
    lines.push(p.gifter.deliveryDetails); lines.push('');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push('Dedication / note to team'); lines.push('─────────');
    lines.push(p.gifter.dedication.trim()); lines.push('');
  }
  if (p.signOptOut === true) {
    lines.push('🖋 Back-cover signing: SKIPPED per gifter request — do not sign.');
    lines.push('');
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
    (isSpecial
      ? '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.04em;">🛎 SPECIAL ORDER</span>'
      : '') +
    '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(display) + '</span>' +
    '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(orderId) + '</span>' +
    '<span style="display:inline-block;background:#f4ece0;color:' + STW_TEXT + ';padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;">Received ' + escapeHtml(new Date().toISOString()) + '</span>' +
  '</div>';

  // Special-order banner — appears ABOVE the gifter card
  if (isSpecial) {
    body += emailSection('🛎 Special-order items — confirm before fulfilling',
      '<ul style="margin:0;padding-left:1.2rem;">' +
        (p.specialOrderItems || []).map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('') +
      '</ul>',
      { accent: STW_GOLD });
  }

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

  // Sign-opt-out card
  if (p.signOptOut === true) {
    body += emailSection('🖋 Back-cover signing',
      '<strong style="color:#7a5a2a;">SKIPPED per gifter request — do not sign.</strong>',
      { accent: STW_GOLD });
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
    headerEmoji: isSpecial ? '🛎' : '📬',
    headerTitle: isSpecial ? 'New special-order request' : 'New order received',
    headerSubtitle: display + ' — from ' + p.gifter.name,
    bodyHtml: body,
    footerHtml: 'Reply to this email goes directly to the gifter.',
    accentColor: isSpecial ? STW_GOLD : STW_GREEN,
  });

  return {
    to: TEAM_INBOX,
    subject: subjectPrefix + ' ' + display + ' — ' + p.gifter.name + ' (' + orderId + ')',
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

// ── Contact form handler ─────────────────────────────────────────
function handleContact(payload) {
  const v = validateContactPayload(payload);
  if (!v.ok) {
    console.log('Contact validation failed:', v.reason);
    return jsonResponse({ ok: false, error: 'invalid-payload' });
  }

  const name    = String(payload.name || '').trim();
  const email   = String(payload.email || '').trim();
  const subject = String(payload.subject || '').trim();
  const message = String(payload.message || '').trim();

  try {
    const sheet = openTab(CONTACT_TAB, CONTACT_HEADERS);
    sheet.appendRow([
      new Date(), name, email, subject || '(none)', message, 'apps-script',
    ]);
  } catch (err) {
    console.log('Contact sheet append failed:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  try {
    const teamMail = buildContactTeamEmail({ name, email, subject, message });
    MailApp.sendEmail({
      to: teamMail.to,
      subject: teamMail.subject,
      body: teamMail.body,
      htmlBody: teamMail.html,
      replyTo: teamMail.replyTo,
      name: 'STW Contact Bot',
    });
  } catch (err) {
    console.log('Contact mail failed:', err);
    return jsonResponse({ ok: false, error: 'mail-send-failed' });
  }

  return jsonResponse({ ok: true, emailsSent: 1, route: 'apps-script' });
}

function validateContactPayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, reason: 'no-name' };
  if (typeof p.email !== 'string' || p.email.indexOf('@') === -1) return { ok: false, reason: 'bad-email' };
  if (typeof p.message !== 'string' || !p.message.trim()) return { ok: false, reason: 'no-message' };
  return { ok: true };
}

function buildContactTeamEmail(c) {
  const subjectLabel = c.subject || 'General contact';
  let body = '';
  body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;">' +
    '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">Contact</span>' +
    '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(subjectLabel) + '</span>' +
    '<span style="display:inline-block;background:#f4ece0;color:' + STW_TEXT + ';padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;">' + escapeHtml(new Date().toISOString()) + '</span>' +
  '</div>';

  body += emailSection('From',
    emailKeyValueRow([
      { label: 'Name',    value: '<strong>' + escapeHtml(c.name) + '</strong>' },
      { label: 'Email',   value: '<a href="mailto:' + escapeHtml(c.email) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(c.email) + '</a>' },
      { label: 'Subject', value: c.subject ? escapeHtml(c.subject) : '<span style="color:' + STW_MUTED + ';">(none)</span>' },
    ]),
    { accent: STW_GREEN });

  body += emailSection('💬 Message',
    '<div style="white-space:pre-wrap;font-size:14.5px;line-height:1.65;">' + escapeHtml(c.message) + '</div>',
    { accent: STW_GOLD });

  body += '<p style="margin:18px 0 0;font-size:12.5px;color:' + STW_MUTED + ';font-style:italic;">' +
    'Reply to this email goes directly to the sender. Logged to the Contact tab in the spreadsheet.' +
  '</p>';

  // Plain-text body
  const plainLines = [
    'New contact-form submission.',
    '',
    'From:    ' + c.name + ' <' + c.email + '>',
    'Subject: ' + (c.subject || '(none)'),
    'Sent:    ' + new Date().toISOString(),
    '',
    'Message',
    '─────────',
    c.message,
    '',
    '— Logged to the Contact tab.',
  ];

  const html = emailShell({
    headerEmoji: '✉️',
    headerTitle: 'New contact form message',
    headerSubtitle: 'From ' + c.name + (c.subject ? ' · ' + c.subject : ''),
    bodyHtml: body,
    footerHtml: 'Reply directly — this email\'s Reply-To is the sender.',
    accentColor: STW_GREEN,
  });

  return {
    to: TEAM_INBOX,
    subject: '[STW Contact] ' + subjectLabel + ' — ' + c.name,
    body: plainLines.join('\n'),
    html: html,
    replyTo: c.email,
  };
}

// ── Story handler (POST path — used if the site posts directly) ──
// Note: the Share-Your-Story modal currently iframes a Google Form.
// For that path we use the onFormSubmit trigger below. This handler
// is kept for future direct-POST use.
function handleStory(payload) {
  const v = validateStoryPayload(payload);
  if (!v.ok) {
    console.log('Story validation failed:', v.reason);
    return jsonResponse({ ok: false, error: 'invalid-payload' });
  }
  const name      = String(payload.name || '').trim();
  const email     = String(payload.email || '').trim();
  const story     = String(payload.story || '').trim();
  const consent   = !!payload.consentToPublish;
  const mediaUrl  = String(payload.mediaUrl || '').trim();

  try {
    const sheet = openTab(STORIES_TAB, STORIES_HEADERS);
    sheet.appendRow([
      new Date(), name, email, consent ? 'yes' : 'no', story, mediaUrl, 'apps-script',
    ]);
  } catch (err) {
    console.log('Story sheet append failed:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  try {
    const teamMail = buildStoryTeamEmail({ name, email, story, consent, mediaUrl });
    MailApp.sendEmail({
      to: teamMail.to,
      subject: teamMail.subject,
      body: teamMail.body,
      htmlBody: teamMail.html,
      replyTo: teamMail.replyTo,
      name: 'STW Story Bot',
    });
  } catch (err) {
    console.log('Story mail failed:', err);
    return jsonResponse({ ok: false, error: 'mail-send-failed' });
  }

  return jsonResponse({ ok: true, emailsSent: 1, route: 'apps-script' });
}

function validateStoryPayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, reason: 'no-name' };
  if (typeof p.email !== 'string' || p.email.indexOf('@') === -1) return { ok: false, reason: 'bad-email' };
  if (typeof p.story !== 'string' || !p.story.trim()) return { ok: false, reason: 'no-story' };
  return { ok: true };
}

function buildStoryTeamEmail(s) {
  let body = '';
  body += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;">' +
    '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">Story submission</span>' +
    '<span style="display:inline-block;background:' + (s.consent ? STW_GOLD : '#999') + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + (s.consent ? '✓ Consent to publish' : 'Private — do not publish') + '</span>' +
    '<span style="display:inline-block;background:#f4ece0;color:' + STW_TEXT + ';padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;">' + escapeHtml(new Date().toISOString()) + '</span>' +
  '</div>';

  body += emailSection('From',
    emailKeyValueRow([
      { label: 'Name',  value: '<strong>' + escapeHtml(s.name) + '</strong>' },
      { label: 'Email', value: '<a href="mailto:' + escapeHtml(s.email) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(s.email) + '</a>' },
    ]),
    { accent: STW_GREEN });

  body += emailSection('📖 Their story',
    '<div style="white-space:pre-wrap;font-size:14.5px;line-height:1.65;">' + escapeHtml(s.story) + '</div>',
    { accent: STW_GOLD });

  if (s.mediaUrl) {
    body += emailSection('🎞 Media',
      '<a href="' + escapeHtml(s.mediaUrl) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(s.mediaUrl) + '</a>',
      { accent: STW_GOLD });
  }

  body += '<p style="margin:18px 0 0;font-size:12.5px;color:' + STW_MUTED + ';font-style:italic;">' +
    'Logged to the Stories tab in the spreadsheet.' +
  '</p>';

  const plainLines = [
    'New story submission.',
    '',
    'From:    ' + s.name + ' <' + s.email + '>',
    'Consent: ' + (s.consent ? 'yes — OK to publish' : 'no — keep private'),
    'Sent:    ' + new Date().toISOString(),
    '',
    'Story',
    '─────────',
    s.story,
    '',
  ];
  if (s.mediaUrl) {
    plainLines.push('Media: ' + s.mediaUrl);
    plainLines.push('');
  }
  plainLines.push('— Logged to the Stories tab.');

  const html = emailShell({
    headerEmoji: '📖',
    headerTitle: 'New story shared with the ministry',
    headerSubtitle: 'From ' + s.name + (s.consent ? ' · OK to publish' : ' · private'),
    bodyHtml: body,
    footerHtml: 'Reply directly — this email\'s Reply-To is the sender.',
    accentColor: STW_GREEN,
  });

  return {
    to: TEAM_INBOX,
    subject: '[STW Story] ' + s.name + (s.consent ? ' (publish OK)' : ' (private)'),
    body: plainLines.join('\n'),
    html: html,
    replyTo: s.email,
  };
}

// ── Google Form trigger (Share Your Story) ──────────────────────
// Wire this up via Apps Script editor → ⏰ Triggers → + Add Trigger:
//   Function: onStoryFormSubmit
//   Event source: From spreadsheet
//   Event type: On form submit
// This fires every time someone submits the linked Google Form.
//
// The trigger event passes `e.namedValues` keyed by question text.
// Because the question text is configurable in the Form, we look up
// fields by best-effort label matching (case-insensitive substring).
function onStoryFormSubmit(e) {
  if (!e || !e.namedValues) {
    console.log('Form trigger fired without namedValues; aborting.');
    return;
  }

  const get = function (labelMatch) {
    const keys = Object.keys(e.namedValues);
    const want = labelMatch.toLowerCase();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase().indexOf(want) !== -1) {
        const v = e.namedValues[keys[i]];
        return Array.isArray(v) ? v.join(', ').trim() : String(v || '').trim();
      }
    }
    return '';
  };

  const name     = get('name');
  const email    = get('email');
  const story    = get('story') || get('share') || get('message');
  const consent  = (get('consent') || get('publish') || get('share')).toLowerCase().indexOf('yes') !== -1;
  const mediaUrl = get('media') || get('photo') || get('video') || get('upload');

  if (!name || !email || !story) {
    console.log('Form trigger missing required fields; namedValues:', JSON.stringify(e.namedValues));
    return;
  }

  // Append to our Stories tab so admins have a unified view.
  try {
    const sheet = openTab(STORIES_TAB, STORIES_HEADERS);
    sheet.appendRow([
      new Date(), name, email, consent ? 'yes' : 'no', story, mediaUrl, 'google-form',
    ]);
  } catch (err) {
    console.log('Story trigger sheet append failed:', err);
  }

  // Send the team the styled HTML email.
  try {
    const teamMail = buildStoryTeamEmail({ name, email, story, consent, mediaUrl });
    MailApp.sendEmail({
      to: teamMail.to,
      subject: teamMail.subject,
      body: teamMail.body,
      htmlBody: teamMail.html,
      replyTo: teamMail.replyTo,
      name: 'STW Story Bot',
    });
  } catch (err) {
    console.log('Story trigger mail failed:', err);
  }
}

// ── HTTP response helper ────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
