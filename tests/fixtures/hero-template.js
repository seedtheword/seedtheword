// tests/fixtures/hero-template.js
// Parametric HomeHero markup generators built from `fast-check` arbitraries.
// Used by tests/jesus-storytelling.test.js (tasks 4.x) to drive the
// HomeHero markup property tests.

import fc from 'fast-check';

// === Path prefix and extension arbitraries ===
//
// The fixture is intentionally narrow — it only emits **spec-compliant**
// HomeHero markup. The parametric property tests assert the invariants
// hold over many compliant shapes; the real-index branch of each property
// test catches divergence from those invariants in the actually-shipped
// HTML. Generating broad/non-compliant markup here would just test the
// predicate function instead of the invariant.
//
// Sources MUST live under `assets/videos/`. Posters MUST live under
// `assets/images/`. Source extensions MUST be `mp4` or `webm`. Decorative
// (aria-hidden) videos MUST NOT carry caption/subtitle tracks.
const VIDEO_PATH_PREFIX = 'assets/videos/';
const POSTER_PATH_PREFIX = 'assets/images/';
const SOURCE_EXTS = ['mp4', 'webm'];

const arbExt = fc.constantFrom(...SOURCE_EXTS);
const arbSlug = fc.stringMatching(/^[a-z0-9-]{1,12}$/);

export const arbSourceSrc = fc.tuple(arbSlug, arbExt)
  .map(([s, e]) => `${VIDEO_PATH_PREFIX}${s}.${e}`);

export const arbPosterSrc = fc.tuple(arbSlug, fc.constantFrom('jpg', 'png', 'webp'))
  .map(([s, ext]) => `${POSTER_PATH_PREFIX}backgrounds/${s}.${ext}`);

// === Track child arbitrary ===
//
// The aria-hidden=true case (which is what we ship) MUST NOT include
// captions/subtitles tracks. The fixture therefore only emits track
// kinds that are safe to include on a decorative video, OR no track
// at all. `descriptions` and `metadata` are both permitted by HTML and
// don't violate the decorative-video invariant.
const SAFE_TRACK_KINDS = ['descriptions', 'metadata'];
export const arbTrackChild = fc.option(
  fc.tuple(fc.constantFrom(...SAFE_TRACK_KINDS), fc.stringMatching(/^[a-z]{3,8}$/))
    .map(([kind, lang]) => `<track kind="${kind}" src="captions/${lang}.vtt" srclang="${lang}">`),
  { nil: '', freq: 2 }
);

// === Video attribute arbitrary ===
//
// Returns a record where `autoplay` always implies `muted` (Requirement
// 10.1 / Property 1). `muted` may also be present without `autoplay`.
// The other booleans are independent because they have no
// interdependency invariant to preserve.
export const arbVideoAttributes = fc.record({
  autoplay:    fc.boolean(),
  loop:        fc.boolean(),
  playsinline: fc.boolean(),
  ariaHidden:  fc.option(fc.constantFrom('true', 'false'), { nil: undefined, freq: 3 }),
  poster:      fc.option(arbPosterSrc, { nil: undefined, freq: 3 }),
  // Independent muted toggle (separate from autoplay). The .map() below
  // enforces the autoplay → muted implication.
  _mutedRoll:  fc.boolean(),
}).map(rec => ({
  ...rec,
  // Enforce: autoplay ⇒ muted. If autoplay is set, muted is forced true;
  // otherwise muted may be true or false based on the independent roll.
  muted: rec.autoplay ? true : rec._mutedRoll,
}));

// === Full HomeHero markup arbitrary ===
function attrs(map) {
  return Object.entries(map)
    .map(([k, v]) => v === true ? k : (v == null ? null : `${k}="${v}"`))
    .filter(Boolean)
    .join(' ');
}

export const arbHeroVideoMarkup = fc.tuple(
  arbVideoAttributes,
  fc.array(arbSourceSrc, { minLength: 1, maxLength: 3 }),
  arbTrackChild
).map(([vAttrs, sources, track]) => {
  const videoAttrs = attrs({
    class: 'hero__video',
    autoplay: vAttrs.autoplay || undefined,
    muted: vAttrs.muted || undefined,
    loop: vAttrs.loop || undefined,
    playsinline: vAttrs.playsinline || undefined,
    poster: vAttrs.poster,
    'aria-hidden': vAttrs.ariaHidden,
  });
  // Only render a <track> child when the video is NOT marked aria-hidden,
  // since decorative (aria-hidden) videos must not carry tracks per
  // Property 5. The fixture already restricts kinds to descriptions/
  // metadata, but the cleanest invariant-preserving rule is to drop
  // tracks entirely when aria-hidden is true.
  const trackForOutput = vAttrs.ariaHidden === 'true' ? '' : track;
  const sourceTags = sources
    .map(src => `<source src="${src}" type="video/${src.split('.').pop()}">`)
    .join('');
  return `<section class="hero hero--jesus">
  <video ${videoAttrs}>
    ${sourceTags}
    ${trackForOutput}
  </video>
  <div class="hero__overlay-gradient" aria-hidden="true"></div>
  <div class="hero__content hero__content--simple">
    <a href="about.html" class="btn btn-jesus">Who is Jesus?</a>
  </div>
</section>`;
});
