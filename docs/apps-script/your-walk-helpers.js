/**
 * your-walk-helpers.js
 *
 * Pure-function helpers for the your-walk-tracker spec. Dual-use:
 *   1. Imported by the Node test runner (tests/your_walk_*.test.mjs)
 *      via standard ES `import`.
 *   2. Pasted verbatim into docs/apps-script/order-handler.gs at deploy
 *      time. Apps Script does not support module imports, so the
 *      helpers must live in the same file as the dispatcher. Each
 *      function is also declared with a trailing `_` so it stays
 *      file-private when pasted (the Apps Script convention).
 *
 * NONE of these functions touch SpreadsheetApp, MailApp, UrlFetchApp,
 * PropertiesService, CacheService, Session, or any other Apps-Script-
 * specific global. Anything I/O-bound lives in order-handler.gs.
 *
 * Spec: .kiro/specs/your-walk-tracker/design.md §4.1–§4.7.
 */

// ── Length / shape bounds — must match the Apps-Script-side constants ─

export const WALK_TOKEN_HEX_LENGTH        = 64;        // 32 bytes, rendered as hex
export const WALK_EMAIL_MAX_CHARS         = 200;
export const WALK_ANCHOR_BOOK_MAX_CHARS   = 40;
export const WALK_ANCHOR_CHAPTER_MAX      = 200;
export const WALK_DEFAULT_TTL_DAYS        = 30;
export const WALK_DEFAULT_GRACE_DAYS      = 3;
export const WALK_DEFAULT_LINK_RATE_LIMIT = 3;
export const WALK_LINK_RATE_WINDOW_HOURS  = 24;

// Allowed stream names a stamp's `stream` field may take. Mirrors the
// streams declared in assets/data/telegram-bot.json#bible.layeredPlan.
// Frozen so a buggy caller can't mutate the canonical list.
export const WALK_STREAMS = Object.freeze([
  'nt', 'otHistory', 'poetryProphecy', 'psalm', 'proverbs',
]);


// ── Small predicates re-exported for tests ─────────────────────────

/**
 * Shape-only email check. Mirrors prayer-intake / bible-donate helper.
 * Returns true for strings of the form `local@domain.tld` no longer
 * than WALK_EMAIL_MAX_CHARS. NOT a full RFC 5322 validator — we accept
 * "good-enough" because the email itself is verified by the miracle-link
 * round-trip (a typo means the link never lands).
 */
export function isLikelyEmail_(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  if (t.length > WALK_EMAIL_MAX_CHARS) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/**
 * Strict ISO 8601 calendar-date check: 'YYYY-MM-DD'. Round-trips through
 * Date.UTC so impossible dates like '2026-02-30' are rejected. Returns
 * true only for the exact 10-char shape; longer strings (e.g. with a
 * time component) are rejected.
 */
export function isIsoDateString_(s) {
  if (typeof s !== 'string' || s.length !== 10) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts = s.split('-').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Round-trip via Date to catch invalid dates like 2026-02-30 or 2025-04-31.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y
      && dt.getUTCMonth()    === m - 1
      && dt.getUTCDate()     === d;
}

/**
 * Walk_Token shape: exactly WALK_TOKEN_HEX_LENGTH (64) lowercase hex.
 * The token is the only credential — anyone with the string can stamp,
 * sync, or revoke on the device's behalf. Uppercase hex is rejected so
 * we don't accidentally accept a casing variant from a buggy caller.
 */
export function isWalkTokenHex_(s) {
  return typeof s === 'string'
      && s.length === WALK_TOKEN_HEX_LENGTH
      && /^[0-9a-f]+$/.test(s);
}

/**
 * Inclusive calendar-day diff between two ISO date strings.
 *   daysBetweenIso_('2026-04-30', '2026-05-01') === 1
 *   daysBetweenIso_('2026-04-30', '2026-04-30') === 0
 *   daysBetweenIso_('2026-05-01', '2026-04-30') === -1
 * Returns NaN if either input is not a valid ISO date string.
 */
export function daysBetweenIso_(aIso, bIso) {
  if (!isIsoDateString_(aIso) || !isIsoDateString_(bIso)) return NaN;
  const ap = aIso.split('-').map(Number);
  const bp = bIso.split('-').map(Number);
  const aMs = Date.UTC(ap[0], ap[1] - 1, ap[2]);
  const bMs = Date.UTC(bp[0], bp[1] - 1, bp[2]);
  return Math.round((bMs - aMs) / 86400000);
}

/**
 * ISO 8601 weekday for an ISO date: Mon=1 ... Sun=7. Returns 0 on
 * invalid input. Internal helper for the five-days-four-weeks badge.
 */
function isoWeekdayForDate_(isoDate) {
  if (!isIsoDateString_(isoDate)) return 0;
  const p = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  // getUTCDay returns Sun=0..Sat=6. We want Mon=1..Sun=7.
  return ((dt.getUTCDay() + 6) % 7) + 1;
}

/**
 * ISO 8601 week key for a date: 'YYYY-Www' (e.g. '2026-W22'). The
 * "Thursday-of-the-week determines the year" rule means a date in
 * early January may belong to the previous year's W52 or W53.
 *
 * Returns null on invalid input.
 */
export function isoWeekKeyForDate_(isoDate) {
  if (!isIsoDateString_(isoDate)) return null;
  const p = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  // Move to the nearest Thursday: current date + (4 - current day number).
  // dayNum is 1..7 (Mon..Sun); see isoWeekdayForDate_.
  const dayNum = ((date.getUTCDay() + 6) % 7) + 1;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return date.getUTCFullYear() + '-W' + String(weekNum).padStart(2, '0');
}

/**
 * Returns the ISO date of the Monday of an ISO week key like
 * '2026-W22'. Returns null on malformed input. Internal helper used
 * by consecutiveIsoWeeks_.
 */
function isoWeekMondayDate_(weekKey) {
  if (typeof weekKey !== 'string') return null;
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  if (week < 1 || week > 53) return null;
  // Jan 4th is always in W01 by ISO 8601. Find its Monday and offset.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = ((jan4.getUTCDay() + 6) % 7) + 1;     // Mon=1..Sun=7
  const w01Mon = new Date(Date.UTC(year, 0, 4 - (jan4Day - 1)));
  const offsetMs = (week - 1) * 7 * 86400000;
  return new Date(w01Mon.getTime() + offsetMs);
}

/**
 * Are 'YYYY-Www' keys aKey and bKey adjacent ISO weeks (bKey is
 * exactly the week immediately following aKey)? Internal helper used
 * by the five-days-four-weeks badge rule.
 */
function consecutiveIsoWeeks_(aKey, bKey) {
  const aMon = isoWeekMondayDate_(aKey);
  const bMon = isoWeekMondayDate_(bKey);
  if (!aMon || !bMon) return false;
  return Math.round((bMon - aMon) / 86400000) === 7;
}


// ── Walk_Link_Request validator ────────────────────────────────────
//
// Validates a miracle-link request payload. Lower-cases and trims the
// email so case/whitespace variants don't create duplicate WalkTokens
// rows. Returns either:
//   { ok: true,  email }
//   { ok: false, reason }    — reason ∈ {not-object, email-required,
//                                        email-too-long, bad-email}
export function validateWalkLinkRequest_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };
  const email = String(p.email == null ? '' : p.email).trim().toLowerCase();
  if (!email)                              return { ok: false, reason: 'email-required' };
  if (email.length > WALK_EMAIL_MAX_CHARS) return { ok: false, reason: 'email-too-long' };
  if (!isLikelyEmail_(email))              return { ok: false, reason: 'bad-email' };
  return { ok: true, email };
}


// ── Walk_Stamp validator ───────────────────────────────────────────
//
// Validates a stamp payload from the browser. The anchor object is
// optional — when present, it must be well-formed; a malformed anchor
// is silently stripped (the stamp still goes through with empty anchor
// fields). The Apps-Script-side wrapper additionally bounds-checks
// `today` against server UTC; that bound is enforced in
// handleWalkStamp_, not here, because this helper has to stay pure.
//
// Returns either:
//   { ok: true,  token, today, anchorBook, anchorChapter, stream }
//   { ok: false, reason }
//
// where reason ∈ {not-object, token-required, bad-token-shape,
//                 today-required, bad-date}.
export function validateWalkStamp_(p) {
  if (!p || typeof p !== 'object') return { ok: false, reason: 'not-object' };

  const token = String(p.token == null ? '' : p.token).trim();
  const today = String(p.today == null ? '' : p.today).trim();

  if (!token)                   return { ok: false, reason: 'token-required' };
  if (!isWalkTokenHex_(token))  return { ok: false, reason: 'bad-token-shape' };
  if (!today)                   return { ok: false, reason: 'today-required' };
  if (!isIsoDateString_(today)) return { ok: false, reason: 'bad-date' };

  let anchorBook = '';
  let anchorChapter = '';
  let stream = '';
  if (p.anchor && typeof p.anchor === 'object') {
    anchorBook = String(p.anchor.book == null ? '' : p.anchor.book)
      .trim()
      .slice(0, WALK_ANCHOR_BOOK_MAX_CHARS);

    const chRaw = p.anchor.chapter;
    const ch = typeof chRaw === 'number'
      ? Math.floor(chRaw)
      : parseInt(String(chRaw == null ? '' : chRaw), 10);
    if (isFinite(ch) && ch >= 1 && ch <= WALK_ANCHOR_CHAPTER_MAX) {
      anchorChapter = ch;
    }

    const streamRaw = String(p.anchor.stream == null ? '' : p.anchor.stream).trim();
    if (WALK_STREAMS.indexOf(streamRaw) !== -1) stream = streamRaw;
  }

  return { ok: true, token, today, anchorBook, anchorChapter, stream };
}


// ── computeStreak_ ─────────────────────────────────────────────────
//
// Pure streak math. Returns:
//   { current: integer, longest: integer, lastStampDate: 'YYYY-MM-DD'|null }
//
// Rules (also documented in design §2.7):
//   • Empty input → { current: 0, longest: 0, lastStampDate: null }.
//   • Two consecutive stamps with calendar-day gap g:
//       g === 0 → ignored (deduped).
//       g <= graceDays + 1 → streak grows by 1.
//       g >= graceDays + 2 → streak resets to 1.
//   • The function is deterministic — same (stampDates, today, graceDays)
//     always returns the same result.
//   • `today` is currently unused inside the fold but exposed in the
//     signature so a future extension can reset `current` on its own
//     when too many days pass without a stamp without breaking callers.
export function computeStreak_(stampDates, today, graceDays) {
  const grace = (graceDays == null) ? WALK_DEFAULT_GRACE_DAYS : graceDays;
  const inputs = (Array.isArray(stampDates) ? stampDates : [])
    .filter(isIsoDateString_);
  const unique = Array.from(new Set(inputs)).sort();

  if (unique.length === 0) {
    return { current: 0, longest: 0, lastStampDate: null };
  }

  let current = 0;
  let longest = 0;
  let prev = null;

  for (let i = 0; i < unique.length; i++) {
    const d = unique[i];
    if (prev === null) {
      current = 1;
    } else {
      const gap = daysBetweenIso_(prev, d);
      if (gap === 0) continue;                 // dedup defense in depth
      if (gap <= grace + 1) current = current + 1;
      else                  current = 1;
    }
    if (current > longest) longest = current;
    prev = d;
  }

  return { current, longest, lastStampDate: prev };
}


// ── evaluateBadgeUnlocks_ ──────────────────────────────────────────
//
// Reads a member's stamp history and a parsed badges.json catalog,
// and returns:
//   { newlyUnlocked: [string], all: [string] }
//
// `alreadyUnlocked` may be an Array, a Set, or null. It enumerates
// the badge ids already present in the WalkBadges tab for this email.
// A badge id appears in `newlyUnlocked` only when:
//   (1) the rule evaluates true on the current stamps, AND
//   (2) the id is NOT in alreadyUnlocked.
//
// `all` is the union of (alreadyUnlocked) ∪ (newlyUnlocked) — i.e.
// every badge the member has unlocked at any point. We preserve
// previously-unlocked ids in `all` even if the rule no longer
// evaluates true (because a future refactor might tighten a rule and
// we don't want a member to "lose" a badge they earned).
//
// The function is deterministic — Property YW4 fast-checks this.
// Property YW5 asserts that calling it twice in a row with the same
// inputs yields newlyUnlocked = [] on the second call.
export function evaluateBadgeUnlocks_(stamps, badgeCatalog, alreadyUnlocked) {
  const stampsList = Array.isArray(stamps) ? stamps : [];
  const catalog = (badgeCatalog && Array.isArray(badgeCatalog.badges))
    ? badgeCatalog.badges
    : [];

  let already;
  if (alreadyUnlocked instanceof Set) {
    already = alreadyUnlocked;
  } else if (Array.isArray(alreadyUnlocked)) {
    already = new Set(alreadyUnlocked);
  } else {
    already = new Set();
  }

  const newly = [];
  const all = [];

  for (let i = 0; i < catalog.length; i++) {
    const badge = catalog[i];
    if (!badge || typeof badge.id !== 'string') continue;
    const wasUnlocked = already.has(badge.id);
    const ruleHits = wasUnlocked || evaluateRule_(badge.unlockRule, stampsList);
    if (ruleHits) {
      all.push(badge.id);
      if (!wasUnlocked) newly.push(badge.id);
    }
  }

  return { newlyUnlocked: newly, all };
}

/**
 * Internal — dispatches an unlockRule string to its evaluator. Unknown
 * rules return false so adding a badge with a typoed rule never falsely
 * unlocks. The five seed rules match design §2.10 verbatim.
 */
function evaluateRule_(rule, stamps) {
  switch (rule) {
    case 'first-stamp-ever':
      return stamps.length >= 1;

    case 'twenty-one-john-chapters': {
      const johnChapters = new Set();
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i];
        if (s && s.anchor_book === 'John'
            && typeof s.anchor_chapter === 'number'
            && Number.isFinite(s.anchor_chapter)) {
          johnChapters.add(s.anchor_chapter);
        }
      }
      return johnChapters.size >= 21;
    }

    case 'thirty-psalm-stamps': {
      const psalmDates = new Set();
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i];
        if (s && s.stream === 'psalm' && isIsoDateString_(s.stamp_date)) {
          psalmDates.add(s.stamp_date);
        }
      }
      return psalmDates.size >= 30;
    }

    case 'thirty-day-streak': {
      const dates = [];
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i];
        if (s && isIsoDateString_(s.stamp_date)) dates.push(s.stamp_date);
      }
      if (dates.length === 0) return false;
      const sorted = Array.from(new Set(dates)).sort();
      const r = computeStreak_(sorted, sorted[sorted.length - 1], WALK_DEFAULT_GRACE_DAYS);
      // longest, not current — the badge is "you got there", not "you're there now".
      return r.longest >= 30;
    }

    case 'five-days-four-weeks': {
      // Group weekday-stamps by ISO week. A week qualifies if it has
      // 5 distinct weekday-stamp dates (Mon..Fri). Then look for any
      // 4 consecutive qualifying weeks anywhere in the history.
      const datesByWeek = new Map();
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i];
        if (!s || !isIsoDateString_(s.stamp_date)) continue;
        const dow = isoWeekdayForDate_(s.stamp_date);   // Mon=1..Sun=7
        if (dow < 1 || dow > 5) continue;               // weekday only
        const wk = isoWeekKeyForDate_(s.stamp_date);
        if (!wk) continue;
        if (!datesByWeek.has(wk)) datesByWeek.set(wk, new Set());
        datesByWeek.get(wk).add(s.stamp_date);
      }
      const qualifying = [];
      for (const entry of datesByWeek) {
        if (entry[1].size >= 5) qualifying.push(entry[0]);
      }
      qualifying.sort();
      // Sliding window of length 4 — need three consecutive-week edges.
      for (let i = 0; i + 3 < qualifying.length; i++) {
        if (consecutiveIsoWeeks_(qualifying[i],     qualifying[i + 1])
         && consecutiveIsoWeeks_(qualifying[i + 1], qualifying[i + 2])
         && consecutiveIsoWeeks_(qualifying[i + 2], qualifying[i + 3])) {
          return true;
        }
      }
      return false;
    }

    default:
      return false;
  }
}


// ── tokenIsActive_ ─────────────────────────────────────────────────
//
// True iff the WalkTokens row represents a credential that is currently
// usable. A row is INACTIVE when:
//   • revoked_at is set (admin soft-revoke, reserved column), OR
//   • expires_at is missing / unparseable / in the past or equal to now.
//
// Property YW6 fast-checks this on random TTL configurations. Note
// that handleWalkRevoke_ deliberately bypasses this helper so a member
// whose token has expired can still wipe their data without renewing.
export function tokenIsActive_(tokenRow, now) {
  if (!tokenRow || typeof tokenRow !== 'object') return false;
  if (tokenRow.revoked_at) return false;

  const expRaw = tokenRow.expires_at;
  if (expRaw == null || expRaw === '') return false;
  const exp = (expRaw instanceof Date) ? expRaw : new Date(expRaw);
  if (!(exp instanceof Date) || isNaN(exp.getTime())) return false;

  const nowMs = (now instanceof Date && !isNaN(now.getTime()))
    ? now.getTime()
    : Date.now();
  return exp.getTime() > nowMs;
}


// ── findEmailLinkRequestsInWindow_ ─────────────────────────────────
//
// Reads a sheet's `values` array (the result of getDataRange().getValues(),
// including the header row at index 0) and returns the timestamps of
// every link-request inside the rolling window for the given email.
// Output is sorted ascending. Caller compares output.length to the
// rate-limit cap to decide whether to allow a new request.
//
// `idx` is a header→column-index map (e.g. produced by the wrapper's
// headerIndex_ helper). Required keys: `email`, `link_requests_24h_ts`.
//
// `email` is matched case-insensitively against the row's email column
// after both sides are lower-cased.
//
// Property YW7 (helper-side) fast-checks the rolling-window boundary.
export function findEmailLinkRequestsInWindow_(values, idx, email, hours, now) {
  if (!Array.isArray(values) || values.length < 2) return [];
  if (!idx || typeof idx !== 'object') return [];
  if (typeof idx.email !== 'number' || typeof idx.link_requests_24h_ts !== 'number') {
    return [];
  }

  const target = String(email == null ? '' : email).trim().toLowerCase();
  if (!target) return [];

  const windowMs = (typeof hours === 'number' && hours > 0 ? hours : WALK_LINK_RATE_WINDOW_HOURS) * 3600000;
  const nowMs = (now instanceof Date && !isNaN(now.getTime())) ? now.getTime() : Date.now();
  const cutoffMs = nowMs - windowMs;

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row) continue;
    const rowEmail = String(row[idx.email] == null ? '' : row[idx.email]).trim().toLowerCase();
    if (rowEmail !== target) continue;

    const tsField = String(row[idx.link_requests_24h_ts] == null ? '' : row[idx.link_requests_24h_ts]);
    if (!tsField) continue;

    const parts = tsField.split(',');
    for (let i = 0; i < parts.length; i++) {
      const tsRaw = parts[i].trim();
      if (!tsRaw) continue;
      const ts = new Date(tsRaw);
      if (isNaN(ts.getTime())) continue;
      if (ts.getTime() >= cutoffMs) out.push(ts);
    }
  }

  out.sort(function (a, b) { return a.getTime() - b.getTime(); });
  return out;
}
