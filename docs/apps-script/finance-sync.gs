/**
 * Seed the Word — Finance Sync & Archive
 * 
 * ADD THIS to the STW Order Ledger Apps Script (Extensions → Apps Script).
 * 
 * Purpose:
 * - Syncs all Finances tab entries to a SEPARATE "STW Finances" spreadsheet
 * - Creates per-month tabs (2026-01, 2026-02, etc.) with full transaction history
 * - Creates/updates an Annual Summary P&L tab
 * - Runs automatically via time-driven trigger (nightly) or manually from menu
 *
 * The separate spreadsheet becomes the permanent accounting archive.
 * The Order Ledger remains operational; this is the bookkeeper's record.
 *
 * Setup:
 * 1. Paste this into the Order Ledger Apps Script
 * 2. Run setupFinanceSyncTrigger() once to create the nightly auto-sync
 * 3. Or use the menu: STW Reports → Sync to Finance Archive
 */

// ══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

var FINANCE_ARCHIVE_ID = '1FcJqsROHdL6bo3YYBMWrHVloW697giVZUTQRK8PNpXg';
var SOURCE_TAB = 'Finances';

// Month tab headers
var MONTH_HEADERS = ['Date', 'Type', 'Category', 'Description', 'Amount', 'Method', 'Notes', 'Synced From'];

// Category display names
var INCOME_LABELS = {
  'donation-zelle': 'Donations — Zelle',
  'donation-venmo': 'Donations — Venmo',
  'donation-cashapp': 'Donations — CashApp',
  'donation-paypal': 'Donations — PayPal',
  'donation-cash': 'Donations — Cash',
  'donation-card': 'Donations — Card',
  'donation-check/ACH': 'Donations — Check/ACH',
  'bible-sale': 'Bible Sales',
  'event-income': 'Event Income',
  'other-income': 'Other Income'
};

var EXPENSE_LABELS = {
  'ministry-supplies': 'Ministry Supplies (Bibles)',
  'misc-supplies': 'Miscellaneous Supplies',
  'shipping/postage': 'Shipping & Postage',
  'designated-scripture-fund': 'Scripture Fund',
  'other-expense': 'Other Expenses',
  'advertising': 'Advertising & Promotion',
  'travel': 'Travel & Transportation',
  'utilities': 'Utilities & Subscriptions',
  'rent': 'Rent / Venue',
  'food': 'Food & Hospitality',
  'printing': 'Printing & Materials',
  'tech': 'Technology & Software'
};

// ══════════════════════════════════════════════════════════════════════
// MENU (adds to existing onOpen or creates new)
// ══════════════════════════════════════════════════════════════════════

// This creates the STW Reports menu. If your Order Ledger already has an
// onOpen() function elsewhere, merge these addItem lines into it instead
// of having two onOpen functions (only one will run).
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('STW Reports')
    .addItem('Sync to Finance Archive (Now)', 'syncFinanceArchive')
    .addSeparator()
    .addItem('Setup Nightly Auto-Sync', 'setupFinanceSyncTrigger')
    .addToUi();
}

// ══════════════════════════════════════════════════════════════════════
// TRIGGER SETUP — Run once to enable nightly sync
// ══════════════════════════════════════════════════════════════════════

function setupFinanceSyncTrigger() {
  // Remove existing finance sync triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncFinanceArchive') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Create nightly trigger at 2 AM
  ScriptApp.newTrigger('syncFinanceArchive')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  
  SpreadsheetApp.getUi().alert(
    'Auto-sync enabled! Finance archive will sync every night at 2 AM.\n' +
    'You can also manually sync anytime from the STW Reports menu.'
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN SYNC FUNCTION
// ══════════════════════════════════════════════════════════════════════

function syncFinanceArchive() {
  var sourceSS = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = sourceSS.getSheetByName(SOURCE_TAB);
  
  if (!sourceSheet || sourceSheet.getLastRow() < 2) {
    Logger.log('No finance data to sync.');
    return;
  }
  
  // Open the archive spreadsheet
  var archiveSS;
  try {
    archiveSS = SpreadsheetApp.openById(FINANCE_ARCHIVE_ID);
  } catch (e) {
    Logger.log('Cannot open Finance Archive spreadsheet: ' + e.message);
    throw new Error('Cannot access STW Finances spreadsheet. Make sure it is shared with this script.');
  }
  
  // Read all source data
  var sourceData = sourceSheet.getRange(2, 1, sourceSheet.getLastRow() - 1, 7).getValues();
  
  // Group entries by month
  var byMonth = {}; // key: "2026-01", value: array of rows
  
  for (var i = 0; i < sourceData.length; i++) {
    var row = sourceData[i];
    var dateVal = row[0];
    if (!dateVal) continue;
    
    var date = new Date(dateVal);
    if (isNaN(date.getTime())) continue;
    
    var monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    
    if (!byMonth[monthKey]) byMonth[monthKey] = [];
    byMonth[monthKey].push([
      date,                        // Date
      String(row[1] || ''),        // Type
      String(row[2] || ''),        // Category
      String(row[3] || ''),        // Description
      parseFloat(row[4]) || 0,     // Amount
      String(row[5] || ''),        // Method
      String(row[6] || ''),        // Notes
      'STW Order Ledger'           // Source marker
    ]);
  }
  
  // Write each month tab
  var monthKeys = Object.keys(byMonth).sort();
  
  for (var m = 0; m < monthKeys.length; m++) {
    var monthKey = monthKeys[m];
    var monthData = byMonth[monthKey];
    
    // Get or create the month tab
    var monthTab = archiveSS.getSheetByName(monthKey);
    if (!monthTab) {
      monthTab = archiveSS.insertSheet(monthKey);
      // Write headers
      monthTab.getRange(1, 1, 1, MONTH_HEADERS.length).setValues([MONTH_HEADERS]);
      monthTab.getRange(1, 1, 1, MONTH_HEADERS.length)
        .setFontWeight('bold')
        .setBackground('#1a1a6b')
        .setFontColor('#ffffff');
      monthTab.setFrozenRows(1);
      monthTab.setColumnWidth(1, 110);
      monthTab.setColumnWidth(2, 80);
      monthTab.setColumnWidth(3, 180);
      monthTab.setColumnWidth(4, 250);
      monthTab.setColumnWidth(5, 100);
      monthTab.setColumnWidth(6, 120);
      monthTab.setColumnWidth(7, 200);
      monthTab.setColumnWidth(8, 130);
    }
    
    // Clear existing data (below headers) and rewrite
    // This is a full sync — ensures archive matches source exactly
    if (monthTab.getLastRow() > 1) {
      monthTab.getRange(2, 1, monthTab.getLastRow() - 1, MONTH_HEADERS.length).clear();
    }
    
    // Write data
    if (monthData.length > 0) {
      monthTab.getRange(2, 1, monthData.length, MONTH_HEADERS.length).setValues(monthData);
      monthTab.getRange(2, 1, monthData.length, 1).setNumberFormat('yyyy-mm-dd');
      monthTab.getRange(2, 5, monthData.length, 1).setNumberFormat('#,##0.00');
    }
    
    // Add month summary at bottom
    var summaryRow = monthData.length + 3;
    var incomeTotal = 0, expenseTotal = 0;
    monthData.forEach(function(r) {
      if (r[1] === 'income') incomeTotal += r[4];
      else expenseTotal += r[4];
    });
    
    monthTab.getRange(summaryRow, 1).setValue('MONTH SUMMARY');
    monthTab.getRange(summaryRow, 1).setFontWeight('bold');
    monthTab.getRange(summaryRow + 1, 1).setValue('Total Income:');
    monthTab.getRange(summaryRow + 1, 2).setValue(incomeTotal).setNumberFormat('#,##0.00');
    monthTab.getRange(summaryRow + 1, 2).setFontColor('#2C5F2E').setFontWeight('bold');
    monthTab.getRange(summaryRow + 2, 1).setValue('Total Expenses:');
    monthTab.getRange(summaryRow + 2, 2).setValue(expenseTotal).setNumberFormat('#,##0.00');
    monthTab.getRange(summaryRow + 2, 2).setFontColor('#8B0000').setFontWeight('bold');
    monthTab.getRange(summaryRow + 3, 1).setValue('Net:');
    monthTab.getRange(summaryRow + 3, 2).setValue(incomeTotal - expenseTotal).setNumberFormat('#,##0.00');
    monthTab.getRange(summaryRow + 3, 1, 1, 2).setFontWeight('bold').setBackground('#fff9c4');
  }
  
  // ── Build Annual Summary Tab ───────────────────────────────────────
  buildAnnualSummary_(archiveSS, sourceData);
  
  // ── Ensure tabs are ordered ────────────────────────────────────────
  // Move Annual Summary to front
  var annualTab = archiveSS.getSheetByName('Annual Summary');
  if (annualTab) archiveSS.setActiveSheet(annualTab);
  
  Logger.log('Finance archive synced: ' + monthKeys.length + ' month tabs updated.');
}

// ══════════════════════════════════════════════════════════════════════
// ANNUAL SUMMARY — P&L on the archive spreadsheet
// ══════════════════════════════════════════════════════════════════════

function buildAnnualSummary_(archiveSS, sourceData) {
  var tabName = 'Annual Summary';
  var sheet = archiveSS.getSheetByName(tabName);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = archiveSS.insertSheet(tabName, 0); // insert at front
  }
  
  // Parse entries
  var entries = [];
  for (var i = 0; i < sourceData.length; i++) {
    var row = sourceData[i];
    var dateVal = row[0];
    if (!dateVal) continue;
    var date = new Date(dateVal);
    if (isNaN(date.getTime())) continue;
    entries.push({
      date: date,
      month: date.getMonth(),
      year: date.getFullYear(),
      type: String(row[1] || '').toLowerCase().trim(),
      category: String(row[2] || '').trim(),
      amount: parseFloat(row[4]) || 0
    });
  }
  
  // Find all years
  var yearsSet = {};
  entries.forEach(function(e) { yearsSet[e.year] = true; });
  var years = Object.keys(yearsSet).map(Number).sort();
  if (!years.length) return;
  
  // Build totals
  var incomeByYear = {};
  var expenseByYear = {};
  
  entries.forEach(function(e) {
    var bucket = e.type === 'income' ? incomeByYear : expenseByYear;
    if (!bucket[e.category]) bucket[e.category] = {};
    if (!bucket[e.category][e.year]) bucket[e.category][e.year] = 0;
    bucket[e.category][e.year] += e.amount;
  });
  
  // Write
  var r = 1;
  var numCols = years.length + 1;
  
  sheet.getRange(r, 1).setValue('Seed the Word Ministry').setFontWeight('bold').setFontSize(13);
  r++;
  sheet.getRange(r, 1).setValue('Annual Profit & Loss Statement').setFontWeight('bold').setFontSize(10);
  r++;
  sheet.getRange(r, 1).setValue('Auto-generated from Finance Archive').setFontColor('#6B6B6B').setFontSize(9);
  r += 2;
  
  // Headers
  var headers = [''].concat(years.map(String));
  sheet.getRange(r, 1, 1, numCols).setValues([headers]);
  sheet.getRange(r, 1, 1, numCols).setFontWeight('bold').setBackground('#1a1a6b').setFontColor('#ffffff');
  r++;
  
  // Revenue
  sheet.getRange(r, 1).setValue('REVENUE').setFontWeight('bold').setFontColor('#2C5F2E');
  r++;
  
  var totalIncByYear = {};
  years.forEach(function(y) { totalIncByYear[y] = 0; });
  
  Object.keys(incomeByYear).sort().forEach(function(cat) {
    var label = INCOME_LABELS[cat] || cat;
    var vals = years.map(function(y) {
      var v = incomeByYear[cat][y] || 0;
      totalIncByYear[y] += v;
      return v;
    });
    sheet.getRange(r, 1, 1, numCols).setValues([[label].concat(vals)]);
    sheet.getRange(r, 2, 1, years.length).setNumberFormat('#,##0.00');
    r++;
  });
  
  var revVals = years.map(function(y) { return totalIncByYear[y]; });
  sheet.getRange(r, 1, 1, numCols).setValues([['Total Revenue'].concat(revVals)]);
  sheet.getRange(r, 1, 1, numCols).setFontWeight('bold').setBackground('#e8f5e9');
  sheet.getRange(r, 2, 1, years.length).setNumberFormat('#,##0.00');
  r += 2;
  
  // Expenses
  sheet.getRange(r, 1).setValue('EXPENSES').setFontWeight('bold').setFontColor('#8B0000');
  r++;
  
  var totalExpByYear = {};
  years.forEach(function(y) { totalExpByYear[y] = 0; });
  
  Object.keys(expenseByYear).sort().forEach(function(cat) {
    var label = EXPENSE_LABELS[cat] || cat;
    var vals = years.map(function(y) {
      var v = expenseByYear[cat][y] || 0;
      totalExpByYear[y] += v;
      return v;
    });
    sheet.getRange(r, 1, 1, numCols).setValues([[label].concat(vals)]);
    sheet.getRange(r, 2, 1, years.length).setNumberFormat('#,##0.00');
    r++;
  });
  
  var expVals = years.map(function(y) { return totalExpByYear[y]; });
  sheet.getRange(r, 1, 1, numCols).setValues([['Total Expenses'].concat(expVals)]);
  sheet.getRange(r, 1, 1, numCols).setFontWeight('bold').setBackground('#fce4ec');
  sheet.getRange(r, 2, 1, years.length).setNumberFormat('#,##0.00');
  r += 2;
  
  // Net
  var netVals = years.map(function(y) { return totalIncByYear[y] - totalExpByYear[y]; });
  sheet.getRange(r, 1, 1, numCols).setValues([['Net Earnings'].concat(netVals)]);
  sheet.getRange(r, 1, 1, numCols).setFontWeight('bold').setFontSize(11).setBackground('#fff9c4');
  sheet.getRange(r, 2, 1, years.length).setNumberFormat('#,##0.00');
  
  // Format
  sheet.setColumnWidth(1, 220);
  for (var c = 2; c <= numCols; c++) sheet.setColumnWidth(c, 120);
  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(1);
}
