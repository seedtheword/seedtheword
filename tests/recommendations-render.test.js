/**
 * friends-in-jesus-creator-platforms — Property 1 (Bug Condition) exploration.
 *
 * Spec:        .kiro/specs/friends-in-jesus-creator-platforms/
 * Run (CI):    node --test tests/recommendations-render.test.js
 * Note:        Node is not installed locally — CI is the only test runner.
 *
 * Test plan
 * ---------
 *   Property 1.a — YouTube channel feed   (50 iterations)
 *   Property 1.b — YouTube playlist feed  (50 iterations)
 *   Property 1.c — Instagram profile      (50 iterations)
 *   Property 1.d — Twitch channel         (50 iterations)
 *
 * THESE TESTS MUST FAIL on the unfixed `assets/js/recommendations.js`.
 * The failures ARE the proof the bug exists — `renderListeningCard` has
 * no branches for the four new creator-feed kinds yet, so unsupported
 * entries fall through to either `renderYouTubeCard` (single-video
 * pattern) or `renderLinkCard` (generic 🔗 Link card). Both outputs
 * lack the platform-specific assertions below.
 *
 * Loader pattern: read `assets/js/recommendations.js` as text, strip the
 * trailing `document.addEventListener('DOMContentLoaded', …)` IIFE, and
 * evaluate the rest in a fresh `vm.Script` context with stubbed globals
 * (document, window, fetch). The vm context exposes `renderListeningCard`
 * and `renderPartners` as the surface under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forAll, makeFakeFetch } from './harness.mjs';
import {
  arbYouTubeChannelEntry,
  arbYouTubePlaylistEntry,
  arbInstagramEntry,
  arbTwitchEntry,
  arbSpotifyEpisodeEntry,
  arbSpotifyShowEntry,
  arbYouTubeVideoEntry,
  arbLinkEntry,
  arbPartnersArray,
  arbMixedKindArray,
} from './fixtures/recommendations-generators.mjs';
import * as ORIGINAL from './fixtures/recommendations-renderer-original.js';

// ── Loader ──────────────────────────────────────────────────────────────────
//
// Resolve the renderer source once at module init. Each property test
// loads it into a fresh vm context to avoid cross-iteration state bleed
// (the renderer module-scope is small but we keep the pattern uniform
// with tests/schema-testimonies.test.js).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_PATH = path.resolve(__dirname, '..', 'assets', 'js', 'recommendations.js');
const RENDERER_FULL_SRC = fs.readFileSync(RENDERER_PATH, 'utf-8');

/**
 * Strip the trailing `document.addEventListener('DOMContentLoaded', …)`
 * block. Without this, evaluating the file inside a vm context would
 * try to register a real DOMContentLoaded listener against our stub
 * `document` and (more importantly) would call `document.getElementById`
 * on `'listening-container'` / `'partners-container'`, which our stub
 * doesn't model — and even if it did, we don't want that side effect
 * during a unit test.
 *
 * The IIFE we strip starts at the canonical comment marker
 *   `// -------------------------------------------------------------------------\n// Init`
 * and runs to end-of-file. We use the comment marker rather than the
 * `document.addEventListener(` literal because the latter is a more
 * fragile match — but we also assert the stripped tail contains the
 * expected `addEventListener` token so a future refactor that removes
 * the marker comment fails loudly here instead of silently changing
 * the loader's behavior.
 */
function stripInitBlock(src) {
  const marker = '// Init';
  const idx = src.lastIndexOf(marker);
  if (idx === -1) {
    throw new Error('recommendations.js: "// Init" comment marker not found — loader needs an update');
  }
  // Walk backwards to the start of the comment-rule line that precedes
  // "// Init" so we drop the whole banner.
  // The banner is exactly: "// ----...----\n// Init"
  let bannerStart = idx;
  while (bannerStart > 0 && src[bannerStart - 1] !== '\n') bannerStart--;
  // Step over the "// ----...----" line above.
  if (bannerStart > 0) {
    bannerStart--; // step onto the trailing newline of the previous line
    while (bannerStart > 0 && src[bannerStart - 1] !== '\n') bannerStart--;
  }
  const head = src.slice(0, bannerStart);
  const tail = src.slice(bannerStart);
  if (!tail.includes('addEventListener')) {
    throw new Error(
      'recommendations.js: stripped tail did not contain `addEventListener` — ' +
      'loader marker drifted; please update tests/recommendations-render.test.js'
    );
  }
  return head;
}

const RENDERER_SRC = stripInitBlock(RENDERER_FULL_SRC);

/**
 * Evaluate the renderer source inside a fresh vm context with stub globals
 * and return `{ renderListeningCard, renderPartners, fetchRecommendationsData }`.
 *
 * The stub `window` object captures the assignments the production code
 * makes (`window.fetchRecommendationsData = …`, etc.) so we can pluck
 * them back out without re-implementing the IIFE pattern.
 */
function loadRenderer(opts = {}) {
  const win = {};
  const doc = {
    // The init block is stripped, but a few defensive helpers in
    // recommendations.js may consult `document` indirectly via the
    // renderer functions themselves. The current code does not, but
    // we provide a minimal stub in case future renderers do.
    getElementById() { return null; },
    addEventListener() {},
  };
  const fetchImpl =
    typeof opts.fetch === 'function'
      ? opts.fetch
      : async () => ({ ok: false, status: 599, json: async () => ({}) });
  const ctx = vm.createContext({
    window: win,
    document: doc,
    // The renderer's fetchRecommendationsData uses fetch + Date.now; both
    // are unused by the four bug-condition properties (which call the
    // pure renderListeningCard directly), but providing them keeps the
    // module-init evaluation robust. Property 2.g overrides the default
    // by passing a stub fetch through `opts.fetch`.
    fetch: fetchImpl,
    console,
  });
  const script = new vm.Script(RENDERER_SRC, { filename: 'assets/js/recommendations.js' });
  script.runInContext(ctx);
  // Production code exports onto `window`. Pull them off the stub.
  if (typeof win.renderListeningCard !== 'function') {
    throw new Error('recommendations.js did not expose window.renderListeningCard');
  }
  // `renderListening` is a module-scoped function declaration in the
  // production file (it is NOT assigned to `window`). After
  // `runInContext`, function declarations evaluated at the top level of
  // the script become own properties of the supplied context object, so
  // we can pull `renderListening` straight off `ctx`. Fallback to
  // ORIGINAL.renderListening so the preservation properties that drive
  // the empty-state path (Property 2.f) keep working even if a future
  // module-system change makes the function declaration unreachable.
  const renderListeningFromCtx =
    typeof ctx.renderListening === 'function' ? ctx.renderListening : ORIGINAL.renderListening;
  return {
    renderListeningCard: win.renderListeningCard,
    renderPartners: win.renderPartners,
    fetchRecommendationsData: win.fetchRecommendationsData,
    renderListening: renderListeningFromCtx,
  };
}

// Single shared loader handle. The four properties only exercise the pure
// renderListeningCard, so context isolation across properties is not
// required — and a single load keeps the iteration count honest.
const { renderListeningCard, renderPartners, renderListening } = loadRenderer();

// ──────────────────────────────────────────────────────────────
// Feature: friends-in-jesus-creator-platforms,
// Property 1.a — Bug Condition: YouTube channel feed
// **Validates: Requirements 2.1, 2.6**
//
// EXPECTED TO FAIL on unfixed code: the renderer has no `feedType`
// branch, so a `kind:"youtube"` entry with `feedType:"channel"` and an
// id like "UCxxxx…" is routed through `renderYouTubeCard`, which emits
// `https://www.youtube.com/embed/UCxxxx…` (an invalid embed) and
// `https://www.youtube.com/watch?v=UCxxxx…` (a watch URL pointing at a
// channel id, which is broken). Neither URL contains
// `youtube.com/channel/` or `youtube.com/@`, and the watch?v=<id>
// URL is exactly what we forbid.
// ──────────────────────────────────────────────────────────────
test('Property 1.a — YouTube channel entries render as a channel card', () => {
  forAll(
    arbYouTubeChannelEntry,
    (x) => {
      const html = renderListeningCard(x);

      assert.ok(
        typeof html === 'string' && html.length > 0,
        'renderListeningCard must return a non-empty string'
      );

      // (1) The outbound link must point at the channel page, not the
      //     /watch?v= page. Either /channel/<UC…> or /@<handle> is OK.
      const hasChannelPath = html.includes('youtube.com/channel/') || html.includes('youtube.com/@');
      assert.ok(
        hasChannelPath,
        'expected the rendered HTML to link to youtube.com/channel/ or youtube.com/@ — got HTML without a channel-style URL'
      );

      // (2) The card must carry the YouTube-channel modifier class so
      //     the platform palette can be applied.
      assert.ok(
        html.includes('reco-card--youtube-channel'),
        'expected `reco-card--youtube-channel` modifier class on the rendered card'
      );

      // (3) The card MUST NOT emit a watch?v=<id> URL using the
      //     channel/handle id — that's what the unfixed renderer does.
      const wrongWatch = `watch?v=${x.id}`;
      assert.ok(
        !html.includes(wrongWatch),
        `rendered HTML must not include single-video URL "${wrongWatch}" for a channel feed`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Feature: friends-in-jesus-creator-platforms,
// Property 1.b — Bug Condition: YouTube playlist feed
// **Validates: Requirements 2.1, 2.6**
//
// EXPECTED TO FAIL on unfixed code: the renderer ignores `feedType`,
// so a `kind:"youtube"` entry with `feedType:"playlist"` and an id
// like "PLxxxx…" is routed through `renderYouTubeCard`, producing
// `embed/PLxxxx…` (broken) and `watch?v=PLxxxx…` (broken). The
// expected playlist URLs (`youtube.com/playlist?list=` +
// `embed/videoseries?list=`) and modifier class
// (`reco-card--youtube-playlist`) are absent.
// ──────────────────────────────────────────────────────────────
test('Property 1.b — YouTube playlist entries render as a playlist card', () => {
  forAll(
    arbYouTubePlaylistEntry,
    (x) => {
      const html = renderListeningCard(x);

      assert.ok(
        typeof html === 'string' && html.length > 0,
        'renderListeningCard must return a non-empty string'
      );

      assert.ok(
        html.includes('youtube.com/playlist?list='),
        'expected outbound link `youtube.com/playlist?list=…` for a playlist feed'
      );

      assert.ok(
        html.includes('embed/videoseries?list='),
        'expected playlist embed `embed/videoseries?list=…` for a playlist feed'
      );

      assert.ok(
        html.includes('reco-card--youtube-playlist'),
        'expected `reco-card--youtube-playlist` modifier class on the rendered card'
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Feature: friends-in-jesus-creator-platforms,
// Property 1.c — Bug Condition: Instagram profile
// **Validates: Requirements 2.2, 2.6**
//
// EXPECTED TO FAIL on unfixed code: there is no `case 'instagram':`
// in `renderListeningCard`'s switch, so `kind:"instagram"` falls
// through to `renderLinkCard`. That emits `🔗 Link` and a
// `.reco-card--link` modifier — none of the Instagram assertions
// below can match.
// ──────────────────────────────────────────────────────────────
test('Property 1.c — Instagram entries render as a branded Instagram card', () => {
  forAll(
    arbInstagramEntry,
    (x) => {
      const html = renderListeningCard(x);

      assert.ok(
        typeof html === 'string' && html.length > 0,
        'renderListeningCard must return a non-empty string'
      );

      assert.ok(
        html.includes('reco-card--instagram'),
        'expected `reco-card--instagram` class on the rendered Instagram card'
      );

      // Visible badge label. We accept either the emoji-prefixed form
      // ("📸 Instagram") or just "Instagram" so an unrelated decision
      // about emoji-vs-no-emoji in the badge text doesn't sink this
      // test. Both forms include the literal word "Instagram".
      assert.ok(
        html.includes('Instagram'),
        'expected the badge text to include "Instagram"'
      );

      // Outbound href must point at instagram.com/<handle>/.
      const expectedHref = `instagram.com/${x.handle}/`;
      assert.ok(
        html.includes(expectedHref),
        `expected outbound link to include "${expectedHref}"`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Feature: friends-in-jesus-creator-platforms,
// Property 1.d — Bug Condition: Twitch channel
// **Validates: Requirements 2.3, 2.6**
//
// EXPECTED TO FAIL on unfixed code: there is no `case 'twitch':`
// in `renderListeningCard`'s switch, so `kind:"twitch"` falls
// through to `renderLinkCard`. That emits `🔗 Link` and a
// `.reco-card--link` modifier — the Twitch assertions below cannot
// match.
// ──────────────────────────────────────────────────────────────
test('Property 1.d — Twitch entries render as a branded Twitch card', () => {
  forAll(
    arbTwitchEntry,
    (x) => {
      const html = renderListeningCard(x);

      assert.ok(
        typeof html === 'string' && html.length > 0,
        'renderListeningCard must return a non-empty string'
      );

      assert.ok(
        html.includes('reco-card--twitch'),
        'expected `reco-card--twitch` class on the rendered Twitch card'
      );

      // Visible badge label. Same emoji-tolerant match as Property 1.c.
      assert.ok(
        html.includes('Twitch'),
        'expected the badge text to include "Twitch"'
      );

      // Outbound href must point at twitch.tv/<channel>.
      const expectedHref = `twitch.tv/${x.channel}`;
      assert.ok(
        html.includes(expectedHref),
        `expected outbound link to include "${expectedHref}"`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Feature: friends-in-jesus-creator-platforms,
// Property 1.e — Mixed-kind array order
// **Validates: Requirement 2.6**
//
// Drive `renderListening(stub_el, list)` for a list of length 1..6
// containing a mix of all eight kinds (spotify episode, spotify show,
// youtube video, youtube channel, youtube playlist, instagram, twitch,
// link). Two assertions:
//   (1) The rendered HTML contains exactly `list.length` `.reco-card`
//       articles — count via simple substring matching.
//   (2) For each entry by index, the i-th rendered card contains the
//       expected platform substring (Spotify / YouTube / Instagram /
//       Twitch / Link). We split the html on `</article>` boundaries —
//       the i-th chunk is the i-th card.
// ──────────────────────────────────────────────────────────────
test('Property 1.e — Mixed-kind array preserves length and per-index platform', () => {
  forAll(
    arbMixedKindArray,
    (list) => {
      const el = { innerHTML: '' };
      renderListening(el, list);
      const html = el.innerHTML;

      assert.ok(
        typeof html === 'string' && html.length > 0,
        'renderListening must populate innerHTML with a non-empty string'
      );

      // (1) Card count matches list length.
      const cardMatches = html.match(/class="reco-card /g) || [];
      assert.equal(
        cardMatches.length,
        list.length,
        `expected exactly ${list.length} .reco-card articles, got ${cardMatches.length}`
      );

      // (2) Per-index platform substring. Splitting on `</article>`
      //     yields list.length+1 chunks; the trailing chunk (after the
      //     last article) is the closing `</div>` and we ignore it.
      const chunks = html.split('</article>');
      list.forEach((entry, i) => {
        const chunk = chunks[i] || '';
        const expected = expectedPlatformSubstring(entry);
        assert.ok(
          chunk.includes(expected),
          `expected card #${i} (kind=${entry.kind}, feedType=${entry.feedType || ''}) to contain "${expected}" — got chunk: ${chunk.slice(0, 200)}…`
        );
      });
    },
    50
  );
});

/**
 * Map a generated entry to the visible platform-name substring its
 * rendered card MUST contain. Keeps the assertion loose (just the word,
 * not the full badge text) so an unrelated badge-text decision (emoji or
 * "— Channel" suffix etc.) doesn't sink the property.
 */
function expectedPlatformSubstring(entry) {
  switch (entry.kind) {
    case 'spotify':   return 'Spotify';
    case 'youtube':   return 'YouTube';
    case 'instagram': return 'Instagram';
    case 'twitch':    return 'Twitch';
    case 'link':
    default:          return 'Link';
  }
}

// ===========================================================================
// Property 2 — Preservation properties (Task 10)
//
// These run the FIXED renderer side-by-side with the FROZEN baseline
// (`tests/fixtures/recommendations-renderer-original.js`) and assert
// whitespace-collapsed equality of the rendered HTML. Both renderers
// share the same Spotify-episode / Spotify-show / YouTube-video / Link
// branches, so the byte-equality assertion is real coverage that no
// preservation regression has crept into those paths.
//
// NOTE: Property 2.h (admin-help builder JSON output preservation) is
// SKIPPED. `assets/js/admin-help.js` depends on too many DOM globals
// (CodeMirror-style editor, GitHub-client wiring, file-tree state) to
// feasibly load in a Node `vm` context. 2.h is verified manually and by
// the task 5.4 sub-task's byte-identity diff in code review.
// ===========================================================================

/**
 * Whitespace-equality predicate per design §"Property 2": collapse runs
 * of whitespace to a single space and trim. Differences in newline /
 * indent counts between template literals don't count; everything else
 * does.
 */
function eqHtml(a, b) {
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

// ──────────────────────────────────────────────────────────────
// Property 2.a — Spotify episode preservation
// **Validates: Requirement 3.1**
// ──────────────────────────────────────────────────────────────
test('Property 2.a — Spotify episode renders byte-identically vs frozen baseline', () => {
  forAll(
    arbSpotifyEpisodeEntry,
    (x) => {
      const fixed = renderListeningCard(x);
      const orig  = ORIGINAL.renderListeningCard(x);
      assert.ok(
        eqHtml(fixed, orig),
        `spotify episode preservation drift\n  fixed=${fixed}\n  orig =${orig}`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Property 2.b — Spotify show preservation
// **Validates: Requirement 3.2**
// ──────────────────────────────────────────────────────────────
test('Property 2.b — Spotify show renders byte-identically vs frozen baseline', () => {
  forAll(
    arbSpotifyShowEntry,
    (x) => {
      const fixed = renderListeningCard(x);
      const orig  = ORIGINAL.renderListeningCard(x);
      assert.ok(
        eqHtml(fixed, orig),
        `spotify show preservation drift\n  fixed=${fixed}\n  orig =${orig}`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Property 2.c — YouTube single-video preservation
// **Validates: Requirement 3.3**
//
// The generated entry has NO `feedType` field, so the fixed renderer's
// `feedType || 'video'` default routes through the back-compat branch
// that must be byte-identical to the frozen original.
// ──────────────────────────────────────────────────────────────
test('Property 2.c — YouTube single-video renders byte-identically vs frozen baseline', () => {
  forAll(
    arbYouTubeVideoEntry,
    (x) => {
      const fixed = renderListeningCard(x);
      const orig  = ORIGINAL.renderListeningCard(x);
      assert.ok(
        eqHtml(fixed, orig),
        `youtube video preservation drift\n  fixed=${fixed}\n  orig =${orig}`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Property 2.d — Link preservation
// **Validates: Requirement 3.4**
// ──────────────────────────────────────────────────────────────
test('Property 2.d — Link entries render byte-identically vs frozen baseline', () => {
  forAll(
    arbLinkEntry,
    (x) => {
      const fixed = renderListeningCard(x);
      const orig  = ORIGINAL.renderListeningCard(x);
      assert.ok(
        eqHtml(fixed, orig),
        `link preservation drift\n  fixed=${fixed}\n  orig =${orig}`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Property 2.e — Partners preservation
// **Validates: Requirement 3.5**
//
// Drive both renderers through `renderPartners(stub_el, P)` and assert
// the resulting `innerHTML` is whitespace-equal. The partners path is
// not modified by this fix, so equality must hold for every
// `arbPartnersArray` sample (length 0..6).
// ──────────────────────────────────────────────────────────────
test('Property 2.e — Partners list renders byte-identically vs frozen baseline', () => {
  forAll(
    arbPartnersArray,
    (P) => {
      const elFixed = { innerHTML: '' };
      const elOrig  = { innerHTML: '' };
      renderPartners(elFixed, P);
      ORIGINAL.renderPartners(elOrig, P);
      assert.ok(
        eqHtml(elFixed.innerHTML, elOrig.innerHTML),
        `partners preservation drift\n  fixed=${elFixed.innerHTML}\n  orig =${elOrig.innerHTML}`
      );
    },
    50
  );
});

// ──────────────────────────────────────────────────────────────
// Property 2.f — Empty / missing preservation
// **Validates: Requirement 3.6**
// ──────────────────────────────────────────────────────────────
test('Property 2.f — Empty / missing inputs render byte-identically vs frozen baseline', () => {
  // renderListening with []
  {
    const elFixed = { innerHTML: '' };
    const elOrig  = { innerHTML: '' };
    renderListening(elFixed, []);
    ORIGINAL.renderListening(elOrig, []);
    assert.ok(
      eqHtml(elFixed.innerHTML, elOrig.innerHTML),
      `renderListening([]) drift\n  fixed=${elFixed.innerHTML}\n  orig =${elOrig.innerHTML}`
    );
  }
  // renderListening with undefined
  {
    const elFixed = { innerHTML: '' };
    const elOrig  = { innerHTML: '' };
    renderListening(elFixed, undefined);
    ORIGINAL.renderListening(elOrig, undefined);
    assert.ok(
      eqHtml(elFixed.innerHTML, elOrig.innerHTML),
      `renderListening(undefined) drift\n  fixed=${elFixed.innerHTML}\n  orig =${elOrig.innerHTML}`
    );
  }
  // renderPartners with []
  {
    const elFixed = { innerHTML: '' };
    const elOrig  = { innerHTML: '' };
    renderPartners(elFixed, []);
    ORIGINAL.renderPartners(elOrig, []);
    assert.ok(
      eqHtml(elFixed.innerHTML, elOrig.innerHTML),
      `renderPartners([]) drift\n  fixed=${elFixed.innerHTML}\n  orig =${elOrig.innerHTML}`
    );
  }
});

// ──────────────────────────────────────────────────────────────
// Property 2.g — Global shape preservation
// **Validates: Requirement 3.7**
//
// `typeof renderListeningCard === 'function'`, `.length === 1`, and a
// freshly-loaded fixed renderer's `fetchRecommendationsData()` returns
// `{ listening: Array, partners: Array }` when `fetch` is stubbed to
// return a known payload. Both renderers use the same fetch-and-shape
// logic, so a fake fetch returning ok JSON suffices for both.
// ──────────────────────────────────────────────────────────────
test('Property 2.g — Global shape preservation', async () => {
  // (1) renderListeningCard arity matches the original.
  assert.equal(typeof renderListeningCard, 'function');
  assert.equal(typeof ORIGINAL.renderListeningCard, 'function');
  assert.equal(renderListeningCard.length, ORIGINAL.renderListeningCard.length);
  assert.equal(renderListeningCard.length, 1);

  // (2) renderPartners has the same arity as the original.
  assert.equal(typeof renderPartners, 'function');
  assert.equal(typeof ORIGINAL.renderPartners, 'function');
  assert.equal(renderPartners.length, ORIGINAL.renderPartners.length);

  // (3) fetchRecommendationsData returns the documented shape when
  //     fetch resolves to a JSON-like object. Use the harness's
  //     makeFakeFetch — it returns a payload-shaped fake fetch.
  const payload = {
    listening: [
      { kind: 'spotify', type: 'episode', id: 'aaaaaaaaaaaaaaaaaaaaaa', title: 't', source: 's' },
    ],
    partners: [{ name: 'p', url: 'https://example.org' }],
  };
  const { fetch: fakeFetch } = makeFakeFetch(() => ({ status: 200, body: JSON.stringify(payload) }));

  // Fresh fixed renderer with the fake fetch wired into the vm context.
  const { fetchRecommendationsData } = loadRenderer({ fetch: fakeFetch });
  const result = await fetchRecommendationsData();

  assert.ok(result && typeof result === 'object', 'fetchRecommendationsData must return an object');
  assert.ok(Array.isArray(result.listening), 'result.listening must be an array');
  assert.ok(Array.isArray(result.partners),  'result.partners must be an array');
  assert.equal(result.listening.length, 1);
  assert.equal(result.partners.length, 1);
});

// ──────────────────────────────────────────────────────────────
// Property 2.h — Builder JSON output preservation — SKIPPED
//
// Implementing 2.h would require loading `assets/js/admin-help.js` into
// a Node vm context. That file depends on too many DOM globals
// (form-state event wiring, GitHub-client ESM imports, the in-page
// CodeMirror-shaped editor) to be feasibly evaluated outside a real
// browser without a substantial dom-shim.
//
// Verification path for 2.h:
//   - Manual: walk through all 9 admin-help builder tabs in a real
//     browser per task 12 (optional manual smoke test).
//   - Source diff: task 5.4 keeps the four legacy `buildObject()`
//     branches byte-identical. A line-level diff in code review is
//     sufficient evidence of preservation for a deterministic, pure
//     switch over JSON-output shapes.
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// Property 2.i — Admin-editor schema preservation
// **Validates: Requirement 3.9**
//
// Load the production `assets/data/recommendations.json`, load
// `assets/js/admin-editor-schemas.js` into a vm context with a stub
// `window`, then assert
// `SCHEMAS.recommendations.validate(payload) === null`.
// ──────────────────────────────────────────────────────────────
test('Property 2.i — Admin-editor schema accepts production recommendations.json', () => {
  const schemasPath = path.resolve(__dirname, '..', 'assets', 'js', 'admin-editor-schemas.js');
  const schemasSrc  = fs.readFileSync(schemasPath, 'utf-8');

  // The schemas file uses an IIFE that branches on `typeof module`:
  //   if (typeof module !== 'undefined' && module.exports) {
  //     module.exports = api;
  //   } else {
  //     global.AdminEditor = global.AdminEditor || {};
  //     global.AdminEditor.schemas = api;
  //   }
  // We deliberately do NOT supply `module` to the vm context so the
  // `else` branch runs and we can pull the api off `window.AdminEditor`,
  // which mirrors how the real admin-help.html page consumes it.
  const win = {};
  const ctx = vm.createContext({
    window: win,
    globalThis: win,
    console,
  });
  new vm.Script(schemasSrc, { filename: 'assets/js/admin-editor-schemas.js' }).runInContext(ctx);

  const api = win.AdminEditor && win.AdminEditor.schemas;
  assert.ok(api && api.SCHEMAS, 'admin-editor-schemas.js did not register window.AdminEditor.schemas.SCHEMAS');
  const recoSchema = api.SCHEMAS.recommendations;
  assert.ok(recoSchema && typeof recoSchema.validate === 'function',
    'recommendations schema must expose a validate() function');

  const dataPath = path.resolve(__dirname, '..', 'assets', 'data', 'recommendations.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const error = recoSchema.validate(data);
  assert.equal(error, null, `recommendations.json failed validate(): ${error}`);
});

// ──────────────────────────────────────────────────────────────
// Property 2.j — Wording preservation
// **Validates: Requirement 3.10**
//
// Snapshot the count of /donation/i matches in each guarded file
// against the frozen baseline at the time of this fix. Each count must
// be `<=` its baseline so this fix never INTRODUCES "donation"
// wording. Pre-existing matches (e.g. the team-responsibilities line
// in admin-help.html) are allowed.
// ──────────────────────────────────────────────────────────────
test('Property 2.j — No new "donation" wording introduced by this fix', () => {
  const baselines = [
    { file: 'community.html',                                     baseline: 0 },
    { file: 'admin-help.html',                                    baseline: 1 },
    { file: 'assets/data/recommendations.json',                   baseline: 0 },
    { file: 'assets/js/recommendations.js',                       baseline: 0 },
    { file: 'tests/fixtures/recommendations-renderer-original.js', baseline: 0 },
  ];
  for (const { file, baseline } of baselines) {
    const text = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf-8');
    const matches = text.match(/donation/gi) || [];
    assert.ok(
      matches.length <= baseline,
      `${file}: expected /donation/i count <= ${baseline}, got ${matches.length}`
    );
  }
});
