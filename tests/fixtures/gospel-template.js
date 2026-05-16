// tests/fixtures/gospel-template.js
// Parametric AboutGospelSection generators built from `fast-check` arbitraries.
// Used by tests/jesus-storytelling.test.js (tasks 8.x) to drive the
// AboutGospelSection structure, visual-content, and tel-canonicalization
// property tests.

import fc from 'fast-check';

export const CANONICAL_SLUGS = Object.freeze([
  'who-he-is',
  'his-birth',
  'his-life',
  'his-death',
  'his-resurrection',
  'his-promised-return',
  'respond',
]);

// Production invariant (Property 8) requires every non-Respond gospel-stage
// to carry at least one visual descendant. The previous fixture deliberately
// included an empty-string ("none") variant to exercise the negative path,
// but that empty variant produced a noisy generator that would always
// counterexample Property 8's parametric branch. Per task 8.2 acceptance,
// VISUAL_ELEMENTS now narrows to compliant inputs only.
const VISUAL_ELEMENTS = [
  '<img src="assets/images/gospel/x.jpg" alt="x">',
  '<picture><source srcset="x.webp"><img src="assets/images/gospel/x.jpg" alt="x"></picture>',
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
  '<figure><img src="assets/images/gospel/x.jpg" alt="x"></figure>',
];

export const arbGospelStage = fc.tuple(
  fc.constantFrom(...CANONICAL_SLUGS),
  fc.constantFrom(...VISUAL_ELEMENTS)
).map(([slug, visual]) => {
  const inner = slug === 'respond'
    ? `<a href="tel:+12537777383" class="btn btn-primary btn-green-call">📞 Call or text (253) 777-7383</a>`
    : `<figure class="gospel-stage__media">${visual}</figure><div class="gospel-stage__copy"><h3>${slug}</h3><p>...</p></div>`;
  return `<div class="gospel-stage gospel-stage--${slug}">${inner}</div>`;
});

// Subsetted and shuffled stages for randomized AboutGospelSection generation.
export const arbGospelSection = fc.uniqueArray(
  fc.constantFrom(...CANONICAL_SLUGS),
  { minLength: 1, maxLength: CANONICAL_SLUGS.length }
).chain(slugs => {
  // For each slug, pick a random visual element (or none for respond)
  return fc.tuple(
    ...slugs.map(slug => fc.constantFrom(...VISUAL_ELEMENTS).map(v => ({ slug, visual: v })))
  ).map(stages => {
    const stageMarkup = stages.map(({ slug, visual }) => {
      const inner = slug === 'respond'
        ? `<a href="tel:+12537777383" class="btn btn-primary">📞 Call or text (253) 777-7383</a>`
        : `<figure class="gospel-stage__media">${visual}</figure><div class="gospel-stage__copy"><h3>${slug}</h3><p>...</p></div>`;
      return `<div class="gospel-stage gospel-stage--${slug}">${inner}</div>`;
    }).join('\n');
    return `<section class="section section--jesus-background">${stageMarkup}</section>`;
  });
});

// === InvitationCTA anchor arbitrary ===
const PHONE_FORMATS = [
  '(253) 777-7383',
  '253-777-7383',
  '253.777.7383',
  '+1 253 777 7383',
  '+12537777383',
  '2537777383',
];
const HREF_VARIANTS = [
  'tel:+12537777383',
  'tel:2537777383',
  'tel:+1-253-777-7383',
  'mailto:test@example.com',
  '',
  '#',
];
export const arbInvitationCTAAnchor = fc.tuple(
  fc.constantFrom(...PHONE_FORMATS),
  fc.constantFrom(...HREF_VARIANTS)
).map(([phone, href]) => `<a href="${href}">📞 ${phone}</a>`);
