/**
 * prayer-intake-helpers.js
 *
 * Pure-function helpers for the prayer-request-intake spec. The
 * file is dual-purpose:
 *   1. Imported by the Node test runner (tests/prayer_intake_*.test.mjs)
 *      via standard ES `import`.
 *   2. Pasted verbatim into docs/apps-script/order-handler.gs at deploy
 *      time. Apps Script does not support module imports, so the
 *      helpers must live in the same file as the dispatcher. Each
 *      function is also declared with a trailing `_` so it stays
 *      file-private when pasted (the Apps Script convention).
 *
 * NONE of these functions touch UrlFetchApp, SpreadsheetApp,
 * MailApp, PropertiesService, CacheService, or any other Apps-Script-
 * specific global. Anything I/O-bound lives in order-handler.gs.
 *
 * Spec: .kiro/specs/prayer-request-intake/design.md §4.7, §4.8, §4.9,
 *       §8.3, §8.4, §10.3, §4.13.
 */

// ── Validation: shape-only email check ─────────────────────────────
//
// Deliberately permissive — we only filter "obvious garbage". Real
// validity is a delivery-time property the email server enforces.
export function isLikelyEmail_(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  // Basic shape: <local>@<domain>.<tld>. No spaces. Length cap matches
  // the form's maxlength=200.
  if (t.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

// ── HTML strip + line-separator normalization ──────────────────────
//
// Runs on the body BEFORE any storage or relay. Independent of the
// MarkdownV2 escape that runs later on the Telegram path.
//
// Property 8 (design §12): output never matches /<[^>]*>/, and the
// function is idempotent.
export function stripHtmlAndNormalize_(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}

// ── MarkdownV2 escape ──────────────────────────────────────────────
//
// Same 18-metacharacter set the digest spec uses. Each metachar gets
// a leading backslash so Telegram's MarkdownV2 parser treats it as
// literal text. Applied to the submitter's `name` (when not anonymous)
// and to the body — never to the literal marker substring or to the
// fixed verb phrases (those are authored, not user-supplied).
export function mdv2Escape_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ── Telegram message assembly ──────────────────────────────────────
//
// Returns { text, truncated }. The four shapes match the digest
// spec's regex character-for-character:
//
//   💌 New prayer request from <name>            (via the website): <body>
//   💌 New prayer request from Anonymous         (via the website): <body>
//   💌 New thanksgiving announcement from <name> (via the website): <body>
//   💌 New thanksgiving announcement from Anonymous (via the website): <body>
//
// The `(via the website)` literal is emitted unescaped — it is an
// authored, balanced fragment that lives on both producer and consumer
// sides in this exact form. Escaping it would break the digest's regex.
//
// PI3 (design §12 Property 3) asserts the round-trip property.
// PI6 caps the assembled length at TELEGRAM_MAX_CHARS (4090).
export function buildTelegramMessage_(args) {
  const TELEGRAM_MAX_CHARS = 4090;
  const verb = (args.kind === 'thanksgiving')
    ? 'New thanksgiving announcement'
    : 'New prayer request';

  const nameSegment = args.anonymous
    ? 'Anonymous'                          // literal, no escape needed (no metachars)
    : mdv2Escape_(args.submitterName);
  const bodySegment = mdv2Escape_(args.body);
  const marker = args.marker;              // literal, must not be escaped

  const message = '\uD83D\uDC8C ' + verb + ' from ' + nameSegment + ' ' + marker + ': ' + bodySegment;
  if (message.length <= TELEGRAM_MAX_CHARS) {
    return { text: message, truncated: false };
  }

  // Truncate the escaped body so the final message length is exactly
  // TELEGRAM_MAX_CHARS, ending in a single horizontal-ellipsis
  // codepoint U+2026.
  const prefix = '\uD83D\uDC8C ' + verb + ' from ' + nameSegment + ' ' + marker + ': ';
  const allowedBody = TELEGRAM_MAX_CHARS - prefix.length - 1; // -1 for the …
  const truncatedBody = bodySegment.slice(0, Math.max(0, allowedBody)) + '\u2026';
  return { text: prefix + truncatedBody, truncated: true };
}

// ── Drip suppression decision ──────────────────────────────────────
//
// Anonymity is intentionally NOT a suppression reason — the locked Q1
// answer is "anonymous-with-email DOES receive the drip with the
// 'Friend' salutation".
export function computeDripStatus_(v, cfg) {
  if (!cfg || cfg.dripEnabled !== true) return 'disabled-by-config';
  if (!v || !v.email)                   return 'suppressed-no-email';
  return 'enabled';
}

// ── Salutation ─────────────────────────────────────────────────────
//
// Pure function used by both Day 0 inline send and the drip cron.
// Anonymous → "Friend"; non-anonymous → first token of submitter_name
// for a warmer one-on-one feel.
export function salutation(row) {
  if (row && row.anonymous === true) return 'Friend';
  const name = String((row && row.submitter_name) || '').trim();
  if (!name) return 'Friend';
  return name.split(/\s+/)[0];
}

// ── Deterministic 32-bit string hash ───────────────────────────────
//
// Java-style String.hashCode, made unsigned. Used to seed the verse
// and template rotation pickers. Same submission_id → same picks
// across every re-render.
export function hashCodeFromString_(s) {
  let h = 0;
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  // Convert signed 32-bit → unsigned.
  return h >>> 0;
}

// ── Verse picker ───────────────────────────────────────────────────
//
// Deterministic per-Submission verse selection. Returns one verse per
// drip day. With the committed 31-verse pool and 4 drip days, indices
// (seed+0..seed+3) mod 31 are four consecutive integers and so are
// pairwise-distinct — Property 7 (verse distinctness within a Submission).
//
// `verses` is the array from assets/data/daily-verses.json. It is
// passed in (rather than read from a global) so the pure helper stays
// I/O-free and so tests can hand it a fixed pool.
export function pickVersesForSubmission_(submissionId, dripDays, verses) {
  if (!Array.isArray(verses) || verses.length === 0) return [];
  const days = Array.isArray(dripDays) ? dripDays : [];
  const seed = hashCodeFromString_(submissionId);
  return days.map(function (_day, idx) {
    return verses[(seed + idx) % verses.length];
  });
}

// ── Drip-template rotation picker ──────────────────────────────────
//
// Reflection / tip / invitation choices are deterministic per
// Submission. Same algorithm as the verse picker. Returns:
//
//   {
//     day3_reflection: <string|''>,
//     day3_tip:        <string|''>,
//     day7_reflection: <string|''>,
//     day14_invitation: <string|''>,   // a or b chosen by (seed+3) % 2
//   }
//
// Empty pools degrade gracefully — the corresponding key is the empty
// string and the renderer is expected to skip it.
export function parseDripTemplatesPicks_(submissionId, templates) {
  const t = templates || {};
  const seed = hashCodeFromString_(submissionId);

  const pick = function (pool, offset) {
    if (!Array.isArray(pool) || pool.length === 0) return '';
    return String(pool[(seed + offset) % pool.length] || '');
  };

  const inviteA = String(t.day14_invitation_a || '');
  const inviteB = String(t.day14_invitation_b || '');
  const inviteVariant = (seed + 3) % 2;
  const day14_invitation = inviteVariant === 0
    ? (inviteA || inviteB)
    : (inviteB || inviteA);

  return {
    day3_reflection: pick(t.day3_reflections, 1),
    day3_tip:        pick(t.day3_tips, 1),
    day7_reflection: pick(t.day7_reflections, 2),
    day14_invitation: day14_invitation,
  };
}
