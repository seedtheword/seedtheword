/**
 * Seed the Word - Admin Dashboard (Google Apps Script)
 * Container-bound script - paste into the script editor opened from
 * Extensions -> Apps Script inside the STW Order Ledger spreadsheet.
 */

const PLACEMENT_TAB  = 'PlacementRecords';
const FINANCES_TAB   = 'Finances';
const TEAM_EMAIL     = 'seedthewordministry@gmail.com';

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

const SCRIPTURE_ITEM_MAP = {
  // Bibles — Pocket NTs
  'Pocket Personal Testimony Gideon Red':  'pocket-nt-red',
  'Pocket Friend of Gideon Grey':          'pocket-nt-grey',
  'Pocket Spanish':                        'pocket-nt-spanish',
  'Pocket Hindi Gideon':                   'pocket-nt-hindi-blue',
  'Pocket Farsi Persian':                  'pocket-nt-farsi-blue',
  'Pocket Thai + English Gideon':          'pocket-nt-thai-english-blue',
  'Pocket Mandarin Gideon':                'pocket-nt-mandarin',
  'Pocket Arabic':                         'pocket-nt-arabic',
  'Pocket French Gideon':                  'pocket-nt-french',
  // Bibles — Large Print NTs
  'Large Print Gideon Brown':              'large-print-nt-brown',
  'Large Print Russian':                   'large-print-nt-russian',
  'Large Print Ukrainian':                 'large-print-nt-ukrainian',
  'Large Print Urdu Gideon':               'large-print-nt-urdu-blue',
  'Large Print Spanish + English Gideon':  'large-print-nt-spanish-english',
  'Large Print Arabic + English':          'large-print-nt-arabic-english',
  // Bibles — Full
  'Full Bible Large Print':                'full-bible-large-print',
  'Full Bible Pocket':                     'full-bible-pocket',
  // Tracts
  'Life Book English':                     'tract-life-book-english',
  'Life Book Spanish':                     'tract-life-book-spanish',
  'Flip Books':                            'tract-flip-books-english',
  // Merch / Ministry Materials
  'Notebooks':                             'merch-notebooks',
  'Keychains & Bracelets':                 'merch-keychains-bracelets',
  'Stickers':                              'merch-stickers',
  'Mini Jesus Figurines':                  'merch-mini-fig',
  'Bookmarks':                             'merch-bookmarks'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STW Admin')
    .addItem('Refresh MinistryStats formulas', 'refreshMinistryStatsFormulas')
    .addSeparator()
    .addItem('Log Placement Record', 'showPlacementForm')
    .addItem('Generate Placement PDF', 'showPdfForm')
    .addSeparator()
    .addItem('Log Finance Entry', 'showFinanceForm')
    .addSeparator()
    .addItem('View Dashboard', 'showDashboard')
    .addToUi();
}

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
    'Hindi':    ['pocket-nt-hindi-blue'], 'Russian': ['large-print-nt-russian'],
    'Ukrainian':['large-print-nt-ukrainian'], 'Farsi': ['pocket-nt-farsi-blue'],
    'Urdu':     ['large-print-nt-urdu-blue'], 'Thai': ['pocket-nt-thai-english-blue'],
    'Mandarin': ['pocket-nt-mandarin'], 'Spanish': ['pocket-nt-spanish','large-print-nt-spanish-english'],
    'Arabic':   ['large-print-nt-arabic-english','pocket-nt-arabic'], 'French': ['pocket-nt-french']
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
  SpreadsheetApp.getUi().alert('MinistryStats formulas refreshed! Check the bottom of MinistryStats.');
}

function showPlacementForm() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(getPlacementFormHtml_()).setTitle('Log Placement Record').setWidth(500)
  );
}

function submitPlacementRecord(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ev = data.event || {};
    var lines = data.scriptures || [];
    if (!lines.length) throw new Error('Add at least one scripture line.');
    var id = 'PLR-' + new Date().getTime();
    var totalPlaced = lines.reduce(function(s,l){ return s+(parseInt(l.qty_placed,10)||0); }, 0);
    var plSheet = ensureTab_(ss, PLACEMENT_TAB, PLACEMENT_HEADERS);
    plSheet.appendRow([id, ev.date_assigned||'', ev.date_placed||new Date().toISOString().split('T')[0],
      ev.team_member||'', ev.institution||'', ev.address||'', ev.official_name||'',
      ev.contact_phone||'', ev.contact_email||'', ev.num_rooms||'', ev.event_source||'',
      totalPlaced, ev.notes||'']);
    var invSheet = ss.getSheetByName('Inventory') ||
      ensureTab_(ss,'Inventory',['date','type','item_id','item_name','qty','direction','event_source','cost_per_unit','total_cost','notes','order_id']);
    var datePlaced = ev.date_placed || new Date().toISOString().split('T')[0];
    var source = ev.institution || ev.event_source || '';
    lines.forEach(function(line) {
      var qty = parseInt(line.qty_placed,10)||0;
      invSheet.appendRow([datePlaced,'placement', line.item_id||'placement', line.type||'',
        qty,'out', source, 2, qty*2, ev.notes||'', id]);
    });
    return {id:id, totalPlaced:totalPlaced};
  } catch(err) {
    throw new Error('submitPlacementRecord failed: '+err.toString());
  }
}

function getPlacementFormHtml_() {
  var typeOpts = Object.keys(SCRIPTURE_ITEM_MAP).map(function(t) {
    return '<option value="'+t+'" data-id="'+SCRIPTURE_ITEM_MAP[t]+'">'+t+'</option>';
  }).join('');
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    '*{box-sizing:border-box;}' +
    'body{font-family:Segoe UI,sans-serif;font-size:13px;padding:12px;color:#1a1a1a;}' +
    'h2{font-size:14px;margin:0 0 10px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    'h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6B6B6B;margin:12px 0 6px;}' +
    'label{display:block;font-weight:600;margin:7px 0 2px;font-size:11px;}' +
    'input,select,textarea{width:100%;padding:6px 8px;border:1px solid #E8E4DF;border-radius:4px;font-size:12px;font-family:inherit;}' +
    'input:focus,select:focus{outline:none;border-color:#B8860B;}' +
    '.r2{display:grid;grid-template-columns:1fr 1fr;gap:7px;}' +
    '.line{background:#FAFAF8;border:1px solid #E8E4DF;border-radius:5px;padding:8px;margin-bottom:7px;}' +
    '.line select{margin-bottom:5px;}' +
    '.qr{display:grid;grid-template-columns:1fr 1fr 30px;gap:5px;align-items:end;}' +
    '.ql{font-size:10px;font-weight:600;display:block;margin-bottom:2px;}' +
    '.rm{background:#fee;border:1px solid #fcc;border-radius:3px;color:#c00;font-size:15px;cursor:pointer;width:30px;height:30px;text-align:center;line-height:30px;padding:0;}' +
    '.add{width:100%;padding:8px;background:#fff8e8;border:1.5px dashed #B8860B;border-radius:4px;color:#B8860B;font-weight:700;font-size:12px;cursor:pointer;margin-bottom:10px;}' +
    '.save{display:block;width:100%;padding:10px;background:#B8860B;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer;}' +
    '.save:disabled{opacity:.6;cursor:not-allowed;}' +
    'hr{border:none;border-top:1px solid #E8E4DF;margin:10px 0;}' +
    '#st{text-align:center;margin-top:9px;font-size:12px;min-height:16px;}' +
    '</style></head><body>' +
    '<h2>Log Placement Record</h2>' +
    '<h3>Event Details</h3>' +
    '<label>Institution / Location *</label><input id="ins" placeholder="Wiggums Hollow Park" required>' +
    '<label>Address</label><input id="adr" placeholder="Street, City, State">' +
    '<label>Institution Official</label><input id="off" placeholder="Name of contact">' +
    '<div class="r2"><div><label>Phone</label><input id="ph" type="tel" placeholder="(555) 123-4567"></div><div><label>Email</label><input id="em" type="email" placeholder="email@org.com"></div></div>' +
    '<label>Rooms / Students / People</label><input id="rms" placeholder="e.g. 200 students">' +
    '<div class="r2"><div><label>Date Assigned</label><input id="da" type="date"></div><div><label>Date Placed *</label><input id="dp" type="date" required></div></div>' +
    '<div class="r2"><div><label>Team Member</label><input id="tm" placeholder="David Ageyev"></div><div><label>Event Source</label><input id="es" placeholder="Community Cookout"></div></div>' +
    '<label>Notes</label><textarea id="nt" rows="2" placeholder="Optional context..."></textarea>' +
    '<hr><h3>Scripture Lines</h3>' +
    '<div id="lines"></div>' +
    '<button type="button" class="add" id="addBtn">+ Add Scripture Type</button>' +
    '<button class="save" id="saveBtn">Save Placement Record</button>' +
    '<div id="st"></div>' +
    '<script>' +
    'var cnt=0;' +
    'var typeOpts=' + JSON.stringify('<option value="">-- Select --</option>' + typeOpts) + ';' +
    'function addLine(){' +
      'cnt++;var id="ln"+cnt;var d=document.createElement("div");d.className="line";d.id=id;' +
      'd.innerHTML=\'<select class="ts">\'+typeOpts+\'</select><div class="qr"><div><span class="ql">Qty Needed</span><input type="number" class="qn" min="0" value="0"></div><div><span class="ql">Qty Placed *</span><input type="number" class="qp" min="0" value="0"></div><button class="rm" type="button">x</button></div>\';' +
      'd.querySelector(".rm").onclick=function(){d.remove();};' +
      'document.getElementById("lines").appendChild(d);' +
    '}' +
    'document.getElementById("addBtn").onclick=addLine;' +
    'document.getElementById("dp").valueAsDate=new Date();' +
    'addLine();' +
    'document.getElementById("saveBtn").onclick=function(){' +
      'var st=document.getElementById("st");var btn=document.getElementById("saveBtn");' +
      'var ins=document.getElementById("ins").value.trim();' +
      'var dp=document.getElementById("dp").value;' +
      'if(!ins){st.innerHTML=\'<span style="color:#c00">Institution is required.</span>\';return;}' +
      'if(!dp){st.innerHTML=\'<span style="color:#c00">Date Placed is required.</span>\';return;}' +
      'var lines=[];' +
      'document.querySelectorAll(".line").forEach(function(el){' +
        'var sel=el.querySelector(".ts");var type=sel.value;if(!type)return;' +
        'var opt=sel.options[sel.selectedIndex];var itemId=opt?opt.getAttribute("data-id"):"";' +
        'lines.push({type:type,item_id:itemId||type,qty_needed:parseInt(el.querySelector(".qn").value)||0,qty_placed:parseInt(el.querySelector(".qp").value)||0});' +
      '});' +
      'if(!lines.length){st.innerHTML=\'<span style="color:#c00">Add at least one scripture line.</span>\';return;}' +
      'btn.disabled=true;btn.textContent="Saving...";st.innerHTML="";' +
      'google.script.run' +
        '.withSuccessHandler(function(r){' +
          'st.innerHTML=\'<span style="color:#2C5F2E">Saved! \'+r.totalPlaced+\' Bibles logged. ID: \'+r.id+\'</span>\';' +
          '["ins","adr","off","ph","em","rms","da","tm","es","nt"].forEach(function(f){document.getElementById(f).value="";});' +
          'document.getElementById("dp").valueAsDate=new Date();' +
          'document.getElementById("lines").innerHTML="";cnt=0;addLine();' +
          'btn.disabled=false;btn.textContent="Save Placement Record";' +
        '})' +
        '.withFailureHandler(function(e){st.innerHTML=\'<span style="color:#c00">\''+'+(e.message||JSON.stringify(e))+\'</span>\';btn.disabled=false;btn.textContent="Save Placement Record";})' +
        '.submitPlacementRecord({event:{institution:ins,address:document.getElementById("adr").value,official_name:document.getElementById("off").value,contact_phone:document.getElementById("ph").value,contact_email:document.getElementById("em").value,num_rooms:document.getElementById("rms").value,date_assigned:document.getElementById("da").value,date_placed:dp,team_member:document.getElementById("tm").value,event_source:document.getElementById("es").value,notes:document.getElementById("nt").value},scriptures:lines});' +
    '};' +
    '<\/script></body></html>';
}

function showPdfForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Pull placement IDs from BOTH PlacementRecords AND Inventory order_id column
  var idsObj = {};
  var plSheet = ss.getSheetByName(PLACEMENT_TAB);
  if (plSheet && plSheet.getLastRow() > 1) {
    plSheet.getRange(2,1,plSheet.getLastRow()-1,1).getValues().forEach(function(r){ if(r[0]) idsObj[String(r[0])]=true; });
  }
  var invSheet = ss.getSheetByName('Inventory');
  if (invSheet && invSheet.getLastRow() > 1) {
    // Find order_id column by header name (more robust than hardcoding column 11)
    var headers = invSheet.getRange(1, 1, 1, invSheet.getLastColumn()).getValues()[0];
    var orderIdCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).toLowerCase().replace(/[^a-z_]/g,'') === 'order_id') { orderIdCol = h + 1; break; }
    }
    if (orderIdCol === -1) orderIdCol = 11; // fallback to column K
    var lastInvRow = invSheet.getLastRow();
    invSheet.getRange(2, orderIdCol, lastInvRow - 1, 1).getValues().forEach(function(r){
      var v = String(r[0]||'').trim();
      if (v && v.indexOf('PLR-') === 0) idsObj[v] = true;
    });
  }
  var ids = Object.keys(idsObj).sort().reverse();
  var opts = ids.map(function(id){ return '<option value="'+esc_(id)+'">'+esc_(id)+'</option>'; }).join('');
  var html = '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:Segoe UI,sans-serif;font-size:13px;padding:14px;color:#1a1a1a;}' +
    'h2{font-size:14px;margin:0 0 12px;border-bottom:2px solid #B8860B;padding-bottom:5px;color:#B8860B;}' +
    'label{display:block;font-weight:600;margin:10px 0 3px;font-size:12px;}' +
    'select,input{width:100%;padding:7px 9px;border:1px solid #E8E4DF;border-radius:5px;font-size:13px;}' +
    'select:focus,input:focus{outline:none;border-color:#B8860B;}' +
    '.r2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
    'button{display:block;width:100%;margin-top:12px;padding:10px;background:#B8860B;color:#fff;border:none;border-radius:5px;font-size:14px;font-weight:700;cursor:pointer;}' +
    'button:disabled{opacity:.6;cursor:not-allowed;}' +
    '#st{text-align:center;margin-top:10px;font-size:12px;}' +
    '.or{text-align:center;margin:10px 0;font-size:11px;color:#999;font-weight:600;}' +
    '</style></head><body>' +
    '<h2>Generate Placement PDF</h2>' +
    '<label>Select Placement ID</label><select id="pid"><option value="">-- Select a placement --</option>'+opts+'</select>' +
    '<div class="or">-- OR --</div>' +
    '<label>Date Range (all placements in range)</label>' +
    '<div class="r2"><div><label style="margin:0 0 3px;font-size:11px">From</label><input type="date" id="fr"></div><div><label style="margin:0 0 3px;font-size:11px">To</label><input type="date" id="to"></div></div>' +
    '<button id="btn" onclick="gen()">Generate PDF</button>' +
    '<div id="st"></div>' +
    '<script>' +
    'function gen(){' +
      'var pid=document.getElementById("pid").value;' +
      'var fr=document.getElementById("fr").value;' +
      'var to=document.getElementById("to").value;' +
      'var st=document.getElementById("st");var btn=document.getElementById("btn");' +
      'if(!pid&&!fr){st.innerHTML=\'<span style="color:#c00">Select a placement ID or date range.</span>\';return;}' +
      'btn.disabled=true;btn.textContent="Generating...";st.innerHTML="";' +
      'google.script.run' +
        '.withSuccessHandler(function(msg){st.innerHTML=\'<span style="color:#2C5F2E">\'+msg+\'</span>\';btn.disabled=false;btn.textContent="Generate PDF";})' +
        '.withFailureHandler(function(e){st.innerHTML=\'<span style="color:#c00">\''+'+(e.message||JSON.stringify(e))+\'</span>\';btn.disabled=false;btn.textContent="Generate PDF";})' +
        '.generatePlacementPdfById(pid,fr,to);' +
    '}' +
    '<\/script></body></html>';
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle('Generate Placement PDF').setWidth(380));
}

function generatePlacementPdfById(placementId, fromDate, toDate) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var plSheet = ss.getSheetByName(PLACEMENT_TAB);
    var invSheet = ss.getSheetByName('Inventory');
    if (!invSheet) throw new Error('Inventory tab not found.');

    var invData = invSheet.getDataRange().getValues();
    // Find order_id column by header
    var invHeaders = invData[0];
    var oidCol = 10; // default column K (0-based index 10)
    for (var hh = 0; hh < invHeaders.length; hh++) {
      if (String(invHeaders[hh]).toLowerCase().replace(/[^a-z_]/g,'') === 'order_id') { oidCol = hh; break; }
    }

    // Build a map of placement_id -> inventory lines from the Inventory tab
    var invByPlacement = {};
    for (var j = 1; j < invData.length; j++) {
      var inv = invData[j];
      var invPid = String(inv[oidCol]||'').trim();
      if (!invPid) continue;
      var invDate = String(inv[0]||'');
      // Date range filter when no specific placementId
      if (!placementId && fromDate && toDate && !(invDate >= fromDate && invDate <= toDate)) continue;
      if (!placementId && fromDate && !toDate && invDate < fromDate) continue;
      if (placementId && invPid !== placementId) continue;
      if (!invByPlacement[invPid]) invByPlacement[invPid] = [];
      invByPlacement[invPid].push({
        date_assigned:  invDate,
        team_member:    String(inv[6]||''), // event_source used as proxy for team
        scripture_type: String(inv[3]||''),
        qty_needed:     inv[4]||0,
        date_placed:    invDate
      });
    }

    // Also try to get event metadata from PlacementRecords if it exists
    var plEventMap = {};
    if (plSheet && plSheet.getLastRow() > 1) {
      var plData = plSheet.getDataRange().getValues();
      for (var i = 1; i < plData.length; i++) {
        var row = plData[i];
        var pid = String(row[0]||'');
        if (pid) {
          var ev = {};
          PLACEMENT_HEADERS.forEach(function(h,idx){ ev[h]=row[idx]; });
          plEventMap[pid] = ev;
        }
      }
    }

    var pids = Object.keys(invByPlacement);
    if (!pids.length) throw new Error('No inventory rows found for the given selection. Make sure the order_id column (K) contains the placement ID.');

    var events = pids.map(function(pid) {
      // Use PlacementRecords data if available, otherwise build from Inventory
      if (plEventMap[pid]) return plEventMap[pid];
      var firstRow = invByPlacement[pid][0];
      return {
        placement_id:     pid,
        date_assigned:    firstRow.date_assigned,
        date_placed:      firstRow.date_placed,
        team_member:      firstRow.team_member,
        institution:      firstRow.team_member, // best guess from event_source
        address:          '',
        official_name:    '',
        contact_phone:    '',
        contact_email:    '',
        num_rooms_students: '',
        event_source:     firstRow.team_member,
        total_qty_placed: invByPlacement[pid].reduce(function(s,l){return s+(parseInt(l.qty_needed,10)||0);},0),
        notes:            ''
      };
    });
    var folder = DriveApp.getRootFolder();
    try { var ff = DriveApp.getFoldersByName('STW Placement Records'); folder = ff.hasNext() ? ff.next() : DriveApp.createFolder('STW Placement Records'); } catch(_) {}
    var fileNames = [];
    events.forEach(function(ev) {
      var lines = invByPlacement[ev.placement_id] || [];
      if (!lines.length) lines.push({date_assigned:String(ev.date_assigned||''), team_member:String(ev.team_member||''), scripture_type:'(see notes)', qty_needed:String(ev.total_qty_placed||''), date_placed:String(ev.date_placed||'')});
      var blob = HtmlService.createHtmlOutput(buildGideonsHtml_(ev, lines)).getAs('application/pdf').setName('PlacementRecord_'+ev.placement_id+'.pdf');
      folder.createFile(blob);
      fileNames.push(blob.getName());
      try { MailApp.sendEmail({to:TEAM_EMAIL, subject:'Placement Record: '+ev.institution+' ('+ev.date_placed+')', body:'Placement record attached.\nID: '+ev.placement_id, attachments:[blob]}); } catch(_) {}
    });
    return 'Generated ' + events.length + ' PDF(s). Saved to Drive & emailed. ' + fileNames.join(', ');
  } catch(err) { throw new Error(err.toString()); }
}

function buildGideonsHtml_(ev, lines) {
  var tableRows = '';
  for (var i = 0; i < 20; i++) {
    if (i < lines.length) {
      var l = lines[i];
      tableRows += '<tr><td>'+esc_(l.date_assigned)+'</td><td>'+esc_(l.team_member)+'</td><td>'+esc_(l.scripture_type)+'</td><td style="text-align:center">'+esc_(l.qty_needed)+'</td><td>'+esc_(l.date_placed)+'</td></tr>';
    } else {
      tableRows += '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';
    }
  }
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:36px 44px;}' +
    'h1{text-align:center;font-size:15px;font-weight:bold;margin:0 0 20px;letter-spacing:.04em;}' +
    '.field{display:flex;align-items:baseline;margin-bottom:7px;}' +
    '.fl{font-size:10px;min-width:155px;flex-shrink:0;}' +
    '.fv{border-bottom:1px solid #000;flex:1;min-height:14px;padding-bottom:1px;}' +
    '.fr{display:flex;gap:24px;margin-bottom:7px;} .fr .field{flex:1;}' +
    'table{width:100%;border-collapse:collapse;margin-top:10px;}' +
    'th{background:#e8e8e8;font-weight:bold;font-size:9px;text-align:center;border:1px solid #000;padding:5px 4px;letter-spacing:.04em;}' +
    'td{border:1px solid #000;padding:4px 6px;height:20px;font-size:10px;vertical-align:middle;}' +
    '.foot{margin-top:12px;font-size:8px;color:#666;}' +
    '</style></head><body>' +
    '<h1>SCRIPTURE PLACEMENT RECORD</h1>' +
    '<div class="field"><span class="fl">Institution</span><span class="fv">'+esc_(ev.institution)+'</span></div>' +
    '<div class="field"><span class="fl">Address</span><span class="fv">'+esc_(ev.address)+'</span></div>' +
    '<div class="field"><span class="fl">Institution Official</span><span class="fv">'+esc_(ev.official_name)+'</span></div>' +
    '<div class="fr"><div class="field"><span class="fl">Position</span><span class="fv"></span></div><div class="field"><span class="fl" style="min-width:60px">Telephone</span><span class="fv">'+esc_(ev.contact_phone)+'</span></div></div>' +
    '<div class="fr"><div class="field"><span class="fl">E-mail</span><span class="fv">'+esc_(ev.contact_email)+'</span></div><div class="field"><span class="fl" style="min-width:30px">Fax</span><span class="fv"></span></div></div>' +
    '<div class="field"><span class="fl">Number of Rooms, Students, Etc.</span><span class="fv">'+esc_(ev.num_rooms_students)+'</span></div>' +
    '<table><thead><tr><th>DATE ASSIGNED</th><th>GIDEON ASSIGNED</th><th>TYPE SCRIPTURE NEEDED</th><th>NUMBER SCRIPTURES NEEDED</th><th>DATE SCRIPTURES PLACED</th></tr></thead><tbody>'+tableRows+'</tbody></table>' +
    '<div class="foot">Item 542 8/2017 | Seed the Word Ministry | Placement ID: '+esc_(ev.placement_id)+(ev.notes?' | Notes: '+esc_(ev.notes):'')+'</div>' +
    '</body></html>';
}

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
  '<script>' +
  'document.getElementById("dt").valueAsDate=new Date();' +
  'function save(e){e.preventDefault();' +
    'var btn=document.getElementById("btn");btn.disabled=true;btn.textContent="Saving...";' +
    'google.script.run' +
      '.withSuccessHandler(function(){document.getElementById("st").innerHTML=\'<span style="color:#2C5F2E">Saved!</span>\';document.getElementById("f").reset();document.getElementById("dt").valueAsDate=new Date();btn.disabled=false;btn.textContent="Save Finance Entry";})' +
      '.withFailureHandler(function(e){document.getElementById("st").innerHTML=\'<span style="color:#c00">\'+(e.message||JSON.stringify(e))+\'</span>\';btn.disabled=false;btn.textContent="Save Finance Entry";})' +
      '.submitFinanceEntry({date:document.getElementById("dt").value,type:document.getElementById("tp").value,category:document.getElementById("cat").value,description:document.getElementById("desc").value,amount:document.getElementById("amt").value,payment_method:document.getElementById("pm").value,reference:document.getElementById("ref").value,recorded_by:document.getElementById("rb").value,notes:document.getElementById("nt").value});' +
  '}' +
  '<\/script></body></html>';

function showDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var totalOut=0, totalIn=0, totalIncome=0, totalExp=0, rsvpCount=0, plCount=0;
  var inv = ss.getSheetByName('Inventory');
  if (inv) { var d=inv.getDataRange().getValues(); for(var i=1;i<d.length;i++){var q=parseInt(d[i][4],10)||0;var dr=String(d[i][5]||'').trim().toLowerCase();if(dr==='out')totalOut+=q;if(dr==='in')totalIn+=q;} }
  var fin = ss.getSheetByName(FINANCES_TAB);
  if (fin && fin.getLastRow()>1) { var f=fin.getRange(2,1,fin.getLastRow()-1,5).getValues(); for(var j=0;j<f.length;j++){var t=String(f[j][1]||'').toLowerCase();var a=parseFloat(f[j][4])||0;if(t==='income')totalIncome+=a;if(t==='expense')totalExp+=a;} }
  var rs=ss.getSheetByName('RSVP'); if(rs) rsvpCount=Math.max(0,rs.getLastRow()-1);
  var pl=ss.getSheetByName(PLACEMENT_TAB); if(pl) plCount=Math.max(0,pl.getLastRow()-1);
  var bal=totalIncome-totalExp; var net=totalIn-totalOut;
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
    '.full{grid-column:1/-1;}' +
    '.ts{font-size:10px;color:#bbb;text-align:center;margin-top:10px;}' +
    '</style></head><body>' +
    '<h2>Ministry Dashboard</h2><div class="g">' +
    card('Bibles Given Away',totalOut,'Total out movements','gold') +
    card('Net Available',net,'Received - donated',net>=0?'green':'red') +
    card('Total Income','$'+totalIncome.toFixed(2),'All donations','green') +
    card('Total Expenses','$'+totalExp.toFixed(2),'All costs','red') +
    '</div><div class="g"><div class="card full"><div class="ct">Current Balance</div><div class="val '+(bal>=0?'green':'red')+'">$'+bal.toFixed(2)+'</div><div class="sub">Income minus expenses</div></div></div>' +
    '<div class="g">'+card('Placement Records',plCount,'Logged events')+card('Young Adults RSVPs',rsvpCount,'Confirmed attendees')+'</div>' +
    '<div class="ts">Updated '+new Date().toLocaleString()+'</div></body></html>';
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutput(html).setTitle('STW Dashboard').setWidth(320));
}

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
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Debug helper — run this from Apps Script editor to check column K ──
function debugPdfIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName('Inventory');
  if (!invSheet) { Logger.log('No Inventory sheet found!'); return; }
  var lastRow = invSheet.getLastRow();
  Logger.log('Inventory rows: ' + lastRow);
  // Find order_id column
  var headers = invSheet.getRange(1,1,1,invSheet.getLastColumn()).getValues()[0];
  Logger.log('Headers: ' + headers.join(' | '));
  var oidCol = 10;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).toLowerCase().replace(/[^a-z_]/g,'') === 'order_id') { oidCol = h; break; }
  }
  Logger.log('order_id column index (0-based): ' + oidCol + ' = column ' + String.fromCharCode(65+oidCol));
  if (lastRow < 2) { Logger.log('No data rows yet.'); return; }
  var vals = invSheet.getRange(2, oidCol+1, lastRow-1, 1).getValues();
  var found = [];
  vals.forEach(function(r){ var v = String(r[0]||'').trim(); if(v) found.push(v); });
  Logger.log('Non-empty order_id values (' + found.length + '): ' + found.slice(0,15).join(', '));
  var plrIds = found.filter(function(v){ return v.indexOf('PLR-') === 0; });
  Logger.log('PLR- IDs found: ' + plrIds.length + ' -> ' + plrIds.join(', '));
}
