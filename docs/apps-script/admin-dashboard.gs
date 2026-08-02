/**
 * Seed the Word - Admin Dashboard (Google Apps Script)
 * Container-bound script — paste into Extensions -> Apps Script
 * inside the STW Order Ledger spreadsheet.
 *
 * v3 — Row-ID model:
 *  - Every Inventory row gets a unique INV-XXXX id (tamper-evident sequencing)
 *  - Placement records are NAMED by the user and pull specific row_ids
 *  - PDF generated immediately on save, auto-emailed and saved to Drive
 */

const PLACEMENT_TAB  = 'PlacementRecords';
const FINANCES_TAB   = 'Finances';
const TEAM_EMAIL     = 'seedthewordministry@gmail.com';

// PlacementRecords columns — placement_name is how YOU identify the record
const PLACEMENT_HEADERS = [
  'placement_id', 'placement_name', 'date_placed', 'team_member',
  'institution', 'address', 'official_name', 'contact_phone',
  'contact_email', 'num_rooms_students', 'event_source',
  'total_qty_placed', 'row_ids', 'notes'
];

const FINANCES_HEADERS = [
  'date', 'type', 'category', 'description',
  'amount', 'payment_method', 'reference', 'recorded_by', 'notes'
];

const SCRIPTURE_ITEM_MAP = {
  'Pocket Personal Testimony Gideon Red':  'pocket-nt-red',
  'Pocket Friend of Gideon Grey':          'pocket-nt-grey',
  'Pocket Spanish Gideon':                 'pocket-nt-spanish',
  'Large Print Gideon Brown':              'large-print-nt-brown',
  'Pocket Hindi Gideon':                   'pocket-nt-hindi-blue',
  'Large Print Russian':                   'large-print-nt-russian',
  'Large Print Ukranian':                  'large-print-nt-ukrainian',
  'Pocket Farsi Persian':                  'pocket-nt-farsi-blue',
  'Full Bible Large Print':                'full-bible-large-print',
  'Full Bible Pocket':                     'full-bible-pocket',
  'Large Print Thai + English Gideon':     'pocket-nt-thai-english-blue',
  'Pocket Mandarin Gideon':                'pocket-nt-mandarin',
  'Large Print Urdu Gideon':               'large-print-nt-urdu-blue',
  'Large Print Spanish + English Gideon':  'large-print-nt-spanish-english',
  'Large Print Arabic + English':          'large-print-nt-arabic-english',
  'Pocket Arabic':                         'pocket-nt-arabic',
  'Pocket French Gideon':                  'pocket-nt-french',
  'Life Book English':                     'tract-life-book-english',
  'Life Book Spanish':                     'tract-life-book-spanish',
  'Flip Books':                            'tract-flip-books-english',
  'Notebooks & Pens':                      'merch-notebooks-pens',
  'Keychains & Bracelets':                 'merch-keychains-bracelets',
  'Stickers':                              'merch-stickers',
  'Mini Jesus figurines':                  'merch-mini-fig',
  'Bookmarks':                             'merch-bookmarks'
};

// ── Menu ─────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STW Admin')
    .addItem('Tag Inventory Rows (assign INV-IDs)', 'autoTagInventoryRows')
    .addItem('Refresh MinistryStats formulas', 'refreshMinistryStatsFormulas')
    .addSeparator()
    .addItem('Log Placement Record', 'showPlacementForm')
    .addSeparator()
    .addItem('Log Finance Entry', 'showFinanceForm')
    .addItem('Generate Monthly Finance Report', 'showMonthlyReportDialog')
    .addSeparator()
    .addItem('View Dashboard', 'showDashboard')
    .addToUi();
}

// ── Dynamic Categories from Lists tab ────────────────────────────
/**
 * Reads the "Lists" tab for finance categories and per-item costs.
 * Lists tab has NO header row. Data starts at row 1:
 *   Column A (idx 0): inventory types (order, outreach, restock, adjustment) — rows 1-4
 *   Column B (idx 1): item_ids (pocket-nt-red, etc.) — rows 1-25
 *   Column C (idx 2): directions (out, in) — rows 1-2
 *   Column D (idx 3): display names — rows 1-25
 *   Column E (idx 4): cost_per_unit per item — rows 1-25
 *
 * Finance categories (income/expense/methods) are derived from known values
 * since they aren't stored in the Lists tab.
 */
function getFinanceCategories_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Lists');

  var defaults = {
    income: ['donation-zelle','donation-venmo','donation-paypal',
             'donation-cashapp','donation-cash','donation-card',
             'donation-check/ACH'],
    expense: ['ministry-supplies','misc-supplies','shipping/postage',
              'designated-scripture-fund','other-expense'],
    methods: ['Zelle','Venmo','CashApp','PayPal','Cash','Card',
              'Apple/Google/Samsung Pay','Invoice/Unpaid'],
    itemCosts: {},
    defaultCost: 2
  };

  if (!sheet || sheet.getLastRow() < 1) return defaults;

  var data = sheet.getDataRange().getValues();
  var itemCosts = {};

  // Read item_id from col B (idx 1) and cost from col E (idx 4)
  for (var i = 0; i < data.length; i++) {
    var itemId = String(data[i][1]||'').trim();  // Column B
    var cost   = parseFloat(data[i][4]);          // Column E
    if (itemId && !isNaN(cost) && cost >= 0) {
      itemCosts[itemId] = cost;
    }
  }

  return {
    income:      defaults.income,
    expense:     defaults.expense,
    methods:     defaults.methods,
    itemCosts:   itemCosts,
    defaultCost: 2
  };
}

/**
 * Returns the cost_per_unit for a given item_id from the Lists tab.
 * Falls back to defaultCost (2) if the item isn't listed.
 */
function getItemCost_(itemId) {
  var cats = getFinanceCategories_();
  var id = String(itemId||'').trim();
  if (cats.itemCosts[id] !== undefined) return cats.itemCosts[id];
  return cats.defaultCost;
}

/**
 * Returns the full item cost map for use by the placement form sidebar.
 */
function getItemCostMap() {
  var cats = getFinanceCategories_();
  return { costs: cats.itemCosts, defaultCost: cats.defaultCost };
}

/**
 * Returns category lists as JSON for the finance form sidebar.
 */
function getFinanceCategoriesForForm() {
  return getFinanceCategories_();
}

// ── 1. Auto-tag Inventory rows with INV-XXXX ids ─────────────────
/**
 * Scans every row in the Inventory tab.
 * If a row has no row_id, assigns the next sequential INV-XXXX.
 * The row_id column is added after the last standard column if missing.
 * Gaps in sequence = tamper evidence (deleted rows become obvious).
 */
function autoTagInventoryRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Inventory');
  if (!sheet) { SpreadsheetApp.getUi().alert('Inventory tab not found.'); return; }

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getUi().alert('No data rows in Inventory yet.'); return; }

  // Find or create row_id column
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rowIdCol = -1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).toLowerCase().replace(/\s/g,'_') === 'row_id') { rowIdCol = h + 1; break; }
  }
  if (rowIdCol === -1) {
    // Add row_id as a new column at the end
    rowIdCol = lastCol + 1;
    sheet.getRange(1, rowIdCol).setValue('row_id');
    sheet.getRange(1, rowIdCol).setFontWeight('bold').setBackground('#E8E4DF');
  }

  // Find the highest existing INV number
  var existingIds = sheet.getRange(2, rowIdCol, lastRow - 1, 1).getValues();
  var maxNum = 0;
  existingIds.forEach(function(r) {
    var v = String(r[0]||'');
    var m = v.match(/^INV-(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });

  // Tag any empty rows
  var tagged = 0;
  for (var i = 0; i < existingIds.length; i++) {
    if (!String(existingIds[i][0]||'').trim()) {
      maxNum++;
      sheet.getRange(i + 2, rowIdCol).setValue('INV-' + String(maxNum).padStart(4, '0'));
      tagged++;
    }
  }

  SpreadsheetApp.getUi().alert(
    tagged > 0
      ? 'Done! Tagged ' + tagged + ' rows with INV-IDs. Highest ID: INV-' + String(maxNum).padStart(4,'0')
      : 'All rows already have INV-IDs. Last ID: INV-' + String(maxNum).padStart(4,'0')
  );
}

// ── Helper: get row_id column index (0-based) from Inventory ─────
function getInvRowIdCol_(invData) {
  var headers = invData[0];
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).toLowerCase().replace(/\s/g,'_') === 'row_id') return h;
  }
  return -1;
}

// ── Helper: get order_id column index (0-based) from Inventory ───
function getInvOrderIdCol_(invData) {
  var headers = invData[0];
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).toLowerCase().replace(/[^a-z_]/g,'') === 'order_id') return h;
  }
  return 10; // fallback to K
}

// ── 2. Placement Form — named event + row checklist ───────────────
function showPlacementForm() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(getPlacementFormHtml_())
      .setTitle('Log Placement Record').setWidth(520)
  );
}

/**
 * Returns all rows currently selected in the active sheet.
 * This is the primary way to pick rows — select them in the Inventory tab,
 * then open "Log Placement Record" and they appear pre-loaded.
 * Falls back to recent "out" rows if nothing meaningful is selected.
 */
function getInventoryOutRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Inventory');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find columns by header — case-insensitive, spaces/underscores/dashes normalised
  function findCol(name) {
    var n = name.toLowerCase().replace(/[\s_\-]/g,'');
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[\s_\-]/g,'') === n) return h;
    }
    return -1;
  }

  // Try to find by header name, fall back to known positions
  var dateCol    = findCol('date');       if (dateCol === -1)    dateCol = 0;
  var typeCol    = findCol('type');       if (typeCol === -1)    typeCol = 1;
  var itemIdCol  = findCol('itemid');     if (itemIdCol === -1)  itemIdCol = 2;
  var nameCol    = findCol('itemname');   if (nameCol === -1)    nameCol = 3;
  var qtyCol     = findCol('qty');        if (qtyCol === -1)     qtyCol = 4;
  var dirCol     = findCol('direction');  if (dirCol === -1)     dirCol = 5;
  var sourceCol  = findCol('eventsource');if (sourceCol === -1)  sourceCol = 6;
  var costCol    = findCol('costperunit');if (costCol === -1)    costCol = 7;
  var totalCol   = findCol('totalcost');  if (totalCol === -1)   totalCol = 8;
  var notesCol   = findCol('notes');      if (notesCol === -1)   notesCol = 9;
  var orderCol   = findCol('orderid');    if (orderCol === -1)   orderCol = 10;
  var rowIdCol   = findCol('rowid');
  // row_id is often the last column — scan for it
  if (rowIdCol === -1) {
    for (var h = headers.length - 1; h >= 0; h--) {
      var hv = String(headers[h]).toLowerCase().replace(/[\s_\-]/g,'');
      if (hv === 'rowid') { rowIdCol = h; break; }
    }
  }

  // Helper: format date for display
  function fmtDate(val) {
    if (!val) return '';
    if (val instanceof Date) {
      return (val.getMonth()+1) + '/' + val.getDate() + '/' + val.getFullYear();
    }
    var s = String(val);
    // If it looks like a long date string, try to shorten it
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
    }
    return s;
  }

  // Helper: build row object from a data row
  function buildRow(row, rowNum, preselected) {
    var rowId = rowIdCol >= 0 ? String(row[rowIdCol]||'').trim() : '';
    var nm    = String(row[nameCol]||'').trim();
    var qty   = parseInt(row[qtyCol],10) || 0;
    var src   = String(row[sourceCol]||'').trim();
    var dt    = fmtDate(row[dateCol]);
    var itemId = String(row[itemIdCol]||'').trim();
    // If item_name is empty, try to use item_id as fallback display name
    if (!nm && itemId) nm = itemId;
    return {
      row_id:      rowId,
      date:        dt,
      item_id:     itemId,
      name:        nm,
      qty:         qty,
      source:      src,
      order_id:    String(row[orderCol]||'').trim(),
      label:       (rowId ? '['+rowId+'] ' : '[row '+rowNum+'] ') + (nm||'(unnamed)') + ' x'+qty + (dt?' ('+dt+')':''),
      preselected: preselected
    };
  }

  // Check if user has rows selected in the Inventory sheet
  var selectedRows = [];
  try {
    var active = ss.getActiveSheet();
    if (active.getName() === 'Inventory') {
      var sel = active.getActiveRange();
      var selStart = sel.getRow();
      var selEnd   = sel.getLastRow();
      if (selStart > 1 && selEnd >= selStart) {
        for (var s = selStart; s <= selEnd; s++) {
          var row = data[s - 1]; // data is 0-based
          if (!row) continue;
          var dir = String(row[dirCol]||'').trim().toLowerCase();
          if (dir !== 'out') continue;
          selectedRows.push(buildRow(row, s, true));
        }
      }
    }
  } catch(_) {}

  // If we got pre-selected rows from the spreadsheet selection, return those
  if (selectedRows.length > 0) return selectedRows;

  // Otherwise return ALL "out" rows for manual selection (newest first)
  var result = [];
  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    var dir2 = String(row[dirCol]||'').trim().toLowerCase();
    if (dir2 !== 'out') continue;
    result.push(buildRow(row, i + 1, false));
  }
  return result;
}

function getPlacementFormHtml_() {
  var typeOpts = Object.keys(SCRIPTURE_ITEM_MAP).map(function(t) {
    return '<option value="'+t+'" data-id="'+SCRIPTURE_ITEM_MAP[t]+'">'+t+'</option>';
  }).join('');

  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '*{box-sizing:border-box;}' +
    'body{font-family:Segoe UI,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;overflow-x:hidden;}' +
    'h2{font-size:14px;margin:0 0 10px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    'h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6B6B6B;margin:12px 0 6px;}' +
    'label{display:block;font-weight:600;margin:7px 0 2px;font-size:11px;}' +
    'input,select,textarea{width:100%;padding:6px 8px;border:1px solid #E8E4DF;border-radius:4px;font-size:12px;font-family:inherit;}' +
    'input:focus,select:focus,textarea:focus{outline:none;border-color:#B8860B;}' +
    '.r2{display:grid;grid-template-columns:1fr 1fr;gap:7px;}' +
    'hr{border:none;border-top:1px solid #E8E4DF;margin:10px 0;}' +
    /* Checklist */
    '.checklist{max-height:280px;overflow-y:auto;border:1px solid #E8E4DF;border-radius:4px;padding:4px;}' +
    '.chk-item{display:grid;grid-template-columns:1fr 16px;align-items:center;gap:4px;padding:4px 5px;border-bottom:1px solid #f0ede8;font-size:11px;cursor:pointer;}' +
    '.chk-item:last-child{border-bottom:none;}' +
    '.chk-item:hover{background:#fffbf0;}' +
    '.chk-item.selected{background:#fff8e8;}' +
    '.chk-item input[type=checkbox]{width:14px;height:14px;margin:0;flex-shrink:0;accent-color:#B8860B;cursor:pointer;}' +
    '.chk-label{line-height:1.3;overflow:hidden;}' +
    '.chk-id{font-size:10px;font-weight:700;color:#B8860B;display:inline;}' +
    '.chk-name{color:#1a1a1a;font-size:10px;}' +
    '.chk-meta{font-size:9px;color:#888;display:block;margin-top:1px;}' +
    '.sel-all{font-size:11px;color:#B8860B;cursor:pointer;font-weight:600;margin-bottom:5px;display:inline-block;}' +
    /* Scripture lines (NEW entries not yet in Inventory) */
    '.line{background:#FAFAF8;border:1px solid #E8E4DF;border-radius:5px;padding:8px;margin-bottom:7px;}' +
    '.qr{display:grid;grid-template-columns:1fr 1fr 30px;gap:5px;align-items:end;}' +
    '.ql{font-size:10px;font-weight:600;display:block;margin-bottom:2px;}' +
    '.rm{background:#fee;border:1px solid #fcc;border-radius:3px;color:#c00;font-size:15px;cursor:pointer;width:30px;height:30px;text-align:center;line-height:30px;padding:0;}' +
    '.add{width:100%;padding:8px;background:#fff8e8;border:1.5px dashed #B8860B;border-radius:4px;color:#B8860B;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:10px;}' +
    '.save{display:block;width:100%;padding:10px;background:#B8860B;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;margin-top:4px;}' +
    '.save:disabled{opacity:.6;cursor:not-allowed;}' +
    '#st{text-align:center;margin-top:9px;font-size:12px;line-height:1.5;}' +
    '.loading{color:#999;font-size:12px;padding:8px;}' +
    '.tab-btn{padding:6px 12px;border:1px solid #E8E4DF;background:#f9f6f1;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;}' +
    '.tab-btn.active{background:#B8860B;color:#fff;border-color:#B8860B;}' +
    '.tabs{display:flex;gap:6px;margin-bottom:8px;}' +
    '</style></head><body>' +
    '<h2>Log Placement Record</h2>' +

    '<h3>Placement Name *</h3>' +
    '<input id="pname" placeholder="e.g. Sam Petrov Community Cookout July 25" required>' +

    '<h3>Event Details</h3>' +
    '<label>Institution / Location *</label><input id="ins" placeholder="e.g. Wiggums Hollow Park" required>' +
    '<label>Address</label><input id="adr" placeholder="Street, City, State">' +
    '<label>Institution Official</label><input id="off" placeholder="Name of contact">' +
    '<div class="r2"><div><label>Phone</label><input id="ph" type="tel"></div><div><label>Email</label><input id="em" type="email"></div></div>' +
    '<label>Rooms / Students / People</label><input id="rms" placeholder="e.g. 200 students">' +
    '<div class="r2"><div><label>Date Placed *</label><input id="dp" type="date" required></div><div><label>Team Member</label><input id="tm" placeholder="David Ageyev"></div></div>' +
    '<label>Event Source</label><input id="es" placeholder="Community Cookout">' +
    '<label>Notes</label><textarea id="nt" rows="2" placeholder="Optional..."></textarea>' +

    '<hr>' +
    '<h3>Scriptures to Include in This Placement</h3>' +
    '<div class="tabs">' +
      '<button type="button" class="tab-btn active" id="tab-existing">From Inventory (by row)</button>' +
      '<button type="button" class="tab-btn" id="tab-new">Add New Lines</button>' +
    '</div>' +

    // Tab 1: existing inventory rows
    '<div id="panel-existing">' +
      '<span class="sel-all" id="selAll">Select all</span>' +
      '<div class="checklist" id="checklist"><div class="loading">Loading rows...</div></div>' +
    '</div>' +

    // Tab 2: new scripture lines (adds to Inventory too)
    '<div id="panel-new" style="display:none">' +
      '<div id="lines"></div>' +
      '<button type="button" class="add" id="addBtn">+ Add Scripture Type</button>' +
    '</div>' +

    '<button class="save" id="saveBtn">Save &amp; Generate PDF</button>' +
    '<div id="st"></div>' +

    '<script>' +
    'var cnt=0;' +
    'var outRows=[];' +
    'var typeOpts='+JSON.stringify('<option value="">-- Select --</option>'+typeOpts)+';' +

    // Tabs
    'document.getElementById("tab-existing").onclick=function(){' +
      'document.getElementById("panel-existing").style.display="";' +
      'document.getElementById("panel-new").style.display="none";' +
      'document.getElementById("tab-existing").className="tab-btn active";' +
      'document.getElementById("tab-new").className="tab-btn";' +
    '};' +
    'document.getElementById("tab-new").onclick=function(){' +
      'document.getElementById("panel-existing").style.display="none";' +
      'document.getElementById("panel-new").style.display="";' +
      'document.getElementById("tab-existing").className="tab-btn";' +
      'document.getElementById("tab-new").className="tab-btn active";' +
    '};' +

    // Pre-fill date
    'document.getElementById("dp").valueAsDate=new Date();' +

    // Load checklist from server
    'google.script.run' +
      '.withSuccessHandler(function(rows){' +
        'outRows=rows;' +
        'var cl=document.getElementById("checklist");' +
        'var hasPresel=rows.some(function(r){return r.preselected;});' +
        'if(!rows.length){' +
          'cl.innerHTML=\'<div class="loading">No out rows found.<br>Run <b>Tag Inventory Rows</b> first, then select rows in the Inventory tab before opening this form.</div>\';' +
          'return;' +
        '}' +
        'var fullHtml="";' +
        'if(hasPresel){' +
          'fullHtml+=\'<div style="font-size:11px;color:#2C5F2E;font-weight:700;padding:4px 4px 8px;">\\u2705 \'+rows.length+\' row(s) pre-loaded from your spreadsheet selection:</div>\';' +
        '} else {' +
          'fullHtml+=\'<div style="font-size:11px;color:#888;padding:4px 4px 8px;">Tip: select rows in the Inventory tab first for faster picking.</div>\';' +
        '}' +
        'rows.forEach(function(r,i){' +
          'var chk=r.preselected?" checked":"";' +
          'var cls=r.preselected?" selected":"";' +
          'fullHtml+=\'<label class="chk-item\'+cls+\'"><div class="chk-label"><span class="chk-id">\'+(r.row_id||"(no ID)")+\'</span> <span class="chk-name">\'+r.name+\' x\'+r.qty+\'</span><span class="chk-meta">\'+r.date+(r.source?" \\u00b7 "+r.source:"")+\'</span></div><input type="checkbox" class="row-chk" value="\'+i+\'"\'+chk+\'></label>\';' +
        '});' +
        'cl.innerHTML=fullHtml;' +
        // Re-attach click handlers to make entire row toggle checkbox
        'cl.querySelectorAll(".chk-item").forEach(function(label){' +
          'label.addEventListener("click",function(e){' +
            'if(e.target.type==="checkbox")return;' +
            'var cb=label.querySelector("input[type=checkbox]");' +
            'cb.checked=!cb.checked;' +
            'label.classList.toggle("selected",cb.checked);' +
          '});' +
        '});' +
      '})' +
      '.withFailureHandler(function(e){document.getElementById("checklist").innerHTML=\'<div class="loading">Failed to load rows: \'+(e.message||e)+\'</div>\';})' +
      '.getInventoryOutRows();' +

    // Select all toggle
    'var allSel=false;' +
    'document.getElementById("selAll").onclick=function(){' +
      'allSel=!allSel;' +
      'document.querySelectorAll(".row-chk").forEach(function(c){c.checked=allSel;});' +
      'document.getElementById("selAll").textContent=allSel?"Deselect all":"Select all";' +
    '};' +

    // Add new line
    'function addLine(){' +
      'cnt++;var id="ln"+cnt;var d=document.createElement("div");d.className="line";d.id=id;' +
      'd.innerHTML=\'<select class="ts">\'+typeOpts+\'</select><div class="qr"><div><span class="ql">Qty Needed</span><input type="number" class="qn" min="0" value="0"></div><div><span class="ql">Qty Placed *</span><input type="number" class="qp" min="0" value="0"></div><button class="rm" type="button">x</button></div>\';' +
      'd.querySelector(".rm").onclick=function(){d.remove();};' +
      'document.getElementById("lines").appendChild(d);' +
    '}' +
    'document.getElementById("addBtn").onclick=addLine;' +

    // Save
    'document.getElementById("saveBtn").onclick=function(){' +
      'var st=document.getElementById("st");var btn=document.getElementById("saveBtn");' +
      'var pname=document.getElementById("pname").value.trim();' +
      'var ins=document.getElementById("ins").value.trim();' +
      'var dp=document.getElementById("dp").value;' +
      'if(!pname){st.innerHTML=\'<span style="color:#c00">Placement Name is required.</span>\';return;}' +
      'if(!ins){st.innerHTML=\'<span style="color:#c00">Institution is required.</span>\';return;}' +
      'if(!dp){st.innerHTML=\'<span style="color:#c00">Date Placed is required.</span>\';return;}' +

      // Collect checked existing rows
      'var selRowIds=[];' +
      'document.querySelectorAll(".row-chk:checked").forEach(function(c){' +
        'var r=outRows[parseInt(c.value)];if(r)selRowIds.push(r.row_id||"");' +
      '});' +

      // Collect new scripture lines
      'var newLines=[];' +
      'document.querySelectorAll(".line").forEach(function(el){' +
        'var sel=el.querySelector(".ts");var type=sel.value;if(!type)return;' +
        'var opt=sel.options[sel.selectedIndex];var itemId=opt?opt.getAttribute("data-id"):"";' +
        'newLines.push({type:type,item_id:itemId||type,qty_needed:parseInt(el.querySelector(".qn").value)||0,qty_placed:parseInt(el.querySelector(".qp").value)||0});' +
      '});' +

      'if(!selRowIds.length&&!newLines.length){st.innerHTML=\'<span style="color:#c00">Select rows from Inventory or add new scripture lines.</span>\';return;}' +

      'btn.disabled=true;btn.textContent="Saving & Generating PDF...";st.innerHTML="";' +

      'google.script.run' +
        '.withSuccessHandler(function(r){' +
          'st.innerHTML=\'<span style="color:#2C5F2E">Saved! PDF emailed. Placement ID: \'+r.id+\'<br>Name: \'+r.name+\'</span>\';' +
          '["pname","ins","adr","off","ph","em","rms","tm","es","nt"].forEach(function(f){document.getElementById(f).value="";});' +
          'document.getElementById("dp").valueAsDate=new Date();' +
          'document.getElementById("lines").innerHTML="";cnt=0;' +
          'document.querySelectorAll(".row-chk").forEach(function(c){c.checked=false;});' +
          'btn.disabled=false;btn.textContent="Save & Generate PDF";' +
        '})' +
        '.withFailureHandler(function(e){st.innerHTML=\'<span style="color:#c00">\'+(e.message||JSON.stringify(e))+\'</span>\';btn.disabled=false;btn.textContent="Save & Generate PDF";})' +
        '.submitPlacementRecord({' +
          'placementName:pname,' +
          'selectedRowIds:selRowIds,' +
          'newLines:newLines,' +
          'event:{institution:ins,address:document.getElementById("adr").value,official_name:document.getElementById("off").value,contact_phone:document.getElementById("ph").value,contact_email:document.getElementById("em").value,num_rooms:document.getElementById("rms").value,date_placed:dp,team_member:document.getElementById("tm").value,event_source:document.getElementById("es").value,notes:document.getElementById("nt").value}' +
        '});' +
    '};' +
    '<\/script></body></html>';
}

// ── 3. Submit placement — write records + generate PDF immediately ─
/**
 * data = {
 *   placementName: string,          // user-given name
 *   selectedRowIds: string[],       // INV-XXXX ids from existing Inventory rows
 *   newLines: [{type,item_id,qty_needed,qty_placed}],  // brand-new entries
 *   event: { institution, address, official_name, contact_phone,
 *             contact_email, num_rooms, date_placed, team_member,
 *             event_source, notes }
 * }
 */
function submitPlacementRecord(data) {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var ev  = data.event || {};
    var selIds   = data.selectedRowIds  || [];
    var newLines = data.newLines         || [];

    if (!selIds.length && !newLines.length) {
      throw new Error('Select at least one inventory row or add a new scripture line.');
    }

    var placementId   = 'PLR-' + new Date().getTime();
    var placementName = String(data.placementName || '').trim() || placementId;
    var datePlaced    = ev.date_placed || new Date().toISOString().split('T')[0];
    var source        = ev.institution || ev.event_source || '';

    // ── A. Get Inventory sheet + data ────────────────────────────
    var invSheet = ss.getSheetByName('Inventory') ||
      ensureTab_(ss, 'Inventory', ['date','type','item_id','item_name','qty','direction',
                                    'event_source','cost_per_unit','total_cost','notes','order_id']);
    var invData      = invSheet.getDataRange().getValues();
    var rowIdCol     = getInvRowIdCol_(invData);   // 0-based, or -1 if missing
    var orderIdCol   = getInvOrderIdCol_(invData); // 0-based

    // ── B. Tag any untagged rows first ───────────────────────────
    // (in case autoTagInventoryRows hasn't been run yet)
    var maxNum = 0;
    if (rowIdCol >= 0) {
      for (var i = 1; i < invData.length; i++) {
        var v = String(invData[i][rowIdCol]||'');
        var m = v.match(/^INV-(\d+)$/);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1],10));
      }
    }

    // ── C. Build PDF lines from selected existing rows ───────────
    var pdfLines = [];
    if (selIds.length && rowIdCol >= 0) {
      var selSet = {};
      selIds.forEach(function(id){ if(id) selSet[id] = true; });
      for (var r = 1; r < invData.length; r++) {
        var rid = String(invData[r][rowIdCol]||'');
        if (selSet[rid]) {
          // Tag this row with the placement_id in order_id column
          invSheet.getRange(r + 1, orderIdCol + 1).setValue(placementId);
          pdfLines.push({
            row_id:         rid,
            date_assigned:  String(invData[r][0]||''),
            team_member:    ev.team_member || String(invData[r][6]||''),
            scripture_type: String(invData[r][3]||''),
            qty_needed:     parseInt(invData[r][4],10) || 0,
            date_placed:    datePlaced
          });
        }
      }
    }

    // ── D. Add new scripture lines to Inventory + PDF ────────────
    if (newLines.length) {
      // Ensure row_id column exists
      if (rowIdCol === -1) {
        var newColIdx = invSheet.getLastColumn() + 1;
        invSheet.getRange(1, newColIdx).setValue('row_id');
        invSheet.getRange(1, newColIdx).setFontWeight('bold').setBackground('#E8E4DF');
        rowIdCol = newColIdx - 1; // 0-based
        // Refresh invData to include new column
        invData = invSheet.getDataRange().getValues();
      }
      // Get scripture cost from Lists tab (dynamic per item)
      var cats_ = getFinanceCategories_();
      newLines.forEach(function(line) {
        var qty  = parseInt(line.qty_placed,10) || 0;
        var cost = (cats_.itemCosts[line.item_id] !== undefined) ? cats_.itemCosts[line.item_id] : cats_.defaultCost;
        maxNum++;
        var newRowId = 'INV-' + String(maxNum).padStart(4,'0');
        // Build row matching Inventory columns, then append row_id at end
        var newRow = [datePlaced, 'outreach', line.item_id||'outreach',
          line.type||'', qty, 'out', source, cost, qty*cost, ev.notes||'', placementId];
        // Pad to rowIdCol position if needed
        while (newRow.length < rowIdCol) newRow.push('');
        if (newRow.length === rowIdCol) newRow.push(newRowId);
        else newRow[rowIdCol] = newRowId;
        invSheet.appendRow(newRow);
        pdfLines.push({
          row_id:         newRowId,
          date_assigned:  datePlaced,
          team_member:    ev.team_member || '',
          scripture_type: line.type || line.item_id || '',
          qty_needed:     parseInt(line.qty_needed,10) || qty,
          date_placed:    datePlaced
        });
      });
    }

    var totalQty = pdfLines.reduce(function(s,l){ return s+(parseInt(l.qty_needed,10)||0); }, 0);
    var rowIdList = pdfLines.map(function(l){ return l.row_id; }).filter(Boolean).join(', ');

    // ── E. Write to PlacementRecords ─────────────────────────────
    var plSheet = ensureTab_(ss, PLACEMENT_TAB, PLACEMENT_HEADERS);
    plSheet.appendRow([
      placementId, placementName, datePlaced, ev.team_member||'',
      ev.institution||'', ev.address||'', ev.official_name||'',
      ev.contact_phone||'', ev.contact_email||'', ev.num_rooms||'',
      ev.event_source||'', totalQty, rowIdList, ev.notes||''
    ]);

    // ── F. Build & send PDF ──────────────────────────────────────
    var evForPdf = {
      placement_id:     placementId,
      placement_name:   placementName,
      institution:      ev.institution||'',
      address:          ev.address||'',
      official_name:    ev.official_name||'',
      contact_phone:    ev.contact_phone||'',
      contact_email:    ev.contact_email||'',
      num_rooms_students: ev.num_rooms||'',
      date_placed:      datePlaced,
      team_member:      ev.team_member||'',
      notes:            ev.notes||''
    };

    var pdfBlob = HtmlService
      .createHtmlOutput(buildGideonsHtml_(evForPdf, pdfLines))
      .getAs('application/pdf')
      .setName('PlacementRecord_' + placementName.replace(/[^a-zA-Z0-9]/g,'-') + '_' + placementId + '.pdf');

    // Save to Drive
    var folder = DriveApp.getRootFolder();
    try {
      var ff = DriveApp.getFoldersByName('STW Placement Records');
      folder = ff.hasNext() ? ff.next() : DriveApp.createFolder('STW Placement Records');
    } catch(_) {}
    folder.createFile(pdfBlob);

    // Email to team
    try {
      MailApp.sendEmail({
        to: TEAM_EMAIL,
        subject: 'Placement Record: ' + placementName + ' (' + datePlaced + ')',
        body: 'Placement record attached.\nName: ' + placementName + '\nID: ' + placementId + '\nRows: ' + rowIdList,
        attachments: [pdfBlob]
      });
    } catch(emailErr) {
      Logger.log('Email failed (non-fatal): ' + emailErr);
    }

    return { id: placementId, name: placementName, totalQty: totalQty };

  } catch(err) {
    throw new Error('submitPlacementRecord failed: ' + err.toString());
  }
}

// ── 4. PDF builder — Gideons Item 542 layout + row_id trace ──────
function buildGideonsHtml_(ev, lines) {
  var tableRows = '';
  for (var i = 0; i < 20; i++) {
    if (i < lines.length) {
      var l = lines[i];
      tableRows +=
        '<tr>' +
          '<td>' + esc_(l.date_assigned) + '</td>' +
          '<td>' + esc_(l.team_member) + '</td>' +
          '<td>' + esc_(l.scripture_type) + '</td>' +
          '<td style="text-align:center">' + esc_(l.qty_needed) + '</td>' +
          '<td>' + esc_(l.date_placed) + '</td>' +
          '<td style="font-size:8px;color:#888;text-align:center">' + esc_(l.row_id||'') + '</td>' +
        '</tr>';
    } else {
      tableRows += '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';
    }
  }
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:32px 40px;}' +
    'h1{text-align:center;font-size:15px;font-weight:bold;margin:0 0 4px;letter-spacing:.04em;}' +
    '.pname{text-align:center;font-size:10px;color:#555;margin:0 0 16px;font-style:italic;}' +
    '.field{display:flex;align-items:baseline;margin-bottom:6px;}' +
    '.fl{font-size:10px;min-width:150px;flex-shrink:0;}' +
    '.fv{border-bottom:1px solid #000;flex:1;min-height:13px;padding-bottom:1px;}' +
    '.fr{display:flex;gap:20px;margin-bottom:6px;} .fr .field{flex:1;}' +
    'table{width:100%;border-collapse:collapse;margin-top:10px;}' +
    'th{background:#e8e8e8;font-weight:bold;font-size:9px;text-align:center;border:1px solid #000;padding:4px 3px;letter-spacing:.03em;}' +
    'td{border:1px solid #000;padding:4px 5px;height:19px;font-size:10px;vertical-align:middle;}' +
    '.foot{margin-top:10px;font-size:8px;color:#666;line-height:1.6;}' +
    '</style></head><body>' +
    '<h1>SCRIPTURE PLACEMENT RECORD</h1>' +
    '<p class="pname">' + esc_(ev.placement_name||'') + '</p>' +
    '<div class="field"><span class="fl">Institution</span><span class="fv">' + esc_(ev.institution) + '</span></div>' +
    '<div class="field"><span class="fl">Address</span><span class="fv">' + esc_(ev.address) + '</span></div>' +
    '<div class="field"><span class="fl">Institution Official</span><span class="fv">' + esc_(ev.official_name) + '</span></div>' +
    '<div class="fr">' +
      '<div class="field"><span class="fl">Position</span><span class="fv"></span></div>' +
      '<div class="field"><span class="fl" style="min-width:60px">Telephone</span><span class="fv">' + esc_(ev.contact_phone) + '</span></div>' +
    '</div>' +
    '<div class="fr">' +
      '<div class="field"><span class="fl">E-mail</span><span class="fv">' + esc_(ev.contact_email) + '</span></div>' +
      '<div class="field"><span class="fl" style="min-width:30px">Fax</span><span class="fv"></span></div>' +
    '</div>' +
    '<div class="field"><span class="fl">Number of Rooms, Students, Etc.</span><span class="fv">' + esc_(ev.num_rooms_students) + '</span></div>' +
    '<table><thead><tr>' +
      '<th>DATE ASSIGNED</th><th>GIDEON ASSIGNED</th><th>TYPE SCRIPTURE NEEDED</th>' +
      '<th>NUMBER SCRIPTURES NEEDED</th><th>DATE SCRIPTURES PLACED</th><th>ROW ID (trace)</th>' +
    '</tr></thead><tbody>' + tableRows + '</tbody></table>' +
    '<div class="foot">' +
      'Item 542 8/2017 &nbsp;|&nbsp; Seed the Word Ministry &nbsp;|&nbsp; ' +
      'Placement ID: ' + esc_(ev.placement_id) +
      ' &nbsp;|&nbsp; Name: ' + esc_(ev.placement_name||'') +
      (ev.notes ? ' &nbsp;|&nbsp; Notes: ' + esc_(ev.notes) : '') +
      '<br>Row IDs in this record map back to the Inventory tab of the STW Order Ledger.' +
    '</div>' +
    '</body></html>';
}

// ── MinistryStats formula refresh ────────────────────────────────
function refreshMinistryStatsFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName('Inventory');
  if (!invSheet) { SpreadsheetApp.getUi().alert('Inventory tab not found.'); return; }
  var statsSheet = ensureTab_(ss, 'MinistryStats', ['key','value','note']);
  var writeRow = statsSheet.getLastRow() + 2;
  statsSheet.getRange(writeRow,1,1,4).setValues([['--- AUTO-COMPUTED FROM INVENTORY ---','','','Refreshed: '+new Date().toLocaleString()]]);
  statsSheet.getRange(writeRow,1,1,4).setFontWeight('bold').setBackground('#f5f3f0');
  writeRow++;
  statsSheet.getRange(writeRow,1,1,4).setValues([['item_id','donated_total (out)','received_total (in)','net_available']]);
  statsSheet.getRange(writeRow,1,1,4).setFontWeight('bold').setBackground('#E8E4DF');
  writeRow++;
  var invData = invSheet.getDataRange().getValues();
  var itemIds = {};
  for (var i = 1; i < invData.length; i++) {
    var id = String(invData[i][2]||'').trim();
    if (id) itemIds[id] = true;
  }
  var ids = Object.keys(itemIds).sort();
  if (!ids.length) { SpreadsheetApp.getUi().alert('No item_ids in Inventory yet.'); return; }
  for (var r = 0; r < ids.length; r++) {
    var itemId = ids[r];
    var e = itemId.replace(/"/g,'""');
    var tr = writeRow + r;
    statsSheet.getRange(tr,1).setValue(itemId);
    statsSheet.getRange(tr,2).setFormula('=SUMIFS(Inventory!E:E,Inventory!C:C,"'+e+'",Inventory!F:F,"out")');
    statsSheet.getRange(tr,3).setFormula('=SUMIFS(Inventory!E:E,Inventory!C:C,"'+e+'",Inventory!F:F,"in")');
    statsSheet.getRange(tr,4).setFormula('=C'+tr+'-B'+tr);
  }
  var sumRow = writeRow + ids.length + 2;
  statsSheet.getRange(sumRow,1,1,4).setValues([['--- LANGUAGE SUMMARY ---','','','']]);
  statsSheet.getRange(sumRow,1,1,4).setFontWeight('bold').setBackground('#f5f3f0');
  sumRow++;
  statsSheet.getRange(sumRow,1,1,4).setValues([['language','donated_total','received_total','net_available']]);
  statsSheet.getRange(sumRow,1,1,4).setFontWeight('bold').setBackground('#E8E4DF');
  sumRow++;
  var langIdMap = {
    'English':  ['pocket-nt-red','pocket-nt-grey','pocket-nt-spanish','large-print-nt-brown','full-bible-large-print','full-bible-pocket'],
    'Hindi':    ['pocket-nt-hindi-blue'],'Russian':['large-print-nt-russian'],
    'Ukrainian':['large-print-nt-ukrainian'],'Farsi':['pocket-nt-farsi-blue'],
    'Urdu':     ['large-print-nt-urdu-blue'],'Thai':['pocket-nt-thai-english-blue'],
    'Mandarin': ['pocket-nt-mandarin'],'Spanish':['pocket-nt-spanish','large-print-nt-spanish-english'],
    'Arabic':   ['large-print-nt-arabic-english','pocket-nt-arabic'],'French':['pocket-nt-french']
  };
  Object.keys(langIdMap).forEach(function(lang) {
    var lids = langIdMap[lang];
    var out = lids.map(function(x){ return 'SUMIFS(Inventory!E:E,Inventory!C:C,"'+x+'",Inventory!F:F,"out")'; });
    var inp = lids.map(function(x){ return 'SUMIFS(Inventory!E:E,Inventory!C:C,"'+x+'",Inventory!F:F,"in")'; });
    statsSheet.getRange(sumRow,1).setValue(lang);
    statsSheet.getRange(sumRow,2).setFormula('='+out.join('+'));
    statsSheet.getRange(sumRow,3).setFormula('='+inp.join('+'));
    statsSheet.getRange(sumRow,4).setFormula('=C'+sumRow+'-B'+sumRow);
    sumRow++;
  });
  SpreadsheetApp.getUi().alert('MinistryStats formulas refreshed!');
}

// ── Finance form ──────────────────────────────────────────────────
function showFinanceForm() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(buildFinanceFormHtml_()).setTitle('Log Finance Entry').setWidth(420)
  );
}

function submitFinanceEntry(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ensureTab_(ss, FINANCES_TAB, FINANCES_HEADERS);
    var category = data.category || '';
    var type     = data.type || 'expense';
    var amount   = parseFloat(data.amount) || 0;

    // Scripture fund separation: if category is a scripture purchase,
    // tag it so dashboard can separate scripture costs from general inventory
    var isScriptureFund = /scripture/i.test(category);

    sheet.appendRow([
      data.date || new Date().toISOString().split('T')[0],
      type,
      category,
      data.description || '',
      amount,
      data.payment_method || '',
      data.reference || '',
      data.recorded_by || '',
      data.notes || (isScriptureFund ? '[SCRIPTURE_FUND]' : '')
    ]);
    return 'ok';
  } catch(err) { throw new Error('submitFinanceEntry failed: ' + err.toString()); }
}

/**
 * Builds finance form HTML dynamically using categories from the Lists tab.
 * For INCOME: category IS the method (donation-zelle, donation-venmo, etc.)
 *   so no separate payment method dropdown is shown.
 * For EXPENSE: category is the cost type, payment method is how it was paid.
 */
function buildFinanceFormHtml_() {
  var cats = getFinanceCategories_();
  var incomeOpts = cats.income.map(function(c) {
    return '<option value="' + esc_(c) + '">' + esc_(c) + '</option>';
  }).join('');
  var expenseOpts = cats.expense.map(function(c) {
    return '<option value="' + esc_(c) + '">' + esc_(c) + '</option>';
  }).join('');
  var methodOpts = cats.methods.map(function(m) {
    return '<option value="' + esc_(m) + '">' + esc_(m) + '</option>';
  }).join('');

  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '*{box-sizing:border-box;}body{font-family:Segoe UI,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;}' +
    'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #2C5F2E;padding-bottom:5px;color:#2C5F2E;}' +
    'label{display:block;font-weight:600;margin:9px 0 3px;font-size:12px;}' +
    'input,select,textarea{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;}' +
    'input:focus,select:focus{outline:none;border-color:#2C5F2E;}' +
    '.r2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
    '.hint{font-size:10px;color:#888;margin:2px 0 6px;}' +
    'button{display:block;width:100%;margin-top:12px;padding:10px;background:#2C5F2E;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}' +
    'button:disabled{opacity:.6;cursor:not-allowed;}#st{text-align:center;margin-top:10px;font-size:12px;}' +
    '</style></head><body>' +
    '<h2>Log Finance Entry</h2>' +
    '<p style="font-size:11px;color:#888;margin:0 0 10px;">Categories loaded from the <b>Lists</b> tab. Edit that tab to add/remove options.</p>' +
    '<form id="f" onsubmit="save(event)">' +
    '<label>Type *</label><select id="tp" required onchange="switchType()">' +
    '<option value="income">Income (Donation)</option><option value="expense">Expense</option></select>' +
    '<label>Category *</label><select id="cat" required><option value="">-- Select --</option>' +
    '<optgroup label="Income" id="og-income">' + incomeOpts + '</optgroup>' +
    '<optgroup label="Expense" id="og-expense">' + expenseOpts + '</optgroup>' +
    '</select>' +
    '<p class="hint" id="scripture-hint" style="display:none;">This is tracked under the Scripture Fund in the dashboard.</p>' +
    '<div id="pm-wrap">' +
    '<label>Payment Method *</label><select id="pm"><option value="">-- Select --</option>' + methodOpts + '</select>' +
    '<p class="hint">How this expense was paid.</p>' +
    '</div>' +
    '<label>Description *</label><input id="desc" placeholder="e.g. Venmo donation from John" required>' +
    '<label>Amount ($) *</label><input id="amt" type="number" step="0.01" min="0" placeholder="0.00" required>' +
    '<div class="r2"><div><label>Date</label><input id="dt" type="date"></div>' +
    '<div><label>Recorded By</label><input id="rb" placeholder="Your name"></div></div>' +
    '<label>Reference #</label><input id="ref" placeholder="Transaction ID, check #...">' +
    '<label>Notes</label><textarea id="nt" rows="2" placeholder="Optional..."></textarea>' +
    '<button type="submit" id="btn">Save Finance Entry</button><div id="st"></div></form>' +
    '<script>' +
    'document.getElementById("dt").valueAsDate=new Date();' +
    'function switchType(){' +
    '  var tp=document.getElementById("tp").value;' +
    '  var isIncome=(tp==="income");' +
    '  document.getElementById("og-income").style.display=isIncome?"":"none";' +
    '  document.getElementById("og-expense").style.display=isIncome?"none":"";' +
    '  document.getElementById("pm-wrap").style.display=isIncome?"none":"";' +
    '  document.getElementById("cat").value="";' +
    '  if(isIncome){document.getElementById("pm").value="";}' +
    '}' +
    'switchType();' +
    'document.getElementById("cat").addEventListener("change",function(){' +
    '  var v=this.value||"";' +
    '  document.getElementById("scripture-hint").style.display=/scripture/i.test(v)?"block":"none";' +
    '});' +
    'function save(e){e.preventDefault();var btn=document.getElementById("btn");btn.disabled=true;btn.textContent="Saving...";' +
    'var tp=document.getElementById("tp").value;' +
    'var cat=document.getElementById("cat").value;' +
    'var pm=(tp==="income")?cat:document.getElementById("pm").value;' +
    'google.script.run' +
    '.withSuccessHandler(function(){document.getElementById("st").innerHTML=\'<span style="color:#2C5F2E">Saved!</span>\';document.getElementById("f").reset();document.getElementById("dt").valueAsDate=new Date();switchType();btn.disabled=false;btn.textContent="Save Finance Entry";})' +
    '.withFailureHandler(function(err){document.getElementById("st").innerHTML=\'<span style="color:#c00">\'+(err.message||JSON.stringify(err))+\'</span>\';btn.disabled=false;btn.textContent="Save Finance Entry";})' +
    '.submitFinanceEntry({date:document.getElementById("dt").value,type:tp,category:cat,description:document.getElementById("desc").value,amount:document.getElementById("amt").value,payment_method:pm,reference:document.getElementById("ref").value,recorded_by:document.getElementById("rb").value,notes:document.getElementById("nt").value});' +
    '}' +
    '<\/script></body></html>';
}

// ── Dashboard sidebar ─────────────────────────────────────────────
function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var biblesOut=0, biblesIn=0, totalOut=0, totalIn=0, inventoryCostOut=0;
  var totalIncome=0, totalExp=0;
  var scriptureFundIncome=0, scriptureFundExp=0, generalExp=0;
  var rsvpCount=0, plCount=0;

  var inv = ss.getSheetByName('Inventory');
  if (inv) {
    var d = inv.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      var q = parseInt(d[i][4],10) || 0;
      var dr = String(d[i][5]||'').trim().toLowerCase();
      var itemId = String(d[i][2]||'').trim().toLowerCase();
      var totalCostCell = parseFloat(d[i][8]) || 0; // col I = total_cost
      var isBible = itemId.indexOf('pocket-') === 0 || itemId.indexOf('full-') === 0 || itemId.indexOf('large-') === 0;
      if (dr === 'out') {
        totalOut += q;
        inventoryCostOut += totalCostCell;
        if (isBible) biblesOut += q;
      }
      if (dr === 'in') {
        totalIn += q;
        if (isBible) biblesIn += q;
      }
    }
  }

  var fin = ss.getSheetByName(FINANCES_TAB);
  if (fin && fin.getLastRow() > 1) {
    var fData = fin.getRange(2, 1, fin.getLastRow()-1, fin.getLastColumn()).getValues();
    for (var j = 0; j < fData.length; j++) {
      var fType = String(fData[j][1]||'').toLowerCase();
      var fCat  = String(fData[j][2]||'').toLowerCase();
      var fAmt  = parseFloat(fData[j][4]) || 0;
      var isScripture = /scripture/i.test(fCat);

      if (fType === 'income') {
        totalIncome += fAmt;
        if (isScripture) scriptureFundIncome += fAmt;
      }
      if (fType === 'expense') {
        totalExp += fAmt;
        if (isScripture) scriptureFundExp += fAmt;
        else generalExp += fAmt;
      }
    }
  }

  var rs = ss.getSheetByName('RSVP'); if (rs) rsvpCount = Math.max(0, rs.getLastRow()-1);
  var pl = ss.getSheetByName(PLACEMENT_TAB); if (pl) plCount = Math.max(0, pl.getLastRow()-1);
  var bal = totalIncome - totalExp;
  var biblesNet = biblesIn - biblesOut;
  var scriptureNet = scriptureFundIncome - scriptureFundExp;

  function card(title,val,sub,cls) {
    return '<div class="card"><div class="ct">'+title+'</div><div class="val '+(cls||'')+'">'+val+'</div><div class="sub">'+sub+'</div></div>';
  }

  var html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Segoe UI,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;background:#FAFAF8;}' +
    'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    'h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#6B6B6B;margin:14px 0 6px;padding-top:8px;border-top:1px solid #E8E4DF;}' +
    '.g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}' +
    '.card{background:#fff;border:1px solid #E8E4DF;border-radius:8px;padding:10px 12px;}' +
    '.ct{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6B6B6B;margin-bottom:4px;}' +
    '.val{font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.1;}' +
    '.sub{font-size:10px;color:#9a9a9a;margin-top:3px;}' +
    '.gold{color:#B8860B;}.green{color:#2C5F2E;}.red{color:#c0392b;}.purple{color:#5d3a8a;}' +
    '.full{grid-column:1/-1;}.ts{font-size:10px;color:#bbb;text-align:center;margin-top:10px;}' +
    '</style></head><body>' +
    '<h2>Ministry Dashboard</h2><div class="g">' +
    card('Bibles Given Away', biblesOut, 'Pocket + Large Print + Full (out only)', 'gold') +
    card('Bibles Net Stock', biblesNet >= 0 ? '+'+biblesNet : biblesNet, 'Received \u2212 given away', biblesNet >= 0 ? 'green' : 'red') +
    card('Total Material Moved', totalOut, 'All items out (incl. tracts, merch)', '') +
    card('All Items Received', totalIn, 'All items in (restocks)', 'green') +
    '</div>' +
    '<h3>Finances (Finances Tab)</h3>' +
    '<div class="g">' +
    card('Total Income', '$'+totalIncome.toFixed(2), 'Finances tab \u2014 all donations', 'green') +
    card('Total Expenses', '$'+totalExp.toFixed(2), 'Finances tab \u2014 recorded costs', 'red') +
    '</div>' +
    '<div class="g"><div class="card full"><div class="ct">Current Balance</div><div class="val '+(bal>=0?'green':'red')+'">$'+bal.toFixed(2)+'</div><div class="sub">Income minus expenses (Finances tab)</div></div></div>' +
    '<h3>Inventory Value (Cost Out)</h3>' +
    '<div class="g"><div class="card full"><div class="ct">Total Inventory Cost Out</div><div class="val gold">$'+inventoryCostOut.toFixed(2)+'</div><div class="sub">Sum of total_cost where direction=out (matches cell O2)</div></div></div>' +
    '<h3>Scripture Fund</h3>' +
    '<div class="g">' +
    card('Scripture Donations', '$'+scriptureFundIncome.toFixed(2), 'Earmarked for Bibles', 'purple') +
    card('Scripture Purchases', '$'+scriptureFundExp.toFixed(2), 'Gideons orders', 'red') +
    '</div>' +
    '<div class="g"><div class="card full"><div class="ct">Scripture Fund Balance</div><div class="val '+(scriptureNet>=0?'green':'red')+'">$'+scriptureNet.toFixed(2)+'</div><div class="sub">Scripture donations \u2212 purchases</div></div></div>' +
    '<div class="g"><div class="card full"><div class="ct">General Ops Expenses</div><div class="val">$'+generalExp.toFixed(2)+'</div><div class="sub">Ministry supplies, misc, other</div></div></div>' +
    '<div class="g">' + card('Placement Records', plCount, 'Named placements') + card('Young Adults RSVPs', rsvpCount, 'Confirmed attendees') + '</div>' +
    '<div class="ts">Updated ' + new Date().toLocaleString() + '</div></body></html>';

  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle('STW Dashboard').setWidth(320));
}

// ── Monthly Finance PDF Report ────────────────────────────────────
/**
 * Shows a dialog asking which month/year to generate.
 */
function showMonthlyReportDialog() {
  var now = new Date();
  var monthOptions = '';
  for (var m = 0; m < 12; m++) {
    var sel = (m === now.getMonth()) ? ' selected' : '';
    monthOptions += '<option value="' + m + '"' + sel + '>' +
      ['January','February','March','April','May','June','July',
       'August','September','October','November','December'][m] + '</option>';
  }
  var html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '*{box-sizing:border-box;}body{font-family:Segoe UI,sans-serif;font-size:13px;padding:16px;color:#1a1a1a;}' +
    'h2{font-size:14px;margin:0 0 12px;color:#B8860B;border-bottom:2px solid #B8860B;padding-bottom:5px;}' +
    'label{display:block;font-weight:600;margin:8px 0 3px;font-size:12px;}' +
    'select,input{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;}' +
    'button{width:100%;margin-top:14px;padding:10px;background:#B8860B;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}' +
    'button:disabled{opacity:.6;cursor:not-allowed;}#st{text-align:center;margin-top:10px;font-size:12px;}' +
    '</style></head><body>' +
    '<h2>Monthly Finance Report</h2>' +
    '<label>Month</label><select id="mo">' + monthOptions + '</select>' +
    '<label>Year</label><input id="yr" type="number" value="' + now.getFullYear() + '" min="2020" max="2040">' +
    '<button id="btn" onclick="gen()">Generate PDF Report</button><div id="st"></div>' +
    '<script>function gen(){var btn=document.getElementById("btn");btn.disabled=true;btn.textContent="Generating...";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("st").innerHTML=\'<span style="color:#2C5F2E">\'+r+\'</span>\';btn.disabled=false;btn.textContent="Generate PDF Report";})' +
    '.withFailureHandler(function(e){document.getElementById("st").innerHTML=\'<span style="color:#c00">\'+(e.message||e)+\'</span>\';btn.disabled=false;btn.textContent="Generate PDF Report";})' +
    '.generateMonthlyFinanceReport(parseInt(document.getElementById("mo").value),parseInt(document.getElementById("yr").value));}<\/script>' +
    '</body></html>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(340).setHeight(280),
    'Monthly Finance Report'
  );
}

/**
 * Generates a monthly finance PDF, saves to Drive and emails to team.
 * @param {number} month 0-indexed month
 * @param {number} year  full year
 */
function generateMonthlyFinanceReport(month, year) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var fin = ss.getSheetByName(FINANCES_TAB);
  if (!fin || fin.getLastRow() < 2) throw new Error('No finance data found.');

  var monthNames = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
  var monthName = monthNames[month] + ' ' + year;
  var startDate = new Date(year, month, 1);
  var endDate   = new Date(year, month + 1, 0); // last day of month

  var data = fin.getRange(2, 1, fin.getLastRow()-1, fin.getLastColumn()).getValues();
  var entries = [];
  var totIncome = 0, totExpense = 0, totScriptureExp = 0, totGeneralExp = 0;
  var catTotals = {};

  for (var i = 0; i < data.length; i++) {
    var rowDate = new Date(data[i][0]);
    if (isNaN(rowDate.getTime())) continue;
    if (rowDate < startDate || rowDate > endDate) continue;

    var type    = String(data[i][1]||'').toLowerCase();
    var cat     = String(data[i][2]||'');
    var desc    = String(data[i][3]||'');
    var amount  = parseFloat(data[i][4]) || 0;
    var method  = String(data[i][5]||'');
    var ref     = String(data[i][6]||'');
    var note    = String(data[i][8]||'');
    var isScripture = /scripture/i.test(cat) || /\[scripture_fund\]/i.test(note);

    entries.push({ date: rowDate, type: type, category: cat, description: desc,
                   amount: amount, method: method, ref: ref, isScripture: isScripture });

    if (type === 'income') totIncome += amount;
    if (type === 'expense') {
      totExpense += amount;
      if (isScripture) totScriptureExp += amount;
      else totGeneralExp += amount;
    }

    var key = type + ':' + cat;
    catTotals[key] = (catTotals[key] || 0) + amount;
  }

  // Build PDF HTML
  var tableRows = entries.map(function(e) {
    var d = e.date;
    var ds = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
    return '<tr><td>' + ds + '</td><td>' + esc_(e.type) + '</td><td>' + esc_(e.category) +
           '</td><td>' + esc_(e.description) + '</td><td style="text-align:right">$' +
           e.amount.toFixed(2) + '</td><td>' + esc_(e.method) + '</td></tr>';
  }).join('');

  var catRows = Object.keys(catTotals).sort().map(function(key) {
    var parts = key.split(':');
    return '<tr><td>' + esc_(parts[0]) + '</td><td>' + esc_(parts[1]) +
           '</td><td style="text-align:right">$' + catTotals[key].toFixed(2) + '</td></tr>';
  }).join('');

  var bal = totIncome - totExpense;
  var pdfHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:10px;margin:28px 36px;color:#1a1a1a;}' +
    'h1{font-size:16px;text-align:center;margin:0 0 4px;color:#B8860B;}' +
    'h2{font-size:12px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px;}' +
    '.subtitle{text-align:center;font-size:10px;color:#666;margin:0 0 16px;}' +
    'table{width:100%;border-collapse:collapse;margin:6px 0 12px;}' +
    'th{background:#f0ede8;font-weight:bold;font-size:9px;border:1px solid #ccc;padding:4px;text-align:left;}' +
    'td{border:1px solid #ccc;padding:3px 5px;font-size:9px;}' +
    '.summary{display:flex;gap:20px;margin:10px 0;}' +
    '.sbox{border:1px solid #ccc;border-radius:4px;padding:8px 12px;flex:1;text-align:center;}' +
    '.sbox .label{font-size:8px;text-transform:uppercase;color:#666;margin-bottom:2px;}' +
    '.sbox .val{font-size:16px;font-weight:bold;}' +
    '.green{color:#2C5F2E;}.red{color:#c0392b;}.gold{color:#B8860B;}' +
    '.foot{font-size:8px;color:#999;margin-top:14px;text-align:center;}' +
    '</style></head><body>' +
    '<h1>Seed the Word — Monthly Finance Report</h1>' +
    '<p class="subtitle">' + esc_(monthName) + '</p>' +

    '<div class="summary">' +
    '<div class="sbox"><div class="label">Total Income</div><div class="val green">$' + totIncome.toFixed(2) + '</div></div>' +
    '<div class="sbox"><div class="label">Total Expenses</div><div class="val red">$' + totExpense.toFixed(2) + '</div></div>' +
    '<div class="sbox"><div class="label">Net Balance</div><div class="val ' + (bal >= 0 ? 'green' : 'red') + '">$' + bal.toFixed(2) + '</div></div>' +
    '</div>' +

    '<div class="summary">' +
    '<div class="sbox"><div class="label">Scripture Fund Expenses</div><div class="val gold">$' + totScriptureExp.toFixed(2) + '</div></div>' +
    '<div class="sbox"><div class="label">General Ops Expenses</div><div class="val">$' + totGeneralExp.toFixed(2) + '</div></div>' +
    '</div>' +

    '<h2>Category Breakdown</h2>' +
    '<table><thead><tr><th>Type</th><th>Category</th><th style="text-align:right">Total</th></tr></thead><tbody>' +
    catRows + '</tbody></table>' +

    '<h2>All Transactions (' + entries.length + ')</h2>' +
    '<table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th style="text-align:right">Amount</th><th>Method</th></tr></thead><tbody>' +
    tableRows + '</tbody></table>' +

    '<div class="foot">Generated ' + new Date().toLocaleString() + ' | Seed the Word Ministry</div>' +
    '</body></html>';

  var pdfBlob = HtmlService.createHtmlOutput(pdfHtml)
    .getAs('application/pdf')
    .setName('STW_Finance_' + monthName.replace(/\s/g,'_') + '.pdf');

  // Save to Drive
  var folder = DriveApp.getRootFolder();
  try {
    var ff = DriveApp.getFoldersByName('STW Finance Reports');
    folder = ff.hasNext() ? ff.next() : DriveApp.createFolder('STW Finance Reports');
  } catch(_) {}
  folder.createFile(pdfBlob);

  // Email to team
  try {
    MailApp.sendEmail({
      to: TEAM_EMAIL,
      subject: 'Monthly Finance Report: ' + monthName,
      body: 'Finance report for ' + monthName + ' attached.\n\nIncome: $' + totIncome.toFixed(2) +
            '\nExpenses: $' + totExpense.toFixed(2) + '\nNet: $' + bal.toFixed(2) +
            '\n\nScripture Fund: $' + totScriptureExp.toFixed(2) +
            '\nGeneral Ops: $' + totGeneralExp.toFixed(2),
      attachments: [pdfBlob]
    });
  } catch(emailErr) {
    Logger.log('Email failed (non-fatal): ' + emailErr);
  }

  return 'PDF generated and emailed! (' + entries.length + ' entries for ' + monthName + ')';
}

// ── Shared helpers ────────────────────────────────────────────────
function ensureTab_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#E8E4DF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function esc_(s) {
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
