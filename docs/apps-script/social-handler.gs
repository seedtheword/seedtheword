/**
 * Seed the Word — Community Social Handler (Likes, Comments, Replies)
 * ────────────────────────────────────────────────────────────────────
 *
 * Copy this file's contents into your existing Apps Script project
 * (alongside order-handler.gs, team-messaging-handlers.gs, etc.)
 *
 * Then add the following action routes into doPost() in order-handler.gs,
 * right before the final `return jsonResponse({ ok: false, error: 'unknown-action' });`:
 *
 *   // ── Community Social actions (see docs/apps-script/social-handler.gs) ──
 *   if ((payload && payload.action) === 'toggleLike') return handleToggleLike_(payload);
 *   if ((payload && payload.action) === 'getLikes') return handleGetLikes_(payload);
 *   if ((payload && payload.action) === 'postComment') return handlePostComment_(payload);
 *   if ((payload && payload.action) === 'getComments') return handleGetComments_(payload);
 *
 * SHEET SETUP (auto-created):
 *   Run `installSocialTab` from the Apps Script editor function dropdown.
 *   This creates the "Social" tab with proper headers.
 *   Safe to re-run — won't overwrite existing data.
 *
 * DATA MODEL — Social tab columns:
 *   A: type          (like | comment | reply)
 *   B: postId        (e.g. "p-1723456789000-David")
 *   C: userId        (team member name from session)
 *   D: timestamp     (epoch milliseconds)
 *   E: text          (comment/reply body; empty for likes)
 *   F: parentId      (for replies: the timestamp ID of parent comment)
 *   G: channel       (main | prayer | thanksgiving | scripture)
 */

// ── Sheet helper ──────────────────────────────────────────────────────

var SOCIAL_TAB = 'Social';

function getSocialSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName(SOCIAL_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SOCIAL_TAB);
    sheet.getRange(1, 1, 1, 7).setValues([['type', 'postId', 'userId', 'timestamp', 'text', 'parentId', 'channel']]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(5, 300);
  }
  return sheet;
}

// ── Bootstrap — run this once from the editor ─────────────────────────

/**
 * One-time bootstrap for the Social tab. Run from the Apps Script
 * editor's function dropdown:
 *   1. Pick `installSocialTab` from the dropdown.
 *   2. Click Run.
 *   3. Open the spreadsheet and confirm the new Social tab exists
 *      with 7 column headers.
 *
 * Safe to re-run: only creates the tab if it doesn't exist.
 */
function installSocialTab() {
  var sheet = getSocialSheet_();
  Logger.log('Social tab ready: ' +
    SpreadsheetApp.openById(LEDGER_SHEET_ID).getUrl() + '#gid=' + sheet.getSheetId());
}

// ── Admin passphrase check (reused from existing code) ────────────────

function validateAdminOrPublicOrToken_(payload) {
  // Returns { user, isPublic } or null
  var user = validateTeamToken_(String(payload.token || ''));
  if (user) return { user: user, isPublic: false };
  var isPublic = String(payload.passphrase_hash || '') === 'public-read';
  if (isPublic) return { user: null, isPublic: true };
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// ACTION: toggleLike
// Request:  { action: 'toggleLike', token: string, postId: string, channel?: string }
// Response: { ok: true, liked: boolean, likeCount: number }
// ══════════════════════════════════════════════════════════════════════

function handleToggleLike_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var postId = String(payload.postId || '').trim();
    if (!postId) return jsonResponse({ ok: false, error: 'Missing postId' });

    var userId = user.name;
    var sheet = getSocialSheet_();
    var lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      // No data yet — just add the like
      sheet.appendRow(['like', postId, userId, Date.now(), '', '', String(payload.channel || '')]);
      return jsonResponse({ ok: true, liked: true, likeCount: 1 });
    }

    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var existingRow = -1;
    var likeCount = 0;

    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === 'like' && data[i][1] === postId) {
        likeCount++;
        if (data[i][2] === userId) {
          existingRow = i + 2; // 1-indexed + header
        }
      }
    }

    if (existingRow > 0) {
      // Unlike — remove the row
      sheet.deleteRow(existingRow);
      return jsonResponse({ ok: true, liked: false, likeCount: Math.max(0, likeCount - 1) });
    } else {
      // Like — append
      sheet.appendRow(['like', postId, userId, Date.now(), '', '', String(payload.channel || '')]);
      return jsonResponse({ ok: true, liked: true, likeCount: likeCount + 1 });
    }
  } catch (err) {
    Logger.log('toggleLike error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// ACTION: getLikes
// Request:  { action: 'getLikes', token?: string, passphrase_hash?: 'public-read', postIds: string[] }
// Response: { ok: true, likes: { [postId]: { count: number, userLiked: boolean } } }
// ══════════════════════════════════════════════════════════════════════

function handleGetLikes_(payload) {
  try {
    var auth = validateAdminOrPublicOrToken_(payload);
    if (!auth) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var postIds = payload.postIds || [];
    if (!postIds.length) return jsonResponse({ ok: true, likes: {} });

    var userId = auth.user ? auth.user.name : null;
    var sheet = getSocialSheet_();
    var lastRow = sheet.getLastRow();

    // Initialize result
    var result = {};
    for (var p = 0; p < postIds.length; p++) {
      result[postIds[p]] = { count: 0, userLiked: false };
    }

    if (lastRow < 2) return jsonResponse({ ok: true, likes: result });

    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // only need type, postId, userId

    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === 'like') {
        var pid = data[i][1];
        if (result[pid] !== undefined) {
          result[pid].count++;
          if (userId && data[i][2] === userId) {
            result[pid].userLiked = true;
          }
        }
      }
    }

    return jsonResponse({ ok: true, likes: result });
  } catch (err) {
    Logger.log('getLikes error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// ACTION: postComment
// Request:  { action: 'postComment', token: string, postId: string, text: string, parentCommentId?: string, channel?: string }
// Response: { ok: true, comment: { id, userId, text, timestamp, parentCommentId } }
// ══════════════════════════════════════════════════════════════════════

function handlePostComment_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var postId = String(payload.postId || '').trim();
    var text = String(payload.text || '').trim();
    var parentId = String(payload.parentCommentId || '').trim();
    var channel = String(payload.channel || '').trim();

    if (!postId) return jsonResponse({ ok: false, error: 'Missing postId' });
    if (!text) return jsonResponse({ ok: false, error: 'Missing text' });
    if (text.length > 2000) return jsonResponse({ ok: false, error: 'Comment too long (max 2000)' });

    var type = parentId ? 'reply' : 'comment';
    var timestamp = Date.now();
    var sheet = getSocialSheet_();

    sheet.appendRow([type, postId, user.name, timestamp, text, parentId, channel]);

    return jsonResponse({
      ok: true,
      comment: {
        id: String(timestamp),
        userId: user.name,
        text: text,
        timestamp: timestamp,
        parentCommentId: parentId || null
      }
    });
  } catch (err) {
    Logger.log('postComment error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ══════════════════════════════════════════════════════════════════════
// ACTION: getComments
// Request:  { action: 'getComments', token?: string, passphrase_hash?: 'public-read', postIds: string[] }
// Response: { ok: true, comments: { [postId]: [ { id, userId, text, timestamp, parentCommentId, replies: [...] } ] } }
// ══════════════════════════════════════════════════════════════════════

function handleGetComments_(payload) {
  try {
    var auth = validateAdminOrPublicOrToken_(payload);
    if (!auth) return jsonResponse({ ok: false, error: 'Unauthorized' });

    var postIds = payload.postIds || [];
    if (!postIds.length) return jsonResponse({ ok: true, comments: {} });

    var sheet = getSocialSheet_();
    var lastRow = sheet.getLastRow();

    // Initialize result
    var result = {};
    for (var p = 0; p < postIds.length; p++) {
      result[postIds[p]] = [];
    }

    if (lastRow < 2) return jsonResponse({ ok: true, comments: result });

    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var repliesMap = {}; // parentId -> [replies]

    for (var i = 0; i < data.length; i++) {
      var rowType = data[i][0];
      var rowPostId = data[i][1];

      if ((rowType === 'comment' || rowType === 'reply') && result[rowPostId] !== undefined) {
        var entry = {
          id: String(data[i][3]),
          userId: data[i][2],
          text: data[i][4],
          timestamp: Number(data[i][3]),
          parentCommentId: data[i][5] || null
        };

        if (rowType === 'reply' && entry.parentCommentId) {
          if (!repliesMap[entry.parentCommentId]) repliesMap[entry.parentCommentId] = [];
          repliesMap[entry.parentCommentId].push(entry);
        } else {
          entry.replies = [];
          result[rowPostId].push(entry);
        }
      }
    }

    // Attach replies to parent comments and sort
    for (var pid in result) {
      var comments = result[pid];
      for (var c = 0; c < comments.length; c++) {
        var cId = comments[c].id;
        if (repliesMap[cId]) {
          comments[c].replies = repliesMap[cId].sort(function(a, b) { return a.timestamp - b.timestamp; });
        }
      }
      // Newest comments first
      result[pid] = comments.sort(function(a, b) { return b.timestamp - a.timestamp; });
    }

    return jsonResponse({ ok: true, comments: result });
  } catch (err) {
    Logger.log('getComments error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}
