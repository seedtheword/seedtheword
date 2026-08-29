/**
 * Seed the Word — Finance Handler (Google Apps Script)
 * ────────────────────────────────────────────────────────────────
 *
 * Handles expense logging, retrieval, editing, and deletion.
 * Writes to the EXISTING "Finances" tab on the STW Order Ledger sheet.
 * Also handles event name retrieval and account recovery.
 *
 * DEPLOYMENT: Paste this into your STW Order Handler Apps Script project
 * (the same project that has order-handler.gs, team-messaging-handlers.gs, etc.)
 *
 * Add these routes to the doPost() function in order-handler.gs:
 *
 *   if ((payload && payload.action) === 'logFinanceEntry') return handleLogFinanceEntry_(payload);
 *   if ((payload && payload.action) === 'getFinanceEntries') return handleGetFinanceEntries_(payload);
 *   if ((payload && payload.action) === 'deleteFinanceEntry') return handleDeleteFinanceEntry_(payload);
 *   if ((payload && payload.action) === 'editFinanceEntry') return handleEditFinanceEntry_(payload);
 *   if ((payload && payload.action) === 'getEventNames') return handleGetEventNames_(payload);
 *   if ((payload && payload.action) === 'recoverAccount') return handleRecoverAccount_(payload);
 *
 * The existing "Finances" tab structure (row 1 = headers, row 2 = totals formula row):
 *   A: date
 *   B: type (expense, income, donation/cash, etc.)
 *   C: category (designated scripture, ministry supplies, food, etc.)
 *   D: description
 *   E: amount
 *   F: payment_method (Cash, Venmo, Card, Zelle, Invoice/unpaid)
 *   G: references
 *   H: recorded_by
 *   I: notes
 *   J: receipt_url
 *
 * NOTE: Row 2 in the existing sheet contains formula totals — data starts at row 3+.
 *       New entries are appended AFTER the last row of data.
 */

const FINANCES_TAB = 'Finances';

// ── Log Finance Entry ────────────────────────────────────────────
// Payload: { action:'logFinanceEntry', token, entry: { date, amount, category, vendor, description, event, payment_method, type, has_receipt, logged_by, receipt_data } }
function handleLogFinanceEntry_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResponse({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Only admins can log finance entries' });
    }

    const entry = payload.entry || {};
    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCES_TAB);
    if (!sheet) return jsonResponse({ ok: false, error: 'Finances tab not found in spreadsheet' });

    // Handle receipt upload to Google Drive
    var receiptUrl = '';
    if (entry.receipt_data && entry.receipt_data.indexOf('data:') === 0) {
      try {
        receiptUrl = uploadReceiptToDrive_(entry.receipt_data, entry.date || 'undated', entry.logged_by || 'unknown');
      } catch(uploadErr) {
        receiptUrl = 'upload_failed';
      }
    } else if (entry.has_receipt) {
      receiptUrl = 'pending_upload';
    }

    // Map to the existing column structure: date, type, category, description, amount, payment_method, references, recorded_by, notes, receipt_url
    const row = [
      entry.date || new Date().toISOString().split('T')[0],                    // A: date
      entry.type || 'expense',                                                  // B: type
      entry.category || 'other',                                               // C: category
      entry.description || '',                                                  // D: description
      parseFloat(entry.amount) || 0,                                           // E: amount
      entry.payment_method || 'Cash',                                          // F: payment_method
      entry.event || '',                                                        // G: references
      entry.logged_by || member.name,                                          // H: recorded_by
      entry.notes || '',                                                        // I: notes
      receiptUrl                                                                // J: receipt_url
    ];

    sheet.appendRow(row);

    return jsonResponse({ ok: true, id: Date.now().toString(36), receipt_url: receiptUrl });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Upload Receipt to Google Drive ───────────────────────────────
// Creates a "STW Receipts" folder (or reuses existing), organizes by year-month
function uploadReceiptToDrive_(dataUrl, date, loggedBy) {
  // Parse the base64 data URL
  var parts = dataUrl.split(',');
  var mimeMatch = parts[0].match(/data:(.*?);/);
  var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  var base64Data = parts[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType);
  
  // Name the file: receipt_YYYY-MM-DD_name_timestamp.ext
  var ext = mimeType.split('/')[1] || 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  var safeName = (loggedBy || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
  var fileName = 'receipt_' + (date || 'undated') + '_' + safeName + '_' + Date.now() + '.' + ext;
  blob.setName(fileName);
  
  // Find or create the receipts folder
  var folders = DriveApp.getFoldersByName('STW Receipts');
  var parentFolder;
  if (folders.hasNext()) {
    parentFolder = folders.next();
  } else {
    parentFolder = DriveApp.createFolder('STW Receipts');
  }
  
  // Organize by year-month subfolder
  var yearMonth = (date || new Date().toISOString().split('T')[0]).slice(0, 7); // "2026-08"
  var subFolders = parentFolder.getFoldersByName(yearMonth);
  var monthFolder;
  if (subFolders.hasNext()) {
    monthFolder = subFolders.next();
  } else {
    monthFolder = parentFolder.createFolder(yearMonth);
  }
  
  // Upload the file
  var file = monthFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  return file.getUrl();
}

// ── Get Finance Entries ──────────────────────────────────────────
// Payload: { action:'getFinanceEntries', token, limit?: number }
function handleGetFinanceEntries_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResponse({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Admin access required' });
    }

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCES_TAB);
    if (!sheet) return jsonResponse({ ok: true, entries: [] });

    const data = sheet.getDataRange().getValues();
    // Row 1 = headers, Row 2 = totals/formula row (skip both), data starts at row 3 (index 2)
    if (data.length <= 2) return jsonResponse({ ok: true, entries: [] });

    const limit = payload.limit || 50;
    const entries = [];

    // Read from bottom (newest first), skip header row (0) and totals row (1)
    for (let i = data.length - 1; i >= 2 && entries.length < limit; i--) {
      const row = data[i];
      // Skip empty rows (no date AND no amount)
      if (!row[0] && !row[4] && row[4] !== 0) continue;
      
      // Format date properly
      var dateVal = '';
      if (row[0]) {
        if (row[0] instanceof Date) {
          dateVal = Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          dateVal = String(row[0]);
        }
      }
      
      entries.push({
        row_index: i + 1,  // 1-indexed for Sheet API
        date: dateVal,
        type: String(row[1] || 'expense'),
        category: String(row[2] || ''),
        description: String(row[3] || ''),
        amount: parseFloat(row[4]) || 0,
        payment_method: String(row[5] || ''),
        references: String(row[6] || ''),
        recorded_by: String(row[7] || ''),
        notes: String(row[8] || ''),
        receipt_url: String(row[9] || ''),
        has_receipt: !!(row[9] && String(row[9]).trim())
      });
    }

    return jsonResponse({ ok: true, entries: entries });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Delete Finance Entry ─────────────────────────────────────────
// Payload: { action:'deleteFinanceEntry', token, row_index }
function handleDeleteFinanceEntry_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResponse({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Admin access required' });
    }

    const rowIndex = parseInt(payload.row_index);
    if (!rowIndex || rowIndex < 3) return jsonResponse({ ok: false, error: 'Invalid row (cannot delete header/totals)' });

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCES_TAB);
    if (!sheet) return jsonResponse({ ok: false, error: 'Finances tab not found' });

    sheet.deleteRow(rowIndex);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Edit Finance Entry ───────────────────────────────────────────
// Payload: { action:'editFinanceEntry', token, row_index, updates: { amount?, category?, description?, type?, payment_method?, notes? } }
function handleEditFinanceEntry_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResponse({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Admin access required' });
    }

    const rowIndex = parseInt(payload.row_index);
    if (!rowIndex || rowIndex < 3) return jsonResponse({ ok: false, error: 'Invalid row' });

    const updates = payload.updates || {};
    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCES_TAB);
    if (!sheet) return jsonResponse({ ok: false, error: 'Finances tab not found' });

    // Column mapping: A=date(1), B=type(2), C=category(3), D=description(4), E=amount(5), F=payment_method(6), G=references(7), H=recorded_by(8), I=notes(9)
    if (updates.date) sheet.getRange(rowIndex, 1).setValue(updates.date);
    if (updates.type) sheet.getRange(rowIndex, 2).setValue(updates.type);
    if (updates.category) sheet.getRange(rowIndex, 3).setValue(updates.category);
    if (updates.description !== undefined) sheet.getRange(rowIndex, 4).setValue(updates.description);
    if (updates.amount !== undefined) sheet.getRange(rowIndex, 5).setValue(parseFloat(updates.amount) || 0);
    if (updates.payment_method) sheet.getRange(rowIndex, 6).setValue(updates.payment_method);
    if (updates.notes !== undefined) sheet.getRange(rowIndex, 9).setValue(updates.notes);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Get Event Names ──────────────────────────────────────────────
// Payload: { action:'getEventNames', token }
// Returns unique event labels from the Inventory tab
function handleGetEventNames_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResponse({ ok: false, error: 'Invalid session' });

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName('Inventory');
    if (!sheet) return jsonResponse({ ok: true, events: [] });

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResponse({ ok: true, events: [] });

    // Find the event column — could be "event_label", "event_source", or "event"
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    let eventCol = headers.indexOf('event_label');
    if (eventCol === -1) eventCol = headers.indexOf('event_source');
    if (eventCol === -1) eventCol = headers.indexOf('event');
    if (eventCol === -1) return jsonResponse({ ok: true, events: [] });

    const seen = {};
    const events = [];
    for (let i = data.length - 1; i >= 1; i--) {
      const val = String(data[i][eventCol] || '').trim();
      if (val && !seen[val.toLowerCase()]) {
        seen[val.toLowerCase()] = true;
        events.push(val);
      }
      if (events.length >= 30) break;
    }

    return jsonResponse({ ok: true, events: events });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── Account Recovery ─────────────────────────────────────────────
// Payload: { action:'recoverAccount', identifier }
// Looks up by name or email in TeamMembers tab, sends recovery via email
function handleRecoverAccount_(payload) {
  try {
    const identifier = (payload.identifier || '').trim().toLowerCase();
    if (!identifier) return jsonResponse({ ok: false, error: 'Please provide your name or email.' });

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    // Try "TeamMembers" first, then "Team"
    let sheet = ss.getSheetByName('TeamMembers');
    if (!sheet) sheet = ss.getSheetByName('Team');
    if (!sheet) return jsonResponse({ ok: false, error: 'Team directory not found.' });

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    const nameCol = headers.indexOf('name');
    const emailCol = headers.indexOf('email');
    const passCol = headers.indexOf('password_hash');

    if (nameCol === -1) return jsonResponse({ ok: false, error: 'Team sheet missing name column.' });

    let found = null;
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowName = String(data[i][nameCol] || '').trim().toLowerCase();
      const rowEmail = emailCol !== -1 ? String(data[i][emailCol] || '').trim().toLowerCase() : '';
      if (rowName === identifier || rowEmail === identifier) {
        found = data[i];
        foundRow = i;
        break;
      }
    }

    if (!found) return jsonResponse({ ok: false, error: 'No account found with that name or email. Contact an admin for help.' });

    const name = found[nameCol];
    const email = emailCol !== -1 ? found[emailCol] : '';

    if (!email) return jsonResponse({ ok: false, error: 'No email on file for this account. Ask an admin to reset your password.' });

    // Generate a temporary password (6 chars)
    const tempPass = Math.random().toString(36).slice(-6);

    // Store temp password (the login handler needs to accept TEMP: prefix passwords as plain text)
    if (passCol !== -1) {
      sheet.getRange(foundRow + 1, passCol + 1).setValue('TEMP:' + tempPass);
    }

    // Send recovery email
    MailApp.sendEmail({
      to: email,
      subject: 'Seed the Word — Password Recovery',
      body: 'Hi ' + name + ',\n\nYour temporary password is: ' + tempPass + '\n\nLog in with your name and this password, then update your password in Profile Settings.\n\n— Seed the Word Team'
    });

    var maskedEmail = email.slice(0, 3) + '***@' + email.split('@')[1];
    return jsonResponse({ ok: true, method: 'email (' + maskedEmail + ')' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


// ── Finance Report (on-demand monthly / annual P&L for the bookkeeper) ──
// Payload: { action:'getFinanceReport', token, period }
//   period = 'YYYY-MM' for a month, or 'YYYY' for a full year.
// Returns income & expense totals grouped by category, plus net, so the
// Team Portal can render a P&L table + CSV/print export. Admin-gated.
// Reads the live Finances tab (cols A-J, data from row 3; row 2 = totals formula).
function handleGetFinanceReport_(payload) {
  try {
    var member = validateTeamToken_(payload.token);
    if (!member) return jsonResponse({ ok: false, error: 'Invalid session' });
    var role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResponse({ ok: false, error: 'Admin access required' });
    }

    var period = String(payload.period || '').trim();
    // Determine scope: month (YYYY-MM) or year (YYYY).
    var isMonth = /^\d{4}-\d{2}$/.test(period);
    var isYear = /^\d{4}$/.test(period);
    if (!isMonth && !isYear) {
      return jsonResponse({ ok: false, error: 'period must be YYYY-MM or YYYY' });
    }

    var ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    var sheet = ss.getSheetByName(FINANCES_TAB);
    if (!sheet) return jsonResponse({ ok: true, period: period, income: [], expense: [], totals: { income: 0, expense: 0, net: 0 }, count: 0 });

    var last = sheet.getLastRow();
    if (last < 3) return jsonResponse({ ok: true, period: period, income: [], expense: [], totals: { income: 0, expense: 0, net: 0 }, count: 0 });

    var data = sheet.getRange(3, 1, last - 2, 10).getValues(); // A..J from row 3
    var incomeMap = {}, expenseMap = {};
    var totalIncome = 0, totalExpense = 0, count = 0;

    function periodKey_(dateVal) {
      var d;
      if (dateVal instanceof Date) { d = dateVal; }
      else {
        var s = String(dateVal || '').trim();
        if (!s) return '';
        d = new Date(s);
        if (isNaN(d.getTime())) {
          // Fall back to string prefix matching for odd formats.
          return s;
        }
      }
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      return isMonth ? (y + '-' + m) : String(y);
    }

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[4]) continue; // blank row
      var key = periodKey_(row[0]);
      // For odd string dates, allow startsWith match on the period.
      var match = (key === period) || (typeof key === 'string' && key.indexOf(period) === 0);
      if (!match) continue;

      var type = String(row[1] || 'expense').toLowerCase();
      var category = String(row[2] || 'uncategorized').trim() || 'uncategorized';
      var amount = parseFloat(row[4]) || 0;
      count++;

      // Treat anything that isn't clearly income as an expense.
      var isIncome = (type.indexOf('income') !== -1 || type.indexOf('donation') !== -1);
      if (isIncome) {
        incomeMap[category] = (incomeMap[category] || 0) + amount;
        totalIncome += amount;
      } else {
        expenseMap[category] = (expenseMap[category] || 0) + amount;
        totalExpense += amount;
      }
    }

    function toSortedList_(map) {
      return Object.keys(map).map(function (k) {
        return { category: k, amountCents: Math.round(map[k] * 100) };
      }).sort(function (a, b) { return b.amountCents - a.amountCents; });
    }

    return jsonResponse({
      ok: true,
      period: period,
      scope: isMonth ? 'month' : 'year',
      income: toSortedList_(incomeMap),
      expense: toSortedList_(expenseMap),
      totals: {
        incomeCents: Math.round(totalIncome * 100),
        expenseCents: Math.round(totalExpense * 100),
        netCents: Math.round((totalIncome - totalExpense) * 100)
      },
      count: count
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}
