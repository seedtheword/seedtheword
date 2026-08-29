/**
 * Seed the Word — Content Handler (super-admin CMS for the news page)
 * ────────────────────────────────────────────────────────────────
 * Sheet-backed publishing for OUTREACH STORIES and TESTIMONIES so
 * super-admins can add/edit/publish content that the news page reads
 * LIVE (like announcements), without editing repo JSON files.
 *
 * Paste into the STW Order Handler web-app project (same one as
 * order-handler.gs). Add these routes to doPost() in order-handler.gs:
 *   if ((payload && payload.action) === 'listOutreachStories') return handleListOutreachStories_(payload);
 *   if ((payload && payload.action) === 'saveOutreachStory')  return handleSaveOutreachStory_(payload);
 *   if ((payload && payload.action) === 'deleteOutreachStory')return handleDeleteOutreachStory_(payload);
 *   if ((payload && payload.action) === 'listTestimonies')    return handleListTestimonies_(payload);
 *   if ((payload && payload.action) === 'saveTestimony')      return handleSaveTestimony_(payload);
 *   if ((payload && payload.action) === 'deleteTestimony')    return handleDeleteTestimony_(payload);
 * And this to doGet() (public, read-only, cached):
 *   if (action === 'getPublishedContent') return jsonResponse(getPublishedContent_());
 *
 * Run stwContentSetup() ONCE to create the two tabs with headers.
 *
 * Tabs (on the STW Order Ledger spreadsheet):
 *   OutreachStories: id | published | date | title | location | body | image_url | sort_order | updated_by | updated_at
 *   Testimonies:     id | published | name | anonymous | published_at | excerpt | body | media_url | anchor_verse | updated_by | updated_at
 */

var OUTREACH_TAB = 'OutreachStories';
var TESTIMONY_TAB = 'Testimonies';
var OUTREACH_HEADERS = ['id','published','date','title','location','body','image_url','sort_order','updated_by','updated_at'];
var TESTIMONY_HEADERS = ['id','published','name','anonymous','published_at','excerpt','body','media_url','anchor_verse','updated_by','updated_at'];

// ── One-time setup: create the content tabs ──────────────────────
function stwContentSetup() {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  [{ n: OUTREACH_TAB, h: OUTREACH_HEADERS }, { n: TESTIMONY_TAB, h: TESTIMONY_HEADERS }].forEach(function (t) {
    var sh = ss.getSheetByName(t.n);
    if (!sh) {
      sh = ss.insertSheet(t.n);
      sh.appendRow(t.h);
      sh.getRange(1, 1, 1, t.h.length).setFontWeight('bold').setBackground('#2C5F2E').setFontColor('#fff');
      sh.setFrozenRows(1);
    }
  });
  try { SpreadsheetApp.getUi().alert('Content tabs ready: ' + OUTREACH_TAB + ', ' + TESTIMONY_TAB); } catch (e) {}
  return 'ok';
}

// ── Helpers ──────────────────────────────────────────────────────
function contentRequireSuperAdmin_(payload) {
  var member = validateTeamToken_(String((payload && payload.token) || ''));
  if (!member) return { err: 'Invalid session' };
  var role = String(member.role || '').toLowerCase();
  if (role !== 'super_admin') return { err: 'Super-admin only' };
  return { member: member };
}

function contentSheet_(name, headers) {
  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}

function contentRowsToObjects_(sheet, headers) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var vals = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return vals.map(function (row, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, c) { o[h] = row[c]; });
    return o;
  }).filter(function (o) { return String(o.id || '').trim(); });
}

function contentNewId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

// ── Outreach stories ─────────────────────────────────────────────
function handleListOutreachStories_(payload) {
  var gate = contentRequireSuperAdmin_(payload);
  if (gate.err) return jsonResponse({ ok: false, error: gate.err });
  var sh = contentSheet_(OUTREACH_TAB, OUTREACH_HEADERS);
  return jsonResponse({ ok: true, stories: contentRowsToObjects_(sh, OUTREACH_HEADERS) });
}

function handleSaveOutreachStory_(payload) {
  var gate = contentRequireSuperAdmin_(payload);
  if (gate.err) return jsonResponse({ ok: false, error: gate.err });
  var s = payload.story || {};
  var sh = contentSheet_(OUTREACH_TAB, OUTREACH_HEADERS);
  var now = new Date().toISOString();
  var id = String(s.id || '').trim() || contentNewId_('out');

  var rowValues = [
    id,
    (s.published === true || s.published === 'YES') ? 'YES' : 'no',
    String(s.date || ''),
    String(s.title || ''),
    String(s.location || ''),
    String(s.body || ''),
    String(s.image_url || ''),
    (parseInt(s.sort_order, 10) || 0),
    gate.member.name,
    now
  ];

  // Update existing row by id, else append.
  var existing = contentRowsToObjects_(sh, OUTREACH_HEADERS).filter(function (o) { return String(o.id) === id; })[0];
  if (existing) sh.getRange(existing._row, 1, 1, OUTREACH_HEADERS.length).setValues([rowValues]);
  else sh.appendRow(rowValues);

  flushContentCache_();
  return jsonResponse({ ok: true, id: id });
}

function handleDeleteOutreachStory_(payload) {
  var gate = contentRequireSuperAdmin_(payload);
  if (gate.err) return jsonResponse({ ok: false, error: gate.err });
  var id = String(payload.id || '').trim();
  var sh = contentSheet_(OUTREACH_TAB, OUTREACH_HEADERS);
  var found = contentRowsToObjects_(sh, OUTREACH_HEADERS).filter(function (o) { return String(o.id) === id; })[0];
  if (found) { sh.deleteRow(found._row); flushContentCache_(); return jsonResponse({ ok: true }); }
  return jsonResponse({ ok: false, error: 'Not found' });
}

// ── Testimonies ──────────────────────────────────────────────────
function handleListTestimonies_(payload) {
  var gate = contentRequireSuperAdmin_(payload);
  if (gate.err) return jsonResponse({ ok: false, error: gate.err });
  var sh = contentSheet_(TESTIMONY_TAB, TESTIMONY_HEADERS);
  return jsonResponse({ ok: true, testimonies: contentRowsToObjects_(sh, TESTIMONY_HEADERS) });
}

function handleSaveTestimony_(payload) {
  var gate = contentRequireSuperAdmin_(payload);
  if (gate.err) return jsonResponse({ ok: false, error: gate.err });
  var t = payload.testimony || {};
  var sh = contentSheet_(TESTIMONY_TAB, TESTIMONY_HEADERS);
  var now = new Date().toISOString();
  var id = String(t.id || '').trim() || contentNewId_('tst');
  var published = (t.published === true || t.published === 'YES');

  var rowValues = [
    id,
    published ? 'YES' : 'no',
    String(t.name || ''),
    (t.anonymous === true || t.anonymous === 'YES') ? 'YES' : 'no',
    published ? (String(t.published_at || '') || now.slice(0, 10)) : '',
    String(t.excerpt || ''),
    String(t.body || ''),
    String(t.media_url || ''),
    String(t.anchor_verse || ''),
    gate.member.name,
    now
  ];

  var existing = contentRowsToObjects_(sh, TESTIMONY_HEADERS).filter(function (o) { return String(o.id) === id; })[0];
  if (existing) sh.getRange(existing._row, 1, 1, TESTIMONY_HEADERS.length).setValues([rowValues]);
  else sh.appendRow(rowValues);

  flushContentCache_();
  return jsonResponse({ ok: true, id: id });
}

function handleDeleteTestimony_(payload) {
  var gate = contentRequireSuperAdmin_(payload);
  if (gate.err) return jsonResponse({ ok: false, error: gate.err });
  var id = String(payload.id || '').trim();
  var sh = contentSheet_(TESTIMONY_TAB, TESTIMONY_HEADERS);
  var found = contentRowsToObjects_(sh, TESTIMONY_HEADERS).filter(function (o) { return String(o.id) === id; })[0];
  if (found) { sh.deleteRow(found._row); flushContentCache_(); return jsonResponse({ ok: true }); }
  return jsonResponse({ ok: false, error: 'Not found' });
}

// ── Public read (news page) — only PUBLISHED items, cached 3 min ──
function getPublishedContent_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('stw_pub_content_v1');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  var out = { ok: true, stories: [], testimonies: [] };

  var os = ss.getSheetByName(OUTREACH_TAB);
  if (os) {
    contentRowsToObjects_(os, OUTREACH_HEADERS)
      .filter(function (o) { return String(o.published).toUpperCase() === 'YES'; })
      .sort(function (a, b) { return (parseInt(a.sort_order, 10) || 0) - (parseInt(b.sort_order, 10) || 0); })
      .forEach(function (o) {
        out.stories.push({
          id: String(o.id), date: String(o.date || ''), title: String(o.title || ''),
          location: String(o.location || ''), body: String(o.body || ''), image: String(o.image_url || '')
        });
      });
  }

  var ts = ss.getSheetByName(TESTIMONY_TAB);
  if (ts) {
    contentRowsToObjects_(ts, TESTIMONY_HEADERS)
      .filter(function (o) { return String(o.published).toUpperCase() === 'YES'; })
      .sort(function (a, b) { return String(b.published_at || '').localeCompare(String(a.published_at || '')); })
      .forEach(function (o) {
        var anon = String(o.anonymous).toUpperCase() === 'YES';
        out.testimonies.push({
          id: String(o.id), name: anon ? 'Anonymous' : String(o.name || ''), anonymous: anon,
          publishedAt: String(o.published_at || ''), excerpt: String(o.excerpt || ''),
          body: String(o.body || ''), mediaUrl: String(o.media_url || ''), anchorVerse: String(o.anchor_verse || '')
        });
      });
  }

  try { cache.put('stw_pub_content_v1', JSON.stringify(out), 180); } catch (e) {}
  return out;
}

function flushContentCache_() {
  try { CacheService.getScriptCache().remove('stw_pub_content_v1'); } catch (e) {}
}
