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
const SUBSCRIBERS_TAB = 'Subscribers';
const ADMINS_TAB = 'Admins';

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
  'status',          // appended (Feature 1, ministry-ops-and-testimonies spec)
  'tracking_number', // appended; rendered in the 'shipped' email when set
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
  if (type === 'admin-sms-cc') return handleAdminSmsCc(payload);
  if (type === 'weekly-digest-email') return handleWeeklyDigestEmail(payload);
  return handleOrder(payload);
}

// ── Admin SMS-CC handler ─────────────────────────────────────────
//
// Called by .github/scripts/post_calendar_to_telegram.py after a
// successful Telegram announcement post. Forwards a short plain-text
// body to a carrier email-to-SMS gateway. Best-effort — we always
// return ok:true so the caller's pipeline never blocks on this.
//
// Payload shape:
//   { type: 'admin-sms-cc', to: '2537777383@vtext.com', body: '...' }
function handleAdminSmsCc(payload) {
  try {
    const to = String((payload && payload.to) || '').trim();
    const body = String((payload && payload.body) || '').trim();
    if (!to || !body) {
      return jsonResponse({ ok: true, route: 'admin-sms-cc-noop', reason: 'empty' });
    }
    // Defensive: the email-to-SMS gateway address should look like an
    // email. Anything else gets silently dropped; we don't want a
    // typo'd config exfiltrating data anywhere unexpected.
    if (to.indexOf('@') === -1) {
      console.log('admin-sms-cc: rejecting non-email recipient: ' + to);
      return jsonResponse({ ok: true, route: 'admin-sms-cc-noop', reason: 'bad-recipient' });
    }
    MailApp.sendEmail({
      to: to,
      subject: 'STW',                // Most gateways drop the subject
      body: body.slice(0, 140),      // Hard cap matches caller's cap
      noReply: true,
    });
    return jsonResponse({ ok: true, route: 'admin-sms-cc' });
  } catch (err) {
    console.log('admin-sms-cc failed (non-fatal):', err);
    return jsonResponse({ ok: true, route: 'admin-sms-cc-error', reason: String(err) });
  }
}

// ── Weekly digest email handler ──────────────────────────────────
//
// Called by .github/scripts/send_weekly_digest.py once per active
// subscriber on Saturday morning. The Python script builds the body;
// this handler just hands it off to MailApp using the script's Gmail
// session (which the runner can't use directly).
//
// Payload shape:
//   { type: 'weekly-digest-email', to, subject, html, text, name }
function handleWeeklyDigestEmail(payload) {
  const to = String((payload && payload.to) || '').trim();
  const subject = String((payload && payload.subject) || '').trim();
  const html = String((payload && payload.html) || '');
  const text = String((payload && payload.text) || '');
  if (!to || to.indexOf('@') === -1) {
    return jsonResponse({ ok: false, error: 'bad-recipient' });
  }
  if (!subject || (!html && !text)) {
    return jsonResponse({ ok: false, error: 'empty-body' });
  }
  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: html,
      body: text,           // fallback for clients that hide HTML
      noReply: true,
      name: 'Seed the Word Ministry',
    });
    return jsonResponse({ ok: true, route: 'weekly-digest-email' });
  } catch (err) {
    console.log('weekly-digest-email failed:', err);
    return jsonResponse({ ok: false, error: 'mail-send-failed', reason: String(err) });
  }
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
    '',     // initial tracking_number; admins fill this in before shipped
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
    const tracking  = String(o.tracking_number || '').trim();

    let body = '';
    body += '<p style="margin:0 0 18px;">Dear <strong>' + escapeHtml(name) + '</strong>,</p>';
    body += '<p style="margin:0 0 18px;line-height:1.7;">Your bundle is on its way. It left our hands today carrying a small piece of our prayer with it &mdash; the Word in someone\'s hands is a quiet, slow seed, and we\'re glad you\'re part of planting it.</p>';
    if (tracking) {
      body += emailSection('Tracking', '<code style="background:#f4ece0;padding:4px 10px;border-radius:4px;font-size:14px;color:' + STW_TEXT + ';">' + escapeHtml(tracking) + '</code>', { accent: STW_GREEN });
    }
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
    if (tracking) {
      plainParts.push('TRACKING');
      plainParts.push('  ' + tracking);
      plainParts.push('');
    }
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

  // Soft warning when flipping to 'shipped' without a tracking number.
  // We don't block the send — the letter is still useful even without
  // tracking (it tells the gifter the package is in transit) — but we
  // log a clear warning so the admin sees it in Executions if they
  // forgot. To get a tracking number into the letter, fill in the
  // tracking_number cell on the same row BEFORE flipping status to
  // shipped, or roll status back to packing, fill tracking, and
  // re-flip to shipped.
  if (newStatus === 'shipped' && !String(order.tracking_number || '').trim()) {
    console.log('[onOrderStatusEdit] WARNING: row ' + row + ' is being marked shipped without a tracking_number. Letter will be sent without a tracking section. Fill the tracking_number cell and re-flip status to include it.');
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

// ── One-time setup helpers (run from the Apps Script editor) ────
//
// Apply the data-validation dropdown to the entire status column of
// the Orders tab. This is what makes the cell a typed dropdown so
// admins can't typo a status that the trigger would reject.
//
// Usage:
//   1. Open the Apps Script editor for STW Order Handler.
//   2. In the function dropdown (top toolbar), pick installStatusDropdown.
//   3. Click ▶ Run. Authorize Sheets if prompted.
//   4. Open the Orders tab — the status column should now show a
//      dropdown arrow on every cell, with the six STATUS_CHOICES
//      values as options.
//
// Idempotent: re-running just rewrites the same validation rule.
// Applies the rule to rows 2..1000 by default; raise SETUP_MAX_ROWS
// below if you ever exceed that.
const SETUP_MAX_ROWS = 1000;

function installStatusDropdown() {
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  const sheet = ss.getSheetByName(LEDGER_TAB);
  if (!sheet) {
    throw new Error('Orders tab not found on sheet ' + LEDGER_SHEET_ID);
  }

  // Make sure the header row is current (writes 'status' into column N
  // if the script was redeployed but the sheet hasn't seen a new order
  // since the header was added).
  ensureHeadersFor(sheet, LEDGER_HEADERS);

  // Apply the dropdown to rows 2..SETUP_MAX_ROWS of the status column.
  // Pre-populating empty rows with a validation rule is fine — the
  // rule lights up the dropdown but does not write any value.
  const range = sheet.getRange(2, STATUS_INDEX, SETUP_MAX_ROWS - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_CHOICES, true)  // showDropdown: true
    .setAllowInvalid(false)                    // reject typos at the cell level
    .setHelpText('Valid statuses: ' + STATUS_CHOICES.join(', '))
    .build();
  range.setDataValidation(rule);

  // Backfill any existing rows whose status cell is empty so they
  // start at 'new' rather than blank. This catches orders that
  // pre-date the migration. Rows that already have a value are left
  // alone (admins may have set them by hand).
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const statusRange = sheet.getRange(2, STATUS_INDEX, lastRow - 1, 1);
    const values = statusRange.getValues();
    let backfilled = 0;
    for (let i = 0; i < values.length; i++) {
      if (!values[i][0] || String(values[i][0]).trim() === '') {
        values[i][0] = 'new';
        backfilled++;
      }
    }
    if (backfilled > 0) {
      statusRange.setValues(values);
      console.log('[installStatusDropdown] backfilled ' + backfilled + ' empty status cells with "new"');
    }
  }

  console.log('[installStatusDropdown] applied dropdown rule to rows 2..' +
    SETUP_MAX_ROWS + ' of column ' + STATUS_INDEX + ' on tab ' + LEDGER_TAB);
}

// Removes the validation rule from the status column. Inverse of
// installStatusDropdown. Useful if you ever want to wipe the rule
// before re-running.
function removeStatusDropdown() {
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  const sheet = ss.getSheetByName(LEDGER_TAB);
  if (!sheet) return;
  const range = sheet.getRange(2, STATUS_INDEX, SETUP_MAX_ROWS - 1, 1);
  range.clearDataValidations();
  console.log('[removeStatusDropdown] cleared validation on column ' + STATUS_INDEX);
}

// ── Status-column edit trigger installer ────────────────────────
//
// The STW Order Handler is a STANDALONE Apps Script project (created at
// script.google.com directly, not bound to a spreadsheet). Standalone
// scripts do NOT auto-fire the simple `onEdit(e)` handler — that only
// works for container-bound scripts. We have to register an
// installable on-edit trigger via ScriptApp.newTrigger(...) for
// onOrderStatusEdit to actually fire on Sheet edits.
//
// Same pattern as installStoryTrigger above.
//
// Usage:
//   1. Open the Apps Script editor for STW Order Handler.
//   2. In the function dropdown (top toolbar), pick installStatusEditTrigger.
//   3. Click ▶ Run. Authorize the Sheets scope when prompted.
//   4. Open the Triggers tab (clock icon, left rail) and confirm a row
//      now exists for `onOrderStatusEdit`, source "From spreadsheet",
//      event type "On edit".
//
// Idempotent: re-running first removes any existing onOrderStatusEdit
// triggers, then creates a fresh one.
function installStatusEditTrigger() {
  removeStatusEditTriggers();
  ScriptApp.newTrigger('onOrderStatusEdit')
    .forSpreadsheet(SpreadsheetApp.openById(LEDGER_SHEET_ID))
    .onEdit()
    .create();
  console.log('Installed onOrderStatusEdit trigger for sheet ' + LEDGER_SHEET_ID);
}

function removeStatusEditTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onOrderStatusEdit') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  console.log('Removed ' + removed + ' onOrderStatusEdit trigger(s).');
}

// ─────────────────────────────────────────────────────────────────────
// SMS gateway delivery test — DIAGNOSTIC ONLY
// ─────────────────────────────────────────────────────────────────────
//
// One-off test function used to determine whether the free email-to-SMS
// gateway path actually delivers to a specific carrier (Verizon /
// Visible MVNO) before we wire the digest pipeline to use it.
//
// Background:
//   Verizon shut down their free email-to-SMS gateway (@vtext.com) in
//   mid-2022. Visible runs on Verizon's network, so the gateway either
//   doesn't work at all or works inconsistently. We test by firing two
//   emails — one to the SMS gateway, one to the MMS gateway — and the
//   admin checks their phone for ~5 minutes.
//
// How to run:
//   1. Open the Apps Script editor (script.google.com).
//   2. Paste this entire file over Code.gs (standard procedure).
//   3. Save (Ctrl+S).
//   4. Pick `testSmsGatewayDelivery` from the function dropdown
//      (top toolbar, next to ▶ Run).
//   5. Click ▶ Run. Authorize Gmail send scope when prompted.
//   6. Wait up to 5 minutes and check the target phone.
//   7. Report back which (if any) message arrived.
//
// Expected outcomes:
//   - Both arrive: SMS gateway works for this carrier; pipeline can
//     use either domain. Prefer @vtext.com (smaller, faster).
//   - Only MMS (@vzwpix.com) arrives: use the MMS gateway. Slightly
//     bulkier delivery (treated as a picture message) but functional.
//   - Neither arrives: gateway path is dead for this carrier. Fall
//     back to email-only delivery (the digest still emails the admin's
//     normal email address; admin forwards manually if the offline
//     member needs SMS).
//
// Safe to leave in the file long-term — it only fires when manually
// invoked from the editor. Will be removed once we have a definitive
// answer.
function testSmsGatewayDelivery() {
  // Hardcoded for the one-off test. NOT used by any production path.
  const TARGET_NUMBER = '2537777383';

  // Test body kept under 140 chars so SMS gateways don't truncate.
  // The "STOP" hint is standard SMS-marketing convention; carriers
  // are less likely to filter messages that include opt-out language.
  const body = 'STW gateway test ' + new Date().toISOString().slice(11, 19)
    + ' UTC. Reply STOP to opt out.';

  const sends = [
    {
      label: 'Verizon SMS gateway (@vtext.com)',
      to: TARGET_NUMBER + '@vtext.com',
    },
    {
      label: 'Verizon MMS gateway (@vzwpix.com)',
      to: TARGET_NUMBER + '@vzwpix.com',
    },
  ];

  for (let i = 0; i < sends.length; i++) {
    const s = sends[i];
    try {
      MailApp.sendEmail({
        to: s.to,
        subject: 'STW',          // Most gateways drop the subject line
        body: body,              // Keep plain-text only; gateways strip HTML
        noReply: true,
      });
      console.log('Sent: ' + s.label + ' → ' + s.to);
    } catch (err) {
      console.log('FAILED: ' + s.label + ' → ' + s.to + ' | ' + err);
    }
  }

  console.log('Test fired. Check the target phone for the next ~5 minutes.');
}


// ─────────────────────────────────────────────────────────────────────
// Weekly digest subscribers — sheet-backed list + read-only web endpoint
// ─────────────────────────────────────────────────────────────────────
//
// The Saturday weekly-digest workflow needs a list of email addresses
// to send to. This list lives in the `Subscribers` tab on the same
// spreadsheet that holds Orders / Contact / Stories so admins can
// maintain it through the Sheet UI directly — no JSON editing.
//
// The GitHub Actions runner can't open Google Sheets without OAuth,
// so we expose a small read-only `doGet(?action=subscribers)` endpoint
// that returns the active subscriber list as JSON. The same web-app
// deployment that handles order POSTs handles this GET.
//
// Schema (Subscribers tab — must match SUBSCRIBERS_HEADERS exactly):
//   id          stable identifier ('stw-sub-001', 'stw-sub-002', ...)
//   name        display name for the digest greeting
//   email       required; missing rows are skipped
//   phoneNumber optional; reserved for future SMS use
//   carrier     optional; reserved for future SMS use
//   consentDate YYYY-MM-DD when they opted in (TCPA paper trail)
//   active      TRUE/FALSE; FALSE rows are silently skipped
//   addedBy     which admin added them
//   notes       freeform
//
// Set up: run `installSubscribersTab()` ONCE from the Apps Script
// editor's function dropdown to create the tab with the header row
// and a sample first entry. Idempotent — re-running won't duplicate.

const SUBSCRIBERS_HEADERS = [
  'id', 'name', 'email', 'phoneNumber', 'carrier',
  'consentDate', 'active', 'addedBy', 'notes',
];

function _openSubscribersSheet_() {
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  let sheet = ss.getSheetByName(SUBSCRIBERS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SUBSCRIBERS_TAB);
    sheet.appendRow(SUBSCRIBERS_HEADERS);
    sheet.getRange(1, 1, 1, SUBSCRIBERS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Return the active subscriber list as a flat array of objects.
 * Skips rows where `active` is anything other than truthy AND skips
 * rows missing an email (defensive against half-typed entries).
 */
function listActiveSubscribers() {
  const sheet = _openSubscribersSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const range = sheet.getRange(1, 1, lastRow, SUBSCRIBERS_HEADERS.length);
  const values = range.getValues();
  const headerRow = values[0];
  const idx = {};
  for (let i = 0; i < headerRow.length; i++) {
    idx[String(headerRow[i]).trim()] = i;
  }

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const email = String(row[idx.email] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;

    // `active` may come back as boolean true/false (from a checkbox),
    // the string 'TRUE'/'FALSE', or an empty cell. Normalize.
    const rawActive = row[idx.active];
    const isActive =
      rawActive === true ||
      rawActive === 1 ||
      String(rawActive || '').trim().toUpperCase() === 'TRUE';
    if (!isActive) continue;

    out.push({
      id: String(row[idx.id] || '').trim(),
      name: String(row[idx.name] || '').trim(),
      email: email,
      phoneNumber: String(row[idx.phoneNumber] || '').trim(),
      carrier: String(row[idx.carrier] || '').trim(),
      consentDate: String(row[idx.consentDate] || '').trim(),
    });
  }
  return out;
}

/**
 * Read-only web endpoint. Same Web App deployment as doPost — admins
 * use it for order submissions; the digest workflow reads from it.
 *
 * Routes:
 *   ?action=subscribers   → JSON { ok, subscribers: [...] }
 *
 * No secret/token is required; the response carries email addresses
 * but no phone numbers when no `?token=` is supplied (defense in depth
 * — anyone with the URL could already see member emails through the
 * existing webhook responses).
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'subscribers') {
    try {
      return jsonResponse({ ok: true, subscribers: listActiveSubscribers() });
    } catch (err) {
      console.log('listActiveSubscribers failed:', err);
      return jsonResponse({ ok: false, error: 'subscribers-read-failed' });
    }
  }

  if (action === 'admins') {
    try {
      return jsonResponse({ ok: true, admins: listActiveAdmins() });
    } catch (err) {
      console.log('listActiveAdmins failed:', err);
      return jsonResponse({ ok: false, error: 'admins-read-failed' });
    }
  }

  if (action === 'admin-digest-data') {
    try {
      return jsonResponse({ ok: true, data: getAdminDigestData() });
    } catch (err) {
      console.log('getAdminDigestData failed:', err);
      return jsonResponse({ ok: false, error: 'admin-digest-data-failed' });
    }
  }

  return jsonResponse({ ok: false, error: 'unknown-action' });
}

/**
 * One-time bootstrap for the Subscribers tab. Run from the Apps Script
 * editor's function dropdown:
 *   1. Pick `installSubscribersTab` from the dropdown.
 *   2. Click ▶ Run.
 *   3. Open the spreadsheet and confirm the new Subscribers tab has
 *      the 9 column headers and one example row (set to active=FALSE).
 *
 * Safe to re-run: only writes the example row if the sheet has no
 * data rows below the header.
 */
function installSubscribersTab() {
  const sheet = _openSubscribersSheet_();
  if (sheet.getLastRow() < 2) {
    sheet.appendRow([
      'stw-sub-000-example',
      'Example Subscriber',
      'example@seedtheword.test',
      '',
      '',
      Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'),
      false,
      'system',
      'Example row — set active to TRUE and edit fields, OR delete this row before going live.',
    ]);
  }
  console.log('Subscribers tab is ready: ' +
    SpreadsheetApp.openById(LEDGER_SHEET_ID).getUrl() + '#gid=' + sheet.getSheetId());
}


// ─────────────────────────────────────────────────────────────────────
// SMS-CC manual fire — one-shot test for the announcement-pipeline path
// ─────────────────────────────────────────────────────────────────────
//
// Calls handleAdminSmsCc() with a hardcoded payload to confirm the
// full Apps Script side of the SMS-CC pipeline works in isolation,
// without involving the GitHub Actions runner. Use this when you've
// deployed a new Code.gs version and want to verify the route is
// wired correctly before relying on the auto-fire path.
//
// How to run:
//   1. From the Apps Script editor function dropdown pick
//      `fireTestSmsCcNow`.
//   2. Click ▶ Run.
//   3. Watch your phone for the next ~5 minutes.
//
// What success looks like:
//   - Execution log shows: { ok: true, route: 'admin-sms-cc' }
//   - Phone (253-777-7383) receives a text within ~2 minutes.
function fireTestSmsCcNow() {
  const fakeRequest = {
    postData: {
      contents: JSON.stringify({
        type: 'admin-sms-cc',
        to: '2537777383@vtext.com',
        body: 'STW SMS-CC route test ' + new Date().toISOString().slice(11, 19) + ' UTC. Reply STOP to opt out.',
      }),
    },
  };
  const resp = doPost(fakeRequest);
  // doPost returns a TextOutput object — log its content so we see
  // the JSON shape doPost intended to send back to a real caller.
  const body = resp && resp.getContent ? resp.getContent() : String(resp);
  console.log('handleAdminSmsCc returned: ' + body);
}


// ─────────────────────────────────────────────────────────────────────
// SMS-CC realistic-payload test — simulates a real announcement post
// ─────────────────────────────────────────────────────────────────────
//
// Calls handleAdminSmsCc() with a 140-char body shaped like what the
// announcement bot actually emits after a successful Telegram post.
// Exercises the same code path that runs in production but bypasses
// GitHub Actions (no waiting for a calendar event, no waiting for
// the 15-min cron tick).
//
// This is the closest we can get to "what the SMS will look like
// when a real event fires" without an actual event firing.
//
// How to run:
//   1. From the Apps Script editor function dropdown pick
//      `fireTestSmsAnnouncementNow`.
//   2. Click ▶ Run.
//   3. Watch the Execution log AND your phone.
//
// What success looks like:
//   - Execution log: { ok: true, route: 'admin-sms-cc' }
//   - Phone receives a text within ~2 minutes that reads like a real
//     announcement digest, e.g.:
//       "STW: 2 events posted | Bible Study tonight 7PM | Worship Sat 11AM"
function fireTestSmsAnnouncementNow() {
  // Mirror the exact body shape from _build_sms_summary in
  // .github/scripts/post_calendar_to_telegram.py — what the runner
  // sends in production.
  const sampleBody = 'STW: Test event tonight 7PM | Worship Sat 11AM';

  const fakeRequest = {
    postData: {
      contents: JSON.stringify({
        type: 'admin-sms-cc',
        to: '2537777383@vtext.com',
        body: sampleBody,
      }),
    },
  };
  const resp = doPost(fakeRequest);
  const body = resp && resp.getContent ? resp.getContent() : String(resp);
  console.log('Simulated announcement SMS-CC returned: ' + body);
  console.log('Sample body sent (' + sampleBody.length + ' chars): ' + sampleBody);
}


// ─────────────────────────────────────────────────────────────────────
// Admins tab — recipient list for the twice-weekly admin ops digest
// ─────────────────────────────────────────────────────────────────────
//
// Mirrors the Subscribers tab pattern. Apps Script reads the Admins
// tab on the same spreadsheet so admins manage the recipient list
// through the Sheet UI rather than editing JSON or rotating GitHub
// Secrets when the team changes.
//
// Schema (Admins tab — must match ADMINS_HEADERS exactly):
//   id          stable identifier ('stw-admin-001', ...)
//   name        display name for the digest greeting
//   email       required; missing rows are skipped
//   role        free-form ('elder', 'social', 'ministry-leader', etc.)
//               currently informational only \u2014 every active admin
//               receives every digest
//   active      TRUE/FALSE; FALSE rows silently skipped
//   addedDate   YYYY-MM-DD when they were added to the list
//   notes       freeform
//
// Set up: run installAdminsTab() ONCE from the Apps Script editor's
// function dropdown to create the tab with header row + sample entry.

const ADMINS_HEADERS = [
  'id', 'name', 'email', 'role', 'active', 'addedDate', 'notes',
];

function _openAdminsSheet_() {
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  let sheet = ss.getSheetByName(ADMINS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(ADMINS_TAB);
    sheet.appendRow(ADMINS_HEADERS);
    sheet.getRange(1, 1, 1, ADMINS_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function listActiveAdmins() {
  const sheet = _openAdminsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const range = sheet.getRange(1, 1, lastRow, ADMINS_HEADERS.length);
  const values = range.getValues();
  const headerRow = values[0];
  const idx = {};
  for (let i = 0; i < headerRow.length; i++) {
    idx[String(headerRow[i]).trim()] = i;
  }

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const email = String(row[idx.email] || '').trim();
    if (!email || email.indexOf('@') === -1) continue;

    const rawActive = row[idx.active];
    const isActive =
      rawActive === true ||
      rawActive === 1 ||
      String(rawActive || '').trim().toUpperCase() === 'TRUE';
    if (!isActive) continue;

    out.push({
      id: String(row[idx.id] || '').trim(),
      name: String(row[idx.name] || '').trim(),
      email: email,
      role: String(row[idx.role] || '').trim(),
      addedDate: String(row[idx.addedDate] || '').trim(),
    });
  }
  return out;
}

function installAdminsTab() {
  const sheet = _openAdminsSheet_();
  if (sheet.getLastRow() < 2) {
    sheet.appendRow([
      'stw-admin-000-example',
      'Example Admin',
      'example@seedtheword.test',
      'team-lead',
      false,
      Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'),
      'Example row \u2014 set active to TRUE and edit fields, OR delete this row before going live.',
    ]);
  }
  console.log('Admins tab is ready: ' +
    SpreadsheetApp.openById(LEDGER_SHEET_ID).getUrl() + '#gid=' + sheet.getSheetId());
}


// ─────────────────────────────────────────────────────────────────────
// Admin digest data aggregator
// ─────────────────────────────────────────────────────────────────────
//
// Reads the spreadsheet's operational tabs and returns a single shaped
// object that the twice-weekly admin-digest workflow renders into an
// email. Bundling the read here means Python only does one round-trip
// per digest cadence, not 4-5 separate Sheet API calls.
//
// Returns:
//   {
//     ordersNeedingAction: [{order_id, received_at, gifter_name, ...}],
//     storiesAwaitingReview: [{received_at, name, email, story (snippet)}],
//     recentContacts: [{received_at, name, email, subject, message (snippet)}],
//     newSubscribers: [{name, email, addedDate}],
//   }
//
// "Recent" means the past 7 days. Snippets are first 200 chars to
// keep email body manageable.
function getAdminDigestData() {
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);

  // ── Orders needing action ───────────────────────────────────────
  const ordersNeedingAction = [];
  try {
    const ordersSheet = ss.getSheetByName(LEDGER_TAB);
    if (ordersSheet) {
      const lastRow = ordersSheet.getLastRow();
      if (lastRow >= 2) {
        const values = ordersSheet.getRange(1, 1, lastRow, LEDGER_HEADERS.length).getValues();
        const idx = {};
        for (let i = 0; i < values[0].length; i++) {
          idx[String(values[0][i]).trim()] = i;
        }
        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          const status = String(row[idx.status] || '').trim().toLowerCase();
          // Active = anything not in a terminal state
          if (status === 'shipped' || status === 'delivered' || status === 'cancelled') continue;
          ordersNeedingAction.push({
            order_id: String(row[idx.order_id] || '').trim(),
            received_at: String(row[idx.received_at] || '').trim(),
            bundle: String(row[idx.bundle] || '').trim(),
            gifter_name: String(row[idx.gifter_name] || '').trim(),
            gifter_email: String(row[idx.gifter_email] || '').trim(),
            status: status || 'new',
            is_special_order: row[idx.is_special_order] === true,
          });
        }
      }
    }
  } catch (err) {
    console.log('getAdminDigestData(orders) failed:', err);
  }

  // ── Stories awaiting review ─────────────────────────────────────
  // We can't cross-reference testimonies.json from here (it's in the
  // git repo, not the Sheet), so we surface ALL story submissions
  // received in the past 14 days. The admin then matches them up
  // mentally with what's already published. Future improvement:
  // add a 'reviewed' column to the Stories tab and skip those.
  const storiesAwaitingReview = [];
  try {
    const storiesSheet = ss.getSheetByName(STORIES_TAB);
    if (storiesSheet) {
      const lastRow = storiesSheet.getLastRow();
      if (lastRow >= 2) {
        const values = storiesSheet.getRange(1, 1, lastRow, STORIES_HEADERS.length).getValues();
        const idx = {};
        for (let i = 0; i < values[0].length; i++) {
          idx[String(values[0][i]).trim()] = i;
        }
        const fourteenDaysAgoMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          const receivedRaw = row[idx.received_at];
          const receivedMs = (receivedRaw instanceof Date)
            ? receivedRaw.getTime()
            : Date.parse(String(receivedRaw || ''));
          if (isNaN(receivedMs) || receivedMs < fourteenDaysAgoMs) continue;
          const story = String(row[idx.story] || '');
          storiesAwaitingReview.push({
            received_at: (receivedRaw instanceof Date)
              ? receivedRaw.toISOString()
              : String(receivedRaw || ''),
            name: String(row[idx.name] || '').trim(),
            email: String(row[idx.email] || '').trim(),
            story_snippet: story.length > 200 ? story.slice(0, 200) + '\u2026' : story,
            consent_to_publish: row[idx.consent_to_publish] === true,
            location: String(row[idx.location] || '').trim(),
          });
        }
      }
    }
  } catch (err) {
    console.log('getAdminDigestData(stories) failed:', err);
  }

  // ── Recent contact-form messages ────────────────────────────────
  const recentContacts = [];
  try {
    const contactSheet = ss.getSheetByName(CONTACT_TAB);
    if (contactSheet) {
      const lastRow = contactSheet.getLastRow();
      if (lastRow >= 2) {
        const values = contactSheet.getRange(1, 1, lastRow, CONTACT_HEADERS.length).getValues();
        const idx = {};
        for (let i = 0; i < values[0].length; i++) {
          idx[String(values[0][i]).trim()] = i;
        }
        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          const receivedRaw = row[idx.received_at];
          const receivedMs = (receivedRaw instanceof Date)
            ? receivedRaw.getTime()
            : Date.parse(String(receivedRaw || ''));
          if (isNaN(receivedMs) || receivedMs < sevenDaysAgoMs) continue;
          const message = String(row[idx.message] || '');
          recentContacts.push({
            received_at: (receivedRaw instanceof Date)
              ? receivedRaw.toISOString()
              : String(receivedRaw || ''),
            name: String(row[idx.name] || '').trim(),
            email: String(row[idx.email] || '').trim(),
            subject: String(row[idx.subject] || '').trim(),
            message_snippet: message.length > 200 ? message.slice(0, 200) + '\u2026' : message,
          });
        }
      }
    }
  } catch (err) {
    console.log('getAdminDigestData(contacts) failed:', err);
  }

  // ── New subscribers (added in past 7 days) ──────────────────────
  const newSubscribers = [];
  try {
    const subscribers = listActiveSubscribers();
    for (let i = 0; i < subscribers.length; i++) {
      const s = subscribers[i];
      const ms = Date.parse(s.consentDate || '');
      if (!isNaN(ms) && ms >= sevenDaysAgoMs) {
        newSubscribers.push({
          name: s.name,
          email: s.email,
          consentDate: s.consentDate,
        });
      }
    }
  } catch (err) {
    console.log('getAdminDigestData(subscribers) failed:', err);
  }

  return {
    ordersNeedingAction: ordersNeedingAction,
    storiesAwaitingReview: storiesAwaitingReview,
    recentContacts: recentContacts,
    newSubscribers: newSubscribers,
    generatedAt: new Date().toISOString(),
  };
}


// ═════════════════════════════════════════════════════════════════════
// APPS SCRIPT TIME-TRIGGER MIGRATION (May 2026)
//
// Block of functions ported from .github/scripts/* so they fire on
// Apps Script time-based triggers instead of GitHub Actions cron
// (which has been dropping ~75% of scheduled runs on the free tier).
//
// Trigger setup is one-time:
//   1. Paste this entire file into the Apps Script editor → Save.
//   2. Deploy → Manage deployments → ✏️ → New version → Deploy.
//   3. Run installAllTimeTriggers() ONCE from the function dropdown.
//      This installs:
//        - dailyBibleBot         Mon-Sat 08:00 PT
//        - weeklyMemberDigest    Sat 08:00 PT
//        - weeklyAdminDigestMon  Mon 08:00 PT
//        - weeklyAdminDigestThu  Thu 08:00 PT
//        - dailyCalendarMonitor  Daily 08:30 PT
//        - dailyWorkflowHealth   Daily 09:00 PT
//
// The corresponding GitHub workflows can be disabled (or left running
// as belt-and-suspenders) once we confirm Apps Script triggers fire
// reliably for a few cycles.
//
// Each ported function is self-contained — pulls config from the
// repo's raw JSON (via GitHub raw URLs) and uses the existing
// MailApp / Telegram helpers in this file.
// ═════════════════════════════════════════════════════════════════════

// Raw-content URL for our public repo. The migrated functions read
// telegram-bot.json, bible-spotify-map.json, study-saturday.json,
// testimonies.json, and ministry-outreach.json from here so they
// stay in sync with whatever's on main without needing a
// configured-per-script override.
const REPO_RAW_BASE = 'https://raw.githubusercontent.com/seedtheword/seedtheword/main';
const SITE_PUBLIC_BASE = 'https://seedtheword.github.io/seedtheword';

// MarkdownV2 reserved characters per Telegram's API docs. When used
// as literal text (not formatting), each must be backslash-escaped
// or Telegram will return 400 with a parse-entities error.
const MDV2_SPECIAL_CHARS = '_*[]()~`>#+-=|{}.!';

function _mdv2Escape(text) {
  if (text === null || text === undefined || text === '') return '';
  let out = String(text);
  // Build the escaped version one char at a time. Tried regex
  // approaches with character classes; bracket-escaping inside JS
  // RegExp literals here is fragile, so a per-char loop is clearer.
  let result = '';
  for (let i = 0; i < out.length; i++) {
    const c = out.charAt(i);
    if (MDV2_SPECIAL_CHARS.indexOf(c) !== -1) {
      result += '\\' + c;
    } else {
      result += c;
    }
  }
  return result;
}

function _fetchRepoJson(relativePath) {
  // Cache-bust with a timestamp so editors testing right after a push
  // see the fresh file. GitHub serves raw files with a short CDN TTL
  // (~5 min) by default; the timestamp param sidesteps that.
  const url = REPO_RAW_BASE + '/' + relativePath.replace(/^\//, '')
            + '?t=' + Date.now();
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    if (resp.getResponseCode() !== 200) {
      console.log('repo fetch ' + relativePath + ' got HTTP ' + resp.getResponseCode());
      return null;
    }
    return JSON.parse(resp.getContentText('utf-8'));
  } catch (err) {
    console.log('repo fetch ' + relativePath + ' threw: ' + err);
    return null;
  }
}

function _sendTelegram(token, chatId, text, opts) {
  // opts: { messageThreadId, parseMode, disableWebPagePreview, dryRun }
  opts = opts || {};
  if (opts.dryRun) {
    console.log('[DRY_RUN] Telegram → ' + chatId
      + (opts.messageThreadId ? ' thread ' + opts.messageThreadId : '')
      + ':\n' + text);
    return { ok: true, dry_run: true };
  }
  if (!token) {
    throw new Error('Missing Telegram bot token; aborting send.');
  }
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const payload = {
    chat_id: String(chatId),
    text: text,
    parse_mode: opts.parseMode || 'MarkdownV2',
    disable_web_page_preview: !!opts.disableWebPagePreview,
  };
  if (opts.messageThreadId) {
    payload.message_thread_id = parseInt(opts.messageThreadId, 10);
  }
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const body = resp.getContentText('utf-8');
  if (resp.getResponseCode() !== 200) {
    console.log('Telegram API ' + resp.getResponseCode() + ': ' + body);
    return { ok: false, error_code: resp.getResponseCode(), description: body };
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    return { ok: false, parse_error: String(e), raw: body };
  }
}

function _editForumTopic(token, chatId, threadId, name) {
  if (!token || !chatId || !threadId || !name) {
    return { ok: false, skipped: true };
  }
  const url = 'https://api.telegram.org/bot' + token + '/editForumTopic';
  const payload = {
    chat_id: String(chatId),
    message_thread_id: parseInt(threadId, 10),
    name: String(name).slice(0, 128),
  };
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const body = resp.getContentText('utf-8');
  if (resp.getResponseCode() === 200) {
    try { return JSON.parse(body); } catch (e) { return { ok: true, raw: body }; }
  }
  // 400 with "topic_not_modified" (Telegram returns the variant
  // TOPIC_NOT_MODIFIED, all-caps with underscore) is fine — topic
  // already has that name. Match case-insensitively.
  if (resp.getResponseCode() === 400 && body.toLowerCase().indexOf('topic_not_modified') !== -1) {
    return { ok: true, no_op: true };
  }
  console.log('editForumTopic ' + resp.getResponseCode() + ': ' + body);
  return { ok: false, error_code: resp.getResponseCode(), description: body };
}

// ScriptProperties-backed dedup log keyed by ('biblebot:' + YYYY-MM-DD).
// Cheaper than re-fetching the GitHub-side log on every invocation,
// and Apps Script's PropertiesService is plenty fast for this.
function _bibleBotAlreadyPostedToday(today, kind) {
  const key = 'biblebot:' + Utilities.formatDate(today, 'America/Los_Angeles', 'yyyy-MM-dd') + ':' + kind;
  return PropertiesService.getScriptProperties().getProperty(key) === 'ok';
}

function _bibleBotMarkPostedToday(today, kind) {
  const key = 'biblebot:' + Utilities.formatDate(today, 'America/Los_Angeles', 'yyyy-MM-dd') + ':' + kind;
  PropertiesService.getScriptProperties().setProperty(key, 'ok');
}


// ─────────────────────────────────────────────────────────────────────
// Bible bot — Mon-Fri reading + Saturday Study Saturday Live teaser
// ─────────────────────────────────────────────────────────────────────
//
// Ported from .github/scripts/post_daily_bible_to_telegram.py.
// Time-based trigger fires Mon-Sat 08:00 PT via the
// `dailyBibleBot` entry point. Bot token comes from Script
// Properties (set BIBLE_BOT_TOKEN once via the editor → Project
// Settings → Script Properties → Add).

const NT_BOOKS = [
  ['Matthew', 28], ['Mark', 16], ['Luke', 24], ['John', 21],
  ['Acts', 28], ['Romans', 16], ['1 Corinthians', 16], ['2 Corinthians', 13],
  ['Galatians', 6], ['Ephesians', 6], ['Philippians', 4], ['Colossians', 4],
  ['1 Thessalonians', 5], ['2 Thessalonians', 3], ['1 Timothy', 6],
  ['2 Timothy', 4], ['Titus', 3], ['Philemon', 1], ['Hebrews', 13],
  ['James', 5], ['1 Peter', 5], ['2 Peter', 3], ['1 John', 5],
  ['2 John', 1], ['3 John', 1], ['Jude', 1], ['Revelation', 22],
];
function _ntSequence() {
  const out = [];
  for (let i = 0; i < NT_BOOKS.length; i++) {
    const name = NT_BOOKS[i][0];
    const chapters = NT_BOOKS[i][1];
    for (let c = 1; c <= chapters; c++) {
      out.push({ book: name, chapter: c });
    }
  }
  return out;
}
// Anchor: Apr 30 2026 = Mark 11. Same as the Python script.
const BIBLE_ANCHOR_YEAR = 2026;
const BIBLE_ANCHOR_MONTH = 4;  // 1-indexed
const BIBLE_ANCHOR_DAY = 30;
const BIBLE_ANCHOR_BOOK = 'Mark';
const BIBLE_ANCHOR_CHAPTER = 11;

function _weekdaysBetween(fromY, fromM, fromD, toY, toM, toD) {
  // Count Mon-Fri days between two YYYY-M-D triples (1-indexed
  // months). Inclusive of crossing weekends correctly.
  const from = new Date(fromY, fromM - 1, fromD);
  const to = new Date(toY, toM - 1, toD);
  if (to.getTime() === from.getTime()) return 0;
  const step = (to > from) ? 1 : -1;
  const cursor = new Date(from);
  let count = 0;
  while (cursor.getTime() !== to.getTime()) {
    cursor.setDate(cursor.getDate() + step);
    const dow = cursor.getDay(); // 0=Sun..6=Sat
    if (dow >= 1 && dow <= 5) {
      count += step;
    }
  }
  return count;
}

function _readingForLocalDate(localDate) {
  // localDate is a JS Date in PT.
  const dow = localDate.getDay(); // 0=Sun..6=Sat
  if (dow === 0 || dow === 6) return null;  // Sun + Sat handled separately
  const seq = _ntSequence();
  let anchorIdx = -1;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].book === BIBLE_ANCHOR_BOOK && seq[i].chapter === BIBLE_ANCHOR_CHAPTER) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) return null;
  const offset = _weekdaysBetween(
    BIBLE_ANCHOR_YEAR, BIBLE_ANCHOR_MONTH, BIBLE_ANCHOR_DAY,
    localDate.getFullYear(), localDate.getMonth() + 1, localDate.getDate()
  );
  const idx = anchorIdx + offset;
  if (idx < 0 || idx >= seq.length) return null;
  return { book: seq[idx].book, chapter: seq[idx].chapter };
}

function _resolveSpotifyUrl(reading, biblecfg, spotifycfg, primaryKey, fallbackKeys) {
  const map = (spotifycfg && spotifycfg[primaryKey]) || {};
  const key = reading.book + ' ' + reading.chapter;
  const mapped = map[key];
  if (mapped && key.indexOf('__') !== 0) return mapped;
  for (let i = 0; i < fallbackKeys.length; i++) {
    const k = fallbackKeys[i];
    const fb = (biblecfg && biblecfg[k]) || (spotifycfg && spotifycfg[k]);
    if (fb) return fb;
  }
  return '';
}

function _buildPrayerBlock(fullCfg, biblecfg, todayLocal) {
  if (biblecfg.includePrayerBlock === false) return [];
  const dateLabel = Utilities.formatDate(todayLocal, 'America/Los_Angeles', 'MM/dd/yyyy');
  const prayerTopicUrl = (fullCfg.prayer && fullCfg.prayer.prayerTopicUrl)
    || biblecfg.prayerTopicUrl
    || '';
  const lines = [];
  lines.push('');
  lines.push('🙏 *' + _mdv2Escape("Today's Prayer Requests and Thanksgiving Announcements") + ' ' + _mdv2Escape(dateLabel) + ':*');
  lines.push('');
  lines.push('> _' + _mdv2Escape(
    "You can add your prayer/thanksgiving details either here in this main channel or in the 'Prayer & Thanksgiving' topic."
  ) + '_');
  lines.push('>');
  lines.push('> _' + _mdv2Escape(
    "Members are encouraged to pray for one another and feel free to share your needs because we are called to carry each other's burdens."
  ) + '_');
  lines.push('>');
  lines.push('> _' + _mdv2Escape(
    "Reminder: If members don't want to share revealing information but have general details for the prayer request and/or thanksgiving, we will encourage full anonymity."
  ) + '_');
  if (prayerTopicUrl) {
    lines.push('');
    lines.push('[' + _mdv2Escape('Open the Prayer & Thanksgiving topic →') + '](' + prayerTopicUrl + ')');
  }
  return lines;
}

function _ordinalDate(d) {
  const day = d.getDate();
  let suffix;
  if (day >= 11 && day <= 13) suffix = 'th';
  else suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' })[day % 10] || 'th';
  const monthName = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()];
  return monthName + ' ' + day + suffix + ', ' + d.getFullYear();
}

function _pickCurrentStudyWeek(weeks) {
  if (!weeks || !weeks.length) return null;
  const today = new Date();
  let best = null;
  let bestDt = null;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (!w || !w.weekOf) continue;
    const parts = String(w.weekOf).split('-');
    if (parts.length !== 3) continue;
    const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    if (isNaN(dt.getTime()) || dt > today) continue;
    if (!bestDt || dt > bestDt) {
      bestDt = dt;
      best = w;
    }
  }
  return best;
}


function dailyBibleBot() {
  // Time-trigger entry point. Idempotent — uses ScriptProperties to
  // prevent double-posts on the same local date if Google fires the
  // trigger twice (rare but possible during Google maintenance).
  _markAppsScriptRan('dailyBibleBot');
  const fullCfg = _fetchRepoJson('assets/data/telegram-bot.json');
  if (!fullCfg) {
    console.log('dailyBibleBot: telegram-bot.json fetch failed; aborting.');
    return;
  }
  const biblecfg = fullCfg.bible;
  if (!biblecfg || biblecfg.enabled === false) {
    console.log('dailyBibleBot: bible bot disabled; exiting.');
    return;
  }
  const token = PropertiesService.getScriptProperties().getProperty('BIBLE_BOT_TOKEN');
  if (!token) {
    console.log('dailyBibleBot: missing BIBLE_BOT_TOKEN script property; aborting.');
    return;
  }

  // Today in PT (Apps Script's Date is server-local UTC; we compute
  // PT components manually).
  const tzString = biblecfg.timezone || 'America/Los_Angeles';
  const nowUtc = new Date();
  const ptString = Utilities.formatDate(nowUtc, tzString, 'yyyy-MM-dd HH:mm:ss EEE');
  const ptParts = ptString.split(' ');
  const ymd = ptParts[0].split('-');
  const dowName = ptParts[2];
  const todayPT = new Date(parseInt(ymd[0], 10), parseInt(ymd[1], 10) - 1, parseInt(ymd[2], 10));

  console.log('dailyBibleBot: today is ' + ptString);

  if (dowName === 'Sun') {
    console.log('dailyBibleBot: Sunday — no Bible post scheduled.');
    return;
  }

  const chatId = biblecfg.chatId;
  const threadId = biblecfg.messageThreadId;

  if (dowName === 'Sat') {
    if (_bibleBotAlreadyPostedToday(todayPT, 'saturday')) {
      console.log('dailyBibleBot: Saturday post already fired for today.');
      return;
    }
    const ok = _postBibleStudySaturday(fullCfg, biblecfg, todayPT, chatId, threadId, token);
    if (ok) _bibleBotMarkPostedToday(todayPT, 'saturday');
    return;
  }

  // Mon-Fri
  if (_bibleBotAlreadyPostedToday(todayPT, 'weekday')) {
    console.log('dailyBibleBot: weekday post already fired for today.');
    return;
  }
  const ok = _postBibleWeekdayReading(fullCfg, biblecfg, todayPT, chatId, threadId, token);
  if (ok) _bibleBotMarkPostedToday(todayPT, 'weekday');
}

function _postBibleWeekdayReading(fullCfg, biblecfg, todayPT, chatId, threadId, token) {
  const reading = _readingForLocalDate(todayPT);
  if (!reading) {
    console.log('_postBibleWeekdayReading: no reading scheduled for ' + todayPT);
    return false;
  }
  const spotifyMap = _fetchRepoJson('assets/data/bible-spotify-map.json') || {};
  const englishUrl = _resolveSpotifyUrl(
    reading, biblecfg, spotifyMap,
    'chapters', ['fallbackShowUrl', 'defaultShowUrl']
  );
  const russianUrl = _resolveSpotifyUrl(
    reading, biblecfg, spotifyMap,
    'russianChapters', ['russianFallbackShowUrl', 'russianShowUrl']
  );
  const readingLabel = reading.book + ' Chapter ' + reading.chapter;

  const lines = [];
  if (englishUrl) {
    lines.push('📖 *' + _mdv2Escape("Today's Reading") + ':* ['
      + _mdv2Escape(readingLabel) + '](' + englishUrl + ')');
  } else {
    lines.push('📖 *' + _mdv2Escape("Today's Reading") + ':* ' + _mdv2Escape(readingLabel));
  }
  if (russianUrl) {
    lines.push('\\+ [Читаем Слово Божие на Русском](' + russianUrl + ')');
  }
  // Append the prayer block.
  const prayerLines = _buildPrayerBlock(fullCfg, biblecfg, todayPT);
  for (let i = 0; i < prayerLines.length; i++) lines.push(prayerLines[i]);

  const text = lines.join('\n');
  const resp = _sendTelegram(token, chatId, text, {
    messageThreadId: threadId,
    parseMode: 'MarkdownV2',
  });
  if (!resp.ok) {
    console.log('Bible weekday send rejected: ' + JSON.stringify(resp));
    return false;
  }
  console.log('Posted Bible weekday reading: ' + readingLabel);

  // Best-effort: rename the "Today's Chapter is ..." topic.
  const topicCfg = biblecfg.todayChapterTopic;
  if (topicCfg && topicCfg.enabled !== false && topicCfg.messageThreadId) {
    const template = topicCfg.nameTemplate || "Today's Chapter is {book} {chapter}";
    const newName = template.replace('{book}', reading.book).replace('{chapter}', String(reading.chapter));
    const renameResp = _editForumTopic(token, chatId, topicCfg.messageThreadId, newName);
    if (renameResp.ok) {
      if (renameResp.no_op) {
        console.log('topic rename: already correct (no-op)');
      } else {
        console.log('topic rename: ok');
      }
    } else {
      console.log('topic rename: ' + JSON.stringify(renameResp));
    }
  }
  return true;
}

function _postBibleStudySaturday(fullCfg, biblecfg, todayPT, chatId, threadId, token) {
  const sat = biblecfg.saturday || {};
  if (sat.enabled === false) {
    console.log('_postBibleStudySaturday: disabled; exiting.');
    return false;
  }
  const studyCfg = _fetchRepoJson('assets/data/study-saturday.json') || {};
  const current = _pickCurrentStudyWeek((studyCfg && studyCfg.weeks) || []);
  const oldTestament = (current && current.oldTestament) ? String(current.oldTestament).trim() : '';
  const newTestament = (current && current.newTestament) ? String(current.newTestament).trim() : '';

  const twitchUrl = (sat.twitchUrl || 'https://www.twitch.tv/seedtheword').trim();
  const streamTime = (sat.streamStartTimePT || '7:00 PM').trim();
  const rulesUrl = (sat.rulesUrl || '').trim();
  const bodyIntro = sat.bodyIntro || '';
  const bodyReview = sat.bodyReview || '';
  const bodyGoal = sat.bodyGoal || '';
  const bodyRules = sat.bodyRulesNote || '';

  const tonightDate = _ordinalDate(todayPT);

  const lines = [];
  lines.push('🎙 *' + _mdv2Escape('Discuss Scripture: Study Saturday Live') + '*');
  lines.push(_mdv2Escape('TONIGHT @ ' + streamTime + ', ' + tonightDate));
  lines.push(_mdv2Escape('Watch STW on Twitch —>') + ' ' + twitchUrl);
  lines.push('');
  lines.push('*' + _mdv2Escape('Study Saturday Live!') + '*');
  lines.push('');

  const bodyParas = [bodyIntro, bodyReview, bodyGoal];
  for (let i = 0; i < bodyParas.length; i++) {
    if (bodyParas[i]) {
      lines.push(_mdv2Escape(bodyParas[i]));
      lines.push('');
    }
  }

  if (bodyRules) {
    if (rulesUrl) {
      const target = 'S.E.E.D. Rules';
      const idx = bodyRules.indexOf(target);
      if (idx !== -1) {
        const before = bodyRules.slice(0, idx);
        const after = bodyRules.slice(idx + target.length);
        lines.push(_mdv2Escape(before)
          + '[' + _mdv2Escape(target) + '](' + rulesUrl + ')'
          + _mdv2Escape(after));
      } else {
        lines.push(_mdv2Escape(bodyRules));
        lines.push('[' + _mdv2Escape('S.E.E.D. Rules →') + '](' + rulesUrl + ')');
      }
    } else {
      lines.push(_mdv2Escape(bodyRules));
    }
    lines.push('');
  }

  if (oldTestament) {
    lines.push('📖 *' + _mdv2Escape("This week's study focus:") + '* ' + _mdv2Escape(oldTestament));
  }
  if (newTestament) {
    lines.push('📖 *' + _mdv2Escape("This week's reading:") + '* ' + _mdv2Escape(newTestament));
  }

  const prayerLines = _buildPrayerBlock(fullCfg, biblecfg, todayPT);
  for (let i = 0; i < prayerLines.length; i++) lines.push(prayerLines[i]);

  const text = lines.join('\n');
  const resp = _sendTelegram(token, chatId, text, {
    messageThreadId: threadId,
    parseMode: 'MarkdownV2',
  });
  if (!resp.ok) {
    console.log('Bible Saturday send rejected: ' + JSON.stringify(resp));
    return false;
  }
  console.log('Posted Saturday Study Saturday Live (week of ' + (current && current.weekOf || 'unknown') + ')');
  return true;
}


// ─────────────────────────────────────────────────────────────────────
// Calendar feed reader — shared by digest + monitor functions
// ─────────────────────────────────────────────────────────────────────
//
// Apps Script has CalendarApp built in but it requires the running
// account to have the calendar in their "Other calendars" list AND
// to share read access. The simpler path that mirrors the Python
// scripts is to fetch the public iCal feed and parse it ourselves.

function _fetchIcalEvents(daysFromNowStart, daysFromNowEnd, calendarId) {
  const calId = calendarId || 'seedthewordministry@gmail.com';
  const url = 'https://calendar.google.com/calendar/ical/'
    + encodeURIComponent(calId) + '/public/basic.ics';
  let raw;
  try {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'Accept': 'text/calendar',
        'User-Agent': 'seedtheword-apps-script/1.0',
      },
    });
    if (resp.getResponseCode() !== 200) {
      console.log('iCal fetch HTTP ' + resp.getResponseCode());
      return [];
    }
    raw = resp.getContentText('utf-8');
  } catch (err) {
    console.log('iCal fetch threw: ' + err);
    return [];
  }

  // RFC 5545 line-unfolding: continuation lines start with space/tab.
  const linesRaw = raw.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (let i = 0; i < linesRaw.length; i++) {
    const ln = linesRaw[i];
    if ((ln.charAt(0) === ' ' || ln.charAt(0) === '\t') && lines.length > 0) {
      lines[lines.length - 1] += ln.substring(1);
    } else {
      lines.push(ln);
    }
  }

  const events = [];
  let inEvent = false;
  let cur = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (ln === 'BEGIN:VEVENT') { inEvent = true; cur = []; continue; }
    if (ln === 'END:VEVENT') {
      inEvent = false;
      const ev = { start: null, summary: '', location: '', description: '', id: '' };
      for (let j = 0; j < cur.length; j++) {
        const c = cur[j];
        const colonIdx = c.indexOf(':');
        if (colonIdx === -1) continue;
        const nameRaw = c.substring(0, colonIdx);
        const value = c.substring(colonIdx + 1).trim();
        const baseName = nameRaw.split(';')[0].toUpperCase();
        if (baseName === 'UID') ev.id = value;
        else if (baseName === 'SUMMARY') ev.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
        else if (baseName === 'DESCRIPTION') ev.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
        else if (baseName === 'LOCATION') ev.location = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
        else if (baseName === 'DTSTART') {
          // YYYYMMDD or YYYYMMDDTHHMMSSZ shapes
          const v = value.replace(/[^0-9TZ]/g, '');
          if (v.length >= 8) {
            const y = parseInt(v.substring(0, 4), 10);
            const m = parseInt(v.substring(4, 6), 10);
            const d = parseInt(v.substring(6, 8), 10);
            let hh = 0, mm = 0;
            if (v.length >= 13 && v.charAt(8) === 'T') {
              hh = parseInt(v.substring(9, 11), 10) || 0;
              mm = parseInt(v.substring(11, 13), 10) || 0;
            }
            ev.start = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
          }
        }
      }
      if (ev.start) events.push(ev);
      continue;
    }
    if (inEvent) cur.push(lines[i]);
  }

  // Filter by window
  const now = new Date();
  const windowStart = new Date(now.getTime() + daysFromNowStart * 86400000);
  const windowEnd = new Date(now.getTime() + daysFromNowEnd * 86400000);
  const filtered = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.start >= windowStart && ev.start <= windowEnd) filtered.push(ev);
  }
  filtered.sort(function (a, b) { return a.start.getTime() - b.start.getTime(); });
  return filtered;
}

function _formatEventLine(ev, tzString) {
  const local = Utilities.formatDate(ev.start, tzString, 'EEE MMM d, h:mm a');
  const title = (ev.summary || 'Event').trim();
  const loc = (ev.location || '').split('\n')[0].split(',')[0].trim();
  return loc ? title + ' — ' + local + ' at ' + loc : title + ' — ' + local;
}

// ─────────────────────────────────────────────────────────────────────
// Member weekly digest — Saturday 08:00 PT
// ─────────────────────────────────────────────────────────────────────
function weeklyMemberDigest() {
  _markAppsScriptRan('weeklyMemberDigest');
  const subscribers = listActiveSubscribers();
  if (!subscribers.length) {
    console.log('weeklyMemberDigest: no active subscribers; exiting.');
    return;
  }

  const tz = 'America/Los_Angeles';
  const now = new Date();
  const weekLabel = Utilities.formatDate(now, tz, 'MMMM d, yyyy');
  const subject = 'Seed the Word — Weekly Digest (Week of ' + weekLabel + ')';

  // Collect content from the past + next 7 days
  const eventsPast = _fetchIcalEvents(-7, 0, null);
  const eventsUpcoming = _fetchIcalEvents(0, 7, null);

  // Past 7 days of published testimonies
  const testimoniesData = _fetchRepoJson('assets/data/testimonies.json') || { testimonies: [] };
  const weekAgoMs = now.getTime() - 7 * 86400000;
  const recentTestimonies = [];
  const allT = (testimoniesData && testimoniesData.testimonies) || [];
  for (let i = 0; i < allT.length; i++) {
    const t = allT[i];
    if (t.published !== true) continue;
    if (!t.publishedAt) continue;
    const pubMs = Date.parse(t.publishedAt + 'T00:00:00Z');
    if (isNaN(pubMs) || pubMs < weekAgoMs) continue;
    recentTestimonies.push(t);
  }
  recentTestimonies.sort(function (a, b) {
    return (b.publishedAt || '').localeCompare(a.publishedAt || '');
  });

  // Past 7 days of outreach events
  const outreachData = _fetchRepoJson('assets/data/ministry-outreach.json') || { events: [] };
  const recentOutreach = [];
  const allO = (outreachData && outreachData.events) || [];
  for (let i = 0; i < allO.length; i++) {
    const o = allO[i];
    const dateStr = (o.eventDate || o.date || '').trim();
    if (!dateStr) continue;
    const oMs = Date.parse(dateStr + 'T00:00:00Z');
    if (isNaN(oMs) || oMs < weekAgoMs || oMs > now.getTime()) continue;
    recentOutreach.push(o);
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < subscribers.length; i++) {
    const sub = subscribers[i];
    const html = _buildMemberDigestHtml({
      eventsPast: eventsPast,
      eventsUpcoming: eventsUpcoming,
      testimonies: recentTestimonies,
      outreach: recentOutreach,
    }, sub.name || '', weekLabel, tz);
    const text = _buildMemberDigestText({
      eventsPast: eventsPast,
      eventsUpcoming: eventsUpcoming,
      testimonies: recentTestimonies,
      outreach: recentOutreach,
    }, sub.name || '', weekLabel, tz);
    try {
      MailApp.sendEmail({
        to: sub.email,
        subject: subject,
        htmlBody: html,
        body: text,
        name: 'Seed the Word Ministry',
        noReply: true,
      });
      sent++;
    } catch (err) {
      console.log('weeklyMemberDigest: send failed for ' + sub.email + ': ' + err);
      failed++;
    }
  }
  console.log('weeklyMemberDigest: sent=' + sent + ' failed=' + failed);
}

function _buildMemberDigestHtml(content, name, weekLabel, tz) {
  let body = '';
  if (content.eventsPast.length) {
    let rows = '';
    for (let i = 0; i < content.eventsPast.length; i++) {
      rows += '<li>' + _htmlEscape(_formatEventLine(content.eventsPast[i], tz)) + '</li>';
    }
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">What happened this week</h3>'
      + '<ul style="line-height:1.7">' + rows + '</ul>';
  }
  if (content.eventsUpcoming.length) {
    let rows = '';
    for (let i = 0; i < content.eventsUpcoming.length; i++) {
      rows += '<li>' + _htmlEscape(_formatEventLine(content.eventsUpcoming[i], tz)) + '</li>';
    }
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">Coming up this week</h3>'
      + '<ul style="line-height:1.7">' + rows + '</ul>';
  }
  if (content.testimonies.length) {
    let cards = '';
    for (let i = 0; i < Math.min(3, content.testimonies.length); i++) {
      const t = content.testimonies[i];
      const tname = t.anonymous ? 'Anonymous' : (t.name || 'A friend');
      const excerpt = (t.excerpt || t.body || '').slice(0, 280);
      const verse = (t.anchorVerse || '').trim();
      const verseBit = verse ? '<br><span style="color:#888;font-style:italic">— ' + _htmlEscape(verse) + '</span>' : '';
      cards += '<blockquote style="border-left:3px solid #d4a574;padding:0.5rem 1rem;margin:1rem 0;color:#444;line-height:1.7">'
        + '&ldquo;' + _htmlEscape(excerpt) + '&rdquo;<br>'
        + '<strong style="color:#2C5F2E">— ' + _htmlEscape(tname) + '</strong>' + verseBit
        + '</blockquote>';
    }
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">Testimonies shared this week</h3>'
      + cards;
  }
  if (content.outreach.length) {
    let rows = '';
    for (let i = 0; i < Math.min(3, content.outreach.length); i++) {
      const o = content.outreach[i];
      const summary = (o.summary || o.description || '').slice(0, 200);
      rows += '<li><strong>' + _htmlEscape(o.title || 'Outreach') + '</strong>'
        + (o.location ? ' &middot; ' + _htmlEscape(o.location) : '')
        + (summary ? '<br>' + _htmlEscape(summary) : '') + '</li>';
    }
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">From the field</h3>'
      + '<ul style="line-height:1.7">' + rows + '</ul>';
  }
  if (!body) {
    body = '<p style="color:#555;line-height:1.7">No new events, testimonies, or outreach to share this week — but the Lord is still at work in quieter ways. Keep watching for Him.</p>';
  }
  return _wrapDigestHtml('Weekly Digest', weekLabel, name || 'friend',
    "Here's what the Lord has been doing through our ministry this week. Take a moment, brew some coffee, and read with us.",
    body);
}

function _buildMemberDigestText(content, name, weekLabel, tz) {
  const parts = [];
  parts.push('Seed the Word — Weekly Digest');
  parts.push('Week of ' + weekLabel);
  parts.push('');
  parts.push('Dear ' + (name || 'friend') + ',');
  parts.push('');
  parts.push("Here's what the Lord has been doing through our ministry this week.");
  parts.push('');

  if (content.eventsPast.length) {
    parts.push('WHAT HAPPENED THIS WEEK');
    for (let i = 0; i < content.eventsPast.length; i++) {
      parts.push('- ' + _formatEventLine(content.eventsPast[i], tz));
    }
    parts.push('');
  }
  if (content.eventsUpcoming.length) {
    parts.push('COMING UP THIS WEEK');
    for (let i = 0; i < content.eventsUpcoming.length; i++) {
      parts.push('- ' + _formatEventLine(content.eventsUpcoming[i], tz));
    }
    parts.push('');
  }
  if (content.testimonies.length) {
    parts.push('TESTIMONIES SHARED THIS WEEK');
    for (let i = 0; i < Math.min(3, content.testimonies.length); i++) {
      const t = content.testimonies[i];
      const tname = t.anonymous ? 'Anonymous' : (t.name || 'A friend');
      parts.push('  "' + (t.excerpt || t.body || '').slice(0, 280) + '"');
      parts.push('  — ' + tname + (t.anchorVerse ? ' (' + t.anchorVerse + ')' : ''));
      parts.push('');
    }
  }
  if (content.outreach.length) {
    parts.push('FROM THE FIELD');
    for (let i = 0; i < Math.min(3, content.outreach.length); i++) {
      const o = content.outreach[i];
      parts.push('- ' + (o.title || 'Outreach') + (o.location ? ' (' + o.location + ')' : ''));
      const summary = (o.summary || o.description || '').slice(0, 200);
      if (summary) parts.push('  ' + summary);
    }
    parts.push('');
  }
  parts.push('---');
  parts.push('Find more on the site: ' + SITE_PUBLIC_BASE);
  parts.push('');
  parts.push('Sincerely,');
  parts.push('The Seed the Word team');
  return parts.join('\n');
}

function _htmlEscape(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _wrapDigestHtml(kind, label, greetingName, lead, body) {
  return '<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#fdf3e3;color:#1a1a1a;margin:0;padding:1rem">'
    + '<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">'
    + '<div style="background:linear-gradient(135deg,#2C5F2E,#3a7d3c);padding:1.5rem 1.75rem;color:#fdf3e3">'
    + '<h1 style="margin:0;font-family:Georgia,serif;font-size:1.4rem">Seed the Word &mdash; ' + _htmlEscape(kind) + '</h1>'
    + '<p style="margin:0.25rem 0 0;opacity:0.85">' + _htmlEscape(label) + '</p>'
    + '</div>'
    + '<div style="padding:1.5rem 1.75rem">'
    + '<p style="line-height:1.7">Dear ' + _htmlEscape(greetingName) + ',</p>'
    + (lead ? '<p style="line-height:1.7">' + _htmlEscape(lead) + '</p>' : '')
    + body
    + '<hr style="border:0;border-top:1px solid #e8e4de;margin:2rem 0 1rem">'
    + '<p style="line-height:1.7;color:#666;font-size:0.92rem">'
    + 'Find every story, the full calendar, and the rest of our community on the site: '
    + '<a href="' + SITE_PUBLIC_BASE + '" style="color:#2C5F2E">' + SITE_PUBLIC_BASE + '</a></p>'
    + '<p style="line-height:1.7;color:#666;font-size:0.85rem;font-style:italic">Sincerely,<br>The Seed the Word team</p>'
    + '</div></div></body></html>';
}


// ─────────────────────────────────────────────────────────────────────
// Admin ops digest — Mon + Thu 08:00 PT
// ─────────────────────────────────────────────────────────────────────
function weeklyAdminDigestMon() { _runAdminDigest('Monday'); }
function weeklyAdminDigestThu() { _runAdminDigest('Thursday'); }

function _runAdminDigest(weekday) {
  _markAppsScriptRan('weeklyAdminDigest_' + weekday);
  const admins = listActiveAdmins();
  if (!admins.length) {
    console.log('admin digest: no active admins; exiting.');
    return;
  }
  // Reuse the existing aggregator we built for the GitHub-side path.
  const data = getAdminDigestData();
  const tz = 'America/Los_Angeles';
  const now = new Date();
  const dateLabel = Utilities.formatDate(now, tz, 'EEEE, MMMM d, yyyy');
  const subject = 'Seed the Word — Admin Ops Digest (' + weekday + ')';

  // Calendar count for next 14d
  const upcoming = _fetchIcalEvents(0, 14, null);
  const calCount = upcoming.length;

  let sent = 0, failed = 0;
  for (let i = 0; i < admins.length; i++) {
    const a = admins[i];
    const html = _buildAdminDigestHtml(data, a.name || '', dateLabel, calCount);
    const text = _buildAdminDigestText(data, a.name || '', dateLabel, calCount);
    try {
      MailApp.sendEmail({
        to: a.email,
        subject: subject,
        htmlBody: html,
        body: text,
        name: 'Seed the Word Ministry',
        noReply: true,
      });
      sent++;
    } catch (err) {
      console.log('admin digest send failed for ' + a.email + ': ' + err);
      failed++;
    }
  }
  console.log('admin digest: sent=' + sent + ' failed=' + failed);
}

function _buildAdminDigestHtml(data, name, label, calCount) {
  let body = '';
  const orders = data.ordersNeedingAction || [];
  if (orders.length) {
    let rows = '';
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const tagColor = (o.status === 'confirming') ? '#3a7d3c'
        : (o.status === 'packing') ? '#2C5F2E' : '#d4a574';
      const special = o.is_special_order
        ? ' <span style="background:#fff3cd;color:#6c4500;padding:0.1rem 0.5rem;border-radius:4px;font-size:0.8rem">✨ special</span>'
        : '';
      rows += '<tr><td style="padding:0.5rem;border-bottom:1px solid #f0ebe2">'
        + '<strong>' + _htmlEscape(o.order_id || '?') + '</strong>' + special + '<br>'
        + '<small style="color:#666">' + _htmlEscape(o.bundle || '?') + ' for ' + _htmlEscape(o.gifter_name || '?') + '</small>'
        + '</td><td style="padding:0.5rem;border-bottom:1px solid #f0ebe2;vertical-align:top">'
        + '<span style="background:' + tagColor + ';color:#fff;padding:0.15rem 0.6rem;border-radius:4px;font-size:0.85rem;text-transform:uppercase">'
        + _htmlEscape(o.status || 'new') + '</span></td></tr>';
    }
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">📦 Orders needing action (' + orders.length + ')</h3>'
      + '<table style="width:100%;border-collapse:collapse"><tbody>' + rows + '</tbody></table>';
  }
  const stories = data.storiesAwaitingReview || [];
  if (stories.length) {
    let cards = '';
    for (let i = 0; i < Math.min(5, stories.length); i++) {
      const s = stories[i];
      const recv = (s.received_at || '').slice(0, 10);
      const consent = s.consent_to_publish ? ' <em style="color:#2C5F2E">(consent given)</em>' : '';
      cards += '<blockquote style="border-left:3px solid #d4a574;padding:0.5rem 1rem;margin:0.75rem 0;color:#333;line-height:1.6">'
        + '<strong>' + _htmlEscape(s.name || 'Anonymous') + '</strong> &middot; ' + _htmlEscape(recv) + consent + '<br>'
        + '<small style="color:#666">' + _htmlEscape(s.email || '') + '</small><br>'
        + '&ldquo;' + _htmlEscape(s.story_snippet || '') + '&rdquo;</blockquote>';
    }
    const more = stories.length > 5
      ? '<p style="color:#666;font-style:italic;margin-top:0.5rem">… and ' + (stories.length - 5) + ' more in the Stories tab.</p>'
      : '';
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">✨ Stories awaiting review (' + stories.length + ')</h3>'
      + cards + more;
  }
  const contacts = data.recentContacts || [];
  if (contacts.length) {
    let cards = '';
    for (let i = 0; i < Math.min(5, contacts.length); i++) {
      const c = contacts[i];
      const recv = (c.received_at || '').slice(0, 10);
      cards += '<blockquote style="border-left:3px solid #2C5F2E;padding:0.5rem 1rem;margin:0.75rem 0;color:#333;line-height:1.6">'
        + '<strong>' + _htmlEscape(c.name || 'Anonymous') + '</strong> &middot; ' + _htmlEscape(recv) + '<br>'
        + '<small style="color:#666">' + _htmlEscape(c.email || '') + ' &middot; <em>' + _htmlEscape(c.subject || '(no subject)') + '</em></small><br>'
        + '&ldquo;' + _htmlEscape(c.message_snippet || '') + '&rdquo;</blockquote>';
    }
    const more = contacts.length > 5
      ? '<p style="color:#666;font-style:italic;margin-top:0.5rem">… and ' + (contacts.length - 5) + ' more in the Contact tab.</p>'
      : '';
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">✉️ Recent contact messages (' + contacts.length + ')</h3>'
      + cards + more;
  }
  const subs = data.newSubscribers || [];
  if (subs.length) {
    let rows = '';
    for (let i = 0; i < subs.length; i++) {
      rows += '<li>' + _htmlEscape(subs[i].name || '?') + ' — <small style="color:#666">' + _htmlEscape(subs[i].email || '') + '</small></li>';
    }
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">💌 New subscribers this week (' + subs.length + ')</h3>'
      + '<ul style="line-height:1.7">' + rows + '</ul>';
  }
  if (calCount < 2) {
    body += '<h3 style="font-family:Georgia,serif;color:#b54f2c;margin:1.5rem 0 0.5rem">⚠️ Calendar is thin (' + calCount + ' events in next 14 days)</h3>'
      + '<p style="line-height:1.7">The Telegram announcement bot has very little to post this stretch. Add events through Google Calendar or convert past weekly events to recurring.</p>';
  } else if (calCount < 5) {
    body += '<h3 style="font-family:Georgia,serif;color:#2C5F2E;margin:1.5rem 0 0.5rem">📅 Calendar status</h3>'
      + '<p style="line-height:1.7">' + calCount + ' events scheduled in the next 14 days.</p>';
  }
  if (!body) {
    body = '<p style="color:#555;line-height:1.7">Nothing actionable on the ops board right now. All orders in terminal states, no stories awaiting review, no fresh contact messages this past week. The Lord is also at work in the quiet.</p>';
  }
  return _wrapDigestHtml('Admin Ops Digest', label, name || 'team',
    'Quick ops snapshot for the team. Sent every Monday and Thursday morning.',
    body);
}

function _buildAdminDigestText(data, name, label, calCount) {
  const parts = [];
  parts.push('Seed the Word — Admin Ops Digest');
  parts.push(label);
  parts.push('');
  parts.push('Dear ' + (name || 'team') + ',');
  parts.push('');
  parts.push('Quick ops snapshot for the team.');
  parts.push('');

  const orders = data.ordersNeedingAction || [];
  if (orders.length) {
    parts.push('ORDERS NEEDING ACTION (' + orders.length + ')');
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      parts.push('- [' + (o.status || 'new').toUpperCase() + '] ' + (o.order_id || '?')
        + ' — ' + (o.bundle || '?') + ' for ' + (o.gifter_name || '?')
        + (o.is_special_order ? ' (SPECIAL)' : ''));
    }
    parts.push('');
  }
  const stories = data.storiesAwaitingReview || [];
  if (stories.length) {
    parts.push('STORIES AWAITING REVIEW (' + stories.length + ')');
    for (let i = 0; i < Math.min(5, stories.length); i++) {
      const s = stories[i];
      parts.push('- ' + (s.name || 'Anonymous') + ' (' + (s.received_at || '').slice(0, 10) + ')');
      parts.push('  "' + (s.story_snippet || '') + '"');
    }
    parts.push('');
  }
  const contacts = data.recentContacts || [];
  if (contacts.length) {
    parts.push('RECENT CONTACT MESSAGES (' + contacts.length + ')');
    for (let i = 0; i < Math.min(5, contacts.length); i++) {
      const c = contacts[i];
      parts.push('- ' + (c.name || 'Anonymous') + ' (' + (c.received_at || '').slice(0, 10) + ') — ' + (c.subject || ''));
      parts.push('  "' + (c.message_snippet || '') + '"');
    }
    parts.push('');
  }
  if (calCount < 2) {
    parts.push('WARNING: Calendar is thin (' + calCount + ' events in next 14 days).');
    parts.push('');
  }
  parts.push('---');
  parts.push('Admin help: ' + SITE_PUBLIC_BASE + '/admin-help.html');
  parts.push('');
  parts.push('Sincerely,');
  parts.push('The Seed the Word automation');
  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Daily calendar-thin monitor — 08:30 PT
// ─────────────────────────────────────────────────────────────────────
function dailyCalendarMonitor() {
  _markAppsScriptRan('dailyCalendarMonitor');
  const upcoming = _fetchIcalEvents(0, 7, null);
  const threshold = 2;
  console.log('dailyCalendarMonitor: ' + upcoming.length + ' events in next 7 days; threshold ' + threshold);
  if (upcoming.length >= threshold) return;

  const tz = 'America/Los_Angeles';
  let rows = '';
  for (let i = 0; i < upcoming.length; i++) {
    rows += '<li>' + _htmlEscape(_formatEventLine(upcoming[i], tz)) + '</li>';
  }
  const eventsHtml = upcoming.length
    ? '<ul style="line-height:1.7">' + rows + '</ul>'
    : '<p><strong>The calendar is empty for the next 7 days.</strong></p>';

  const html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.6">'
    + '<div style="max-width:600px;margin:0 auto;padding:1.5rem;background:#fff8f0;border:1px solid #d4a574;border-radius:10px">'
    + '<h2 style="color:#2C5F2E;margin-top:0">Heads up: the calendar is running thin</h2>'
    + '<p>The ministry calendar has only <strong>' + upcoming.length + '</strong> events scheduled in the next 7 days (threshold: ' + threshold + ').</p>'
    + '<h3 style="color:#2C5F2E">What\'s currently on the calendar:</h3>'
    + eventsHtml
    + '<h3 style="color:#2C5F2E">What to do about it:</h3>'
    + '<ol><li>Open <a href="https://calendar.google.com/" style="color:#2C5F2E">Google Calendar</a> and add events.</li>'
    + '<li>Convert weekly events to recurring so the calendar fills itself.</li>'
    + '<li>You\'ll stop getting these emails when count crosses threshold.</li></ol>'
    + '<p style="color:#666;font-size:0.9rem;font-style:italic;margin-top:2rem">Automated daily monitor.</p>'
    + '</div></body></html>';

  try {
    MailApp.sendEmail({
      to: TEAM_INBOX,
      subject: '[STW Calendar] Only ' + upcoming.length + ' events scheduled for the next 7 days',
      htmlBody: html,
      body: 'Calendar is thin (' + upcoming.length + ' events in next 7 days). Open Google Calendar and add events or convert weekly events to recurring.',
      name: 'Seed the Word Calendar Monitor',
      noReply: true,
    });
    console.log('dailyCalendarMonitor: alert dispatched.');
  } catch (err) {
    console.log('dailyCalendarMonitor: send failed: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// GitHub workflow health check — daily 09:00 PT
// ─────────────────────────────────────────────────────────────────────
//
// Watches the bot-authored commits on origin/main to detect when
// GitHub Actions cron has gone dark for any of the workflows still
// running there (announcement bot, Instagram scrape, playlist digest,
// heartbeat). If any expected commit type hasn't appeared within its
// SLO, emails the team.

function dailyWorkflowHealth() {
  _markAppsScriptRan('dailyWorkflowHealth');
  const checks = [
    // 'announcement bot' removed: it's now invoked by the Apps Script
    // kickAnnouncementBot trigger, which is itself watched by
    // dailyAppsScriptHealthCheck. Keeping the GitHub-side watcher
    // here would double-alert on the same root cause.
    {
      label: 'heartbeat',
      pattern: 'chore: heartbeat tick',
      maxAgeHours: 6,   // expected hourly
    },
    // 'instagram scrape' removed May 2026 — Instagram is now
    // hand-curated via the admin editor (no scheduled commits to
    // watch for). Re-add this entry if we ever wire up another
    // automated scraper.
  ];

  const apiUrl = 'https://api.github.com/repos/seedtheword/seedtheword/commits?per_page=100';
  let commits;
  try {
    // GitHub's unauthenticated API budget (60 requests/hour, shared
    // across the Apps Script egress IP pool) gets blown well before
    // our daily call lands. A fine-grained personal access token with
    // read-only "Contents" scope on this single repo lifts the limit
    // to 5,000/hour and is a one-time setup. Falls back to
    // unauthenticated if no token configured \u2014 useful for first-run
    // smoke tests, then expect 403s for the next hour or so.
    const ghToken = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'seedtheword-apps-script/1.0',
    };
    if (ghToken) headers['Authorization'] = 'token ' + ghToken;
    const resp = UrlFetchApp.fetch(apiUrl, {
      muteHttpExceptions: true,
      headers: headers,
    });
    if (resp.getResponseCode() !== 200) {
      console.log('dailyWorkflowHealth: GitHub API '
        + resp.getResponseCode()
        + (ghToken ? ' (with token \u2014 unexpected)' : ' (no token \u2014 set GITHUB_TOKEN script property)'));
      return;
    }
    commits = JSON.parse(resp.getContentText('utf-8'));
  } catch (err) {
    console.log('dailyWorkflowHealth: fetch threw: ' + err);
    return;
  }

  const now = Date.now();
  const stale = [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    let mostRecent = null;
    for (let j = 0; j < commits.length; j++) {
      const msg = (commits[j].commit && commits[j].commit.message) || '';
      if (msg.indexOf(c.pattern) !== -1) {
        const date = new Date(commits[j].commit.author.date);
        if (!mostRecent || date > mostRecent) mostRecent = date;
      }
    }
    const ageHours = mostRecent ? (now - mostRecent.getTime()) / 3600000 : 99999;
    if (ageHours > c.maxAgeHours) {
      stale.push({
        label: c.label,
        ageHours: ageHours.toFixed(1),
        maxAgeHours: c.maxAgeHours,
        lastSeen: mostRecent ? Utilities.formatDate(mostRecent, 'America/Los_Angeles', 'EEE MMM d HH:mm zzz') : 'never (in last 100 commits)',
      });
    }
  }

  if (!stale.length) {
    console.log('dailyWorkflowHealth: all GitHub workflows healthy.');
    return;
  }

  let rows = '';
  for (let i = 0; i < stale.length; i++) {
    const s = stale[i];
    rows += '<tr><td style="padding:0.4rem;border-bottom:1px solid #f0ebe2"><strong>' + _htmlEscape(s.label) + '</strong></td>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2">' + _htmlEscape(s.lastSeen) + '</td>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2;color:#b54f2c"><strong>' + _htmlEscape(s.ageHours) + ' h</strong> (SLO ' + s.maxAgeHours + ' h)</td></tr>';
  }
  const html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.6">'
    + '<div style="max-width:680px;margin:0 auto;padding:1.5rem;background:#fff8f0;border:1px solid #d4a574;border-radius:10px">'
    + '<h2 style="color:#2C5F2E;margin-top:0">⚠️ GitHub workflow(s) appear to have stalled</h2>'
    + '<p>The following automated workflows haven\'t updated their bot-authored commit logs within their expected windows:</p>'
    + '<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left">'
    + '<th style="padding:0.4rem">Workflow</th><th style="padding:0.4rem">Last seen</th><th style="padding:0.4rem">Age</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<h3 style="color:#2C5F2E">What to do</h3>'
    + '<ol><li>Open <a href="https://github.com/seedtheword/seedtheword/actions">github.com/seedtheword/seedtheword/actions</a></li>'
    + '<li>Find the workflow listed above and click "Run workflow" to trigger a manual run.</li>'
    + '<li>If it succeeds, the next scheduled tick will likely also succeed and you\'ll stop getting these alerts.</li>'
    + '<li>If it fails, the workflow log will show why (most common: a secret expired or a third-party API changed).</li></ol>'
    + '<p style="color:#666;font-size:0.9rem;font-style:italic;margin-top:2rem">Daily Apps Script health check.</p>'
    + '</div></body></html>';

  try {
    MailApp.sendEmail({
      to: TEAM_INBOX,
      subject: '[STW Health] ' + stale.length + ' workflow(s) stalled',
      htmlBody: html,
      body: stale.length + ' workflow(s) stalled: ' + stale.map(function (s) { return s.label + ' (' + s.ageHours + 'h)'; }).join(', '),
      name: 'Seed the Word Health Check',
      noReply: true,
    });
    console.log('dailyWorkflowHealth: alert dispatched for ' + stale.length + ' stale workflow(s).');
  } catch (err) {
    console.log('dailyWorkflowHealth: send failed: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// One-time time-trigger installer
// ─────────────────────────────────────────────────────────────────────
//
// Run installAllTimeTriggers() ONCE from the Apps Script editor's
// function dropdown. Idempotent — wipes existing triggers for the
// six handlers and reinstalls them.
function installAllTimeTriggers() {
  // Wipe existing triggers for the eight handlers we manage
  const handlers = [
    'dailyBibleBot',
    'weeklyMemberDigest',
    'weeklyAdminDigestMon',
    'weeklyAdminDigestThu',
    'dailyCalendarMonitor',
    'dailyWorkflowHealth',
    'dailyAppsScriptHealthCheck',
    'kickAnnouncementBot',
  ];
  const existing = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < existing.length; i++) {
    if (handlers.indexOf(existing[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  console.log('installAllTimeTriggers: removed ' + removed + ' existing triggers.');

  // Reinstall: all triggers fire in PT (Apps Script time-based
  // triggers honor the script's Project Settings → Time zone, which
  // should be set to America/Los_Angeles).
  ScriptApp.newTrigger('dailyBibleBot').timeBased()
    .everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('weeklyMemberDigest').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(8).create();
  ScriptApp.newTrigger('weeklyAdminDigestMon').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('weeklyAdminDigestThu').timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).create();
  ScriptApp.newTrigger('dailyCalendarMonitor').timeBased()
    .everyDays(1).atHour(8).nearMinute(30).create();
  ScriptApp.newTrigger('dailyWorkflowHealth').timeBased()
    .everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('dailyAppsScriptHealthCheck').timeBased()
    .everyDays(1).atHour(9).nearMinute(15).create();
  // Announcement-bot kicker fires every 30 min 24/7. The Python
  // bot has its own quiet-hours guard (07:00–22:00 PT for non-LIVE
  // posts), so off-hours kicks just no-op rather than spamming.
  ScriptApp.newTrigger('kickAnnouncementBot').timeBased()
    .everyMinutes(30).create();

  console.log('installAllTimeTriggers: installed 8 triggers.');
  console.log('Confirm in: Project Settings → Triggers (left rail icon).');
  console.log('IMPORTANT: ensure script timezone is America/Los_Angeles');
  console.log('  (Project Settings → General → Time zone).');
}


// ─────────────────────────────────────────────────────────────────────
// Apps Script self-heartbeat — confirms our own time triggers are firing
// ─────────────────────────────────────────────────────────────────────
//
// Every scheduled function calls _markAppsScriptRan(name) at entry,
// recording an ISO timestamp in ScriptProperties under the key
// 'asran:<name>'. The dailyAppsScriptHealthCheck function reads each
// expected trigger's last-ran timestamp and emails the team if any
// have gone stale beyond their SLO.
//
// Symmetric with dailyWorkflowHealth (which watches the GitHub side)
// — together they give us both halves of the automation alive/dead
// signal.

function _markAppsScriptRan(name) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      'asran:' + name,
      new Date().toISOString()
    );
  } catch (err) {
    // Quota or sharing issue — log but don't fail the caller.
    console.log('_markAppsScriptRan(' + name + ') failed: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Announcement-bot kicker — fires the existing GitHub Actions workflow
// every 30 minutes from Apps Script, working around the free-tier cron
// skipping ~75% of runs.
//
// Why this and not a full Apps Script port: the announcement bot is
// ~1100 lines of Python doing iCal parsing, three trigger types, image
// extraction, MarkdownV2 escaping, a dedup log, quiet hours, SMS-CC,
// etc. Porting it carries real regression risk for something that
// already works correctly when actually invoked. The only failure mode
// is GitHub's cron not firing it. Apps Script time triggers fire
// reliably, GitHub's workflow_dispatch endpoint is rock-solid, so we
// combine them.
//
// The Python bot is idempotent (dedup log skips already-fired
// triggers) so duplicate invocations are no-ops.
//
// Requires GITHUB_TOKEN script property with actions:write scope on
// seedtheword/seedtheword (same token dailyWorkflowHealth uses).
// ─────────────────────────────────────────────────────────────────────
function kickAnnouncementBot() {
  _markAppsScriptRan('kickAnnouncementBot');

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickAnnouncementBot: GITHUB_TOKEN script property not set; aborting');
    return;
  }

  var url = 'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/telegram-announcements.yml/dispatches';
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + ghToken,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'seedtheword-apps-script/1.0',
      },
      payload: JSON.stringify({ ref: 'main' }),
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code === 204) {
      console.log('kickAnnouncementBot: dispatched OK (204)');
    } else {
      console.log(
        'kickAnnouncementBot: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickAnnouncementBot: threw: ' + err);
  }
}

function dailyAppsScriptHealthCheck() {
  _markAppsScriptRan('dailyAppsScriptHealthCheck');

  // Each entry is a trigger we expect to fire on a known cadence,
  // with an SLO in hours past which we consider it stalled. SLOs are
  // set generously — Apps Script time triggers fire ±15 min normally,
  // so a 30-hour SLO on a daily trigger means "we missed at least
  // one full day."
  const checks = [
    { name: 'dailyBibleBot',                  maxAgeHours: 30, label: 'Bible bot (Mon-Sat)' },
    { name: 'dailyCalendarMonitor',           maxAgeHours: 30, label: 'Calendar monitor' },
    { name: 'dailyWorkflowHealth',            maxAgeHours: 30, label: 'GitHub workflow health check' },
    // Announcement-bot kicker — fires every 30 min, so a 2-hour SLO
    // is generous. If this goes stale the announcements stop.
    { name: 'kickAnnouncementBot',            maxAgeHours: 2,  label: 'Announcement bot kicker' },
    // Weekly checks — SLO is 8 days so a one-day delay doesn't trip the
    // alarm but a missed week does.
    { name: 'weeklyMemberDigest',             maxAgeHours: 192, label: 'Weekly member digest (Sat)' },
    { name: 'weeklyAdminDigest_Monday',       maxAgeHours: 192, label: 'Weekly admin digest (Mon)' },
    { name: 'weeklyAdminDigest_Thursday',     maxAgeHours: 192, label: 'Weekly admin digest (Thu)' },
  ];

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  const stale = [];
  const fresh = [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const raw = props.getProperty('asran:' + c.name);
    if (!raw) {
      stale.push({
        label: c.label,
        lastSeen: 'never (no record yet)',
        ageHours: 99999,
        maxAgeHours: c.maxAgeHours,
      });
      continue;
    }
    const lastMs = Date.parse(raw);
    if (isNaN(lastMs)) {
      stale.push({
        label: c.label,
        lastSeen: raw + ' (unparseable)',
        ageHours: 99999,
        maxAgeHours: c.maxAgeHours,
      });
      continue;
    }
    const ageHours = (now - lastMs) / 3600000;
    const lastSeen = Utilities.formatDate(
      new Date(lastMs), 'America/Los_Angeles', 'EEE MMM d HH:mm zzz'
    );
    if (ageHours > c.maxAgeHours) {
      stale.push({ label: c.label, lastSeen: lastSeen, ageHours: ageHours.toFixed(1), maxAgeHours: c.maxAgeHours });
    } else {
      fresh.push({ label: c.label, lastSeen: lastSeen, ageHours: ageHours.toFixed(1) });
    }
  }

  if (!stale.length) {
    console.log('dailyAppsScriptHealthCheck: all ' + fresh.length + ' triggers fresh.');
    return;
  }

  let staleRows = '';
  for (let i = 0; i < stale.length; i++) {
    const s = stale[i];
    staleRows += '<tr>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2"><strong>' + _htmlEscape(s.label) + '</strong></td>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2">' + _htmlEscape(s.lastSeen) + '</td>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2;color:#b54f2c"><strong>' + _htmlEscape(String(s.ageHours)) + ' h</strong> (SLO ' + s.maxAgeHours + ' h)</td>'
      + '</tr>';
  }
  let freshRows = '';
  for (let i = 0; i < fresh.length; i++) {
    const f = fresh[i];
    freshRows += '<tr>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2">' + _htmlEscape(f.label) + '</td>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2">' + _htmlEscape(f.lastSeen) + '</td>'
      + '<td style="padding:0.4rem;border-bottom:1px solid #f0ebe2;color:#2C5F2E">' + _htmlEscape(String(f.ageHours)) + ' h</td>'
      + '</tr>';
  }

  const html = '<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.6">'
    + '<div style="max-width:680px;margin:0 auto;padding:1.5rem;background:#fff8f0;border:1px solid #d4a574;border-radius:10px">'
    + '<h2 style="color:#2C5F2E;margin-top:0">⚠️ Apps Script trigger(s) appear to have stalled</h2>'
    + '<p>The following Apps Script time-based triggers haven\'t fired within their expected windows:</p>'
    + '<table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left">'
    + '<th style="padding:0.4rem">Trigger</th><th style="padding:0.4rem">Last fired</th><th style="padding:0.4rem">Age</th></tr></thead>'
    + '<tbody>' + staleRows + '</tbody></table>'
    + (fresh.length ? ('<h3 style="color:#2C5F2E;margin:1.5rem 0 0.5rem">Triggers still healthy</h3>'
      + '<table style="width:100%;border-collapse:collapse"><tbody>' + freshRows + '</tbody></table>') : '')
    + '<h3 style="color:#2C5F2E">What to do</h3>'
    + '<ol>'
    + '<li>Open script.google.com → STW project → ⏰ <b>Triggers</b> (clock icon, left rail).</li>'
    + '<li>Confirm each trigger above is listed and shows a recent <b>Last run</b>.</li>'
    + '<li>If a trigger is missing, run <code>installAllTimeTriggers</code> from the function dropdown to reinstall.</li>'
    + '<li>If a trigger is listed but failing, click it for the error log. Most common cause: token expired or external service down.</li>'
    + '</ol>'
    + '<p style="color:#666;font-size:0.9rem;font-style:italic;margin-top:2rem">Daily Apps Script self-heartbeat. Symmetric with the GitHub workflow health check.</p>'
    + '</div></body></html>';

  try {
    MailApp.sendEmail({
      to: TEAM_INBOX,
      subject: '[STW Apps Script] ' + stale.length + ' trigger(s) stalled',
      htmlBody: html,
      body: stale.length + ' Apps Script trigger(s) stalled: ' + stale.map(function (s) { return s.label + ' (' + s.ageHours + 'h)'; }).join(', '),
      name: 'Seed the Word Apps Script Heartbeat',
      noReply: true,
    });
    console.log('dailyAppsScriptHealthCheck: alert dispatched for ' + stale.length + ' stale trigger(s).');
  } catch (err) {
    console.log('dailyAppsScriptHealthCheck: send failed: ' + err);
  }
}
