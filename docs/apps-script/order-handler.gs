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
const SITE_URL = 'https://seedtheword.org/';

// ── Display labels for human-readable emails / Sheet rows ───────
const BUNDLE_DISPLAY = {
  essentials: 'Essentials Welcome',
  lifegroup: 'Life Group Starter',
  ministry: 'Ministry Calling',
  custom: 'Custom Order',
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

// ── Prayer Request Intake — constants (spec: prayer-request-intake) ──
//
// The prayer-intake action lives on this same web app. It appends
// audit rows to the Prayers tab on the existing ministry Sheet,
// relays each Submission into the @seedtheword Prayer & Thanksgiving
// topic (thread 21) using the website-submission marker recognized
// by the weekly-prayer-digest spec, and (when the submitter shared
// an email and dripEnabled is true) sends a Day 0 confirmation
// inline + enqueues Days 3, 7, 14 in the PrayerDrip tab. A separate
// every-30-min time-based trigger fires the pending drip rows.
//
// See .kiro/specs/prayer-request-intake/design.md §3, §4.
const MINISTRY_SHEET_ID = LEDGER_SHEET_ID;
const PRAYERS_TAB = 'Prayers';
const DRIP_LOG_TAB = 'PrayerDrip';
const PRAYER_TOPIC_THREAD_ID = 21;

// Script Property keys (the secrets themselves live in Script Properties).
const TELEGRAM_PRAYER_BOT_TOKEN_KEY = 'TELEGRAM_PRAYER_BOT_TOKEN';
const PRAYER_INTAKE_UNSUBSCRIBE_SECRET_KEY = 'PRAYER_INTAKE_UNSUBSCRIBE_SECRET';

// CacheService keys for the JSON files we fetch from the deployed site.
const VERSES_CACHE_KEY = 'prayer-intake:verses-v1';
const TEMPLATES_CACHE_KEY = 'prayer-intake:templates-v1';
const CACHE_SECONDS = 6 * 60 * 60; // 6 hours

// Telegram absolute message-length cap (Telegram's own is 4096; we leave
// 6 chars of headroom for the trailing ellipsis insertion path).
const TELEGRAM_MAX_CHARS = 4090;

// Prayers tab column order — also the schema for the operator who creates
// the tab manually (see admin-help.html "Prayer Request Intake" → setup).
const PRAYERS_HEADERS = [
  'submission_id', 'received_at', 'kind', 'submitter_name', 'submitter_email', 'anonymous',
  'body', 'telegram_status', 'telegram_message_id', 'telegram_error',
  'drip_status', 'unsubscribe_token', 'client_ip_hash', 'verses_json',
];

// PrayerDrip tab column order.
const PRAYER_DRIP_HEADERS = [
  'submission_id', 'drip_day', 'status', 'timestamp', 'error', 'unsubscribed',
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
  if ((payload && payload.action) === 'prayer-intake') {
    return handlePrayerIntake_(payload, e && e.parameter);
  }
  if ((payload && payload.action) === 'donateBible') {
    return handleBibleDonate_(payload, e && e.parameter);
  }
  if ((payload && payload.action) === 'requestBible') {
    return handleBibleRequest_(payload, e && e.parameter);
  }
  if ((payload && payload.action) === 'walkLinkRequest') {
    return handleWalkLinkRequest_(payload);
  }
  if ((payload && payload.action) === 'walkStamp') {
    return handleWalkStamp_(payload);
  }
  if ((payload && payload.action) === 'walkSync') {
    return handleWalkSync_(payload);
  }
  if ((payload && payload.action) === 'walkRevoke') {
    return handleWalkRevoke_(payload);
  }
  if ((payload && payload.action) === 'inventory-log') {
    return handleInventoryLog_(payload);
  }
  if ((payload && payload.action) === 'volunteer-application') {
    return handleVolunteerApplication_(payload);
  }
  if ((payload && payload.action) === 'rsvp') {
    return handleRsvp_(payload);
  }
  if ((payload && payload.action) === 'fieldLog') {
    return handleFieldLog_(payload);
  }
  if ((payload && payload.action) === 'fieldPlacement') {
    return handleFieldPlacement_(payload);
  }
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

// ── Prayer Intake — pure helpers (mechanically pasted from
//    docs/apps-script/prayer-intake-helpers.js — keep in sync).
//    None of these touch UrlFetchApp / SpreadsheetApp / MailApp;
//    anything I/O-bound lives further down in this file.
//
//    Spec: .kiro/specs/prayer-request-intake/design.md §4.7,
//          §4.8, §4.9, §8.3, §8.4, §10.3, §4.13.

function isLikelyEmail_(s) {
  if (typeof s !== 'string') return false;
  var t = s.trim();
  if (!t) return false;
  if (t.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function stripHtmlAndNormalize_(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}

function mdv2Escape_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function buildTelegramMessage_(args) {
  var verb = (args.kind === 'thanksgiving')
    ? 'New thanksgiving announcement'
    : 'New prayer request';

  var nameSegment = args.anonymous
    ? 'Anonymous'
    : mdv2Escape_(args.submitterName);
  var bodySegment = mdv2Escape_(args.body);
  // Marker MUST be MarkdownV2-escaped — `(` and `)` are reserved for
  // link syntax. Telegram strips the backslashes during render so the
  // digest's Poller still reads "(via the website)" via getUpdates.
  var marker = mdv2Escape_(args.marker);

  var message = '\uD83D\uDC8C ' + verb + ' from ' + nameSegment + ' ' + marker + ': ' + bodySegment;
  if (message.length <= TELEGRAM_MAX_CHARS) {
    return { text: message, truncated: false };
  }
  var prefix = '\uD83D\uDC8C ' + verb + ' from ' + nameSegment + ' ' + marker + ': ';
  var allowedBody = TELEGRAM_MAX_CHARS - prefix.length - 1;
  var truncatedBody = bodySegment.slice(0, Math.max(0, allowedBody)) + '\u2026';
  return { text: prefix + truncatedBody, truncated: true };
}

function computeDripStatus_(v, cfg) {
  if (!cfg || cfg.dripEnabled !== true) return 'disabled-by-config';
  if (!v || !v.email)                   return 'suppressed-no-email';
  return 'enabled';
}

function salutation(row) {
  if (row && row.anonymous === true) return 'Friend';
  var name = String((row && row.submitter_name) || '').trim();
  if (!name) return 'Friend';
  return name.split(/\s+/)[0];
}

function hashCodeFromString_(s) {
  var h = 0;
  var str = String(s == null ? '' : s);
  for (var i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function pickVersesForSubmission_(submissionId, dripDays, verses) {
  if (!Array.isArray(verses) || verses.length === 0) return [];
  var days = Array.isArray(dripDays) ? dripDays : [];
  var seed = hashCodeFromString_(submissionId);
  return days.map(function (_day, idx) {
    return verses[(seed + idx) % verses.length];
  });
}

function parseDripTemplatesPicks_(submissionId, templates) {
  var t = templates || {};
  var seed = hashCodeFromString_(submissionId);

  var pick = function (pool, offset) {
    if (!Array.isArray(pool) || pool.length === 0) return '';
    return String(pool[(seed + offset) % pool.length] || '');
  };

  var inviteA = String(t.day14_invitation_a || '');
  var inviteB = String(t.day14_invitation_b || '');
  var inviteVariant = (seed + 3) % 2;
  var day14_invitation = inviteVariant === 0
    ? (inviteA || inviteB)
    : (inviteB || inviteA);

  return {
    day3_reflection: pick(t.day3_reflections, 1),
    day3_tip:        pick(t.day3_tips, 1),
    day7_reflection: pick(t.day7_reflections, 2),
    day14_invitation: day14_invitation,
  };
}

/**
 * Normalizes a flat-format order payload (from the bundle-builder frontend)
 * into the nested format expected by validatePayload/appendLedgerRow/sendEmails.
 *
 * Frontend sends:  { bundle: 'custom', gifter_name, gifter_email, gifter_phone,
 *                    delivery_details, configuration, dedication, ... }
 * Backend expects: { bundle: 'essentials'|...|'custom', gifter: { name, email,
 *                    phone, deliveryDetails, dedication }, configText, ... }
 *
 * If the payload already has a nested gifter object, returns it unchanged.
 */
function normalizeOrderPayload_(p) {
  if (!p || typeof p !== 'object') return p;
  // Already in nested format — pass through
  if (p.gifter && typeof p.gifter === 'object' && p.gifter.name) return p;

  // Flat → nested conversion
  var normalized = {};
  for (var key in p) { normalized[key] = p[key]; }

  normalized.gifter = {
    name: p.gifter_name || p.name || '',
    email: p.gifter_email || p.email || '',
    phone: p.gifter_phone || p.phone || '',
    deliveryDetails: p.delivery_details || p.address || '',
    dedication: p.dedication || '',
  };

  // configText is what appendLedgerRow writes to the Sheet
  if (!normalized.configText && p.configuration) {
    normalized.configText = p.configuration;
  }

  // Bundle: accept 'custom' as valid (the builder doesn't use the old tier system)
  if (!normalized.bundle) normalized.bundle = 'custom';

  return normalized;
}

// ── Order handler (existing flow, unchanged) ────────────────────
function handleOrder(payload) {
  // Normalize flat-format payloads from the bundle-builder frontend
  // into the nested format the rest of the order pipeline expects.
  payload = normalizeOrderPayload_(payload);

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
  if (['essentials', 'lifegroup', 'ministry', 'custom'].indexOf(p.bundle) === -1) {
    return { ok: false, reason: 'bad-bundle' };
  }
  if (!p.gifter || typeof p.gifter !== 'object') return { ok: false, reason: 'no-gifter' };
  if (typeof p.gifter.name !== 'string' || !p.gifter.name.trim()) return { ok: false, reason: 'no-name' };
  if (typeof p.gifter.email !== 'string' || p.gifter.email.indexOf('@') === -1) return { ok: false, reason: 'bad-email' };
  if (typeof p.gifter.deliveryDetails !== 'string') return { ok: false, reason: 'no-delivery' };
  // Empty delivery is allowed for ministry; required for the others.
  if (p.bundle !== 'ministry' && p.bundle !== 'custom' && !p.gifter.deliveryDetails.trim()) {
    return { ok: false, reason: 'empty-delivery' };
  }
  if (typeof p.configText !== 'string' || !p.configText.trim()) {
    return { ok: false, reason: 'no-config-text' };
  }
  if (p.bundle === 'ministry' || p.bundle === 'custom') {
    if (p.bundle === 'ministry' && p.giftee !== null && p.giftee !== undefined) {
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
  const subjectLabel = c.subject || 'General Inquiry';
  const receivedAt = formatHumanTimestamp(new Date());

  let body = '';

  // Metadata bar — type badge + timestamp on separate lines for clarity
  body += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 28px;">' +
    '<tr>' +
      '<td style="padding-bottom:10px;">' +
        '<span style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Contact Form</span>' +
        '&nbsp;&nbsp;' +
        '<span style="display:inline-block;background:' + STW_GOLD + ';color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:0.04em;">' + escapeHtml(subjectLabel) + '</span>' +
      '</td>' +
    '</tr>' +
    '<tr>' +
      '<td style="font-size:12.5px;color:' + STW_MUTED + ';">Received: ' + escapeHtml(receivedAt) + '</td>' +
    '</tr>' +
  '</table>';

  // Sender details — generous row padding, clear visual separation
  body += emailSection('Sender',
    '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
      '<tr><td style="padding:8px 18px 8px 0;color:' + STW_MUTED + ';font-size:13px;font-weight:700;width:90px;vertical-align:top;">Name</td>' +
        '<td style="padding:8px 0;font-size:15px;font-weight:700;color:' + STW_TEXT + ';vertical-align:top;">' + escapeHtml(c.name) + '</td></tr>' +
      '<tr style="border-top:1px solid ' + STW_BORDER + ';">' +
        '<td style="padding:8px 18px 8px 0;color:' + STW_MUTED + ';font-size:13px;font-weight:700;vertical-align:top;">Email</td>' +
        '<td style="padding:8px 0;font-size:14px;vertical-align:top;"><a href="mailto:' + escapeHtml(c.email) + '" style="color:' + STW_GREEN + ';font-weight:600;">' + escapeHtml(c.email) + '</a></td></tr>' +
      '<tr style="border-top:1px solid ' + STW_BORDER + ';">' +
        '<td style="padding:8px 18px 8px 0;color:' + STW_MUTED + ';font-size:13px;font-weight:700;vertical-align:top;">Subject</td>' +
        '<td style="padding:8px 0;font-size:14px;color:' + STW_TEXT + ';vertical-align:top;">' + (c.subject ? escapeHtml(c.subject) : '<span style="color:' + STW_MUTED + ';font-style:italic;">(none)</span>') + '</td></tr>' +
    '</table>',
    { accent: STW_GREEN });

  // Message body — generous padding, larger font, cream background
  body += emailSection('Message',
    '<div style="background-color:' + STW_CREAM + ';border-radius:8px;padding:20px 24px;">' +
      '<div style="font-size:16px;line-height:1.75;color:' + STW_TEXT + ';white-space:pre-wrap;">' + escapeHtml(c.message) + '</div>' +
    '</div>',
    { accent: STW_GOLD });

  // Reply nudge
  body += '<div style="margin:24px 0 0;padding:16px 20px;background:#f0f7f0;border-radius:8px;border-left:4px solid ' + STW_GREEN + ';">' +
    '<p style="margin:0;font-size:13px;color:#2b2b2b;line-height:1.6;">' +
      '<strong>Reply directly</strong> &mdash; this email\'s Reply-To is set to the sender\'s address. A confirmation email has also been sent to them.' +
    '</p>' +
  '</div>';

  // Plain-text body
  const plainLines = [
    'New contact form message',
    '========================',
    '',
    'Name:    ' + c.name,
    'Email:   ' + c.email,
    'Subject: ' + (c.subject || '(none)'),
    'Sent:    ' + receivedAt,
    '',
    'MESSAGE',
    '-------',
    c.message,
    '',
    'Reply directly — this email\'s Reply-To is the sender.',
    'A confirmation has also been sent to them.',
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

// ── Ministry Stats ─────────────────────────────────────────────
//
// Reads the MinistryStats tab from the Order Ledger spreadsheet and
// returns a JSON object with:
//   - total: number of Bibles given away (manual entry by team)
//   - goal: 2026 goal
//   - languagesMessage: e.g. "Available in 2,000+ languages"
//   - inStock: array of { language, count, format }
//   - lastUpdated: ISO timestamp of last edit
//
// Tab format (MinistryStats tab):
//   Row 1: Headers [key, value, note]
//   Row 2: total | 383 | Total Bibles given away (all-time)
//   Row 3: goal | 70000 | 2026 annual goal
//   Row 4: languagesMessage | Available in 2,000+ languages... | ...
//   Row 5+: stock rows with key="stock", value=JSON string of:
//     { language, count, format, in_storage, on_hand, donated_total }
//     where:
//       count         = total available right now (in_storage + on_hand)
//       in_storage    = physically in boxes/storage location
//       on_hand       = with team members, ready to distribute at events
//       donated_total = cumulative given away for this language
//   Row N+: item rows with key="item", value=JSON string of:
//     { id, name, count, language, format, in_storage, on_hand, donated_total }
//
// Falls back to site-config.json values if the sheet is unavailable.
const MINISTRY_STATS_TAB = 'MinistryStats';

const INVENTORY_TAB = 'Inventory';
const INVENTORY_HEADERS = [
  'date', 'type', 'item_id', 'item_name', 'qty', 'direction',
  'event_source', 'cost_per_unit', 'total_cost', 'notes', 'order_id'
];

/**
 * Logs an inventory movement (in or out) to the Inventory tab.
 * Called when orders are packed/shipped, or manually via the sheet.
 */
function logInventoryMovement_(entries) {
  // entries = [{ itemId, itemName, qty, direction, eventSource, costPerUnit, notes, orderId }]
  if (!entries || !entries.length) return;
  try {
    var sheet = openTab(INVENTORY_TAB, INVENTORY_HEADERS);
    var now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    var rows = entries.map(function(e) {
      var totalCost = (e.costPerUnit || 2) * (e.qty || 0);
      return [
        now,
        e.type || 'order',
        e.itemId || '',
        e.itemName || '',
        e.qty || 0,
        e.direction || 'out',
        e.eventSource || '',
        e.costPerUnit || 2,
        totalCost,
        e.notes || '',
        e.orderId || ''
      ];
    });
    rows.forEach(function(row) {
      sheet.appendRow(row);
    });
  } catch (err) {
    console.log('logInventoryMovement_ error (non-fatal):', err);
  }
}

/**
 * Parses an order's configuration text to extract item IDs and quantities
 * for inventory logging. The configText typically looks like:
 *   "2× Pocket NT Red (pocket-nt-red)\n1× Hindi NT (pocket-nt-hindi-blue)"
 * or JSON-like: [{"id":"pocket-nt-red","qty":2},...]
 *
 * Returns an array of entry objects for logInventoryMovement_.
 */
function parseOrderConfigForInventory_(configText, orderId) {
  var entries = [];
  if (!configText) return entries;

  // Try JSON parse first (newer order format may embed structured data).
  try {
    var parsed = JSON.parse(configText);
    if (Array.isArray(parsed)) {
      for (var i = 0; i < parsed.length; i++) {
        var item = parsed[i];
        if (item && item.id) {
          entries.push({
            type: 'order',
            itemId: item.id,
            itemName: item.name || item.id,
            qty: parseInt(item.qty, 10) || parseInt(item.count, 10) || 1,
            direction: 'out',
            eventSource: 'Web Order',
            costPerUnit: item.price || 2,
            notes: '',
            orderId: orderId,
          });
        }
      }
      return entries;
    }
  } catch (_) {
    // Not JSON — fall through to text parsing.
  }

  // Text parsing: look for lines like "2× Item Name (item-id)" or "Item Name ×2"
  var lines = configText.split(/\n/);
  for (var j = 0; j < lines.length; j++) {
    var line = lines[j].trim();
    if (!line) continue;

    // Pattern: "N× Name (id)" or "N x Name (id)"
    var match = line.match(/^(\d+)\s*[×x]\s*(.+?)\s*\(([a-z0-9\-]+)\)/i);
    if (match) {
      entries.push({
        type: 'order',
        itemId: match[3],
        itemName: match[2].trim(),
        qty: parseInt(match[1], 10) || 1,
        direction: 'out',
        eventSource: 'Web Order',
        costPerUnit: 2,
        notes: '',
        orderId: orderId,
      });
      continue;
    }

    // Pattern: "Name (id) ×N" or "Name (id) x N"
    var match2 = line.match(/^(.+?)\s*\(([a-z0-9\-]+)\)\s*[×x]\s*(\d+)/i);
    if (match2) {
      entries.push({
        type: 'order',
        itemId: match2[2],
        itemName: match2[1].trim(),
        qty: parseInt(match2[3], 10) || 1,
        direction: 'out',
        eventSource: 'Web Order',
        costPerUnit: 2,
        notes: '',
        orderId: orderId,
      });
      continue;
    }

    // Pattern: just "(item-id)" somewhere in the line — assume qty 1
    var match3 = line.match(/\(([a-z0-9\-]+)\)/i);
    if (match3) {
      entries.push({
        type: 'order',
        itemId: match3[1],
        itemName: line.replace(/\([^)]+\)/, '').replace(/^\d+\s*[×x]\s*/, '').trim(),
        qty: 1,
        direction: 'out',
        eventSource: 'Web Order',
        costPerUnit: 2,
        notes: '',
        orderId: orderId,
      });
    }
  }

  return entries;
}

/**
 * POST action: inventory-log
 * Allows admin to log field giveaways, restocks, and other inventory
 * movements via the Apps Script endpoint.
 *
 * Payload shape:
 *   { action: "inventory-log", entries: [
 *       { itemId, itemName, qty, direction, type, eventSource, costPerUnit, notes }
 *   ]}
 *
 * Used by admin forms or CLI scripts to record:
 * - outreach giveaways (direction: "out", type: "outreach")
 * - restocks from Gideons/suppliers (direction: "in", type: "restock")
 * - adjustments/corrections (direction: "in" or "out", type: "adjustment")
 */
function handleInventoryLog_(payload) {
  var entries = payload && payload.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return jsonResponse({ ok: false, error: 'no-entries' });
  }
  // Validate each entry
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || !e.itemId) {
      return jsonResponse({ ok: false, error: 'entry-' + i + '-missing-itemId' });
    }
    if (!e.qty || e.qty <= 0) {
      return jsonResponse({ ok: false, error: 'entry-' + i + '-invalid-qty' });
    }
    if (['in', 'out'].indexOf(e.direction) === -1) {
      return jsonResponse({ ok: false, error: 'entry-' + i + '-invalid-direction' });
    }
  }
  try {
    logInventoryMovement_(entries.map(function(e) {
      return {
        type: e.type || 'outreach',
        itemId: e.itemId,
        itemName: e.itemName || e.itemId,
        qty: e.qty,
        direction: e.direction,
        eventSource: e.eventSource || '',
        costPerUnit: e.costPerUnit || 2,
        notes: e.notes || '',
        orderId: e.orderId || '',
      };
    }));
    return jsonResponse({ ok: true, logged: entries.length, route: 'inventory-log' });
  } catch (err) {
    console.log('handleInventoryLog_ error:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }
}

/**
 * POST action: volunteer-application
 * Receives volunteer applications from join.html and emails them to the team.
 *
 * Payload shape:
 *   { action: "volunteer-application", role, name, email, phone, city,
 *     motivation, experience, availability }
 */
function handleVolunteerApplication_(payload) {
  var role = String(payload.role || '').trim();
  var name = String(payload.name || '').trim();
  var email = String(payload.email || '').trim();
  var phone = String(payload.phone || '').trim();
  var city = String(payload.city || '').trim();
  var motivation = String(payload.motivation || '').trim();
  var experience = String(payload.experience || '').trim();
  var availability = String(payload.availability || '').trim();

  if (!name || !email || !role) {
    return jsonResponse({ ok: false, error: 'missing-required-fields' });
  }

  try {
    // Upload resume to Google Drive if provided
    var resumeLink = '';
    if (payload.resume && payload.resume.data && payload.resume.name) {
      try {
        var folder;
        var folders = DriveApp.getFoldersByName('Volunteer Applications');
        if (folders.hasNext()) {
          folder = folders.next();
        } else {
          folder = DriveApp.createFolder('Volunteer Applications');
        }
        var fileName = name.replace(/[^a-zA-Z0-9 ]/g, '') + ' - ' + role + ' - ' + payload.resume.name;
        var blob = Utilities.newBlob(
          Utilities.base64Decode(payload.resume.data),
          payload.resume.type || 'application/pdf',
          fileName
        );
        var file = folder.createFile(blob);
        resumeLink = file.getUrl();
      } catch (driveErr) {
        console.log('Resume upload failed (non-fatal):', driveErr);
        resumeLink = '(upload failed)';
      }
    }

    // ── Team notification email (modern branded design) ──
    var teamSubject = '\uD83D\uDE4B Volunteer Application \u2014 ' + role + ' \u2014 ' + name;
    
    var teamHtml = '' +
      // Top color band
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
        '<tr><td style="height:6px;background:linear-gradient(90deg,' + STW_GREEN + ',' + STW_GOLD + ');font-size:0;line-height:0;">&nbsp;</td></tr>' +
      '</table>' +
      // Header
      '<div style="background:' + STW_GREEN + ';padding:28px 36px;text-align:center;">' +
        '<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:0.02em;">New Volunteer Application</h1>' +
        '<p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Submitted via seedtheword.org/join.html</p>' +
      '</div>' +
      // Body
      '<div style="padding:32px 36px;background:#fff;">' +
        // Role badge
        '<div style="text-align:center;margin-bottom:24px;">' +
          '<span style="display:inline-block;background:' + STW_CREAM + ';border:1.5px solid ' + STW_GOLD + ';border-radius:20px;padding:8px 20px;font-size:14px;font-weight:700;color:' + STW_GREEN + ';">' + escapeHtml(role) + '</span>' +
        '</div>' +
        // Info table
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;border:1px solid ' + STW_BORDER + ';border-radius:8px;overflow:hidden;">' +
          '<tr><td style="padding:12px 16px;font-weight:600;color:' + STW_GREEN + ';width:120px;font-size:13px;background:' + STW_CREAM + ';">Name</td><td style="padding:12px 16px;font-size:14px;color:' + STW_TEXT + ';">' + escapeHtml(name) + '</td></tr>' +
          '<tr><td style="padding:12px 16px;font-weight:600;color:' + STW_GREEN + ';font-size:13px;">Email</td><td style="padding:12px 16px;font-size:14px;"><a href="mailto:' + escapeHtml(email) + '" style="color:' + STW_GREEN + ';">' + escapeHtml(email) + '</a></td></tr>' +
          '<tr><td style="padding:12px 16px;font-weight:600;color:' + STW_GREEN + ';font-size:13px;background:' + STW_CREAM + ';">Phone</td><td style="padding:12px 16px;font-size:14px;background:' + STW_CREAM + ';">' + escapeHtml(phone || 'Not provided') + '</td></tr>' +
          '<tr><td style="padding:12px 16px;font-weight:600;color:' + STW_GREEN + ';font-size:13px;">City</td><td style="padding:12px 16px;font-size:14px;">' + escapeHtml(city || 'Not provided') + '</td></tr>' +
          '<tr><td style="padding:12px 16px;font-weight:600;color:' + STW_GREEN + ';font-size:13px;background:' + STW_CREAM + ';">Availability</td><td style="padding:12px 16px;font-size:14px;background:' + STW_CREAM + ';">' + escapeHtml(availability || 'Not specified') + '</td></tr>' +
          (resumeLink ? '<tr><td style="padding:12px 16px;font-weight:600;color:' + STW_GREEN + ';font-size:13px;">Resume</td><td style="padding:12px 16px;font-size:14px;"><a href="' + escapeHtml(resumeLink) + '" style="color:' + STW_GREEN + ';font-weight:600;">View on Google Drive \u2192</a></td></tr>' : '') +
        '</table>' +
        // Sections
        '<div style="margin-top:24px;padding:16px 20px;background:' + STW_CREAM + ';border-radius:8px;border-left:4px solid ' + STW_GOLD + ';">' +
          '<h3 style="margin:0 0 8px;color:' + STW_GREEN + ';font-size:14px;">Why they want to serve</h3>' +
          '<p style="margin:0;font-size:14px;line-height:1.6;color:' + STW_TEXT + ';">' + escapeHtml(motivation || 'Not provided').replace(/\n/g, '<br>') + '</p>' +
        '</div>' +
        '<div style="margin-top:16px;padding:16px 20px;background:#f8f9fa;border-radius:8px;border-left:4px solid ' + STW_GREEN + ';">' +
          '<h3 style="margin:0 0 8px;color:' + STW_GREEN + ';font-size:14px;">Relevant experience</h3>' +
          '<p style="margin:0;font-size:14px;line-height:1.6;color:' + STW_TEXT + ';">' + escapeHtml(experience || 'Not provided').replace(/\n/g, '<br>') + '</p>' +
        '</div>' +
        // Action button
        '<div style="text-align:center;margin-top:28px;">' +
          '<a href="mailto:' + escapeHtml(email) + '?subject=Re: Your Volunteer Application - ' + escapeHtml(role) + '" style="display:inline-block;background:' + STW_GREEN + ';color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Reply to Applicant</a>' +
        '</div>' +
      '</div>' +
      // Footer
      '<div style="padding:20px 36px;background:#f8f9fa;text-align:center;border-top:1px solid ' + STW_BORDER + ';">' +
        '<p style="margin:0;font-size:12px;color:' + STW_MUTED + ';">Seed the Word Ministry \u2022 seedtheword.org \u2022 WA Nonprofit (UBI 606 261 509)</p>' +
      '</div>';

    var teamBody = 'New volunteer application:\nRole: ' + role + '\nName: ' + name + '\nEmail: ' + email + '\nPhone: ' + (phone || 'N/A') + '\nCity: ' + (city || 'N/A') + '\nMotivation: ' + motivation + '\nExperience: ' + experience + '\nAvailability: ' + availability + (resumeLink ? '\nResume: ' + resumeLink : '');

    MailApp.sendEmail({
      to: TEAM_INBOX,
      subject: teamSubject,
      body: teamBody,
      htmlBody: teamHtml,
      replyTo: email,
      name: 'STW Volunteer Bot',
    });

    // ── Applicant confirmation email ──
    var applicantHtml = '' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
        '<tr><td style="height:6px;background:linear-gradient(90deg,' + STW_GREEN + ',' + STW_GOLD + ');font-size:0;line-height:0;">&nbsp;</td></tr>' +
      '</table>' +
      '<div style="background:' + STW_GREEN + ';padding:28px 36px;text-align:center;">' +
        '<h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Application Received!</h1>' +
        '<p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Seed the Word Ministry</p>' +
      '</div>' +
      '<div style="padding:32px 36px;background:#fff;">' +
        '<p style="font-size:15px;color:' + STW_TEXT + ';line-height:1.7;margin:0 0 16px;">Hi ' + escapeHtml(name.split(' ')[0]) + ',</p>' +
        '<p style="font-size:15px;color:' + STW_TEXT + ';line-height:1.7;margin:0 0 16px;">Thank you for applying to serve as <strong>' + escapeHtml(role) + '</strong> with Seed the Word Ministry! We\u2019ve received your application and our leadership team will review it shortly.</p>' +
        '<p style="font-size:15px;color:' + STW_TEXT + ';line-height:1.7;margin:0 0 16px;"><strong>What happens next:</strong></p>' +
        '<ol style="font-size:14px;color:' + STW_TEXT + ';line-height:2;padding-left:20px;margin:0 0 20px;">' +
          '<li>Our team reviews your application (typically within a few days)</li>' +
          '<li>We\u2019ll reach out to schedule an interview</li>' +
          '<li>After the interview, we pray over and formally onboard approved volunteers</li>' +
        '</ol>' +
        '<p style="font-size:15px;color:' + STW_TEXT + ';line-height:1.7;margin:0 0 16px;">In the meantime, feel free to check out our <a href="' + SITE_URL + 'community.html" style="color:' + STW_GREEN + ';font-weight:600;">community page</a> or join us on <a href="https://t.me/seedtheword" style="color:' + STW_GREEN + ';font-weight:600;">Telegram</a>.</p>' +
        '<p style="font-size:15px;color:' + STW_TEXT + ';line-height:1.7;margin:24px 0 0;">God bless,<br><strong style="color:' + STW_GREEN + ';">The Seed the Word Team</strong></p>' +
      '</div>' +
      '<div style="padding:20px 36px;background:#f8f9fa;text-align:center;border-top:1px solid ' + STW_BORDER + ';">' +
        '<p style="margin:0;font-size:12px;color:' + STW_MUTED + ';">Seed the Word Ministry \u2022 seedtheword.org \u2022 WA Nonprofit (UBI 606 261 509)</p>' +
      '</div>';

    MailApp.sendEmail({
      to: email,
      subject: 'We received your application \u2014 Seed the Word Ministry',
      body: 'Hi ' + name.split(' ')[0] + ', thank you for applying to serve as ' + role + ' with Seed the Word Ministry! We\'ve received your application and our leadership team will review it shortly. We\'ll be in touch to schedule an interview. God bless, The Seed the Word Team',
      htmlBody: applicantHtml,
      noReply: true,
      name: 'Seed the Word Ministry',
    });

    // ── SMS confirmation (if phone provided) ──
    if (phone) {
      try {
        // Normalize phone to digits only
        var digits = phone.replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits; // US prefix
        if (digits.length === 11 && digits.charAt(0) === '1') {
          // Try common US carriers — best-effort, not guaranteed
          var smsGateways = [
            digits + '@vtext.com',       // Verizon
            digits + '@txt.att.net',     // AT&T
            digits + '@tmomail.net',     // T-Mobile
            digits + '@messaging.sprintpcs.com', // Sprint
          ];
          // We only try the first gateway (Verizon) for cost/simplicity
          // TODO: detect carrier or let user select
          var smsBody = 'Seed the Word: Hi ' + name.split(' ')[0] + '! We received your volunteer application for ' + role + '. Our team will be in touch soon. God bless!';
          MailApp.sendEmail({
            to: smsGateways[0],
            subject: '',
            body: smsBody.slice(0, 140),
            noReply: true,
          });
        }
      } catch (smsErr) {
        console.log('SMS confirmation failed (non-fatal):', smsErr);
      }
    }

    return jsonResponse({ ok: true, route: 'volunteer-application' });
  } catch (err) {
    console.log('handleVolunteerApplication_ error:', err);
    return jsonResponse({ ok: false, error: 'mail-send-failed' });
  }
}

// ── RSVP handler ─────────────────────────────────────────────────
// Writes to the "RSVP" tab of the STW Order Ledger spreadsheet.
// Payload: { action:'rsvp', name, email?, date, phone?, notes? }
const RSVP_TAB = 'RSVP';
const RSVP_HEADERS = ['submitted_at', 'name', 'email', 'date', 'phone', 'notes', 'event'];

function handleRsvp_(payload) {
  var name = String(payload.name || '').trim();
  var email = String(payload.email || '').trim();
  var date = String(payload.date || '').trim();
  var phone = String(payload.phone || '').trim();
  var notes = String(payload.notes || '').trim();
  var event = String(payload.event || 'Young Adults Service — Mondays').trim();

  if (!name) return jsonResponse({ ok: false, error: 'name-required' });
  if (!date) return jsonResponse({ ok: false, error: 'date-required' });

  try {
    var sheet = openTab(RSVP_TAB, RSVP_HEADERS);
    sheet.appendRow([new Date(), name, email, date, phone, notes, event]);
  } catch (err) {
    console.log('handleRsvp_ sheet write error:', err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  // Team notification email
  try {
    var subject = '📅 RSVP: ' + name + ' — ' + event + ' on ' + date;
    var bodyHtml = '' +
      '<p>A new RSVP just came in for <strong>' + escapeHtml(event) + '</strong>.</p>' +
      '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;">' +
        '<tr><td><strong>Name</strong></td><td>' + escapeHtml(name) + '</td></tr>' +
        (email ? '<tr><td><strong>Email</strong></td><td>' + escapeHtml(email) + '</td></tr>' : '') +
        '<tr><td><strong>Date</strong></td><td>' + escapeHtml(date) + '</td></tr>' +
        (phone ? '<tr><td><strong>Phone</strong></td><td>' + escapeHtml(phone) + '</td></tr>' : '') +
        (notes ? '<tr><td><strong>Notes</strong></td><td>' + escapeHtml(notes) + '</td></tr>' : '') +
        '<tr><td><strong>Submitted</strong></td><td>' + new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) + '</td></tr>' +
      '</table>';
    MailApp.sendEmail({
      to: TEAM_INBOX,
      subject: subject,
      htmlBody: emailShell({ headerTitle: 'New RSVP', headerSubtitle: '📅', bodyHtml: bodyHtml, footerHtml: '<p>— Seed the Word website</p>' })
    });
  } catch (err) {
    console.log('handleRsvp_ team email error (non-fatal):', err);
  }

  // Confirmation email to visitor
  if (email) {
    try {
      MailApp.sendEmail({
        to: email,
        subject: '\u2705 RSVP confirmed \u2014 Seed the Word Young Adults',
        htmlBody: emailShell({
          headerTitle: "You're on the list!",
          headerSubtitle: '\ud83d\udcc5',
          bodyHtml: '<p>Hi ' + escapeHtml(name) + ',</p>' +
            '<p>We got your RSVP for <strong>' + escapeHtml(event) + '</strong> on <strong>' + escapeHtml(date) + '</strong>. We\'re excited to see you!</p>' +
            '<p>We\'ll be in touch with any updates as we prepare to launch. In the meantime, join us on Telegram to stay connected:</p>' +
            '<p style="text-align:center;margin:1.5rem 0;"><a href="https://t.me/seedtheword" style="display:inline-block;padding:12px 24px;background:#2C5F2E;color:#fff;font-weight:700;text-decoration:none;border-radius:6px;">Join Telegram \u2192</a></p>' +
            '<p style="color:#666;font-size:0.88rem;">If anything changes, reply to this email and we\'ll update your RSVP.</p>',
          footerHtml: '<p>— The Seed the Word team</p>'
        })
      });
    } catch (err) {
      console.log('handleRsvp_ confirmation email error (non-fatal):', err);
    }
  }

  return jsonResponse({ ok: true, route: 'rsvp' });
}

// ── Field Log handler ─────────────────────────────────────────────
// Receives a POST from the mobile field-log admin page.
// Writes one row per scripture item to the Inventory tab with an
// auto-assigned INV-XXXX row_id, then emails a summary to the team.
//
// Payload: {
//   action: 'fieldLog',
//   date: 'YYYY-MM-DD',
//   event_source: string,
//   team_member: string,
//   items: [{ item_id, item_name, qty, direction, cost_per_unit?, notes? }],
//   passphrase_hash: string   // SHA-256(SALT + passphrase) verified server-side
// }
const FIELD_LOG_SALT          = 'stwm-2026-admin-gate';
const FIELD_LOG_EXPECTED_HASH = '2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440';

/**
 * Reads cost_per_unit for each item_id from the Lists tab.
 * Lists tab has NO header row:
 *   Column B (idx 1) = item_id
 *   Column E (idx 4) = cost_per_unit
 * Returns { costs: {item_id: number}, defaultCost: 2 }
 */
function getItemCostMapFromLedger_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName('Lists');
  var result = { costs: {}, defaultCost: 2 };
  if (!sheet || sheet.getLastRow() < 1) return result;
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    var itemId = String(data[i][1]||'').trim();  // Column B
    var cost   = parseFloat(data[i][4]);          // Column E
    if (itemId && !isNaN(cost) && cost >= 0) {
      result.costs[itemId] = cost;
    }
  }
  return result;
}

function handleFieldLog_(payload) {
  // 1. Verify passphrase hash
  var clientHash = String(payload.passphrase_hash || '').toLowerCase().trim();
  if (clientHash !== FIELD_LOG_EXPECTED_HASH) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  var items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return jsonResponse({ ok: false, error: 'no-items' });

  var date       = String(payload.date        || new Date().toISOString().split('T')[0]);
  var source     = String(payload.event_source || '').trim();
  var teamMember = String(payload.team_member  || '').trim();

  try {
    var ss    = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet) throw new Error('Inventory tab not found');

    // Find row_id column by header
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdColIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_]/g,'') === 'rowid') {
        rowIdColIdx = h + 1; // 1-based
        break;
      }
    }

    // Find current max INV number
    var maxNum = 0;
    if (rowIdColIdx > 0 && sheet.getLastRow() > 1) {
      sheet.getRange(2, rowIdColIdx, sheet.getLastRow() - 1, 1)
        .getValues().forEach(function(r) {
          var m = String(r[0]||'').match(/^INV-(\d+)$/);
          if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
        });
    }

    var addedRows = [];
    var costMap = getItemCostMapFromLedger_();
    items.forEach(function(item) {
      var qty       = parseInt(item.qty, 10)          || 0;
      var direction = String(item.direction || 'out').toLowerCase();
      var itemId    = String(item.item_id || '').trim();
      var costUnit  = (costMap.costs[itemId] !== undefined) ? costMap.costs[itemId] : (parseFloat(item.cost_per_unit) || costMap.defaultCost);
      var totalCost = qty * costUnit;
      var notes     = String(item.notes || teamMember || '').trim();

      maxNum++;
      var rowId = 'INV-' + String(maxNum).padStart(4, '0');

      // Base 11 columns matching Inventory schema
      var row = [
        date,
        'field-log',
        String(item.item_id   || '').trim(),
        String(item.item_name || '').trim(),
        qty,
        direction,
        source,
        costUnit,
        totalCost,
        notes,
        ''  // order_id — blank, not a placement record
      ];

      // Append row_id if column exists, otherwise pad and append
      if (rowIdColIdx > 0) {
        while (row.length < rowIdColIdx - 1) row.push('');
        row[rowIdColIdx - 1] = rowId;
      } else {
        row.push(rowId);
      }

      sheet.appendRow(row);
      addedRows.push(rowId + ': ' + item.item_name + ' x' + qty + ' (' + direction + ')');
    });

    // Email summary to team
    try {
      MailApp.sendEmail({
        to: TEAM_INBOX,
        subject: '\uD83D\uDCF1 Field Log: ' + source + ' (' + date + ')',
        body: 'Field log submitted by ' + (teamMember || 'field team') + ' on ' + date + '.\n\n' +
              'Event: ' + source + '\n' +
              'Items logged:\n' + addedRows.join('\n') + '\n\n' +
              'View in spreadsheet: https://docs.google.com/spreadsheets/d/' + LEDGER_SHEET_ID
      });
    } catch(emailErr) {
      console.log('handleFieldLog_ email failed (non-fatal):', emailErr);
    }

    return jsonResponse({ ok: true, route: 'fieldLog', added: addedRows.length, rows: addedRows });

  } catch(err) {
    console.log('handleFieldLog_ error:', err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}

// ── Field Placement handler ──────────────────────────────────────
// Called from admin/field-log.html "Placement Record" tab.
// Logs items to Inventory (direction=out) AND creates a PlacementRecord row.
// Payload: {
//   action: 'fieldPlacement',
//   passphrase_hash: string,
//   placement: { placementName, institution, address, official_name,
//                contact_phone, contact_email, num_rooms, date_placed,
//                team_member, event_source, notes },
//   items: [{ item_id, item_name, qty, direction, cost_per_unit }]
// }
function handleFieldPlacement_(payload) {
  var clientHash = String(payload.passphrase_hash || '').toLowerCase().trim();
  if (clientHash !== FIELD_LOG_EXPECTED_HASH) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  var items = Array.isArray(payload.items) ? payload.items : [];
  var pl    = payload.placement || {};
  if (!items.length) return jsonResponse({ ok: false, error: 'no-items' });

  var placementName = String(pl.placementName || '').trim();
  var institution   = String(pl.institution || '').trim();
  var datePlaced    = String(pl.date_placed || new Date().toISOString().split('T')[0]);
  var teamMember    = String(pl.team_member || '').trim();
  var source        = String(pl.event_source || institution || '').trim();

  if (!placementName) return jsonResponse({ ok: false, error: 'Placement Name is required' });
  if (!institution)   return jsonResponse({ ok: false, error: 'Institution is required' });

  try {
    var ss    = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName('Inventory');
    if (!sheet) throw new Error('Inventory tab not found');

    // Find row_id column
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowIdColIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g,'') === 'rowid') {
        rowIdColIdx = h + 1;
        break;
      }
    }

    // Find max INV number
    var maxNum = 0;
    if (rowIdColIdx > 0 && sheet.getLastRow() > 1) {
      sheet.getRange(2, rowIdColIdx, sheet.getLastRow() - 1, 1)
        .getValues().forEach(function(r) {
          var m = String(r[0]||'').match(/^INV-(\d+)$/);
          if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
        });
    }

    var placementId = 'PLR-' + new Date().getTime();
    var rowIds = [];
    var totalQty = 0;
    var costMap = getItemCostMapFromLedger_();

    items.forEach(function(item) {
      var qty       = parseInt(item.qty, 10) || 0;
      var itemId    = String(item.item_id || '').trim();
      var costUnit  = (costMap.costs[itemId] !== undefined) ? costMap.costs[itemId] : (parseFloat(item.cost_per_unit) || costMap.defaultCost);
      totalQty += qty;

      maxNum++;
      var rowId = 'INV-' + String(maxNum).padStart(4, '0');
      rowIds.push(rowId);

      var row = [
        datePlaced,
        'outreach',
        String(item.item_id || '').trim(),
        String(item.item_name || '').trim(),
        qty,
        'out',
        source,
        costUnit,
        qty * costUnit,
        pl.notes || '',
        placementId
      ];

      if (rowIdColIdx > 0) {
        while (row.length < rowIdColIdx - 1) row.push('');
        row[rowIdColIdx - 1] = rowId;
      } else {
        row.push(rowId);
      }

      sheet.appendRow(row);
    });

    // Write to PlacementRecords tab
    var plHeaders = ['placement_id','placement_name','date_placed','team_member',
      'institution','address','official_name','contact_phone','contact_email',
      'num_rooms_students','event_source','total_qty_placed','row_ids','notes'];
    var plSheet = ss.getSheetByName('PlacementRecords');
    if (!plSheet) {
      plSheet = ss.insertSheet('PlacementRecords');
      plSheet.getRange(1,1,1,plHeaders.length).setValues([plHeaders]);
      plSheet.getRange(1,1,1,plHeaders.length).setFontWeight('bold').setBackground('#E8E4DF');
      plSheet.setFrozenRows(1);
    }
    plSheet.appendRow([
      placementId, placementName, datePlaced, teamMember,
      institution, pl.address || '', pl.official_name || '',
      pl.contact_phone || '', pl.contact_email || '', pl.num_rooms || '',
      source, totalQty, rowIds.join(', '), pl.notes || ''
    ]);

    // Email summary
    try {
      MailApp.sendEmail({
        to: TEAM_INBOX,
        subject: '\uD83D\uDCCD Placement: ' + placementName + ' (' + datePlaced + ')',
        body: 'Placement record logged from Field Log app.\n\n' +
              'Name: ' + placementName + '\n' +
              'ID: ' + placementId + '\n' +
              'Institution: ' + institution + '\n' +
              'Team: ' + (teamMember || 'field team') + '\n' +
              'Items: ' + totalQty + ' total (' + items.length + ' types)\n' +
              'Row IDs: ' + rowIds.join(', ') + '\n\n' +
              'View: https://docs.google.com/spreadsheets/d/' + LEDGER_SHEET_ID
      });
    } catch(emailErr) {
      console.log('handleFieldPlacement_ email failed (non-fatal):', emailErr);
    }

    return jsonResponse({ ok: true, route: 'fieldPlacement', placement_id: placementId, added: items.length, row_ids: rowIds });

  } catch(err) {
    console.log('handleFieldPlacement_ error:', err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}

/**
 * GET action: getInventory
 * Returns inventory movements filtered by optional month (YYYY-MM).
 * If no month is provided, returns the current month's movements.
 *
 * Usage: ?action=getInventory&month=2026-07
 */
function getInventoryReport_(params) {
  var month = (params && params.month) || '';
  if (!month) {
    var now = new Date();
    month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
  try {
    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName(INVENTORY_TAB);
    if (!sheet || sheet.getLastRow() <= 1) {
      return { ok: true, month: month, entries: [], totals: {} };
    }
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var entries = [];
    var totals = { totalOut: 0, totalIn: 0, totalCostOut: 0, totalCostIn: 0 };
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var dateStr = String(row[0] || '');
      // Filter by month prefix (YYYY-MM)
      if (dateStr.substring(0, 7) !== month) continue;
      var entry = {};
      for (var j = 0; j < headers.length; j++) {
        entry[headers[j]] = row[j];
      }
      entries.push(entry);
      var qty = parseInt(row[4], 10) || 0;
      var cost = parseFloat(row[8]) || 0;
      if (String(row[5]) === 'out') {
        totals.totalOut += qty;
        totals.totalCostOut += cost;
      } else {
        totals.totalIn += qty;
        totals.totalCostIn += cost;
      }
    }
    return { ok: true, month: month, entries: entries, totals: totals };
  } catch (err) {
    console.log('getInventoryReport_ error:', err);
    return { ok: false, error: String(err) };
  }
}

function getMinistryStats_() {
  // ID → language mapping for aggregating item-level stock into
  // language-level "inStock" array (used by ministry-impact.js).
  var ID_LANGUAGE_MAP = {
    'pocket-nt-red': 'English',
    'pocket-nt-grey': 'English',
    'pocket-nt-spanish': 'Spanish',
    'large-print-nt-brown': 'English',
    'full-bible-large-print': 'English',
    'full-bible-pocket': 'English',
    'pocket-nt-hindi-blue': 'Hindi',
    'large-print-nt-russian': 'Russian',
    'large-print-nt-ukrainian': 'Ukrainian',
    'pocket-nt-farsi-blue': 'Farsi',
    'large-print-nt-urdu-blue': 'Urdu',
    'pocket-nt-thai-english-blue': 'Thai',
    'pocket-nt-mandarin': 'Mandarin',
    'large-print-nt-spanish-english': 'Spanish',
    'large-print-nt-arabic-english': 'Arabic',
    'pocket-nt-arabic': 'Arabic',
    'pocket-nt-french': 'French',
    'tract-life-book-english': 'English',
    'tract-life-book-spanish': 'Spanish',
    'tract-flip-books-english': 'English',
  };

  try {
    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName(MINISTRY_STATS_TAB);
    if (!sheet) {
      return { ok: false, error: 'MinistryStats tab not found. Please create it.' };
    }
    var rows = sheet.getDataRange().getValues();
    var result = {
      ok: true,
      total: 0,
      goal: 70000,
      events: 0,
      languagesMessage: 'Available in 2,000+ languages through Gideon\'s International',
      inStock: [],
      items: [],
      lastUpdated: new Date().toISOString(),
    };
    for (var i = 1; i < rows.length; i++) {
      var key = String(rows[i][0] || '').trim().toLowerCase();
      var val = rows[i][1];
      if (!key) continue;
      if (key === 'total')            result.total = parseInt(val, 10) || 0;
      else if (key === 'goal')        result.goal  = parseInt(val, 10) || 70000;
      else if (key === 'events')      result.events = parseInt(val, 10) || 0;
      else if (key === 'languagesmessage') result.languagesMessage = String(val || '');
      else if (key === 'lastupdated') result.lastUpdated = String(val || '');
      else if (key === 'stock') {
        try {
          var item = typeof val === 'string' ? JSON.parse(val) : val;
          if (item && item.language) {
            result.inStock.push({
              language:      item.language,
              count:         item.count         || 0,
              format:        item.format        || '',
              in_storage:    item.in_storage    != null ? item.in_storage    : null,
              on_hand:       item.on_hand       != null ? item.on_hand       : null,
              donated_total: item.donated_total != null ? item.donated_total : null,
            });
          }
        } catch (_) {}
      }
      else if (key === 'item') {
        try {
          var itemData = typeof val === 'string' ? JSON.parse(val) : val;
          if (itemData && itemData.id) {
            result.items.push({
              id:            itemData.id,
              name:          itemData.name          || '',
              count:         itemData.count         || 0,
              language:      itemData.language      || '',
              format:        itemData.format        || '',
              in_storage:    itemData.in_storage    != null ? itemData.in_storage    : null,
              on_hand:       itemData.on_hand       != null ? itemData.on_hand       : null,
              donated_total: itemData.donated_total != null ? itemData.donated_total : null,
            });
          }
        } catch (_) {}
      }
    }

    // If no legacy 'stock' rows exist, derive inStock from items
    // by aggregating counts per language using ID_LANGUAGE_MAP.
    if (result.inStock.length === 0 && result.items.length > 0) {
      var langTotals     = {};
      var langStorage    = {};
      var langOnHand     = {};
      var langDonated    = {};
      for (var j = 0; j < result.items.length; j++) {
        var it = result.items[j];
        var lang = ID_LANGUAGE_MAP[it.id] || it.language;
        if (!lang) continue;
        if (!langTotals[lang])  langTotals[lang]  = 0;
        if (!langStorage[lang]) langStorage[lang] = 0;
        if (!langOnHand[lang])  langOnHand[lang]  = 0;
        if (!langDonated[lang]) langDonated[lang] = 0;
        langTotals[lang]  += (parseInt(it.count,         10) || 0);
        langStorage[lang] += (parseInt(it.in_storage,    10) || 0);
        langOnHand[lang]  += (parseInt(it.on_hand,       10) || 0);
        langDonated[lang] += (parseInt(it.donated_total, 10) || 0);
      }
      var langKeys = Object.keys(langTotals);
      for (var k = 0; k < langKeys.length; k++) {
        var lk = langKeys[k];
        result.inStock.push({
          language:      lk,
          count:         langTotals[lk],
          in_storage:    langStorage[lk] || null,
          on_hand:       langOnHand[lk]  || null,
          donated_total: langDonated[lk] || null,
        });
      }
    }

    return result;
  } catch (err) {
    console.log('getMinistryStats_ error:', err);
    return { ok: false, error: String(err) };
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

  // ── Inventory auto-log on "packing" ──────────────────────────
  // When an order transitions to "packing", parse the configuration
  // column for item IDs and log them as inventory movements (out).
  if (newStatus === 'packing') {
    try {
      var configText = String(order.configuration || '');
      var invEntries = parseOrderConfigForInventory_(configText, order.order_id || '');
      if (invEntries.length > 0) {
        logInventoryMovement_(invEntries);
        console.log('[onOrderStatusEdit] logged ' + invEntries.length + ' inventory out entries for ' + order.order_id);
      }
    } catch (invErr) {
      console.log('[onOrderStatusEdit] inventory logging failed (non-fatal): ' + invErr);
    }
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

  if (action === 'prayer-unsubscribe') {
    return handlePrayerUnsubscribe_(e && e.parameter && e.parameter.token || '');
  }

  if (action === 'bible-request-approve') {
    return handleBibleRequestApprove_(
      (e && e.parameter && e.parameter.token) || '',
      (e && e.parameter) || {}
    );
  }

  if (action === 'bible-request-decline') {
    return handleBibleRequestDecline_(
      (e && e.parameter && e.parameter.token) || '',
      (e && e.parameter) || {}
    );
  }

  if (action === 'bible-request-handoff') {
    return handleBibleRequestHandoff_(
      (e && e.parameter && e.parameter.token) || '',
      (e && e.parameter) || {}
    );
  }

  if (action === 'getMinistryStats') {
    try {
      return jsonResponse(getMinistryStats_());
    } catch (err) {
      console.log('getMinistryStats failed:', err);
      return jsonResponse({ ok: false, error: 'stats-read-failed' });
    }
  }

  if (action === 'getInventory') {
    try {
      return jsonResponse(getInventoryReport_(e && e.parameter));
    } catch (err) {
      console.log('getInventory failed:', err);
      return jsonResponse({ ok: false, error: 'inventory-read-failed' });
    }
  }

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
const SITE_PUBLIC_BASE = 'https://seedtheword.org';

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

// ── Layered Bible Reading Plan companion-stream helpers ─────────────
// Mirrors the algorithms in:
//   - assets/js/layered-plan.js (browser renderer)
//   - .github/scripts/post_daily_bible_to_telegram.py (Python footer)
// Property L10 asserts all three implementations agree byte-for-byte
// on chapter references for the same date in the same timezone.

const OT_HISTORY_BOOKS = [
  ['Genesis', 50], ['Exodus', 40], ['Leviticus', 27], ['Numbers', 36],
  ['Deuteronomy', 34], ['Joshua', 24], ['Judges', 21], ['Ruth', 4],
  ['1 Samuel', 31], ['2 Samuel', 24], ['1 Kings', 22], ['2 Kings', 25],
  ['1 Chronicles', 29], ['2 Chronicles', 36], ['Ezra', 10],
  ['Nehemiah', 13], ['Esther', 10],
];

const POETRY_PROPHECY_BOOKS = [
  ['Job', 42], ['Ecclesiastes', 12], ['Song of Solomon', 8],
  ['Isaiah', 66], ['Jeremiah', 52], ['Lamentations', 5],
  ['Ezekiel', 48], ['Daniel', 12], ['Hosea', 14], ['Joel', 3],
  ['Amos', 9], ['Obadiah', 1], ['Jonah', 4], ['Micah', 7],
  ['Nahum', 3], ['Habakkuk', 3], ['Zephaniah', 3], ['Haggai', 2],
  ['Zechariah', 14], ['Malachi', 4],
];

function _flattenBookList(books) {
  const out = [];
  for (let i = 0; i < books.length; i++) {
    const name = books[i][0];
    const count = books[i][1];
    for (let c = 1; c <= count; c++) out.push({ book: name, chapter: c });
  }
  return out;
}

const OT_HISTORY_SEQUENCE = _flattenBookList(OT_HISTORY_BOOKS);
const POETRY_PROPHECY_SEQUENCE = _flattenBookList(POETRY_PROPHECY_BOOKS);

function _parseAnchorYMD(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!y || !m || !d) return null;
  return [y, m, d];
}

function _walkReading(date, anchor, sequence) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return null;
  if (!anchor || typeof anchor !== 'object') return null;
  const ymd = _parseAnchorYMD(anchor.date);
  if (!ymd) return null;
  if (!anchor.book || typeof anchor.chapter !== 'number') return null;
  let anchorIdx = -1;
  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i].book === anchor.book && sequence[i].chapter === anchor.chapter) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) return null;
  const offset = _weekdaysBetween(
    ymd[0], ymd[1], ymd[2],
    date.getFullYear(), date.getMonth() + 1, date.getDate()
  );
  const idx = anchorIdx + offset;
  if (idx < 0 || idx >= sequence.length) return null;
  return { book: sequence[idx].book, chapter: sequence[idx].chapter };
}

function _getOtHistoryReading(date, anchor) {
  return _walkReading(date, anchor, OT_HISTORY_SEQUENCE);
}

function _getPoetryProphecyReading(date, anchor) {
  return _walkReading(date, anchor, POETRY_PROPHECY_SEQUENCE);
}

function _dayOfYear(date) {
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const y = date.getFullYear();
  const isLeap = ((y % 4 === 0) && (y % 100 !== 0)) || (y % 400 === 0);
  if (isLeap) monthDays[1] = 29;
  let doy = date.getDate();
  for (let i = 0; i < date.getMonth(); i++) doy += monthDays[i];
  return doy;
}

function _psalmOfDay(date, _tz) {
  return ((_dayOfYear(date) - 1) % 150) + 1;
}

function _proverbOfDay(date, _tz) {
  return Math.min(date.getDate(), 31);
}

function _buildLayeredFooter(layeredCfg, todayPT, tz) {
  if (!layeredCfg || layeredCfg.enabled === false) return [];
  if (!layeredCfg.includeInTelegram) return [];
  const dow = todayPT.getDay();
  if (dow === 0 || dow === 6) return [];

  const streams = layeredCfg.streams || {};
  const pills = [];

  const ot = streams.otHistory || {};
  if (ot.enabled !== false) {
    const r = _getOtHistoryReading(todayPT, ot.anchor || {});
    if (r) pills.push(['OT walk', r.book + ' ' + r.chapter]);
  }
  const pp = streams.poetryProphecy || {};
  if (pp.enabled !== false) {
    const r = _getPoetryProphecyReading(todayPT, pp.anchor || {});
    if (r) pills.push(['Poetry & Prophecy', r.book + ' ' + r.chapter]);
  }
  const psalm = streams.psalm || {};
  if (psalm.enabled !== false) {
    pills.push([null, 'Psalm ' + _psalmOfDay(todayPT, tz)]);
  }
  const proverbs = streams.proverbs || {};
  if (proverbs.enabled !== false) {
    pills.push([null, 'Proverbs ' + _proverbOfDay(todayPT, tz)]);
  }

  if (pills.length === 0) return [];

  const out = ['', '🌿 *' + _mdv2Escape('Going deeper today') + '*'];
  for (let i = 0; i < pills.length; i++) {
    const label = pills[i][0];
    const ref = pills[i][1];
    if (label) {
      out.push('· ' + _mdv2Escape(label + ': ' + ref));
    } else {
      out.push('· ' + _mdv2Escape(ref));
    }
  }
  return out;
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

  // Going Deeper Today footer — companion streams (R9.1-R9.3, parity with Python).
  const layeredCfg = (fullCfg.bible || {}).layeredPlan;
  const tz = (biblecfg.timezone || 'America/Los_Angeles');
  const layeredLines = _buildLayeredFooter(layeredCfg, todayPT, tz);
  for (let i = 0; i < layeredLines.length; i++) lines.push(layeredLines[i]);

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
    'kickHeartbeat',
    'kickPrayerDigestPoll',
    'kickPrayerDigestPost',
    'kickSaturdayIcebreaker',
    'mirrorCalendarPaperclipAttachments_',
    'processBibleReviewReminders_',
    'processWalkTokenCleanup_',
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
  // Heartbeat kicker fires hourly so the heartbeat workflow ticks
  // even when GitHub's cron is disabled (e.g. after a temporary
  // account suspension that auto-reinstates without re-enabling
  // scheduled triggers).
  ScriptApp.newTrigger('kickHeartbeat').timeBased()
    .everyHours(1).create();
  // Prayer digest poller kicker fires every 15 min so prayer-topic
  // messages keep being captured into telegram-prayer-log.json even
  // when GitHub's cron is silent. Telegram bots can't read history
  // retroactively — a missed Poller window means lost messages.
  ScriptApp.newTrigger('kickPrayerDigestPoll').timeBased()
    .everyMinutes(15).create();
  // Prayer digest poster kicker fires daily at 08:00 PT but the
  // function itself bails on Tue/Wed/Fri/Sun (one daily trigger
  // keeps the install simple; the function is the gate). Mirrors
  // the GitHub cron `0 15 * * 1,4,6`.
  ScriptApp.newTrigger('kickPrayerDigestPost').timeBased()
    .everyDays(1).atHour(8).create();
  // Saturday icebreaker kicker fires daily at 09:00 PT but the
  // function itself bails on non-Saturdays. Lands ~1h after the
  // daily Bible bot's morning post so the Discuss Scripture topic
  // is the second thing members see, not competing for attention.
  ScriptApp.newTrigger('kickSaturdayIcebreaker').timeBased()
    .everyDays(1).atHour(9).create();
  // Calendar paperclip-attachment mirror fires every 5 minutes 24/7.
  // Each tick is cheap (~1 Calendar.Events.list call) and the
  // function is a no-op on most ticks because most events have
  // already been mirrored. The 5-min cadence means a freshly added
  // paperclip ships into the bot pipeline within ~5 min of being
  // attached, well ahead of the announcement bot's next fire.
  ScriptApp.newTrigger('mirrorCalendarPaperclipAttachments_').timeBased()
    .everyMinutes(5).create();

  // Bible request review reminder cron fires every 30 minutes.
  // No-op on most ticks — it only emails admins when a pending_review
  // row has been waiting longer than reviewReminderHours and hasn't
  // been reminded yet. One reminder per row.
  ScriptApp.newTrigger('processBibleReviewReminders_').timeBased()
    .everyMinutes(30).create();

  // Your Walk token cleanup cron fires hourly. Reaps WalkTokens
  // rows whose expires_at is in the past. WalkStamps + WalkBadges
  // are preserved (a returning member with the same email keeps
  // their reading history).
  ScriptApp.newTrigger('processWalkTokenCleanup_').timeBased()
    .everyHours(1).create();

  console.log('installAllTimeTriggers: installed 15 triggers.');
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

// ─────────────────────────────────────────────────────────────────────
// Announcement bot TEST button — admin-on-demand. Fires the same
// workflow as kickAnnouncementBot but with `test_run=true` so the
// Python script branches into _run_test() and posts ONE photo
// announcement built from the next future event with attached
// photos. Skips dedup so admins can re-fire freely while iterating.
//
// Use this to verify:
//   1. A specific event's image URL is shareable (Drive permissions)
//   2. The image URL parses out of the calendar event description
//   3. Telegram accepts the image bytes (no HTML interstitial)
//   4. The caption + photo render the way you want them to
//
// The post lands in the regular announcement channel + thread but is
// prefixed with "(test) Photo announcement preview" so members reading
// the channel know it's not a real announcement.
//
// If no future event with reachable photos exists yet, the script
// logs that fact and exits cleanly — no Telegram post, no error.
// Add a calendar event with a photo URL pasted in its description
// and re-run.
// ─────────────────────────────────────────────────────────────────────
function kickAnnouncementBotTest() {
  _markAppsScriptRan('kickAnnouncementBotTest');

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickAnnouncementBotTest: GITHUB_TOKEN script property not set; aborting');
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
      payload: JSON.stringify({
        ref: 'main',
        inputs: { test_run: 'true' },
      }),
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code === 204) {
      console.log('kickAnnouncementBotTest: dispatched test_run OK (204). ' +
        'Check Telegram in ~1 minute for a "(test)"-labeled photo preview. ' +
        'If nothing posts, the workflow log will explain why ' +
        '(no upcoming events with photos, or photo URLs failed pre-flight).');
    } else {
      console.log(
        'kickAnnouncementBotTest: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickAnnouncementBotTest: threw: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Calendar paperclip attachment mirror
// ─────────────────────────────────────────────────────────────────────
//
// Lets admins use Google Calendar's "Add attachment" paperclip icon
// (the natural workflow) instead of having to upload to a shared
// Drive folder and paste the URL into the description by hand.
// Every 5 minutes this function:
//
//   1. Reads upcoming events from the ministry calendar via the
//      advanced Calendar API (iCal doesn't expose attachments).
//   2. For every image-mime attachment NOT already mirrored, copies
//      the Drive file into the STW Calendar Photos folder (which is
//      "Anyone with the link: Viewer", so the copy inherits public
//      access without any per-file sharing).
//   3. Appends the copy's `https://drive.google.com/file/d/<id>/view`
//      URL to the event description on its own line — that's the
//      shape the Python announcement bot already recognizes via
//      extract_image_urls().
//   4. Removes the original paperclip attachment from the event so
//      the next tick is a no-op for that file (idempotency contract).
//
// On any failure (file copy, calendar patch, quota), the function
// logs and returns; the next tick retries from a clean state.
//
// PREREQUISITES (one-time, in the Apps Script editor):
//   1. Resources / Services panel → Add a service → enable
//      "Google Calendar API" (the advanced version, not CalendarApp).
//   2. Resources / Services panel → Add a service → enable
//      "Drive API" (the advanced version, not DriveApp).
//   3. Run installAllTimeTriggers() to register the 5-minute trigger.
//
// The folder ID is parsed from telegram-bot.json's
// shared.calendarPhotosFolderUrl so the mirror folder is single-
// sourced with the rest of the pipeline. If that field is empty,
// the function logs and exits cleanly without doing anything.
// ─────────────────────────────────────────────────────────────────────
function mirrorCalendarPaperclipAttachments_() {
  _markAppsScriptRan('mirrorCalendarPaperclipAttachments_');

  // Cooperative lock so two concurrent triggers don't double-mirror
  // the same paperclip in a 5-min window. 1-min wait then bail —
  // next tick will retry.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) {
    console.log('mirrorCalendarPaperclipAttachments_: another instance holds the lock; skipping this tick.');
    return;
  }
  try {
    var folderId = _resolveCalendarPhotosFolderId_();
    if (!folderId) {
      console.log('mirrorCalendarPaperclipAttachments_: shared.calendarPhotosFolderUrl missing or unparseable; skipping.');
      return;
    }
    var folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (err) {
      console.log('mirrorCalendarPaperclipAttachments_: folder not accessible (' + err + '); skipping.');
      return;
    }

    // Window: anything from 1h ago to 14 days out. Past events with
    // attachments aren't worth mirroring (the bot won't post them
    // anyway). 14 days matches the default lookahead horizon.
    var now = new Date();
    var timeMin = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    var timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    var calendarId = 'seedthewordministry@gmail.com';

    var events;
    try {
      var resp = Calendar.Events.list(calendarId, {
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        showDeleted: false,
        maxResults: 250,
      });
      events = resp.items || [];
    } catch (err) {
      console.log('mirrorCalendarPaperclipAttachments_: Calendar.Events.list failed (' + err + '); skipping.');
      return;
    }

    var mirrored = 0;
    var skipped = 0;
    var failed = 0;

    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var atts = ev.attachments || [];
      if (!atts.length) continue;

      var description = ev.description || '';
      var newUrls = [];
      var keepAtts = [];

      for (var j = 0; j < atts.length; j++) {
        var att = atts[j];
        var fileId = att.fileId || _extractDriveFileId_(att.fileUrl);
        var mime = att.mimeType || '';
        var titleLower = String(att.title || '').toLowerCase();

        // Multi-signal "is this an image?" check. Calendar's API
        // sometimes returns attachments missing the mimeType field
        // (varies by upload path: paperclip → Photos, paperclip →
        // Drive, drag-and-drop, mobile vs. web). Falling back to the
        // file extension in the title catches those cases without
        // false-positiving on docs / PDFs.
        var looksLikeImage =
          mime.indexOf('image/') === 0 ||
          /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(titleLower);

        if (!looksLikeImage) {
          // Non-image attachment (PDF, doc, etc.) — leave alone.
          keepAtts.push(att);
          continue;
        }

        if (!fileId) {
          // Image-shaped attachment but we can't resolve a Drive
          // file ID (e.g., a Google Photos URL we can't copy
          // through DriveApp). Leave it; admin will need to drop
          // it into Drive manually.
          console.log('mirrorCalendarPaperclipAttachments_: image attachment without a resolvable fileId on event "' +
            (ev.summary || ev.id) + '" (title=' + att.title + ', url=' + att.fileUrl + '); leaving in place.');
          keepAtts.push(att);
          continue;
        }

        // Idempotency: if the original file ID is already in the
        // description, we mirrored it on a previous tick but failed
        // to remove the paperclip. Remove the paperclip now and
        // skip the copy.
        if (description.indexOf(fileId) !== -1) {
          skipped++;
          // DO NOT push back into keepAtts — we want it gone.
          continue;
        }

        // Copy the file into the STW Calendar Photos folder. The
        // folder is set to "Anyone with the link: Viewer" so the
        // copy inherits public-read; explicitly setSharing again as
        // belt-and-suspenders.
        try {
          var sourceFile = DriveApp.getFileById(fileId);
          var fileName = sourceFile.getName();
          // Prefix with the event date for human-readable folder
          // browsing later. Format: "2026-05-30 — original-name.jpg".
          var datePrefix = '';
          if (ev.start && (ev.start.dateTime || ev.start.date)) {
            datePrefix = String(ev.start.dateTime || ev.start.date).slice(0, 10) + ' — ';
          }
          var copy = sourceFile.makeCopy(datePrefix + fileName, folder);
          try {
            copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (sharingErr) {
            // Sharing failed but the copy exists. Log and continue —
            // the parent folder's sharing will usually still apply.
            console.log('mirrorCalendarPaperclipAttachments_: setSharing on copy failed (' + sharingErr + '); relying on folder inheritance.');
          }
          var publicUrl = 'https://drive.google.com/file/d/' + copy.getId() + '/view?usp=sharing';
          newUrls.push(publicUrl);
          mirrored++;
        } catch (copyErr) {
          // Copy failed — leave the original paperclip in place so
          // the admin can see it's still pending and retry next tick.
          console.log('mirrorCalendarPaperclipAttachments_: copy failed for fileId=' + fileId + ' (' + copyErr + '); leaving paperclip intact.');
          keepAtts.push(att);
          failed++;
        }
      }

      if (!newUrls.length) {
        continue;  // Nothing to patch for this event.
      }

      // Append the new URLs to the description on their own lines.
      // Newline-separate. Description may be HTML (Calendar's editor
      // sometimes wraps free text in <p>...</p>) — appending plain
      // URLs still works because the bot's extractor matches both
      // raw URLs and href attributes.
      var newDescription = description;
      if (newDescription && !/[\n\r]\s*$/.test(newDescription)) {
        newDescription += '\n';
      }
      for (var k = 0; k < newUrls.length; k++) {
        newDescription += '\n' + newUrls[k];
      }

      // Patch the calendar event: new description + attachments=
      // keepAtts (i.e., drop the paperclips we just mirrored).
      try {
        Calendar.Events.patch({
          description: newDescription,
          attachments: keepAtts,
        }, calendarId, ev.id, { supportsAttachments: true });
      } catch (patchErr) {
        console.log('mirrorCalendarPaperclipAttachments_: Events.patch failed for event "' +
          (ev.summary || ev.id) + '" (' + patchErr + '). Rolling back ' + newUrls.length + ' copies.');
        // Rollback: delete the copies we just made so we don't
        // accumulate orphans on retry.
        for (var m = 0; m < newUrls.length; m++) {
          try {
            var rollbackId = _extractDriveFileId_(newUrls[m]);
            if (rollbackId) DriveApp.getFileById(rollbackId).setTrashed(true);
          } catch (_) { /* best-effort */ }
        }
        mirrored -= newUrls.length;
        failed += newUrls.length;
        continue;
      }

      console.log('mirrorCalendarPaperclipAttachments_: mirrored ' + newUrls.length +
        ' image(s) for event "' + (ev.summary || ev.id) + '".');
    }

    if (mirrored || skipped || failed) {
      console.log('mirrorCalendarPaperclipAttachments_: done. mirrored=' + mirrored +
        ', skipped(idempotent)=' + skipped + ', failed=' + failed + ', events scanned=' + events.length);
    }
  } finally {
    try { lock.releaseLock(); } catch (_) { /* best-effort */ }
  }
}

// Pull the STW Calendar Photos folder ID out of telegram-bot.json's
// shared.calendarPhotosFolderUrl. Returns '' if missing/malformed so
// the caller can short-circuit cleanly.
function _resolveCalendarPhotosFolderId_() {
  try {
    var resp = UrlFetchApp.fetch(SITE_URL + 'assets/data/telegram-bot.json', {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'seedtheword-apps-script/1.0' },
    });
    if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) return '';
    var cfg = JSON.parse(resp.getContentText());
    var url = cfg && cfg.shared && cfg.shared.calendarPhotosFolderUrl;
    return _extractDriveFolderId_(url);
  } catch (err) {
    console.log('_resolveCalendarPhotosFolderId_: ' + err);
    return '';
  }
}

// Match a Drive file ID inside any URL shape Drive emits:
//   https://drive.google.com/file/d/<id>/view?usp=sharing
//   https://drive.google.com/open?id=<id>
//   https://docs.google.com/uc?id=<id>
//   https://drive.google.com/uc?id=<id>&export=...
// Returns '' on no match.
function _extractDriveFileId_(url) {
  if (!url) return '';
  var s = String(url);
  var m = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

// Match a Drive folder ID inside any URL shape Drive emits:
//   https://drive.google.com/drive/folders/<id>?usp=drive_link
//   https://drive.google.com/drive/u/0/folders/<id>
function _extractDriveFolderId_(url) {
  if (!url) return '';
  var s = String(url);
  var m = s.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return '';
}

// ─────────────────────────────────────────────────────────────────────
// Diagnostic: dump every upcoming event's paperclip attachments so the
// operator can see exactly what shape they're in. Use this when the
// mirror appears to silently skip an attachment — the log shows you
// the attachment fields (title, mimeType, fileId, fileUrl, iconLink)
// and whether the mirror's heuristic considers it an image. Run from
// the Apps Script function dropdown when debugging.
// ─────────────────────────────────────────────────────────────────────
function debugCalendarPaperclips() {
  _markAppsScriptRan('debugCalendarPaperclips');
  var calendarId = 'seedthewordministry@gmail.com';
  var now = new Date();
  var timeMin = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  var timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  var resp;
  try {
    resp = Calendar.Events.list(calendarId, {
      timeMin: timeMin, timeMax: timeMax,
      singleEvents: true, orderBy: 'startTime', showDeleted: false,
      maxResults: 250,
    });
  } catch (err) {
    console.log('debugCalendarPaperclips: Calendar.Events.list failed: ' + err);
    console.log('Most likely cause: the advanced "Google Calendar API" service is not enabled. ' +
      'In the editor: left rail → Services → + → Google Calendar API → Add. Identifier must be "Calendar".');
    return;
  }
  var events = resp.items || [];
  console.log('debugCalendarPaperclips: scanning ' + events.length + ' events.');
  var anyAttachments = false;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var atts = ev.attachments || [];
    if (!atts.length) continue;
    anyAttachments = true;
    console.log('--- Event "' + (ev.summary || ev.id) + '" (' + ev.id + ') — ' + atts.length + ' attachment(s):');
    for (var j = 0; j < atts.length; j++) {
      var a = atts[j];
      var fid = a.fileId || _extractDriveFileId_(a.fileUrl);
      var mime = a.mimeType || '(none)';
      var titleLower = String(a.title || '').toLowerCase();
      var looksLikeImage =
        (a.mimeType || '').indexOf('image/') === 0 ||
        /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(titleLower);
      console.log('  [' + j + '] title=' + a.title +
        ' | mimeType=' + mime +
        ' | fileId=' + (fid || '(unresolved)') +
        ' | fileUrl=' + (a.fileUrl || '(none)') +
        ' | looksLikeImage=' + looksLikeImage);
    }
  }
  if (!anyAttachments) {
    console.log('debugCalendarPaperclips: no events with attachments in the next 14 days.');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Manual run-now button. Same as the time-trigger fire but invokable
// from the function dropdown so admins don't have to wait for the
// next 5-min tick when verifying a fresh paperclip.
// ─────────────────────────────────────────────────────────────────────
function runMirrorCalendarPaperclipsNow() {
  console.log('runMirrorCalendarPaperclipsNow: firing the mirror immediately…');
  mirrorCalendarPaperclipAttachments_();
  console.log('runMirrorCalendarPaperclipsNow: done. Refresh the calendar to see the result.');
}

// ─────────────────────────────────────────────────────────────────────
// Heartbeat kicker — fires the GitHub Actions heartbeat workflow every
// hour from Apps Script, so the heartbeat keeps ticking even when
// GitHub's free-tier cron has been disabled (e.g. after a temporary
// account suspension that auto-reinstates without re-enabling the
// scheduled triggers).
//
// Why bother kicking the heartbeat itself: the heartbeat exists to
// keep GitHub's "is this repo active" timer fresh so OTHER scheduled
// workflows don't get deprioritized. If the heartbeat itself stops
// firing (because cron got disabled), the whole purpose of the
// workflow is defeated. This kicker breaks that circularity by giving
// us a second, independent trigger source (Apps Script) for the one
// workflow whose entire job is to keep the repo looking active.
//
// The heartbeat workflow has its own concurrency:cancel-in-progress
// guard, so duplicate invocations from cron + this kicker just
// produce a single tick per cycle (the duplicate gets cancelled).
// Same GITHUB_TOKEN as kickAnnouncementBot.
// ─────────────────────────────────────────────────────────────────────
function kickHeartbeat() {
  _markAppsScriptRan('kickHeartbeat');

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickHeartbeat: GITHUB_TOKEN script property not set; aborting');
    return;
  }

  var url = 'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/heartbeat.yml/dispatches';
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
      console.log('kickHeartbeat: dispatched OK (204)');
    } else {
      console.log(
        'kickHeartbeat: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickHeartbeat: threw: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Prayer digest poller kicker — fires the GitHub Actions
// prayer-digest-poll.yml workflow every 15 min from Apps Script. The
// poll captures messages from the @seedtheword Prayer & Thanksgiving
// topic into telegram-prayer-log.json so the Mon/Thu/Sat digest poster
// has data to render. Telegram bots can't read history retroactively,
// so this MUST run on a tight cadence — independent redundancy with
// GitHub's */15 * * * * cron means a suspended-then-reinstated repo
// (which silently disables scheduled crons) doesn't drop messages.
//
// The poll workflow has concurrency:cancel-in-progress so a duplicate
// dispatch from cron + this kicker just produces one effective run.
// Same GITHUB_TOKEN as kickAnnouncementBot / kickHeartbeat.
// ─────────────────────────────────────────────────────────────────────
function kickPrayerDigestPoll() {
  _markAppsScriptRan('kickPrayerDigestPoll');

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickPrayerDigestPoll: GITHUB_TOKEN script property not set; aborting');
    return;
  }

  var url = 'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/prayer-digest-poll.yml/dispatches';
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
      console.log('kickPrayerDigestPoll: dispatched OK (204)');
    } else {
      console.log(
        'kickPrayerDigestPoll: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickPrayerDigestPoll: threw: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Prayer digest poster kicker — fires the GitHub Actions
// prayer-digest-post.yml workflow on Mon/Thu/Sat at 08:00 PT from
// Apps Script, mirroring the GitHub-side cron `0 15 * * 1,4,6`. The
// trigger itself is daily (one trigger keeps the install simple); the
// weekday gate inside the function bails on Tue/Wed/Fri/Sun so we
// don't accidentally post an off-cycle digest.
//
// Why a kicker for a triweekly bot: same GitHub cron suspension/
// reinstatement failure mode as the heartbeat. The post script is
// itself idempotent — it slot-keys by ISO week and exits 0 on a
// repeat — so a duplicate dispatch from cron + this kicker is safe;
// only one slot completion writes back.
//
// Same GITHUB_TOKEN as the other kickers. Weekday computed in
// America/Los_Angeles via Utilities.formatDate, NOT new Date().getDay(),
// so the kick can't drift if the script project timezone ever changes.
// ─────────────────────────────────────────────────────────────────────
function kickPrayerDigestPost() {
  _markAppsScriptRan('kickPrayerDigestPost');

  // Weekday gate — Mon, Thu, Sat only. Match the GitHub cron and
  // prayer.digest.scheduleDays in telegram-bot.json.
  var dayCode = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEE');
  if (dayCode !== 'Mon' && dayCode !== 'Thu' && dayCode !== 'Sat') {
    console.log('kickPrayerDigestPost: ' + dayCode + ' is not a digest day; skipping.');
    return;
  }

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickPrayerDigestPost: GITHUB_TOKEN script property not set; aborting');
    return;
  }

  var url = 'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/prayer-digest-post.yml/dispatches';
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
      console.log('kickPrayerDigestPost: dispatched OK (204) for ' + dayCode);
    } else {
      console.log(
        'kickPrayerDigestPost: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickPrayerDigestPost: threw: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Saturday icebreaker kicker — fires the GitHub Actions
// saturday-icebreaker.yml workflow on Saturdays at 09:00 PT. The
// trigger itself is daily; the function gates on weekday so we only
// dispatch on Saturdays. Same suspicion-resistant pattern as the
// prayer digest post kicker.
//
// The script the workflow runs (post_saturday_icebreaker_to_telegram)
// is itself idempotent — once-per-Saturday dedup keyed in the same
// telegram-bible-log.json that daily-bible writes — so a duplicate
// dispatch from any source produces at most one icebreaker post.
//
// Same GITHUB_TOKEN as the other kickers.
// ─────────────────────────────────────────────────────────────────────
function kickSaturdayIcebreaker() {
  _markAppsScriptRan('kickSaturdayIcebreaker');

  var dayCode = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEE');
  if (dayCode !== 'Sat') {
    console.log('kickSaturdayIcebreaker: ' + dayCode + ' is not Saturday; skipping.');
    return;
  }

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickSaturdayIcebreaker: GITHUB_TOKEN script property not set; aborting');
    return;
  }

  var url = 'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/saturday-icebreaker.yml/dispatches';
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
      console.log('kickSaturdayIcebreaker: dispatched OK (204)');
    } else {
      console.log(
        'kickSaturdayIcebreaker: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickSaturdayIcebreaker: threw: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Saturday icebreaker TEST button — admin-on-demand. Fires the same
// workflow but with `test_run=true` so the post lands in Discuss
// Scripture (thread 434) prefixed with "(test)" and the once-per-day
// dedup is bypassed. Run this from the Apps Script function dropdown
// any day of the week to preview what tomorrow / next Saturday will
// look like before it goes live.
//
// The script also gracefully snaps to the most recent Saturday's
// readings when invoked on a non-Saturday (TEST_RUN handling in the
// Python script), so the preview is meaningful regardless of when
// you run it.
// ─────────────────────────────────────────────────────────────────────
function kickSaturdayIcebreakerTest() {
  _markAppsScriptRan('kickSaturdayIcebreakerTest');

  var ghToken = PropertiesService.getScriptProperties()
    .getProperty('GITHUB_TOKEN');
  if (!ghToken) {
    console.log('kickSaturdayIcebreakerTest: GITHUB_TOKEN script property not set; aborting');
    return;
  }

  var url = 'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/saturday-icebreaker.yml/dispatches';
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
      payload: JSON.stringify({
        ref: 'main',
        inputs: { test_run: 'true' },
      }),
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code === 204) {
      console.log('kickSaturdayIcebreakerTest: dispatched test_run OK (204). ' +
        'Check Telegram thread 434 in ~1 minute for a "(test)"-labeled preview.');
    } else {
      console.log(
        'kickSaturdayIcebreakerTest: HTTP ' + code +
        ' body=' + resp.getContentText().substring(0, 200)
      );
    }
  } catch (err) {
    console.log('kickSaturdayIcebreakerTest: threw: ' + err);
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
    // Heartbeat kicker — fires hourly. SLO of 4 hours catches the
    // failure mode where the kicker itself stops (Apps Script trigger
    // unbound, GITHUB_TOKEN expired, etc.) without alerting too
    // eagerly on a single missed run.
    { name: 'kickHeartbeat',                  maxAgeHours: 4,  label: 'Heartbeat kicker' },

    // Prayer digest poller kicker — fires every 15 min. SLO of 2
    // hours catches a few consecutive misses without alerting on a
    // single jittered run.
    { name: 'kickPrayerDigestPoll',           maxAgeHours: 2,  label: 'Prayer digest poller kicker' },

    // Prayer digest poster kicker — fires daily at 08:00 PT (the
    // weekday gate inside the function bails on non-digest days).
    // SLO of 30 hours catches a missed daily fire without false-
    // positive on the day-after-Saturday gap.
    { name: 'kickPrayerDigestPost',           maxAgeHours: 30, label: 'Prayer digest poster kicker' },

    // Saturday icebreaker kicker — fires daily at 09:00 PT (the
    // function bails on non-Saturdays). SLO of 30 hours catches a
    // missed daily fire; the Saturday-only gate means we'd see only
    // 1-in-7 actual icebreaker dispatches, but _markAppsScriptRan
    // fires every kick attempt so this SLO works the same as Post.
    { name: 'kickSaturdayIcebreaker',         maxAgeHours: 30, label: 'Saturday icebreaker kicker' },

    // Calendar paperclip-attachment mirror — fires every 5 min. SLO
    // of 1 hour catches a few consecutive misses without alerting
    // on a single jittered run.
    { name: 'mirrorCalendarPaperclipAttachments_', maxAgeHours: 1, label: 'Calendar paperclip mirror' },

    // Bible review reminder cron — fires every 30 min. SLO of 2
    // hours catches a few consecutive misses without false-alarming
    // on a single jitter.
    { name: 'processBibleReviewReminders_', maxAgeHours: 2, label: 'Bible review reminder cron' },

    // Your Walk token cleanup cron — fires hourly. SLO of 2 hours
    // catches a stalled cron within one ordinary heartbeat.
    { name: 'processWalkTokenCleanup_',     maxAgeHours: 2, label: 'Your Walk token cleanup cron' },
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

// ─────────────────────────────────────────────────────────────────────
// Prayer Request Intake — handler, drip cron, unsubscribe.
// Spec: .kiro/specs/prayer-request-intake/design.md
// ─────────────────────────────────────────────────────────────────────

// ── Config loader ───────────────────────────────────────────────
//
// Reads `prayer.intake` from the deployed assets/data/telegram-bot.json.
// Returns sensible defaults so a missing field never throws. No
// caching — the file is small and Apps Script executions are short.
function loadIntakeConfig_() {
  var url = SITE_URL + 'assets/data/telegram-bot.json';
  var raw = {};
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      raw = JSON.parse(resp.getContentText());
    }
  } catch (err) {
    console.log('loadIntakeConfig_: fetch failed: ' + err);
    raw = {};
  }
  var p = (raw && raw.prayer && raw.prayer.intake) || {};
  return {
    enabled:           p.enabled === true,
    endpointUrl:       String(p.endpointUrl || ''),
    marker:            String(p.marker || '(via the website)'),
    bodyMinChars:      Number(p.bodyMinChars) || 10,
    bodyMaxChars:      Number(p.bodyMaxChars) || 2000,
    dripDays:          Array.isArray(p.dripDays) ? p.dripDays : [0, 3, 7, 14],
    dripEnabled:       p.dripEnabled === true,
    auditSheetTabName: String(p.auditSheetTabName || 'Prayers'),
  };
}

// ── Client IP hash (best-effort) ────────────────────────────────
function clientIpHash_(payload) {
  var raw = (payload && payload.__client_ip) || '';
  raw = String(raw).trim();
  if (!raw) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// ── Rate limit ───────────────────────────────────────────────────
//
// Per Requirement 10.6 the response is generic regardless of which
// bucket fires. An empty source short-circuits to true (e.g. no
// IP header behind GitHub Pages → IP buckets always pass; per-email
// bucket still enforces).
function checkRateLimits_(ipHash, emailKey) {
  var cache = CacheService.getScriptCache();
  return checkBucket_(cache, 'ip:1h:'    + ipHash,    ipHash,   3,  60 * 60)
      && checkBucket_(cache, 'ip:1d:'    + ipHash,    ipHash,   10, 24 * 60 * 60)
      && checkBucket_(cache, 'email:1h:' + emailKey,  emailKey, 3,  60 * 60)
      && checkBucket_(cache, 'email:1d:' + emailKey,  emailKey, 5,  24 * 60 * 60);
}

function checkBucket_(cache, key, source, limit, ttlSeconds) {
  if (!source) return true;            // empty source skips this bucket
  var raw = cache.get(key);
  var n = raw ? Number(raw) : 0;
  if (n >= limit) return false;
  cache.put(key, String(n + 1), ttlSeconds);
  return true;
}

// ── Validation ───────────────────────────────────────────────────
function validatePrayerIntake_(p, cfg) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  if (p.kind !== 'prayer' && p.kind !== 'thanksgiving') {
    return { ok: false, reason: 'bad-kind' };
  }
  var anon  = p.anonymous === true;
  var name  = String(p.name || '').trim();
  var email = String(p.email || '').trim();
  var body  = stripHtmlAndNormalize_(String(p.body || ''));

  if (!anon && !name) return { ok: false, reason: 'name-required' };
  if (email && !isLikelyEmail_(email)) return { ok: false, reason: 'bad-email' };
  if (body.length < cfg.bodyMinChars) return { ok: false, reason: 'body-too-short' };
  if (body.length > cfg.bodyMaxChars) return { ok: false, reason: 'body-too-long' };

  return {
    ok: true,
    kind: p.kind,
    anonymous: anon,
    name: name,
    email: email,
    body: body,
  };
}

// ── Telegram relay ───────────────────────────────────────────────
function relayToTelegram_(text) {
  var token = PropertiesService.getScriptProperties()
    .getProperty(TELEGRAM_PRAYER_BOT_TOKEN_KEY);
  if (!token) return { ok: false, error: 'no-token-configured' };
  try {
    var resp = UrlFetchApp.fetch(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          chat_id: '@seedtheword',
          message_thread_id: PRAYER_TOPIC_THREAD_ID,
          text: text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      });
    var code = resp.getResponseCode();
    var bodyText = resp.getContentText();
    if (code < 200 || code >= 300) {
      return { ok: false, error: 'http-' + code + ': ' + bodyText.slice(0, 400) };
    }
    var parsed = JSON.parse(bodyText);
    if (!parsed.ok) {
      return { ok: false, error: 'telegram-not-ok: ' + bodyText.slice(0, 400) };
    }
    return { ok: true, messageId: (parsed.result && parsed.result.message_id) || '' };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500) };
  }
}

// ── Prayers tab — audit-first phase 1 (append) and phase 2 (update) ──
//
// Phase 1: append a row with telegram_status='failed' placeholders.
// Phase 2: locate by submission_id and overwrite cols 8/9/10.
// PI1 (design §12) asserts: a Submission either appears as one row
// + one Telegram message (status='sent'), or one row alone
// (status='failed'); never a Telegram message without a row.
function appendPrayersRow_(fields) {
  var sheet = openTab(PRAYERS_TAB, PRAYERS_HEADERS);
  var row = [
    String(fields.submissionId || ''),
    fields.receivedAt instanceof Date ? fields.receivedAt.toISOString()
                                      : String(fields.receivedAt || ''),
    String(fields.kind || ''),
    String(fields.submitterName || ''),
    String(fields.submitterEmail || ''),
    fields.anonymous === true ? 'TRUE' : 'FALSE',
    String(fields.body || ''),
    String(fields.telegramStatus || 'failed'),
    fields.telegramMessageId === '' || fields.telegramMessageId == null
      ? '' : String(fields.telegramMessageId),
    String(fields.telegramError || ''),
    String(fields.dripStatus || ''),
    String(fields.unsubscribeToken || ''),
    String(fields.clientIpHash || ''),
    String(fields.versesJson || ''),
  ];
  sheet.appendRow(row);
}

function updatePrayersRowTelegramStatus_(submissionId, status, msgId, errText) {
  var sheet = openTab(PRAYERS_TAB, PRAYERS_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;
  var idx = headerIndex_(values[0]);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idx.submission_id]) === String(submissionId)) {
      // 1-based row, 1-based column for getRange.
      sheet.getRange(i + 1, idx.telegram_status + 1).setValue(String(status || ''));
      sheet.getRange(i + 1, idx.telegram_message_id + 1).setValue(msgId === '' || msgId == null ? '' : String(msgId));
      sheet.getRange(i + 1, idx.telegram_error + 1).setValue(String(errText || ''));
      return true;
    }
  }
  return false;
}

// ── Header → index map (used by both Prayers and PrayerDrip) ────
function headerIndex_(headerRow) {
  var idx = {};
  for (var i = 0; i < headerRow.length; i++) {
    idx[String(headerRow[i]).trim()] = i;
  }
  return idx;
}

// ── HMAC unsubscribe token ──────────────────────────────────────
function computeUnsubscribeToken_(submissionId) {
  var secret = PropertiesService.getScriptProperties()
    .getProperty(PRAYER_INTAKE_UNSUBSCRIBE_SECRET_KEY);
  if (!secret) throw new Error('PRAYER_INTAKE_UNSUBSCRIBE_SECRET not set');
  var sig = Utilities.computeHmacSha256Signature(String(submissionId), secret);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function resolveUnsubscribeToken_(token) {
  if (!token || typeof token !== 'string') return { ok: false };
  var sheet = openTab(PRAYERS_TAB, PRAYERS_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false };
  var idx = headerIndex_(values[0]);
  for (var i = 1; i < values.length; i++) {
    if (values[i][idx.unsubscribe_token] === token) {
      return { ok: true, submissionId: String(values[i][idx.submission_id]) };
    }
  }
  return { ok: false };
}

function flipDripRowsToUnsubscribed_(submissionId) {
  var sheet = openTab(DRIP_LOG_TAB, PRAYER_DRIP_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var idx = headerIndex_(values[0]);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idx.submission_id]) === String(submissionId)) {
      sheet.getRange(i + 1, idx.unsubscribed + 1).setValue(true);
      // Flip pending → unsubscribed so the cron does not need to recheck.
      if (values[i][idx.status] === 'pending') {
        sheet.getRange(i + 1, idx.status + 1).setValue('unsubscribed');
        sheet.getRange(i + 1, idx.timestamp + 1).setValue(new Date().toISOString());
      }
    }
  }
}

// ── doGet handler for prayer-unsubscribe ────────────────────────
function handlePrayerUnsubscribe_(token) {
  var resolved;
  try {
    resolved = resolveUnsubscribeToken_(token);
  } catch (err) {
    console.log('handlePrayerUnsubscribe_: resolve failed: ' + err);
    resolved = { ok: false };
  }
  if (!resolved.ok) {
    return htmlPage_(
      'Unsubscribe link is not valid',
      '<p>This unsubscribe link is invalid or expired. ' +
      'If you would like to stop receiving the encouragement emails, please email ' +
      '<a href="mailto:' + TEAM_INBOX + '">' + TEAM_INBOX + '</a>.</p>'
    );
  }
  try {
    flipDripRowsToUnsubscribed_(resolved.submissionId);
  } catch (err) {
    console.log('handlePrayerUnsubscribe_: flip failed: ' + err);
  }
  return htmlPage_(
    'You have been unsubscribed',
    '<p>You will not receive any further encouragement emails from this submission. ' +
    'Your prayer is still with the team. Thank you for letting us walk a few steps with you.</p>'
  );
}

function htmlPage_(title, bodyHtml) {
  var html =
    '<!doctype html><html lang="en"><head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + escapeHtml(title) + '</title>' +
      '<style>' +
        'body{background:#f7f3ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:48px 16px;color:#2b2b2b;line-height:1.6;}' +
        '.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e8e4de;border-radius:14px;overflow:hidden;}' +
        '.band{height:6px;background:linear-gradient(to right,#2C5F2E 0 30%,#d4a574 30% 70%,#2C5F2E 70%);}' +
        'h1{font-family:Georgia,serif;font-size:24px;font-weight:400;color:#2C5F2E;margin:24px 32px 12px;}' +
        'p{margin:0 32px 16px;}' +
        '.foot{font-size:12px;color:#666;padding:16px 32px;border-top:1px solid #e8e4de;background:#fcfaf6;}' +
      '</style>' +
    '</head><body>' +
      '<div class="card">' +
        '<div class="band"></div>' +
        '<h1>' + escapeHtml(title) + '</h1>' +
        bodyHtml +
        '<div class="foot">Seed the Word Ministry</div>' +
      '</div>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

// ── Verse + template loaders (cache-fronted) ────────────────────
function loadDailyVerses_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(VERSES_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (_) {}
  }
  try {
    var resp = UrlFetchApp.fetch(SITE_URL + 'assets/data/daily-verses.json',
      { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      var json = JSON.parse(resp.getContentText());
      var verses = (json && Array.isArray(json.verses)) ? json.verses : [];
      cache.put(VERSES_CACHE_KEY, JSON.stringify(verses), CACHE_SECONDS);
      return verses;
    }
  } catch (err) {
    console.log('loadDailyVerses_: ' + err);
  }
  // No fresh fetch + nothing cached → throw so caller surfaces error.
  throw new Error('daily-verses.json unavailable');
}

function loadDripTemplates_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(TEMPLATES_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (_) {}
  }
  try {
    // The drip templates JSON ships in the repo at
    // docs/apps-script/prayer-drip-templates.json. Fetched via the
    // GitHub Pages URL because that path is publicly readable.
    var resp = UrlFetchApp.fetch(
      SITE_URL + 'docs/apps-script/prayer-drip-templates.json',
      { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      var json = JSON.parse(resp.getContentText());
      cache.put(TEMPLATES_CACHE_KEY, JSON.stringify(json), CACHE_SECONDS);
      return json;
    }
  } catch (err) {
    console.log('loadDripTemplates_: ' + err);
  }
  throw new Error('prayer-drip-templates.json unavailable');
}

// ── Drip email rendering ────────────────────────────────────────
//
// `prayer` is the Prayers row already projected as an object (see
// loadPrayersById_). `dripDay` is one of 0/3/7/14. Returns
// { subject, html, text }.
function renderDripEmail_(prayer, dripDay, cfg) {
  var sal = salutation(prayer);
  var verses = [];
  try { verses = JSON.parse(prayer.verses_json || '[]'); } catch (_) { verses = []; }
  var dayIdx = (cfg.dripDays || [0, 3, 7, 14]).indexOf(dripDay);
  if (dayIdx < 0) dayIdx = 0;
  var verse = verses[dayIdx] || verses[0] || { text: '', ref: '', version: '' };

  var templates = {};
  try { templates = loadDripTemplates_(); } catch (_) { templates = {}; }
  var picks = parseDripTemplatesPicks_(prayer.submission_id, templates);

  var endpoint = String(cfg.endpointUrl || '');
  var unsubUrl = endpoint
    ? endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&')
        + 'action=prayer-unsubscribe&token=' + encodeURIComponent(prayer.unsubscribe_token || '')
    : '';

  var kindIsPrayer = prayer.kind === 'prayer';
  var subject;
  var bodyParas = [];

  if (dripDay === 0) {
    subject = kindIsPrayer ? "We're praying for you 💌" : "Thanksgiving received 🙏";
    bodyParas.push('Hi ' + sal + ',');
    bodyParas.push('We received your ' + (kindIsPrayer ? 'prayer request' : 'thanksgiving') +
      ' and the team is ' + (kindIsPrayer ? 'praying with you' : 'praising God with you') + '.');
    bodyParas.push(verseHtml_(verse));
    bodyParas.push('We will send a short note in three days with a verse to hold onto. In the meantime, you are not alone in this.');
  } else if (dripDay === 3) {
    subject = 'Three days in — a verse to hold onto';
    bodyParas.push(sal + ',');
    bodyParas.push(verseHtml_(verse));
    if (picks.day3_reflection) bodyParas.push(escapeHtml(picks.day3_reflection));
    if (picks.day3_tip) bodyParas.push(escapeHtml(picks.day3_tip));
  } else if (dripDay === 7) {
    subject = 'One week — a longer Scripture for you';
    bodyParas.push(sal + ',');
    bodyParas.push(verseHtml_(verse));
    if (picks.day7_reflection) bodyParas.push(escapeHtml(picks.day7_reflection));
  } else if (dripDay === 14) {
    subject = 'Two weeks — an invitation';
    bodyParas.push(sal + ',');
    bodyParas.push(verseHtml_(verse));
    if (picks.day14_invitation) bodyParas.push(escapeHtml(picks.day14_invitation));
  } else {
    subject = 'A note from Seed the Word';
    bodyParas.push(sal + ',');
    bodyParas.push(verseHtml_(verse));
  }

  bodyParas.push('— Seed the Word Ministry');

  var bodyHtml = bodyParas.map(function (p) {
    return '<p style="margin:0 0 1rem;">' + p + '</p>';
  }).join('');

  if (unsubUrl) {
    bodyHtml += '<p style="margin:1.5rem 0 0;font-size:12px;color:#666;">' +
      '<a href="' + escapeHtml(unsubUrl) + '" style="color:#666;">' +
      'Unsubscribe from these encouragement emails' +
      '</a></p>';
  }

  var html = emailShell({
    headerTitle: subject,
    headerSubtitle: '',
    bodyHtml: bodyHtml,
    footerHtml: 'Seed the Word Ministry',
    includeMinistryFooter: false,
  });

  // Plain-text fallback — strip tags, collapse whitespace, append unsub URL.
  var text = stripHtmlAndNormalize_(bodyHtml).replace(/\s+/g, ' ').trim();
  if (unsubUrl) {
    text += '\n\nUnsubscribe: ' + unsubUrl;
  }

  return { subject: subject, html: html, text: text };
}

function verseHtml_(v) {
  if (!v || !v.text) return '';
  return '<em style="font-family:Georgia,serif;color:#2C5F2E;">' + escapeHtml(v.text) + '</em>' +
    '<br><span style="color:#666;font-size:0.9em;">— ' +
    escapeHtml(String(v.ref || '')) +
    (v.version ? ' (' + escapeHtml(String(v.version)) + ')' : '') +
    '</span>';
}

// ── Day 0 inline send + Days 3/7/14 enqueue ──────────────────────
function enqueueAndSendDay0_(args) {
  // Build the prayer-row projection used by renderDripEmail_.
  var prayerRow = {
    submission_id: args.submissionId,
    submitter_name: args.submitterName,
    submitter_email: args.submitterEmail,
    anonymous: args.anonymous,
    kind: args.kind,
    body: args.body,
    verses_json: JSON.stringify(args.verses || []),
    unsubscribe_token: args.unsubscribeToken || '',
  };

  // Day 0 fires inline.
  var day0Status = 'failed';
  var day0Error = '';
  try {
    var rendered = renderDripEmail_(prayerRow, 0, args.cfg);
    MailApp.sendEmail({
      to: args.submitterEmail,
      subject: rendered.subject,
      htmlBody: rendered.html,
      body: rendered.text,
      replyTo: TEAM_INBOX,
      name: 'Seed the Word Ministry',
      noReply: true,
    });
    day0Status = 'sent';
  } catch (err) {
    day0Error = String(err).slice(0, 500);
    console.log('Day 0 send failed: ' + err);
  }

  // Write Day 0 row in its terminal state.
  try {
    var sheet = openTab(DRIP_LOG_TAB, PRAYER_DRIP_HEADERS);
    sheet.appendRow([
      args.submissionId, 0, day0Status, new Date().toISOString(),
      day0Error, false,
    ]);
  } catch (err) {
    console.log('PrayerDrip Day 0 append failed: ' + err);
  }

  // Days 3/7/14 are written as 'pending' with scheduled fire times.
  enqueueDripRows_(args.submissionId, args.receivedAt, args.cfg.dripDays);
}

function enqueueDripRows_(submissionId, receivedAt, dripDays) {
  if (!Array.isArray(dripDays) || !dripDays.length) return;
  var sheet = openTab(DRIP_LOG_TAB, PRAYER_DRIP_HEADERS);
  var rows = [];
  for (var i = 0; i < dripDays.length; i++) {
    var day = Number(dripDays[i]);
    if (day === 0) continue;            // Day 0 is written terminally elsewhere
    if (!isFinite(day) || day < 0) continue;
    var fireAt = new Date(receivedAt.getTime() + day * 24 * 60 * 60 * 1000);
    rows.push([submissionId, day, 'pending', fireAt.toISOString(), '', false]);
  }
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PRAYER_DRIP_HEADERS.length)
         .setValues(rows);
  }
}

// ── Drip cron — every 30 minutes ────────────────────────────────
function processPrayerDrip_() {
  _markAppsScriptRan('processPrayerDrip_');
  var cfg = loadIntakeConfig_();
  if (!cfg.dripEnabled) {
    console.log('processPrayerDrip_: dripEnabled=false; exiting.');
    return;
  }
  var sheet = openTab(DRIP_LOG_TAB, PRAYER_DRIP_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var header = values[0];
  var idx = headerIndex_(header);
  var now = new Date();
  var prayersById = loadPrayersById_();

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row[idx.status] !== 'pending') continue;
    if (row[idx.unsubscribed] === true || row[idx.unsubscribed] === 'TRUE') continue;
    var fireAt = new Date(row[idx.timestamp]);
    if (isNaN(fireAt.getTime()) || fireAt > now) continue;

    var submissionId = String(row[idx.submission_id]);
    var dripDay = Number(row[idx.drip_day]);
    var prayer = prayersById[submissionId];
    if (!prayer) {
      writeDripRowStatus_(sheet, i + 1, idx, 'failed', new Date(),
        'no matching prayers row');
      continue;
    }

    var lock = LockService.getScriptLock();
    var locked = false;
    try {
      lock.waitLock(15000);
      locked = true;
      // Re-read the row inside the lock to confirm still pending.
      var fresh = sheet.getRange(i + 1, 1, 1, header.length).getValues()[0];
      if (fresh[idx.status] !== 'pending') continue;
      if (fresh[idx.unsubscribed] === true || fresh[idx.unsubscribed] === 'TRUE') continue;

      var rendered = renderDripEmail_(prayer, dripDay, cfg);
      MailApp.sendEmail({
        to: prayer.submitter_email,
        subject: rendered.subject,
        htmlBody: rendered.html,
        body: rendered.text,
        replyTo: TEAM_INBOX,
        name: 'Seed the Word Ministry',
        noReply: true,
      });
      writeDripRowStatus_(sheet, i + 1, idx, 'sent', new Date(), '');
    } catch (err) {
      console.log('processPrayerDrip_ row ' + (i + 1) + ': ' + err);
      writeDripRowStatus_(sheet, i + 1, idx, 'failed', new Date(),
        String(err).slice(0, 500));
    } finally {
      if (locked) {
        try { lock.releaseLock(); } catch (_) {}
      }
    }
  }
}

function writeDripRowStatus_(sheet, rowNumber, idx, status, ts, errText) {
  sheet.getRange(rowNumber, idx.status + 1).setValue(String(status || ''));
  sheet.getRange(rowNumber, idx.timestamp + 1).setValue(
    ts instanceof Date ? ts.toISOString() : String(ts || ''));
  sheet.getRange(rowNumber, idx.error + 1).setValue(String(errText || ''));
}

function loadPrayersById_() {
  var sheet = openTab(PRAYERS_TAB, PRAYERS_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};
  var idx = headerIndex_(values[0]);
  var out = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var id = String(row[idx.submission_id] || '');
    if (!id) continue;
    out[id] = {
      submission_id: id,
      received_at: String(row[idx.received_at] || ''),
      kind: String(row[idx.kind] || ''),
      submitter_name: String(row[idx.submitter_name] || ''),
      submitter_email: String(row[idx.submitter_email] || ''),
      anonymous: row[idx.anonymous] === true ||
                 String(row[idx.anonymous] || '').toUpperCase() === 'TRUE',
      body: String(row[idx.body] || ''),
      drip_status: String(row[idx.drip_status] || ''),
      unsubscribe_token: String(row[idx.unsubscribe_token] || ''),
      verses_json: String(row[idx.verses_json] || ''),
    };
  }
  return out;
}

// ── One-shot trigger installer ──────────────────────────────────
//
// Run this ONCE from the Apps Script editor's function dropdown to
// create the every-30-minute time trigger that fires processPrayerDrip_.
function installPrayerDripTrigger_() {
  // Idempotent — remove any previously installed trigger first.
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'processPrayerDrip_') {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  ScriptApp.newTrigger('processPrayerDrip_')
    .timeBased()
    .everyMinutes(30)
    .create();
  console.log('installPrayerDripTrigger_: removed ' + removed + ', created 1.');
}

// ── One-shot full bootstrap ─────────────────────────────────────
//
// Single entry point for deploying the prayer-intake action. Run
// ONCE from the Apps Script editor's function dropdown after pasting
// this file into Code.gs — the function does everything otherwise
// done by hand:
//
//   1. Creates the `Prayers` tab if missing, writes the 14 header
//      columns, bolds the header row, freezes row 1, applies sane
//      default column widths.
//   2. Creates the `PrayerDrip` tab if missing, writes the 6 header
//      columns, same formatting.
//   3. Generates a 32-byte random PRAYER_INTAKE_UNSUBSCRIBE_SECRET
//      and stores it in Script Properties IFF one is not already set.
//      Re-running will NOT rotate an existing secret (rotating breaks
//      every previously-issued unsubscribe link, and the function is
//      idempotent on purpose).
//   4. Installs the every-30-min processPrayerDrip_ time trigger via
//      installPrayerDripTrigger_().
//   5. Logs the Sheet URL with deep-link gids for both tabs and a
//      checklist of what's now done vs what still needs to happen
//      (paste the Web App URL into telegram-bot.json, deploy a new
//      version of the web app).
//
// Idempotent — safe to re-run. The Prayers + PrayerDrip tabs use the
// existing openTab() helper which preserves data and only rewrites
// headers if they drift from PRAYERS_HEADERS / PRAYER_DRIP_HEADERS.
function installPrayerIntake() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);

  // ── Prayers tab ────────────────────────────────────────────────
  var prayers = openTab(PRAYERS_TAB, PRAYERS_HEADERS);
  prayers.getRange(1, 1, 1, PRAYERS_HEADERS.length).setFontWeight('bold');
  if (prayers.getFrozenRows() < 1) prayers.setFrozenRows(1);
  // Sane default widths so the tab is readable on first open.
  // submission_id (uuid) gets a wide column; body wider still.
  var prayersWidths = {
    submission_id: 220,        // uuid is ~36 chars
    received_at: 160,
    kind: 80,
    submitter_name: 150,
    submitter_email: 200,
    anonymous: 90,
    body: 360,
    telegram_status: 110,
    telegram_message_id: 120,
    telegram_error: 220,
    drip_status: 130,
    unsubscribe_token: 240,
    client_ip_hash: 200,
    verses_json: 240,
  };
  for (var i = 0; i < PRAYERS_HEADERS.length; i++) {
    var w = prayersWidths[PRAYERS_HEADERS[i]];
    if (w) prayers.setColumnWidth(i + 1, w);
  }

  // ── PrayerDrip tab ────────────────────────────────────────────
  var drip = openTab(DRIP_LOG_TAB, PRAYER_DRIP_HEADERS);
  drip.getRange(1, 1, 1, PRAYER_DRIP_HEADERS.length).setFontWeight('bold');
  if (drip.getFrozenRows() < 1) drip.setFrozenRows(1);
  var dripWidths = {
    submission_id: 220,
    drip_day: 80,
    status: 110,
    timestamp: 200,
    error: 280,
    unsubscribed: 110,
  };
  for (var j = 0; j < PRAYER_DRIP_HEADERS.length; j++) {
    var w2 = dripWidths[PRAYER_DRIP_HEADERS[j]];
    if (w2) drip.setColumnWidth(j + 1, w2);
  }

  // Apply a `status` column data-validation dropdown to the PrayerDrip
  // tab so admins can manually flip rows from the editor without typoing
  // a value the cron rejects. Mirrors the pattern from
  // installStatusDropdown for Orders.
  var statusColIdx = PRAYER_DRIP_HEADERS.indexOf('status') + 1;
  var dripStatusRange = drip.getRange(2, statusColIdx, 999, 1);
  var dripStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['pending', 'sent', 'failed', 'unsubscribed'], true)
    .setAllowInvalid(false)
    .setHelpText('Valid statuses: pending, sent, failed, unsubscribed')
    .build();
  dripStatusRange.setDataValidation(dripStatusRule);

  // The unsubscribed column is a checkbox.
  var unsubColIdx = PRAYER_DRIP_HEADERS.indexOf('unsubscribed') + 1;
  drip.getRange(2, unsubColIdx, 999, 1).insertCheckboxes();

  // ── Generate + store the unsubscribe HMAC secret ──────────────
  var props = PropertiesService.getScriptProperties();
  var existingSecret = props.getProperty(PRAYER_INTAKE_UNSUBSCRIBE_SECRET_KEY);
  var secretAction;
  if (!existingSecret) {
    // Cryptographically random 32-byte secret, base64-encoded ≈ 44 chars.
    var bytes = [];
    for (var k = 0; k < 32; k++) bytes.push(Math.floor(Math.random() * 256));
    // Apps Script lacks crypto.randomBytes; layer on Utilities.computeDigest
    // of (Math.random() seed + millis + UUID) for a second source of
    // entropy on top of Math.random(). The result is base64-web-safe.
    var seedRaw = Utilities.getUuid() + ':' + new Date().getTime() + ':' +
      Math.random() + ':' + Math.random();
    var digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, seedRaw);
    var secret = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
    props.setProperty(PRAYER_INTAKE_UNSUBSCRIBE_SECRET_KEY, secret);
    secretAction = '✓ generated and stored a new secret';
  } else {
    secretAction = '✓ secret already set; preserved';
  }

  // ── Install the drip cron ─────────────────────────────────────
  installPrayerDripTrigger_();

  // ── Verification log ──────────────────────────────────────────
  var sheetUrl = ss.getUrl();
  var prayersGid = prayers.getSheetId();
  var dripGid = drip.getSheetId();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  installPrayerIntake — bootstrap complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✓ Prayers tab ready (14 cols): ' + sheetUrl + '#gid=' + prayersGid);
  console.log('✓ PrayerDrip tab ready (6 cols): ' + sheetUrl + '#gid=' + dripGid);
  console.log('✓ ' + PRAYER_INTAKE_UNSUBSCRIBE_SECRET_KEY + ' ' + secretAction);
  console.log('✓ processPrayerDrip_ trigger installed (every 30 min)');
  console.log('');
  console.log('STILL TO DO (manual):');
  console.log('  1. Deploy → Manage deployments → ✏️ → New version → Deploy.');
  console.log('     (The web-app URL stays the same; just publishes new code.)');
  console.log('  2. The form is already enabled and pointed at the existing');
  console.log('     web-app URL on the live site. Submit one test through');
  console.log('     community.html to confirm the round-trip.');
  console.log('  3. To enable the four-step encouragement drip emails, flip');
  console.log('     prayer.intake.dripEnabled = true in telegram-bot.json');
  console.log('     (admin editor → Telegram bot config → Prayer → Intake).');
  console.log('═══════════════════════════════════════════════════════════');
}

// ── Orchestrator ────────────────────────────────────────────────
//
// Audit-first sequence (PI1, design §4.3). Steps 7→8→9 are the
// contract:
//   7. appendPrayersRow_ (pessimistic placeholder)
//   8. relayToTelegram_
//   9. updatePrayersRowTelegramStatus_
function handlePrayerIntake_(payload, _route) {
  // 1. Honeypot — silent accept-and-discard.
  if (payload && payload.extra_field_2) {
    console.log('Prayer intake honeypot triggered.');
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  // 2. Config + disabled gate.
  var cfg = loadIntakeConfig_();
  if (!cfg.enabled) {
    return jsonResponse({ ok: false, error: 'disabled' });
  }

  // 3. Validate.
  var v = validatePrayerIntake_(payload, cfg);
  if (!v.ok) {
    return jsonResponse({ ok: false, error: v.reason });
  }

  // 4. Rate-limit (generic error per Requirement 10.6).
  var ipHash = clientIpHash_(payload);
  var emailKey = (v.email || '').toLowerCase();
  if (!checkRateLimits_(ipHash, emailKey)) {
    return jsonResponse({ ok: false, error: 'rate-limit' });
  }

  // 5. Build the Submission record.
  var submissionId = Utilities.getUuid();
  var receivedAt = new Date();

  // Pre-pick the four verses (deterministic per submissionId).
  var verses = [];
  try {
    verses = pickVersesForSubmission_(submissionId, cfg.dripDays, loadDailyVerses_());
  } catch (err) {
    console.log('pickVerses failed (non-fatal): ' + err);
    verses = [];
  }

  // 6. Telegram message assembly (no I/O yet).
  var assembled = buildTelegramMessage_({
    kind: v.kind,
    submitterName: v.name,
    anonymous: v.anonymous,
    body: v.body,
    marker: cfg.marker,
  });

  // 7. Audit-first phase 1: append the row in the pessimistic
  //    'failed' shape. If THIS fails, we never call Telegram.
  var dripStatus = computeDripStatus_(v, cfg);
  var unsubscribeToken = '';
  if (dripStatus === 'enabled') {
    try { unsubscribeToken = computeUnsubscribeToken_(submissionId); }
    catch (err) {
      console.log('unsubscribe token compute failed: ' + err);
      return jsonResponse({ ok: false, error: 'sheet-write-failed' });
    }
  }
  try {
    appendPrayersRow_({
      submissionId: submissionId,
      receivedAt: receivedAt,
      kind: v.kind,
      submitterName: v.name,
      submitterEmail: v.email,
      anonymous: v.anonymous,
      body: v.body,
      telegramStatus: 'failed',
      telegramMessageId: '',
      telegramError: '',
      dripStatus: dripStatus,
      unsubscribeToken: unsubscribeToken,
      clientIpHash: ipHash,
      versesJson: JSON.stringify(verses),
    });
  } catch (err) {
    console.log('prayer-intake: audit append failed: ' + err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  // 8. Send to Telegram.
  var sendResult = relayToTelegram_(assembled.text);

  // 9. Phase 2: update the audit row with the Telegram outcome.
  try {
    updatePrayersRowTelegramStatus_(submissionId,
      sendResult.ok ? 'sent' : 'failed',
      sendResult.messageId || '',
      sendResult.error || '');
  } catch (err) {
    console.log('audit row update failed (audit row stays pessimistic): ' + err);
  }

  // 10. Drip enqueue + Day 0 inline send.
  if (dripStatus === 'enabled') {
    try {
      enqueueAndSendDay0_({
        submissionId: submissionId,
        receivedAt: receivedAt,
        submitterEmail: v.email,
        submitterName: v.name,
        anonymous: v.anonymous,
        kind: v.kind,
        body: v.body,
        verses: verses,
        unsubscribeToken: unsubscribeToken,
        cfg: cfg,
      });
    } catch (err) {
      console.log('drip enqueue/Day0 failed (non-fatal): ' + err);
    }
  }

  // 11. Response.
  return jsonResponse({
    ok: true,
    submissionId: submissionId,
    telegram: sendResult.ok ? 'sent' : 'failed',
    truncated: !!assembled.truncated,
    dripStatus: dripStatus,
  });
}


// ════════════════════════════════════════════════════════════════════
//
//   Bible Donate / Request — spec: bible-donate-request
//
//   Public-facing intake page at donate.html. One QR per physical
//   sign points here. Two flows:
//     • Donate a Bible — coordination only. Donor is good-faith;
//       admins coordinate handoff via email/Telegram.
//     • Receive a Bible — story-gated review. The 80-1500 char
//       story is the central security primitive; admins click
//       Approve or Decline in an email; decline is silent.
//
//   Architectural mirror of prayer-request-intake. Same web app,
//   same Sheet, same modal pattern, same rate limits, same HMAC
//   token machinery. New code is intentionally small.
//
//   See .kiro/specs/bible-donate-request/{requirements,design,tasks}.md
//
// ════════════════════════════════════════════════════════════════════

// ── Constants ──────────────────────────────────────────────────────
const BIBLES_TAB = 'Bibles';

const BIBLES_HEADERS = [
  'submission_id', 'received_at', 'kind', 'name', 'contact_email', 'contact_phone',
  'count', 'handoff_method', 'city', 'state', 'story', 'status',
  'reviewer_email', 'reviewed_at', 'decline_reason',
  'mailing_address', 'address_redacted_at',
  'sign_id', 'client_ip_hash',
  'telegram_status', 'telegram_message_id', 'telegram_error',
  'approve_token', 'decline_token', 'handoff_token',
  'reminder_sent_at',
];

// Script Property keys.
const BIBLE_REQUEST_REVIEW_SECRET_KEY = 'BIBLE_REQUEST_REVIEW_SECRET';

// Telegram admin topic for donate-side notifications. Left null at
// launch (email-only); operator sets this to a hidden admin topic's
// thread id later if they want Telegram relay too.
const BIBLE_DONATE_TELEGRAM_THREAD_ID = null;

// Story-field bounds (mirror of bible-donate-helpers exports).
const BIBLE_STORY_MIN_CHARS = 80;
const BIBLE_STORY_MAX_CHARS = 1500;

// Donor note bound.
const BIBLE_DONOR_NOTE_MAX_CHARS = 500;

// Donate-side count bounds.
const BIBLE_COUNT_MIN = 1;
const BIBLE_COUNT_MAX = 500;

// Sign id cap.
const BIBLE_SIGN_ID_MAX_CHARS = 50;

// Idempotency windows (days).
const BIBLE_DONATE_IDEMPOTENCY_DAYS = 1;
const BIBLE_RECEIVE_IDEMPOTENCY_DAYS = 7;

// Review SLO; cron emails admins again after this if no review yet.
const BIBLE_REVIEW_REMINDER_HOURS = 48;


// ── Pure helpers (mirrored from docs/apps-script/bible-donate-helpers.js) ──
//
// These are the Apps-Script-side copies, with leading underscores
// so they stay file-private. The canonical version lives in
// bible-donate-helpers.js and is imported by the Node test runner.
// Edit BOTH places in lockstep — the test suite is the safety net.
//
// Function names match the helpers file 1:1 so a future refactor
// to use Apps Script's library import (when/if that becomes worth
// the deployment friction) is a renaming exercise only.
function _isLikelyBibleEmail_(s) {
  if (typeof s !== 'string') return false;
  var t = s.trim();
  if (!t) return false;
  if (t.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function _stripHtmlAndNormalizeBible_(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}

function validateBibleDonate_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  var name = String(p.name || '').trim();
  var email = String(p.email || '').trim();
  var phone = String(p.phone || '').trim();
  var handoffMethod = String(p.handoffMethod || '').trim();
  var city = String(p.city || '').trim();
  var state = String(p.state || '').trim().toUpperCase().slice(0, 2);
  var note = _stripHtmlAndNormalizeBible_(String(p.note || ''));
  var signId = String(p.signId || '').trim().slice(0, BIBLE_SIGN_ID_MAX_CHARS);

  var countRaw = p.count;
  var count = (typeof countRaw === 'number')
    ? Math.floor(countRaw)
    : parseInt(String(countRaw || ''), 10);

  if (!name) return { ok: false, reason: 'name-required' };
  if (!email && !phone) return { ok: false, reason: 'contact-required' };
  if (email && !_isLikelyBibleEmail_(email)) return { ok: false, reason: 'bad-email' };
  if (!isFinite(count) || count < BIBLE_COUNT_MIN || count > BIBLE_COUNT_MAX) {
    return { ok: false, reason: 'bad-count' };
  }
  if (handoffMethod !== 'dropoff' && handoffMethod !== 'pickup') {
    return { ok: false, reason: 'bad-handoff' };
  }
  if (note.length > BIBLE_DONOR_NOTE_MAX_CHARS) {
    return { ok: false, reason: 'note-too-long' };
  }

  return {
    ok: true,
    name: name, email: email, phone: phone, count: count,
    handoffMethod: handoffMethod, city: city, state: state,
    note: note, signId: signId,
  };
}

function validateBibleRequest_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  var name = String(p.name || '').trim();
  var email = String(p.email || '').trim();
  var phone = String(p.phone || '').trim();
  var city = String(p.city || '').trim();
  var state = String(p.state || '').trim().toUpperCase().slice(0, 2);
  var story = _stripHtmlAndNormalizeBible_(String(p.story || ''));
  var signId = String(p.signId || '').trim().slice(0, BIBLE_SIGN_ID_MAX_CHARS);

  if (!name) return { ok: false, reason: 'name-required' };
  if (!email) return { ok: false, reason: 'email-required' };
  if (!_isLikelyBibleEmail_(email)) return { ok: false, reason: 'bad-email' };
  if (!city) return { ok: false, reason: 'city-required' };
  if (story.length < BIBLE_STORY_MIN_CHARS) return { ok: false, reason: 'story-too-short' };
  if (story.length > BIBLE_STORY_MAX_CHARS) return { ok: false, reason: 'story-too-long' };

  return {
    ok: true,
    name: name, email: email, phone: phone, city: city, state: state,
    story: story, signId: signId,
  };
}

// HMAC token signer — Apps Script side. Uses Utilities directly.
function computeBibleReviewToken_(submissionId, verb) {
  if (!submissionId) throw new Error('submissionId required');
  if (verb !== 'approve' && verb !== 'decline' && verb !== 'handoff') {
    throw new Error('unknown verb: ' + verb);
  }
  var secret = PropertiesService.getScriptProperties()
    .getProperty(BIBLE_REQUEST_REVIEW_SECRET_KEY);
  if (!secret) throw new Error(BIBLE_REQUEST_REVIEW_SECRET_KEY + ' not set');
  var sig = Utilities.computeHmacSha256Signature(
    String(submissionId) + '|' + String(verb), secret);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

// ── I/O wrappers ────────────────────────────────────────────────
function appendBiblesRow_(fields) {
  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var receivedIso = (fields.receivedAt instanceof Date)
    ? fields.receivedAt.toISOString()
    : String(fields.receivedAt || '');
  var row = [
    String(fields.submissionId || ''),
    receivedIso,
    String(fields.kind || ''),
    String(fields.name || ''),
    String(fields.contactEmail || ''),
    String(fields.contactPhone || ''),
    fields.count == null ? '' : Number(fields.count),
    String(fields.handoffMethod || ''),
    String(fields.city || ''),
    String(fields.state || ''),
    String(fields.story || ''),
    String(fields.status || ''),
    '',     // reviewer_email
    '',     // reviewed_at
    '',     // decline_reason
    '',     // mailing_address
    '',     // address_redacted_at
    String(fields.signId || ''),
    String(fields.clientIpHash || ''),
    String(fields.telegramStatus || ''),
    fields.telegramMessageId == null ? '' : String(fields.telegramMessageId),
    String(fields.telegramError || ''),
    String(fields.approveToken || ''),
    String(fields.declineToken || ''),
    String(fields.handoffToken || ''),
    '',     // reminder_sent_at
  ];
  sheet.appendRow(row);
}

function updateBiblesTelegramStatus_(submissionId, result) {
  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;
  var idx = headerIndex_(values[0]);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idx.submission_id]) === String(submissionId)) {
      sheet.getRange(i + 1, idx.telegram_status + 1).setValue(String(result.status || ''));
      sheet.getRange(i + 1, idx.telegram_message_id + 1).setValue(
        result.messageId == null ? '' : String(result.messageId));
      sheet.getRange(i + 1, idx.telegram_error + 1).setValue(String(result.error || ''));
      return true;
    }
  }
  return false;
}

// Apps-Script wrapper around findRecentSubmissionFromValues_.
function findRecentSubmission_(email, kind, daysWindow) {
  if (!email) return null;
  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  var idx = headerIndex_(values[0]);

  // Inline the pure-helper logic here so we don't pull in the
  // helpers file's exports (Apps Script doesn't have imports).
  if (!isFinite(daysWindow) || daysWindow <= 0) return null;
  var cutoff = Date.now() - daysWindow * 86400000;
  var targetEmail = String(email).toLowerCase();
  for (var i = values.length - 1; i >= 1; i--) {
    var row = values[i];
    if (!row) continue;
    if (String(row[idx.kind]) !== kind) continue;
    var rowEmail = String(row[idx.contact_email] || '').toLowerCase();
    if (rowEmail !== targetEmail) continue;
    var receivedAt = new Date(row[idx.received_at]);
    if (isNaN(receivedAt.getTime())) continue;
    if (receivedAt.getTime() < cutoff) continue;
    return {
      submissionId: String(row[idx.submission_id]),
      status: String(row[idx.status] || ''),
      rowIndex: i + 1,
    };
  }
  return null;
}

// Apps-Script wrapper around resolveBibleReviewTokenFromValues_.
function resolveBibleReviewToken_(token, verb) {
  if (!token || typeof token !== 'string') return { ok: false };
  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false };
  var idx = headerIndex_(values[0]);
  var col = -1;
  if (verb === 'approve') col = idx.approve_token;
  else if (verb === 'decline') col = idx.decline_token;
  else if (verb === 'handoff') col = idx.handoff_token;
  if (col == null || col < 0) return { ok: false };
  for (var i = 1; i < values.length; i++) {
    if (values[i] && values[i][col] === token) {
      return {
        ok: true,
        submissionId: String(values[i][idx.submission_id]),
        rowIndex: i + 1,
        currentStatus: String(values[i][idx.status] || ''),
      };
    }
  }
  return { ok: false };
}


// ── Donate-side handler ─────────────────────────────────────────
//
// Audit-first ordering: append the row in 'failed'/'skipped' shape,
// then attempt admin email + Telegram, then update the row with
// results. If the append itself fails, we never email or relay.
function handleBibleDonate_(payload, _route) {
  // 1. Honeypot — silent accept-and-discard.
  if (payload && payload.extra_field_2) {
    console.log('Bible donate honeypot triggered.');
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  // 2. Disabled gate — read from telegram-bot.json.
  var bibleCfg = _loadBibleDonateConfig_();
  if (!bibleCfg.enabled) {
    return jsonResponse({ ok: false, error: 'disabled' });
  }

  // 3. Validate.
  var v = validateBibleDonate_(payload);
  if (!v.ok) {
    return jsonResponse({ ok: false, error: v.reason });
  }

  // 4. Rate-limit (shared cache buckets with prayer-intake).
  var ipHash = clientIpHash_(payload);
  var emailKey = (v.email || '').toLowerCase();
  if (!checkRateLimits_(ipHash, emailKey)) {
    return jsonResponse({ ok: false, error: 'rate-limit' });
  }

  // 5. Idempotency — within the donate window (default 1 day).
  if (v.email) {
    var dup = findRecentSubmission_(v.email, 'donate', bibleCfg.donateIdempotencyDays);
    if (dup) {
      console.log('Bible donate idempotent duplicate: ' + dup.submissionId);
      return jsonResponse({
        ok: true,
        idempotent: true,
        submissionId: dup.submissionId,
        status: dup.status,
        kind: 'donate',
      });
    }
  }

  // 6. Build row.
  var submissionId = Utilities.getUuid();
  var receivedAt = new Date();

  // 7. Audit-first append (with pessimistic placeholders for telegram).
  try {
    appendBiblesRow_({
      submissionId: submissionId,
      receivedAt: receivedAt,
      kind: 'donate',
      name: v.name,
      contactEmail: v.email,
      contactPhone: v.phone,
      count: v.count,
      handoffMethod: v.handoffMethod,
      city: v.city,
      state: v.state,
      story: v.note,
      status: 'pending_fulfillment',
      signId: v.signId,
      clientIpHash: ipHash,
      telegramStatus: 'skipped',
      telegramMessageId: '',
      telegramError: '',
    });
  } catch (err) {
    console.log('handleBibleDonate_: append failed: ' + err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  // 8. Admin notification email (always).
  try {
    sendBibleDonateAdminEmail_(submissionId, v, receivedAt);
  } catch (err) {
    console.log('handleBibleDonate_: admin email failed (non-fatal): ' + err);
  }

  // 9. Optional Telegram relay (skipped when thread id is null).
  var telegramResult = sendBibleDonateTelegram_(v, submissionId);
  try {
    updateBiblesTelegramStatus_(submissionId, telegramResult);
  } catch (err) {
    console.log('handleBibleDonate_: telegram-status update failed (non-fatal): ' + err);
  }

  // 10. Donor thank-you (only when email provided).
  if (v.email) {
    try {
      sendBibleDonateThankYouEmail_(v, submissionId);
    } catch (err) {
      console.log('handleBibleDonate_: donor thank-you failed (non-fatal): ' + err);
    }
  }

  return jsonResponse({
    ok: true,
    submissionId: submissionId,
    kind: 'donate',
    handoffMethod: v.handoffMethod,
    telegram: telegramResult.status || 'skipped',
  });
}

// Read the bibleDonate config block off the deployed site's
// telegram-bot.json. Returns sane defaults when the fetch fails.
function _loadBibleDonateConfig_() {
  var url = SITE_URL + 'assets/data/telegram-bot.json';
  var raw = {};
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      raw = JSON.parse(resp.getContentText()) || {};
    }
  } catch (err) {
    console.log('_loadBibleDonateConfig_: fetch failed: ' + err);
  }
  var b = raw.bibleDonate || {};
  return {
    enabled: b.enabled === true,
    endpointUrl: String(b.endpointUrl || ''),
    storyMinChars: Number(b.storyMinChars) || BIBLE_STORY_MIN_CHARS,
    storyMaxChars: Number(b.storyMaxChars) || BIBLE_STORY_MAX_CHARS,
    donateIdempotencyDays: Number(b.donateIdempotencyDays) || BIBLE_DONATE_IDEMPOTENCY_DAYS,
    receiveIdempotencyDays: Number(b.receiveIdempotencyDays) || BIBLE_RECEIVE_IDEMPOTENCY_DAYS,
    reviewReminderHours: Number(b.reviewReminderHours) || BIBLE_REVIEW_REMINDER_HOURS,
  };
}

// Resolve the deployed web app URL for use in email links. Falls
// back to the script's `service` URL if the active deployment URL
// is not available — tests pass when this returns any non-empty
// string; production URL is what makes the buttons clickable.
function _bibleWebAppUrl_() {
  try {
    var url = ScriptApp.getService().getUrl();
    return url ? String(url) : '';
  } catch (_) {
    return '';
  }
}

// ── Donate-side email helpers ───────────────────────────────────
function sendBibleDonateAdminEmail_(submissionId, v, receivedAt) {
  var subject = '📚 New Bible donation offer from ' + v.name;
  var location = v.city ? (v.city + ', ' + (v.state || 'WA')) : 'location TBD';
  var contactLine = '';
  if (v.email && v.phone) contactLine = v.email + ' / ' + v.phone;
  else if (v.email) contactLine = v.email;
  else contactLine = v.phone;

  var bodyHtml = '' +
    '<p>A donor just offered a Bible through donate.html.</p>' +
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;">' +
      '<tr><td><strong>Name</strong></td><td>' + escapeHtml(v.name) + '</td></tr>' +
      '<tr><td><strong>Contact</strong></td><td>' + escapeHtml(contactLine) + '</td></tr>' +
      '<tr><td><strong>Count</strong></td><td>' + escapeHtml(String(v.count)) + '</td></tr>' +
      '<tr><td><strong>Handoff</strong></td><td>' + escapeHtml(v.handoffMethod === 'pickup' ? 'pickup at their place' : 'drop-off') + '</td></tr>' +
      '<tr><td><strong>Location</strong></td><td>' + escapeHtml(location) + '</td></tr>' +
      (v.signId ? ('<tr><td><strong>Sign</strong></td><td>' + escapeHtml(v.signId) + '</td></tr>') : '') +
      (v.note ? ('<tr><td><strong>Note</strong></td><td>' + escapeHtml(v.note) + '</td></tr>') : '') +
      '<tr><td><strong>Submitted</strong></td><td>' + escapeHtml(receivedAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })) + '</td></tr>' +
      '<tr><td><strong>Submission</strong></td><td><code>' + escapeHtml(submissionId) + '</code></td></tr>' +
    '</table>' +
    '<p>Reach out within 48 hours to coordinate. The donor has already received a thank-you email.</p>';

  var html = emailShell({
    headerTitle: 'New Bible donation offer',
    headerSubtitle: '📚 An admin coordination email',
    bodyHtml: bodyHtml,
    footerHtml: '<p>— The Seed the Word team</p>',
  });

  MailApp.sendEmail({
    to: TEAM_INBOX,
    subject: subject,
    htmlBody: html,
    body: 'New Bible donation offer from ' + v.name + ' — see HTML version.',
    name: 'Seed the Word Ministry',
    noReply: true,
  });
}

function sendBibleDonateThankYouEmail_(v, submissionId) {
  var subject = 'Thank you for the Bible' + (v.count > 1 ? 's' : '') + ' 📚';
  var bodyHtml = '' +
    '<p>' + escapeHtml(v.name) + ',</p>' +
    '<p>Thank you for offering ' + escapeHtml(String(v.count)) + ' Bible' + (v.count > 1 ? 's' : '') + '. ' +
      'Our team will reach out within 48 hours to coordinate ' +
      escapeHtml(v.handoffMethod === 'pickup' ? 'pickup at your place' : 'drop-off') +
      (v.city ? ' in ' + escapeHtml(v.city) : '') + '.</p>' +
    '<p>If your plans change, just reply to this email — it goes straight to our team.</p>' +
    '<p>While you\'re here, you might enjoy seeing how we use these Bibles: ' +
      '<a href="' + SITE_URL + 'how-to-seed.html">how we seed the Word</a>, or ' +
      '<a href="' + SITE_URL + 'store.html">the bundles we send to gifters</a>.</p>' +
    '<p>Sincerely,<br>The Seed the Word team</p>';

  var html = emailShell({
    headerTitle: 'Thank you for offering a Bible',
    headerSubtitle: '📚',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: v.email,
    subject: subject,
    htmlBody: html,
    body: 'Thank you for offering ' + v.count + ' Bible(s). The team will reach out within 48 hours.',
    name: 'Seed the Word Ministry',
    replyTo: TEAM_INBOX,
    noReply: true,
  });
}

// ── Donate-side Telegram relay (optional) ───────────────────────
function sendBibleDonateTelegram_(v, submissionId) {
  if (BIBLE_DONATE_TELEGRAM_THREAD_ID == null) {
    return { status: 'skipped', error: 'no-thread-configured', messageId: '' };
  }
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return { status: 'skipped', error: 'no-token', messageId: '' };

  var name = mdv2Escape_(v.name);
  var location = mdv2Escape_(v.city ? (v.city + ', ' + (v.state || 'WA')) : 'location TBD');
  var method = mdv2Escape_(v.handoffMethod === 'pickup' ? 'pickup at their place' : 'drop-off');
  var msg = '\uD83D\uDCDA *New Bible donation offer*\n' +
    'From: ' + name + '\n' +
    'Count: ' + mdv2Escape_(String(v.count)) + '\n' +
    'Handoff: ' + method + '\n' +
    'Location: ' + location;

  try {
    var resp = UrlFetchApp.fetch(
      'https://api.telegram.org/bot' + token + '/sendMessage',
      {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          chat_id: '@seedtheword',
          message_thread_id: BIBLE_DONATE_TELEGRAM_THREAD_ID,
          text: msg,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      return { status: 'failed', error: 'http-' + code, messageId: '' };
    }
    var parsed = JSON.parse(resp.getContentText());
    if (!parsed.ok) return { status: 'failed', error: 'non-ok', messageId: '' };
    return {
      status: 'sent',
      error: '',
      messageId: (parsed.result && parsed.result.message_id) || '',
    };
  } catch (err) {
    return { status: 'failed', error: String(err).slice(0, 500), messageId: '' };
  }
}


// ── Receive-side handler ────────────────────────────────────────
//
// Story-gated review flow. Audit-first append; review email goes
// to TEAM_INBOX with HMAC-signed approve/decline links. NO email
// to the requester at intake. NO Telegram relay at intake.
function handleBibleRequest_(payload, _route) {
  // 1. Honeypot.
  if (payload && payload.extra_field_2) {
    console.log('Bible receive honeypot triggered.');
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  // 2. Disabled gate.
  var bibleCfg = _loadBibleDonateConfig_();
  if (!bibleCfg.enabled) {
    return jsonResponse({ ok: false, error: 'disabled' });
  }

  // 3. Validate (story length is the central gate).
  var v = validateBibleRequest_(payload);
  if (!v.ok) return jsonResponse({ ok: false, error: v.reason });

  // 4. Rate-limit.
  var ipHash = clientIpHash_(payload);
  var emailKey = (v.email || '').toLowerCase();
  if (!checkRateLimits_(ipHash, emailKey)) {
    return jsonResponse({ ok: false, error: 'rate-limit' });
  }

  // 5. Idempotency — within the receive window (default 7 days).
  var dup = findRecentSubmission_(v.email, 'receive', bibleCfg.receiveIdempotencyDays);
  if (dup) {
    console.log('Bible receive idempotent duplicate: ' + dup.submissionId);
    return jsonResponse({
      ok: true,
      idempotent: true,
      submissionId: dup.submissionId,
      status: dup.status,
      kind: 'receive',
    });
  }

  // 6. Build row + tokens.
  var submissionId = Utilities.getUuid();
  var receivedAt = new Date();
  var approveToken, declineToken, handoffToken;
  try {
    approveToken = computeBibleReviewToken_(submissionId, 'approve');
    declineToken = computeBibleReviewToken_(submissionId, 'decline');
    handoffToken = computeBibleReviewToken_(submissionId, 'handoff');
  } catch (err) {
    console.log('handleBibleRequest_: token signing failed: ' + err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  // 7. Audit-first append.
  try {
    appendBiblesRow_({
      submissionId: submissionId,
      receivedAt: receivedAt,
      kind: 'receive',
      name: v.name,
      contactEmail: v.email,
      contactPhone: v.phone,
      count: 1,
      handoffMethod: '',
      city: v.city,
      state: v.state,
      story: v.story,
      status: 'pending_review',
      signId: v.signId,
      clientIpHash: ipHash,
      telegramStatus: '',          // receive-side never relays at intake
      telegramMessageId: '',
      telegramError: '',
      approveToken: approveToken,
      declineToken: declineToken,
      handoffToken: handoffToken,
    });
  } catch (err) {
    console.log('handleBibleRequest_: append failed: ' + err);
    return jsonResponse({ ok: false, error: 'sheet-write-failed' });
  }

  // 8. Review email to TEAM_INBOX with HMAC links.
  try {
    sendBibleRequestReviewEmail_({
      submissionId: submissionId,
      receivedAt: receivedAt,
      name: v.name,
      email: v.email,
      phone: v.phone,
      city: v.city,
      state: v.state,
      story: v.story,
      signId: v.signId,
      approveToken: approveToken,
      declineToken: declineToken,
    });
  } catch (err) {
    console.log('handleBibleRequest_: review email failed (non-fatal): ' + err);
  }

  // 9. NO requester email. NO Telegram. Cron handles 48h reminder.

  return jsonResponse({
    ok: true,
    submissionId: submissionId,
    kind: 'receive',
    status: 'pending_review',
  });
}

// ── Receive-side review email ───────────────────────────────────
function sendBibleRequestReviewEmail_(args) {
  var webApp = _bibleWebAppUrl_();
  var approveUrl = webApp + '?action=bible-request-approve&token=' + encodeURIComponent(args.approveToken);
  var declineUrl = webApp + '?action=bible-request-decline&token=' + encodeURIComponent(args.declineToken);

  var subject = '📖 Bible request from ' + args.name + ' — review needed';

  var contactLines = '';
  if (args.email) contactLines += '<tr><td><strong>Email</strong></td><td>' + escapeHtml(args.email) + '</td></tr>';
  if (args.phone) contactLines += '<tr><td><strong>Phone</strong></td><td>' + escapeHtml(args.phone) + '</td></tr>';

  var bodyHtml = '' +
    '<p>A new Bible request just came in.</p>' +
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;">' +
      '<tr><td><strong>Name</strong></td><td>' + escapeHtml(args.name) + '</td></tr>' +
      contactLines +
      '<tr><td><strong>Location</strong></td><td>' + escapeHtml(args.city) + ', ' + escapeHtml(args.state || 'WA') + '</td></tr>' +
      (args.signId ? ('<tr><td><strong>Sign</strong></td><td>' + escapeHtml(args.signId) + '</td></tr>') : '') +
      '<tr><td><strong>Submitted</strong></td><td>' + escapeHtml(args.receivedAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })) + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:1.5rem;"><strong>Their story:</strong></p>' +
    '<blockquote style="margin:0.5rem 1rem;padding:0.75rem 1rem;border-left:4px solid #2C5F2E;background:#f7f3ec;font-style:italic;line-height:1.6;">' +
      escapeHtml(args.story).replace(/\n/g, '<br>') +
    '</blockquote>' +
    '<p style="margin-top:1.5rem;text-align:center;">' +
      '<a href="' + approveUrl + '" style="display:inline-block;padding:14px 28px;margin:0 8px;background:#2C5F2E;color:#fff;font-weight:700;text-decoration:none;border-radius:6px;">Approve and email handoff form</a>' +
      '&nbsp;' +
      '<a href="' + declineUrl + '" style="display:inline-block;padding:14px 28px;margin:0 8px;background:#fff;color:#666;border:1.5px solid #ccc;font-weight:700;text-decoration:none;border-radius:6px;">Decline silently</a>' +
    '</p>' +
    '<p style="font-size:12px;color:#666;margin-top:2rem;line-height:1.55;">' +
      'Reminder of how the gate works:<br>' +
      '• Default-trust posture — lean toward yes.<br>' +
      '• Decline is silent: no email is sent to the requester.<br>' +
      '• If unreviewed after 48 hours, you\'ll get a reminder email.<br>' +
      '• To add a private decline reason, append <code>&amp;reason=&lt;short note&gt;</code> to the decline link before clicking.' +
    '</p>';

  var html = emailShell({
    headerTitle: 'New Bible request — review needed',
    headerSubtitle: '📖',
    bodyHtml: bodyHtml,
    footerHtml: '<p>— The Seed the Word team</p>',
  });

  MailApp.sendEmail({
    to: TEAM_INBOX,
    subject: subject,
    htmlBody: html,
    body: 'New Bible request from ' + args.name + ' — see HTML version. Approve: ' + approveUrl + '  Decline: ' + declineUrl,
    name: 'Seed the Word Ministry',
    noReply: true,
  });
}

// ── doGet branches: approve / decline / handoff ─────────────────
//
// The existing prayer-unsubscribe doGet already lives in this file.
// We extend the same dispatcher with three new actions. The actual
// doGet function lives further down (handlePrayerUnsubscribe_'s
// neighbor); these handlers are what it dispatches to.

function handleBibleRequestApprove_(token, _params) {
  var resolved = resolveBibleReviewToken_(token, 'approve');
  if (!resolved.ok) {
    return htmlPage_(
      'Approve link is not valid',
      '<p>This approve link is invalid or expired. ' +
      'If you need to coordinate, please email ' +
      '<a href="mailto:' + TEAM_INBOX + '">' + TEAM_INBOX + '</a>.</p>'
    );
  }
  // Idempotent on already-terminal states.
  if (resolved.currentStatus === 'approved'
   || resolved.currentStatus === 'awaiting_handoff'
   || resolved.currentStatus === 'fulfilled') {
    return htmlPage_(
      'Already approved',
      '<p>This request was already approved. The requester has the handoff link.</p>'
    );
  }
  if (resolved.currentStatus !== 'pending_review') {
    return htmlPage_(
      'Cannot approve',
      '<p>This request is in status <code>' + escapeHtml(resolved.currentStatus) + '</code> and cannot be approved.</p>'
    );
  }

  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  var idx = headerIndex_(values[0]);
  var reviewerEmail = '';
  try { reviewerEmail = Session.getActiveUser().getEmail() || ''; } catch (_) {}
  if (!reviewerEmail) reviewerEmail = '(unknown)';

  sheet.getRange(resolved.rowIndex, idx.status + 1).setValue('approved');
  sheet.getRange(resolved.rowIndex, idx.reviewer_email + 1).setValue(reviewerEmail);
  sheet.getRange(resolved.rowIndex, idx.reviewed_at + 1).setValue(new Date().toISOString());

  var row = values[resolved.rowIndex - 1];
  var requesterEmail = String(row[idx.contact_email]);
  var requesterName = String(row[idx.name]);
  var handoffToken = String(row[idx.handoff_token]);

  try {
    sendBibleRequestApprovalEmail_({
      submissionId: resolved.submissionId,
      name: requesterName,
      email: requesterEmail,
      handoffToken: handoffToken,
    });
  } catch (err) {
    console.log('handleBibleRequestApprove_: approval email failed: ' + err);
  }

  return htmlPage_(
    'Approved',
    '<p>Approved. The requester will get an email with the handoff form within a minute.</p>' +
    '<p>You can close this tab.</p>'
  );
}

function handleBibleRequestDecline_(token, params) {
  var resolved = resolveBibleReviewToken_(token, 'decline');
  if (!resolved.ok) {
    return htmlPage_(
      'Decline link is not valid',
      '<p>This decline link is invalid or expired.</p>'
    );
  }
  if (resolved.currentStatus === 'declined') {
    return htmlPage_(
      'Already declined',
      '<p>This request was already declined.</p>'
    );
  }
  if (resolved.currentStatus !== 'pending_review') {
    return htmlPage_(
      'Cannot decline',
      '<p>This request is in status <code>' + escapeHtml(resolved.currentStatus) + '</code> and cannot be declined.</p>'
    );
  }

  var reason = String((params && params.reason) || '').slice(0, 500);
  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  var idx = headerIndex_(values[0]);
  var reviewerEmail = '';
  try { reviewerEmail = Session.getActiveUser().getEmail() || ''; } catch (_) {}
  if (!reviewerEmail) reviewerEmail = '(unknown)';

  sheet.getRange(resolved.rowIndex, idx.status + 1).setValue('declined');
  sheet.getRange(resolved.rowIndex, idx.reviewer_email + 1).setValue(reviewerEmail);
  sheet.getRange(resolved.rowIndex, idx.reviewed_at + 1).setValue(new Date().toISOString());
  sheet.getRange(resolved.rowIndex, idx.decline_reason + 1).setValue(reason);

  // SILENT: no email to the requester.

  return htmlPage_(
    'Declined',
    '<p>Declined. The requester is not notified — the decline is silent.</p>' +
    '<p>You can close this tab.</p>'
  );
}

function sendBibleRequestApprovalEmail_(args) {
  var webApp = _bibleWebAppUrl_();
  var handoffUrl = webApp + '?action=bible-request-handoff&token=' + encodeURIComponent(args.handoffToken);
  var subject = 'We have a Bible for you 📖';
  var bodyHtml = '' +
    '<p>Hi ' + escapeHtml(args.name) + ',</p>' +
    '<p>We\'re glad you wrote in. We have a Bible set aside for you.</p>' +
    '<p>To get it to you, we need one quick choice — drop-off in person at one of our meetings, or by mail. Tap below:</p>' +
    '<p style="text-align:center;margin:1.5rem 0;">' +
      '<a href="' + handoffUrl + '" style="display:inline-block;padding:14px 28px;background:#2C5F2E;color:#fff;font-weight:700;text-decoration:none;border-radius:6px;">' +
        'Pick how you\'d like to receive it →' +
      '</a>' +
    '</p>' +
    '<p>If drop-off works, we\'ll send you a couple of upcoming options. If you choose mail, you\'ll fill in a single line for your address on the next screen.</p>' +
    '<p>We\'re not in a rush, and you don\'t need to be. The form stays open for 14 days.</p>' +
    '<p>Sincerely,<br>The Seed the Word team</p>';

  var html = emailShell({
    headerTitle: 'A Bible for you',
    headerSubtitle: '📖',
    bodyHtml: bodyHtml,
  });

  MailApp.sendEmail({
    to: args.email,
    subject: subject,
    htmlBody: html,
    body: 'We have a Bible for you. Pick how you\'d like to receive it: ' + handoffUrl,
    name: 'Seed the Word Ministry',
    replyTo: TEAM_INBOX,
    noReply: true,
  });
}


// ── Handoff form (post-approval) ────────────────────────────────
//
// Two-phase: GET renders the form, "GET with submit=1" persists the
// choice. Apps Script web apps don't cleanly support form-action POST
// to themselves with GET-style query params, so the form posts back
// to the same doGet endpoint with a `submit=1` discriminator.
//
// Address is collected ONLY here (post-approval) and ONLY when the
// requester picks `mail`. PII at rest is minimized.
function handleBibleRequestHandoff_(token, params) {
  var resolved = resolveBibleReviewToken_(token, 'handoff');
  if (!resolved.ok) {
    return htmlPage_(
      'Link is not valid',
      '<p>This link is invalid or expired. Please email ' +
      '<a href="mailto:' + TEAM_INBOX + '">' + TEAM_INBOX + '</a> if you need to coordinate.</p>'
    );
  }
  if (resolved.currentStatus !== 'approved' && resolved.currentStatus !== 'awaiting_handoff') {
    return htmlPage_(
      'Not ready for handoff',
      '<p>This request is in status <code>' + escapeHtml(resolved.currentStatus) + '</code>. ' +
      'The handoff form opens once an admin has reviewed your request.</p>'
    );
  }

  var submitFlag = String((params && params.submit) || '').trim();
  if (submitFlag !== '1') {
    // GET — render the form.
    return htmlPage_(
      'Choose how to receive your Bible',
      _buildHandoffFormHtml_(token)
    );
  }

  // Submit — persist the choice.
  var method = String((params && params.handoff_method) || '').trim();
  var address = String((params && params.mailing_address) || '').slice(0, 400);

  if (method !== 'dropoff' && method !== 'mail') {
    return htmlPage_(
      'Pick one',
      _buildHandoffFormHtml_(token, { error: 'Please pick drop-off or mail.' })
    );
  }
  if (method === 'mail' && address.trim().length < 15) {
    return htmlPage_(
      'Address looks short',
      _buildHandoffFormHtml_(token, { error: 'Please enter a full mailing address.', method: 'mail', address: address })
    );
  }

  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  var idx = headerIndex_(values[0]);
  sheet.getRange(resolved.rowIndex, idx.handoff_method + 1).setValue(method);
  if (method === 'mail') {
    sheet.getRange(resolved.rowIndex, idx.mailing_address + 1).setValue(address);
  }
  sheet.getRange(resolved.rowIndex, idx.status + 1).setValue('awaiting_handoff');

  // Email TEAM_INBOX with coordination details.
  try {
    sendBibleHandoffNotifyEmail_({
      submissionId: resolved.submissionId,
      method: method,
      address: address,
      rowIndex: resolved.rowIndex,
    });
  } catch (err) {
    console.log('handleBibleRequestHandoff_: notify email failed (non-fatal): ' + err);
  }

  return htmlPage_(
    'Got it',
    '<p>Thank you. The team will be in touch to coordinate. If you chose drop-off, ' +
    'we\'ll send the next available meeting or cookout time. If you chose mail, ' +
    'expect the package within 7-14 days.</p>' +
    '<p><a href="' + SITE_URL + 'how-to-seed.html">Learn how we seed the Word →</a></p>'
  );
}

function _buildHandoffFormHtml_(token, opts) {
  opts = opts || {};
  var webApp = _bibleWebAppUrl_();
  var formAction = webApp + '?action=bible-request-handoff&token=' + encodeURIComponent(token) + '&submit=1';
  var prefilledMethod = String(opts.method || '');
  var prefilledAddress = String(opts.address || '');
  var errorBanner = opts.error
    ? '<p style="background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:0.75rem 1rem;border-radius:8px;">' +
        escapeHtml(opts.error) + '</p>'
    : '';

  // GET-form (Apps Script web app dispatcher reads params from doGet).
  return '' +
    errorBanner +
    '<p>How would you like to receive your Bible?</p>' +
    '<form method="get" action="' + escapeHtml(formAction) + '" style="line-height:2;">' +
      '<input type="hidden" name="action" value="bible-request-handoff">' +
      '<input type="hidden" name="token" value="' + escapeHtml(token) + '">' +
      '<input type="hidden" name="submit" value="1">' +
      '<label style="display:block;margin:0.5rem 0;">' +
        '<input type="radio" name="handoff_method" value="dropoff"' +
          (prefilledMethod === 'dropoff' ? ' checked' : '') + '> ' +
        '📍 <strong>Drop-off in person</strong> — at one of our meetings or cookouts. We\'ll email you upcoming times.' +
      '</label>' +
      '<label style="display:block;margin:0.5rem 0;">' +
        '<input type="radio" name="handoff_method" value="mail"' +
          (prefilledMethod === 'mail' ? ' checked' : '') + '> ' +
        '📦 <strong>Mail it to me</strong> — share your address below.' +
      '</label>' +
      '<label style="display:block;margin:1rem 0 0.25rem;">' +
        '<small>Mailing address (only required if you chose "Mail")</small>' +
      '</label>' +
      '<textarea name="mailing_address" rows="3" maxlength="400" ' +
        'placeholder="Street, City, State, ZIP" ' +
        'style="width:100%;max-width:500px;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;">' +
        escapeHtml(prefilledAddress) +
      '</textarea>' +
      '<p style="margin-top:1.5rem;">' +
        '<button type="submit" style="display:inline-block;padding:14px 28px;background:#2C5F2E;color:#fff;font-weight:700;border:none;border-radius:6px;cursor:pointer;">' +
          'Send my choice →' +
        '</button>' +
      '</p>' +
    '</form>';
}

function sendBibleHandoffNotifyEmail_(args) {
  var subject = '📖 Bible request handoff — ' + (args.method === 'mail' ? 'MAIL' : 'DROP-OFF');
  var bodyHtml = '' +
    '<p>A previously-approved Bible request is ready for handoff.</p>' +
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;">' +
      '<tr><td><strong>Submission</strong></td><td><code>' + escapeHtml(args.submissionId) + '</code></td></tr>' +
      '<tr><td><strong>Method</strong></td><td>' + escapeHtml(args.method) + '</td></tr>' +
      (args.method === 'mail'
        ? '<tr><td><strong>Address</strong></td><td>' + escapeHtml(args.address) + '</td></tr>'
        : '<tr><td><strong>Drop-off</strong></td><td>Email the requester upcoming meeting / cookout times.</td></tr>') +
      '<tr><td><strong>Bibles row</strong></td><td>row index ' + escapeHtml(String(args.rowIndex)) + '</td></tr>' +
    '</table>' +
    '<p>Once handed off (or mailed), update the row\'s status to <code>fulfilled</code> in the Bibles Sheet tab.</p>';

  var html = emailShell({
    headerTitle: 'Bible request handoff',
    headerSubtitle: '📖',
    bodyHtml: bodyHtml,
    footerHtml: '<p>— The Seed the Word team</p>',
  });

  MailApp.sendEmail({
    to: TEAM_INBOX,
    subject: subject,
    htmlBody: html,
    body: 'Bible request handoff — see HTML version. Method: ' + args.method,
    name: 'Seed the Word Ministry',
    noReply: true,
  });
}


// ── Review reminder cron ────────────────────────────────────────
//
// Every 30 minutes (registered in installAllTimeTriggers). Re-emails
// admins for any receive row that has been pending_review for more
// than reviewReminderHours (default 48). One reminder per row —
// reminder_sent_at is stamped after the email so subsequent runs are
// no-ops for that row.
function processBibleReviewReminders_() {
  _markAppsScriptRan('processBibleReviewReminders_');

  var bibleCfg = _loadBibleDonateConfig_();
  var reminderHours = Number(bibleCfg.reviewReminderHours) || BIBLE_REVIEW_REMINDER_HOURS;

  var sheet = openTab(BIBLES_TAB, BIBLES_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var idx = headerIndex_(values[0]);

  var now = new Date();
  var thresholdMs = now.getTime() - reminderHours * 3600 * 1000;

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(row[idx.kind]) !== 'receive') continue;
    if (String(row[idx.status]) !== 'pending_review') continue;
    if (row[idx.reminder_sent_at]) continue;        // already reminded
    var receivedAt = new Date(row[idx.received_at]);
    if (isNaN(receivedAt.getTime())) continue;
    if (receivedAt.getTime() > thresholdMs) continue;

    try {
      sendBibleRequestReviewReminderEmail_({
        submissionId: String(row[idx.submission_id]),
        name: String(row[idx.name]),
        email: String(row[idx.contact_email]),
        story: String(row[idx.story]),
        receivedAt: receivedAt,
        approveToken: String(row[idx.approve_token]),
        declineToken: String(row[idx.decline_token]),
      });
    } catch (err) {
      console.log('processBibleReviewReminders_: send failed for ' + row[idx.submission_id] + ': ' + err);
      continue;
    }

    sheet.getRange(i + 1, idx.reminder_sent_at + 1).setValue(now.toISOString());
  }
}

function sendBibleRequestReviewReminderEmail_(args) {
  var webApp = _bibleWebAppUrl_();
  var approveUrl = webApp + '?action=bible-request-approve&token=' + encodeURIComponent(args.approveToken);
  var declineUrl = webApp + '?action=bible-request-decline&token=' + encodeURIComponent(args.declineToken);

  var hours = Math.round((Date.now() - args.receivedAt.getTime()) / 3600000);
  var subject = '⏰ Bible request from ' + args.name + ' has been waiting ' + hours + 'h';

  var bodyHtml = '' +
    '<p>This request has been sitting in <code>pending_review</code> for over ' +
      Math.floor(hours / 24) + ' day' + (hours >= 48 ? 's' : '') + '. Please review:</p>' +
    '<p style="margin:1rem 0;"><strong>' + escapeHtml(args.name) + '</strong> ' +
      '&lt;' + escapeHtml(args.email) + '&gt;</p>' +
    '<p><strong>Their story:</strong></p>' +
    '<blockquote style="margin:0.5rem 1rem;padding:0.75rem 1rem;border-left:4px solid #2C5F2E;background:#f7f3ec;font-style:italic;line-height:1.6;">' +
      escapeHtml(args.story).replace(/\n/g, '<br>') +
    '</blockquote>' +
    '<p style="margin-top:1.5rem;text-align:center;">' +
      '<a href="' + approveUrl + '" style="display:inline-block;padding:14px 28px;margin:0 8px;background:#2C5F2E;color:#fff;font-weight:700;text-decoration:none;border-radius:6px;">Approve and email handoff form</a>' +
      '&nbsp;' +
      '<a href="' + declineUrl + '" style="display:inline-block;padding:14px 28px;margin:0 8px;background:#fff;color:#666;border:1.5px solid #ccc;font-weight:700;text-decoration:none;border-radius:6px;">Decline silently</a>' +
    '</p>';

  var html = emailShell({
    headerTitle: 'Bible request — still waiting for review',
    headerSubtitle: '⏰',
    bodyHtml: bodyHtml,
    footerHtml: '<p>— The Seed the Word team</p>',
  });

  MailApp.sendEmail({
    to: TEAM_INBOX,
    subject: subject,
    htmlBody: html,
    body: 'Bible request from ' + args.name + ' has been waiting ' + hours + 'h.',
    name: 'Seed the Word Ministry',
    noReply: true,
  });
}


// ════════════════════════════════════════════════════════════════════
//
//   YOUR WALK READING TRACKER (community.html panel)
//
//   Personal-walk reading tracker. Three Sheet tabs (WalkTokens,
//   WalkStamps, WalkBadges), four POST actions (walkLinkRequest,
//   walkStamp, walkSync, walkRevoke), one hourly cleanup cron
//   (processWalkTokenCleanup_), one one-shot installer
//   (installYourWalk).
//
//   Reuses everything that already lives in this file: openTab,
//   headerIndex_, jsonResponse, emailShell, SITE_URL, TEAM_INBOX,
//   STW_GREEN. No new Sheet, no new web app, no new bot, no new
//   Script Property, no new external dep.
//
//   Pure helpers are mirrored verbatim from
//   docs/apps-script/your-walk-helpers.js (the canonical version);
//   the Node test runner imports the helpers file, the Apps-Script
//   runtime uses the copy below. The test suite is the trip wire
//   for drift between the two locations.
//
//   See .kiro/specs/your-walk-tracker/{requirements,design,tasks}.md
//
// ════════════════════════════════════════════════════════════════════

// ── WalkTokens constants ───────────────────────────────────────────
//
// One row per member. The natural key is `email`; the device's
// credential is `token`. Token rotation = overwrite the row's token
// + bump expires_at. Revoke = delete the row.
const WALK_TOKENS_TAB = 'WalkTokens';

const WALK_TOKENS_HEADERS = [
  'email', 'token', 'created_at', 'last_seen_at', 'expires_at',
  'link_requests_24h_ts', 'revoked_at',
];

// ── WalkStamps constants ───────────────────────────────────────────
//
// One row per day a member stamped. Idempotency key is the pair
// (email, stamp_date). The anchor columns (book/chapter/stream) are
// the layered-plan reading the panel was visually showing at stamp
// time — used by the chapter-aware badges. Empty when the panel was
// not on a walk day.
const WALK_STAMPS_TAB = 'WalkStamps';

const WALK_STAMPS_HEADERS = [
  'email', 'stamp_date', 'stamp_at', 'anchor_book', 'anchor_chapter', 'stream',
];

// ── WalkBadges constants ───────────────────────────────────────────
//
// One row per (email, badge_id) unlock event. unlocked_on is the
// stamp_date of the stamp whose evaluateBadgeUnlocks_ pass produced
// the unlock — used by the celebration UI for retrospective display.
const WALK_BADGES_TAB = 'WalkBadges';

const WALK_BADGES_HEADERS = [
  'email', 'badge_id', 'unlocked_at', 'unlocked_on',
];

// ── Walk-tracker constants ─────────────────────────────────────────
const WALK_TOKEN_HEX_LENGTH        = 64;        // 32 bytes hex
const WALK_EMAIL_MAX_CHARS         = 200;
const WALK_ANCHOR_BOOK_MAX_CHARS   = 40;
const WALK_ANCHOR_CHAPTER_MAX      = 200;
const WALK_DEFAULT_TTL_DAYS        = 30;
const WALK_DEFAULT_GRACE_DAYS      = 3;
const WALK_DEFAULT_LINK_RATE_LIMIT = 3;
const WALK_LINK_RATE_WINDOW_HOURS  = 24;
const WALK_LINK_RATE_TIMESTAMP_CAP = 5;         // most-recent-N kept on the row
const WALK_STAMP_DATE_BOUND_DAYS   = 2;         // ±2-day server-UTC sanity check

// Allowed stream names a stamp's `stream` field may take. Mirror of
// the layered-plan streams in assets/data/telegram-bot.json#bible.
const WALK_STREAMS = ['nt', 'otHistory', 'poetryProphecy', 'psalm', 'proverbs'];


// ── Pure helpers (mirrored from docs/apps-script/your-walk-helpers.js) ──
//
// These are the Apps-Script-side copies. The canonical version lives
// in your-walk-helpers.js and is imported by the Node test runner.
// Edit BOTH places in lockstep — the test suite is the safety net.

function isLikelyEmail_(s) {
  if (typeof s !== 'string') return false;
  var t = s.trim();
  if (!t) return false;
  if (t.length > WALK_EMAIL_MAX_CHARS) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function isIsoDateString_(s) {
  if (typeof s !== 'string' || s.length !== 10) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var parts = s.split('-').map(Number);
  var y = parts[0], m = parts[1], d = parts[2];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y
      && dt.getUTCMonth()    === m - 1
      && dt.getUTCDate()     === d;
}

function isWalkTokenHex_(s) {
  return typeof s === 'string'
      && s.length === WALK_TOKEN_HEX_LENGTH
      && /^[0-9a-f]+$/.test(s);
}

function daysBetweenIso_(aIso, bIso) {
  if (!isIsoDateString_(aIso) || !isIsoDateString_(bIso)) return NaN;
  var ap = aIso.split('-').map(Number);
  var bp = bIso.split('-').map(Number);
  var aMs = Date.UTC(ap[0], ap[1] - 1, ap[2]);
  var bMs = Date.UTC(bp[0], bp[1] - 1, bp[2]);
  return Math.round((bMs - aMs) / 86400000);
}

function isoWeekdayForDate_(isoDate) {
  if (!isIsoDateString_(isoDate)) return 0;
  var p = isoDate.split('-').map(Number);
  var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return ((dt.getUTCDay() + 6) % 7) + 1;
}

function isoWeekKeyForDate_(isoDate) {
  if (!isIsoDateString_(isoDate)) return null;
  var p = isoDate.split('-').map(Number);
  var date = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  var dayNum = ((date.getUTCDay() + 6) % 7) + 1;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  var weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

function isoWeekMondayDate_(weekKey) {
  if (typeof weekKey !== 'string') return null;
  var m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  var year = parseInt(m[1], 10);
  var week = parseInt(m[2], 10);
  if (week < 1 || week > 53) return null;
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var jan4Day = ((jan4.getUTCDay() + 6) % 7) + 1;
  var w01Mon = new Date(Date.UTC(year, 0, 4 - (jan4Day - 1)));
  var offsetMs = (week - 1) * 7 * 86400000;
  return new Date(w01Mon.getTime() + offsetMs);
}

function consecutiveIsoWeeks_(aKey, bKey) {
  var aMon = isoWeekMondayDate_(aKey);
  var bMon = isoWeekMondayDate_(bKey);
  if (!aMon || !bMon) return false;
  return Math.round((bMon - aMon) / 86400000) === 7;
}

function validateWalkLinkRequest_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  var email = String(p.email == null ? '' : p.email).trim().toLowerCase();
  if (!email)                              return { ok: false, reason: 'email-required' };
  if (email.length > WALK_EMAIL_MAX_CHARS) return { ok: false, reason: 'email-too-long' };
  if (!isLikelyEmail_(email))              return { ok: false, reason: 'bad-email' };
  return { ok: true, email: email };
}

function validateWalkStamp_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  var token = String(p.token == null ? '' : p.token).trim();
  var today = String(p.today == null ? '' : p.today).trim();

  if (!token)                   return { ok: false, reason: 'token-required' };
  if (!isWalkTokenHex_(token))  return { ok: false, reason: 'bad-token-shape' };
  if (!today)                   return { ok: false, reason: 'today-required' };
  if (!isIsoDateString_(today)) return { ok: false, reason: 'bad-date' };

  var anchorBook = '';
  var anchorChapter = '';
  var stream = '';
  if (p.anchor && typeof p.anchor === 'object') {
    anchorBook = String(p.anchor.book == null ? '' : p.anchor.book)
      .trim()
      .slice(0, WALK_ANCHOR_BOOK_MAX_CHARS);

    var chRaw = p.anchor.chapter;
    var ch = typeof chRaw === 'number'
      ? Math.floor(chRaw)
      : parseInt(String(chRaw == null ? '' : chRaw), 10);
    if (isFinite(ch) && ch >= 1 && ch <= WALK_ANCHOR_CHAPTER_MAX) {
      anchorChapter = ch;
    }

    var streamRaw = String(p.anchor.stream == null ? '' : p.anchor.stream).trim();
    if (WALK_STREAMS.indexOf(streamRaw) !== -1) stream = streamRaw;
  }

  return {
    ok: true,
    token: token, today: today,
    anchorBook: anchorBook, anchorChapter: anchorChapter, stream: stream,
  };
}

function computeStreak_(stampDates, today, graceDays) {
  var grace = (graceDays == null) ? WALK_DEFAULT_GRACE_DAYS : graceDays;
  var inputs = (Array.isArray(stampDates) ? stampDates : [])
    .filter(isIsoDateString_);
  var seen = {};
  for (var k = 0; k < inputs.length; k++) seen[inputs[k]] = true;
  var unique = Object.keys(seen).sort();

  if (unique.length === 0) {
    return { current: 0, longest: 0, lastStampDate: null };
  }

  var current = 0, longest = 0, prev = null;
  for (var i = 0; i < unique.length; i++) {
    var d = unique[i];
    if (prev === null) {
      current = 1;
    } else {
      var gap = daysBetweenIso_(prev, d);
      if (gap === 0) continue;
      if (gap <= grace + 1) current = current + 1;
      else                  current = 1;
    }
    if (current > longest) longest = current;
    prev = d;
  }

  return { current: current, longest: longest, lastStampDate: prev };
}

function evaluateWalkRule_(rule, stamps) {
  switch (rule) {
    case 'first-stamp-ever':
      return stamps.length >= 1;

    case 'twenty-one-john-chapters': {
      var johnChapters = {};
      for (var i = 0; i < stamps.length; i++) {
        var s = stamps[i];
        if (s && s.anchor_book === 'John'
            && typeof s.anchor_chapter === 'number'
            && isFinite(s.anchor_chapter)) {
          johnChapters[s.anchor_chapter] = true;
        }
      }
      return Object.keys(johnChapters).length >= 21;
    }

    case 'thirty-psalm-stamps': {
      var psalmDates = {};
      for (var j = 0; j < stamps.length; j++) {
        var s2 = stamps[j];
        if (s2 && s2.stream === 'psalm' && isIsoDateString_(s2.stamp_date)) {
          psalmDates[s2.stamp_date] = true;
        }
      }
      return Object.keys(psalmDates).length >= 30;
    }

    case 'thirty-day-streak': {
      var dates = [];
      for (var m = 0; m < stamps.length; m++) {
        var s3 = stamps[m];
        if (s3 && isIsoDateString_(s3.stamp_date)) dates.push(s3.stamp_date);
      }
      if (dates.length === 0) return false;
      var seenD = {};
      for (var n = 0; n < dates.length; n++) seenD[dates[n]] = true;
      var sorted = Object.keys(seenD).sort();
      var r = computeStreak_(sorted, sorted[sorted.length - 1], WALK_DEFAULT_GRACE_DAYS);
      return r.longest >= 30;
    }

    case 'five-days-four-weeks': {
      var datesByWeek = {};
      for (var p = 0; p < stamps.length; p++) {
        var s4 = stamps[p];
        if (!s4 || !isIsoDateString_(s4.stamp_date)) continue;
        var dow = isoWeekdayForDate_(s4.stamp_date);
        if (dow < 1 || dow > 5) continue;
        var wk = isoWeekKeyForDate_(s4.stamp_date);
        if (!wk) continue;
        if (!datesByWeek[wk]) datesByWeek[wk] = {};
        datesByWeek[wk][s4.stamp_date] = true;
      }
      var qualifying = [];
      for (var wkKey in datesByWeek) {
        if (Object.keys(datesByWeek[wkKey]).length >= 5) qualifying.push(wkKey);
      }
      qualifying.sort();
      for (var q = 0; q + 3 < qualifying.length; q++) {
        if (consecutiveIsoWeeks_(qualifying[q],     qualifying[q + 1])
         && consecutiveIsoWeeks_(qualifying[q + 1], qualifying[q + 2])
         && consecutiveIsoWeeks_(qualifying[q + 2], qualifying[q + 3])) {
          return true;
        }
      }
      return false;
    }

    default:
      return false;
  }
}

function evaluateBadgeUnlocks_(stamps, badgeCatalog, alreadyUnlocked) {
  var stampsList = Array.isArray(stamps) ? stamps : [];
  var catalog = (badgeCatalog && Array.isArray(badgeCatalog.badges))
    ? badgeCatalog.badges
    : [];

  var alreadyMap = {};
  if (alreadyUnlocked && typeof alreadyUnlocked.forEach === 'function') {
    alreadyUnlocked.forEach(function (id) { alreadyMap[id] = true; });
  } else if (Array.isArray(alreadyUnlocked)) {
    for (var a = 0; a < alreadyUnlocked.length; a++) alreadyMap[alreadyUnlocked[a]] = true;
  }

  var newly = [];
  var all = [];

  for (var i = 0; i < catalog.length; i++) {
    var badge = catalog[i];
    if (!badge || typeof badge.id !== 'string') continue;
    var wasUnlocked = alreadyMap[badge.id] === true;
    var ruleHits = wasUnlocked || evaluateWalkRule_(badge.unlockRule, stampsList);
    if (ruleHits) {
      all.push(badge.id);
      if (!wasUnlocked) newly.push(badge.id);
    }
  }

  return { newlyUnlocked: newly, all: all };
}

function tokenIsActive_(tokenRow, now) {
  if (!tokenRow || typeof tokenRow !== 'object') return false;
  if (tokenRow.revoked_at) return false;
  var expRaw = tokenRow.expires_at;
  if (expRaw == null || expRaw === '') return false;
  var exp = (expRaw instanceof Date) ? expRaw : new Date(expRaw);
  if (!(exp instanceof Date) || isNaN(exp.getTime())) return false;
  var nowMs = (now instanceof Date && !isNaN(now.getTime())) ? now.getTime() : Date.now();
  return exp.getTime() > nowMs;
}

function findEmailLinkRequestsInWindow_(values, idx, email, hours, now) {
  if (!Array.isArray(values) || values.length < 2) return [];
  if (!idx || typeof idx !== 'object') return [];
  if (typeof idx.email !== 'number' || typeof idx.link_requests_24h_ts !== 'number') {
    return [];
  }
  var target = String(email == null ? '' : email).trim().toLowerCase();
  if (!target) return [];

  var windowMs = (typeof hours === 'number' && hours > 0 ? hours : WALK_LINK_RATE_WINDOW_HOURS) * 3600000;
  var nowMs = (now instanceof Date && !isNaN(now.getTime())) ? now.getTime() : Date.now();
  var cutoffMs = nowMs - windowMs;

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row) continue;
    var rowEmail = String(row[idx.email] == null ? '' : row[idx.email]).trim().toLowerCase();
    if (rowEmail !== target) continue;
    var tsField = String(row[idx.link_requests_24h_ts] == null ? '' : row[idx.link_requests_24h_ts]);
    if (!tsField) continue;
    var parts = tsField.split(',');
    for (var i = 0; i < parts.length; i++) {
      var tsRaw = parts[i].trim();
      if (!tsRaw) continue;
      var ts = new Date(tsRaw);
      if (isNaN(ts.getTime())) continue;
      if (ts.getTime() >= cutoffMs) out.push(ts);
    }
  }
  out.sort(function (a, b) { return a.getTime() - b.getTime(); });
  return out;
}


// ── I/O wrappers ────────────────────────────────────────────────────

// Load the yourWalk config block off the deployed site's
// telegram-bot.json. Returns sane defaults when the fetch fails.
// Cached in CacheService for 6 hours.
function loadYourWalkConfig_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (_) {}
  var cacheKey = 'your-walk:config-v1';
  var cached = cache ? cache.get(cacheKey) : null;
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }
  var url = SITE_URL + 'assets/data/telegram-bot.json';
  var raw = {};
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      raw = JSON.parse(resp.getContentText()) || {};
    }
  } catch (err) {
    console.log('loadYourWalkConfig_: fetch failed: ' + err);
  }
  var w = raw.yourWalk || {};
  var cfg = {
    enabled: w.enabled === true,
    endpointUrl: String(w.endpointUrl || ''),
    tokenTtlDays: Number(w.tokenTtlDays) || WALK_DEFAULT_TTL_DAYS,
    graceDays: (typeof w.graceDays === 'number') ? w.graceDays : WALK_DEFAULT_GRACE_DAYS,
    linkRateLimitPerDay: Number(w.linkRateLimitPerDay) || WALK_DEFAULT_LINK_RATE_LIMIT,
  };
  if (cache) {
    try { cache.put(cacheKey, JSON.stringify(cfg), 6 * 60 * 60); } catch (_) {}
  }
  return cfg;
}

// Load the badge catalog off the deployed site's badges.json. Returns
// {badges: []} when the fetch fails — evaluateBadgeUnlocks_ tolerates
// an empty catalog by returning {newlyUnlocked: [], all: []}.
function loadBadgeCatalog_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (_) {}
  var cacheKey = 'your-walk:badges-v1';
  var cached = cache ? cache.get(cacheKey) : null;
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }
  var url = SITE_URL + 'assets/data/badges.json';
  var raw = { badges: [] };
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      raw = JSON.parse(resp.getContentText()) || { badges: [] };
    }
  } catch (err) {
    console.log('loadBadgeCatalog_: fetch failed: ' + err);
  }
  if (!Array.isArray(raw.badges)) raw.badges = [];
  if (cache) {
    try { cache.put(cacheKey, JSON.stringify(raw), 6 * 60 * 60); } catch (_) {}
  }
  return raw;
}

// Find the rowIndex (1-based on values; values[rowIndex] is the row,
// sheet.getRange(rowIndex+1, …) is the cell for setValue) for the
// given email, or -1 if absent.
function findWalkTokensRowByEmail_(values, idx, email) {
  if (!Array.isArray(values) || values.length < 2) return -1;
  var target = String(email == null ? '' : email).trim().toLowerCase();
  if (!target) return -1;
  for (var r = 1; r < values.length; r++) {
    var rowEmail = String(values[r][idx.email] == null ? '' : values[r][idx.email]).trim().toLowerCase();
    if (rowEmail === target) return r;
  }
  return -1;
}

// Given a token, return the row's columns as an object or null.
function findWalkTokensRowObject_(values, idx, token) {
  if (!Array.isArray(values) || values.length < 2) return null;
  if (!token) return null;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idx.token] || '') === token) {
      return {
        email:                String(values[r][idx.email] || '').trim().toLowerCase(),
        token:                String(values[r][idx.token] || ''),
        created_at:           values[r][idx.created_at],
        last_seen_at:         values[r][idx.last_seen_at],
        expires_at:           values[r][idx.expires_at],
        link_requests_24h_ts: values[r][idx.link_requests_24h_ts],
        revoked_at:           values[r][idx.revoked_at],
      };
    }
  }
  return null;
}

// Same lookup but returns the rowIndex (1-based on values) for use
// with sheet.getRange.
function findWalkTokensRowIndexByToken_(values, idx, token) {
  if (!Array.isArray(values) || values.length < 2) return -1;
  if (!token) return -1;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idx.token] || '') === token) return r;
  }
  return -1;
}

// Returns an array of stamp objects in evaluateBadgeUnlocks_ shape
// (column names with underscores) for the given email.
function readStampsForEmail_(values, idx, email) {
  var out = [];
  if (!Array.isArray(values) || values.length < 2) return out;
  var target = String(email == null ? '' : email).trim().toLowerCase();
  if (!target) return out;
  for (var r = 1; r < values.length; r++) {
    var rowEmail = String(values[r][idx.email] == null ? '' : values[r][idx.email]).trim().toLowerCase();
    if (rowEmail !== target) continue;
    var chRaw = values[r][idx.anchor_chapter];
    var ch = (typeof chRaw === 'number') ? chRaw : parseInt(String(chRaw == null ? '' : chRaw), 10);
    out.push({
      stamp_date:     String(values[r][idx.stamp_date] || ''),
      anchor_book:    String(values[r][idx.anchor_book] || ''),
      anchor_chapter: isFinite(ch) ? ch : null,
      stream:         String(values[r][idx.stream] || ''),
    });
  }
  return out;
}

// Returns a JS object acting as a Set<string> of badge ids already
// unlocked for the email. (Apps Script supports Set, but a plain
// object is enough for evaluateBadgeUnlocks_'s contract.)
function readBadgeIdsForEmail_(values, idx, email) {
  var setLike = {
    _items: {},
    has: function (id) { return this._items[id] === true; },
    add: function (id) { this._items[id] = true; },
    forEach: function (fn) {
      for (var k in this._items) if (this._items[k] === true) fn(k);
    },
  };
  if (!Array.isArray(values) || values.length < 2) return setLike;
  var target = String(email == null ? '' : email).trim().toLowerCase();
  if (!target) return setLike;
  for (var r = 1; r < values.length; r++) {
    var rowEmail = String(values[r][idx.email] == null ? '' : values[r][idx.email]).trim().toLowerCase();
    if (rowEmail !== target) continue;
    var bid = String(values[r][idx.badge_id] || '');
    if (bid) setLike.add(bid);
  }
  return setLike;
}

// Append `now` to `existing` (most-recent-N capped). `existing` may be
// an array of Date|ISO strings or comma-joined-string. Returns an
// array of ISO strings.
function appendAndCapTimestamps_(existing, now, cap) {
  var max = (typeof cap === 'number' && cap > 0) ? cap : WALK_LINK_RATE_TIMESTAMP_CAP;
  var out = [];
  if (Array.isArray(existing)) {
    for (var i = 0; i < existing.length; i++) {
      var v = existing[i];
      if (v instanceof Date) out.push(v.toISOString());
      else if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
  } else if (typeof existing === 'string' && existing) {
    var parts = existing.split(',');
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j].trim();
      if (p) out.push(p);
    }
  }
  out.push((now instanceof Date) ? now.toISOString() : new Date().toISOString());
  if (out.length > max) out = out.slice(out.length - max);
  return out;
}

// Read the link_requests_24h_ts cell at rowIdx (1-based on values) into
// an array of Date objects. Returns [] for missing/malformed cells or
// when rowIdx is -1 (no existing row).
function rowTimestamps_(values, idx, rowIdx) {
  var out = [];
  if (rowIdx < 1 || !Array.isArray(values) || rowIdx >= values.length) return out;
  var raw = String(values[rowIdx][idx.link_requests_24h_ts] || '');
  if (!raw) return out;
  var parts = raw.split(',');
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i].trim();
    if (!t) continue;
    var dt = new Date(t);
    if (!isNaN(dt.getTime())) out.push(dt);
  }
  return out;
}

// Random 32 bytes rendered as 64 lowercase hex chars. Apps Script
// does not expose a direct CSPRNG, so we use UUID concatenation as
// the entropy source, then hash with SHA-256 to whiten and to land
// on exactly 32 bytes regardless of UUID format quirks.
function randomWalkTokenHex_() {
  var seed = Utilities.getUuid() + Utilities.getUuid();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

// 'YYYY-MM-DD' UTC date string for a Date object.
function ymdUtc_(date) {
  var d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dd = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// Walk every row bottom-up and delete on email match. Returns the
// count deleted. Bottom-up so row indices stay valid mid-walk.
function deleteRowsByEmail_(sheet, idx, email) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return 0;
  var target = String(email == null ? '' : email).trim().toLowerCase();
  if (!target) return 0;
  var deleted = 0;
  for (var r = values.length - 1; r >= 1; r--) {
    var rowEmail = String(values[r][idx.email] == null ? '' : values[r][idx.email]).trim().toLowerCase();
    if (rowEmail === target) {
      sheet.deleteRow(r + 1);
      deleted++;
    }
  }
  return deleted;
}



// ── Apps Script handler — handleWalkLinkRequest_ ────────────────────
//
// Miracle-link request. Audit-first sequence:
//   1. Honeypot trip → silently OK, write nothing.
//   2. Validate (validateWalkLinkRequest_).
//   3. Load yourWalk config; reject when disabled.
//   4. Rate-limit via findEmailLinkRequestsInWindow_ (3 per email
//      per 24h rolling window; cap configurable).
//   5. Generate 64-hex-char token; upsert WalkTokens row (rotate
//      token + bump expires_at when email already exists; otherwise
//      append a fresh row).
//   6. Append `now` ISO into link_requests_24h_ts capped at 5 most-
//      recent entries.
//   7. Email the miracle link via sendWalkMiracleLinkEmail_.
//   8. Return { ok: true, status: 'sent' }.
//
// On email-send failure the row is preserved (the audit row already
// exists) but we surface the error so the browser shows a "try again
// in a minute" message instead of a silent success.
//
// Spec: design §4.8; requirements 3.x and YW7.
function handleWalkLinkRequest_(payload) {
  if (payload && payload.extra_field_2) {
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  var v = validateWalkLinkRequest_(payload);
  if (!v.ok) return jsonResponse({ ok: false, error: v.reason });

  var cfg = loadYourWalkConfig_();
  if (!cfg.enabled) return jsonResponse({ ok: false, error: 'disabled' });

  var sheet = openTab(WALK_TOKENS_TAB, WALK_TOKENS_HEADERS);
  var values = sheet.getDataRange().getValues();
  var idx = headerIndex_(values[0]);
  var now = new Date();

  var recent = findEmailLinkRequestsInWindow_(
    values, idx, v.email, WALK_LINK_RATE_WINDOW_HOURS, now);
  if (recent.length >= cfg.linkRateLimitPerDay) {
    return jsonResponse({ ok: false, error: 'rate-limited' });
  }

  var token = randomWalkTokenHex_();
  var expiresAt = new Date(now.getTime() + cfg.tokenTtlDays * 86400000);

  var existingRowIdx = findWalkTokensRowByEmail_(values, idx, v.email);
  var newTimestamps = appendAndCapTimestamps_(
    rowTimestamps_(values, idx, existingRowIdx),
    now,
    WALK_LINK_RATE_TIMESTAMP_CAP
  );

  if (existingRowIdx === -1) {
    var row = new Array(WALK_TOKENS_HEADERS.length);
    row[idx.email]                = v.email;
    row[idx.token]                = token;
    row[idx.created_at]           = now.toISOString();
    row[idx.last_seen_at]         = '';
    row[idx.expires_at]           = expiresAt.toISOString();
    row[idx.link_requests_24h_ts] = newTimestamps.join(',');
    row[idx.revoked_at]           = '';
    sheet.appendRow(row);
  } else {
    var r = existingRowIdx + 1; // 1-based for getRange
    sheet.getRange(r, idx.token + 1).setValue(token);
    sheet.getRange(r, idx.expires_at + 1).setValue(expiresAt.toISOString());
    sheet.getRange(r, idx.link_requests_24h_ts + 1).setValue(newTimestamps.join(','));
    // Clear revoked_at if a previously-soft-revoked row is being
    // re-activated by a fresh request.
    sheet.getRange(r, idx.revoked_at + 1).setValue('');
  }

  try {
    sendWalkMiracleLinkEmail_(v.email, token);
  } catch (err) {
    console.log('walkLinkRequest: email send failed: ' + err);
    return jsonResponse({ ok: false, error: 'email-send-failed' });
  }

  return jsonResponse({ ok: true, status: 'sent' });
}


// ── Miracle-link email — sendWalkMiracleLinkEmail_ ──────────────────
//
// One CTA, plaintext fallback included. Tone matches the warm
// gospel-stage emails: no exclamation points, ≤ 1 emoji glyph,
// signed "Sincerely / The Seed the Word team". Sender = script
// owner (the same identity every other ministry email flows from).
//
// Spec: design §4.13; requirement 6.x.
function sendWalkMiracleLinkEmail_(email, token) {
  var link = SITE_URL + 'community.html?walk=' + encodeURIComponent(token);
  var html = emailShell({
    headerTitle: 'Your Walk — your miracle link',
    headerSubtitle: 'Open this on the device you read on.',
    bodyHtml:
      '<p style="margin:0 0 16px;font-size:15.5px;line-height:1.6;color:#3d3a35;">' +
        'You asked us to save your walk. The link below opens the community page on this device ' +
        'and saves your reading rhythm so the streak follows you here.' +
      '</p>' +
      '<p style="margin:0 0 24px;text-align:center;">' +
        '<a href="' + escapeHtml(link) + '" style="display:inline-block;padding:14px 28px;' +
          'background:' + STW_GREEN + ';color:#ffffff;font-weight:600;font-size:15px;' +
          'border-radius:6px;text-decoration:none;">Open my walk</a>' +
      '</p>' +
      '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#5e574d;">' +
        'The link is good for 30 days of activity. Stamping a day extends it for another 30. ' +
        'If you stop stamping for 30 days, the link expires and you can ask for a new one.' +
      '</p>' +
      '<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#5e574d;">' +
        'If you did not ask for this, you can ignore the message and nothing further happens.' +
      '</p>' +
      '<p style="margin:24px 0 4px;font-family:Georgia,serif;font-style:italic;color:' + STW_GREEN + ';">' +
        'Sincerely,' +
      '</p>' +
      '<p style="margin:0;font-size:14.5px;color:' + STW_GREEN + ';font-weight:600;">' +
        'The Seed the Word team' +
      '</p>',
    footerHtml: 'Seed the Word Ministry &nbsp;·&nbsp; <a href="mailto:' + TEAM_INBOX +
      '" style="color:' + STW_GREEN + ';">' + TEAM_INBOX + '</a>',
  });

  var plain = [
    'Open this on the device you read on:',
    link,
    '',
    'The link is good for 30 days of activity. Stamping a day extends it ' +
    'for another 30. If you stop stamping for 30 days, the link expires and ' +
    'you can ask for a new one.',
    '',
    'If you did not ask for this, ignore this email and nothing further happens.',
    '',
    'Sincerely,',
    'The Seed the Word team',
    TEAM_INBOX,
  ].join('\n');

  MailApp.sendEmail({
    to: email,
    subject: 'Your Walk — your miracle link',
    htmlBody: html,
    body: plain,
    replyTo: TEAM_INBOX,
    name: 'Seed the Word Ministry',
    noReply: true,
  });
}



// ── Apps Script handler — handleWalkStamp_ ──────────────────────────
//
// Daily "I read today" stamp. Audit-first sequence:
//   1. Honeypot → silently OK.
//   2. Validate (validateWalkStamp_).
//   3. Load yourWalk config; reject when disabled.
//   4. ±2-day server-UTC sanity bound on `today` (defense-in-depth
//      against clock-skewed or malicious clients trying to backdate).
//   5. Resolve token via findWalkTokensRowObject_; reject on
//      tokenIsActive_ === false.
//   6. Read all stamps + already-unlocked badges for the email.
//   7. Idempotency: did this email already stamp `today`? If so,
//      recompute streak/badges/totals but force newlyUnlocked = []
//      and return idempotent: true. No new row. No mutation of the
//      WalkTokens row.
//   8. On new stamp: append WalkStamps row, then update the
//      WalkTokens row's last_seen_at and expires_at. evaluate badges,
//      append one WalkBadges row per newlyUnlocked id.
//   9. Compute streak + totals, return state.
//
// Property YW1 (idempotency), YW5 (no second celebration on second
// stamp), YW6 (token TTL enforced), YW8 (stamp authenticity).
//
// Spec: design §4.9; requirements 5.x.
function handleWalkStamp_(payload) {
  if (payload && payload.extra_field_2) {
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  var v = validateWalkStamp_(payload);
  if (!v.ok) return jsonResponse({ ok: false, error: v.reason });

  var cfg = loadYourWalkConfig_();
  if (!cfg.enabled) return jsonResponse({ ok: false, error: 'disabled' });

  // ±2-day server-UTC sanity bound on `today`.
  var serverToday = ymdUtc_(new Date());
  var dayDelta = daysBetweenIso_(v.today, serverToday);
  if (!isFinite(dayDelta) || Math.abs(dayDelta) > WALK_STAMP_DATE_BOUND_DAYS) {
    return jsonResponse({ ok: false, error: 'bad-date' });
  }

  // Resolve token → email. tokenIsActive_ enforces YW6.
  var tokensSheet = openTab(WALK_TOKENS_TAB, WALK_TOKENS_HEADERS);
  var tokenValues = tokensSheet.getDataRange().getValues();
  var tokenIdx = headerIndex_(tokenValues[0]);
  var tokenRow = findWalkTokensRowObject_(tokenValues, tokenIdx, v.token);
  var nowDate = new Date();
  if (!tokenRow || !tokenIsActive_(tokenRow, nowDate)) {
    return jsonResponse({ ok: false, error: 'bad-token' });
  }
  var email = tokenRow.email;

  // Read all stamps for this email.
  var stampsSheet = openTab(WALK_STAMPS_TAB, WALK_STAMPS_HEADERS);
  var stampValues = stampsSheet.getDataRange().getValues();
  var stampIdx = headerIndex_(stampValues[0]);
  var myStamps = readStampsForEmail_(stampValues, stampIdx, email);

  // Read already-unlocked badges for this email.
  var badgesSheet = openTab(WALK_BADGES_TAB, WALK_BADGES_HEADERS);
  var badgeValues = badgesSheet.getDataRange().getValues();
  var badgeIdx = headerIndex_(badgeValues[0]);
  var alreadyUnlocked = readBadgeIdsForEmail_(badgeValues, badgeIdx, email);

  // Idempotency check on (email, today).
  var alreadyStampedToday = false;
  for (var i = 0; i < myStamps.length; i++) {
    if (myStamps[i].stamp_date === v.today) { alreadyStampedToday = true; break; }
  }
  var isIdempotent = alreadyStampedToday;

  // On a NEW stamp: append the row, then update the WalkTokens row.
  // Order matters — audit first. If the WalkStamps appendRow throws,
  // we surface sheet-write-failed and never mutate WalkTokens or
  // WalkBadges (the audit-first invariant property YW8 depends on).
  if (!alreadyStampedToday) {
    try {
      var newRow = new Array(WALK_STAMPS_HEADERS.length);
      newRow[stampIdx.email]          = email;
      newRow[stampIdx.stamp_date]     = v.today;
      newRow[stampIdx.stamp_at]       = nowDate.toISOString();
      newRow[stampIdx.anchor_book]    = v.anchorBook;
      newRow[stampIdx.anchor_chapter] = v.anchorChapter === '' ? '' : v.anchorChapter;
      newRow[stampIdx.stream]         = v.stream;
      stampsSheet.appendRow(newRow);
    } catch (err) {
      console.log('walkStamp: WalkStamps appendRow failed: ' + err);
      return jsonResponse({ ok: false, error: 'sheet-write-failed' });
    }

    // Now update the in-memory copy so streak/badge math reflects today.
    myStamps.push({
      stamp_date:     v.today,
      anchor_book:    v.anchorBook,
      anchor_chapter: typeof v.anchorChapter === 'number' ? v.anchorChapter : null,
      stream:         v.stream,
    });

    // Bump WalkTokens.last_seen_at and expires_at. Failures here are
    // logged but do not roll back the stamp — the audit row already
    // exists.
    var newExpiry = new Date(nowDate.getTime() + cfg.tokenTtlDays * 86400000);
    var tokenRowIdx = findWalkTokensRowIndexByToken_(tokenValues, tokenIdx, v.token);
    if (tokenRowIdx !== -1) {
      try {
        var rr = tokenRowIdx + 1;
        tokensSheet.getRange(rr, tokenIdx.last_seen_at + 1).setValue(nowDate.toISOString());
        tokensSheet.getRange(rr, tokenIdx.expires_at + 1).setValue(newExpiry.toISOString());
      } catch (err2) {
        console.log('walkStamp: WalkTokens update failed (non-fatal): ' + err2);
      }
    }
  }

  // Evaluate badges. On idempotent re-stamp, this is still safe — the
  // already-unlocked set means nothing new will be in newlyUnlocked,
  // and we force newlyUnlocked = [] in the response below regardless.
  var catalog = loadBadgeCatalog_();
  var evalResult = evaluateBadgeUnlocks_(myStamps, catalog, alreadyUnlocked);

  // Append one WalkBadges row per newly-unlocked id (only on a new stamp).
  if (!alreadyStampedToday && evalResult.newlyUnlocked.length) {
    for (var b = 0; b < evalResult.newlyUnlocked.length; b++) {
      try {
        var badgeId = evalResult.newlyUnlocked[b];
        var brow = new Array(WALK_BADGES_HEADERS.length);
        brow[badgeIdx.email]       = email;
        brow[badgeIdx.badge_id]    = badgeId;
        brow[badgeIdx.unlocked_at] = nowDate.toISOString();
        brow[badgeIdx.unlocked_on] = v.today;
        badgesSheet.appendRow(brow);
      } catch (err3) {
        console.log('walkStamp: WalkBadges appendRow failed (non-fatal): ' + err3);
      }
    }
  }

  // Compute streak + totals from the up-to-date stamp list.
  var allDates = [];
  for (var s = 0; s < myStamps.length; s++) allDates.push(myStamps[s].stamp_date);
  var streak = computeStreak_(allDates, v.today, cfg.graceDays);

  var psalmDates = {};
  var johnChapters = {};
  for (var t = 0; t < myStamps.length; t++) {
    var st = myStamps[t];
    if (st.stream === 'psalm' && st.stamp_date) psalmDates[st.stamp_date] = true;
    if (st.anchor_book === 'John'
        && typeof st.anchor_chapter === 'number'
        && isFinite(st.anchor_chapter)) {
      johnChapters[st.anchor_chapter] = true;
    }
  }
  var totals = {
    stamps:       myStamps.length,
    psalmStamps:  Object.keys(psalmDates).length,
    johnChapters: Object.keys(johnChapters).length,
  };

  return jsonResponse({
    ok: true,
    idempotent: isIdempotent,
    streak: streak,
    totals: totals,
    badges: {
      all: evalResult.all,
      newlyUnlocked: isIdempotent ? [] : evalResult.newlyUnlocked,
    },
  });
}



// ── Apps Script handler — handleWalkSync_ ───────────────────────────
//
// Read-only state pull. Used on page load and when the URL carried
// a fresh ?walk=<token>. Never mutates the WalkTokens row — does NOT
// bump expires_at. Always returns newlyUnlocked: [] (a celebration
// only fires on a real stamp).
//
// Sequence:
//   1. Honeypot.
//   2. Token-shape gate (isWalkTokenHex_).
//   3. Load yourWalk config; reject when disabled.
//   4. Resolve token; reject on tokenIsActive_ === false.
//   5. Read stamps + already-unlocked badges.
//   6. Compute streak + totals + badges.all (no celebration).
//   7. Return state.
//
// Spec: design §4.10; requirement 10.3 (read-only contract).
function handleWalkSync_(payload) {
  if (payload && payload.extra_field_2) {
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  var token = String((payload && payload.token) || '').trim();
  if (!isWalkTokenHex_(token)) {
    return jsonResponse({ ok: false, error: 'bad-token-shape' });
  }

  var cfg = loadYourWalkConfig_();
  if (!cfg.enabled) return jsonResponse({ ok: false, error: 'disabled' });

  var tokensSheet = openTab(WALK_TOKENS_TAB, WALK_TOKENS_HEADERS);
  var tokenValues = tokensSheet.getDataRange().getValues();
  var tokenIdx = headerIndex_(tokenValues[0]);
  var tokenRow = findWalkTokensRowObject_(tokenValues, tokenIdx, token);
  if (!tokenRow || !tokenIsActive_(tokenRow, new Date())) {
    return jsonResponse({ ok: false, error: 'bad-token' });
  }
  var email = tokenRow.email;

  var stampsSheet = openTab(WALK_STAMPS_TAB, WALK_STAMPS_HEADERS);
  var stampValues = stampsSheet.getDataRange().getValues();
  var stampIdx = headerIndex_(stampValues[0]);
  var myStamps = readStampsForEmail_(stampValues, stampIdx, email);

  var badgesSheet = openTab(WALK_BADGES_TAB, WALK_BADGES_HEADERS);
  var badgeValues = badgesSheet.getDataRange().getValues();
  var badgeIdx = headerIndex_(badgeValues[0]);
  var alreadyUnlocked = readBadgeIdsForEmail_(badgeValues, badgeIdx, email);

  var today = ymdUtc_(new Date());
  var allDates = [];
  for (var s = 0; s < myStamps.length; s++) allDates.push(myStamps[s].stamp_date);
  var streak = computeStreak_(allDates, today, cfg.graceDays);

  var psalmDates = {};
  var johnChapters = {};
  for (var t = 0; t < myStamps.length; t++) {
    var st = myStamps[t];
    if (st.stream === 'psalm' && st.stamp_date) psalmDates[st.stamp_date] = true;
    if (st.anchor_book === 'John'
        && typeof st.anchor_chapter === 'number'
        && isFinite(st.anchor_chapter)) {
      johnChapters[st.anchor_chapter] = true;
    }
  }
  var totals = {
    stamps:       myStamps.length,
    psalmStamps:  Object.keys(psalmDates).length,
    johnChapters: Object.keys(johnChapters).length,
  };

  var catalog = loadBadgeCatalog_();
  var evalResult = evaluateBadgeUnlocks_(myStamps, catalog, alreadyUnlocked);

  return jsonResponse({
    ok: true,
    email: email,
    today: today,
    streak: streak,
    totals: totals,
    badges: {
      all: evalResult.all,
      newlyUnlocked: [],
    },
  });
}


// ── Apps Script handler — handleWalkRevoke_ ─────────────────────────
//
// Privacy escape hatch. Wipes every WalkTokens, WalkStamps, and
// WalkBadges row whose email matches the token's email. Critically,
// this handler MUST work on an expired token — a member who let
// their walk lapse should still be able to delete their data
// without renewing first (Requirement 9.4). So we deliberately
// resolve the token row directly, bypassing tokenIsActive_.
//
// Sequence:
//   1. Honeypot.
//   2. Token-shape gate.
//   3. Resolve the row; if the token is unknown → bad-token.
//   4. deleteRowsByEmail_ on each of the three tabs.
//   5. Return { ok: true, deleted: { tokens, stamps, badges } }.
//
// Property YW9 — after revoke, every subsequent action for the
// same email behaves as if the email never existed.
//
// Spec: design §4.11; requirements 9.x.
function handleWalkRevoke_(payload) {
  if (payload && payload.extra_field_2) {
    return jsonResponse({ ok: true, route: 'honeypot' });
  }

  var token = String((payload && payload.token) || '').trim();
  if (!isWalkTokenHex_(token)) {
    return jsonResponse({ ok: false, error: 'bad-token-shape' });
  }

  var tokensSheet = openTab(WALK_TOKENS_TAB, WALK_TOKENS_HEADERS);
  var tokenValues = tokensSheet.getDataRange().getValues();
  var tokenIdx = headerIndex_(tokenValues[0]);
  // Do NOT call tokenIsActive_ here — revoke must work on an expired
  // token. We only need the row to exist so we can resolve email.
  var tokenRow = findWalkTokensRowObject_(tokenValues, tokenIdx, token);
  if (!tokenRow) return jsonResponse({ ok: false, error: 'bad-token' });
  var email = tokenRow.email;

  var deleted = { tokens: 0, stamps: 0, badges: 0 };
  deleted.tokens = deleteRowsByEmail_(tokensSheet, tokenIdx, email);

  var stampsSheet = openTab(WALK_STAMPS_TAB, WALK_STAMPS_HEADERS);
  var stampIdx = headerIndex_(stampsSheet.getDataRange().getValues()[0]);
  deleted.stamps = deleteRowsByEmail_(stampsSheet, stampIdx, email);

  var badgesSheet = openTab(WALK_BADGES_TAB, WALK_BADGES_HEADERS);
  var badgeIdx = headerIndex_(badgesSheet.getDataRange().getValues()[0]);
  deleted.badges = deleteRowsByEmail_(badgesSheet, badgeIdx, email);

  return jsonResponse({ ok: true, deleted: deleted });
}



// ── Hourly cleanup cron — processWalkTokenCleanup_ ──────────────────
//
// Deletes every WalkTokens row whose expires_at is in the past.
// Walks bottom-up so row indices stay valid mid-iteration. Does
// NOT touch WalkStamps or WalkBadges — a member who returns and
// re-saves their walk with the same email keeps their full history;
// only the token (the credential) is reaped.
//
// Runs hourly via installAllTimeTriggers(). Calls _markAppsScriptRan
// at entry so dailyAppsScriptHealthCheck can detect a stalled cron.
//
// Spec: design §4.14; requirement 10.5–10.7.
function processWalkTokenCleanup_() {
  _markAppsScriptRan('processWalkTokenCleanup_');

  var sheet = openTab(WALK_TOKENS_TAB, WALK_TOKENS_HEADERS);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    console.log('processWalkTokenCleanup_: WalkTokens empty; nothing to do.');
    return;
  }
  var idx = headerIndex_(values[0]);
  var nowMs = Date.now();
  var deleted = 0;
  for (var r = values.length - 1; r >= 1; r--) {
    var expRaw = String(values[r][idx.expires_at] || '');
    if (!expRaw) continue;
    var exp = new Date(expRaw);
    if (isNaN(exp.getTime())) continue;
    if (exp.getTime() < nowMs) {
      sheet.deleteRow(r + 1);
      deleted++;
    }
  }
  console.log('processWalkTokenCleanup_: removed ' + deleted + ' expired token row(s).');
}


// ── One-shot installer — installYourWalk ────────────────────────────
//
// Run installYourWalk() ONCE from the Apps Script editor's function
// dropdown. Idempotent — safe to re-run. The three Walk tabs use
// the existing openTab() helper which preserves data and only
// rewrites headers if they drift from the canonical *_HEADERS
// constants. After this completes, an admin still needs to:
//
//   1. Set yourWalk.endpointUrl in assets/data/telegram-bot.json
//      to the deployed /exec URL.
//   2. Flip yourWalk.enabled to true in the same file.
//   3. Bump community.html and admin-help.html main.css cache busters.
//   4. Run installAllTimeTriggers() to register the hourly
//      processWalkTokenCleanup_ cron.
//
// Spec: design §6.3; requirement 12.6.
function installYourWalk() {
  // ── WalkTokens ────────────────────────────────────────────────
  var tokens = openTab(WALK_TOKENS_TAB, WALK_TOKENS_HEADERS);
  tokens.getRange(1, 1, 1, WALK_TOKENS_HEADERS.length).setFontWeight('bold');
  if (tokens.getFrozenRows() < 1) tokens.setFrozenRows(1);
  var tokensWidths = {
    email:                200,
    token:                280,
    created_at:           180,
    last_seen_at:         180,
    expires_at:           180,
    link_requests_24h_ts: 280,
    revoked_at:           180,
  };
  for (var i = 0; i < WALK_TOKENS_HEADERS.length; i++) {
    var w = tokensWidths[WALK_TOKENS_HEADERS[i]];
    if (w) tokens.setColumnWidth(i + 1, w);
  }

  // ── WalkStamps ────────────────────────────────────────────────
  var stamps = openTab(WALK_STAMPS_TAB, WALK_STAMPS_HEADERS);
  stamps.getRange(1, 1, 1, WALK_STAMPS_HEADERS.length).setFontWeight('bold');
  if (stamps.getFrozenRows() < 1) stamps.setFrozenRows(1);
  var stampsWidths = {
    email:          200,
    stamp_date:     120,
    stamp_at:       180,
    anchor_book:    140,
    anchor_chapter: 60,
    stream:         120,
  };
  for (var j = 0; j < WALK_STAMPS_HEADERS.length; j++) {
    var w2 = stampsWidths[WALK_STAMPS_HEADERS[j]];
    if (w2) stamps.setColumnWidth(j + 1, w2);
  }

  // ── WalkBadges ────────────────────────────────────────────────
  var badges = openTab(WALK_BADGES_TAB, WALK_BADGES_HEADERS);
  badges.getRange(1, 1, 1, WALK_BADGES_HEADERS.length).setFontWeight('bold');
  if (badges.getFrozenRows() < 1) badges.setFrozenRows(1);
  var badgesWidths = {
    email:       200,
    badge_id:    220,
    unlocked_at: 180,
    unlocked_on: 120,
  };
  for (var k = 0; k < WALK_BADGES_HEADERS.length; k++) {
    var w3 = badgesWidths[WALK_BADGES_HEADERS[k]];
    if (w3) badges.setColumnWidth(k + 1, w3);
  }

  console.log('installYourWalk: WalkTokens, WalkStamps, WalkBadges ready.');
  console.log('Next: set yourWalk.endpointUrl + yourWalk.enabled in telegram-bot.json,');
  console.log('  bump cache busters, run installAllTimeTriggers() to register the cron.');
}
