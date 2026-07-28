/**
 * Seed the Word — Admin Dashboard (Google Apps Script)
 * ──────────────────────────────────────────────────────
 * Paste this into a SECOND file in the same Apps Script project
 * as order-handler.gs (click + beside "Files" in the editor).
 *
 * Adds a custom "STW Admin" menu to the spreadsheet with:
 *   1. MinistryStats auto-formula updater
 *   2. Log Placement Record (sidebar form → PlacementRecords tab)
 *   3. Generate Placement PDF (selected row → PDF email/Drive)
 *   4. Log Finance Entry (sidebar form → Finances tab)
 *   5. View Dashboard summary
 */

// ── Tab names ────────────────────────────────────────────────────
const PLACEMENT_TAB  = 'PlacementRecords';
const FINANCES_TAB   = 'Finances';

// ── Column headers ───────────────────────────────────────────────
const PLACEMENT_HEADERS = [
  'placement_id', 'date_assigned', 'team_member', 'institution',
  'address', 'official_name', 'contact_phone', 'contact_email',
  'num_rooms_students', 'scripture_type', 'qty_needed',
  'qty_placed', 'date_placed', 'event_source', 'notes'
];

const FINANCES_HEADERS = [
  'date', 'type', 'category', 'description',
  'amount', 'payment_method', 'reference', 'recorded_by', 'notes'
];

// ── Menu ─────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STW Admin')
    .addItem('📊 Refresh MinistryStats formulas', 'refreshMinistryStatsFormulas')
    .addSeparator()
    .addItem('📋 Log Placement Record', 'showPlacementForm')
    .addItem('📄 Generate Placement PDF (selected row)', 'generatePlacementPdf')
    .addSeparator()
    .addItem('💰 Log Finance Entry', 'showFinanceForm')
    .addSeparator()
    .addItem('📈 View Dashboard', 'showDashboard')
    .addToUi();
}

// ── 1. MinistryStats formula refresh ─────────────────────────────
/**
 * Writes SUMIFS formulas into the MinistryStats tab so that
 * donated_total and on_hand (net available) are always calculated
 * directly from the Inventory tab — no manual JSON editing needed.
 *
 * Adds/updates three summary rows per item_id found in MinistryStats:
 *   - donated_total  = SUMIFS(Inventory qty, item_id, "out")
 *   - received_total = SUMIFS(Inventory qty, item_id, "in")
 *   - net_available  = received_total - donated_total
 *
 * Also adds a SUMMARY section showing language-level aggregates.
 */
function refreshMinistryStatsFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Ensure tabs exist
  ensureTab_(ss, 'Inventory', ['date','type','item_id','item_name','qty','direction','event_source','cost_per_unit','total_cost','notes','order_id']);
  var statsSheet = ensureTab_(ss, 'MinistryStats', ['key','value','note']);

  // Find or create the computed summary section starting below existing rows
  var lastRow = statsSheet.getLastRow();

  // Write a divider + auto-computed section header
  var writeRow = lastRow + 2;
  statsSheet.getRange(writeRow, 1, 1, 3).setValues([['--- AUTO-COMPUTED FROM INVENTORY (do not edit below) ---', '', 'Refreshed: ' + new Date().toLocaleString()]]);
  statsSheet.getRange(writeRow, 1, 1, 3).setFontWeight('bold').setBackground('#f5f3f0');
  writeRow++;

  // Headers for the computed section
  statsSheet.getRange(writeRow, 1, 1, 4).setValues([['item_id', 'donated_total (out)', 'received_total (in)', 'net_available']]);
  statsSheet.getRange(writeRow, 1, 1, 4).setFontWeight('bold').setBackground('#E8E4DF');
  writeRow++;

  // Get distinct item_ids from the Inventory tab
  var invSheet = ss.getSheetByName('Inventory');
  if (!invSheet) {
    SpreadsheetApp.getUi().alert('Inventory tab not found. Add inventory records first.');
    return;
  }
  var invData = invSheet.getDataRange().getValues();
  var itemIds = {};
  for (var i = 1; i < invData.length; i++) {
    var id = String(invData[i][2] || '').trim(); // column C = item_id
    if (id) itemIds[id] = true;
  }

  var ids = Object.keys(itemIds).sort();
  if (!ids.length) {
    statsSheet.getRange(writeRow, 1).setValue('(no item_ids found in Inventory yet)');
    SpreadsheetApp.getUi().alert('No item_ids found in Inventory tab yet.');
    return;
  }

  // Write one formula row per item_id
  var rows = ids.map(function(id) {
    var idEsc = id.replace(/"/g, '""');
    var donatedFormula  = '=SUMIFS(Inventory!E:E,Inventory!C:C,"' + idEsc + '",Inventory!F:F,"out")';
    var receivedFormula = '=SUMIFS(Inventory!E:E,Inventory!C:C,"' + idEsc + '",Inventory!F:F,"in")';
    var netFormula      = '=' + 'INDIRECT("R[0]C[-1]",FALSE)-INDIRECT("R[0]C[-2]",FALSE)';
    return [id, donatedFormula, receivedFormula, ''];
  });

  // Write item rows
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var targetRow = writeRow + r;
    statsSheet.getRange(targetRow, 1).setValue(row[0]);
    statsSheet.getRange(targetRow, 2).setFormula(
      '=SUMIFS(Inventory!E:E,Inventory!C:C,"' + row[0].replace(/"/g, '""') + '",Inventory!F:F,"out")'
    );
    statsSheet.getRange(targetRow, 3).setFormula(
      '=SUMIFS(Inventory!E:E,Inventory!C:C,"' + row[0].replace(/"/g, '""') + '",Inventory!F:F,"in")'
    );
    // Net = received - donated (col 3 - col 2)
    statsSheet.getRange(targetRow, 4).setFormula('=C' + targetRow + '-B' + targetRow);
  }

  // Language-level summary section
  var summaryRow = writeRow + ids.length + 2;
  statsSheet.getRange(summaryRow, 1, 1, 4).setValues([['--- LANGUAGE SUMMARY ---', '', '', '']]);
  statsSheet.getRange(summaryRow, 1, 1, 4).setFontWeight('bold').setBackground('#f5f3f0');
  summaryRow++;
  statsSheet.getRange(summaryRow, 1, 1, 4).setValues([['language', 'donated_total', 'received_total', 'net_available']]);
  statsSheet.getRange(summaryRow, 1, 1, 4).setFontWeight('bold').setBackground('#E8E4DF');
  summaryRow++;

  // Aggregate by language using a distinct list from Inventory col D (item_name contains language via ID map)
  // We use a SUMIF on the item_name column for simplicity
  var languages = ['English','Hindi','Russian','Ukrainian','Farsi','Urdu','Thai','Mandarin','Spanish','Arabic','French'];
  var langIdMap = {
    'English':   ['pocket-nt-red','pocket-nt-grey','large-print-nt-brown','full-bible-large-print','full-bible-pocket'],
    'Hindi':     ['pocket-nt-hindi-blue'],
    'Russian':   ['large-print-nt-russian'],
    'Ukrainian': ['large-print-nt-ukrainian'],
    'Farsi':     ['pocket-nt-farsi-blue'],
    'Urdu':      ['large-print-nt-urdu-blue'],
    'Thai':      ['pocket-nt-thai-english-blue'],
    'Mandarin':  ['pocket-nt-mandarin'],
    'Spanish':   ['large-print-nt-spanish-english'],
    'Arabic':    ['large-print-nt-arabic-english','pocket-nt-arabic'],
    'French':    ['pocket-nt-french'],
  };

  languages.forEach(function(lang) {
    var langIds = langIdMap[lang] || [];
    if (!langIds.length) return;
    var donatedParts  = langIds.map(function(id) { return 'SUMIFS(Inventory!E:E,Inventory!C:C,"' + id + '",Inventory!F:F,"out")'; });
    var receivedParts = langIds.map(function(id) { return 'SUMIFS(Inventory!E:E,Inventory!C:C,"' + id + '",Inventory!F:F,"in")'; });
    statsSheet.getRange(summaryRow, 1).setValue(lang);
    statsSheet.getRange(summaryRow, 2).setFormula('=' + donatedParts.join('+'));
    statsSheet.getRange(summaryRow, 3).setFormula('=' + receivedParts.join('+'));
    statsSheet.getRange(summaryRow, 4).setFormula('=C' + summaryRow + '-B' + summaryRow);
    summaryRow++;
  });

  SpreadsheetApp.getUi().alert('✅ MinistryStats formulas refreshed!\n\nDonated and net-available counts now auto-calculate from your Inventory tab. Check the bottom of the MinistryStats sheet.');
}

// ── 2. Placement Record sidebar form ─────────────────────────────
function showPlacementForm() {
  var html = HtmlService.createHtmlOutput(PLACEMENT_FORM_HTML)
    .setTitle('Log Placement Record')
    .setWidth(480);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Called by the sidebar form on submit.
 * Appends a row to PlacementRecords and returns the new placement_id.
 */
function submitPlacementRecord(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Get or create PlacementRecords tab
    var sheet = ensureTab_(ss, PLACEMENT_TAB, PLACEMENT_HEADERS);
    var id = 'PLR-' + new Date().getTime();
    sheet.appendRow([
      id,
      data.date_assigned   || new Date().toISOString().split('T')[0],
      data.team_member     || '',
      data.institution     || '',
      data.address         || '',
      data.official_name   || '',
      data.contact_phone   || '',
      data.contact_email   || '',
      data.num_rooms       || '',
      data.scripture_type  || '',
      parseInt(data.qty_needed, 10)  || 0,
      parseInt(data.qty_placed, 10)  || 0,
      data.date_placed     || '',
      data.event_source    || '',
      data.notes           || ''
    ]);

    // Also log to Inventory as an "out" movement
    // Use getSheetByName first — Inventory already exists, don't recreate it
    var inventorySheet = ss.getSheetByName('Inventory');
    if (!inventorySheet) {
      inventorySheet = ensureTab_(ss, 'Inventory', ['date','type','item_id','item_name','qty','direction','event_source','cost_per_unit','total_cost','notes','order_id']);
    }
    inventorySheet.appendRow([
      data.date_placed || new Date().toISOString().split('T')[0],
      'placement',
      data.item_id        || 'mixed-assortment',
      data.scripture_type || '',
      parseInt(data.qty_placed, 10) || 0,
      'out',
      data.institution || data.event_source || '',
      2,
      (parseInt(data.qty_placed, 10) || 0) * 2,
      data.notes || '',
      id
    ]);

    return id;
  } catch(err) {
    throw new Error('submitPlacementRecord failed: ' + err.toString());
  }
}

const PLACEMENT_FORM_HTML = `<!DOCTYPE html>
<html>
<head>
<base target="_top">
<style>
  body{font-family:'Segoe UI',sans-serif;font-size:13px;padding:12px;color:#1a1a1a;}
  h2{font-size:15px;margin:0 0 12px;border-bottom:2px solid #B8860B;padding-bottom:6px;color:#B8860B;}
  label{display:block;font-weight:600;margin:10px 0 3px;font-size:12px;}
  input,select,textarea{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;box-sizing:border-box;}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#B8860B;}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  button{display:block;width:100%;margin-top:14px;padding:10px;background:#B8860B;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}
  button:hover{background:#a07008;}
  #status{text-align:center;margin-top:10px;font-size:12px;min-height:20px;}
</style>
</head>
<body>
<h2>📋 Log Placement Record</h2>
<form id="f">
  <label>Institution / Location *</label>
  <input id="institution" placeholder="e.g. Wiggums Hollow Park" required>

  <label>Address</label>
  <input id="address" placeholder="Street, City, State">

  <label>Institution Official / Contact</label>
  <input id="official_name" placeholder="Name of person you met">

  <div class="row">
    <div><label>Phone</label><input id="contact_phone" type="tel" placeholder="(555) 123-4567"></div>
    <div><label>Email</label><input id="contact_email" type="email" placeholder="contact@org.com"></div>
  </div>

  <label>Rooms / Students / People</label>
  <input id="num_rooms" placeholder="e.g. 200 students, 50 families">

  <label>Scripture Type *</label>
  <select id="scripture_type">
    <option value="">— Select —</option>
    <option>Pocket NT (English)</option>
    <option>Pocket NT (Hindi)</option>
    <option>Pocket NT (Farsi)</option>
    <option>Pocket NT (Russian)</option>
    <option>Pocket NT (Ukrainian)</option>
    <option>Pocket NT (Urdu)</option>
    <option>Pocket NT (Thai)</option>
    <option>Pocket NT (Mandarin)</option>
    <option>Pocket NT (Spanish)</option>
    <option>Pocket NT (Arabic)</option>
    <option>Large Print NT (English)</option>
    <option>Full Bible</option>
    <option>Mixed Assortment</option>
  </select>

  <label>Item ID (from Inventory)</label>
  <input id="item_id" placeholder="e.g. pocket-nt-red">

  <div class="row">
    <div><label>Qty Needed</label><input id="qty_needed" type="number" min="0" value="0"></div>
    <div><label>Qty Placed *</label><input id="qty_placed" type="number" min="0" value="0" required></div>
  </div>

  <div class="row">
    <div><label>Date Assigned</label><input id="date_assigned" type="date"></div>
    <div><label>Date Placed</label><input id="date_placed" type="date"></div>
  </div>

  <label>Team Member</label>
  <input id="team_member" placeholder="Who carried out the placement?">

  <label>Event Source</label>
  <input id="event_source" placeholder="e.g. Community Cookout, UW Campus Visit">

  <label>Notes</label>
  <textarea id="notes" rows="2" placeholder="Any additional context..."></textarea>

  <button type="submit">Save Placement Record</button>
  <div id="status"></div>
</form>
<script>
document.getElementById('f').addEventListener('submit', function(e) {
  e.preventDefault();
  var btn = document.querySelector('button');
  btn.disabled = true; btn.textContent = 'Saving...';
  var data = {
    institution:    document.getElementById('institution').value,
    address:        document.getElementById('address').value,
    official_name:  document.getElementById('official_name').value,
    contact_phone:  document.getElementById('contact_phone').value,
    contact_email:  document.getElementById('contact_email').value,
    num_rooms:      document.getElementById('num_rooms').value,
    scripture_type: document.getElementById('scripture_type').value,
    item_id:        document.getElementById('item_id').value,
    qty_needed:     document.getElementById('qty_needed').value,
    qty_placed:     document.getElementById('qty_placed').value,
    date_assigned:  document.getElementById('date_assigned').value,
    date_placed:    document.getElementById('date_placed').value,
    team_member:    document.getElementById('team_member').value,
    event_source:   document.getElementById('event_source').value,
    notes:          document.getElementById('notes').value,
  };
  google.script.run
    .withSuccessHandler(function(id) {
      document.getElementById('status').innerHTML = '<span style="color:#2C5F2E">✅ Saved! ID: ' + id + '</span>';
      document.getElementById('f').reset();
      btn.disabled = false; btn.textContent = 'Save Placement Record';
    })
    .withFailureHandler(function(err) {
      document.getElementById('status').innerHTML = '<span style="color:#c00">❌ Error: ' + (err.message || JSON.stringify(err)) + '</span>';
      btn.disabled = false; btn.textContent = 'Save Placement Record';
    })
    .submitPlacementRecord(data);
});
</script>
</body>
</html>`;

// ── 3. Generate Placement PDF ─────────────────────────────────────
/**
 * Reads the selected row in PlacementRecords and generates a PDF
 * that mirrors the Gideons Scripture Placement Record (Item 542).
 * Saves to Drive and emails to TEAM_INBOX.
 */
function generatePlacementPdf() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PLACEMENT_TAB);
  if (!sheet) { SpreadsheetApp.getUi().alert('PlacementRecords tab not found. Log a record first.'); return; }

  var row = sheet.getActiveRange().getRow();
  if (row <= 1) { SpreadsheetApp.getUi().alert('Select a data row (not the header).'); return; }

  var data = sheet.getRange(row, 1, 1, PLACEMENT_HEADERS.length).getValues()[0];
  var rec = {};
  PLACEMENT_HEADERS.forEach(function(h, i) { rec[h] = data[i] || ''; });

  var html = buildPlacementPdfHtml_(rec);
  var blob = HtmlService.createHtmlOutput(html)
    .getAs('application/pdf')
    .setName('PlacementRecord_' + rec.placement_id + '.pdf');

  // Save to Drive
  var folder = DriveApp.getRootFolder();
  try {
    var folders = DriveApp.getFoldersByName('STW Placement Records');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('STW Placement Records');
  } catch(_) {}
  var file = folder.createFile(blob);

  // Email to team
  try {
    MailApp.sendEmail({
      to: 'seedthewordministry@gmail.com',
      subject: 'Placement Record: ' + rec.institution + ' (' + rec.date_placed + ')',
      body: 'Placement record attached. ID: ' + rec.placement_id,
      attachments: [blob]
    });
  } catch(e) { console.log('PDF email failed (non-fatal):', e); }

  SpreadsheetApp.getUi().alert('✅ PDF generated!\nSaved to Drive → STW Placement Records\nAlso emailed to seedthewordministry@gmail.com\n\nFile: ' + file.getName());
}

function buildPlacementPdfHtml_(r) {
  var rows = '';
  for (var i = 0; i < 20; i++) {
    if (i === 0) {
      rows += '<tr><td>' + esc_(r.date_assigned) + '</td><td>' + esc_(r.team_member) + '</td><td>' + esc_(r.scripture_type) + '</td><td>' + esc_(r.qty_needed) + '</td><td>' + esc_(r.date_placed) + '</td></tr>';
    } else {
      rows += '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';
    }
  }
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;margin:40px;}' +
    'h1{text-align:center;font-size:16px;font-weight:bold;margin-bottom:24px;}' +
    '.field{margin-bottom:10px;}' +
    '.field label{font-size:10px;display:inline-block;min-width:120px;}' +
    '.field .val{border-bottom:1px solid #000;display:inline-block;min-width:240px;padding-bottom:2px;}' +
    'table{width:100%;border-collapse:collapse;margin-top:20px;}' +
    'th,td{border:1px solid #000;padding:5px 8px;font-size:10px;text-align:left;height:22px;}' +
    'th{background:#f0f0f0;font-weight:bold;text-align:center;}' +
    '.footer{margin-top:16px;font-size:9px;color:#666;}' +
    '</style></head><body>' +
    '<h1>SCRIPTURE PLACEMENT RECORD</h1>' +
    '<div class="field"><label>Institution</label><span class="val">' + esc_(r.institution) + '</span></div>' +
    '<div class="field"><label>Address</label><span class="val">' + esc_(r.address) + '</span></div>' +
    '<div class="field"><label>Institution Official</label><span class="val">' + esc_(r.official_name) + '</span></div>' +
    '<div class="field"><label>Position / Phone</label><span class="val">' + esc_(r.contact_phone) + '</span></div>' +
    '<div class="field"><label>E-mail</label><span class="val">' + esc_(r.contact_email) + '</span>&nbsp;&nbsp;<label>Fax</label><span class="val" style="min-width:100px;"></span></div>' +
    '<div class="field"><label>Number of Rooms, Students, Etc.</label><span class="val">' + esc_(r.num_rooms_students) + '</span></div>' +
    '<table><thead><tr>' +
    '<th>DATE ASSIGNED</th><th>GIDEON ASSIGNED</th><th>TYPE SCRIPTURE NEEDED</th><th>NUMBER SCRIPTURES NEEDED</th><th>DATE SCRIPTURES PLACED</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="footer">Item 542 8/2017 &nbsp;|&nbsp; Seed the Word Ministry &nbsp;|&nbsp; Placement ID: ' + esc_(r.placement_id) + ' &nbsp;|&nbsp; Notes: ' + esc_(r.notes) + '</div>' +
    '</body></html>';
}

// ── 4. Finance Entry sidebar form ────────────────────────────────
function showFinanceForm() {
  var html = HtmlService.createHtmlOutput(FINANCE_FORM_HTML)
    .setTitle('Log Finance Entry')
    .setWidth(420);
  SpreadsheetApp.getUi().showSidebar(html);
}

function submitFinanceEntry(data) {
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
}

const FINANCE_FORM_HTML = `<!DOCTYPE html>
<html>
<head>
<base target="_top">
<style>
  body{font-family:'Segoe UI',sans-serif;font-size:13px;padding:12px;color:#1a1a1a;}
  h2{font-size:15px;margin:0 0 12px;border-bottom:2px solid #2C5F2E;padding-bottom:6px;color:#2C5F2E;}
  label{display:block;font-weight:600;margin:10px 0 3px;font-size:12px;}
  input,select,textarea{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;box-sizing:border-box;}
  input:focus,select:focus{outline:none;border-color:#2C5F2E;}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .income{background:#e8f5e9;} .expense{background:#fce4ec;}
  button{display:block;width:100%;margin-top:14px;padding:10px;background:#2C5F2E;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}
  button:hover{background:#1e4420;}
  #status{text-align:center;margin-top:10px;font-size:12px;min-height:20px;}
</style>
</head>
<body>
<h2>💰 Log Finance Entry</h2>
<form id="f">
  <label>Type *</label>
  <select id="type" required>
    <option value="income">💚 Income (donation received)</option>
    <option value="expense" selected>🔴 Expense (money spent)</option>
  </select>

  <label>Category *</label>
  <select id="category" required>
    <option value="">— Select —</option>
    <optgroup label="Income">
      <option value="donation-online">Donation (Online)</option>
      <option value="donation-cash">Donation (Cash/Check)</option>
      <option value="donation-venmo">Donation (Venmo)</option>
      <option value="donation-cashapp">Donation (Cash App)</option>
      <option value="donation-zelle">Donation (Zelle)</option>
      <option value="donation-paypal">Donation (PayPal)</option>
    </optgroup>
    <optgroup label="Expense">
      <option value="bibles">Bible Purchase (Gideons)</option>
      <option value="materials">Ministry Materials</option>
      <option value="event">Event Costs</option>
      <option value="shipping">Shipping / Postage</option>
      <option value="supplies">Office / General Supplies</option>
      <option value="other-expense">Other Expense</option>
    </optgroup>
  </select>

  <label>Description *</label>
  <input id="description" placeholder="e.g. Venmo donation from John D., 50 Pocket NTs from Gideons" required>

  <label>Amount ($) *</label>
  <input id="amount" type="number" step="0.01" min="0" placeholder="0.00" required>

  <div class="row">
    <div><label>Date</label><input id="date" type="date"></div>
    <div><label>Payment Method</label>
      <select id="payment_method">
        <option value="">—</option>
        <option>Venmo</option><option>Cash App</option><option>Zelle</option>
        <option>PayPal</option><option>Cash</option><option>Check</option><option>Card</option>
      </select>
    </div>
  </div>

  <label>Reference # (optional)</label>
  <input id="reference" placeholder="Transaction ID, check #, etc.">

  <label>Recorded By</label>
  <input id="recorded_by" placeholder="Your name">

  <label>Notes</label>
  <textarea id="notes" rows="2" placeholder="Any additional context..."></textarea>

  <button type="submit">Save Finance Entry</button>
  <div id="status"></div>
</form>
<script>
  // Pre-fill today's date
  document.getElementById('date').valueAsDate = new Date();

  document.getElementById('f').addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.querySelector('button');
    btn.disabled = true; btn.textContent = 'Saving...';
    var data = {
      date:           document.getElementById('date').value,
      type:           document.getElementById('type').value,
      category:       document.getElementById('category').value,
      description:    document.getElementById('description').value,
      amount:         document.getElementById('amount').value,
      payment_method: document.getElementById('payment_method').value,
      reference:      document.getElementById('reference').value,
      recorded_by:    document.getElementById('recorded_by').value,
      notes:          document.getElementById('notes').value,
    };
    google.script.run
      .withSuccessHandler(function() {
        document.getElementById('status').innerHTML = '<span style="color:#2C5F2E">✅ Saved successfully!</span>';
        document.getElementById('f').reset();
        document.getElementById('date').valueAsDate = new Date();
        btn.disabled = false; btn.textContent = 'Save Finance Entry';
      })
      .withFailureHandler(function(err) {
        document.getElementById('status').innerHTML = '<span style="color:#c00">❌ ' + (err.message || JSON.stringify(err)) + '</span>';
        btn.disabled = false; btn.textContent = 'Save Finance Entry';
      })
      .submitFinanceEntry(data);
  });
</script>
</body>
</html>`;

// ── 5. Dashboard summary sidebar ─────────────────────────────────
function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Gather totals
  var totalDonated = 0, totalReceived = 0;
  var invSheet = ss.getSheetByName('Inventory');
  if (invSheet) {
    var inv = invSheet.getDataRange().getValues();
    for (var i = 1; i < inv.length; i++) {
      var qty = parseInt(inv[i][4], 10) || 0;
      var dir = String(inv[i][5] || '').trim().toLowerCase();
      if (dir === 'out') totalDonated  += qty;
      if (dir === 'in')  totalReceived += qty;
    }
  }

  var totalIncome = 0, totalExpenses = 0;
  var finSheet = ss.getSheetByName(FINANCES_TAB);
  if (finSheet) {
    var fin = finSheet.getDataRange().getValues();
    for (var j = 1; j < fin.length; j++) {
      var type   = String(fin[j][1] || '').toLowerCase();
      var amount = parseFloat(fin[j][4]) || 0;
      if (type === 'income')  totalIncome   += amount;
      if (type === 'expense') totalExpenses += amount;
    }
  }

  var rsvpCount = 0;
  var rsvpSheet = ss.getSheetByName('RSVP');
  if (rsvpSheet) rsvpCount = Math.max(0, rsvpSheet.getLastRow() - 1);

  var placementCount = 0;
  var plSheet = ss.getSheetByName(PLACEMENT_TAB);
  if (plSheet) placementCount = Math.max(0, plSheet.getLastRow() - 1);

  var balance = totalIncome - totalExpenses;
  var netAvail = totalReceived - totalDonated;

  var html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:"Segoe UI",sans-serif;font-size:13px;padding:14px;color:#1a1a1a;}' +
    'h2{font-size:15px;margin:0 0 14px;border-bottom:2px solid #B8860B;padding-bottom:6px;color:#B8860B;}' +
    '.card{background:#FAFAF8;border:1px solid #E8E4DF;border-radius:8px;padding:12px 14px;margin-bottom:10px;}' +
    '.card h3{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6B6B6B;}' +
    '.val{font-size:22px;font-weight:700;color:#1A1A1A;}' +
    '.sub{font-size:11px;color:#6B6B6B;margin-top:2px;}' +
    '.green{color:#2C5F2E;} .red{color:#c0392b;} .gold{color:#B8860B;}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
    '</style></head><body>' +
    '<h2>📊 Ministry Dashboard</h2>' +
    '<div class="grid">' +
    '<div class="card"><h3>Bibles Given Away</h3><div class="val gold">' + totalDonated + '</div><div class="sub">Total out movements</div></div>' +
    '<div class="card"><h3>Net Available</h3><div class="val ' + (netAvail >= 0 ? 'green' : 'red') + '">' + netAvail + '</div><div class="sub">Received - donated</div></div>' +
    '<div class="card"><h3>Total Income</h3><div class="val green">$' + totalIncome.toFixed(2) + '</div><div class="sub">All donations</div></div>' +
    '<div class="card"><h3>Total Expenses</h3><div class="val red">$' + totalExpenses.toFixed(2) + '</div><div class="sub">All costs</div></div>' +
    '</div>' +
    '<div class="card"><h3>Current Balance</h3><div class="val ' + (balance >= 0 ? 'green' : 'red') + '">$' + balance.toFixed(2) + '</div><div class="sub">Income minus expenses</div></div>' +
    '<div class="grid">' +
    '<div class="card"><h3>Placement Records</h3><div class="val">' + placementCount + '</div><div class="sub">Logged placements</div></div>' +
    '<div class="card"><h3>Young Adults RSVPs</h3><div class="val">' + rsvpCount + '</div><div class="sub">Confirmed attendees</div></div>' +
    '</div>' +
    '<p style="font-size:10px;color:#aaa;margin-top:12px;text-align:center;">Updated ' + new Date().toLocaleString() + '</p>' +
    '</body></html>';

  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html).setTitle('STW Dashboard').setWidth(340)
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
