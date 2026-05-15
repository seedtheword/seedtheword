/* ============================================================
   bundle-item-catalog.js — single source of truth for every
   customization item across the store bundle journey.

   Loaded as a plain script tag (no module system) BEFORE
   bundle-journey.js (on store.html) and bundle-review.js
   (on bundle-builder.html). Exposes:
     window.STW_ITEM_CATALOG       — full item array
     window.STW_TIER_RANK          — sort weight per tier
     window.STW_GROUPING_SECTIONS  — section render order
     window.STW_findItem(key)
     window.STW_filterByScope(bundleKey)
     window.STW_groupBySection(items)
     window.STW_isSpecialOrder(chosenKeys)

   Spec: .kiro/specs/bundle-customization-tiers/
   ============================================================ */
(function () {
  'use strict';

  // Tier ordering — items render recommended → standard → special
  // within each grouping section.
  var TIER_RANK = { recommended: 0, standard: 1, special: 2 };
  var GROUPING_SECTIONS = ['bible', 'inside', 'kit', 'guides', 'packaging', 'outreach'];

  // The complete catalog. 41 entries.
  // - tier:      'recommended' | 'standard' | 'special'
  // - madeToOrder: separate boolean flag, ~2-3 weeks if true
  // - bundleScope: which bundles render the item
  // - groupingSection: which section heading it falls under
  var CATALOG = [
    // ───────── ON THE BIBLE ITSELF (groupingSection: 'bible') ─────────
    { key: 'engraving', label: 'Engraving on cover (name / initials / dedication / verse ref)',
      tier: 'recommended', madeToOrder: false,
      description: 'A short engraved line on the front or spine. Most popular request.',
      bundleScope: ['essentials','lifegroup','ministry'], groupingSection: 'bible' },

    { key: 'cover-painting', label: 'Custom painting on cover (watercolor / acrylic / ink)',
      tier: 'recommended', madeToOrder: true,
      description: 'Hand-painted cover art, made-to-order — takes 2-3 weeks.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    { key: 'edge-spray-painting', label: 'Page-edge spray painting (with optional verse)',
      tier: 'recommended', madeToOrder: true,
      description: 'Sibling of cover painting — color or scene sprayed onto the page edges.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    { key: 'cover-material', label: 'Custom cover material / color',
      tier: 'special', madeToOrder: true,
      description: 'Pick a non-standard cover (leather variant, fabric, hand-dyed). Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    { key: 'foil-stamping', label: 'Foil stamping (gold / silver / copper)',
      tier: 'special', madeToOrder: true,
      description: 'Pressed metallic foil lettering or design. Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    { key: 'edge-gilding', label: 'Edge gilding (gold / silver page edges)',
      tier: 'special', madeToOrder: true,
      description: 'A thin gold or silver coating on the outer edges of the pages. Premium look, takes longer.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    { key: 'ribbon-markers', label: 'Ribbon markers (single or multiple, custom colors)',
      tier: 'special', madeToOrder: true,
      description: 'Bound-in ribbons in chosen colors. Talk with our team for color matching.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    { key: 'hand-tooled', label: 'Hand-tooled / debossed / stamp designs',
      tier: 'special', madeToOrder: true,
      description: 'Pressed or stamped designs into the cover. Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'bible' },

    // ───────── INSIDE THE BIBLE (groupingSection: 'inside') ─────────
    { key: 'verse-highlighting', label: 'Verse highlighting (specific verses pre-marked)',
      tier: 'recommended', madeToOrder: false,
      description: 'We pre-highlight verses you choose so the recipient finds them right away.',
      bundleScope: ['essentials','lifegroup','ministry'], groupingSection: 'inside' },

    { key: 'pressed-flowers', label: 'Pressed flowers / dried plants between pages',
      tier: 'recommended', madeToOrder: true,
      description: 'A small nostalgic touch — a pressed flower or sprig tucked between pages.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'inside' },

    { key: 'dedication-page', label: 'Custom dedication page (signed by ministry members)',
      tier: 'recommended', madeToOrder: true,
      description: 'A calligraphed first-inside-page dedication signed by our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'inside' },

    { key: 'study-notes', label: 'Inline study notes',
      tier: 'standard', madeToOrder: false,
      description: 'A small set of margin notes alongside chosen passages — on par with the QR life-group card.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'inside' },

    // ───────── COMPANION KIT (standard, all-on by default in Essentials) ─────────
    { key: 'welcome-note', label: 'Welcome / dedication note',
      tier: 'standard', madeToOrder: false,
      description: 'A short handwritten note from our team welcoming the recipient.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'highlighter-set', label: 'Highlighter (or set)',
      tier: 'standard', madeToOrder: false,
      description: 'A Bible-safe highlighter or matched set so they can mark as they read.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'sticky-tabs', label: 'Sticky tabs / sticky notes',
      tier: 'standard', madeToOrder: false,
      description: 'Tabs and small sticky notes for marking books and pages.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'pen-set', label: 'Pen(s) (Pigma Micron / Tul) or pencil(s)',
      tier: 'standard', madeToOrder: false,
      description: 'A bleed-resistant pen or matched pencil for margin writing.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'bookmarks', label: 'Custom or ministry bookmarks',
      tier: 'standard', madeToOrder: false,
      description: 'Bookmarks with our ministry artwork — or a custom design on request.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'mini-journal', label: 'Mini journal / prayer journal / notes journal',
      tier: 'standard', madeToOrder: false,
      description: 'A small bound journal for prayer, notes, or sermon takeaways.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'sticker-sheets', label: 'Sticker sheets',
      tier: 'standard', madeToOrder: false,
      description: 'Sheets of small verse and ministry stickers.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    // ───────── NICHE / HANDCRAFT (groupingSection: 'kit') ─────────
    { key: 'crochet-figurine', label: 'Stuffed crochet figurine',
      tier: 'standard', madeToOrder: true,
      description: 'A small handmade crochet figure — ours by default, custom variants available.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'crochet-figurine-custom', label: 'Stuffed crochet figurine (custom design)',
      tier: 'special', madeToOrder: true,
      description: 'A crochet figure made to your description. Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'mini-jesus', label: 'Mini Jesus figurine',
      tier: 'standard', madeToOrder: true,
      description: 'A small carved or molded Jesus figure to keep with the Bible.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'flip-book', label: 'Flip books',
      tier: 'standard', madeToOrder: false,
      description: 'A small illustrated flip book with a verse or scene.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'cross-keychain', label: 'Wooden / jewelry cross keychain or necklace',
      tier: 'standard', madeToOrder: false,
      description: 'A small cross — wood, metal, or beaded — to clip or wear.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'beaded-bracelet', label: 'Beaded scripture bracelet (plain or beaded)',
      tier: 'standard', madeToOrder: false,
      description: 'A wearable scripture bracelet, plain cord or beaded.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'kids-coloring-book', label: 'Coloring book + pencils (kids)',
      tier: 'standard', madeToOrder: false,
      description: 'A kid-friendly coloring book with verses and a small pencil set.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    { key: 'devotional-book', label: 'Devotional books / 30-day prayer guides',
      tier: 'special', madeToOrder: false,
      description: 'A specific devotional or 30-day guide we order in. Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'kit' },

    // ───────── GUIDES & QR CARDS (groupingSection: 'guides') ─────────
    { key: 'guide-lifegroup-qr', label: 'QR card → Life Group starter guide',
      tier: 'standard', madeToOrder: false,
      description: 'Scannable card with a step-by-step starter for a new life group.',
      bundleScope: ['lifegroup'], groupingSection: 'guides' },

    { key: 'guide-newcomer-qr', label: 'QR card → "Where to start reading" newcomer plan',
      tier: 'standard', madeToOrder: false,
      description: 'Scannable card with a gentle reading plan for someone new to the Bible.',
      bundleScope: ['essentials'], groupingSection: 'guides' },

    { key: 'guide-audio-qr', label: 'Audio Bible USB / QR card → Spotify reading',
      tier: 'standard', madeToOrder: false,
      description: 'Card or USB linking to our audio reading on Spotify.',
      bundleScope: ['essentials','lifegroup','ministry'], groupingSection: 'guides' },

    // ───────── PACKAGING (groupingSection: 'packaging') ─────────
    { key: 'packaging-tissue', label: 'Tissue + ribbon wrap',
      tier: 'recommended', madeToOrder: false,
      description: 'Simple, warm wrap — tissue paper and a tied ribbon.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'packaging' },

    { key: 'packaging-burlap', label: 'Burlap / linen pouch (with optional customization)',
      tier: 'recommended', madeToOrder: false,
      description: 'A reusable cloth pouch — plain by default, optional custom embroidery.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'packaging' },

    { key: 'packaging-gift-box', label: 'Custom gift box (kraft, fabric-wrapped, painted)',
      tier: 'recommended', madeToOrder: true,
      description: 'A handcrafted gift box — we walk through the details with you.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'packaging' },

    { key: 'packaging-gift-box-custom', label: 'Custom painted / fabric-wrapped gift box',
      tier: 'special', madeToOrder: true,
      description: 'A fully bespoke painted or fabric-wrapped box. Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'packaging' },

    { key: 'packaging-wooden-crate', label: 'Wooden gift crate (premium tier)',
      tier: 'special', madeToOrder: true,
      description: 'A small wooden crate, lid optional. Premium, takes longer to produce.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'packaging' },

    { key: 'packaging-wax-seal', label: 'Handwritten address label + stamped wax seal',
      tier: 'special', madeToOrder: true,
      description: 'A handwritten label with a stamped wax seal on the package. Talk with our team.',
      bundleScope: ['essentials','lifegroup'], groupingSection: 'packaging' },

    // ───────── OUTREACH-SPECIFIC (Ministry Calling, groupingSection: 'outreach') ─────────
    { key: 'outreach-newcomer-qr', label: '"Where to start reading" QR card (per Bible)',
      tier: 'standard', madeToOrder: false,
      description: 'A newcomer-tuned QR card, one per Bible — what to read first.',
      bundleScope: ['ministry'], groupingSection: 'outreach' },

    { key: 'outreach-tract-bundles', label: 'Standard tract bundles in matching covers (bulk)',
      tier: 'standard', madeToOrder: false,
      description: 'Pre-printed tract bundles in covers matched to your event.',
      bundleScope: ['ministry'], groupingSection: 'outreach' },

    { key: 'outreach-tract-bundles-custom', label: 'Custom tract bundles in matching covers',
      tier: 'special', madeToOrder: true,
      description: 'Custom-printed tracts in your event design. Talk with our team.',
      bundleScope: ['ministry'], groupingSection: 'outreach' },

    { key: 'outreach-prayer-cards', label: 'Prayer cards bundled by topic',
      tier: 'standard', madeToOrder: false,
      description: 'Topical prayer cards (anxiety, gratitude, family, etc.) bundled together.',
      bundleScope: ['ministry'], groupingSection: 'outreach' },

    { key: 'outreach-gideons-tracts', label: 'Gideons International tracts (partner material)',
      tier: 'standard', madeToOrder: false,
      description: 'Partner tracts from Gideons International, included as-is.',
      bundleScope: ['ministry'], groupingSection: 'outreach' },

    { key: 'outreach-chick-tracts', label: 'Chick Publications tracts (partner material)',
      tier: 'standard', madeToOrder: false,
      description: 'Partner tracts from Chick Publications, included as-is.',
      bundleScope: ['ministry'], groupingSection: 'outreach' },

    { key: 'outreach-mass-engraving', label: 'Mass-engraved unifying line (event name + date)',
      tier: 'special', madeToOrder: true,
      description: 'One engraved line repeated across every Bible — event name and date. Talk with our team.',
      bundleScope: ['ministry'], groupingSection: 'outreach' }
  ];

  // ── Helpers ────────────────────────────────────────────────
  function findItem(key) {
    for (var i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].key === key) return CATALOG[i];
    }
    return null;
  }

  function filterByScope(bundleKey) {
    return CATALOG.filter(function (item) {
      return item.bundleScope.indexOf(bundleKey) !== -1;
    });
  }

  function groupBySection(items) {
    var out = {};
    GROUPING_SECTIONS.forEach(function (s) { out[s] = []; });
    items.forEach(function (item) {
      if (out[item.groupingSection]) out[item.groupingSection].push(item);
    });
    // Sort within each section by tier then catalog order.
    GROUPING_SECTIONS.forEach(function (s) {
      out[s].sort(function (a, b) {
        var ta = TIER_RANK[a.tier] !== undefined ? TIER_RANK[a.tier] : 99;
        var tb = TIER_RANK[b.tier] !== undefined ? TIER_RANK[b.tier] : 99;
        if (ta !== tb) return ta - tb;
        return CATALOG.indexOf(a) - CATALOG.indexOf(b);
      });
    });
    return out;
  }

  function isSpecialOrder(chosenKeys) {
    if (!Array.isArray(chosenKeys)) return { isSpecialOrder: false, specialOrderItems: [] };
    var labels = [];
    var seen = {};
    chosenKeys.forEach(function (k) {
      if (seen[k]) return;
      seen[k] = true;
      var item = findItem(k);
      if (item && item.tier === 'special') labels.push(item.label);
    });
    return { isSpecialOrder: labels.length > 0, specialOrderItems: labels };
  }

  // Expose
  window.STW_ITEM_CATALOG      = CATALOG;
  window.STW_TIER_RANK         = TIER_RANK;
  window.STW_GROUPING_SECTIONS = GROUPING_SECTIONS;
  window.STW_findItem          = findItem;
  window.STW_filterByScope     = filterByScope;
  window.STW_groupBySection    = groupBySection;
  window.STW_isSpecialOrder    = isSpecialOrder;
})();
