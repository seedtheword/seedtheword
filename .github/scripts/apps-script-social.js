/**
 * ═══════════════════════════════════════════════════════════════
 * COMMUNITY SOCIAL — Likes, Comments & Replies
 * 
 * Add this code to your existing Google Apps Script web app.
 * It adds 4 new actions: toggleLike, getLikes, postComment, getComments
 * 
 * Data is stored in a "Social" sheet with columns:
 *   A: type (like | comment | reply)
 *   B: postId (identifier for the parent post, e.g. "p-1723456789000-David")
 *   C: userId (user name from session)
 *   D: timestamp (epoch ms)
 *   E: text (comment/reply body, empty for likes)
 *   F: parentCommentId (for replies only — the timestamp of the parent comment)
 *   G: channel (main | prayer | thanksgiving | scripture)
 * 
 * SETUP: Create a sheet tab called "Social" in your spreadsheet
 * with headers: type | postId | userId | timestamp | text | parentCommentId | channel
 * ═══════════════════════════════════════════════════════════════
 */

// ── Add these cases inside your existing doPost switch/if-else block ──

/**
 * case 'toggleLike':
 *   Toggles a like on/off for a user on a specific post.
 *   Request: { action: 'toggleLike', token: string, postId: string }
 *   Response: { ok: true, liked: boolean, likeCount: number }
 */
function handleToggleLike(data, userSession) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Social');
  if (!sheet) {
    sheet = ss.insertSheet('Social');
    sheet.appendRow(['type', 'postId', 'userId', 'timestamp', 'text', 'parentCommentId', 'channel']);
  }
  
  var postId = data.postId;
  var userId = userSession.name;
  if (!postId || !userId) return { ok: false, error: 'Missing postId or user' };
  
  // Check if user already liked this post
  var allData = sheet.getDataRange().getValues();
  var existingRow = -1;
  var likeCount = 0;
  
  for (var i = 1; i < allData.length; i++) {
    if (allData[i][0] === 'like' && allData[i][1] === postId) {
      likeCount++;
      if (allData[i][2] === userId) {
        existingRow = i + 1; // 1-indexed for sheet
      }
    }
  }
  
  if (existingRow > 0) {
    // Unlike — remove the row
    sheet.deleteRow(existingRow);
    return { ok: true, liked: false, likeCount: likeCount - 1 };
  } else {
    // Like — add row
    sheet.appendRow(['like', postId, userId, Date.now(), '', '', data.channel || '']);
    return { ok: true, liked: true, likeCount: likeCount + 1 };
  }
}

/**
 * case 'getLikes':
 *   Gets like counts and user's like status for a list of post IDs.
 *   Request: { action: 'getLikes', token?: string, passphrase_hash?: 'public-read', postIds: string[] }
 *   Response: { ok: true, likes: { [postId]: { count: number, userLiked: boolean } } }
 */
function handleGetLikes(data, userSession) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Social');
  if (!sheet) return { ok: true, likes: {} };
  
  var postIds = data.postIds || [];
  if (!postIds.length) return { ok: true, likes: {} };
  
  var userId = userSession ? userSession.name : null;
  var allData = sheet.getDataRange().getValues();
  var result = {};
  
  // Initialize
  for (var p = 0; p < postIds.length; p++) {
    result[postIds[p]] = { count: 0, userLiked: false };
  }
  
  // Count likes
  for (var i = 1; i < allData.length; i++) {
    if (allData[i][0] === 'like') {
      var pid = allData[i][1];
      if (result[pid] !== undefined) {
        result[pid].count++;
        if (userId && allData[i][2] === userId) {
          result[pid].userLiked = true;
        }
      }
    }
  }
  
  return { ok: true, likes: result };
}

/**
 * case 'postComment':
 *   Posts a comment or reply on a post.
 *   Request: { action: 'postComment', token: string, postId: string, text: string, parentCommentId?: string, channel?: string }
 *   Response: { ok: true, comment: { id, userId, text, timestamp, parentCommentId } }
 */
function handlePostComment(data, userSession) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Social');
  if (!sheet) {
    sheet = ss.insertSheet('Social');
    sheet.appendRow(['type', 'postId', 'userId', 'timestamp', 'text', 'parentCommentId', 'channel']);
  }
  
  var postId = data.postId;
  var userId = userSession.name;
  var text = (data.text || '').trim();
  var parentId = data.parentCommentId || '';
  var channel = data.channel || '';
  
  if (!postId || !userId || !text) return { ok: false, error: 'Missing required fields' };
  if (text.length > 2000) return { ok: false, error: 'Comment too long (max 2000 chars)' };
  
  var type = parentId ? 'reply' : 'comment';
  var timestamp = Date.now();
  
  sheet.appendRow([type, postId, userId, timestamp, text, parentId, channel]);
  
  return {
    ok: true,
    comment: {
      id: String(timestamp),
      userId: userId,
      text: text,
      timestamp: timestamp,
      parentCommentId: parentId
    }
  };
}

/**
 * case 'getComments':
 *   Gets all comments and replies for a list of post IDs.
 *   Request: { action: 'getComments', token?: string, passphrase_hash?: 'public-read', postIds: string[] }
 *   Response: { ok: true, comments: { [postId]: [ { id, userId, text, timestamp, parentCommentId, replies: [...] } ] } }
 */
function handleGetComments(data, userSession) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Social');
  if (!sheet) return { ok: true, comments: {} };
  
  var postIds = data.postIds || [];
  if (!postIds.length) return { ok: true, comments: {} };
  
  var allData = sheet.getDataRange().getValues();
  var result = {};
  
  // Initialize
  for (var p = 0; p < postIds.length; p++) {
    result[postIds[p]] = [];
  }
  
  // Collect comments and replies
  var repliesMap = {}; // parentCommentId -> [replies]
  
  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var type = row[0];
    var pid = row[1];
    
    if ((type === 'comment' || type === 'reply') && result[pid] !== undefined) {
      var entry = {
        id: String(row[3]),
        userId: row[2],
        text: row[4],
        timestamp: row[3],
        parentCommentId: row[5] || null
      };
      
      if (type === 'reply' && entry.parentCommentId) {
        if (!repliesMap[entry.parentCommentId]) repliesMap[entry.parentCommentId] = [];
        repliesMap[entry.parentCommentId].push(entry);
      } else {
        entry.replies = [];
        result[pid].push(entry);
      }
    }
  }
  
  // Attach replies to their parent comments
  for (var postId in result) {
    var comments = result[postId];
    for (var c = 0; c < comments.length; c++) {
      var commentId = comments[c].id;
      if (repliesMap[commentId]) {
        comments[c].replies = repliesMap[commentId].sort(function(a, b) { return a.timestamp - b.timestamp; });
      }
    }
    // Sort comments newest first
    result[postId] = comments.sort(function(a, b) { return b.timestamp - a.timestamp; });
  }
  
  return { ok: true, comments: result };
}


/**
 * ═══════════════════════════════════════════════════════════════
 * INTEGRATION: Add to your doPost(e) function's action router
 * ═══════════════════════════════════════════════════════════════
 * 
 * In your existing doPost handler, add these cases:
 * 
 *   case 'toggleLike':
 *     var session = validateToken(data.token);
 *     if (!session) return jsonResponse({ ok: false, error: 'Auth required' });
 *     return jsonResponse(handleToggleLike(data, session));
 * 
 *   case 'getLikes':
 *     var session = data.token ? validateToken(data.token) : null;
 *     return jsonResponse(handleGetLikes(data, session));
 * 
 *   case 'postComment':
 *     var session = validateToken(data.token);
 *     if (!session) return jsonResponse({ ok: false, error: 'Auth required' });
 *     return jsonResponse(handlePostComment(data, session));
 * 
 *   case 'getComments':
 *     var session = data.token ? validateToken(data.token) : null;
 *     return jsonResponse(handleGetComments(data, session));
 * 
 * ═══════════════════════════════════════════════════════════════
 * 
 * SHEET SETUP:
 * 1. Open your Google Spreadsheet
 * 2. Create a new tab called "Social"
 * 3. Add headers in row 1: type | postId | userId | timestamp | text | parentCommentId | channel
 * 4. Deploy the updated Apps Script
 * 
 * ═══════════════════════════════════════════════════════════════
 */
