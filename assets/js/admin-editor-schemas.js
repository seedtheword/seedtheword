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

    dailyVerses: {
      id: 'dailyVerses',
      label: 'Daily verses rotation',
      category: 'content',
      kind: 'json',
      path: 'assets/data/daily-verses.json',
      rootType: 'object',
      groups: [
        {
          name: 'verses',
          label: 'Verses',
          kind: 'repeating-group',
          fields: [
            { name: 'text', label: 'Verse text', kind: 'textarea', required: true },
            { name: 'ref', label: 'Reference (e.g. "John 3:16")', kind: 'text', required: true },
            { name: 'version', label: 'Translation (KJV, ESV, NIV, ...)', kind: 'text', required: false },
          ],
          addLabel: '+ Add verse',
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.verses)) return 'verses must be an array.';
        return null;
      },
      commitMessageTemplate: 'content(verses): update {summary}',
      tokens: function (form) {
        const v = (form && form.verses) || [];
        if (v.length) {
          const last = v[v.length - 1];
          if (last && last.ref) return { summary: 'add ' + last.ref };
        }
        return { summary: 'verses update' };
      },
    },

    ministryOutreachCards: {
      id: 'ministryOutreachCards',
      label: 'Ministry outreach events (cards on news.html)',
      category: 'content',
      kind: 'json',
      path: 'assets/data/ministry-outreach.json',
      rootType: 'object',
      groups: [
        {
          name: 'events',
          label: 'Events (newest first)',
          kind: 'repeating-group',
          fields: [
            { name: 'folder', label: 'Folder slug', kind: 'text', required: true,
              hint: 'Matches a folder under assets/images/ministry-outreach/. Use kebab-case, e.g. "slavic-awakening-may-2026".',
              validate: (v) => /^[a-z0-9][a-z0-9\-]*$/.test(v) ? null : 'Use lowercase letters, numbers, and dashes only.' },
            { name: 'title', label: 'Title', kind: 'text', required: true },
            { name: 'date', label: 'Date (human-readable, e.g. "May 2, 2026")', kind: 'text', required: true },
            { name: 'location', label: 'Location', kind: 'text', required: true },
            { name: 'body', label: 'Body / description', kind: 'textarea', required: true },
            { name: 'testimony', label: 'Testimony (optional)', kind: 'textarea' },
          ],
          addLabel: '+ Add event',
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.events)) return 'events must be an array.';
        return null;
      },
      commitMessageTemplate: 'content(outreach): update {summary}',
      tokens: function (form) {
        const e = (form && form.events) || [];
        if (e.length) {
          const last = e[e.length - 1];
          if (last && last.title) return { summary: 'add ' + last.title };
        }
        return { summary: 'outreach update' };
      },
    },

    mediaDrop: {
      id: 'mediaDrop',
      label: 'Media-drop upload button config',
      category: 'content',
      kind: 'json',
      path: 'assets/data/media-drop.json',
      rootType: 'object',
      groups: [
        {
          name: 'root',
          label: 'Configuration',
          fields: [
            { name: 'enabled', label: 'Show button on news.html', kind: 'toggle' },
            { name: 'formUrl', label: 'Google Form URL (recommended)', kind: 'url',
              hint: 'Paste the Google Form "Send" URL here. Leave blank to use uploadUrl instead.' },
            { name: 'uploadUrl', label: 'Fallback: shared folder upload URL', kind: 'url',
              hint: 'Used only if formUrl is blank.' },
            { name: 'adminReviewUrl', label: 'Admin review folder URL', kind: 'url',
              hint: 'Where submissions land for review (not shown on the public site).' },
          ],
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        return null;
      },
      commitMessageTemplate: 'content(media-drop): update config',
    },

    telegramBot: {
      id: 'telegramBot',
      label: 'Telegram bot config (announcements / bible / prayer)',
      category: 'content',
      kind: 'json',
      path: 'assets/data/telegram-bot.json',
      rootType: 'object',
      // This file has a nested shape with 3 bot configs. Render as JSON-only for v1
      // (no structured form); admins can still edit the formatted JSON and get
      // validation + diff. A fully-structured schema is a Phase B+ refinement.
      rawJson: true,
      commitMessageTemplate: 'content(telegram-bot): update config',
    },

    bibleSpotifyMap: {
      id: 'bibleSpotifyMap',
      label: 'Bible → Spotify chapter map',
      category: 'content',
      kind: 'json',
      path: 'assets/data/bible-spotify-map.json',
      rootType: 'object',
      // Like telegramBot, this has a flat object of arbitrary chapter keys;
      // admins will mostly want to add/edit key-value pairs, which JSON-only
      // mode handles fine while structured schema work is deferred.
      rawJson: true,
      commitMessageTemplate: 'content(bible-spotify): update map',
    },

    studySaturday: {
      id: 'studySaturday',
      label: 'Study Saturday — weekly study topic',
      category: 'content',
      kind: 'json',
      path: 'assets/data/study-saturday.json',
      rootType: 'object',
      groups: [
        {
          name: 'weeks',
          label: 'Weeks (most recent first)',
          kind: 'repeating-group',
          fields: [
            { name: 'weekOf', label: 'Week of (YYYY-MM-DD — use Monday)', kind: 'date', required: true,
              validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Must be YYYY-MM-DD.' },
            { name: 'oldTestament', label: 'Old Testament passage', kind: 'text',
              hint: 'e.g. "Genesis 15 — Abram\'s covenant"' },
            { name: 'gospel',       label: 'Gospel / New Testament passage', kind: 'text',
              hint: 'e.g. "Mark 11 — Jesus enters Jerusalem"' },
            { name: 'scripture',    label: 'Anchor scripture (optional)', kind: 'text',
              hint: 'Specific verses, e.g. "Mark 11:22-24".' },
            { name: 'note',         label: 'Note / connection (optional)', kind: 'textarea' },
          ],
          addLabel: '+ Add week',
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.weeks)) return 'weeks must be an array.';
        return null;
      },
      commitMessageTemplate: 'content(study-saturday): update {summary}',
      tokens: function (form) {
        const w = (form && form.weeks) || [];
        if (w.length) {
          const last = w[w.length - 1];
          if (last && last.weekOf) return { summary: 'week of ' + last.weekOf };
        }
        return { summary: 'study saturday update' };
      },
    },

    bundleEssentials: bundleSchema('bundleEssentials', 'Bundle: Essentials slideshow', 'essentials'),
    bundleLifegroup: bundleSchema('bundleLifegroup', 'Bundle: Life Group slideshow', 'lifegroup'),
    bundleMinistry:  bundleSchema('bundleMinistry',  'Bundle: Ministry slideshow',  'ministry'),

    wfTelegramAnnouncements: workflowSchema(
      'wfTelegramAnnouncements',
      '▶ Workflow: Telegram announcements',
      'telegram-announcements.yml'
    ),
    wfDailyBible: workflowSchema(
      'wfDailyBible',
      '▶ Workflow: Daily Bible',
      'daily-bible.yml'
    ),
    wfDailyPrayerNudge: workflowSchema(
      'wfDailyPrayerNudge',
      '▶ Workflow: Daily prayer nudge',
      'daily-prayer-nudge.yml'
    ),
    wfInstagramScrape: workflowSchema(
      'wfInstagramScrape',
      '▶ Workflow: Instagram scraper',
      'instagram-scrape.yml'
    ),

    // Image-only directories (no manifest, pure upload folder). Uploading
    // here writes a file to the declared folder via Contents_API for ≤1MB
    // images or Git_Data_API otherwise. Filename comes from the upload.
    backgrounds: imageFolderSchema('backgrounds',     'Background images',         'assets/images/backgrounds/'),
    featured:    imageFolderSchema('featured',        'Featured showcase images',  'assets/images/featured/'),
    team:        imageFolderSchema('team',            'Team headshots',            'assets/images/team/'),
    seedStitch:  imageFolderSchema('seedStitch',      'Seed Stitch photos',        'assets/images/seed-stitch/'),
    ministryHighlights: imageFolderSchema('ministryHighlights', 'Ministry highlights', 'assets/images/ministry-highlights/'),
    calendarTemplate:   imageFolderSchema('calendarTemplate',   'Calendar template graphics', 'assets/images/calendar-template/'),
    ministryOutreachPhotos: imageFolderSchema('ministryOutreachPhotos', 'Outreach event photos', 'assets/images/ministry-outreach/', { allowSubfolderCreate: true, subfolderHint: 'e.g. slavic-awakening-may-2026' }),

    videos: {
      id: 'videos',
      label: 'Videos',
      category: 'media',
      kind: 'video-upload',
      folder: 'assets/videos/',
      mimeWhitelist: ['video/mp4', 'video/webm', 'video/quicktime'],
      maxBytes: 100 * 1024 * 1024, // 100 MB per blob (Req 6.9)
      commitMessageTemplate: 'content(videos): add {filename}',
    },

    stwLogo: {
      id: 'stwLogo',
      label: 'Ministry logo (replace only)',
      category: 'media',
      kind: 'image-upload',
      path: 'assets/images/stw-logo.jpg', // single-file schema, no folder listing
      allowDelete: false, // Req 3.4
      mimeWhitelist: ['image/jpeg', 'image/png', 'image/webp'],
      commitMessageTemplate: 'content(logo): replace ministry logo',
    },

    // Homepage carousel — JS-literal-editable slide lists inside
    // assets/js/showcase-carousel.js. Opens as a repeating-group form whose
    // save path writes back through the JS-literal writer instead of JSON,
    // preserving every byte of the surrounding JavaScript file.
    showcaseFallback: {
      id: 'showcaseFallback',
      label: 'Homepage carousel — fallback slides',
      category: 'slides',
      kind: 'js-literal-array',
      file: 'assets/js/showcase-carousel.js',
      literalName: 'FALLBACK_SLIDES',
      elementKind: 'object',
      elementFields: [
        { name: 'kind',    label: 'Slide kind',  kind: 'select', required: true,
          options: [
            { value: 'ministry',  label: 'Ministry highlight' },
            { value: 'scripture', label: 'Scripture' },
          ],
        },
        { name: 'eyebrow', label: 'Eyebrow text', kind: 'text' },
        { name: 'title',   label: 'Title',        kind: 'text', required: true },
        { name: 'body',    label: 'Body',         kind: 'textarea' },
        { name: 'image',   label: 'Image path',   kind: 'text',
          hint: 'Relative path like assets/images/featured/foo.jpg' },
        { name: 'ctaLabel',label: 'CTA button label', kind: 'text' },
        { name: 'ctaHref', label: 'CTA URL or page', kind: 'text' },
      ],
      commitMessageTemplate: 'content(carousel-fallback): update slides',
      tokens: function (form) {
        const items = (form && form.__literal) || [];
        if (items.length) {
          const last = items[items.length - 1];
          if (last && last.title) return { summary: 'add "' + last.title + '"' };
        }
        return { summary: 'update' };
      },
    },

    showcaseDaily: {
      id: 'showcaseDaily',
      label: 'Homepage carousel — daily Bible content',
      category: 'slides',
      kind: 'js-literal-object-of-arrays',
      file: 'assets/js/showcase-carousel.js',
      literalName: 'DAILY_CONTENT',
      // Four named buckets inside the object: verses / tips / facts / encouragement
      buckets: [
        { name: 'verses',        label: 'Verses' },
        { name: 'tips',          label: 'Tips' },
        { name: 'facts',         label: 'Did-you-know facts' },
        { name: 'encouragement', label: 'Encouragement' },
      ],
      elementFields: [
        { name: 'text', label: 'Text', kind: 'textarea', required: true },
        { name: 'ref',  label: 'Reference',  kind: 'text' },
      ],
      commitMessageTemplate: 'content(carousel-daily): update rotation',
    },
  };

  // Image-only folder schemas share a shape. Pure file-upload; the editor
  // lists existing files in the folder (GET /contents/{folder}) and offers
  // add/replace/delete actions per file.
  function imageFolderSchema(id, label, folder, options) {
    options = options || {};
    return {
      id: id,
      label: label,
      category: 'media',
      kind: 'image-upload',
      folder: folder,
      allowSubfolderCreate: !!options.allowSubfolderCreate,
      subfolderHint: options.subfolderHint || '',
      allowDelete: options.allowDelete !== false,
      mimeWhitelist: options.mimeWhitelist || ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      maxBytes: options.maxBytes || (100 * 1024 * 1024), // Git Data API 100 MB cap
      commitMessageTemplate: 'content(' + id + '): add {filename}',
    };
  }

  // Workflow-dispatch schemas are a distinct kind handled by the editor's
  // WorkflowDispatch view. They do NOT commit — they POST to the workflow
  // dispatch endpoint. The editor reads declared inputs on open and renders
  // a matching form.
  function workflowSchema(id, label, workflowFile) {
    return {
      id: id,
      label: label,
      category: 'workflows',
      kind: 'workflow-dispatch',
      workflowFile: workflowFile,
    };
  }

  // Bundle slideshow schemas share the same shape — three copies pointed at
  // three folders. The factory keeps them in lockstep.
  function bundleSchema(id, label, folderKey) {
    return {
      id: id,
      label: label,
      category: 'bundles',
      kind: 'json',
      path: 'assets/images/bundles/' + folderKey + '/images.json',
      rootType: 'object',
      groups: [
        {
          name: 'images',
          label: 'Slideshow images',
          kind: 'repeating-group',
          fields: [
            { name: 'file', label: 'Filename', kind: 'text', required: true,
              hint: 'Matches a real file in assets/images/bundles/' + folderKey + '/, e.g. "03-new-photo.jpg".',
              validate: (v) => /^[\w\-]+\.(jpg|jpeg|png|webp|gif)$/i.test(v) ? null : 'Filename must be e.g. "03-new.jpg" with no spaces.' },
            { name: 'caption', label: 'Caption', kind: 'text', required: true,
              hint: 'Short description shown with the image.' },
          ],
          addLabel: '+ Add image',
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.images)) return 'images must be an array.';
        return null;
      },
      commitMessageTemplate: 'content(bundle-' + folderKey + '): update {summary}',
      tokens: function (form) {
        const imgs = (form && form.images) || [];
        if (imgs.length) {
          const last = imgs[imgs.length - 1];
          if (last && last.file) return { summary: 'add ' + last.file };
        }
        return { summary: folderKey + ' slideshow update' };
      },
    };
  }

  // Phase C placeholders — none remaining.
  const WIP_LABELS = {};
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
