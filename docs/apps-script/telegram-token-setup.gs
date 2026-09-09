/**
 * ONE-TIME SETUP — Telegram token + Script Properties cleanup
 * ───────────────────────────────────────────────────────────
 * Paste this whole file into the STW Order Handler (P1) Apps Script
 * project as a new file (e.g. "telegram-token-setup.gs"), then run the
 * functions below from the editor's ▶ Run menu. No redeploy needed —
 * Script Properties are read at runtime.
 *
 * WHY: the project has 50+ Script Properties (stale `biblebot:...:weekday`
 * dedup stamps from the daily Bible bot), so the Project Settings UI turned
 * read-only and won't let you add TELEGRAM_BOT_TOKEN by hand. These functions
 * fix that programmatically.
 *
 * DO THIS, in order:
 *   1. Run  cleanupStaleBibleBotStamps   → deletes the old biblebot:* stamps
 *      (safe: they only prevented duplicate posts on past dates).
 *   2. Run  setTelegramBotToken          → sets TELEGRAM_BOT_TOKEN.
 *      Either paste your BotFather token into TOKEN_VALUE below, OR leave it
 *      blank to reuse the existing BIBLE_BOT_TOKEN (only correct if the
 *      announcements bot is the SAME bot as the Bible bot).
 *   3. Run  showTelegramTokenStatus      → confirms it's set (logs a preview).
 *
 * After that, click "Test Telegram" in the portal again.
 */

// ── STEP 2 config: paste your bot token here (from BotFather), or leave ''
// to reuse BIBLE_BOT_TOKEN. Delete the value again after running if you like.
var TOKEN_VALUE = '';

function setTelegramBotToken() {
  var props = PropertiesService.getScriptProperties();
  var token = String(TOKEN_VALUE || '').trim();
  if (!token) {
    // Fallback: reuse the Bible bot token IF that's the same bot.
    token = props.getProperty('BIBLE_BOT_TOKEN') || '';
    if (token) Logger.log('TOKEN_VALUE was blank — reusing BIBLE_BOT_TOKEN.');
  }
  if (!token) {
    Logger.log('ERROR: No token. Paste your BotFather token into TOKEN_VALUE at the top of this file, then run again.');
    return;
  }
  props.setProperty('TELEGRAM_BOT_TOKEN', token);
  Logger.log('TELEGRAM_BOT_TOKEN set. Preview: ' + token.slice(0, 8) + '…(' + token.length + ' chars)');
}

// Deletes the stale biblebot:YYYY-MM-DD:kind dedup stamps so the project drops
// back under 50 properties and the Settings UI becomes editable again.
// These are harmless to remove — they only prevented a duplicate Bible-bot
// post on a specific PAST date, which can never recur.
function cleanupStaleBibleBotStamps() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var removed = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('biblebot:') === 0) { props.deleteProperty(k); removed++; }
  });
  Logger.log('Removed ' + removed + ' stale biblebot:* stamps. Remaining properties: ' + Object.keys(props.getProperties()).length);
}

// Read-only check: confirms whether TELEGRAM_BOT_TOKEN is set (logs a masked
// preview, never the full token).
function showTelegramTokenStatus() {
  var t = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!t) { Logger.log('TELEGRAM_BOT_TOKEN is NOT set.'); return; }
  Logger.log('TELEGRAM_BOT_TOKEN IS set. Preview: ' + t.slice(0, 8) + '…(' + t.length + ' chars)');
}
