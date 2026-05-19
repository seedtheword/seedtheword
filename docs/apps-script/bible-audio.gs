/**
 * Seed the Word — Bible Audio Pipeline (Apps Script project: STW Bible Audio)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Captures volunteer-recorded chapter readings posted to the @seedtheword
 * Telegram supergroup's "Today's Chapter" topic, conservatively cleans
 * the audio, and emails the admin a per-chapter checklist for the manual
 * Spotify upload step.
 *
 * Three stages, two of them in this file:
 *   1. Telegram_Poller    — pollTelegramChapterAudio() (Apps Script)
 *      Time-driven every 30 min, 07:00–22:00 PT. Pulls new audio/voice
 *      messages out of thread 13, saves raw bytes to Drive under
 *      Raw_Folder/<chapter-slug>/<message_id>.<ext>.
 *   2. Cleanup_Workflow   — bible-audio-cleanup.yml (GitHub Actions)
 *      Nightly. Reads Raw_Folder, runs ffmpeg, writes Cleaned_Folder.
 *      Lives in the repo, NOT in this file.
 *   3. Notifier           — notifyCleanedAudio() (Apps Script)
 *      Daily 07:00 PT. Lists Cleaned_Folder, emails the admin one
 *      message per cleaned recording with a Drive download link.
 *
 * Spec: .kiro/specs/bible-audio-pipeline/
 *
 * Deployment procedure (also documented on admin-help.html):
 *   1. Sign in to script.google.com as seedthewordministry@gmail.com.
 *   2. Click + New project, rename to "STW Bible Audio".
 *   3. Open this file (docs/apps-script/bible-audio.gs) and copy
 *      its full contents.
 *   4. In the Apps Script editor, select all in Code.gs and paste over.
 *   5. Project Settings → Script Properties → add a property named
 *      TELEGRAM_BIBLE_BOT_TOKEN with the @seedtheword bot's token.
 *   6. Save (disk icon), then run registerBibleAudioTriggers() once
 *      from the function dropdown to install the 30 poller triggers
 *      and the daily notifier trigger.
 *   7. Authorize when prompted (UrlFetch + Drive + Mail scopes).
 *   8. Open the admin editor → Bible → Audio config, paste the two
 *      Drive folder IDs, flip enabled to true, save & commit.
 *
 * Until step 8 flips bible.audio.enabled to true, every entry point in
 * this file is a no-op — _readAudioConfig() returns the safe default
 * and pollTelegramChapterAudio() / notifyCleanedAudio() bail at the top.
 */

// ── CONFIG ──────────────────────────────────────────────────────
const TEAM_INBOX = 'seedthewordministry@gmail.com';

// Raw GitHub URL of the bot config. _readAudioConfig() pulls this
// every poll so the admin can flip enabled / repaste folder IDs via
// the browser admin editor without redeploying the script.
const BIBLE_AUDIO_CONFIG_URL =
  'https://raw.githubusercontent.com/seedtheword/seedtheword/main/assets/data/telegram-bot.json';

// Defense-in-depth bound on the per-poll batch size. The dedup loop
// would skip duplicates anyway, but capping here keeps any single
// invocation under Apps Script's 6-minute execution limit even if
// Telegram returns an unusually large window.
const MAX_AUDIOS_PER_POLL = 20;

// ScriptProperties keys — all bibleaudio.* state lives in the same
// PropertiesService namespace as Stage 1 + Stage 3.
const PROP_PROCESSED = 'bibleaudio.processedIds';
const PROP_ACKED = 'bibleaudio.acknowledgedIds';
const PROP_OFFSET = 'bibleaudio.tgOffset';
// Script-property KEY (not the token itself) — admin pastes the
// real value into Project Settings → Script Properties at deploy.
const PROP_BOT_TOKEN = 'TELEGRAM_BIBLE_BOT_TOKEN';

// Public site URL — used in email footers / walkthrough links.
// Mirrors the SITE_URL constant in order-handler.gs.
const SITE_URL = 'https://seedtheword.github.io/seedtheword/';

// Anchor URL the Notifier email body links to. The id attribute on
// the matching <h3> in admin-help.html is added by spec task 12.1.
const ADMIN_HELP_ANCHOR =
  'https://seedtheword.github.io/seedtheword/admin-help.html#publish-a-new-podcast-episode';

// ── HELPERS ─────────────────────────────────────────────────────

/**
 * Reads the bible.audio block out of the committed telegram-bot.json
 * over HTTPS. Pure-ish — only side effect is the GET.
 *
 * Returns the parsed bible.audio object on success. On any failure
 * (network error, non-2xx response, parse error, missing bible.audio
 * key) returns the safe default {enabled: false} so every entry point
 * bails with a no-op rather than crashing.
 *
 * @return {{
 *   enabled: boolean,
 *   rawDriveFolderId: (string|undefined),
 *   cleanedDriveFolderId: (string|undefined),
 *   telegramTopicId: (number|undefined),
 *   ffmpegFilter: (string|undefined),
 *   audioBitrate: (string|undefined)
 * }}
 */
function _readAudioConfig() {
  try {
    const response = UrlFetchApp.fetch(BIBLE_AUDIO_CONFIG_URL, {
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('bibleaudio: config fetch failed: HTTP ' + code);
      return { enabled: false };
    }
    const parsed = JSON.parse(response.getContentText());
    const audio = parsed && parsed.bible && parsed.bible.audio;
    if (!audio) return { enabled: false };
    return audio;
  } catch (err) {
    Logger.log('bibleaudio: config fetch failed: ' + err);
    return { enabled: false };
  }
}

/**
 * Pure function. Maps a topic-name string to a kebab-case
 * Chapter_Slug or to "unknown-chapter" when the input does not
 * match the configured nameTemplate.
 *
 * Algorithm:
 *   1. Build a regex from `template` by escaping every regex-special
 *      character EXCEPT the literal substrings "{book}" and "{chapter}",
 *      which become capture groups: {book} → (.+?), {chapter} → (\d+).
 *      Anchor with ^…$ and match case-insensitively.
 *   2. If `topicName` does not match → "unknown-chapter".
 *   3. Slugify the book capture: lowercase, replace any run of
 *      non-[a-z0-9] with "-", trim leading/trailing "-".
 *   4. If the slugified book is empty (e.g. Cyrillic-only) → "unknown-chapter".
 *   5. Return `<slug-book>-<chapter>`.
 *
 * For non-"unknown-chapter" outputs the return value satisfies
 * /^[a-z0-9](-?[a-z0-9]+)*$/ AND ends with `-{chapter}`.
 *
 * @param {string} topicName  e.g. "Today's Chapter is Luke 7"
 * @param {string} template   e.g. "Today's Chapter is {book} {chapter}"
 * @return {string} e.g. "luke-7", "1-corinthians-13", or "unknown-chapter"
 */
function _deriveChapterSlug(topicName, template) {
  if (typeof topicName !== 'string' || typeof template !== 'string') {
    return 'unknown-chapter';
  }
  if (!topicName || !template) return 'unknown-chapter';

  // Sentinel placeholders that survive regex-escaping unchanged so we
  // can swap them for the real capture groups afterward.
  var BOOK_TOKEN = '\u0001BOOK\u0001';
  var CHAP_TOKEN = '\u0001CHAP\u0001';
  var seeded = template
    .replace(/\{book\}/g, BOOK_TOKEN)
    .replace(/\{chapter\}/g, CHAP_TOKEN);
  // Escape regex specials.
  var escaped = seeded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var pattern = escaped
    .replace(new RegExp(BOOK_TOKEN, 'g'), '(.+?)')
    .replace(new RegExp(CHAP_TOKEN, 'g'), '(\\d+)');
  var rx;
  try {
    rx = new RegExp('^' + pattern + '$', 'i');
  } catch (err) {
    return 'unknown-chapter';
  }
  var m = topicName.match(rx);
  if (!m) return 'unknown-chapter';

  var bookRaw = m[1];
  var chapterRaw = m[2];
  if (!bookRaw || !chapterRaw) return 'unknown-chapter';

  var slugBook = bookRaw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slugBook) return 'unknown-chapter';

  return slugBook + '-' + chapterRaw;
}

// Canonical 66-book Bible name list (OT then NT), mirroring
// .github/scripts/bible_books.py. Used by _slugToChapterDisplay
// to invert the kebab slug back into a human display name.
const BIBLE_BOOK_NAMES = [
  // Old Testament (39)
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  // New Testament (27)
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];

/**
 * Pure function. Inverse of _deriveChapterSlug for the canonical
 * 66 books. Turns "luke-7" into "Luke 7", "1-corinthians-13" into
 * "1 Corinthians 13", "song-of-solomon-2" into "Song of Solomon 2",
 * and the literal "unknown-chapter" into "Unknown chapter".
 *
 * Algorithm:
 *   1. If slug === "unknown-chapter" → "Unknown chapter".
 *   2. Find the longest book whose kebab form is a prefix of the slug
 *      (descending length so "Song of Solomon" matches before any
 *      shorter prefix overlap).
 *   3. The remainder after `<kebab>-` must be all digits; otherwise
 *      "Unknown chapter".
 *   4. Return `<original-book-name> <chapter-digits>`.
 *
 * @param {string} slug  e.g. "luke-7", "1-corinthians-13", "unknown-chapter"
 * @return {string}      e.g. "Luke 7", "1 Corinthians 13", "Unknown chapter"
 */
function _slugToChapterDisplay(slug) {
  if (slug === 'unknown-chapter') return 'Unknown chapter';
  if (typeof slug !== 'string' || !slug) return 'Unknown chapter';

  // Compute (kebab, name) pairs and sort by descending kebab length
  // so a longer book name like "song-of-solomon" matches before a
  // shorter prefix like "song" would.
  var candidates = BIBLE_BOOK_NAMES.map(function (name) {
    var kebab = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { name: name, kebab: kebab };
  });
  candidates.sort(function (a, b) { return b.kebab.length - a.kebab.length; });

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var prefix = c.kebab + '-';
    if (slug.indexOf(prefix) === 0) {
      var rest = slug.substring(prefix.length);
      if (/^\d+$/.test(rest)) {
        return c.name + ' ' + rest;
      }
      return 'Unknown chapter';
    }
  }
  return 'Unknown chapter';
}

/**
 * Pure function. Returns one of: "mp3", "oga", "ogg", "m4a", "wav".
 * Inspects (in order): mimeType, fileName extension, payload kind.
 * Defaults to "oga" for voice and "mp3" for audio (req 4.4).
 *
 * @param {string|null|undefined} mimeType
 * @param {string|null|undefined} fileName
 * @param {"audio"|"voice"} kind
 * @return {string}
 */
function _inferFileExtension(mimeType, fileName, kind) {
  if (mimeType && typeof mimeType === 'string') {
    var mt = mimeType.toLowerCase();
    if (mt === 'audio/mpeg') return 'mp3';
    if (mt === 'audio/mp4' || mt === 'audio/aac' || mt === 'audio/m4a') return 'm4a';
    if (mt === 'audio/ogg') return kind === 'voice' ? 'oga' : 'ogg';
    if (mt === 'audio/wav' || mt === 'audio/x-wav' || mt === 'audio/wave') return 'wav';
  }
  if (fileName && typeof fileName === 'string') {
    var m = fileName.toLowerCase().match(/\.(mp3|m4a|ogg|oga|wav)$/);
    if (m) return m[1];
  }
  return kind === 'voice' ? 'oga' : 'mp3';
}

/**
 * Pure function. Renders the email subject + plain-text body for one
 * cleaned recording. Uses _slugToChapterDisplay for the human-readable
 * Chapter_Display token in both the subject and the body.
 *
 * @param {{slug: string, messageId: number, downloadUrl: string}} entry
 * @return {{subject: string, body: string}}
 */
function _renderNotificationEmail(entry) {
  var display = _slugToChapterDisplay(entry.slug);
  var subject =
    '[STW Audio Ready] ' + display + ' \u2014 cleaned recording awaiting upload';

  var body =
    'Hi,\n' +
    '\n' +
    'A cleaned chapter recording is ready to upload to Spotify.\n' +
    '\n' +
    '  Chapter:    ' + display + '\n' +
    '  Slug:       ' + entry.slug + '\n' +
    '  Message:    Telegram message ' + entry.messageId + '\n' +
    '  Download:   ' + entry.downloadUrl + '\n' +
    '\n' +
    'Walkthrough:  ' + ADMIN_HELP_ANCHOR + '\n' +
    '\n' +
    '5-step upload checklist (Path A, ~3 minutes):\n' +
    '\n' +
    '  1. Click the Download link above. Right-click the file in Drive and\n' +
    '     pick "Download" to save the MP3 locally.\n' +
    '\n' +
    '  2. Open https://podcasters.spotify.com in a new tab. Log in with the\n' +
    '     ministry Spotify account.\n' +
    '\n' +
    '  3. Click "Add new episode" \u2192 drag-drop the MP3. In the title field,\n' +
    '     paste the chapter name exactly as shown above (' + display + ').\n' +
    '     Description is optional. Click Publish.\n' +
    '\n' +
    '  4. Wait ~5 minutes for Spotify to finish processing. Once the episode\n' +
    '     page loads, copy the episode URL from the address bar.\n' +
    '\n' +
    '  5. Open the admin editor (Editor \u2192 Bible \u2192 Spotify chapter map).\n' +
    '     Find the row keyed "' + display + '". Paste the Spotify URL into\n' +
    '     its value field. Save & commit. The Bible bot\'s next 08:00 PT post\n' +
    '     will link to the new episode automatically.\n' +
    '\n' +
    '\u2014 STW Bible Audio (Apps Script project)\n';

  return { subject: subject, body: body };
}

/**
 * Reads the parent bot's Today_Chapter_Topic name template from
 * the committed telegram-bot.json. The bible.audio block does NOT
 * carry its own nameTemplate — the Bible bot renames the topic
 * using `bible.todayChapterTopic.nameTemplate`, so the audio
 * pipeline must use the SAME template to reverse-engineer the
 * Chapter_Slug from the live topic name.
 *
 * Returns the configured template, or the documented default
 * "Today's Chapter is {book} {chapter}" if the fetch fails.
 *
 * @return {string}
 */
function _readNameTemplate() {
  try {
    var response = UrlFetchApp.fetch(BIBLE_AUDIO_CONFIG_URL, {
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() === 200) {
      var parsed = JSON.parse(response.getContentText());
      var t =
        parsed &&
        parsed.bible &&
        parsed.bible.todayChapterTopic &&
        parsed.bible.todayChapterTopic.nameTemplate;
      if (t && typeof t === 'string') return t;
    }
  } catch (err) {
    /* fall through to default */
  }
  return "Today's Chapter is {book} {chapter}";
}

/**
 * Reads the Telegram bot token from this Apps Script project's
 * Script Properties. Returns null (and logs a warning) if missing
 * so callers can short-circuit cleanly.
 *
 * @return {string|null}
 */
function _getBotToken() {
  var token = PropertiesService.getScriptProperties().getProperty(PROP_BOT_TOKEN);
  if (!token) {
    Logger.log(
      'bibleaudio: ' +
        PROP_BOT_TOKEN +
        ' is not set in Script Properties; aborting'
    );
    return null;
  }
  return token;
}

/**
 * Reads a ScriptProperties key as a Set<number>. Returns an empty
 * Set if the key is missing, the value is empty, JSON-invalid, or
 * not an array. Filters non-finite values defensively.
 *
 * @param {string} propKey
 * @return {Set<number>}
 */
function _readIdSet(propKey) {
  var raw = PropertiesService.getScriptProperties().getProperty(propKey);
  if (raw === null || raw === '') return new Set();
  var arr;
  try {
    arr = JSON.parse(raw);
  } catch (err) {
    return new Set();
  }
  if (!Array.isArray(arr)) return new Set();
  return new Set(
    arr.map(Number).filter(function (n) {
      return Number.isFinite(n);
    })
  );
}

/**
 * Persists a Set<number> (or array) back to ScriptProperties as a
 * JSON array sorted ascending. Caps at the most recent 1000 entries
 * (keeps the LARGEST 1000, drops the smallest) so the property
 * stays well below PropertiesService's 9 KB-per-value limit.
 *
 * @param {string} propKey
 * @param {Set<number>|Array<number>} ids
 */
function _writeIdSet(propKey, ids) {
  var arr;
  if (ids instanceof Set) {
    arr = [];
    ids.forEach(function (n) {
      arr.push(n);
    });
  } else if (Array.isArray(ids)) {
    arr = ids.slice();
  } else {
    arr = [];
  }
  arr = arr
    .map(function (n) {
      return Number(n);
    })
    .filter(function (n) {
      return Number.isFinite(n);
    })
    .map(function (n) {
      return Math.trunc(n);
    });
  arr.sort(function (a, b) {
    return a - b;
  });
  if (arr.length > 1000) {
    arr = arr.slice(arr.length - 1000);
  }
  PropertiesService.getScriptProperties().setProperty(
    propKey,
    JSON.stringify(arr)
  );
}

/**
 * Calls Telegram getUpdates with the stored offset.
 *
 * Uses timeout=0 (no long-polling) and restricts to message
 * updates only. Returns ok=false on HTTP errors, body.ok=false
 * responses, or any thrown error so the caller can short-circuit
 * without modifying state. A 401 specifically logs an admin-
 * facing message naming the bot-token script property
 * (Requirement 4.6).
 *
 * @param {string} botToken
 * @param {number} offset
 * @return {{updates: Array, ok: boolean, error: string|null}}
 */
function _telegramGetUpdates(botToken, offset) {
  try {
    var url =
      'https://api.telegram.org/bot' +
      botToken +
      '/getUpdates?offset=' +
      encodeURIComponent(String(offset)) +
      '&timeout=0&allowed_updates=%5B%22message%22%5D';
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code === 401) {
      Logger.log(
        'ERROR: getUpdates 401 \u2014 TELEGRAM_BIBLE_BOT_TOKEN is invalid'
      );
      return { updates: [], ok: false, error: '401' };
    }
    if (code < 200 || code >= 300) {
      Logger.log('bibleaudio: getUpdates HTTP ' + code);
      return { updates: [], ok: false, error: 'HTTP ' + code };
    }
    var body;
    try {
      body = JSON.parse(response.getContentText());
    } catch (parseErr) {
      Logger.log('bibleaudio: getUpdates parse error: ' + parseErr);
      return { updates: [], ok: false, error: 'parse' };
    }
    if (!body || body.ok !== true) {
      var desc = body && body.description ? body.description : 'unknown';
      Logger.log('bibleaudio: getUpdates ok=false: ' + desc);
      return { updates: [], ok: false, error: desc };
    }
    return {
      updates: Array.isArray(body.result) ? body.result : [],
      ok: true,
      error: null,
    };
  } catch (err) {
    Logger.log('bibleaudio: getUpdates threw: ' + err);
    return { updates: [], ok: false, error: String(err) };
  }
}

/**
 * Calls Telegram getForumTopic to fetch the live name of a
 * forum-topic. Falls back gracefully — never throws — so the
 * caller can use the documented "unknown-chapter" fallback when
 * the topic name cannot be fetched.
 *
 * @param {string} botToken
 * @param {string} chatId      e.g. "@seedtheword"
 * @param {number} threadId    e.g. 13
 * @return {string|null}       Topic name, or null on any error
 */
function _getFreshTopicName(botToken, chatId, threadId) {
  try {
    var url =
      'https://api.telegram.org/bot' +
      botToken +
      '/getForumTopic?chat_id=' +
      encodeURIComponent(String(chatId)) +
      '&message_thread_id=' +
      encodeURIComponent(String(threadId));
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('bibleaudio: getForumTopic HTTP ' + code);
      return null;
    }
    var body = JSON.parse(response.getContentText());
    if (!body || body.ok !== true || !body.result) {
      Logger.log(
        'bibleaudio: getForumTopic ok=false: ' +
          (body && body.description ? body.description : 'unknown')
      );
      return null;
    }
    var name = body.result.name;
    if (typeof name !== 'string' || !name) return null;
    return name;
  } catch (err) {
    Logger.log('bibleaudio: getForumTopic threw: ' + err);
    return null;
  }
}

/**
 * Two-step Telegram file download:
 *   1. getFile to resolve the file_path on Telegram's CDN.
 *   2. GET https://api.telegram.org/file/bot<token>/<file_path>
 *      and capture the response as a Blob.
 *
 * Returns the Blob plus a best-effort mimeType derived from the
 * response Content-Type header (preferred) or the file_path's
 * extension. Never throws — returns {ok:false, ...} on any error.
 *
 * @param {string} botToken
 * @param {string} fileId
 * @return {{ok: boolean, blob: GoogleAppsScript.Base.Blob|null, mimeType: string|null, error: string|null}}
 */
function _telegramDownloadFile(botToken, fileId) {
  try {
    // Step 1: resolve file_path.
    var getFileUrl =
      'https://api.telegram.org/bot' +
      botToken +
      '/getFile?file_id=' +
      encodeURIComponent(String(fileId));
    var fileResp = UrlFetchApp.fetch(getFileUrl, { muteHttpExceptions: true });
    var fileCode = fileResp.getResponseCode();
    if (fileCode < 200 || fileCode >= 300) {
      return {
        ok: false,
        blob: null,
        mimeType: null,
        error: 'getFile HTTP ' + fileCode,
      };
    }
    var fileBody = JSON.parse(fileResp.getContentText());
    if (!fileBody || fileBody.ok !== true || !fileBody.result) {
      return {
        ok: false,
        blob: null,
        mimeType: null,
        error:
          'getFile ok=false: ' +
          (fileBody && fileBody.description ? fileBody.description : 'unknown'),
      };
    }
    var filePath = fileBody.result.file_path;
    if (typeof filePath !== 'string' || !filePath) {
      return {
        ok: false,
        blob: null,
        mimeType: null,
        error: 'getFile missing file_path',
      };
    }

    // Step 2: download bytes.
    var dlUrl =
      'https://api.telegram.org/file/bot' + botToken + '/' + filePath;
    var dlResp = UrlFetchApp.fetch(dlUrl, { muteHttpExceptions: true });
    var dlCode = dlResp.getResponseCode();
    if (dlCode < 200 || dlCode >= 300) {
      return {
        ok: false,
        blob: null,
        mimeType: null,
        error: 'download HTTP ' + dlCode,
      };
    }

    // Best-effort mime: prefer Content-Type, fall back to extension.
    var mimeType = null;
    try {
      var headers = dlResp.getHeaders ? dlResp.getHeaders() : null;
      if (headers) {
        var ct = headers['Content-Type'] || headers['content-type'];
        if (ct && typeof ct === 'string') {
          // Strip parameters like "; charset=..."
          mimeType = ct.split(';')[0].trim();
        }
      }
    } catch (headerErr) {
      /* ignore — mime stays null */
    }
    if (!mimeType) {
      var dotIdx = filePath.lastIndexOf('.');
      if (dotIdx >= 0) {
        var ext = filePath.substring(dotIdx + 1).toLowerCase();
        if (ext === 'mp3') mimeType = 'audio/mpeg';
        else if (ext === 'm4a') mimeType = 'audio/mp4';
        else if (ext === 'ogg' || ext === 'oga') mimeType = 'audio/ogg';
        else if (ext === 'wav') mimeType = 'audio/wav';
      }
    }

    var blob = dlResp.getBlob();
    return { ok: true, blob: blob, mimeType: mimeType, error: null };
  } catch (err) {
    return {
      ok: false,
      blob: null,
      mimeType: null,
      error: String(err),
    };
  }
}

/**
 * Saves a Blob to Raw_Folder/<slug>/<message_id>.<ext>. Creates
 * the per-slug subfolder if it does not exist. Idempotent: if a
 * file with the target name already exists in the slug subfolder,
 * does NOT overwrite — returns ok=true with the existing file's id.
 *
 * @param {string} rawFolderId
 * @param {string} slug
 * @param {number} messageId
 * @param {string} ext         leading dot omitted, e.g. "oga"
 * @param {GoogleAppsScript.Base.Blob} blob
 * @return {{ok: boolean, fileId: string|null, error: string|null}}
 */
function _saveRawToDrive(rawFolderId, slug, messageId, ext, blob) {
  try {
    var root = DriveApp.getFolderById(rawFolderId);

    // Find or create the slug subfolder (case-sensitive name match).
    var subfolder = null;
    var folderIter = root.getFoldersByName(slug);
    while (folderIter.hasNext()) {
      var candidate = folderIter.next();
      if (candidate.getName() === slug) {
        subfolder = candidate;
        break;
      }
    }
    if (!subfolder) {
      subfolder = root.createFolder(slug);
    }

    var targetName = String(messageId) + '.' + ext;

    // Idempotent: if a file with that name already exists, return it.
    var fileIter = subfolder.getFilesByName(targetName);
    while (fileIter.hasNext()) {
      var existing = fileIter.next();
      if (existing.getName() === targetName) {
        Logger.log(
          'bibleaudio: ' + slug + '/' + targetName + ' already exists; skipping write'
        );
        return { ok: true, fileId: existing.getId(), error: null };
      }
    }

    blob.setName(targetName);
    var created = subfolder.createFile(blob);
    return { ok: true, fileId: created.getId(), error: null };
  } catch (err) {
    return { ok: false, fileId: null, error: String(err) };
  }
}

/**
 * Walks the Cleaned_Folder two levels deep — `<root>/<slug>/<file>`
 * — and returns one entry per file whose basename is all digits
 * (the parsed Telegram Message_ID). Non-numeric basenames and
 * stray files at the root level are silently ignored, matching
 * the design's "<root>/<slug>/<msgid>.mp3" layout.
 *
 * Each entry includes a Drive download URL of the documented
 * shape so the Notifier email can deep-link straight to the file
 * without a Drive sharing-permission round-trip.
 *
 * Never throws — on any DriveApp error logs and returns whatever
 * has accumulated so far (possibly an empty list). The Notifier
 * caller treats an empty list as "nothing to send".
 *
 * @param {string} folderId  bible.audio.cleanedDriveFolderId
 * @return {Array<{
 *   fileId: string,
 *   name: string,
 *   slug: string,
 *   messageId: number,
 *   downloadUrl: string
 * }>}
 */
function _listCleanedFolderEntries(folderId) {
  var entries = [];
  try {
    var root = DriveApp.getFolderById(folderId);
    var slugIter = root.getFolders();
    while (slugIter.hasNext()) {
      var slugFolder = slugIter.next();
      var slug = slugFolder.getName();
      var fileIter = slugFolder.getFiles();
      while (fileIter.hasNext()) {
        var file = fileIter.next();
        var name = file.getName();
        // Parse "<messageId>.<ext>" — only accept all-digit basenames.
        var dot = name.lastIndexOf('.');
        if (dot <= 0) continue;
        var basename = name.substring(0, dot);
        if (!/^\d+$/.test(basename)) continue;
        var messageId = parseInt(basename, 10);
        if (!Number.isFinite(messageId)) continue;
        var fileId = file.getId();
        entries.push({
          fileId: fileId,
          name: name,
          slug: slug,
          messageId: messageId,
          downloadUrl:
            'https://drive.google.com/uc?export=download&id=' + fileId,
        });
      }
    }
  } catch (err) {
    Logger.log('bibleaudio: list cleaned threw: ' + err);
  }
  return entries;
}

// ── ENTRY POINTS ────────────────────────────────────────────────

/**
 * Stage 1 entry point. Polls Telegram for new chapter audio in
 * thread `bible.audio.telegramTopicId` and writes the raw bytes
 * to Raw_Folder/<chapter-slug>/<message_id>.<ext>.
 *
 * Bails on `enabled === false` or empty `rawDriveFolderId` (the
 * documented "config not yet pasted" state — Req 1.7, 1.8).
 * Wrapped in a top-level try/catch so a thrown error logs but
 * never propagates: an uncaught error from a time-driven trigger
 * suppresses future invocations of that trigger in Apps Script.
 *
 * Maps to: Requirements 1.7, 1.8, 2.1, 2.2, 2.3, 3.1, 4.1, 4.2,
 * 4.3, 4.5, 4.6, 4.7. Properties P1, P3, P4.
 */
function pollTelegramChapterAudio() {
  try {
    Logger.log('bibleaudio: poll start ' + new Date().toISOString());

    // 1. Load config + bail if disabled or unconfigured.
    var cfg = _readAudioConfig();
    if (!cfg.enabled) {
      Logger.log('bibleaudio: enabled=false; skipping poll');
      return;
    }
    if (!cfg.rawDriveFolderId) {
      // Req 1.8 — admin-facing log that names the missing field.
      Logger.log(
        'ERROR: bibleaudio.rawDriveFolderId is empty; aborting poll'
      );
      return;
    }
    var topicId = cfg.telegramTopicId;
    if (typeof topicId !== 'number' || !Number.isFinite(topicId)) {
      Logger.log(
        'ERROR: bibleaudio.telegramTopicId missing or invalid; aborting poll'
      );
      return;
    }

    // The Bible bot renames the topic using
    // bible.todayChapterTopic.nameTemplate. We must use the same
    // template to reverse-engineer Chapter_Slug.
    var nameTemplate = _readNameTemplate();

    // 2. Bot token from script properties.
    var botToken = _getBotToken();
    if (!botToken) return; // _getBotToken already logged.

    // 3. Read state.
    var processed = _readIdSet(PROP_PROCESSED);
    var offsetRaw = PropertiesService.getScriptProperties().getProperty(
      PROP_OFFSET
    );
    var offset = parseInt(offsetRaw || '0', 10);
    if (!Number.isFinite(offset)) offset = 0;

    // 4. Fetch updates.
    var resp = _telegramGetUpdates(botToken, offset);
    if (!resp.ok) {
      // Already logged. Don't touch state — next run will retry.
      return;
    }
    var updates = resp.updates || [];
    if (updates.length === 0) {
      Logger.log('bibleaudio: no new updates');
      return;
    }

    // 5. Track max update_id over the WHOLE response (not just
    // candidates), filter to thread + audio/voice + not-yet-processed,
    // then sort ascending by message_id (Req 4.5) and cap.
    var maxUpdateId = offset > 0 ? offset - 1 : 0;
    var candidates = [];
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      if (
        u &&
        typeof u.update_id === 'number' &&
        u.update_id > maxUpdateId
      ) {
        maxUpdateId = u.update_id;
      }
      var msg = u && u.message;
      if (!msg) continue;
      if (msg.message_thread_id !== topicId) continue; // Req 2.2
      var hasAudio = !!msg.audio;
      var hasVoice = !!msg.voice;
      if (!hasAudio && !hasVoice) continue; // Req 2.3
      if (typeof msg.message_id !== 'number') continue;
      if (processed.has(msg.message_id)) continue; // Req 4.3 (dedup BEFORE download)
      candidates.push(msg);
    }
    candidates.sort(function (a, b) {
      return a.message_id - b.message_id;
    }); // Req 4.5
    if (candidates.length > MAX_AUDIOS_PER_POLL) {
      Logger.log(
        'bibleaudio: capping batch from ' +
          candidates.length +
          ' to ' +
          MAX_AUDIOS_PER_POLL
      );
      candidates = candidates.slice(0, MAX_AUDIOS_PER_POLL);
    }

    // 6. Resolve fresh topic name once for this batch. The chatId
    // is not part of bible.audio — the parent supergroup is the
    // hard-coded ministry handle that all bots use.
    var topicName = _getFreshTopicName(botToken, '@seedtheword', topicId);
    var slug = _deriveChapterSlug(topicName || '', nameTemplate);

    // 7. Process each candidate. Per-message failure is isolated:
    // log + skip, do NOT add to processed (next poll retries —
    // Req 4.7). Offset advances regardless via step 8.
    for (var j = 0; j < candidates.length; j++) {
      var m = candidates[j];
      var payload = m.audio || m.voice;
      var kind = m.audio ? 'audio' : 'voice';
      var ext = _inferFileExtension(
        (payload && payload.mime_type) || null,
        (payload && payload.file_name) || null,
        kind
      );
      var dl = _telegramDownloadFile(botToken, payload.file_id);
      if (!dl.ok) {
        Logger.log(
          'bibleaudio: download failed for msg ' +
            m.message_id +
            ': ' +
            dl.error
        );
        continue;
      }
      var save = _saveRawToDrive(
        cfg.rawDriveFolderId,
        slug,
        m.message_id,
        ext,
        dl.blob
      );
      if (!save.ok) {
        Logger.log(
          'bibleaudio: drive save failed for msg ' +
            m.message_id +
            ': ' +
            save.error
        );
        continue;
      }
      processed.add(m.message_id); // success only
      Logger.log('bibleaudio: saved ' + slug + '/' + m.message_id + '.' + ext);
    }

    // 8. Persist state. Offset advances regardless of per-message
    // outcome so a permanently-broken Message_ID does not jam the
    // queue (design §"Telegram offset management").
    _writeIdSet(PROP_PROCESSED, processed);
    var newOffset = maxUpdateId + 1;
    if (newOffset > offset) {
      PropertiesService.getScriptProperties().setProperty(
        PROP_OFFSET,
        String(newOffset)
      );
    }
    Logger.log(
      'bibleaudio: poll done. processed=' +
        processed.size +
        ' offset=' +
        newOffset
    );
  } catch (err) {
    // Top-level guard — a thrown error from a time-driven trigger
    // suppresses future invocations in Apps Script. Log and swallow.
    Logger.log('bibleaudio: poll threw: ' + err);
  }
}

// notifyCleanedAudio() — Stage 3 entry point.

/**
 * Stage 3 entry point. Lists the cleaned-recordings folder,
 * sends one email per cleaned recording the team has not yet
 * acknowledged, and persists the updated acknowledged-ids set.
 *
 * Bails on `enabled === false` or empty `cleanedDriveFolderId`
 * (the documented "config not yet pasted" state — Req 1.7).
 * Per-message MailApp failure is isolated: log + skip, do NOT
 * add to acknowledged_ids so the next run retries the same id
 * (Req 6.6). The acknowledged set is persisted once at the end,
 * regardless of whether any individual send failed.
 *
 * Wrapped in a top-level try/catch so a thrown error logs but
 * never propagates: an uncaught error from a time-driven trigger
 * suppresses future invocations of that trigger in Apps Script.
 *
 * Maps to: Requirements 1.7, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7.
 * Properties P6, P7.
 */
function notifyCleanedAudio() {
  try {
    Logger.log('bibleaudio: notify start ' + new Date().toISOString());

    // 1. Load config + bail if disabled or unconfigured.
    var cfg = _readAudioConfig();
    if (!cfg.enabled) {
      Logger.log('bibleaudio: enabled=false; skipping notify');
      return;
    }
    if (!cfg.cleanedDriveFolderId) {
      Logger.log(
        'bibleaudio: cleanedDriveFolderId empty; skipping notify'
      );
      return;
    }

    // 2. Read state + the cleaned-folder snapshot.
    var acked = _readIdSet(PROP_ACKED);
    var entries = _listCleanedFolderEntries(cfg.cleanedDriveFolderId);

    // 3. Sort ascending by messageId so emails arrive in posting
    // order (matches design §"Notifier dedup loop").
    entries.sort(function (a, b) {
      return a.messageId - b.messageId;
    });

    // 4. Per-entry: skip if already acked, otherwise render and send.
    var sent = 0;
    var skipped = 0;
    var failed = 0;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      // Dedup BEFORE rendering — Req 6.7 (silent on already-acked).
      if (acked.has(entry.messageId)) {
        skipped++;
        continue;
      }
      var rendered = _renderNotificationEmail(entry);
      try {
        MailApp.sendEmail({
          to: TEAM_INBOX,
          subject: rendered.subject,
          body: rendered.body,
        });
        // Req 6.5 — only mark acked on send success.
        acked.add(entry.messageId);
        sent++;
      } catch (sendErr) {
        // Req 6.6 — log, do NOT add to acked, let next run retry.
        Logger.log(
          'bibleaudio: send failed for msg ' +
            entry.messageId +
            ': ' +
            sendErr
        );
        failed++;
      }
    }

    // 5. Persist the updated acknowledged set once at the end.
    _writeIdSet(PROP_ACKED, acked);
    Logger.log(
      'bibleaudio: notify done. sent=' +
        sent +
        ' skipped=' +
        skipped +
        ' failed=' +
        failed
    );
  } catch (err) {
    // Top-level guard — see pollTelegramChapterAudio for rationale.
    Logger.log('bibleaudio: notify threw: ' + err);
  }
}

// ── TRIGGER INSTALLER ───────────────────────────────────────────

/**
 * One-time setup helper. Run this once from the Apps Script editor
 * (function dropdown → registerBibleAudioTriggers → Run) after
 * pasting the bot token into Script Properties.
 *
 * Installs:
 *   • 30 daily ClockTriggerBuilder triggers for pollTelegramChapterAudio,
 *     one per half-hour slot from 07:00 through 21:30 PT (07:00, 07:30,
 *     08:00, …, 21:00, 21:30). This mirrors the announcement-bot
 *     pattern documented in the design (§"Stage 1 schedule") — Apps
 *     Script does not support arbitrary cron expressions, so a
 *     half-hourly cadence is realised by 30 separate daily triggers.
 *   • 1 daily ClockTriggerBuilder trigger for notifyCleanedAudio at
 *     07:00 PT (Req 6.1, design §"Stage 3 schedule").
 *
 * Idempotent — re-running deletes any existing triggers for these
 * two handlers BEFORE creating fresh ones, so it is always safe to
 * re-run after editing this file.
 *
 * Also initializes the three bibleaudio.* ScriptProperties keys
 * (processedIds, acknowledgedIds, tgOffset) to their documented
 * defaults ("[]", "[]", "0") if unset. Existing values are
 * preserved untouched.
 *
 * Does NOT verify config — the admin still needs to flip
 * bible.audio.enabled to true (and paste the two Drive folder IDs)
 * via the browser admin editor before the triggers do anything.
 * Until then every entry point bails at the top.
 *
 * Total triggers created: 31 (30 poller + 1 notifier).
 */
function registerBibleAudioTriggers() {
  // 1. Delete any existing triggers for our two entry points so
  //    re-running this function is safe (no duplicates).
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    var t = existing[i];
    var fname = t.getHandlerFunction();
    if (fname === 'pollTelegramChapterAudio' || fname === 'notifyCleanedAudio') {
      ScriptApp.deleteTrigger(t);
      deleted++;
    }
  }
  Logger.log('bibleaudio: deleted ' + deleted + ' existing triggers');

  // 2. Create 30 half-hourly poller triggers from 07:00 through 21:30 PT.
  //    (07:00, 07:30, 08:00, 08:30, … 21:00, 21:30 = 15 hours × 2 = 30 slots.)
  var pollerCount = 0;
  for (var hour = 7; hour <= 21; hour++) {
    for (var minute = 0; minute < 60; minute += 30) {
      ScriptApp.newTrigger('pollTelegramChapterAudio')
        .timeBased()
        .atHour(hour)
        .nearMinute(minute)
        .inTimezone('America/Los_Angeles')
        .everyDays(1)
        .create();
      pollerCount++;
    }
  }
  Logger.log('bibleaudio: created ' + pollerCount + ' poller triggers');

  // 3. One daily 07:00 PT notifier trigger.
  ScriptApp.newTrigger('notifyCleanedAudio')
    .timeBased()
    .atHour(7)
    .nearMinute(0)
    .inTimezone('America/Los_Angeles')
    .everyDays(1)
    .create();
  Logger.log('bibleaudio: created notifier trigger');

  // 4. Initialize ScriptProperties keys if unset. Use === null
  //    (not just falsy) so a legitimate empty array literal "[]"
  //    is preserved untouched.
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_PROCESSED) === null) {
    props.setProperty(PROP_PROCESSED, '[]');
    Logger.log('bibleaudio: initialized ' + PROP_PROCESSED + ' = []');
  }
  if (props.getProperty(PROP_ACKED) === null) {
    props.setProperty(PROP_ACKED, '[]');
    Logger.log('bibleaudio: initialized ' + PROP_ACKED + ' = []');
  }
  if (props.getProperty(PROP_OFFSET) === null) {
    props.setProperty(PROP_OFFSET, '0');
    Logger.log('bibleaudio: initialized ' + PROP_OFFSET + ' = 0');
  }

  Logger.log(
    'bibleaudio: registerBibleAudioTriggers complete (' +
      (pollerCount + 1) +
      ' triggers)'
  );
}
