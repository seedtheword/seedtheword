/**
 * bible-donate-helpers.js
 *
 * Pure-function helpers for the bible-donate-request spec. Dual-use:
 *   1. Imported by the Node test runner (tests/bible_donate_*.test.mjs)
 *      via standard ES `import`.
 *   2. Pasted verbatim into docs/apps-script/order-handler.gs at deploy
 *      time. Apps Script does not support module imports, so the
 *      helpers must live in the same file as the dispatcher. Each
 *      function is also declared with a trailing `_` so it stays
 *      file-private when pasted (the Apps Script convention).
 *
 * NONE of these functions touch SpreadsheetApp, MailApp, UrlFetchApp,
 * PropertiesService, CacheService, or any other Apps-Script-specific
 * global. Anything I/O-bound lives in order-handler.gs.
 *
 * Spec: .kiro/specs/bible-donate-request/design.md §4.5, §4.6, §3.3.
 */

// Length bounds — must match BIBLE_STORY_MIN_CHARS / MAX in order-handler.gs.
export const BIBLE_STORY_MIN_CHARS = 80;
export const BIBLE_STORY_MAX_CHARS = 1500;

// Donor note bound (small free-text "anything else?" field).
export const BIBLE_DONOR_NOTE_MAX_CHARS = 500;

// Donate-side count bounds. 500 is a generous-but-bounded ceiling; nobody
// realistically donates more than a moving truck of Bibles in one form.
export const BIBLE_COUNT_MIN = 1;
export const BIBLE_COUNT_MAX = 500;

// Sign id cap — defensive truncation on `?sign=<id>` query param.
export const BIBLE_SIGN_ID_MAX_CHARS = 50;


// ── Shape-only email check (mirrors prayer-intake helper) ──────────
function isLikelyBibleEmail_(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  if (t.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

// ── HTML strip + line-separator normalization ──────────────────────
//
// Mirrors prayer-intake-helpers.stripHtmlAndNormalize_. Duplicated
// here so this file is self-contained when pasted into Apps Script.
function stripHtmlAndNormalizeBible_(s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}


// ── Donate validator ──────────────────────────────────────────────
//
// Validates a donate-side submission payload. Returns either:
//   { ok: true, name, email, phone, count, handoffMethod, city, state, note, signId }
// or
//   { ok: false, reason: '<code>' }
//
// Reason codes are stable strings the form maps to user-facing copy.
//
// Email-OR-phone is the contact requirement: at least one must be present
// so the team can reach the donor for coordination.
export function validateBibleDonate_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  const name = String(p.name || '').trim();
  const email = String(p.email || '').trim();
  const phone = String(p.phone || '').trim();
  const handoffMethod = String(p.handoffMethod || '').trim();
  const city = String(p.city || '').trim();
  const state = String(p.state || '').trim().toUpperCase().slice(0, 2);
  const note = stripHtmlAndNormalizeBible_(String(p.note || ''));
  const signId = String(p.signId || '').trim().slice(0, BIBLE_SIGN_ID_MAX_CHARS);

  // Count is parsed defensively — accept both string and number.
  const countRaw = p.count;
  const count = (typeof countRaw === 'number')
    ? Math.floor(countRaw)
    : parseInt(String(countRaw || ''), 10);

  if (!name) return { ok: false, reason: 'name-required' };
  if (!email && !phone) return { ok: false, reason: 'contact-required' };
  if (email && !isLikelyBibleEmail_(email)) return { ok: false, reason: 'bad-email' };
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
    name, email, phone, count, handoffMethod, city, state, note, signId,
  };
}


// ── Receive (request) validator ───────────────────────────────────
//
// Validates a receive-side submission. The story field is the central
// gate: 80 chars minimum filters copy-paste garbage visually, 1500
// max bounds the admin's reading load.
//
// Email is required (the approval flow needs somewhere to send the
// approval email). City is required so the admin can decide if a
// local in-person handoff is feasible at approval time.
export function validateBibleRequest_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  const name = String(p.name || '').trim();
  const email = String(p.email || '').trim();
  const phone = String(p.phone || '').trim();
  const city = String(p.city || '').trim();
  const state = String(p.state || '').trim().toUpperCase().slice(0, 2);
  const story = stripHtmlAndNormalizeBible_(String(p.story || ''));
  const signId = String(p.signId || '').trim().slice(0, BIBLE_SIGN_ID_MAX_CHARS);

  if (!name) return { ok: false, reason: 'name-required' };
  if (!email) return { ok: false, reason: 'email-required' };
  if (!isLikelyBibleEmail_(email)) return { ok: false, reason: 'bad-email' };
  if (!city) return { ok: false, reason: 'city-required' };
  if (story.length < BIBLE_STORY_MIN_CHARS) return { ok: false, reason: 'story-too-short' };
  if (story.length > BIBLE_STORY_MAX_CHARS) return { ok: false, reason: 'story-too-long' };

  return {
    ok: true,
    name, email, phone, city, state, story, signId,
  };
}


// ── HMAC token signer (pure: takes the secret as an argument) ─────
//
// In Apps Script, the wrapper reads the secret from PropertiesService
// and calls Utilities.computeHmacSha256Signature + base64EncodeWebSafe.
// In Node tests, we polyfill with the standard `crypto` module.
//
// The verb is part of the signed message so a leaked approve token
// cannot be replayed against the decline endpoint and vice versa.
//
// `hmacFn` is a dependency-injected signer of shape:
//   (message: string, secret: string) => Uint8Array | number[]
//
// The Apps Script wrapper passes Utilities.computeHmacSha256Signature
// directly. The Node test passes a small polyfill around `crypto`.
//
// Returns a base64url string with trailing `=` stripped (~43 chars).
export function computeBibleReviewToken_(submissionId, verb, secret, hmacFn, base64UrlFn) {
  if (!submissionId) throw new Error('submissionId required');
  if (verb !== 'approve' && verb !== 'decline' && verb !== 'handoff') {
    throw new Error('unknown verb: ' + verb);
  }
  if (!secret) throw new Error('secret required');
  if (typeof hmacFn !== 'function') throw new Error('hmacFn required');
  if (typeof base64UrlFn !== 'function') throw new Error('base64UrlFn required');

  const message = String(submissionId) + '|' + String(verb);
  const sig = hmacFn(message, secret);
  return String(base64UrlFn(sig)).replace(/=+$/, '');
}


// ── Token resolver (pure: takes the sheet's values array as input) ─
//
// Apps Script wrapper reads the sheet values, then calls this helper.
// Tests pass a fixture `values` array shaped like a Sheets getValues()
// result.
//
// `idx` is a name → 0-based-column-index map. The Apps Script wrapper
// builds it via headerIndex_(values[0]); tests pass an explicit map.
//
// Returns:
//   { ok: true, submissionId, rowIndex (1-based), currentStatus }
//   { ok: false }
export function resolveBibleReviewTokenFromValues_(values, idx, token, verb) {
  if (!token || typeof token !== 'string') return { ok: false };
  if (!Array.isArray(values) || values.length < 2) return { ok: false };
  if (!idx || typeof idx !== 'object') return { ok: false };

  let col = -1;
  if (verb === 'approve') col = idx.approve_token;
  else if (verb === 'decline') col = idx.decline_token;
  else if (verb === 'handoff') col = idx.handoff_token;
  if (col == null || col < 0) return { ok: false };

  for (let i = 1; i < values.length; i++) {
    if (values[i] && values[i][col] === token) {
      return {
        ok: true,
        submissionId: String(values[i][idx.submission_id]),
        rowIndex: i + 1,                                   // 1-based for getRange
        currentStatus: String(values[i][idx.status] || ''),
      };
    }
  }
  return { ok: false };
}


// ── Idempotency lookup (pure) ─────────────────────────────────────
//
// Scans `values` (a Bibles sheet getValues() snapshot) recent-first
// for a row matching (kind, email-case-insensitive) within the
// configured window. Returns the most recent match or null.
//
// `now` is injected so tests can deterministically vary the clock.
export function findRecentSubmissionFromValues_(values, idx, email, kind, daysWindow, now) {
  if (!email || typeof email !== 'string') return null;
  if (!Array.isArray(values) || values.length < 2) return null;
  if (!idx || typeof idx !== 'object') return null;
  if (!isFinite(daysWindow) || daysWindow <= 0) return null;
  const nowMs = (now instanceof Date) ? now.getTime() : Date.now();
  const cutoff = nowMs - daysWindow * 86400000;
  const targetEmail = String(email).toLowerCase();

  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (!row) continue;
    if (String(row[idx.kind]) !== kind) continue;
    const rowEmail = String(row[idx.contact_email] || '').toLowerCase();
    if (rowEmail !== targetEmail) continue;
    const receivedAt = new Date(row[idx.received_at]);
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


// ── headerIndex_ (small utility, mirrors order-handler's helper) ──
export function bibleHeaderIndex_(headerRow) {
  const idx = {};
  if (!Array.isArray(headerRow)) return idx;
  for (let i = 0; i < headerRow.length; i++) {
    idx[String(headerRow[i]).trim()] = i;
  }
  return idx;
}
