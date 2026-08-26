/**
 * Seed the Word — P&L Report Generator
 * Add this to the existing STW Order Ledger Apps Script.
 *
 * Adds a custom menu: "STW Reports" → "Generate Monthly P&L" / "Generate Annual P&L"
 * Reads from the "Finances" tab (same one admin-dashboard.gs writes to)
 * and produces formatted P&L statements.
 *
 * Finances tab expected headers:
 *   Date | Type (income/expense) | Category | Description | Amount | Method | Notes
 */

// ── Menu Setup ────────────────────────────────────────────────────────
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('STW Reports')
    .addItem('Generate Monthly P&L (Current Year)', 'generateMonthlyPL')
    .addItem('Generate Annual P&L (Multi-Year)', 'generateAnnualPL')
    .addSeparator()
    .addItem('Generate Monthly P&L (Custom Year)', 'generateMonthlyPLCustom')
    .addToUi();
}

// ── Constants ─────────────────────────────────────────────────────────
var FINANCES_TAB = 'Finances';

var INCOME_CATEGORIES = {
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

var EXPENSE_CATEGORIES = {
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

// ── Data Reader ───────────────────────────────────────────────────────
function getFinanceData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FINANCES_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var entries = [];
  
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var dateVal = row[0];
    if (!dateVal) continue;
    
    var date = new Date(dateVal);
    if (isNaN(date.getTime())) continue;
    
    entries.push({
      date: date,
      month: date.getMonth(), // 0-indexed
      year: date.getFullYear(),
      type: String(row[1] || '').toLowerCase().trim(), // income or expense
      category: String(row[2] || '').trim(),
      description: String(row[3] || ''),
      amount: parseFloat(row[4]) || 0,
      method: String(row[5] || ''),
      notes: String(row[6] || '')
    });
  }
  
  return entries;
}

// ── Monthly P&L Generator ─────────────────────────────────────────────
function generateMonthlyPL() {
  var year = new Date().getFullYear();
  buildMonthlyPL_(year);
}

function generateMonthlyPLCustom() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt('Enter Year', 'Which year? (e.g. 2026)', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var year = parseInt(result.getResponseText());
  if (isNaN(year)) { ui.alert('Invalid year.'); return; }
  buildMonthlyPL_(year);
}

function buildMonthlyPL_(year) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = 'P&L Monthly ' + year;
  var sheet = ss.getSheetByName(tabName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(tabName);
  
  var entries = getFinanceData_().filter(function(e) { return e.year === year; });
  var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  
  // Build category totals per month
  var incomeByMonth = {}; // { category: [jan, feb, ... dec] }
  var expenseByMonth = {};
  
  entries.forEach(function(e) {
    var bucket = e.type === 'income' ? incomeByMonth : expenseByMonth;
    if (!bucket[e.category]) bucket[e.category] = new Array(12).fill(0);
    bucket[e.category][e.month] += e.amount;
  });
  
  // ── Write Report ───────────────────────────────────────────
  var row = 1;
  
  // Header
  sheet.getRange(row, 1).setValue('Seed the Word Ministry');
  sheet.getRange(row, 1).setFontWeight('bold').setFontSize(12);
  row++;
  sheet.getRange(row, 1).setValue('Profit & Loss Statement — ' + year);
  sheet.getRange(row, 1).setFontWeight('bold').setFontSize(10);
  row++;
  sheet.getRange(row, 1).setValue('Monthly Breakdown');
  sheet.getRange(row, 1).setFontColor('#6B6B6B').setFontSize(9);
  row += 2;
  
  // Column headers
  var headers = [''].concat(months).concat(['FULL YEAR']);
  sheet.getRange(row, 1, 1, 14).setValues([headers]);
  sheet.getRange(row, 1, 1, 14).setFontWeight('bold').setBackground('#1a1a6b').setFontColor('#ffffff');
  row++;
  
  // ── INCOME SECTION ───
  sheet.getRange(row, 1).setValue('REVENUE');
  sheet.getRange(row, 1).setFontWeight('bold').setFontColor('#2C5F2E');
  row++;
  
  var totalIncomeByMonth = new Array(12).fill(0);
  
  var incomeKeys = Object.keys(incomeByMonth).sort();
  incomeKeys.forEach(function(cat) {
    var vals = incomeByMonth[cat];
    var total = vals.reduce(function(a, b) { return a + b; }, 0);
    var label = INCOME_CATEGORIES[cat] || cat;
    var rowData = [label].concat(vals).concat([total]);
    sheet.getRange(row, 1, 1, 14).setValues([rowData]);
    sheet.getRange(row, 2, 1, 13).setNumberFormat('#,##0.00');
    for (var m = 0; m < 12; m++) totalIncomeByMonth[m] += vals[m];
    row++;
  });
  
  // Total Revenue row
  var totalRevenue = totalIncomeByMonth.reduce(function(a, b) { return a + b; }, 0);
  var revRow = ['Total Net Revenue'].concat(totalIncomeByMonth).concat([totalRevenue]);
  sheet.getRange(row, 1, 1, 14).setValues([revRow]);
  sheet.getRange(row, 1, 1, 14).setFontWeight('bold').setBackground('#e8f5e9');
  sheet.getRange(row, 2, 1, 13).setNumberFormat('#,##0.00');
  row += 2;
  
  // ── EXPENSE SECTION ───
  sheet.getRange(row, 1).setValue('EXPENSES');
  sheet.getRange(row, 1).setFontWeight('bold').setFontColor('#8B0000');
  row++;
  
  var totalExpenseByMonth = new Array(12).fill(0);
  
  var expenseKeys = Object.keys(expenseByMonth).sort();
  expenseKeys.forEach(function(cat) {
    var vals = expenseByMonth[cat];
    var total = vals.reduce(function(a, b) { return a + b; }, 0);
    var label = EXPENSE_CATEGORIES[cat] || cat;
    var rowData = [label].concat(vals).concat([total]);
    sheet.getRange(row, 1, 1, 14).setValues([rowData]);
    sheet.getRange(row, 2, 1, 13).setNumberFormat('#,##0.00');
    for (var m = 0; m < 12; m++) totalExpenseByMonth[m] += vals[m];
    row++;
  });
  
  // Total Expenses row
  var totalExpenses = totalExpenseByMonth.reduce(function(a, b) { return a + b; }, 0);
  var expRow = ['Total Expenses'].concat(totalExpenseByMonth).concat([totalExpenses]);
  sheet.getRange(row, 1, 1, 14).setValues([expRow]);
  sheet.getRange(row, 1, 1, 14).setFontWeight('bold').setBackground('#fce4ec');
  sheet.getRange(row, 2, 1, 13).setNumberFormat('#,##0.00');
  row += 2;
  
  // ── NET EARNINGS ───
  var netByMonth = totalIncomeByMonth.map(function(inc, i) { return inc - totalExpenseByMonth[i]; });
  var netTotal = totalRevenue - totalExpenses;
  var netRow = ['Net Earnings'].concat(netByMonth).concat([netTotal]);
  sheet.getRange(row, 1, 1, 14).setValues([netRow]);
  sheet.getRange(row, 1, 1, 14).setFontWeight('bold').setFontSize(11).setBackground('#fff9c4');
  sheet.getRange(row, 2, 1, 13).setNumberFormat('#,##0.00');
  
  // ── Formatting ───
  sheet.setColumnWidth(1, 220);
  for (var c = 2; c <= 14; c++) sheet.setColumnWidth(c, 90);
  sheet.setFrozenRows(5);
  sheet.setFrozenColumns(1);
  
  SpreadsheetApp.getUi().alert('Monthly P&L for ' + year + ' generated in tab "' + tabName + '"');
}

// ── Annual P&L Generator ──────────────────────────────────────────────
function generateAnnualPL() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = 'P&L Annual';
  var sheet = ss.getSheetByName(tabName);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(tabName);
  
  var entries = getFinanceData_();
  if (!entries.length) {
    SpreadsheetApp.getUi().alert('No finance data found.');
    return;
  }
  
  // Find all years
  var yearsSet = {};
  entries.forEach(function(e) { yearsSet[e.year] = true; });
  var years = Object.keys(yearsSet).map(Number).sort();
  
  // Build category totals per year
  var incomeByYear = {}; // { category: { year: amount } }
  var expenseByYear = {};
  
  entries.forEach(function(e) {
    var bucket = e.type === 'income' ? incomeByYear : expenseByYear;
    if (!bucket[e.category]) bucket[e.category] = {};
    if (!bucket[e.category][e.year]) bucket[e.category][e.year] = 0;
    bucket[e.category][e.year] += e.amount;
  });
  
  // ── Write Report ───────────────────────────────────────────
  var row = 1;
  
  sheet.getRange(row, 1).setValue('Seed the Word Ministry');
  sheet.getRange(row, 1).setFontWeight('bold').setFontSize(12);
  row++;
  sheet.getRange(row, 1).setValue('Profit & Loss Statement — Annual');
  sheet.getRange(row, 1).setFontWeight('bold').setFontSize(10);
  row += 2;
  
  // Column headers
  var headers = [''].concat(years.map(String));
  var numCols = headers.length;
  sheet.getRange(row, 1, 1, numCols).setValues([headers]);
  sheet.getRange(row, 1, 1, numCols).setFontWeight('bold').setBackground('#1a1a6b').setFontColor('#ffffff');
  row++;
  
  // ── INCOME ───
  sheet.getRange(row, 1).setValue('REVENUE');
  sheet.getRange(row, 1).setFontWeight('bold').setFontColor('#2C5F2E');
  row++;
  
  var totalIncomeByYear = {};
  years.forEach(function(y) { totalIncomeByYear[y] = 0; });
  
  var incomeKeys = Object.keys(incomeByYear).sort();
  incomeKeys.forEach(function(cat) {
    var label = INCOME_CATEGORIES[cat] || cat;
    var vals = years.map(function(y) {
      var v = incomeByYear[cat][y] || 0;
      totalIncomeByYear[y] += v;
      return v;
    });
    sheet.getRange(row, 1, 1, numCols).setValues([[label].concat(vals)]);
    sheet.getRange(row, 2, 1, years.length).setNumberFormat('#,##0.00');
    row++;
  });
  
  // Total Revenue
  var revVals = years.map(function(y) { return totalIncomeByYear[y]; });
  sheet.getRange(row, 1, 1, numCols).setValues([['Total Net Revenue'].concat(revVals)]);
  sheet.getRange(row, 1, 1, numCols).setFontWeight('bold').setBackground('#e8f5e9');
  sheet.getRange(row, 2, 1, years.length).setNumberFormat('#,##0.00');
  row += 2;
  
  // ── EXPENSES ───
  sheet.getRange(row, 1).setValue('EXPENSES');
  sheet.getRange(row, 1).setFontWeight('bold').setFontColor('#8B0000');
  row++;
  
  var totalExpenseByYear = {};
  years.forEach(function(y) { totalExpenseByYear[y] = 0; });
  
  var expenseKeys = Object.keys(expenseByYear).sort();
  expenseKeys.forEach(function(cat) {
    var label = EXPENSE_CATEGORIES[cat] || cat;
    var vals = years.map(function(y) {
      var v = expenseByYear[cat][y] || 0;
      totalExpenseByYear[y] += v;
      return v;
    });
    sheet.getRange(row, 1, 1, numCols).setValues([[label].concat(vals)]);
    sheet.getRange(row, 2, 1, years.length).setNumberFormat('#,##0.00');
    row++;
  });
  
  // Total Expenses
  var expVals = years.map(function(y) { return totalExpenseByYear[y]; });
  sheet.getRange(row, 1, 1, numCols).setValues([['Total Expenses'].concat(expVals)]);
  sheet.getRange(row, 1, 1, numCols).setFontWeight('bold').setBackground('#fce4ec');
  sheet.getRange(row, 2, 1, years.length).setNumberFormat('#,##0.00');
  row += 2;
  
  // ── NET EARNINGS ───
  var netVals = years.map(function(y) { return totalIncomeByYear[y] - totalExpenseByYear[y]; });
  sheet.getRange(row, 1, 1, numCols).setValues([['Net Earnings'].concat(netVals)]);
  sheet.getRange(row, 1, 1, numCols).setFontWeight('bold').setFontSize(11).setBackground('#fff9c4');
  sheet.getRange(row, 2, 1, years.length).setNumberFormat('#,##0.00');
  
  // Formatting
  sheet.setColumnWidth(1, 220);
  for (var c = 2; c <= numCols; c++) sheet.setColumnWidth(c, 110);
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(1);
  
  SpreadsheetApp.getUi().alert('Annual P&L generated in tab "' + tabName + '"');
}
