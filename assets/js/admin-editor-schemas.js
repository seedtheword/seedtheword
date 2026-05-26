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
      { name: 'feedType', label: 'Feed type', kind: 'select', required: false,
        options: [
          { value: 'video',    label: 'Single video' },
          { value: 'channel',  label: 'Channel' },
          { value: 'playlist', label: 'Playlist' },
        ],
        value: 'video',
        hint: 'Default = single video. Pick Channel or Playlist for ongoing creator feeds.' },
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
    instagram: [
      { name: 'kind',   label: 'Kind', kind: 'hidden', value: 'instagram' },
      { name: 'url',    label: 'Instagram profile URL', kind: 'url', required: true,
        hint: 'Paste the full profile URL. Handle is auto-extracted.',
        validate: (v) => /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?(\?.*)?$/.test(String(v || ''))
                          ? null
                          : 'Must be an https://instagram.com/<handle> URL.' },
      { name: 'handle', label: 'Handle', kind: 'hidden' },
      { name: 'title',  label: 'Display name', kind: 'text', required: true },
      { name: 'source', label: 'Source / context', kind: 'text', required: false },
      { name: 'note',   label: 'Why we recommend this', kind: 'textarea', required: false },
      { name: 'avatar', label: 'Avatar path (optional)', kind: 'text', required: false,
        placeholder: 'assets/images/featured/somecreator.jpg' },
    ],
    twitch: [
      { name: 'kind',    label: 'Kind', kind: 'hidden', value: 'twitch' },
      { name: 'url',     label: 'Twitch channel URL', kind: 'url', required: true,
        hint: 'Paste the full channel URL. Channel slug is auto-extracted.',
        validate: (v) => /^https:\/\/(www\.)?twitch\.tv\/[A-Za-z0-9_]{4,25}\/?$/.test(String(v || ''))
                          ? null
                          : 'Must be an https://twitch.tv/<channel> URL.' },
      { name: 'channel', label: 'Channel', kind: 'hidden' },
      { name: 'title',   label: 'Display name', kind: 'text', required: true },
      { name: 'source',  label: 'Source / context', kind: 'text', required: false },
      { name: 'note',    label: 'Why we recommend this', kind: 'textarea', required: false },
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
          variants: ['spotify', 'youtube', 'link', 'instagram', 'twitch'],
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
      legacyCopyPaste: false,
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
      // Three nested config blocks — one per bot. Rendered as three
      // grouped forms; admins edit one bot without touching the others.
      groups: [
        {
          name: 'shared',
          dataKey: 'shared',
          label: 'Shared across bots',
          hint: 'Settings used by more than one bot or by the admin-help walkthroughs.',
          fields: [
            { name: 'calendarPhotosFolderUrl', label: 'Calendar photos Drive folder URL', kind: 'url',
              hint: 'Public Drive folder admins upload event photos to. Sharing MUST be set to "Anyone with the link: Viewer" on the folder itself — every file dropped inside inherits that access, so admins never have to share per-file. Admin-help surfaces a direct link straight to this folder.',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
          ],
        },
        {
          name: 'announcements',
          dataKey: 'announcements',
          label: 'Announcements bot',
          hint: 'Posts upcoming / in-progress calendar events to the @seedtheword channel. Runs every 15 minutes.',
          fields: [
            { name: 'enabled', label: 'Enabled', kind: 'toggle' },
            { name: 'tokenSecret', label: 'GitHub Secret name for bot token', kind: 'text', required: true,
              hint: 'The name of the repo secret that holds the bot token (e.g. TELEGRAM_BOT_TOKEN). Never paste the token itself here.' },
            { name: 'chatId', label: 'Channel / chat ID', kind: 'text', required: true,
              placeholder: '@seedtheword' },
            { name: 'messageThreadId', label: 'Message thread ID (optional)', kind: 'number',
              hint: 'Topic thread inside a forum-style channel. Leave blank if the channel has no topics.' },
            { name: 'timezone', label: 'Timezone', kind: 'text', required: true,
              placeholder: 'America/Los_Angeles' },
            { name: 'skipDaysOfWeek', label: 'Skip days of the week (comma-separated)', kind: 'text',
              hint: 'e.g. "Sunday" or "Saturday,Sunday". Empty = post every day. LIVE events always post.',
              coerce: 'csv-array' },
            { name: 'lookaheadDays', label: 'Lookahead days', kind: 'number', required: true,
              hint: 'How far ahead of now to consider events. Usually 1 so announcements stay close to the event.' },
            { name: 'reminderMinutesBefore', label: 'Reminder minutes before event', kind: 'number',
              hint: 'Send a "starting soon" reminder this many minutes before an event. 180 = 3 hours.' },
            { name: 'quietHoursStart', label: 'Quiet hours start (24h)', kind: 'number',
              hint: 'Earliest hour non-live announcements may post. e.g. 7 = 7am. LIVE events bypass this.' },
            { name: 'quietHoursEnd', label: 'Quiet hours end (24h)', kind: 'number',
              hint: 'Latest hour non-live announcements may post. e.g. 21 = 9pm.' },
            { name: 'header.morning',  label: 'Morning banner',  kind: 'text', placeholder: '☀️ Today at Seed the Word' },
            { name: 'header.midday',   label: 'Midday banner',   kind: 'text', placeholder: '🌿 Still happening today' },
            { name: 'header.evening',  label: 'Evening banner',  kind: 'text', placeholder: '🔴 Live now & coming up' },
            { name: 'header.reminder', label: 'Reminder banner', kind: 'text', placeholder: '⏰ Starting soon' },
            { name: 'footer', label: 'Footer text', kind: 'textarea',
              hint: 'Appended to the bottom of every announcement.' },
          ],
        },
        {
          name: 'bible',
          dataKey: 'bible',
          label: 'Daily Bible bot',
          hint: 'Posts the daily chapter reading + optional Russian link + Prayer & Thanksgiving block to the Bible topic, Monday–Saturday at 8 AM Pacific.',
          fields: [
            { name: 'enabled', label: 'Enabled', kind: 'toggle' },
            { name: 'tokenSecret', label: 'GitHub Secret name for bot token', kind: 'text', required: true,
              placeholder: 'TELEGRAM_BIBLE_BOT_TOKEN' },
            { name: 'chatId', label: 'Channel / chat ID', kind: 'text', required: true },
            { name: 'messageThreadId', label: 'Message thread ID', kind: 'number' },
            { name: 'timezone', label: 'Timezone', kind: 'text', required: true },
            { name: 'linkBackUrl', label: 'Link-back URL (pinned Bible message)', kind: 'url',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'fallbackShowUrl', label: 'Fallback Spotify show URL (English)', kind: 'url',
              hint: 'Used when the per-chapter episode link is not in bible-spotify-map.json.',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'russianFallbackShowUrl', label: 'Fallback Spotify show URL (Russian)', kind: 'url',
              hint: 'Optional. When set, every daily post includes a second "Читаем Слово Божие на Русском" link. Leave blank to omit.',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'prayerTopicUrl', label: 'Prayer & Thanksgiving topic URL', kind: 'url',
              hint: 'Shown as "Open the Prayer & Thanksgiving topic →" at the bottom of each daily post. Falls back to the prayer bot\'s own prayerTopicUrl if blank.',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'includePrayerBlock', label: 'Include Prayer & Thanksgiving block', kind: 'toggle',
              hint: 'When on, every daily post appends the italic blockquote asking members to share prayer requests / thanksgiving. Turn off to post the reading alone.' },
            // Today's Chapter topic auto-rename (Mon-Fri only)
            { name: 'todayChapterTopic.enabled', label: "Today's Chapter: auto-rename topic on each post", kind: 'toggle',
              hint: 'After every Mon-Fri post the Bible bot renames the topic below to match the day\'s reading. Bot must be admin with "Manage Topics" permission.' },
            { name: 'todayChapterTopic.messageThreadId', label: "Today's Chapter: topic thread ID", kind: 'number',
              hint: 'Middle number from https://t.me/<chat>/<threadId>/<msgId>. The topic the bot will rename.' },
            { name: 'todayChapterTopic.nameTemplate', label: "Today's Chapter: name template", kind: 'text',
              placeholder: "Today's Chapter is {book} {chapter}",
              hint: '{book} and {chapter} are filled with the day\'s reading (Telegram caps topic names at 128 chars).' },
            // Study Saturday Live (the Saturday-only post uses these)
            { name: 'saturday.enabled', label: 'Saturday: Study Saturday Live post enabled', kind: 'toggle',
              hint: 'Saturday morning posts a dedicated Study Saturday Live teaser pulling "This week\'s study focus" + "This week\'s reading" from study-saturday.json.' },
            { name: 'saturday.twitchUrl', label: 'Saturday: Twitch stream URL', kind: 'url',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'saturday.streamStartTimePT', label: 'Saturday: Stream start time (PT, human readable)', kind: 'text',
              placeholder: '7:00 PM' },
            { name: 'saturday.rulesUrl', label: 'Saturday: S.E.E.D. Rules link (optional)', kind: 'url',
              hint: 'When set, the phrase "S.E.E.D. Rules" in the closing note becomes a clickable link.',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'saturday.bodyIntro', label: 'Saturday: Intro paragraph', kind: 'textarea' },
            { name: 'saturday.bodyReview', label: 'Saturday: Review paragraph', kind: 'textarea' },
            { name: 'saturday.bodyGoal', label: 'Saturday: Goal paragraph', kind: 'textarea' },
            { name: 'saturday.bodyRulesNote', label: 'Saturday: Closing rules note', kind: 'textarea' },
            // Weekly Spotify playlist digest (Sunday 9 AM PT)
            { name: 'playlist.enabled', label: 'Playlist: Weekly digest enabled', kind: 'toggle',
              hint: 'Sunday 9 AM PT posts a "What\'s new in the community playlist this week" digest to the Worship topic. Requires SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET in repo secrets.' },
            { name: 'playlist.playlistId', label: 'Playlist: Spotify playlist ID', kind: 'text',
              hint: 'The 22-character ID from the playlist URL, e.g. 18QMpMTYrFt2KxW1Q9NsvX.' },
            { name: 'playlist.publicUrl', label: 'Playlist: Public listen URL', kind: 'url',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'playlist.collaboratorInviteUrl', label: 'Playlist: Collaborator-invite URL', kind: 'url',
              hint: 'The ?pt=... URL from Spotify\'s "Invite collaborators" button. One-tap opt-in for new contributors.',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'playlist.worshipTopicId', label: 'Playlist: Worship & Music topic thread ID', kind: 'number',
              hint: 'Telegram topic where the weekly digest posts. Middle number from https://t.me/<chat>/<threadId>/<messageId>.' },
            { name: 'playlist.worshipTopicUrl', label: 'Playlist: Worship topic URL (for admin-help)', kind: 'url',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            // Bible Audio pipeline — see admin-help.html#bible-audio-pipeline-setup
            { name: 'audio.enabled', label: 'Audio: Bible Audio pipeline enabled', kind: 'toggle',
              hint: 'When on, the STW Bible Audio Apps Script project polls the Today\'s Chapter topic for voice memos, the nightly bible-audio-cleanup workflow ffmpeg-cleans them, and the team gets a per-chapter email at 07:00 PT the next morning. Leave off until both Drive folder IDs below are pasted in and GDRIVE_SERVICE_ACCOUNT_JSON is in repo secrets.' },
            { name: 'audio.rawDriveFolderId', label: 'Audio: Raw Drive folder ID', kind: 'text',
              hint: 'The long string after /folders/ in the Drive URL of the folder volunteers\' raw recordings land in. See admin-help.html#bible-audio-pipeline-setup for the service-account walkthrough.' },
            { name: 'audio.cleanedDriveFolderId', label: 'Audio: Cleaned Drive folder ID', kind: 'text',
              hint: 'The long string after /folders/ in the Drive URL of the folder cleaned MP3s land in. Must be a different folder from the raw one — the workflow never writes to the raw folder.' },
            { name: 'audio.telegramTopicId', label: 'Audio: Telegram topic thread ID', kind: 'number',
              hint: 'Default 13 — same as bible.todayChapterTopic.messageThreadId above. Change only if the audio pipeline should listen to a different topic than the daily-reading bot renames.' },
            { name: 'audio.ffmpegFilter', label: 'Audio: ffmpeg filter chain', kind: 'text',
              placeholder: 'afftdn=nf=-25:nt=w:om=o,highpass=f=80,dynaudnorm=f=200:g=15:m=10',
              hint: 'Conservative chain. afftdn=-25dB FFT denoiser, 80Hz high-pass to drop room rumble, dynaudnorm for gentle level matching. Edit at your own risk; test on a sample before saving.' },
            { name: 'audio.audioBitrate', label: 'Audio: MP3 output bitrate', kind: 'text',
              placeholder: '128k',
              hint: 'Passed to ffmpeg -b:a. 128k is plenty for spoken-word at mono 44.1 kHz.' },
          ],
        },
        {
          name: 'prayer',
          dataKey: 'prayer',
          label: 'Prayer nudge bot',
          hint: 'Sends a gentle daily nudge to pray / share thanksgiving.',
          fields: [
            { name: 'enabled', label: 'Enabled', kind: 'toggle' },
            { name: 'tokenSecret', label: 'GitHub Secret name for bot token', kind: 'text', required: true,
              placeholder: 'TELEGRAM_PRAYER_BOT_TOKEN' },
            { name: 'chatId', label: 'Channel / chat ID', kind: 'text', required: true },
            { name: 'messageThreadId', label: 'Message thread ID', kind: 'number' },
            { name: 'prayerTopicUrl', label: 'Prayer topic URL (pinned)', kind: 'url',
              validate: (v) => !v || isValidHttpsUrl(v) ? null : 'Must be an https URL.' },
            { name: 'timezone', label: 'Timezone', kind: 'text', required: true },
          ],
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        // Soft validation — we want the form to be forgiving for admins who
        // are mid-edit. Strict required-field enforcement lives on the
        // per-field validators.
        for (const bot of ['announcements', 'bible', 'prayer']) {
          if (data[bot] && typeof data[bot] !== 'object') return bot + ' must be an object.';
        }
        return null;
      },
      commitMessageTemplate: 'content(telegram-bot): update {summary}',
      tokens: function (form) {
        // Best-effort summary: surface whichever bot the admin just touched.
        try {
          for (const bot of ['announcements', 'bible', 'prayer']) {
            const b = form && form[bot];
            if (b && typeof b === 'object' && b.enabled !== undefined) {
              return { summary: bot + ' ' + (b.enabled ? 'enabled' : 'disabled') };
            }
          }
        } catch (_) {}
        return { summary: 'telegram bot config' };
      },
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

    siteConfig: {
      id: 'siteConfig',
      label: 'Site config (cross-cutting)',
      category: 'content',
      kind: 'json',
      path: 'assets/data/site-config.json',
      rootType: 'object',
      groups: [
        {
          name: 'root',
          label: 'Site-wide configuration',
          fields: [
            {
              name: 'orderHandlerUrl',
              label: 'Order email handler URL (Apps Script Web App)',
              kind: 'url',
              hint: "Paste the deployed Apps Script Web App URL here. When empty, bundle-builder.html falls back to Formspree. See admin-help.html → How-to → Set up the order email handler.",
              validate: (v) => {
                if (!v) return null; // empty is valid (fallback to Formspree)
                if (!/^https:\/\//i.test(v)) return 'Must be an https URL or left blank.';
                if (!/script\.google\.com\/macros\//i.test(v) && !/googleusercontent\.com\//i.test(v)) {
                  return 'Expected a script.google.com/macros/... or googleusercontent.com URL.';
                }
                return null;
              },
            },
          ],
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (data.orderHandlerUrl !== undefined && typeof data.orderHandlerUrl !== 'string') {
          return 'orderHandlerUrl must be a string.';
        }
        return null;
      },
      commitMessageTemplate: 'content(site-config): update {summary}',
      tokens: function (form) {
        if (form && form.orderHandlerUrl) {
          return { summary: 'order handler URL' };
        }
        return { summary: 'site config' };
      },
    },

    studySaturday: {
      id: 'studySaturday',
      label: 'Study Saturday — weekly review',
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
            { name: 'oldTestament', label: "This week's study focus", kind: 'text',
              hint: 'e.g. "Genesis 15 — Abram\'s covenant". Renders as the top pill on community.html (Saturday review block).' },
            { name: 'newTestament', label: "This week's reading", kind: 'text',
              hint: 'e.g. "Mark 11 — Jesus enters Jerusalem". Renders as the second pill on community.html (Saturday review block).' },
            { name: 'anchorChapter', label: "This week's anchor chapter (Discovery)", kind: 'text',
              hint: 'e.g. "Luke 7". Surfaces in the Discovery card on community.html — the chapter life groups read together this week. Used by the four S.E.E.D. discovery questions. Leave blank to show a generic "Pick a chapter" prompt.' },
            { name: 'anchorNote', label: 'Discovery: optional one-line note', kind: 'text',
              hint: 'Short italic context shown under the chapter name on the Discovery card. e.g. "Jesus heals, forgives, and calls — meet the Christ who sees both centurion and sinner." Optional.' },
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

    // Testimonies — published stories grid for news.html / testimonies.html
    // / about.html strip / homepage showcase. Reserved top-level keys
    // `_help` and `_team_review_workflow` ride through unchanged because
    // the form is loaded via JSON.parse and re-serialized as-is; the
    // declared fields all live under form.testimonies[*].
    //
    // Fully built (Tasks 2.1, 2.2, 2.3, 2.4, 2.5) — fields, kinds,
    // `consent` select options, per-field `validate` callbacks,
    // `required: true` markers on id/name/submittedAt/consent, the
    // schema-level `validate(data)` function enforcing duplicate-id,
    // consent-enum, and required-when-published cross-record rules,
    // the commit-message template + `tokens(form)` summary builder,
    // and plain-English `hint` strings on id/body/excerpt/published
    // documenting slug conventions, paragraph rendering rules, the
    // about-page excerpt cap, and the draft-vs-published toggle.
    // The shared audit-suffix appender in admin-editor-github.js /
    // admin-editor-commit-message.js runs unmodified — no schema-
    // specific audit code is needed here.
    testimonies: {
      id: 'testimonies',
      label: 'Testimonies (published stories grid)',
      category: 'content',
      kind: 'json',
      path: 'assets/data/testimonies.json',
      rootType: 'object',
      groups: [
        {
          name: 'testimonies',
          label: 'Testimonies (most recent publishedAt first)',
          kind: 'repeating-group',
          fields: [
            { name: 'id', label: 'ID (slug)', kind: 'text', required: true,
              hint: 'Lowercase, dashes only. Suggested: stw-story-{YYYY-MM-DD}-{first-name} or stw-team-{first-last}.',
              validate: (v) => /^[a-z0-9][a-z0-9-]*$/.test(String(v || '')) ? null : 'Use lowercase letters, numbers, and dashes only.' },
            { name: 'name', label: 'Name (private record — site shows "Anonymous" when anonymous=on)', kind: 'text', required: true },
            { name: 'anonymous', label: 'Display as "Anonymous" on the site', kind: 'toggle' },
            { name: 'submittedAt', label: 'Submitted at (YYYY-MM-DD)', kind: 'date', required: true,
              validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? null : 'Must be YYYY-MM-DD.' },
            { name: 'publishedAt', label: 'Published at (YYYY-MM-DD — set when flipping to published)', kind: 'date',
              validate: (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : 'Must be YYYY-MM-DD or left blank.' },
            { name: 'published', label: 'Published (renders on the site)', kind: 'toggle',
              hint: 'OFF = draft. ON = appears on news/testimonies/about/showcase.' },
            { name: 'excerpt', label: 'Excerpt (one-sentence pull-quote)', kind: 'textarea',
              hint: 'Used on the compact strip on about.html. Keep to ~140 chars.' },
            { name: 'body', label: 'Body (full testimony — blank line for new paragraph)', kind: 'textarea',
              hint: 'Use a blank line between paragraphs. Single line breaks render as <br>. No HTML.' },
            { name: 'anchorVerse', label: 'Anchor verse (e.g. "Romans 8:28")', kind: 'text' },
            { name: 'mediaUrl', label: 'Media URL (optional, https)', kind: 'url',
              validate: (v) => !v || /^https:\/\/\S+$/i.test(String(v)) ? null : 'Must be an https URL or left blank.' },
            { name: 'consent', label: 'Consent', kind: 'select', required: true,
              options: [
                { value: 'explicit', label: 'explicit (checked the consent box on the form)' },
                { value: 'verbal',   label: 'verbal (obtained off-system)' },
              ] },
          ],
          addLabel: '+ Add testimony',
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.testimonies)) return 'testimonies must be an array.';
        // Cross-record + cross-field rules that the per-field validators
        // above can't catch on their own.
        const ids = new Set();
        for (let i = 0; i < data.testimonies.length; i++) {
          const t = data.testimonies[i] || {};
          const idx = '#' + (i + 1);
          // Unique ids
          if (t.id && ids.has(t.id)) {
            return 'Testimony ' + idx + ' has duplicate id "' + t.id + '".';
          }
          if (t.id) ids.add(t.id);
          // Consent must be one of the two enum values
          if (t.consent && t.consent !== 'explicit' && t.consent !== 'verbal') {
            return 'Testimony ' + idx + ': consent must be "explicit" or "verbal".';
          }
          // When published, the renderer-consumed fields must be present
          if (t.published === true) {
            if (!t.publishedAt) return 'Testimony ' + idx + ': set publishedAt before publishing.';
            if (!t.excerpt)     return 'Testimony ' + idx + ': excerpt is required before publishing.';
            if (!t.body)        return 'Testimony ' + idx + ': body is required before publishing.';
            if (!t.anchorVerse) return 'Testimony ' + idx + ': anchorVerse is required before publishing.';
          }
        }
        return null;
      },
      commitMessageTemplate: 'content(testimonies): update {summary}',
      tokens: function (form) {
        const t = (form && form.testimonies) || [];
        if (t.length) {
          const last = t[t.length - 1];
          if (last && last.id) return { summary: 'edit ' + last.id };
        }
        return { summary: 'testimonies update' };
      },
    },

    bundleEssentials: bundleSchema('bundleEssentials', 'Bundle: Essentials slideshow', 'essentials'),
    bundleLifegroup: bundleSchema('bundleLifegroup', 'Bundle: Life Group slideshow', 'lifegroup'),
    bundleMinistry:  bundleSchema('bundleMinistry',  'Bundle: Ministry slideshow',  'ministry'),

    // Instagram tile — hand-curated source of truth as of May 2026.
    // The auto-scrape pipeline (rss.app trial) expired and we
    // switched to admin-maintained entries. Same JSON shape as before
    // (the frontend renderer is unchanged), just edited through the
    // admin UI now instead of cron-refreshed.
    //
    // For thumbnails, paste a path under assets/images/instagram/ —
    // upload the photo through the "Instagram thumbnails" image-folder
    // schema first, then reference the resulting filename here.
    instagramFeed: {
      id: 'instagramFeed',
      label: 'Instagram tile (homepage feed)',
      category: 'content',
      kind: 'json',
      path: 'assets/data/instagram.json',
      rootType: 'object',
      groups: [
        {
          name: 'posts',
          label: 'Posts (most recent first)',
          kind: 'repeating-group',
          fields: [
            { name: 'id', label: 'ID (any unique slug)', kind: 'text', required: true,
              hint: 'Free-form unique identifier. Suggested: yyyy-mm-dd-keyword (e.g. 2026-05-26-bible-study).' },
            { name: 'url', label: 'Instagram post URL', kind: 'url', required: true,
              hint: 'Full https://www.instagram.com/p/... link.',
              validate: function (v) {
                if (!v) return 'URL is required.';
                if (!/^https:\/\/(www\.)?instagram\.com\/p\//.test(String(v))) {
                  return 'Must be an instagram.com/p/... URL.';
                }
                return null;
              }
            },
            { name: 'thumbnail', label: 'Thumbnail path', kind: 'text', required: true,
              hint: 'Path like assets/images/instagram/my-post.jpg. Upload the image via the "Instagram thumbnails" schema first.' },
            { name: 'caption', label: 'Caption', kind: 'textarea',
              hint: 'Plain text. Newlines are preserved.' },
            { name: 'date', label: 'Posted date', kind: 'text',
              hint: 'ISO timestamp like 2026-05-26T17:50:28.000Z, or just 2026-05-26.' },
            { name: 'is_video', label: 'This post is a video', kind: 'toggle' },
          ],
          addLabel: '+ Add Instagram post',
          // Opt into the bulk-URL importer next to the add button. The
          // editor wires this in renderRepeatingGroup → openInstagramBulkImport.
          // Lets an admin paste N URLs, dedupe against the existing posts,
          // drop a thumbnail per new URL, and commit everything in one push.
          bulkImport: 'instagram',
        },
      ],
      validate: function (data) {
        if (!data || typeof data !== 'object') return 'Root must be an object.';
        if (!Array.isArray(data.posts)) return 'posts must be an array.';
        const ids = new Set();
        for (let i = 0; i < data.posts.length; i++) {
          const p = data.posts[i] || {};
          const idx = '#' + (i + 1);
          if (p.id && ids.has(p.id)) {
            return 'Post ' + idx + ' has duplicate id "' + p.id + '".';
          }
          if (p.id) ids.add(p.id);
        }
        return null;
      },
      commitMessageTemplate: 'content(instagram): update {summary}',
      tokens: function (form) {
        const posts = (form && form.posts) || [];
        if (posts.length) {
          const last = posts[posts.length - 1];
          if (last && last.id) return { summary: 'edit ' + last.id };
        }
        return { summary: 'instagram update' };
      },
    },

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
    instagramThumbnails: imageFolderSchema('instagramThumbnails', 'Instagram thumbnails', 'assets/images/instagram/'),
    testimoniesPhotos: imageFolderSchema('testimoniesPhotos', 'Testimony photos (homepage carousel)', 'assets/images/testimonies/'),

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
    // YouTube channel — accepts /channel/UC…, /@handle, /c/vanity. Returns
    // { id, handle } where id is the UC… channel id (when present) and
    // handle is the @-prefixed handle (when present). Either may be ''.
    extractYouTubeChannel: function (url) {
      const s = String(url || '');
      const out = { id: '', handle: '' };
      let m = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_\-]{20,})/);
      if (m) { out.id = m[1]; return out; }
      m = s.match(/youtube\.com\/(@[A-Za-z0-9._\-]{1,})(?:\/|$|\?)/);
      if (m) { out.handle = m[1]; return out; }
      m = s.match(/youtube\.com\/c\/([A-Za-z0-9._\-]{1,})(?:\/|$|\?)/);
      if (m) { out.handle = m[1]; return out; }
      return out;
    },
    // YouTube playlist — accepts /playlist?list=PL… and /watch?v=…&list=PL….
    // Returns the PL… (or other-prefix) playlist id, or '' if none.
    extractYouTubePlaylist: function (url) {
      const s = String(url || '');
      const m = s.match(/[?&]list=([A-Za-z0-9_\-]{10,})/);
      return m ? m[1] : '';
    },
    // Instagram handle — accepts https://instagram.com/<handle>/, plain
    // @<handle>, or plain <handle>. Strips leading @, trailing slash, and
    // query string. Returns '' if the input doesn't match the handle charset.
    extractInstagram: function (url) {
      let s = String(url || '').trim();
      const urlMatch = s.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/);
      if (urlMatch) return urlMatch[1];
      // Plain @handle or bare handle
      if (s.startsWith('@')) s = s.slice(1);
      if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return s;
      return '';
    },
    // Twitch channel — accepts https://twitch.tv/<channel>, plain <channel>.
    // Strips protocol, optional www., and trailing slash. Returns '' if the
    // input doesn't match the Twitch channel charset.
    extractTwitch: function (url) {
      const s = String(url || '').trim();
      const urlMatch = s.match(/^https?:\/\/(?:www\.)?twitch\.tv\/([A-Za-z0-9_]{4,25})\/?$/);
      if (urlMatch) return urlMatch[1];
      if (/^[A-Za-z0-9_]{4,25}$/.test(s)) return s;
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
