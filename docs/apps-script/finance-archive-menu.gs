/**
 * Seed the Word — STW Finances ARCHIVE menu (container-bound)
 * ────────────────────────────────────────────────────────────────
 * This script lives ON the STW Finances archive spreadsheet
 * (ID 1FcJqsROHdL6bo3YYBMWrHVloW697giVZUTQRK8PNpXg), NOT the Order
 * Ledger. It gives the bookkeeper an "STW Reports" menu right in the
 * archive to generate Monthly and Annual P&L PDFs from the archive's
 * own tabs (the per-month YYYY-MM tabs + the "Annual Summary" tab that
 * finance-sync.gs already builds).
 *
 * ── HOW TO INSTALL ────────────────────────────────────────────────
 * 1. Open the STW Finances archive spreadsheet in your browser.
 * 2. Extensions → Apps Script (this opens the script BOUND to that
 *    spreadsheet — a different project from the Order Ledger handler).
 * 3. Paste this whole file into a new script file (or Code.gs).
 * 4. Save. Reload the spreadsheet. An "STW Reports" menu appears.
 * 5. First run will ask for authorization (Sheets + Drive + Gmail).
 *
 * Note: onOpen() here is fine because it's a SEPARATE project bound to
 * the archive. It does NOT conflict with the Order Ledger's onOpen
 * (STW Admin menu), which is a different spreadsheet/project.
 */

var STW_TEAM_EMAIL = 'seedthewordministry@gmail.com';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('STW Reports')
    .addItem('Generate Monthly Report (PDF)', 'stwArchiveMonthlyReportDialog')
    .addItem('Generate Annual P&L (PDF)', 'stwArchiveAnnualReportPdf')
    .addSeparator()
    .addItem('Email me the latest Annual P&L', 'stwArchiveEmailAnnual')
    .addToUi();
}

// ── Monthly report: pick a month tab, export it to PDF ────────────
function stwArchiveMonthlyReportDialog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Month tabs are named YYYY-MM by finance-sync.gs.
  var monthTabs = ss.getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return /^\d{4}-\d{2}$/.test(n); })
    .sort().reverse();

  if (!monthTabs.length) {
    SpreadsheetApp.getUi().alert('No month tabs found yet. Run the Order Ledger\'s STW Admin → Finance Archive → Sync first.');
    return;
  }

  var options = monthTabs.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:14px;">' +
      '<h3 style="margin:0 0 10px;">Monthly Finance Report</h3>' +
      '<label style="font-size:13px;">Month</label><br>' +
      '<select id="mo" style="width:100%;padding:6px;margin:4px 0 12px;">' + options + '</select>' +
      '<button onclick="go()" style="width:100%;padding:8px;background:#2C5F2E;color:#fff;border:none;border-radius:6px;cursor:pointer;">Generate PDF</button>' +
      '<div id="st" style="font-size:12px;text-align:center;margin-top:10px;"></div>' +
      '<script>function go(){var b=event.target;b.disabled=true;b.textContent="Generating…";' +
      'google.script.run.withSuccessHandler(function(url){document.getElementById("st").innerHTML=' +
      '\'<a href="\'+url+\'" target="_blank">PDF ready — open it</a> (also emailed + saved to Drive)\';b.disabled=false;b.textContent="Generate PDF";})' +
      '.withFailureHandler(function(e){document.getElementById("st").textContent=e.message;b.disabled=false;b.textContent="Generate PDF";})' +
      '.stwArchiveMonthlyReportPdf(document.getElementById("mo").value);}</script>' +
    '</div>'
  ).setWidth(320).setHeight(240);
  SpreadsheetApp.getUi().showModalDialog(html, 'STW Reports');
}

// Exports a single month tab to PDF, saves to Drive, emails it. Returns URL.
function stwArchiveMonthlyReportPdf(monthTab) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(monthTab);
  if (!sheet) throw new Error('Month tab not found: ' + monthTab);
  return exportSheetToPdf_(ss, sheet, 'STW Monthly P&L ' + monthTab);
}

// ── Annual P&L: export the "Annual Summary" tab to PDF ────────────
function stwArchiveAnnualReportPdf() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Annual Summary');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('No "Annual Summary" tab yet. Run Finance Archive → Sync from the Order Ledger first.');
    return;
  }
  var url = exportSheetToPdf_(ss, sheet, 'STW Annual P&L');
  SpreadsheetApp.getUi().alert('Annual P&L PDF generated, emailed, and saved to Drive.\n\n' + url);
}

function stwArchiveEmailAnnual() { stwArchiveAnnualReportPdf(); }

// ── Shared: export a sheet as PDF → Drive folder + email to team ──
function exportSheetToPdf_(ss, sheet, title) {
  var ssId = ss.getId();
  var gid = sheet.getSheetId();
  var url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?' +
    'format=pdf&gid=' + gid +
    '&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false';
  var token = ScriptApp.getOAuthToken();
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  var blob = resp.getBlob().setName(title.replace(/[^a-zA-Z0-9]+/g, '-') + '.pdf');

  // Save to a "STW Finance Reports" Drive folder.
  var folders = DriveApp.getFoldersByName('STW Finance Reports');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('STW Finance Reports');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Email it to the team.
  try {
    MailApp.sendEmail({
      to: STW_TEAM_EMAIL,
      subject: title,
      body: title + ' is attached, and saved to Drive:\n' + file.getUrl(),
      attachments: [blob],
      name: 'Seed the Word Finances'
    });
  } catch (e) { /* email is best-effort */ }

  return file.getUrl();
}
