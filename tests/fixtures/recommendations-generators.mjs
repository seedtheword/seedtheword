/**
 * Generators for "What We're Listening To" creator-feed bug-condition tests.
 *
 * Spec:    .kiro/specs/friends-in-jesus-creator-platforms/
 * Used by: tests/recommendations-render.test.js
 *
 * Conventions
 * -----------
 * - Built on top of the helpers in tests/harness.mjs (`pick`, `range`,
 *   `genAsciiString`) so the harness's `forAll(gen, predicate, n)` runner
 *   can drive them without an fc.assert wrapper. Math.random()-based,
 *   no `fast-check` dependency.
 * - All title/source/note strings are SAFE PRINTABLE ASCII (a-zA-Z0-9 + space).
 *   Preservation/escape behavior with HTML-special characters is exercised by
 *   separate tests; this fixture isolates the bug-condition signal so the
 *   counterexamples surfaced by `forAll` are about missing platform branches,
 *   not about HTML-escape edge cases.
 * - Each `arb*` is a thunk: `arb*()` returns one fresh sample.
 *
 * Exports
 * -------
 *   arbYouTubeChannelEntry   — Property 1.a (channel feed)
 *   arbYouTubePlaylistEntry  — Property 1.b (playlist feed)
 *   arbInstagramEntry        — Property 1.c (Instagram profile)
 *   arbTwitchEntry           — Property 1.d (Twitch channel)
 */

import { pick, range, genAsciiString } from '../harness.mjs';

// ── primitive char-class helpers ────────────────────────────────────────────

const HEX_CHARS         = '0123456789abcdefABCDEF'.split('');
// YouTube channel IDs after the leading "UC" are 22 chars from the
// URL-safe base64 alphabet; we use a slightly narrower set so the
// counterexamples remain easy to read in test output.
const YT_ID_TAIL_CHARS  = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('');
const YT_HANDLE_CHARS   = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('');
const IG_HANDLE_CHARS   = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._'.split('');
const TWITCH_CHARS      = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('');

function repeatPick(chars, len) {
  let out = '';
  for (let i = 0; i < len; i++) out += pick(chars);
  return out;
}

/**
 * Non-empty printable-ASCII title/source/note string. Avoids HTML-special
 * characters (`& < > " '`) deliberately — see header comment.
 *
 * Sample space: 1..40 chars from [a-zA-Z0-9 ].
 */
function genSafeText(minLen = 1, maxLen = 40) {
  for (let i = 0; i < 5; i++) {
    const s = genAsciiString(minLen, maxLen).trim();
    if (s.length >= minLen) return s;
  }
  return 'creator ' + genAsciiString(0, 8);
}

// Optional note: present ~60% of the time.
function maybeNote() {
  return Math.random() < 0.6 ? genSafeText(1, 60) : undefined;
}

// ── Property 1.a — YouTube channel ──────────────────────────────────────────

/**
 * Generate a YouTube channel creator-feed entry.
 *
 * Two shapes alternate uniformly:
 *   (a) UC-id form:    id = "UC" + 22 chars from YT_ID_TAIL_CHARS, no handle
 *   (b) @handle form:  id = "@" + 6..18 chars from YT_HANDLE_CHARS,
 *                      handle = same string (mirrors design §1b — admins
 *                      who paste a handle URL store the handle as the id).
 *
 * In both forms, `kind: "youtube"` + `feedType: "channel"` is the bug-
 * condition signal: the unfixed renderer ignores `feedType` entirely and
 * routes through `renderYouTubeCard`, which produces a `watch?v=<id>` link
 * instead of a channel link.
 */
export function arbYouTubeChannelEntry() {
  const useHandle = Math.random() < 0.5;
  const entry = {
    kind: 'youtube',
    feedType: 'channel',
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  if (useHandle) {
    const handle = '@' + repeatPick(YT_HANDLE_CHARS, range(6, 18));
    entry.id     = handle;
    entry.handle = handle;
  } else {
    entry.id = 'UC' + repeatPick(YT_ID_TAIL_CHARS, 22);
  }
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// ── Property 1.b — YouTube playlist ────────────────────────────────────────

/**
 * Generate a YouTube playlist creator-feed entry.
 *
 * Shape: `kind: "youtube"` + `feedType: "playlist"` + `id: "PL" + 32 chars`.
 * The unfixed renderer ignores `feedType`, so it emits the single-video
 * embed/watch URLs against the PL-prefixed id — visibly wrong.
 */
export function arbYouTubePlaylistEntry() {
  const entry = {
    kind: 'youtube',
    feedType: 'playlist',
    id: 'PL' + repeatPick(YT_ID_TAIL_CHARS, 32),
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// ── Property 1.c — Instagram profile ───────────────────────────────────────

/**
 * Generate an Instagram profile creator-feed entry.
 *
 * Handle character class is `[A-Za-z0-9._]` per design §1c, length 1..30.
 * The unfixed renderer falls through to `renderLinkCard` (default branch)
 * because there's no `case 'instagram':` — that produces a generic link
 * card with no Instagram badge, no `instagram.com/<handle>/` href (since
 * the entry has no `url` field), and no `.reco-card--instagram` modifier.
 */
export function arbInstagramEntry() {
  const handle = repeatPick(IG_HANDLE_CHARS, range(1, 30));
  const entry = {
    kind: 'instagram',
    handle,
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  if (Math.random() < 0.4) {
    entry.avatar = 'assets/images/featured/' + repeatPick(YT_HANDLE_CHARS, range(4, 16)) + '.jpg';
  }
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// ── Property 1.d — Twitch channel ──────────────────────────────────────────

/**
 * Generate a Twitch channel creator-feed entry.
 *
 * Channel character class is `[A-Za-z0-9_]`, length 4..25 per design §1d.
 * Like Instagram, the unfixed renderer falls through to `renderLinkCard`
 * because no `case 'twitch':` exists, so the rendered HTML lacks the
 * Twitch badge, the `.reco-card--twitch` modifier, and the
 * `twitch.tv/<channel>` href.
 */
export function arbTwitchEntry() {
  const channel = repeatPick(TWITCH_CHARS, range(4, 25));
  const entry = {
    kind: 'twitch',
    channel,
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// Re-export HEX_CHARS only so static analyzers don't flag it as unused if
// downstream tests want to mirror the channel-id char set directly.
export const _internals = { HEX_CHARS };

// ───────────────────────────────────────────────────────────────────────────
// Preservation generators (Property 2 — Task 10)
//
// These cover the entry shapes that are ALREADY supported by the unfixed
// renderer. The preservation properties drive both the fixed renderer and
// the frozen baseline through these generators and assert byte-identity
// (modulo whitespace) of the rendered HTML.
//
// All textual fields stay safe-printable-ASCII so escapeHtml does not
// introduce false-positive entity differences (`&` → `&amp;` etc.). Both
// renderers handle escaping identically, so this is just for readability
// of any failing counterexamples.
// ───────────────────────────────────────────────────────────────────────────

// 22-char base62 ID (Spotify episode / show, YouTube video).
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

function maybe(value, prob = 0.5) {
  return Math.random() < prob ? value : undefined;
}

// ── 2.a — Spotify episode entry ────────────────────────────────────────────

/**
 * `{ kind:'spotify', type:'episode', id, title, source, note? }`.
 * Mirrors the production entry shape exactly. The fixed renderer's
 * Spotify branch is byte-for-byte the original — this generator
 * exists to drive the preservation property over a wide id/title
 * sample, not because the branch is suspect.
 */
export function arbSpotifyEpisodeEntry() {
  const entry = {
    kind: 'spotify',
    type: 'episode',
    id: repeatPick(BASE62, 22),
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// ── 2.b — Spotify show entry ───────────────────────────────────────────────

/**
 * Same shape as the episode entry but with `type:'show'`. Both renderers
 * route this through `renderSpotifyCard`, which only branches on
 * `type === 'show'` to flip the URL path segment.
 */
export function arbSpotifyShowEntry() {
  const entry = {
    kind: 'spotify',
    type: 'show',
    id: repeatPick(BASE62, 22),
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// ── 2.c — YouTube single-video entry (no feedType) ─────────────────────────

/**
 * `{ kind:'youtube', id, title, source, note? }` — explicitly no
 * `feedType` field so this exercises the back-compat default path
 * (the fixed renderer treats missing `feedType` as `'video'`, which
 * is the only branch the original renderer has).
 */
export function arbYouTubeVideoEntry() {
  const entry = {
    kind: 'youtube',
    id: repeatPick(BASE62, 11), // canonical YouTube video id length
    title:  genSafeText(1, 40),
    source: genSafeText(1, 40),
  };
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  return entry;
}

// ── 2.d — Link entry ───────────────────────────────────────────────────────

/**
 * `{ kind:'link', url, title, source?, note?, image? }`.
 * Both renderers' link branch is byte-identical; the URL/title/source/note
 * fields are routed through escapeAttr/escapeHtml the same way.
 */
export function arbLinkEntry() {
  const slug = repeatPick(YT_HANDLE_CHARS, range(4, 16));
  const entry = {
    kind: 'link',
    url: 'https://example.com/' + slug,
    title:  genSafeText(1, 40),
  };
  if (Math.random() < 0.7) entry.source = genSafeText(1, 40);
  const note = maybeNote();
  if (note !== undefined) entry.note = note;
  if (Math.random() < 0.3) {
    entry.image = 'assets/images/featured/' + repeatPick(YT_HANDLE_CHARS, range(4, 16)) + '.jpg';
  }
  return entry;
}

// ── 2.e — Partners array ───────────────────────────────────────────────────

/**
 * Partner entries are unchanged in this fix. The renderer has no
 * branching — it just maps `name`, `url`, optional `logo`, optional
 * `description` into a single `<a class="partner-card …">` per row.
 */
function arbPartnerEntry() {
  const slug = repeatPick(YT_HANDLE_CHARS, range(3, 16));
  const entry = {
    name: genSafeText(1, 40),
    url:  'https://example.org/' + slug,
  };
  if (Math.random() < 0.5) {
    entry.logo = 'assets/images/featured/' + slug + '.jpg';
  }
  if (Math.random() < 0.6) {
    entry.description = genSafeText(1, 80);
  }
  return entry;
}

/**
 * Generate a `partners[]` array of length 0..6. Length 0 exercises the
 * empty-state path (also covered by Property 2.f) — keeping it in the
 * sample space gives the bulk-renderer property extra coverage.
 */
export function arbPartnersArray() {
  const n = range(0, 6);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = arbPartnerEntry();
  return out;
}

// ── 1.e — Mixed-kind array (Task 9) ────────────────────────────────────────
//
// Combines all eight currently-rendered kinds in a single list, picked
// uniformly at random for each slot:
//   spotify episode, spotify show, youtube video, youtube channel,
//   youtube playlist, instagram, twitch, link.
// Length is 1..6 to keep iterations cheap on CI.

export function arbMixedKindArray() {
  const generators = [
    arbSpotifyEpisodeEntry,
    arbSpotifyShowEntry,
    arbYouTubeVideoEntry,
    arbYouTubeChannelEntry,
    arbYouTubePlaylistEntry,
    arbInstagramEntry,
    arbTwitchEntry,
    arbLinkEntry,
  ];
  const n = range(1, 6);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = pick(generators)();
  return out;
}
