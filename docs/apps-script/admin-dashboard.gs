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
  'Pocket Spanish':                        'pocket-nt-spanish',
  'Pocket Hindi Gideon':                   'pocket-nt-hindi-blue',
  'Pocket Farsi Persian':                  'pocket-nt-farsi-blue',
  'Pocket Thai + English Gideon':          'pocket-nt-thai-english-blue',
  'Pocket Mandarin Gideon':                'pocket-nt-mandarin',
  'Pocket Arabic':                         'pocket-nt-arabic',
  'Pocket French Gideon':                  'pocket-nt-french',
  'Large Print Gideon Brown':              'large-print-nt-brown',
  'Large Print Russian':                   'large-print-nt-russian',
  'Large Print Ukrainian':                 'large-print-nt-ukrainian',
  'Large Print Urdu Gideon':               'large-print-nt-urdu-blue',
  'Large Print Spanish + English Gideon':  'large-print-nt-spanish-english',
  'Large Print Arabic + English':          'large-print-nt-arabic-english',
  'Full Bible Large Print':                'full-bible-large-print',
  'Full Bible Pocket':                     'full-bible-pocket',
  'Life Book English':                     'tract-life-book-english',
  'Life Book Spanish':                     'tract-life-book-spanish',
  'Flip Books':                            'tract-flip-books-english',
  'Notebooks':                             'merch-notebooks',
  'Keychains & Bracelets':                 'merch-keychains-bracelets',
  'Stickers':                              'merch-stickers',
  'Mini Jesus Figurines':                  'merch-mini-fig',
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
    .addSeparator()
    .addItem('View Dashboard', 'showDashboard')
    .addToUi();
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
 * Called by the sidebar on load — returns recent "out" Inventory rows
 * with their row_id so the checklist can be populated.
 */
function getInventoryOutRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Inventory');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getDataRange().getValues();
  var rowIdCol = getInvRowIdCol_(data);
  var result = [];

  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    var dir = String(row[5]||'').trim().toLowerCase();
    if (dir !== 'out') continue;
    var rowId   = rowIdCol >= 0 ? String(row[rowIdCol]||'') : '';
    var date    = String(row[0]||'');
    var itemId  = String(row[2]||'');
    var name    = String(row[3]||'');
    var qty     = parseInt(row[4],10)||0;
    var source  = String(row[6]||'');
    var orderId = String(row[getInvOrderIdCol_(data)]||'');
    result.push({
      row_id:   rowId,
      date:     date,
      item_id:  itemId,
      name:     name || itemId,
      qty:      qty,
      source:   source,
      order_id: orderId,
      label:    (rowId ? '['+rowId+'] ' : '') + (name||itemId) + ' x'+qty + (date?' ('+date+')':'')
    });
    if (result.length >= 100) break; // cap at 100 most recent
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
    '.checklist{max-height:220px;overflow-y:auto;border:1px solid #E8E4DF;border-radius:4px;padding:6px;}' +
    '.chk-item{display:flex;align-items:flex-start;gap:6px;padding:5px 4px;border-bottom:1px solid #f0ede8;font-size:11px;cursor:pointer;}' +
    '.chk-item:last-child{border-bottom:none;}' +
    '.chk-item:hover{background:#fffbf0;}' +
    '.chk-item.selected{background:#fff8e8;}' +
    '.chk-item input[type=checkbox]{margin-top:2px;flex-shrink:0;accent-color:#B8860B;}' +
    '.chk-label{flex:1;line-height:1.4;}' +
    '.chk-id{font-size:10px;font-weight:700;color:#B8860B;min-width:70px;}' +
    '.chk-name{color:#1a1a1a;}' +
    '.chk-meta{font-size:10px;color:#888;}' +
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
        'if(!rows.length){cl.innerHTML=\'<div class="loading">No "out" rows found. Run "Tag Inventory Rows" first, or use the Add New Lines tab.</div>\';return;}' +
        'cl.innerHTML=rows.map(function(r,i){' +
          'return \'<label class="chk-item"><input type="checkbox" class="row-chk" value="\'+i+\'"><div class="chk-label"><span class="chk-id">\'+' +
            '(r.row_id||"(no ID)")+\'</span> <span class="chk-name">\'+r.name+\' x\'+r.qty+\'</span><br><span class="chk-meta">\'+r.date+(r.source?" · "+r.source:"")+\'</span></div></label>\';' +
        '}).join("");' +
      '})' +
      '.withFailureHandler(function(){document.getElementById("checklist").innerHTML=\'<div class="loading">Failed to load rows.</div>\';})' +
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
      newLines.forEach(function(line) {
        var qty  = parseInt(line.qty_placed,10) || 0;
        var cost = 2;
        maxNum++;
        var newRowId = 'INV-' + String(maxNum).padStart(4,'0');
        // Build row matching Inventory columns, then append row_id at end
        var newRow = [datePlaced, 'placement', line.item_id||'placement',
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
    HtmlService.createHtmlOutput(FINANCE_FORM_HTML_).setTitle('Log Finance Entry').setWidth(420)
  );
}

function submitFinanceEntry(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ensureTab_(ss, FINANCES_TAB, FINANCES_HEADERS);
    sheet.appendRow([data.date||new Date().toISOString().split('T')[0], data.type||'expense',
      data.category||'', data.description||'', parseFloat(data.amount)||0,
      data.payment_method||'', data.reference||'', data.recorded_by||'', data.notes||'']);
    return 'ok';
  } catch(err) { throw new Error('submitFinanceEntry failed: '+err.toString()); }
}

var FINANCE_FORM_HTML_ = '<!DOCTYPE html><html><head><base target="_top"><style>' +
  '*{box-sizing:border-box;}body{font-family:Segoe UI,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;}' +
  'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #2C5F2E;padding-bottom:5px;color:#2C5F2E;}' +
  'label{display:block;font-weight:600;margin:9px 0 3px;font-size:12px;}' +
  'input,select,textarea{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;}' +
  'input:focus,select:focus{outline:none;border-color:#2C5F2E;}' +
  '.r2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
  'button{display:block;width:100%;margin-top:12px;padding:10px;background:#2C5F2E;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}' +
  'button:disabled{opacity:.6;cursor:not-allowed;}#st{text-align:center;margin-top:10px;font-size:12px;}' +
  '</style></head><body>' +
  '<h2>Log Finance Entry</h2>' +
  '<form id="f" onsubmit="save(event)">' +
  '<label>Type *</label><select id="tp" required><option value="income">Income</option><option value="expense" selected>Expense</option></select>' +
  '<label>Category *</label><select id="cat" required><option value="">-- Select --</option>' +
  '<optgroup label="Income"><option value="donation-venmo">Donation - Venmo</option><option value="donation-cashapp">Donation - Cash App</option><option value="donation-zelle">Donation - Zelle</option><option value="donation-paypal">Donation - PayPal</option><option value="donation-cash">Donation - Cash/Check</option><option value="donation-other">Donation - Other</option></optgroup>' +
  '<optgroup label="Expense"><option value="bibles">Bible Purchase (Gideons)</option><option value="materials">Ministry Materials</option><option value="event">Event Costs</option><option value="shipping">Shipping/Postage</option><option value="supplies">Supplies</option><option value="other-expense">Other Expense</option></optgroup>' +
  '</select>' +
  '<label>Description *</label><input id="desc" placeholder="e.g. Venmo donation from John" required>' +
  '<label>Amount ($) *</label><input id="amt" type="number" step="0.01" min="0" placeholder="0.00" required>' +
  '<div class="r2"><div><label>Date</label><input id="dt" type="date"></div><div><label>Payment Method</label><select id="pm"><option value="">--</option><option>Venmo</option><option>Cash App</option><option>Zelle</option><option>PayPal</option><option>Cash</option><option>Check</option><option>Card</option></select></div></div>' +
  '<label>Reference #</label><input id="ref" placeholder="Transaction ID, check #...">' +
  '<label>Recorded By</label><input id="rb" placeholder="Your name">' +
  '<label>Notes</label><textarea id="nt" rows="2" placeholder="Optional..."></textarea>' +
  '<button type="submit" id="btn">Save Finance Entry</button><div id="st"></div></form>' +
  '<script>document.getElementById("dt").valueAsDate=new Date();' +
  'function save(e){e.preventDefault();var btn=document.getElementById("btn");btn.disabled=true;btn.textContent="Saving...";' +
  'google.script.run' +
  '.withSuccessHandler(function(){document.getElementById("st").innerHTML=\'<span style="color:#2C5F2E">Saved!</span>\';document.getElementById("f").reset();document.getElementById("dt").valueAsDate=new Date();btn.disabled=false;btn.textContent="Save Finance Entry";})' +
  '.withFailureHandler(function(e){document.getElementById("st").innerHTML=\'<span style="color:#c00">\'+(e.message||JSON.stringify(e))+\'</span>\';btn.disabled=false;btn.textContent="Save Finance Entry";})' +
  '.submitFinanceEntry({date:document.getElementById("dt").value,type:document.getElementById("tp").value,category:document.getElementById("cat").value,description:document.getElementById("desc").value,amount:document.getElementById("amt").value,payment_method:document.getElementById("pm").value,reference:document.getElementById("ref").value,recorded_by:document.getElementById("rb").value,notes:document.getElementById("nt").value});' +
  '}<\/script></body></html>';

// ── Dashboard sidebar ─────────────────────────────────────────────
function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var totalOut=0,totalIn=0,totalIncome=0,totalExp=0,rsvpCount=0,plCount=0;
  var inv=ss.getSheetByName('Inventory');
  if(inv){var d=inv.getDataRange().getValues();for(var i=1;i<d.length;i++){var q=parseInt(d[i][4],10)||0;var dr=String(d[i][5]||'').trim().toLowerCase();if(dr==='out')totalOut+=q;if(dr==='in')totalIn+=q;}}
  var fin=ss.getSheetByName(FINANCES_TAB);
  if(fin&&fin.getLastRow()>1){var f=fin.getRange(2,1,fin.getLastRow()-1,5).getValues();for(var j=0;j<f.length;j++){var t=String(f[j][1]||'').toLowerCase();var a=parseFloat(f[j][4])||0;if(t==='income')totalIncome+=a;if(t==='expense')totalExp+=a;}}
  var rs=ss.getSheetByName('RSVP');if(rs)rsvpCount=Math.max(0,rs.getLastRow()-1);
  var pl=ss.getSheetByName(PLACEMENT_TAB);if(pl)plCount=Math.max(0,pl.getLastRow()-1);
  var bal=totalIncome-totalExp;var net=totalIn-totalOut;
  function card(title,val,sub,cls){return '<div class="card"><div class="ct">'+title+'</div><div class="val '+(cls||'')+'">'+val+'</div><div class="sub">'+sub+'</div></div>';}
  var html='<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Segoe UI,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;background:#FAFAF8;}' +
    'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    '.g{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}' +
    '.card{background:#fff;border:1px solid #E8E4DF;border-radius:8px;padding:10px 12px;}' +
    '.ct{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6B6B6B;margin-bottom:4px;}' +
    '.val{font-size:22px;font-weight:700;color:#1A1A1A;line-height:1.1;}' +
    '.sub{font-size:10px;color:#9a9a9a;margin-top:3px;}' +
    '.gold{color:#B8860B;}.green{color:#2C5F2E;}.red{color:#c0392b;}' +
    '.full{grid-column:1/-1;}.ts{font-size:10px;color:#bbb;text-align:center;margin-top:10px;}' +
    '</style></head><body>' +
    '<h2>Ministry Dashboard</h2><div class="g">' +
    card('Bibles Given Away',totalOut,'Total out movements','gold') +
    card('Net Available',net,'Received - donated',net>=0?'green':'red') +
    card('Total Income','$'+totalIncome.toFixed(2),'All donations','green') +
    card('Total Expenses','$'+totalExp.toFixed(2),'All costs','red') +
    '</div><div class="g"><div class="card full"><div class="ct">Current Balance</div><div class="val '+(bal>=0?'green':'red')+'">$'+bal.toFixed(2)+'</div><div class="sub">Income minus expenses</div></div></div>' +
    '<div class="g">'+card('Placement Records',plCount,'Named placements')+card('Young Adults RSVPs',rsvpCount,'Confirmed attendees')+'</div>' +
    '<div class="ts">Updated '+new Date().toLocaleString()+'</div></body></html>';
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle('STW Dashboard').setWidth(320));
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
