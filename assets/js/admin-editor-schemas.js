/* ============================================================
   admin-editor-schemas.js

   Schema registry. Each entry describes ONE editable content-type.

   Shape (subset documented in design.md Section 5):
     {
       id, label, category, kind,
       path                (for single-file content types),
       rootType,           ('object' | 'array')
       groups,             (array of { name, label, kind, fields[] })
       renderer,           (name of a window.* function to render the preview)
       validate,           ((data) => string | null) top-level validator
       commitMessageTemplate,
       legacyCopyPaste,    (bool — Phase A shadow-period flag)
       wip,                (bool — true = skip this schema in the content picker)
     }

   In Phase A only `recommendations` is non-WIP. Phases B and C
   enable the rest. Adding a new content type in the future is a
   single entry here plus a cache-buster bump on the script tag —
   no HTML changes required.
   ============================================================ */

(function (global) {
  'use strict';

  // ── Field / value helpers ──────────────────────────────────────────────
  function isValidSpotifyUrl(v) {
    return /^https:\/\/open\.spotify\.com\/(episode|show)\//.test(String(v || ''));
  }
  function isValidYouTubeUrl(v) {
    return /[?&]v=|youtu\.be\/|\/embed\//.test(String(v || ''));
  }
  function isValidHttpsUrl(v) {
    return /^https?:\/\/\S+/i.test(String(v || ''));
  }

  // ── Listening variants (per-kind field sets) ────────────────────────────
  const LISTENING_VARIANTS = {
    spotify: [
      { name: 'kind',   label: 'Kind',          kind: 'hidden', value: 'spotify' },
      { name: 'url',    label: 'Spotify URL',   kind: 'url',    required: true,
        hint: 'Paste the full episode or show URL. ID and type are auto-extracted.',
        validate: (v) => isValidSpotifyUrl(v) ? null : 'Must be an open.spotify.com episode or show URL.' },
      { name: 'title',  label: 'Title',         kind: 'text',   required: true,
        placeholder: 'Intimacy With God Is Everything' },
      { name: 'source', label: 'Source / show', kind: 'text',   required: false,
        placeholder: 'After the Heart Podcast — Episode 38' },
      { name: 'note',   label: 'Why we recommend this',
        kind: 'textarea', required: false, placeholder: 'One sentence on why this stood out.' },
    ],
    youtube: [
      { name: 'kind',   label: 'Kind', kind: 'hidden', value: 'youtube' },
      { name: 'url',    label: 'YouTube URL',   kind: 'url',    required: true,
        hint: 'watch?v=, youtu.be/, and /embed/ URLs all work.',
        validate: (v) => isValidYouTubeUrl(v) ? null : 'Must be a YouTube URL we can extract an ID from.' },
      { name: 'title',  label: 'Title',         kind: 'text',   required: true },
      { name: 'source', label: 'Source / channel', kind: 'text', required: false },
      { name: 'note',   label: 'Why we recommend this', kind: 'textarea', required: false },
    ],
    link: [
      { name: 'kind',   label: 'Kind', kind: 'hidden', value: 'link' },
      { name: 'url',    label: 'Full URL',      kind: 'url',    required: true,
        validate: (v) => isValidHttpsUrl(v) ? null : 'Must be an http(s) URL.' },
      { name: 'title',  label: 'Title',         kind: 'text',   required: true },
      { name: 'source', label: 'Source / author', kind: 'text', required: false },
      { name: 'note',   label: 'Why it matters', kind: 'textarea', required: false },
      { name: 'image',  label: 'Thumbnail path', kind: 'text', required: false,
        placeholder: 'assets/images/featured/some-image.jpg' },
    ],
  };

  const SCHEMAS = {
    recommendations: {
      id: 'recommendations',
      label: 'Recommendations (listening + partners)',
      category: 'content',
      kind: 'json',
      path: 'assets/data/recommendations.json',
      rootType: 'object',
      groups: [
        {
          name: 'listening',
          label: 'Listening',
          kind: 'repeating-group',
          variants: ['spotify', 'youtube', 'link'],
          variantFields: LISTENING_VARIANTS,
          variantKey: 'kind',
          renderer: 'renderListeningCard',
          addLabel: '+ Add listening item',
        },
        {
          name: 'partners',
          label: 'Partners',
          kind: 'repeating-group',
          fields: [
            { name: 'name', label: 'Partner name', kind: 'text', required: true },
            { name: 'url', label: 'Partner URL', kind: 'url', required: true,
              validate: (v) => isValidHttpsUrl(v) ? null : 'Must be an http(s) URL.' },
            { name: 'logo', label: 'Logo path (optional)', kind: 'text' },
            { name: 'description', label: 'Description (optional)', kind: 'textarea' },
          ],
          renderer: 'renderPartners', // called as renderPartners(el, list)
          rendererMode: 'bulk', // preview panel passes the whole list at once
          addLabel: '+ Add partner',
        },
      ],
      // Top-level validator — structural only. Per-field validators live in the
      // field definitions above.
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.listening)) return 'listening must be an array.';
        if (!Array.isArray(data.partners)) return 'partners must be an array.';
        return null;
      },
      commitMessageTemplate: 'content(recos): update {summary}',
      tokens: function (form) {
        // Summarize the latest edit: pick the last listening title, else first partner name.
        try {
          const lst = (form && form.listening) || [];
          if (lst.length) {
            const last = lst[lst.length - 1];
            if (last && last.title) return { summary: 'add ' + last.title };
          }
          const parts = (form && form.partners) || [];
          if (parts.length) {
            const last = parts[parts.length - 1];
            if (last && last.name) return { summary: 'add partner ' + last.name };
          }
        } catch (_) {}
        return { summary: 'recommendations update' };
      },
      legacyCopyPaste: true,
    },
  };

  // Placeholders for content types scheduled for Phases B and C. They appear
  // in the listing with a "(coming soon)" label so admins know what's planned
  // without us wiring them up prematurely. Each gets `wip: true` so the
  // content picker filters them out until their full schema ships.
  const WIP_LABELS = {
    dailyVerses:            'Daily verses (coming soon)',
    ministryOutreachCards:  'Ministry outreach cards (coming soon)',
    mediaDrop:              'Media-drop config (coming soon)',
    telegramBot:            'Telegram bot config (coming soon)',
    bibleSpotifyMap:        'Bible → Spotify chapter map (coming soon)',
    bundleEssentials:       'Bundle: Essentials (coming soon)',
    bundleLifegroup:        'Bundle: Life Group (coming soon)',
    bundleMinistry:         'Bundle: Ministry (coming soon)',
    showcaseFallback:       'Homepage carousel — fallback slides (coming soon)',
    showcaseDaily:          'Homepage carousel — daily content (coming soon)',
    backgrounds:            'Background images (coming soon)',
    featured:               'Featured showcase images (coming soon)',
    team:                   'Team headshots (coming soon)',
    seedStitch:             'Seed Stitch photos (coming soon)',
    ministryHighlights:     'Ministry highlights (coming soon)',
    calendarTemplate:       'Calendar template graphics (coming soon)',
    ministryOutreachPhotos: 'Outreach event photos (coming soon)',
    videos:                 'Videos (coming soon)',
    stwLogo:                'Ministry logo (coming soon)',
    // Workflows (Phase B)
    wfTelegramAnnouncements: 'Workflow: Telegram announcements (coming soon)',
    wfDailyBible:            'Workflow: Daily Bible (coming soon)',
    wfDailyPrayerNudge:      'Workflow: Daily prayer nudge (coming soon)',
    wfInstagramScrape:       'Workflow: Instagram scraper (coming soon)',
  };
  for (const id of Object.keys(WIP_LABELS)) {
    SCHEMAS[id] = { id: id, label: WIP_LABELS[id], wip: true };
  }

  // Listing helper used by the content picker — returns non-WIP schemas
  // grouped by category.
  function listActive() {
    return Object.values(SCHEMAS).filter((s) => !s.wip);
  }

  const api = {
    SCHEMAS: SCHEMAS,
    listActive: listActive,
    // URL-extraction helpers used by the form renderer for Spotify / YouTube.
    extractSpotify: function (url) {
      const m = String(url || '').match(/\/(episode|show)\/([A-Za-z0-9]+)/);
      if (!m) return null;
      return { type: m[1], id: m[2] };
    },
    extractYouTube: function (url) {
      const s = String(url || '');
      let m = s.match(/[?&]v=([A-Za-z0-9_\-]{6,})/); if (m) return m[1];
      m = s.match(/youtu\.be\/([A-Za-z0-9_\-]{6,})/); if (m) return m[1];
      m = s.match(/\/embed\/([A-Za-z0-9_\-]{6,})/); if (m) return m[1];
      return '';
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AdminEditor = global.AdminEditor || {};
    global.AdminEditor.schemas = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
