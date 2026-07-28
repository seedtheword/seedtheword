/**
 * Seed the Word — Admin Dashboard (Google Apps Script)
 * ──────────────────────────────────────────────────────
 * Container-bound script — paste into the script editor opened from
 * Extensions → Apps Script inside the STW Order Ledger spreadsheet.
 *
 * STW Admin menu provides:
 *   1. MinistryStats auto-formula updater (SUMIFS from Inventory)
 *   2. Log Placement Record — multi-scripture sidebar form
 *      → writes one PlacementRecords event row + one Inventory "out"
 *        row per scripture type, all sharing the same placement_id
 *   3. Generate Placement PDF — by placement ID or date range
 *      → pulls all Inventory rows with matching order_id
 *   4. Log Finance Entry — income/expense sidebar form
 *   5. View Dashboard — live summary sidebar
 */

// ── Tab / header constants ────────────────────────────────────────
const PLACEMENT_TAB     = 'PlacementRecords';
const FINANCES_TAB      = 'Finances';
const TEAM_EMAIL        = 'seedthewordministry@gmail.com';

// PlacementRecords: one row = one outreach EVENT (not per scripture type)
// Scripture lines live in Inventory with matching order_id = placement_id
const PLACEMENT_HEADERS = [
  'placement_id', 'date_assigned', 'date_placed', 'team_member',
  'institution', 'address', 'official_name', 'contact_phone',
  'contact_email', 'num_rooms_students', 'event_source',
  'total_qty_placed', 'notes'
];

const FINANCES_HEADERS = [
  'date', 'type', 'category', 'description',
  'amount', 'payment_method', 'reference', 'recorded_by', 'notes'
];

// Scripture type → item_id map (mirrors inventory)
const SCRIPTURE_ITEM_MAP = {
  'Pocket NT (English — Red)':          'pocket-nt-red',
  'Pocket NT (English — Grey)':         'pocket-nt-grey',
  'Large Print NT (English — Brown)':   'large-print-nt-brown',
  'Large Print NT (English — Camouflage)': 'large-print-nt-camo',
  'Full Bible (Large Print)':           'full-bible-large-print',
  'Full Bible (Pocket)':                'full-bible-pocket',
  'Pocket NT (Hindi)':                  'pocket-nt-hindi-blue',
  'Large Print NT (Russian)':           'large-print-nt-russian',
  'Large Print NT (Ukrainian)':         'large-print-nt-ukrainian',
  'Pocket NT (Farsi)':                  'pocket-nt-farsi-blue',
  'Large Print NT (Urdu)':              'large-print-nt-urdu-blue',
  'Pocket NT (Thai/English)':           'pocket-nt-thai-english-blue',
  'Pocket NT (Mandarin)':               'pocket-nt-mandarin',
  'Large Print NT (Spanish/English)':   'large-print-nt-spanish-english',
  'Large Print NT (Arabic/English)':    'large-print-nt-arabic-english',
  'Pocket NT (Arabic)':                 'pocket-nt-arabic',
  'Pocket NT (French)':                 'pocket-nt-french',
  'Bookmarks':                          'bookmarks',
  'Tracts (Mixed)':                     'tracts-mixed',
};

// ── Menu ─────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STW Admin')
    .addItem('📊 Refresh MinistryStats formulas', 'refreshMinistryStatsFormulas')
    .addSeparator()
    .addItem('📋 Log Placement Record', 'showPlacementForm')
    .addItem('📄 Generate Placement PDF', 'showPdfForm')
    .addSeparator()
    .addItem('💰 Log Finance Entry', 'showFinanceForm')
    .addSeparator()
    .addItem('📈 View Dashboard', 'showDashboard')
    .addToUi();
}

// ── 1. MinistryStats formula refresh ─────────────────────────────
function refreshMinistryStatsFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName('Inventory');
  if (!invSheet) { SpreadsheetApp.getUi().alert('Inventory tab not found.'); return; }

  var statsSheet = ensureTab_(ss, 'MinistryStats', ['key','value','note']);
  var lastRow = statsSheet.getLastRow();
  var writeRow = lastRow + 2;

  statsSheet.getRange(writeRow, 1, 1, 4).setValues([['--- AUTO-COMPUTED FROM INVENTORY ---','','','Refreshed: ' + new Date().toLocaleString()]]);
  statsSheet.getRange(writeRow, 1, 1, 4).setFontWeight('bold').setBackground('#f5f3f0');
  writeRow++;

  statsSheet.getRange(writeRow, 1, 1, 4).setValues([['item_id','donated_total (out)','received_total (in)','net_available']]);
  statsSheet.getRange(writeRow, 1, 1, 4).setFontWeight('bold').setBackground('#E8E4DF');
  writeRow++;

  var invData = invSheet.getDataRange().getValues();
  var itemIds = {};
  for (var i = 1; i < invData.length; i++) {
    var id = String(invData[i][2] || '').trim();
    if (id) itemIds[id] = true;
  }
  var ids = Object.keys(itemIds).sort();
  if (!ids.length) { SpreadsheetApp.getUi().alert('No item_ids in Inventory yet.'); return; }

  for (var r = 0; r < ids.length; r++) {
    var itemId = ids[r];
    var esc = itemId.replace(/"/g, '""');
    var tr = writeRow + r;
    statsSheet.getRange(tr, 1).setValue(itemId);
    statsSheet.getRange(tr, 2).setFormula('=SUMIFS(Inventory!E:E,Inventory!C:C,"' + esc + '",Inventory!F:F,"out")');
    statsSheet.getRange(tr, 3).setFormula('=SUMIFS(Inventory!E:E,Inventory!C:C,"' + esc + '",Inventory!F:F,"in")');
    statsSheet.getRange(tr, 4).setFormula('=C' + tr + '-B' + tr);
  }

  var sumRow = writeRow + ids.length + 2;
  statsSheet.getRange(sumRow, 1, 1, 4).setValues([['--- LANGUAGE SUMMARY ---','','','']]);
  statsSheet.getRange(sumRow, 1, 1, 4).setFontWeight('bold').setBackground('#f5f3f0');
  sumRow++;
  statsSheet.getRange(sumRow, 1, 1, 4).setValues([['language','donated_total','received_total','net_available']]);
  statsSheet.getRange(sumRow, 1, 1, 4).setFontWeight('bold').setBackground('#E8E4DF');
  sumRow++;

  var langIdMap = {
    'English':   ['pocket-nt-red','pocket-nt-grey','large-print-nt-brown','large-print-nt-camo','full-bible-large-print','full-bible-pocket'],
    'Hindi':     ['pocket-nt-hindi-blue'],
    'Russian':   ['large-print-nt-russian'],
    'Ukrainian': ['large-print-nt-ukrainian'],
    'Farsi':     ['pocket-nt-farsi-blue'],
    'Urdu':      ['large-print-nt-urdu-blue'],
    'Thai':      ['pocket-nt-thai-english-blue'],
    'Mandarin':  ['pocket-nt-mandarin'],
    'Spanish':   ['large-print-nt-spanish-english'],
    'Arabic':    ['large-print-nt-arabic-english','pocket-nt-arabic'],
    'French':    ['pocket-nt-french']
  };

  Object.keys(langIdMap).forEach(function(lang) {
    var lids = langIdMap[lang];
    var out = lids.map(function(x){ return 'SUMIFS(Inventory!E:E,Inventory!C:C,"'+x+'",Inventory!F:F,"out")'; });
    var inp = lids.map(function(x){ return 'SUMIFS(Inventory!E:E,Inventory!C:C,"'+x+'",Inventory!F:F,"in")'; });
    statsSheet.getRange(sumRow, 1).setValue(lang);
    statsSheet.getRange(sumRow, 2).setFormula('=' + out.join('+'));
    statsSheet.getRange(sumRow, 3).setFormula('=' + inp.join('+'));
    statsSheet.getRange(sumRow, 4).setFormula('=C' + sumRow + '-B' + sumRow);
    sumRow++;
  });

  SpreadsheetApp.getUi().alert('✅ MinistryStats formulas refreshed! Check the bottom of the MinistryStats sheet.');
}

// ── 2. Placement Record — multi-scripture form ────────────────────
function showPlacementForm() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(PLACEMENT_FORM_HTML)
      .setTitle('Log Placement Record').setWidth(500)
  );
}

/**
 * data = {
 *   event: { institution, address, official_name, contact_phone,
 *             contact_email, num_rooms, date_assigned, date_placed,
 *             team_member, event_source, notes },
 *   scriptures: [{ type, item_id, qty_needed, qty_placed }, ...]
 * }
 * Writes one PlacementRecords row + one Inventory "out" row per scripture.
 */
function submitPlacementRecord(data) {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var ev  = data.event || {};
    var lines = data.scriptures || [];
    if (!lines.length) throw new Error('Add at least one scripture line.');

    var id  = 'PLR-' + new Date().getTime();
    var totalPlaced = lines.reduce(function(s, l) { return s + (parseInt(l.qty_placed, 10) || 0); }, 0);

    // 1. PlacementRecords — one event row
    var plSheet = ensureTab_(ss, PLACEMENT_TAB, PLACEMENT_HEADERS);
    plSheet.appendRow([
      id,
      ev.date_assigned  || '',
      ev.date_placed    || new Date().toISOString().split('T')[0],
      ev.team_member    || '',
      ev.institution    || '',
      ev.address        || '',
      ev.official_name  || '',
      ev.contact_phone  || '',
      ev.contact_email  || '',
      ev.num_rooms      || '',
      ev.event_source   || '',
      totalPlaced,
      ev.notes          || ''
    ]);

    // 2. Inventory — one "out" row per scripture type
    var invSheet = ss.getSheetByName('Inventory') ||
                   ensureTab_(ss, 'Inventory', ['date','type','item_id','item_name','qty','direction','event_source','cost_per_unit','total_cost','notes','order_id']);

    var datePlaced = ev.date_placed || new Date().toISOString().split('T')[0];
    var source     = ev.institution || ev.event_source || '';

    lines.forEach(function(line) {
      var qty  = parseInt(line.qty_placed, 10) || 0;
      var cost = 2; // $2 per Bible (Gideons cost)
      invSheet.appendRow([
        datePlaced,
        'placement',
        line.item_id      || 'placement',
        line.type         || '',
        qty,
        'out',
        source,
        cost,
        qty * cost,
        ev.notes || '',
        id   // order_id = placement_id so PDF can find these rows
      ]);
    });

    return { id: id, totalPlaced: totalPlaced };
  } catch(err) {
    throw new Error('submitPlacementRecord failed: ' + err.toString());
  }
}

// Returns the SCRIPTURE_ITEM_MAP keys so the sidebar can populate its dropdown
function getScriptureTypes() {
  return Object.keys(SCRIPTURE_ITEM_MAP);
}

const PLACEMENT_FORM_HTML = `<!DOCTYPE html>
<html>
<head>
<base target="_top">
<style>
  *{box-sizing:border-box;}
  body{font-family:'Segoe UI',sans-serif;font-size:13px;padding:12px 14px;color:#1a1a1a;background:#fff;}
  h2{font-size:15px;margin:0 0 10px;border-bottom:2px solid #B8860B;padding-bottom:6px;color:#B8860B;}
  h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6B6B6B;margin:14px 0 6px;}
  label{display:block;font-weight:600;margin:8px 0 3px;font-size:12px;}
  input,select,textarea{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:12px;}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#B8860B;box-shadow:0 0 0 2px rgba(184,134,11,0.1);}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .scripture-line{background:#FAFAF8;border:1px solid #E8E4DF;border-radius:6px;padding:10px;margin-bottom:8px;position:relative;}
  .scripture-line select{margin-bottom:6px;}
  .scripture-line .qty-row{display:grid;grid-template-columns:1fr 1fr 30px;gap:6px;align-items:end;}
  .remove-btn{background:none;border:none;color:#c00;font-size:18px;cursor:pointer;padding:0;line-height:1;width:30px;text-align:center;}
  .add-btn{width:100%;padding:8px;background:#f5f3f0;border:1px dashed #B8860B;border-radius:5px;color:#B8860B;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:12px;}
  .add-btn:hover{background:#fdf6e3;}
  .save-btn{display:block;width:100%;padding:11px;background:#B8860B;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;margin-top:4px;}
  .save-btn:hover{background:#9a7009;}
  .save-btn:disabled{opacity:0.6;cursor:not-allowed;}
  #status{text-align:center;margin-top:10px;font-size:12px;min-height:18px;line-height:1.5;}
  .divider{border:none;border-top:1px solid #E8E4DF;margin:12px 0;}
</style>
</head>
<body>
<h2>📋 Log Placement Record</h2>

<h3>📍 Event Details</h3>
<label>Institution / Location *</label>
<input id="institution" placeholder="e.g. Wiggums Hollow Park" required>

<label>Address</label>
<input id="address" placeholder="Street, City, State">

<label>Institution Official / Contact</label>
<input id="official_name" placeholder="Name of person you met">

<div class="row2">
  <div><label>Phone</label><input id="contact_phone" type="tel" placeholder="(555) 123-4567"></div>
  <div><label>Email</label><input id="contact_email" type="email" placeholder="email@org.com"></div>
</div>

<label>Rooms / Students / People</label>
<input id="num_rooms" placeholder="e.g. 200 students, 50 families">

<div class="row2">
  <div><label>Date Assigned</label><input id="date_assigned" type="date"></div>
  <div><label>Date Placed *</label><input id="date_placed" type="date" required></div>
</div>

<div class="row2">
  <div><label>Team Member</label><input id="team_member" placeholder="David Ageyev"></div>
  <div><label>Event Source</label><input id="event_source" placeholder="Community Cookout"></div>
</div>

<label>Notes</label>
<textarea id="notes" rows="2" placeholder="Any additional context..."></textarea>

<hr class="divider">
<h3>📖 Scripture Lines</h3>
<div id="scripture-lines"></div>
<button type="button" class="add-btn" onclick="addLine()">+ Add Scripture Type</button>

<button class="save-btn" id="save-btn" onclick="saveRecord()">Save Placement Record</button>
<div id="status"></div>

<script>
var scriptureTypes = [];
var lineCount = 0;

// Load scripture types from Apps Script
google.script.run
  .withSuccessHandler(function(types) {
    scriptureTypes = types;
    addLine(); // start with one line
  })
  .withFailureHandler(function() {
    // Fallback list if server call fails
    scriptureTypes = [
      'Pocket NT (English — Red)',
      'Pocket NT (English — Grey)',
      'Large Print NT (English — Brown)',
      'Large Print NT (English — Camouflage)',
      'Full Bible (Large Print)',
      'Full Bible (Pocket)',
      'Pocket NT (Hindi)',
      'Large Print NT (Russian)',
      'Large Print NT (Ukrainian)',
      'Pocket NT (Farsi)',
      'Large Print NT (Urdu)',
      'Pocket NT (Thai/English)',
      'Pocket NT (Mandarin)',
      'Large Print NT (Spanish/English)',
      'Large Print NT (Arabic/English)',
      'Pocket NT (Arabic)',
      'Pocket NT (French)',
      'Bookmarks',
      'Tracts (Mixed)'
    ];
    addLine();
  })
  .getScriptureTypes();

// Populate today's date
document.getElementById('date_placed').valueAsDate = new Date();

function buildOptions() {
  return scriptureTypes.map(function(t) {
    return '<option value="' + t + '">' + t + '</option>';
  }).join('');
}

function addLine() {
  lineCount++;
  var id = 'line' + lineCount;
  var div = document.createElement('div');
  div.className = 'scripture-line';
  div.id = id;
  div.innerHTML =
    '<select class="type-sel"><option value="">— Select scripture type —</option>' + buildOptions() + '</select>' +
    '<div class="qty-row">' +
      '<div><label style="margin:0 0 3px;font-size:11px;">Qty Needed</label>' +
        '<input type="number" min="0" value="0" class="qty-needed"></div>' +
      '<div><label style="margin:0 0 3px;font-size:11px;">Qty Placed *</label>' +
        '<input type="number" min="0" value="0" class="qty-placed"></div>' +
      '<button class="remove-btn" onclick="removeLine(\'' + id + '\')" title="Remove">×</button>' +
    '</div>';
  document.getElementById('scripture-lines').appendChild(div);
}

function removeLine(id) {
  var el = document.getElementById(id);
  if (el) el.remove();
}

function saveRecord() {
  var btn = document.getElementById('save-btn');
  var status = document.getElementById('status');

  // Collect scripture lines
  var lines = [];
  var lineEls = document.querySelectorAll('.scripture-line');
  for (var i = 0; i < lineEls.length; i++) {
    var type = lineEls[i].querySelector('.type-sel').value;
    var qtyN = parseInt(lineEls[i].querySelector('.qty-needed').value, 10) || 0;
    var qtyP = parseInt(lineEls[i].querySelector('.qty-placed').value, 10) || 0;
    if (!type) continue;
    lines.push({ type: type, qty_needed: qtyN, qty_placed: qtyP, item_id: '' });
  }

  if (!document.getElementById('institution').value.trim()) {
    status.innerHTML = '<span style="color:#c00">❌ Institution / Location is required.</span>';
    return;
  }
  if (!document.getElementById('date_placed').value) {
    status.innerHTML = '<span style="color:#c00">❌ Date Placed is required.</span>';
    return;
  }
  if (!lines.length) {
    status.innerHTML = '<span style="color:#c00">❌ Add at least one scripture line.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  status.innerHTML = '';

  var payload = {
    event: {
      institution:   document.getElementById('institution').value,
      address:       document.getElementById('address').value,
      official_name: document.getElementById('official_name').value,
      contact_phone: document.getElementById('contact_phone').value,
      contact_email: document.getElementById('contact_email').value,
      num_rooms:     document.getElementById('num_rooms').value,
      date_assigned: document.getElementById('date_assigned').value,
      date_placed:   document.getElementById('date_placed').value,
      team_member:   document.getElementById('team_member').value,
      event_source:  document.getElementById('event_source').value,
      notes:         document.getElementById('notes').value
    },
    scriptures: lines
  };

  google.script.run
    .withSuccessHandler(function(result) {
      status.innerHTML = '<span style="color:#2C5F2E">✅ Saved! ' + result.totalPlaced + ' Bibles logged. ID: ' + result.id + '</span>';
      // Reset event fields
      ['institution','address','official_name','contact_phone','contact_email',
       'num_rooms','date_assigned','team_member','event_source','notes'].forEach(function(f) {
        document.getElementById(f).value = '';
      });
      document.getElementById('date_placed').valueAsDate = new Date();
      // Reset scripture lines to one fresh line
      document.getElementById('scripture-lines').innerHTML = '';
      lineCount = 0;
      addLine();
      btn.disabled = false;
      btn.textContent = 'Save Placement Record';
    })
    .withFailureHandler(function(err) {
      status.innerHTML = '<span style="color:#c00">❌ ' + (err.message || JSON.stringify(err)) + '</span>';
      btn.disabled = false;
      btn.textContent = 'Save Placement Record';
    })
    .submitPlacementRecord(payload);
}
</script>
</body>
</html>`;

// ── 3. PDF Generator ─────────────────────────────────────────────
// Shows a sidebar where you can pick a placement_id OR a date range,
// then generates a PDF matching the Gideons Item 542 layout.
function showPdfForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var plSheet = ss.getSheetByName(PLACEMENT_TAB);
  var ids = [];
  if (plSheet && plSheet.getLastRow() > 1) {
    var vals = plSheet.getRange(2, 1, plSheet.getLastRow() - 1, 1).getValues();
    vals.forEach(function(r) { if (r[0]) ids.push(r[0]); });
  }

  var opts = ids.map(function(id) {
    return '<option value="' + esc_(id) + '">' + esc_(id) + '</option>';
  }).join('');

  var html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:"Segoe UI",sans-serif;font-size:13px;padding:14px;color:#1a1a1a;}' +
    'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    'label{display:block;font-weight:600;margin:10px 0 3px;font-size:12px;}' +
    'select,input{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;box-sizing:border-box;}' +
    'select:focus,input:focus{outline:none;border-color:#B8860B;}' +
    '.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
    'button{display:block;width:100%;margin-top:12px;padding:10px;background:#B8860B;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}' +
    'button:hover{background:#9a7009;} button:disabled{opacity:0.6;cursor:not-allowed;}' +
    '#status{text-align:center;margin-top:10px;font-size:12px;}' +
    '.or{text-align:center;margin:10px 0;font-size:11px;color:#999;font-weight:600;}' +
    '</style></head><body>' +
    '<h2>📄 Generate Placement PDF</h2>' +
    '<label>Select Placement ID</label>' +
    '<select id="pid"><option value="">— Select a placement —</option>' + opts + '</select>' +
    '<div class="or">— OR —</div>' +
    '<label>Date Range (all placements in range)</label>' +
    '<div class="row2">' +
      '<div><label style="margin:0 0 3px">From</label><input type="date" id="from"></div>' +
      '<div><label style="margin:0 0 3px">To</label><input type="date" id="to"></div>' +
    '</div>' +
    '<button id="btn" onclick="generate()">Generate PDF</button>' +
    '<div id="status"></div>' +
    '<script>' +
    'function generate(){' +
      'var btn=document.getElementById("btn");' +
      'var pid=document.getElementById("pid").value;' +
      'var from=document.getElementById("from").value;' +
      'var to=document.getElementById("to").value;' +
      'if(!pid && !from){document.getElementById("status").innerHTML=\'<span style="color:#c00">Select a placement ID or a date range.</span>\';return;}' +
      'btn.disabled=true;btn.textContent="Generating...";' +
      'document.getElementById("status").innerHTML="";' +
      'google.script.run' +
        '.withSuccessHandler(function(msg){document.getElementById("status").innerHTML=\'<span style="color:#2C5F2E">\'+msg+\'</span>\';btn.disabled=false;btn.textContent="Generate PDF";})' +
        '.withFailureHandler(function(e){document.getElementById("status").innerHTML=\'<span style="color:#c00">❌ \'+(e.message||JSON.stringify(e))+\'</span>\';btn.disabled=false;btn.textContent="Generate PDF";})' +
        '.generatePlacementPdfById(pid,from,to);' +
    '}' +
    '<\/script></body></html>';

  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle('Generate Placement PDF').setWidth(380)
  );
}

/**
 * Fetches the event from PlacementRecords and all matching Inventory rows,
 * builds the Gideons-style PDF, saves to Drive, and emails it.
 */
function generatePlacementPdfById(placementId, fromDate, toDate) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var plSheet = ss.getSheetByName(PLACEMENT_TAB);
    var invSheet = ss.getSheetByName('Inventory');
    if (!plSheet) throw new Error('PlacementRecords tab not found.');
    if (!invSheet) throw new Error('Inventory tab not found.');

    var plData = plSheet.getDataRange().getValues();
    var invData = invSheet.getDataRange().getValues();

    // Find matching placement events
    var events = [];
    for (var i = 1; i < plData.length; i++) {
      var row = plData[i];
      var pid  = String(row[0] || '');
      var dpla = String(row[2] || ''); // date_placed col index 2
      var match = false;
      if (placementId && pid === placementId) match = true;
      if (!placementId && fromDate && toDate && dpla >= fromDate && dpla <= toDate) match = true;
      if (!placementId && fromDate && !toDate && dpla >= fromDate) match = true;
      if (match) {
        var ev = {};
        PLACEMENT_HEADERS.forEach(function(h, idx) { ev[h] = row[idx]; });
        events.push(ev);
      }
    }
    if (!events.length) throw new Error('No placement records found for the given selection.');

    var pdfs = [];
    events.forEach(function(ev) {
      // Get Inventory lines for this placement_id (order_id column = index 10)
      var lines = [];
      for (var j = 1; j < invData.length; j++) {
        var inv = invData[j];
        if (String(inv[10] || '') === String(ev.placement_id)) {
          lines.push({
            date_assigned: String(inv[0] || ''),
            team_member:   String(ev.team_member || ''),
            scripture_type: String(inv[3] || ''),
            qty_needed:    inv[4] || 0,
            date_placed:   String(inv[0] || '')
          });
        }
      }
      // Fallback if no inventory lines matched
      if (!lines.length) {
        lines.push({
          date_assigned:  String(ev.date_assigned || ''),
          team_member:    String(ev.team_member || ''),
          scripture_type: '(see notes)',
          qty_needed:     String(ev.total_qty_placed || ''),
          date_placed:    String(ev.date_placed || '')
        });
      }
      var html = buildGideonsHtml_(ev, lines);
      var blob = HtmlService.createHtmlOutput(html)
        .getAs('application/pdf')
        .setName('PlacementRecord_' + ev.placement_id + '.pdf');
      pdfs.push({ blob: blob, ev: ev });
    });

    // Save each PDF to Drive
    var folder = DriveApp.getRootFolder();
    try {
      var ff = DriveApp.getFoldersByName('STW Placement Records');
      folder = ff.hasNext() ? ff.next() : DriveApp.createFolder('STW Placement Records');
    } catch(_) {}

    var fileNames = [];
    pdfs.forEach(function(p) {
      folder.createFile(p.blob);
      fileNames.push(p.blob.getName());
      try {
        MailApp.sendEmail({
          to: TEAM_EMAIL,
          subject: 'Placement Record: ' + p.ev.institution + ' (' + p.ev.date_placed + ')',
          body: 'Placement record attached.\nID: ' + p.ev.placement_id,
          attachments: [p.blob]
        });
      } catch(_) {}
    });

    return '✅ ' + pdfs.length + ' PDF(s) generated, saved to Drive & emailed.\n' + fileNames.join(', ');
  } catch(err) {
    throw new Error(err.toString());
  }
}

function buildGideonsHtml_(ev, lines) {
  // Fill up to 20 rows, using actual lines first then empty rows
  var tableRows = '';
  for (var i = 0; i < 20; i++) {
    if (i < lines.length) {
      var l = lines[i];
      tableRows += '<tr><td>' + esc_(l.date_assigned) + '</td><td>' + esc_(l.team_member) +
        '</td><td>' + esc_(l.scripture_type) + '</td><td style="text-align:center">' +
        esc_(l.qty_needed) + '</td><td>' + esc_(l.date_placed) + '</td></tr>';
    } else {
      tableRows += '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';
    }
  }
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:36px 44px;}' +
    'h1{text-align:center;font-size:15px;font-weight:bold;margin:0 0 20px;letter-spacing:0.04em;}' +
    '.fields{margin-bottom:16px;}' +
    '.field{display:flex;align-items:baseline;margin-bottom:7px;}' +
    '.field-label{font-size:10px;min-width:155px;flex-shrink:0;}' +
    '.field-val{border-bottom:1px solid #000;flex:1;min-height:14px;padding-bottom:1px;}' +
    '.field-row{display:flex;gap:24px;margin-bottom:7px;}' +
    '.field-row .field{flex:1;}' +
    'table{width:100%;border-collapse:collapse;margin-top:10px;}' +
    'th{background:#e8e8e8;font-weight:bold;font-size:9px;text-align:center;border:1px solid #000;padding:5px 4px;letter-spacing:0.04em;}' +
    'td{border:1px solid #000;padding:4px 6px;height:20px;font-size:10px;vertical-align:middle;}' +
    '.footer{margin-top:12px;font-size:8px;color:#666;}' +
    '</style></head><body>' +
    '<h1>SCRIPTURE PLACEMENT RECORD</h1>' +
    '<div class="fields">' +
    '<div class="field"><span class="field-label">Institution</span><span class="field-val">' + esc_(ev.institution) + '</span></div>' +
    '<div class="field"><span class="field-label">Address</span><span class="field-val">' + esc_(ev.address) + '</span></div>' +
    '<div class="field"><span class="field-label">Institution Official</span><span class="field-val">' + esc_(ev.official_name) + '</span></div>' +
    '<div class="field-row">' +
      '<div class="field"><span class="field-label">Position</span><span class="field-val"></span></div>' +
      '<div class="field"><span class="field-label" style="min-width:60px">Telephone</span><span class="field-val">' + esc_(ev.contact_phone) + '</span></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><span class="field-label">E-mail</span><span class="field-val">' + esc_(ev.contact_email) + '</span></div>' +
      '<div class="field"><span class="field-label" style="min-width:30px">Fax</span><span class="field-val"></span></div>' +
    '</div>' +
    '<div class="field"><span class="field-label">Number of Rooms, Students, Etc.</span><span class="field-val">' + esc_(ev.num_rooms_students) + '</span></div>' +
    '</div>' +
    '<table><thead><tr>' +
    '<th>DATE<br>ASSIGNED</th><th>GIDEON ASSIGNED</th><th>TYPE SCRIPTURE NEEDED</th>' +
    '<th>NUMBER<br>SCRIPTURES NEEDED</th><th>DATE<br>SCRIPTURES PLACED</th>' +
    '</tr></thead><tbody>' + tableRows + '</tbody></table>' +
    '<div class="footer">Item 542 8/2017 &nbsp;|&nbsp; Seed the Word Ministry &nbsp;|&nbsp; ' +
    'Placement ID: ' + esc_(ev.placement_id) +
    (ev.notes ? ' &nbsp;|&nbsp; Notes: ' + esc_(ev.notes) : '') + '</div>' +
    '</body></html>';
}

// ── 4. Finance Entry form ─────────────────────────────────────────
function showFinanceForm() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(FINANCE_FORM_HTML).setTitle('Log Finance Entry').setWidth(420)
  );
}

function submitFinanceEntry(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ensureTab_(ss, FINANCES_TAB, FINANCES_HEADERS);
    sheet.appendRow([
      data.date            || new Date().toISOString().split('T')[0],
      data.type            || 'expense',
      data.category        || '',
      data.description     || '',
      parseFloat(data.amount) || 0,
      data.payment_method  || '',
      data.reference       || '',
      data.recorded_by     || '',
      data.notes           || ''
    ]);
    return 'ok';
  } catch(err) {
    throw new Error('submitFinanceEntry failed: ' + err.toString());
  }
}

const FINANCE_FORM_HTML = `<!DOCTYPE html>
<html><head><base target="_top"><style>
  *{box-sizing:border-box;}
  body{font-family:'Segoe UI',sans-serif;font-size:13px;padding:12px;color:#1a1a1a;}
  h2{font-size:15px;margin:0 0 12px;border-bottom:2px solid #2C5F2E;padding-bottom:5px;color:#2C5F2E;}
  label{display:block;font-weight:600;margin:9px 0 3px;font-size:12px;}
  input,select,textarea{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;}
  input:focus,select:focus{outline:none;border-color:#2C5F2E;}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  button{display:block;width:100%;margin-top:12px;padding:10px;background:#2C5F2E;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}
  button:hover{background:#1e4420;} button:disabled{opacity:0.6;cursor:not-allowed;}
  #status{text-align:center;margin-top:10px;font-size:12px;}
</style></head><body>
<h2>💰 Log Finance Entry</h2>
<form id="f" onsubmit="save(event)">
  <label>Type *</label>
  <select id="type" required>
    <option value="income">💚 Income</option>
    <option value="expense" selected>🔴 Expense</option>
  </select>

  <label>Category *</label>
  <select id="category" required>
    <option value="">— Select —</option>
    <optgroup label="Income">
      <option value="donation-venmo">Donation — Venmo</option>
      <option value="donation-cashapp">Donation — Cash App</option>
      <option value="donation-zelle">Donation — Zelle</option>
      <option value="donation-paypal">Donation — PayPal</option>
      <option value="donation-cash">Donation — Cash/Check</option>
      <option value="donation-other">Donation — Other</option>
    </optgroup>
    <optgroup label="Expense">
      <option value="bibles">Bible Purchase (Gideons)</option>
      <option value="materials">Ministry Materials</option>
      <option value="event">Event Costs</option>
      <option value="shipping">Shipping / Postage</option>
      <option value="supplies">Supplies</option>
      <option value="other-expense">Other Expense</option>
    </optgroup>
  </select>

  <label>Description *</label>
  <input id="description" placeholder="e.g. Venmo from John, 50 Pocket NTs from Gideons" required>

  <label>Amount ($) *</label>
  <input id="amount" type="number" step="0.01" min="0" placeholder="0.00" required>

  <div class="row2">
    <div><label>Date</label><input id="date" type="date"></div>
    <div><label>Payment Method</label>
      <select id="payment_method">
        <option value="">—</option>
        <option>Venmo</option><option>Cash App</option><option>Zelle</option>
        <option>PayPal</option><option>Cash</option><option>Check</option><option>Card</option>
      </select>
    </div>
  </div>

  <label>Reference #</label>
  <input id="reference" placeholder="Transaction ID, check #, etc.">
  <label>Recorded By</label>
  <input id="recorded_by" placeholder="Your name">
  <label>Notes</label>
  <textarea id="notes" rows="2" placeholder="Optional context..."></textarea>

  <button type="submit" id="btn">Save Finance Entry</button>
  <div id="status"></div>
</form>
<script>
  document.getElementById('date').valueAsDate = new Date();
  function save(e) {
    e.preventDefault();
    var btn = document.getElementById('btn');
    btn.disabled = true; btn.textContent = 'Saving...';
    google.script.run
      .withSuccessHandler(function() {
        document.getElementById('status').innerHTML = '<span style="color:#2C5F2E">✅ Saved!</span>';
        document.getElementById('f').reset();
        document.getElementById('date').valueAsDate = new Date();
        btn.disabled = false; btn.textContent = 'Save Finance Entry';
      })
      .withFailureHandler(function(err) {
        document.getElementById('status').innerHTML = '<span style="color:#c00">❌ ' + (err.message || JSON.stringify(err)) + '</span>';
        btn.disabled = false; btn.textContent = 'Save Finance Entry';
      })
      .submitFinanceEntry({
        date: document.getElementById('date').value,
        type: document.getElementById('type').value,
        category: document.getElementById('category').value,
        description: document.getElementById('description').value,
        amount: document.getElementById('amount').value,
        payment_method: document.getElementById('payment_method').value,
        reference: document.getElementById('reference').value,
        recorded_by: document.getElementById('recorded_by').value,
        notes: document.getElementById('notes').value
      });
  }
</script>
</body></html>`;

// ── 5. Dashboard sidebar ──────────────────────────────────────────
function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var totalOut = 0, totalIn = 0;
  var invSheet = ss.getSheetByName('Inventory');
  if (invSheet) {
    var inv = invSheet.getDataRange().getValues();
    for (var i = 1; i < inv.length; i++) {
      var qty = parseInt(inv[i][4], 10) || 0;
      var dir = String(inv[i][5] || '').trim().toLowerCase();
      if (dir === 'out') totalOut += qty;
      if (dir === 'in')  totalIn  += qty;
    }
  }

  var totalIncome = 0, totalExp = 0;
  var finSheet = ss.getSheetByName(FINANCES_TAB);
  if (finSheet && finSheet.getLastRow() > 1) {
    var fin = finSheet.getRange(2, 1, finSheet.getLastRow() - 1, 5).getValues();
    for (var j = 0; j < fin.length; j++) {
      var t = String(fin[j][1] || '').toLowerCase();
      var a = parseFloat(fin[j][4]) || 0;
      if (t === 'income') totalIncome += a;
      if (t === 'expense') totalExp += a;
    }
  }

  var rsvpCount = 0;
  var rsvpSheet = ss.getSheetByName('RSVP');
  if (rsvpSheet) rsvpCount = Math.max(0, rsvpSheet.getLastRow() - 1);

  var plCount = 0;
  var plSheet = ss.getSheetByName(PLACEMENT_TAB);
  if (plSheet) plCount = Math.max(0, plSheet.getLastRow() - 1);

  var balance = totalIncome - totalExp;
  var netAvail = totalIn - totalOut;

  function card(title, val, sub, cls) {
    return '<div class="card"><div class="card-title">' + title + '</div>' +
      '<div class="val ' + (cls || '') + '">' + val + '</div>' +
      '<div class="sub">' + sub + '</div></div>';
  }

  var html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:"Segoe UI",sans-serif;font-size:13px;padding:12px;color:#1a1a1a;background:#FAFAF8;}' +
    'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}' +
    '.card{background:#fff;border:1px solid #E8E4DF;border-radius:8px;padding:10px 12px;}' +
    '.card-title{font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;margin-bottom:4px;}' +
    '.val{font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.1;}' +
    '.sub{font-size:10px;color:#9a9a9a;margin-top:3px;}' +
    '.gold{color:#B8860B;} .green{color:#2C5F2E;} .red{color:#c0392b;}' +
    '.full{grid-column:1/-1;}' +
    '.ts{font-size:10px;color:#bbb;text-align:center;margin-top:10px;}' +
    '</style></head><body>' +
    '<h2>📊 Ministry Dashboard</h2>' +
    '<div class="grid">' +
    card('Bibles Given Away', totalOut, 'Total out movements', 'gold') +
    card('Net Available', netAvail, 'Received − donated', netAvail >= 0 ? 'green' : 'red') +
    card('Total Income', '$' + totalIncome.toFixed(2), 'All donations', 'green') +
    card('Total Expenses', '$' + totalExp.toFixed(2), 'All costs', 'red') +
    '</div>' +
    '<div class="grid">' +
    '<div class="card full">' +
      '<div class="card-title">Current Balance</div>' +
      '<div class="val ' + (balance >= 0 ? 'green' : 'red') + '">$' + balance.toFixed(2) + '</div>' +
      '<div class="sub">Income minus expenses</div>' +
    '</div>' +
    '</div>' +
    '<div class="grid">' +
    card('Placement Records', plCount, 'Logged events') +
    card('Young Adults RSVPs', rsvpCount, 'Confirmed attendees') +
    '</div>' +
    '<div class="ts">Updated ' + new Date().toLocaleString() + '</div>' +
    '</body></html>';

  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle('STW Dashboard').setWidth(320)
  );
}

// ── Shared helpers ────────────────────────────────────────────────
function ensureTab_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
