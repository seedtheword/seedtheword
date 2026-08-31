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
    if (!socialRateOk_(user.name, 'comment')) return jsonResponse({ ok: false, error: 'Slow down — too many comments. Try again in a minute.' });

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
          role: socialRoleOf_(data[i][2]),
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

// ══════════════════════════════════════════════════════════════════════
// POSTS — first-class community posts (the real feed)
// ──────────────────────────────────────────────────────────────────────
// Posts tab columns:
//   A: id          (post id, e.g. "post-<uuid8>")
//   B: timestamp   (epoch ms of creation)
//   C: author      (team member name)
//   D: author_role (member | admin | super_admin — snapshot at post time)
//   E: text        (body, max 5000)
//   F: media_url   (optional image/video URL)
//   G: channel     (main | prayer | thanksgiving | scripture)
//   H: pinned      (YES/'' — super-admin pin to top)
//   I: hidden      (YES/'' — soft-delete / moderated out of public view)
//   J: edited_at   (epoch ms of last edit, '' if never)
// ══════════════════════════════════════════════════════════════════════

var POSTS_TAB = 'Posts';
var POSTS_HEADERS = ['id', 'timestamp', 'author', 'author_role', 'text', 'media_url', 'channel', 'pinned', 'hidden', 'edited_at'];

function getPostsSheet_() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sheet = ss.getSheetByName(POSTS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(POSTS_TAB);
    sheet.getRange(1, 1, 1, POSTS_HEADERS.length).setValues([POSTS_HEADERS]);
    sheet.getRange(1, 1, 1, POSTS_HEADERS.length).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(5, 360);
  }
  return sheet;
}

function socialNewId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function socialIsSuper_(user) {
  return user && String(user.role || '').toLowerCase() === 'super_admin';
}

// Look up a member's current role by name (for enriching comment authors).
var _socialRoleCache = null;
function socialRoleOf_(name) {
  if (!name) return 'member';
  if (!_socialRoleCache) {
    _socialRoleCache = {};
    try {
      var sh = getTeamSheet_();
      if (sh.getLastRow() >= 2) {
        var d = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
        for (var i = 0; i < d.length; i++) {
          _socialRoleCache[String(d[i][1]).toLowerCase().trim()] = String(d[i][5] || 'member').toLowerCase();
        }
      }
    } catch (e) {}
  }
  return _socialRoleCache[String(name).toLowerCase().trim()] || 'member';
}

// Simple per-user rate limit for create actions (posts/comments).
// Uses the script cache: max N writes per rolling window.
function socialRateOk_(userName, kind) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'social_rate_' + kind + '_' + String(userName).toLowerCase().replace(/[^a-z0-9]/g, '');
    var n = parseInt(cache.get(key) || '0', 10);
    if (n >= 12) return false;           // max 12 creates per window
    cache.put(key, String(n + 1), 60);   // 60-second rolling window
    return true;
  } catch (e) { return true; }           // fail open — never block on cache error
}

// ── ACTION: createPost ────────────────────────────────────────────────
// { action:'createPost', token, text, media_url?, channel? }
function handleCreatePost_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    if (!socialRateOk_(user.name, 'post')) return jsonResponse({ ok: false, error: 'Slow down — too many posts. Try again in a minute.' });

    var text = String(payload.text || '').trim();
    var media = String(payload.media_url || '').trim();
    if (!text && !media) return jsonResponse({ ok: false, error: 'Post is empty' });
    if (text.length > 5000) return jsonResponse({ ok: false, error: 'Post too long (max 5000)' });

    var channel = String(payload.channel || 'main').trim() || 'main';
    var id = socialNewId_('post');
    var ts = Date.now();
    var role = String(user.role || 'member').toLowerCase();

    getPostsSheet_().appendRow([id, ts, user.name, role, text, media, channel, '', '', '']);

    // Optional relay to the Telegram Prayer & Thanksgiving topic (thread 21),
    // mirroring the old sendChatMessage behavior. Only for prayer/thanksgiving
    // when the poster opted in. Requires sendTelegramFromAppsScript_ (team-messaging-handlers.gs).
    if ((payload.share_telegram === true || payload.share_telegram === 'true') &&
        (channel === 'prayer' || channel === 'thanksgiving') &&
        typeof sendTelegramFromAppsScript_ === 'function') {
      try {
        var emoji = channel === 'prayer' ? '🙏' : '🎉';
        var label = channel === 'prayer' ? 'Prayer Request' : 'Thanksgiving';
        sendTelegramFromAppsScript_('@seedtheword', emoji + ' <b>' + label + ' from ' + user.name + '</b>\n\n' + text, 21);
      } catch (e) {}
    }

    return jsonResponse({
      ok: true,
      post: {
        id: id, timestamp: ts, author: user.name, author_role: role,
        text: text, media_url: media, channel: channel, pinned: false, hidden: false,
        likeCount: 0, userLiked: false, commentCount: 0
      }
    });
  } catch (err) {
    Logger.log('createPost error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ── ACTION: getFeed ───────────────────────────────────────────────────
// { action:'getFeed', token?|passphrase_hash:'public-read', channel?, limit?, before? }
// Returns posts (newest first, pinned first) with like/comment counts +
// the caller's like state. Hidden posts are excluded for the public and
// shown (flagged) only to super-admins.
function handleGetFeed_(payload) {
  try {
    var auth = validateAdminOrPublicOrToken_(payload);
    if (!auth) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var viewer = auth.user ? auth.user.name : null;
    var viewerIsSuper = socialIsSuper_(auth.user);

    var channel = String(payload.channel || '').trim(); // '' = all channels
    var limit = Math.min(parseInt(payload.limit, 10) || 50, 100);

    var psheet = getPostsSheet_();
    var plast = psheet.getLastRow();
    var posts = [];
    if (plast >= 2) {
      var pdata = psheet.getRange(2, 1, plast - 1, POSTS_HEADERS.length).getValues();
      for (var i = 0; i < pdata.length; i++) {
        var r = pdata[i];
        var id = String(r[0] || '');
        if (!id) continue;
        var hidden = String(r[8]).toUpperCase() === 'YES';
        if (hidden && !viewerIsSuper) continue;
        if (channel && String(r[6]) !== channel) continue;
        posts.push({
          id: id, timestamp: Number(r[1]) || 0, author: String(r[2] || ''),
          author_role: String(r[3] || 'member').toLowerCase(), text: String(r[4] || ''),
          media_url: String(r[5] || ''), channel: String(r[6] || 'main'),
          pinned: String(r[7]).toUpperCase() === 'YES', hidden: hidden,
          edited: !!r[9]
        });
      }
    }

    // Aggregate likes + comment counts from the Social tab in one pass.
    var likeCounts = {}, likedByViewer = {}, commentCounts = {};
    var ssheet = getSocialSheet_();
    var slast = ssheet.getLastRow();
    if (slast >= 2) {
      var sdata = ssheet.getRange(2, 1, slast - 1, 3).getValues(); // type, postId, userId
      for (var s = 0; s < sdata.length; s++) {
        var t = sdata[s][0], pid = sdata[s][1], uid = sdata[s][2];
        if (t === 'like') {
          likeCounts[pid] = (likeCounts[pid] || 0) + 1;
          if (viewer && uid === viewer) likedByViewer[pid] = true;
        } else if (t === 'comment' || t === 'reply') {
          commentCounts[pid] = (commentCounts[pid] || 0) + 1;
        }
      }
    }
    for (var j = 0; j < posts.length; j++) {
      var pid2 = posts[j].id;
      posts[j].likeCount = likeCounts[pid2] || 0;
      posts[j].userLiked = !!likedByViewer[pid2];
      posts[j].commentCount = commentCounts[pid2] || 0;
    }

    // Sort: pinned first, then newest.
    posts.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.timestamp - a.timestamp;
    });
    if (posts.length > limit) posts = posts.slice(0, limit);

    return jsonResponse({ ok: true, posts: posts, viewerIsSuper: viewerIsSuper });
  } catch (err) {
    Logger.log('getFeed error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// Find a post's row by id; returns row index (1-based) or -1.
function socialFindPostRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

// ── ACTION: editPost ──────────────────────────────────────────────────
// { action:'editPost', token, id, text?, media_url? }  — author only
function handleEditPost_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var id = String(payload.id || '').trim();
    if (!id) return jsonResponse({ ok: false, error: 'Missing id' });

    var sheet = getPostsSheet_();
    var row = socialFindPostRow_(sheet, id);
    if (row < 0) return jsonResponse({ ok: false, error: 'Not found' });

    var vals = sheet.getRange(row, 1, 1, POSTS_HEADERS.length).getValues()[0];
    var isAuthor = String(vals[2]).toLowerCase().trim() === String(user.name).toLowerCase().trim();
    if (!isAuthor && !socialIsSuper_(user)) return jsonResponse({ ok: false, error: 'Not your post' });

    var text = String(payload.text != null ? payload.text : vals[4]).trim();
    if (text.length > 5000) return jsonResponse({ ok: false, error: 'Post too long (max 5000)' });
    var media = String(payload.media_url != null ? payload.media_url : vals[5]).trim();

    sheet.getRange(row, 5).setValue(text);       // text
    sheet.getRange(row, 6).setValue(media);      // media_url
    sheet.getRange(row, 10).setValue(Date.now()); // edited_at
    return jsonResponse({ ok: true });
  } catch (err) {
    Logger.log('editPost error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ── ACTION: deletePost ────────────────────────────────────────────────
// { action:'deletePost', token, id }  — author or super-admin
function handleDeletePost_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var id = String(payload.id || '').trim();
    if (!id) return jsonResponse({ ok: false, error: 'Missing id' });

    var sheet = getPostsSheet_();
    var row = socialFindPostRow_(sheet, id);
    if (row < 0) return jsonResponse({ ok: false, error: 'Not found' });

    var author = String(sheet.getRange(row, 3).getValue()).toLowerCase().trim();
    var isAuthor = author === String(user.name).toLowerCase().trim();
    if (!isAuthor && !socialIsSuper_(user)) return jsonResponse({ ok: false, error: 'Not allowed' });

    sheet.deleteRow(row);
    return jsonResponse({ ok: true });
  } catch (err) {
    Logger.log('deletePost error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ── ACTION: moderatePost ──────────────────────────────────────────────
// { action:'moderatePost', token, id, op }  op = hide | unhide | pin | unpin
// Super-admin only.
function handleModeratePost_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!socialIsSuper_(user)) return jsonResponse({ ok: false, error: 'Super-admin only' });
    var id = String(payload.id || '').trim();
    var op = String(payload.op || '').trim();
    if (!id || !op) return jsonResponse({ ok: false, error: 'Missing id/op' });

    var sheet = getPostsSheet_();
    var row = socialFindPostRow_(sheet, id);
    if (row < 0) return jsonResponse({ ok: false, error: 'Not found' });

    if (op === 'hide') sheet.getRange(row, 9).setValue('YES');
    else if (op === 'unhide') sheet.getRange(row, 9).setValue('');
    else if (op === 'pin') sheet.getRange(row, 8).setValue('YES');
    else if (op === 'unpin') sheet.getRange(row, 8).setValue('');
    else return jsonResponse({ ok: false, error: 'Unknown op' });

    return jsonResponse({ ok: true });
  } catch (err) {
    Logger.log('moderatePost error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}

// ── ACTION: deleteComment ─────────────────────────────────────────────
// { action:'deleteComment', token, commentId }  — author or super-admin
// commentId is the comment's timestamp id (column D of the Social tab).
function handleDeleteComment_(payload) {
  try {
    var user = validateTeamToken_(String(payload.token || ''));
    if (!user) return jsonResponse({ ok: false, error: 'Unauthorized' });
    var commentId = String(payload.commentId || '').trim();
    if (!commentId) return jsonResponse({ ok: false, error: 'Missing commentId' });

    var sheet = getSocialSheet_();
    var last = sheet.getLastRow();
    if (last < 2) return jsonResponse({ ok: false, error: 'Not found' });
    var data = sheet.getRange(2, 1, last - 1, 7).getValues();
    var isSuper = socialIsSuper_(user);

    // Delete the comment/reply plus any replies whose parentId == commentId.
    // Collect target rows, delete bottom-up to keep indices valid.
    var rowsToDelete = [];
    for (var i = 0; i < data.length; i++) {
      var type = data[i][0], author = String(data[i][2]).toLowerCase().trim();
      var tsId = String(data[i][3]), parentId = String(data[i][5]);
      if ((type === 'comment' || type === 'reply') && tsId === commentId) {
        if (author !== String(user.name).toLowerCase().trim() && !isSuper) {
          return jsonResponse({ ok: false, error: 'Not allowed' });
        }
        rowsToDelete.push(i + 2);
      } else if (type === 'reply' && parentId === commentId) {
        rowsToDelete.push(i + 2); // orphaned reply to a deleted comment
      }
    }
    if (!rowsToDelete.length) return jsonResponse({ ok: false, error: 'Not found' });
    rowsToDelete.sort(function (a, b) { return b - a; });
    for (var d = 0; d < rowsToDelete.length; d++) sheet.deleteRow(rowsToDelete[d]);
    return jsonResponse({ ok: true });
  } catch (err) {
    Logger.log('deleteComment error: ' + err);
    return jsonResponse({ ok: false, error: 'Server error' });
  }
}
