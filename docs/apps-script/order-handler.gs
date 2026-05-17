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

// Public site URL — used in email footers to link back to ministry
// pages (community, news, store, etc.). Trailing slash kept.
const SITE_URL = 'https://seedtheword.github.io/seedtheword/';

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
  'status',          // appended last (Feature 1, ministry-ops-and-testimonies spec)
];

// Status workflow vocabulary. The `status` cell in each Orders row drives
// the per-status auto-reply email. Edits to this cell are caught by the
// onOrderStatusEdit simple-trigger handler at the bottom of this file.
// Keep these strings lowercase and in sync with the data-validation
// dropdown set up on the Sheet's status column.
const STATUS_CHOICES = [
  'new',          // default on insert; written automatically by appendLedgerRow
  'confirming',   // team has reached out to confirm
  'packing',      // assembled, prayed over, awaiting shipment
  'shipped',      // physically in transit
  'delivered',    // recipient confirmed
  'cancelled',    // gifter cancelled or team cancelled (refund letter)
];
const STATUS_INDEX = LEDGER_HEADERS.indexOf('status') + 1; // 1-based for getRange()

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
  'received_at', 'name', 'email', 'consent_to_publish', 'location', 'story', 'media_url', 'route',
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
    'new',  // initial status; admins move this through the dropdown
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

// "Walk with us" callout — inserted in the body of any email destined
// for a non-team recipient (gifter, giftee, contact sender, story
// submitter). 2x2 grid of branded pill cards instead of a flat link
// list. Anchor verse + decorative flourishes for a richer feel.
function emailMinistryFooter() {
  const card = function (emoji, title, sub, url, accentBg) {
    return '' +
      '<td valign="top" width="50%" style="width:50%;padding:6px;">' +
        '<a href="' + url + '" style="display:block;text-decoration:none;background-color:#ffffff;border:1px solid ' + STW_BORDER + ';border-left:4px solid ' + accentBg + ';border-radius:10px;padding:14px 16px;color:' + STW_TEXT + ';">' +
          '<div style="font-size:22px;line-height:1;margin-bottom:6px;">' + emoji + '</div>' +
          '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:15px;font-weight:600;color:' + STW_GREEN + ';line-height:1.3;margin-bottom:3px;">' + title + ' &rarr;</div>' +
          '<div style="font-size:12.5px;color:' + STW_MUTED + ';line-height:1.45;">' + sub + '</div>' +
        '</a>' +
      '</td>';
  };
  return '' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:18px 0 0;">' +
      '<tr>' +
        '<td style="text-align:center;padding:0 0 12px;">' +
          '<div style="display:inline-block;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;font-weight:700;color:' + STW_GOLD + ';">' +
            '&#10086;&nbsp;&nbsp;Walk with us&nbsp;&nbsp;&#10086;' +
          '</div>' +
        '</td>' +
      '</tr>' +
      '<tr>' +
        '<td>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
            '<tr>' +
              card('&#128218;', 'Daily Bible reading',  'Reading plan + Saturday studies', SITE_URL + 'community.html', STW_GREEN) +
              card('&#128197;', 'This week\'s events', 'Worship, outreach, fellowship',  SITE_URL + 'news.html',      STW_GOLD) +
            '</tr>' +
            '<tr>' +
              card('&#127873;', 'Bibles for those you love', 'Gift bundles &amp; ministry calling', SITE_URL + 'store.html', STW_GOLD) +
              card('&#128247;', 'Follow along',         'Instagram, Telegram, YouTube',     'https://www.instagram.com/seedtheword/', STW_GREEN) +
            '</tr>' +
          '</table>' +
        '</td>' +
      '</tr>' +
    '</table>';
}

// Small social-icon row used in the bottom footer of every email.
// Circular emoji-style buttons, table-laid out so Gmail keeps the
// gaps between cells.
function emailSocialIcons() {
  const icon = function (label, url, bg) {
    return '<td style="padding:0 4px;">' +
      '<a href="' + url + '" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background-color:' + bg + ';color:#ffffff;border-radius:50%;font-size:15px;text-decoration:none;font-weight:700;" title="' + label + '">' + label.charAt(0) + '</a>' +
    '</td>';
  };
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:collapse;margin:0 auto;">' +
    '<tr>' +
      icon('Instagram', 'https://www.instagram.com/seedtheword/', '#E1306C') +
      icon('Telegram',  'https://t.me/seedtheword',                '#0088cc') +
      icon('YouTube',   'https://www.youtube.com/@seedtheword',    '#cc0000') +
      icon('Email',     'mailto:' + TEAM_INBOX,                    STW_GREEN) +
    '</tr>' +
  '</table>';
}

function emailShell(opts) {
  // opts: { headerTitle, headerSubtitle, bodyHtml, footerHtml,
  //         accentColor (kept for back-compat; current shell uses
  //         a tri-color top band), includeMinistryFooter (bool) }
  const hasMinistry = !!opts.includeMinistryFooter;

  // Tri-color top band — three table cells with bgcolor approximate a
  // gradient stripe across all email clients (no real gradient because
  // Outlook strips background-image).
  const topBand =
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;">' +
      '<tr style="height:6px;">' +
        '<td bgcolor="' + STW_GREEN + '" style="background-color:' + STW_GREEN + ';height:6px;line-height:6px;font-size:0;width:30%;">&nbsp;</td>' +
        '<td bgcolor="' + STW_GOLD  + '" style="background-color:' + STW_GOLD  + ';height:6px;line-height:6px;font-size:0;width:40%;">&nbsp;</td>' +
        '<td bgcolor="' + STW_GREEN + '" style="background-color:' + STW_GREEN + ';height:6px;line-height:6px;font-size:0;width:30%;">&nbsp;</td>' +
      '</tr>' +
    '</table>';

  // Branded masthead — eyebrow with flourishes, big serif headline,
  // italic subtitle. Centered to feel like a letter, not a form.
  const masthead =
    '<div style="padding:34px 36px 24px 36px;text-align:center;">' +
      '<div style="font-size:10.5px;letter-spacing:0.34em;text-transform:uppercase;font-weight:700;color:' + STW_GOLD + ';margin-bottom:14px;">' +
        '&#10086;&nbsp;&nbsp;Seed the Word Ministry&nbsp;&nbsp;&#10086;' +
      '</div>' +
      '<h1 style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:28px;font-weight:400;color:' + STW_TEXT + ';line-height:1.25;letter-spacing:-0.01em;">' +
        escapeHtml(opts.headerTitle) +
      '</h1>' +
      (opts.headerSubtitle
        ? '<p style="margin:12px 0 0;font-family:Georgia,\'Times New Roman\',serif;font-size:15px;font-style:italic;color:' + STW_MUTED + ';line-height:1.5;">' + escapeHtml(opts.headerSubtitle) + '</p>'
        : '') +
    '</div>';

  // Cream-band anchor verse — only on public-facing emails so team
  // notifications stay operational-looking.
  const verseBand = hasMinistry
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
        '<tr>' +
          '<td bgcolor="' + STW_CREAM + '" style="background-color:' + STW_CREAM + ';padding:18px 32px;text-align:center;border-top:1px solid ' + STW_BORDER + ';border-bottom:1px solid ' + STW_BORDER + ';">' +
            '<p style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:15.5px;font-style:italic;color:' + STW_GREEN + ';line-height:1.55;">' +
              '<span style="color:' + STW_GOLD + ';font-style:normal;">&#10086;</span>&nbsp;&nbsp;' +
              '&ldquo;Your word is a lamp for my feet, a light on my path.&rdquo;' +
              '&nbsp;&nbsp;<span style="color:' + STW_GOLD + ';font-style:normal;">&#10086;</span>' +
            '</p>' +
            '<p style="margin:6px 0 0;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:' + STW_MUTED + ';font-weight:700;">' +
              'Psalm 119:105' +
            '</p>' +
          '</td>' +
        '</tr>' +
      '</table>'
    : '';

  // Body content
  const body =
    '<div style="padding:30px 36px 14px 36px;font-size:15px;color:' + STW_TEXT + ';line-height:1.6;">' +
      opts.bodyHtml +
    '</div>';

  // Walk-with-us card panel (only on public-facing emails)
  const walkPanel = hasMinistry
    ? '<div style="padding:6px 28px 22px 28px;">' + emailMinistryFooter() + '</div>'
    : '';

  // Bottom footer — social icons + sign-off line
  const footer =
    '<div style="padding:20px 32px 26px 32px;border-top:1px solid ' + STW_BORDER + ';background-color:#fcfaf6;text-align:center;">' +
      (hasMinistry ? '<div style="margin:0 0 14px;">' + emailSocialIcons() + '</div>' : '') +
      '<div style="font-size:12.5px;color:' + STW_MUTED + ';line-height:1.55;">' +
        (opts.footerHtml || 'Seed the Word Ministry') +
      '</div>' +
      (hasMinistry
        ? '<div style="margin:10px 0 0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:' + STW_GOLD + ';font-weight:700;">' +
            '&#10086;&nbsp;&nbsp;Seed the Word Ministry&nbsp;&nbsp;&#10086;' +
          '</div>'
        : '') +
    '</div>';

  return '' +
    '<div style="margin:0;padding:32px 12px;background-color:#f7f3ec;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:' + STW_TEXT + ';line-height:1.6;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="640" style="max-width:640px;width:100%;margin:0 auto;background-color:#ffffff;border:1px solid ' + STW_BORDER + ';border-radius:14px;overflow:hidden;box-shadow:0 4px 22px rgba(31,38,135,0.08);">' +
        '<tr><td style="padding:0;">' +
          topBand +
          masthead +
          verseBand +
          body +
          walkPanel +
          footer +
        '</td></tr>' +
      '</table>' +
    '</div>';
}

function emailSection(label, valueHtml, opts) {
  // opts: { accent, monospace, dense }
  const accent = (opts && opts.accent) || STW_GOLD;
  const dense  = !!(opts && opts.dense);
  const valueStyle = (opts && opts.monospace)
    ? 'font-family:Consolas,Menlo,Monaco,Courier New,monospace;font-size:13px;white-space:pre-wrap;'
    : '';
  return '' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 ' + (dense ? '16px' : '22px') + ';">' +
      '<tr>' +
        '<td style="padding:0 0 9px 0;">' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
            '<tr>' +
              '<td bgcolor="' + accent + '" style="background-color:' + accent + ';width:24px;height:2px;font-size:0;line-height:2px;">&nbsp;</td>' +
              '<td style="padding-left:10px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;font-weight:700;color:' + accent + ';white-space:nowrap;">' + escapeHtml(label) + '</td>' +
            '</tr>' +
          '</table>' +
        '</td>' +
      '</tr>' +
      '<tr>' +
        '<td style="font-size:14.5px;color:' + STW_TEXT + ';line-height:1.6;' + valueStyle + '">' + valueHtml + '</td>' +
      '</tr>' +
    '</table>';
}

function emailKeyValueRow(rows) {
  return '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' +
    rows.map(function (r) {
      return '<tr>' +
        '<td style="padding:3px 14px 3px 0;color:' + STW_MUTED + ';font-weight:600;font-size:13px;width:120px;vertical-align:top;">' + escapeHtml(r.label) + '</td>' +
        '<td style="padding:3px 0;color:' + STW_TEXT + ';font-size:14px;vertical-align:top;">' + r.value + '</td>' +
      '</tr>';
    }).join('') +
  '</table>';
}

// Render a string of "Label: value" lines OR a multi-line string as a
// clean HTML <ul> for the email body. Auto-detects "Key: value" vs
// plain bullet by looking for a colon in the first 60 chars.
function emailBulletList(text) {
  if (!text) return '';
  var lines = String(text).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!lines.length) return '';
  var items = lines.map(function (line) {
    var colonIdx = line.indexOf(':');
    // Treat as "Label: value" only if colon is in first 30 chars and
    // the label half is short (i.e. it's a real key).
    if (colonIdx > 0 && colonIdx < 30) {
      var label = line.slice(0, colonIdx).trim();
      var value = line.slice(colonIdx + 1).trim();
      if (value) {
        return '<li style="margin:0 0 5px;"><strong style="color:' + STW_TEXT + ';">' + escapeHtml(label) + ':</strong> ' + escapeHtml(value) + '</li>';
      }
      // No value after colon — treat the label as a sub-header.
      return '<li style="margin:8px 0 4px;list-style:none;font-weight:700;color:' + STW_GREEN + ';font-size:12.5px;letter-spacing:0.04em;text-transform:uppercase;">' + escapeHtml(label) + '</li>';
    }
    // Indented sub-line (the script emits 2-space indents under labels)
    if (/^\s+/.test(String(text).split('\n').find(function (raw) { return raw.trim() === line; }) || '')) {
      // best-effort: render as a sub-bullet
      return '<li style="margin:0 0 4px;list-style-type:circle;color:' + STW_TEXT + ';">' + escapeHtml(line) + '</li>';
    }
    return '<li style="margin:0 0 5px;">' + escapeHtml(line) + '</li>';
  }).join('');
  return '<ul style="margin:0;padding:0 0 0 1.1rem;font-size:14px;color:' + STW_TEXT + ';line-height:1.55;">' + items + '</ul>';
}

// Render an array of strings as a simple bulleted list.
function emailSimpleBullets(items) {
  if (!items || !items.length) return '';
  return '<ul style="margin:0;padding:0 0 0 1.1rem;font-size:14px;color:' + STW_TEXT + ';line-height:1.6;">' +
    items.map(function (i) { return '<li style="margin:0 0 5px;">' + escapeHtml(i) + '</li>'; }).join('') +
    '</ul>';
}

function buildGifterEmail(p, orderId) {
  const isMinistry = p.bundle === 'ministry';
  const isSpecial = p.isSpecialOrder === true;
  const subject = isSpecial
    ? (isMinistry
        ? 'Special order received — Ministry Calling — ' + p.gifter.name
        : 'Special order received — ' + p.gifter.name)
    : (isMinistry
        ? 'Your Ministry Calling story has been received — ' + p.gifter.name
        : 'Your order has been received — ' + p.gifter.name);

  // ── Plain-text body (fallback for clients that don't render HTML) ──
  const lines = [];
  lines.push('Dear ' + p.gifter.name + ',');
  lines.push('');
  if (isSpecial) {
    lines.push('Thank you for your special-order request. A member of our team will');
    lines.push('reach out within 2-3 business days to confirm details before any work');
    lines.push('begins. No commitment is required at this stage.');
    lines.push('');
    lines.push('SPECIAL-ORDER ITEMS');
    (p.specialOrderItems || []).forEach(function (l) { lines.push('  - ' + l); });
    lines.push('');
    lines.push(isMinistry ? 'YOUR STORY' : 'YOUR ORDER');
  } else if (isMinistry) {
    lines.push('Thank you for sharing your story with our ministry. A member of our');
    lines.push('team will read your submission personally and reach out within 2-3');
    lines.push('business days to walk through next steps.');
    lines.push('');
    lines.push('YOUR STORY');
  } else {
    lines.push('Your order has been received. A summary appears below. We confirm');
    lines.push('every order personally and will follow up within 2-3 business days');
    lines.push('to verify details before any charge.');
    lines.push('');
    lines.push('YOUR ORDER');
  }
  lines.push((p.configText || '').split('\n').map(function (l) { return '  ' + l; }).join('\n'));
  lines.push('');
  if (!isMinistry && p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    lines.push('DELIVERY ADDRESS');
    lines.push('  ' + p.gifter.deliveryDetails);
    lines.push('');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push(isMinistry ? 'NOTES TO OUR TEAM' : 'DEDICATION MESSAGE');
    lines.push('  ' + p.gifter.dedication.trim());
    lines.push('');
  }
  if (p.signOptOut === true) {
    lines.push('Per your request, we will not sign the back cover of the Bible.');
    lines.push('');
  }
  if (!isMinistry && p.giftee && p.giftee.optIn === true) {
    lines.push('A heads-up message has been sent to ' + (p.giftee.name || 'the recipient') +
               ' at ' + (p.giftee.email || 'their address') + '.');
    lines.push('');
  }
  lines.push('Reference: ' + orderId);
  lines.push('');
  lines.push('Thank you for partnering with Seed the Word Ministry.');
  lines.push('');
  lines.push('Sincerely,');
  lines.push('The Seed the Word team');
  lines.push(TEAM_INBOX);

  // ── HTML body ────────────────────────────────────────────────
  let body = '';
  body += '<p style="margin:0 0 18px;font-size:15px;">Dear <strong>' + escapeHtml(p.gifter.name) + '</strong>,</p>';

  if (isSpecial) {
    body += '<p style="margin:0 0 22px;">Thank you for your special-order request. A member of our team will reach out within 2-3 business days to confirm details before any work begins. No commitment is required at this stage.</p>';
    body += emailSection('Special-order items', emailSimpleBullets(p.specialOrderItems || []), { accent: STW_GOLD });
  } else if (isMinistry) {
    body += '<p style="margin:0 0 22px;">Thank you for sharing your story with our ministry. A member of our team will read your submission personally and reach out within 2-3 business days to walk through next steps.</p>';
  } else {
    body += '<p style="margin:0 0 22px;">Your order has been received. A summary appears below. We confirm every order personally and will follow up within 2-3 business days to verify details before any charge.</p>';
  }

  body += emailSection(isMinistry ? 'Your story' : 'Your order',
    emailBulletList(p.configText || ''), { accent: STW_GREEN });

  if (!isMinistry && p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    body += emailSection('Delivery address',
      '<div style="white-space:pre-wrap;">' + escapeHtml(p.gifter.deliveryDetails) + '</div>',
      { accent: STW_GREEN });
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    body += emailSection(isMinistry ? 'Notes to our team' : 'Dedication message',
      '<em style="color:' + STW_TEXT + ';">' + nl2br(p.gifter.dedication.trim()) + '</em>',
      { accent: STW_GOLD });
  }
  if (p.signOptOut === true) {
    body += emailSection('Back-cover signing',
      'Per your request, we will not sign the back cover of the Bible.',
      { accent: STW_MUTED, dense: true });
  }
  if (!isMinistry && p.giftee && p.giftee.optIn === true) {
    body += emailSection('Recipient notification',
      'A heads-up message has been sent to <strong>' + escapeHtml(p.giftee.name || 'the recipient') + '</strong> at <a href="mailto:' + escapeHtml(p.giftee.email || '') + '" style="color:' + STW_GREEN + ';">' + escapeHtml(p.giftee.email || '') + '</a>.',
      { accent: STW_GREEN, dense: true });
  }

  body += '<div style="margin:24px 0 0;padding:14px 0 0;border-top:1px solid ' + STW_BORDER + ';font-size:13px;color:' + STW_MUTED + ';">' +
    'Reference: <code style="background:#f4ece0;padding:2px 6px;border-radius:4px;color:' + STW_TEXT + ';font-size:12.5px;">' + escapeHtml(orderId) + '</code>' +
  '</div>';
  body += '<p style="margin:18px 0 4px;font-size:14.5px;">Thank you for partnering with Seed the Word Ministry.</p>';
  body += '<p style="margin:0 0 4px;font-size:14.5px;">Sincerely,</p>';
  body += '<p style="margin:0;font-size:14.5px;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

  const accent = isSpecial ? STW_GOLD : STW_GREEN;
  const headerTitle = isSpecial
    ? 'Special-order request received'
    : (isMinistry ? 'Story received' : 'Order received');
  const headerSub = isSpecial
    ? 'We will reach out within 2-3 business days'
    : (isMinistry ? 'Ministry Calling — invitation received' : BUNDLE_DISPLAY[p.bundle]);

  const html = emailShell({
    headerTitle: headerTitle,
    headerSubtitle: headerSub,
    bodyHtml: body,
    footerHtml: 'Seed the Word Ministry &nbsp;·&nbsp; <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: accent,
    includeMinistryFooter: true,
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
  lines.push(isSpecial ? 'New special-order request received.' : 'New order received.');
  lines.push('');
  lines.push('Order ID:   ' + orderId);
  lines.push('Bundle:     ' + display);
  lines.push('Received:   ' + new Date().toISOString());
  if (isSpecial) {
    lines.push('');
    lines.push('SPECIAL-ORDER ITEMS — confirm before fulfilling:');
    (p.specialOrderItems || []).forEach(function (l) { lines.push('  - ' + l); });
  }
  lines.push('');
  lines.push('GIFTER');
  lines.push('  Name:  ' + p.gifter.name);
  lines.push('  Email: ' + p.gifter.email);
  lines.push('  Phone: ' + (p.gifter.phone || '(none)'));
  lines.push('');
  if (p.gifter.deliveryDetails && p.gifter.deliveryDetails.trim()) {
    lines.push('DELIVERY');
    lines.push('  ' + p.gifter.deliveryDetails); lines.push('');
  }
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    lines.push('DEDICATION / NOTE TO TEAM');
    lines.push('  ' + p.gifter.dedication.trim()); lines.push('');
  }
  if (p.signOptOut === true) {
    lines.push('Back-cover signing: SKIPPED per gifter request — do not sign.');
    lines.push('');
  }
  if (p.giftee && p.giftee.optIn === true) {
    lines.push('GIFTEE (heads-up sent)');
    lines.push('  Name:  ' + (p.giftee.name || ''));
    lines.push('  Email: ' + (p.giftee.email || '')); lines.push('');
  }
  lines.push('CONFIGURATION');
  (p.configText || '').split('\n').forEach(function (l) { lines.push('  ' + l); });
  lines.push('');
  lines.push('Logged to the Order Ledger sheet, row appended.');

  // ── HTML body ────────────────────────────────────────────────
  let body = '';
  // At-a-glance summary tags (inline-block — Gmail-safe, no flex)
  body += '<div style="margin:0 0 22px;line-height:2.2;">' +
    (isSpecial
      ? '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;margin-right:6px;">Special order</span>'
      : '') +
    '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:0.04em;margin-right:6px;">' + escapeHtml(display) + '</span>' +
    '<span style="display:inline-block;background:#f4ece0;color:' + STW_TEXT + ';padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:600;font-family:Consolas,Menlo,Monaco,Courier New,monospace;margin-right:6px;">' + escapeHtml(orderId) + '</span>' +
    '<span style="display:inline-block;color:' + STW_MUTED + ';font-size:12px;">Received ' + escapeHtml(new Date().toISOString()) + '</span>' +
  '</div>';

  // Special-order callout — appears ABOVE the gifter card
  if (isSpecial) {
    body += emailSection('Special-order items — confirm before fulfilling',
      emailSimpleBullets(p.specialOrderItems || []),
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
    body += emailSection('Delivery',
      '<div style="white-space:pre-wrap;">' + escapeHtml(p.gifter.deliveryDetails) + '</div>',
      { accent: STW_GREEN });
  }

  // Dedication card
  if (p.gifter.dedication && p.gifter.dedication.trim()) {
    body += emailSection('Dedication / note to team',
      '<em>' + nl2br(p.gifter.dedication.trim()) + '</em>',
      { accent: STW_GOLD });
  }

  // Sign-opt-out card
  if (p.signOptOut === true) {
    body += emailSection('Back-cover signing',
      '<strong style="color:#7a5a2a;">Skipped per gifter request — do not sign.</strong>',
      { accent: STW_GOLD, dense: true });
  }

  // Giftee card
  if (p.giftee && p.giftee.optIn === true) {
    body += emailSection('Giftee — heads-up sent',
      emailKeyValueRow([
        { label: 'Name',  value: escapeHtml(p.giftee.name || '') },
        { label: 'Email', value: '<a href="mailto:' + escapeHtml(p.giftee.email || '') + '" style="color:' + STW_GREEN + ';">' + escapeHtml(p.giftee.email || '') + '</a>' },
      ]),
      { accent: STW_GOLD });
  }

  // Configuration — bulleted list (no monospace block)
  body += emailSection('Configuration',
    emailBulletList(p.configText || ''),
    { accent: STW_GREEN });

  body += '<p style="margin:18px 0 0;font-size:12.5px;color:' + STW_MUTED + ';font-style:italic;">' +
    'Logged to the Order Ledger sheet · row appended.' +
  '</p>';

  const html = emailShell({
    headerTitle: isSpecial ? 'New special-order request' : 'New order received',
    headerSubtitle: display + ' · ' + p.gifter.name,
    bodyHtml: body,
    footerHtml: 'Reply directly — this email\'s Reply-To is the gifter.',
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
  const gifteeName = p.giftee.name || 'friend';
  const gifterName = p.gifter.name || 'A friend';
  lines.push('Dear ' + gifteeName + ',');
  lines.push('');
  lines.push(gifterName + ' has arranged for a Bible bundle from Seed the Word');
  lines.push('Ministry to be sent to you. We will be in touch shortly to coordinate');
  lines.push('delivery.');
  lines.push('');
  lines.push('If anything is unclear, please reply to this email and a member of');
  lines.push('our team will respond personally.');
  lines.push('');
  lines.push('Sincerely,');
  lines.push('The Seed the Word team');
  lines.push(TEAM_INBOX);

  let body = '';
  body += '<p style="margin:0 0 18px;font-size:15px;">Dear <strong>' + escapeHtml(gifteeName) + '</strong>,</p>';
  body += '<p style="margin:0 0 18px;font-size:15px;line-height:1.65;">' +
    '<strong>' + escapeHtml(gifterName) + '</strong> has arranged for a Bible bundle from Seed the Word Ministry to be sent to you. We will be in touch shortly to coordinate delivery.</p>';
  body += '<p style="margin:0 0 22px;font-size:14.5px;line-height:1.65;color:' + STW_TEXT + ';">' +
    'If anything is unclear, please reply to this email and a member of our team will respond personally.</p>';
  body += '<p style="margin:18px 0 4px;font-size:14.5px;">Sincerely,</p>';
  body += '<p style="margin:0;font-size:14.5px;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

  const html = emailShell({
    headerTitle: 'A gift is on its way to you',
    headerSubtitle: 'From ' + gifterName + ' · via Seed the Word Ministry',
    bodyHtml: body,
    footerHtml: 'Seed the Word Ministry &nbsp;·&nbsp; <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: STW_GOLD,
    includeMinistryFooter: true,
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

  // Send team notification first — if it fails we still want the
  // sender confirmation to go out (and vice versa).
  let teamSent = false;
  let senderSent = false;
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
    teamSent = true;
  } catch (err) {
    console.log('Contact team mail failed:', err);
  }

  try {
    const senderMail = buildContactSenderEmail({ name, email, subject, message });
    MailApp.sendEmail({
      to: senderMail.to,
      subject: senderMail.subject,
      body: senderMail.body,
      htmlBody: senderMail.html,
      replyTo: senderMail.replyTo,
      name: 'Seed the Word Ministry',
    });
    senderSent = true;
  } catch (err) {
    console.log('Contact sender mail failed:', err);
  }

  // Surface a partial-failure if exactly one of the two pipes broke
  // — at least one always logs to the sheet, so the team can recover.
  if (!teamSent && !senderSent) {
    return jsonResponse({ ok: false, error: 'mail-send-failed' });
  }
  return jsonResponse({
    ok: true,
    emailsSent: (teamSent ? 1 : 0) + (senderSent ? 1 : 0),
    route: 'apps-script',
  });
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
  const receivedAt = formatHumanTimestamp(new Date());

  let body = '';
  // Pill row — table-cell layout so Gmail doesn't collapse the gaps.
  body += '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 22px;">' +
    '<tr>' +
      '<td style="padding-right:6px;">' +
        '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:0.04em;">Contact</span>' +
      '</td>' +
      '<td style="padding-right:10px;">' +
        '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(subjectLabel) + '</span>' +
      '</td>' +
      '<td style="color:' + STW_MUTED + ';font-size:12px;">' + escapeHtml(receivedAt) + '</td>' +
    '</tr>' +
  '</table>';

  body += emailSection('From',
    emailKeyValueRow([
      { label: 'Name',    value: '<strong>' + escapeHtml(c.name) + '</strong>' },
      { label: 'Email',   value: '<a href="mailto:' + escapeHtml(c.email) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(c.email) + '</a>' },
      { label: 'Subject', value: c.subject ? escapeHtml(c.subject) : '<span style="color:' + STW_MUTED + ';">(none)</span>' },
    ]),
    { accent: STW_GREEN });

  body += emailSection('Message',
    '<div style="white-space:pre-wrap;font-size:14.5px;line-height:1.65;">' + escapeHtml(c.message) + '</div>',
    { accent: STW_GOLD });

  body += '<p style="margin:18px 0 0;font-size:12.5px;color:' + STW_MUTED + ';font-style:italic;">' +
    'Reply directly &mdash; this email\'s Reply-To is the sender. A confirmation has also been sent to them.' +
  '</p>';

  // Plain-text body
  const plainLines = [
    'New contact form message.',
    '',
    'From:    ' + c.name + ' <' + c.email + '>',
    'Subject: ' + (c.subject || '(none)'),
    'Sent:    ' + receivedAt,
    '',
    'MESSAGE',
    c.message.split('\n').map(function (l) { return '  ' + l; }).join('\n'),
    '',
    'A confirmation has also been sent to the sender.',
    'Logged to the Contact tab.',
  ];

  const html = emailShell({
    headerTitle: 'New contact form message',
    headerSubtitle: c.name + (c.subject ? ' \u00b7 ' + c.subject : ''),
    bodyHtml: body,
    footerHtml: 'Reply directly to respond &mdash; or use the Contact tab in the spreadsheet.',
    accentColor: STW_GREEN,
    includeMinistryFooter: false,
  });

  return {
    to: TEAM_INBOX,
    subject: '[STW Contact] ' + subjectLabel + ' \u2014 ' + c.name,
    body: plainLines.join('\n'),
    html: html,
    replyTo: c.email,
  };
}

// Sender confirmation — warm, brief, anchor verse, message echo so
// they have a record of what they sent. Includes the ministry
// footer so we double the email as a soft invite back to the site.
function buildContactSenderEmail(c) {
  const subject = c.subject
    ? 'We received your message \u2014 ' + c.subject
    : 'We received your message';

  // Plain-text fallback
  const plainLines = [
    'Dear ' + c.name + ',',
    '',
    'Thank you for reaching out to Seed the Word Ministry. Your message',
    'has been received and a member of our team will read it personally.',
    'You can expect a reply within 2-3 business days.',
    '',
    'For your records, here is what you sent:',
    '',
  ];
  if (c.subject) plainLines.push('Subject: ' + c.subject);
  plainLines.push('');
  plainLines.push('YOUR MESSAGE');
  plainLines.push(c.message.split('\n').map(function (l) { return '  ' + l; }).join('\n'));
  plainLines.push('');
  plainLines.push('In the meantime, you are warmly invited to walk with us:');
  plainLines.push('  Daily Bible reading: ' + SITE_URL + 'community.html');
  plainLines.push("  This week's events: " + SITE_URL + 'news.html');
  plainLines.push('  Bible gift bundles: ' + SITE_URL + 'store.html');
  plainLines.push('  Instagram: https://www.instagram.com/seedtheword/');
  plainLines.push('');
  plainLines.push('"Your word is a lamp for my feet, a light on my path." — Psalm 119:105');
  plainLines.push('');
  plainLines.push('Sincerely,');
  plainLines.push('The Seed the Word team');
  plainLines.push(TEAM_INBOX);

  // HTML body
  let body = '';
  body += '<p style="margin:0 0 18px;font-family:Georgia,\'Times New Roman\',serif;font-size:17px;color:' + STW_TEXT + ';">Dear <strong>' + escapeHtml(c.name) + '</strong>,</p>';
  body += '<p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Thank you for reaching out to <strong>Seed the Word Ministry</strong>. Your message has been received and a member of our team will read it personally. You can expect a reply within 2&ndash;3 business days.</p>';
  body += '<p style="margin:0 0 22px;font-size:13.5px;color:' + STW_MUTED + ';line-height:1.55;font-style:italic;">For your records, we&rsquo;ve included a copy of your message below.</p>';

  if (c.subject) {
    body += emailSection('Subject',
      '<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:16px;color:' + STW_TEXT + ';">' + escapeHtml(c.subject) + '</span>',
      { accent: STW_GREEN, dense: true });
  }

  // Pull-quote feel for the message echo — serif italic, with a
  // decorative gold opening mark on the left.
  body += emailSection('Your message',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
      '<tr>' +
        '<td bgcolor="' + STW_CREAM + '" style="background-color:' + STW_CREAM + ';padding:18px 22px;border-radius:8px;">' +
          '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:15.5px;color:' + STW_TEXT + ';line-height:1.7;white-space:pre-wrap;">' + escapeHtml(c.message) + '</div>' +
        '</td>' +
      '</tr>' +
    '</table>',
    { accent: STW_GOLD });

  body += '<p style="margin:26px 0 4px;font-size:14.5px;">With grace and gratitude,</p>';
  body += '<p style="margin:0 0 4px;font-family:Georgia,\'Times New Roman\',serif;font-size:18px;font-style:italic;color:' + STW_GREEN + ';">The Seed the Word team</p>';

  const html = emailShell({
    headerTitle: 'We received your message',
    headerSubtitle: 'A reply will arrive within 2-3 business days',
    bodyHtml: body,
    footerHtml: 'Seed the Word Ministry &nbsp;\u00b7&nbsp; <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: STW_GREEN,
    includeMinistryFooter: true,
  });

  return {
    to: c.email,
    subject: subject,
    body: plainLines.join('\n'),
    html: html,
    replyTo: TEAM_INBOX,
  };
}

// Format a Date in the script's timezone in human-friendly form, e.g.
// "May 16, 2026 at 7:25 AM PDT". Falls back to ISO if the format
// helper is unavailable for any reason.
function formatHumanTimestamp(d) {
  try {
    const tz = Session.getScriptTimeZone() || 'America/Los_Angeles';
    return Utilities.formatDate(d, tz, "MMM d, yyyy 'at' h:mm a z");
  } catch (_) {
    return d.toISOString();
  }
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
  const location  = String(payload.location || '').trim();
  const mediaUrl  = String(payload.mediaUrl || '').trim();

  try {
    const sheet = openTab(STORIES_TAB, STORIES_HEADERS);
    sheet.appendRow([
      new Date(), name, email, consent ? 'yes' : 'no', location, story, mediaUrl, 'apps-script',
    ]);
  } catch (err) {
    console.log('Story sheet append failed:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  try {
    const teamMail = buildStoryTeamEmail({ name, email, story, consent, location, mediaUrl });
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
  body += '<div style="margin:0 0 22px;line-height:2.2;">' +
    '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:0.04em;margin-right:6px;">Story submission</span>' +
    '<span style="display:inline-block;background:' + (s.consent ? STW_GOLD : '#999') + ';color:#fff;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:0.04em;margin-right:6px;">' + (s.consent ? 'Consent to publish' : 'Private — do not publish') + '</span>' +
    '<span style="display:inline-block;color:' + STW_MUTED + ';font-size:12px;">' + escapeHtml(new Date().toISOString()) + '</span>' +
  '</div>';

  body += emailSection('From',
    emailKeyValueRow([
      { label: 'Name',  value: '<strong>' + escapeHtml(s.name) + '</strong>' },
      { label: 'Email', value: '<a href="mailto:' + escapeHtml(s.email) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(s.email) + '</a>' },
    ]),
    { accent: STW_GREEN });

  if (s.location) {
    body += emailSection('Where it happened',
      escapeHtml(s.location),
      { accent: STW_GREEN, dense: true });
  }

  body += emailSection('Their story',
    '<div style="white-space:pre-wrap;font-size:14.5px;line-height:1.65;">' + escapeHtml(s.story) + '</div>',
    { accent: STW_GOLD });

  if (s.mediaUrl) {
    body += emailSection('Media',
      '<a href="' + escapeHtml(s.mediaUrl) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(s.mediaUrl) + '</a>',
      { accent: STW_GOLD, dense: true });
  }

  body += '<p style="margin:18px 0 0;font-size:12.5px;color:' + STW_MUTED + ';font-style:italic;">' +
    'Logged to the Stories tab.' +
  '</p>';

  const plainLines = [
    'New story submission.',
    '',
    'From:    ' + s.name + ' <' + s.email + '>',
    'Consent: ' + (s.consent ? 'yes — OK to publish' : 'no — keep private'),
    'Sent:    ' + new Date().toISOString(),
    '',
  ];
  if (s.location) {
    plainLines.push('LOCATION');
    plainLines.push('  ' + s.location);
    plainLines.push('');
  }
  plainLines.push('STORY');
  plainLines.push(s.story.split('\n').map(function (l) { return '  ' + l; }).join('\n'));
  plainLines.push('');
  if (s.mediaUrl) {
    plainLines.push('Media: ' + s.mediaUrl);
    plainLines.push('');
  }
  plainLines.push('Logged to the Stories tab.');

  const html = emailShell({
    headerTitle: 'New story shared with the ministry',
    headerSubtitle: s.name + (s.consent ? ' · OK to publish' : ' · private'),
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
// IMPORTANT: this script is a STANDALONE project (created at
// script.google.com directly), so the trigger UI's "Event source"
// dropdown does NOT show "From spreadsheet" — only "Time-driven" and
// "From calendar". To install the spreadsheet-bound on-form-submit
// trigger we need, run installStoryTrigger() ONCE from the editor:
//
//   1. Open the Apps Script editor for STW Order Handler.
//   2. In the function dropdown (top toolbar), pick installStoryTrigger.
//   3. Click ▶ Run. Authorize the Forms + Sheets scopes when prompted.
//   4. Confirm in the Triggers tab (clock icon, left rail) that a
//      trigger now exists for onStoryFormSubmit, source "Spreadsheet".
//
// To remove later: run removeStoryTriggers() the same way.
//
// Once installed, the trigger fires whenever ANY Google Form linked
// to LEDGER_SHEET_ID receives a submission. If you have multiple
// forms feeding the same spreadsheet, onStoryFormSubmit's label
// matchers (below) decide whether the row looks like a story; rows
// that lack name/email are logged + skipped.
function installStoryTrigger() {
  // Idempotent — remove any previous story triggers first so we
  // don't end up with duplicates that double-email the team.
  removeStoryTriggers();
  ScriptApp.newTrigger('onStoryFormSubmit')
    .forSpreadsheet(SpreadsheetApp.openById(LEDGER_SHEET_ID))
    .onFormSubmit()
    .create();
  console.log('Installed onStoryFormSubmit trigger for sheet ' + LEDGER_SHEET_ID);
}

function removeStoryTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onStoryFormSubmit') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  console.log('Removed ' + removed + ' onStoryFormSubmit trigger(s).');
}

// The trigger event passes `e.namedValues` keyed by question text.
// Question labels are configurable in the Form, so we look up fields
// by best-effort case-insensitive substring matching.
function onStoryFormSubmit(e) {
  if (!e || !e.namedValues) {
    console.log('Form trigger fired without namedValues — is the trigger bound to the spreadsheet?');
    return;
  }

  // Pick the first namedValues key whose name contains ANY of the
  // candidate substrings (case-insensitive). Returns the joined string
  // value (multi-select fields come through as arrays).
  const get = function (candidates) {
    const wantList = candidates.map(function (s) { return s.toLowerCase(); });
    const keys = Object.keys(e.namedValues);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i].toLowerCase();
      for (let j = 0; j < wantList.length; j++) {
        if (k.indexOf(wantList[j]) !== -1) {
          const v = e.namedValues[keys[i]];
          return Array.isArray(v) ? v.join(', ').trim() : String(v || '').trim();
        }
      }
    }
    return '';
  };

  const name     = get(['name']);
  const email    = get(['email']);
  // The current form (Share Photos & Videos) uses "Tell us about it"
  // as the freeform question; legacy / future forms might call it
  // "Your story" or "Share your testimony" — match all of them.
  const story    = get(['tell us about', 'your story', 'story', 'testimony', 'share', 'message']);
  const location = get(['where was this', 'where', 'location']);
  // File-upload questions surface as a comma-separated list of Drive
  // URLs in namedValues. Some forms use "Upload" or "Photos & videos"
  // as the question text — match generously.
  const mediaUrl = get(['upload', 'photos', 'video', 'media', 'file']);
  // Optional consent question. If the form doesn't include one we
  // default to false (i.e. private — admins manually flip it to "yes"
  // in the sheet if the submitter okays publication later).
  const consentRaw = get(['consent', 'publish', 'ok to share', 'permission']);
  const consent = consentRaw.toLowerCase().indexOf('yes') !== -1 ||
                  consentRaw.toLowerCase().indexOf('agree') !== -1;

  // Story is the only truly required signal. If it's missing, fall
  // back to whatever freeform field we got (location / mediaUrl will
  // at least give the team something to look at). If even name/email
  // are missing, log the raw payload and bail — likely a form-spam
  // submission or a misconfigured trigger.
  if (!name || !email) {
    console.log('Form trigger missing name/email; namedValues:', JSON.stringify(e.namedValues));
    return;
  }
  const effectiveStory = story || ('(no story text provided' +
    (location ? '; location: ' + location : '') +
    (mediaUrl ? '; media uploaded' : '') + ')');

  // Append to our Stories tab so admins have a unified view.
  try {
    const sheet = openTab(STORIES_TAB, STORIES_HEADERS);
    sheet.appendRow([
      new Date(), name, email, consent ? 'yes' : 'no', location, effectiveStory, mediaUrl, 'google-form',
    ]);
  } catch (err) {
    console.log('Story trigger sheet append failed:', err);
  }

  // Send the team the styled HTML email.
  try {
    const teamMail = buildStoryTeamEmail({
      name: name,
      email: email,
      story: effectiveStory,
      consent: consent,
      location: location,
      mediaUrl: mediaUrl,
    });
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


// ── Order status workflow ────────────────────────────────────────
//
// When an admin edits the `status` cell of an order row in the Sheet UI,
// the simple onEdit trigger below catches the edit and sends the gifter
// a status-specific letter. Each status in STATUS_CHOICES (above, except
// 'new') has a builder in STATUS_COPY that returns the per-letter copy.
// The shared shell (emailShell + emailMinistryFooter) wraps every letter
// so the warm cream/green/gold branding is consistent.
//
// Spec: .kiro/specs/ministry-ops-and-testimonies/

const STATUS_COPY = {
  // ── confirming ────────────────────────────────────────────────
  confirming: function (o, name, orderId, bundle, isMinistry) {
    const subject = 'We\'re confirming your ' + (isMinistry ? 'Ministry Calling story' : 'order') + ' — ' + name;
    const headerTitle = 'A team member is reaching out';
    const headerSub = isMinistry ? 'Ministry Calling · ' + name : bundle + ' · ' + name;

    let body = '';
    body += '<p style="margin:0 0 18px;">Dear <strong>' + escapeHtml(name) + '</strong>,</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">A member of our team is opening your ' +
      (isMinistry ? 'story' : 'order') +
      ' now and will reach out personally within the next day or two to confirm the details. We don\'t put anything in motion until you and one of us have actually talked it through &mdash; that way nothing gets shipped or charged on a misunderstanding.</p>';
    body += '<p style="margin:0 0 22px;line-height:1.7;">If anything has changed on your end since you sent this in, just reply to this email and we\'ll fold it into the conversation. There is no clock running.</p>';
    body += emailSection('Reference', '<code style="background:#f4ece0;padding:2px 6px;border-radius:4px;">' + escapeHtml(orderId) + '</code>', { accent: STW_MUTED, dense: true });
    body += '<p style="margin:18px 0 4px;">Sincerely,</p>';
    body += '<p style="margin:0;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

    const plain = [
      'Dear ' + name + ',',
      '',
      'A member of our team is opening your ' + (isMinistry ? 'story' : 'order') +
      ' now and will reach out personally within the next day or two to confirm the details.',
      'We don\'t put anything in motion until you and one of us have actually talked it through.',
      '',
      'If anything has changed on your end, just reply to this email.',
      '',
      'Reference: ' + orderId,
      '',
      'Sincerely,',
      'The Seed the Word team',
      TEAM_INBOX,
    ].join('\n');

    return { subject: subject, headerTitle: headerTitle, headerSubtitle: headerSub, bodyHtml: body, plain: plain };
  },

  // ── packing ────────────────────────────────────────────────────
  packing: function (o, name, orderId, bundle, isMinistry) {
    const subject = 'Your bundle is being packed — ' + name;
    const headerTitle = 'Your bundle is being packed';
    const headerSub = bundle + ' · ' + name;

    let body = '';
    body += '<p style="margin:0 0 18px;">Dear <strong>' + escapeHtml(name) + '</strong>,</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">Your bundle is on the packing table. We pray over each Bible by name before it goes in the box, and we sign the back cover by hand unless you asked us not to. The handwritten note, the highlighted verses, and any dedication you sent us all get folded in here.</p>';
    body += '<p style="margin:0 0 22px;line-height:1.7;">As soon as the box leaves our hands, we\'ll send a separate note letting you know it has shipped, with delivery details where we have them.</p>';
    body += emailSection('Reference', '<code style="background:#f4ece0;padding:2px 6px;border-radius:4px;">' + escapeHtml(orderId) + '</code>', { accent: STW_MUTED, dense: true });
    body += '<p style="margin:18px 0 4px;">With gratitude,</p>';
    body += '<p style="margin:0;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

    const plain = [
      'Dear ' + name + ',',
      '',
      'Your bundle is on the packing table. We pray over each Bible before',
      'it goes in the box, and we sign the back cover by hand unless you',
      'asked us not to. As soon as the box leaves our hands, we\'ll send a',
      'separate note letting you know it has shipped.',
      '',
      'Reference: ' + orderId,
      '',
      'With gratitude,',
      'The Seed the Word team',
      TEAM_INBOX,
    ].join('\n');

    return { subject: subject, headerTitle: headerTitle, headerSubtitle: headerSub, bodyHtml: body, plain: plain };
  },

  // ── shipped ────────────────────────────────────────────────────
  shipped: function (o, name, orderId, bundle, isMinistry) {
    const subject = 'Your bundle is on the way — ' + name;
    const headerTitle = 'Your bundle is on the way';
    const headerSub = bundle + ' · ' + name;
    const delivery  = String(o.delivery_details || '').trim();

    let body = '';
    body += '<p style="margin:0 0 18px;">Dear <strong>' + escapeHtml(name) + '</strong>,</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">Your bundle is on its way. It left our hands today carrying a small piece of our prayer with it &mdash; the Word in someone\'s hands is a quiet, slow seed, and we\'re glad you\'re part of planting it.</p>';
    if (delivery) {
      body += emailSection('Sent to', '<div style="white-space:pre-wrap;">' + escapeHtml(delivery) + '</div>', { accent: STW_GREEN });
    }
    body += '<p style="margin:0 0 22px;line-height:1.7;">If anything looks off when it arrives, please reply to this email and we will make it right. Once you confirm safe arrival, we will close the loop on our side too.</p>';
    body += emailSection('Reference', '<code style="background:#f4ece0;padding:2px 6px;border-radius:4px;">' + escapeHtml(orderId) + '</code>', { accent: STW_MUTED, dense: true });
    body += '<p style="margin:18px 0 4px;">Sincerely,</p>';
    body += '<p style="margin:0;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

    const plainParts = [
      'Dear ' + name + ',',
      '',
      'Your bundle is on its way. It left our hands today carrying a small',
      'piece of our prayer with it.',
      '',
    ];
    if (delivery) {
      plainParts.push('SENT TO');
      plainParts.push('  ' + delivery);
      plainParts.push('');
    }
    plainParts.push('If anything looks off when it arrives, please reply to this email and');
    plainParts.push('we will make it right.');
    plainParts.push('');
    plainParts.push('Reference: ' + orderId);
    plainParts.push('');
    plainParts.push('Sincerely,');
    plainParts.push('The Seed the Word team');
    plainParts.push(TEAM_INBOX);

    return { subject: subject, headerTitle: headerTitle, headerSubtitle: headerSub, bodyHtml: body, plain: plainParts.join('\n') };
  },

  // ── delivered ──────────────────────────────────────────────────
  delivered: function (o, name, orderId, bundle, isMinistry) {
    const subject = 'Your bundle has arrived — ' + name;
    const headerTitle = 'Your bundle has arrived';
    const headerSub = bundle + ' · ' + name;

    let body = '';
    body += '<p style="margin:0 0 18px;">Dear <strong>' + escapeHtml(name) + '</strong>,</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">Your bundle has arrived. Thank you for trusting us to carry the Word into someone\'s life through your gift &mdash; it\'s the part of our work that we never get tired of.</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">If a story comes out of this &mdash; a verse that landed, a conversation that opened, a moment you didn\'t expect &mdash; we\'d love to hear it. Many of the testimonies we share started with someone replying to a note like this one.</p>';
    body += '<p style="margin:0 0 22px;line-height:1.7;"><a href="' + SITE_URL + 'news.html#share-your-story" style="color:' + STW_GREEN + ';font-weight:600;">Share your story &rarr;</a> when you\'re ready. No rush, no pressure.</p>';
    body += emailSection('Reference', '<code style="background:#f4ece0;padding:2px 6px;border-radius:4px;">' + escapeHtml(orderId) + '</code>', { accent: STW_MUTED, dense: true });
    body += '<p style="margin:18px 0 4px;">With joy,</p>';
    body += '<p style="margin:0;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

    const plain = [
      'Dear ' + name + ',',
      '',
      'Your bundle has arrived. Thank you for trusting us to carry the Word',
      'into someone\'s life through your gift.',
      '',
      'If a story comes out of this, we\'d love to hear it. Share your story',
      'when you\'re ready: ' + SITE_URL + 'news.html#share-your-story',
      '',
      'Reference: ' + orderId,
      '',
      'With joy,',
      'The Seed the Word team',
      TEAM_INBOX,
    ].join('\n');

    return { subject: subject, headerTitle: headerTitle, headerSubtitle: headerSub, bodyHtml: body, plain: plain };
  },

  // ── cancelled ──────────────────────────────────────────────────
  cancelled: function (o, name, orderId, bundle, isMinistry) {
    const subject = 'Your order has been cancelled — ' + name;
    const headerTitle = 'Your order has been cancelled';
    const headerSub = 'No charge has been made';

    let body = '';
    body += '<p style="margin:0 0 18px;">Dear <strong>' + escapeHtml(name) + '</strong>,</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">We\'ve cancelled this order on our side, and any pending charge has been released. You will not be billed for this submission.</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">If the cancellation came from a change of plans on your end, no further action is needed &mdash; we hope to see you again when the timing is right. If something on our end made this hard, please reply to this email and tell us. We read every reply, and we\'d rather hear it than not.</p>';
    body += '<p style="margin:0 0 22px;line-height:1.7;">Either way, you\'re welcome here. The door stays open.</p>';
    body += emailSection('Reference', '<code style="background:#f4ece0;padding:2px 6px;border-radius:4px;">' + escapeHtml(orderId) + '</code>', { accent: STW_MUTED, dense: true });
    body += '<p style="margin:18px 0 4px;">Sincerely,</p>';
    body += '<p style="margin:0;color:' + STW_GREEN + ';font-weight:600;">The Seed the Word team</p>';

    const plain = [
      'Dear ' + name + ',',
      '',
      'We\'ve cancelled this order on our side, and any pending charge has',
      'been released. You will not be billed for this submission.',
      '',
      'If something on our end made this hard, please reply to this email',
      'and tell us. Either way, you\'re welcome here. The door stays open.',
      '',
      'Reference: ' + orderId,
      '',
      'Sincerely,',
      'The Seed the Word team',
      TEAM_INBOX,
    ].join('\n');

    return { subject: subject, headerTitle: headerTitle, headerSubtitle: headerSub, bodyHtml: body, plain: plain };
  },

  // 'new' is the initial state set by appendLedgerRow. The trigger never
  // fires for transitions INTO 'new' in practice (programmatic writes
  // don't fire the simple onEdit trigger). If somehow it does, we send
  // no email — the order-confirmation receipt at submit time covered it.
  new: function () { return null; },
};

function buildStatusUpdateEmail(order, newStatus, oldStatus) {
  const builder = STATUS_COPY[newStatus];
  if (!builder) return null;

  const gifterName = String(order.gifter_name || 'friend').trim();
  const orderId    = String(order.order_id || '').trim();
  const bundle     = BUNDLE_DISPLAY[order.bundle] || order.bundle;
  const isMinistry = order.bundle === 'ministry';

  const copy = builder(order, gifterName, orderId, bundle, isMinistry);
  if (!copy) return null;  // 'new' returns null

  const html = emailShell({
    headerTitle: copy.headerTitle,
    headerSubtitle: copy.headerSubtitle,
    bodyHtml: copy.bodyHtml,
    footerHtml: 'Seed the Word Ministry &nbsp;·&nbsp; <a href="mailto:' + TEAM_INBOX + '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
    accentColor: newStatus === 'cancelled' ? STW_GOLD : STW_GREEN,
    includeMinistryFooter: true,
  });

  return {
    to: order.gifter_email,
    subject: copy.subject,
    body: copy.plain,
    html: html,
    replyTo: TEAM_INBOX,
  };
}

/**
 * Apps Script auto-binds onEdit to the simple trigger. We delegate to
 * the named handler so the bridge is obvious in source. If we later
 * need scopes the simple trigger doesn't grant (e.g. UrlFetch), we
 * convert to an installable trigger via an installStatusTrigger()
 * helper mirroring the existing installStoryTrigger() pattern.
 */
function onEdit(e) {
  onOrderStatusEdit(e);
}

/**
 * Simple-trigger handler. Fires on any cell edit in the spreadsheet.
 * We narrow to: Orders tab + status column + value in STATUS_CHOICES +
 * value actually changed. Anything else short-circuits.
 */
function onOrderStatusEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== LEDGER_TAB) return;                  // only Orders tab

  // Single-cell edits only — bulk paste / range edits skip the trigger
  // entirely. (Bulk edits in the Sheet UI are rare for status anyway.)
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const col = e.range.getColumn();
  if (col !== STATUS_INDEX) return;                            // only status column

  const row = e.range.getRow();
  if (row === 1) return;                                       // skip header

  const newStatus = String(e.value || '').trim().toLowerCase();
  const oldStatus = String(e.oldValue || '').trim().toLowerCase();

  // Idempotency: re-saving the same value is a no-op. Empty new value
  // (admin cleared the cell) is also a no-op.
  if (!newStatus) return;
  if (newStatus === oldStatus) return;

  // Reject typos / unknown values — log and skip rather than send a
  // letter for a status the gifter won't recognise.
  if (STATUS_CHOICES.indexOf(newStatus) === -1) {
    console.log('[onOrderStatusEdit] unknown status "' + newStatus + '" at row ' + row + ' — skipping.');
    return;
  }

  // Reconstruct the order's context from the row in two batched reads
  // (header row + this row) so trigger time stays fast.
  let order;
  try {
    const headers = sheet.getRange(1, 1, 1, LEDGER_HEADERS.length).getValues()[0];
    const values  = sheet.getRange(row, 1, 1, LEDGER_HEADERS.length).getValues()[0];
    order = {};
    for (let i = 0; i < headers.length; i++) {
      order[headers[i]] = values[i];
    }
  } catch (err) {
    console.log('[onOrderStatusEdit] failed to read row ' + row + ': ' + err);
    return;
  }

  // Defensive: if the row somehow doesn't have a gifter_email, log and
  // skip. Sheet rows pre-dating this migration may have a gap.
  if (!order.gifter_email || String(order.gifter_email).indexOf('@') === -1) {
    console.log('[onOrderStatusEdit] row ' + row + ' has no gifter_email — skipping email.');
    return;
  }

  try {
    const mail = buildStatusUpdateEmail(order, newStatus, oldStatus);
    if (!mail) {
      // Builder returned null (currently only the 'new' case).
      return;
    }
    MailApp.sendEmail({
      to: mail.to,
      subject: mail.subject,
      body: mail.body,
      htmlBody: mail.html,
      replyTo: mail.replyTo,
      name: 'Seed the Word Ministry',
    });
    console.log('[onOrderStatusEdit] sent ' + newStatus + ' email for ' + order.order_id + ' → ' + order.gifter_email);
  } catch (err) {
    // Never re-throw from a Sheet edit — admins shouldn't see an edit
    // "fail" because Gmail is throttled. Errors surface in the
    // Executions panel.
    console.log('[onOrderStatusEdit] mail send failed for row ' + row + ': ' + err);
  }
}
