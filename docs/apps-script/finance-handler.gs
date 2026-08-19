/**
 * Seed the Word — Finance Handler (Google Apps Script)
 * ────────────────────────────────────────────────────────────────
 *
 * Handles expense logging, retrieval, editing, and deletion.
 * Stores finance entries in a "Finance" tab on the STW Order Ledger sheet.
 * Also handles event name retrieval and account recovery.
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
 * Required tabs in the spreadsheet:
 *   - "Finance" (headers: timestamp, date, amount, category, vendor, description, event, logged_by, has_receipt, receipt_url)
 *   - "Inventory" (existing — used to pull unique event names)
 *   - "Team" (existing — used for account recovery)
 */

const FINANCE_TAB = 'Finance';
const FINANCE_HEADERS = ['timestamp', 'date', 'amount', 'category', 'vendor', 'description', 'event', 'logged_by', 'has_receipt', 'receipt_url'];

// ── Log Finance Entry ────────────────────────────────────────────
// Payload: { action:'logFinanceEntry', token, entry: { date, amount, category, vendor, description, event, has_receipt, logged_by } }
function handleLogFinanceEntry_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResp_({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResp_({ ok: false, error: 'Only admins can log finance entries' });
    }

    const entry = payload.entry || {};
    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    let sheet = ss.getSheetByName(FINANCE_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(FINANCE_TAB);
      sheet.appendRow(FINANCE_HEADERS);
    }

    const row = [
      new Date().toISOString(),
      entry.date || new Date().toISOString().split('T')[0],
      parseFloat(entry.amount) || 0,
      entry.category || 'other',
      entry.vendor || '',
      entry.description || '',
      entry.event || '',
      entry.logged_by || member.name,
      entry.has_receipt ? 'yes' : 'no',
      entry.receipt_url || ''
    ];

    sheet.appendRow(row);

    return jsonResp_({ ok: true, id: Date.now().toString(36) });
  } catch (err) {
    return jsonResp_({ ok: false, error: err.message });
  }
}

// ── Get Finance Entries ──────────────────────────────────────────
// Payload: { action:'getFinanceEntries', token, limit?: number }
function handleGetFinanceEntries_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResp_({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResp_({ ok: false, error: 'Admin access required' });
    }

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCE_TAB);
    if (!sheet) return jsonResp_({ ok: true, entries: [] });

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResp_({ ok: true, entries: [] });

    const headers = data[0];
    const limit = payload.limit || 50;
    const entries = [];

    // Read from bottom (newest first)
    for (let i = data.length - 1; i >= 1 && entries.length < limit; i--) {
      const row = data[i];
      entries.push({
        row_index: i + 1, // 1-indexed for Sheet API
        timestamp: row[0],
        date: row[1],
        amount: row[2],
        category: row[3],
        vendor: row[4],
        description: row[5],
        event: row[6],
        logged_by: row[7],
        has_receipt: row[8] === 'yes',
        receipt_url: row[9] || ''
      });
    }

    return jsonResp_({ ok: true, entries: entries });
  } catch (err) {
    return jsonResp_({ ok: false, error: err.message });
  }
}

// ── Delete Finance Entry ─────────────────────────────────────────
// Payload: { action:'deleteFinanceEntry', token, row_index }
function handleDeleteFinanceEntry_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResp_({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResp_({ ok: false, error: 'Admin access required' });
    }

    const rowIndex = parseInt(payload.row_index);
    if (!rowIndex || rowIndex < 2) return jsonResp_({ ok: false, error: 'Invalid row' });

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCE_TAB);
    if (!sheet) return jsonResp_({ ok: false, error: 'Finance sheet not found' });

    sheet.deleteRow(rowIndex);
    return jsonResp_({ ok: true });
  } catch (err) {
    return jsonResp_({ ok: false, error: err.message });
  }
}

// ── Edit Finance Entry ───────────────────────────────────────────
// Payload: { action:'editFinanceEntry', token, row_index, updates: { amount?, category?, vendor?, description?, event? } }
function handleEditFinanceEntry_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResp_({ ok: false, error: 'Invalid session' });

    const role = (member.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'super_admin') {
      return jsonResp_({ ok: false, error: 'Admin access required' });
    }

    const rowIndex = parseInt(payload.row_index);
    if (!rowIndex || rowIndex < 2) return jsonResp_({ ok: false, error: 'Invalid row' });

    const updates = payload.updates || {};
    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName(FINANCE_TAB);
    if (!sheet) return jsonResp_({ ok: false, error: 'Finance sheet not found' });

    // Column mapping: date=2, amount=3, category=4, vendor=5, description=6, event=7
    if (updates.date) sheet.getRange(rowIndex, 2).setValue(updates.date);
    if (updates.amount !== undefined) sheet.getRange(rowIndex, 3).setValue(parseFloat(updates.amount) || 0);
    if (updates.category) sheet.getRange(rowIndex, 4).setValue(updates.category);
    if (updates.vendor !== undefined) sheet.getRange(rowIndex, 5).setValue(updates.vendor);
    if (updates.description !== undefined) sheet.getRange(rowIndex, 6).setValue(updates.description);
    if (updates.event !== undefined) sheet.getRange(rowIndex, 7).setValue(updates.event);

    return jsonResp_({ ok: true });
  } catch (err) {
    return jsonResp_({ ok: false, error: err.message });
  }
}

// ── Get Event Names ──────────────────────────────────────────────
// Payload: { action:'getEventNames', token }
// Returns unique event labels from the Inventory tab
function handleGetEventNames_(payload) {
  try {
    const member = validateTeamToken_(payload.token);
    if (!member) return jsonResp_({ ok: false, error: 'Invalid session' });

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName('Inventory');
    if (!sheet) return jsonResp_({ ok: true, events: [] });

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResp_({ ok: true, events: [] });

    // Find the "event_label" or "event_source" column
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    let eventCol = headers.indexOf('event_label');
    if (eventCol === -1) eventCol = headers.indexOf('event_source');
    if (eventCol === -1) eventCol = headers.indexOf('event');
    if (eventCol === -1) return jsonResp_({ ok: true, events: [] });

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

    return jsonResp_({ ok: true, events: events });
  } catch (err) {
    return jsonResp_({ ok: false, error: err.message });
  }
}

// ── Account Recovery ─────────────────────────────────────────────
// Payload: { action:'recoverAccount', identifier }
// Looks up by name or email in Team tab, sends recovery via their notification preference
function handleRecoverAccount_(payload) {
  try {
    const identifier = (payload.identifier || '').trim().toLowerCase();
    if (!identifier) return jsonResp_({ ok: false, error: 'Please provide your name or email.' });

    const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
    const sheet = ss.getSheetByName('Team');
    if (!sheet) return jsonResp_({ ok: false, error: 'Team directory not found.' });

    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    const nameCol = headers.indexOf('name');
    const emailCol = headers.indexOf('email');
    const phoneCol = headers.indexOf('phone');
    const telegramCol = headers.indexOf('telegram_username');
    const notifyCol = headers.indexOf('notify_pref');

    let found = null;
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowName = String(data[i][nameCol] || '').trim().toLowerCase();
      const rowEmail = String(data[i][emailCol] || '').trim().toLowerCase();
      if (rowName === identifier || rowEmail === identifier) {
        found = data[i];
        foundRow = i;
        break;
      }
    }

    if (!found) return jsonResp_({ ok: false, error: 'No account found with that name or email. Contact an admin for help.' });

    const name = found[nameCol];
    const email = found[emailCol];
    const phone = found[phoneCol];
    const telegram = found[telegramCol];
    const notifyPref = (found[notifyCol] || 'email').toLowerCase();

    // Generate a temporary password (6 chars)
    const tempPass = Math.random().toString(36).slice(-6);

    // Hash and store it (overwrite password_hash column)
    const passCol = headers.indexOf('password_hash');
    if (passCol !== -1) {
      // We store a marker that this is a temp password — the user must change it on next login
      // For simplicity, we store the temp pass as-is (plain) prefixed with "TEMP:"
      // The login handler should check for this prefix and accept it as-is
      sheet.getRange(foundRow + 1, passCol + 1).setValue('TEMP:' + tempPass);
    }

    // Send recovery via their preferred method
    let method = 'email';
    if (notifyPref === 'email' && email) {
      MailApp.sendEmail(email, 'Seed the Word — Password Recovery', 
        'Hi ' + name + ',\n\nYour temporary password is: ' + tempPass + '\n\nLog in with your name and this password, then update your password in Profile Settings.\n\n— Seed the Word Team');
      method = 'email (' + email.slice(0, 3) + '...)';
    } else if (notifyPref === 'telegram' && telegram) {
      // Can't send Telegram directly from Apps Script easily — fall back to email or note
      if (email) {
        MailApp.sendEmail(email, 'Seed the Word — Password Recovery', 
          'Hi ' + name + ',\n\nYour temporary password is: ' + tempPass + '\n\nLog in with your name and this password.\n\n— Seed the Word Team');
        method = 'email (Telegram not supported for recovery)';
      } else {
        return jsonResp_({ ok: false, error: 'Cannot send recovery — no email on file. Contact an admin.' });
      }
    } else if (email) {
      MailApp.sendEmail(email, 'Seed the Word — Password Recovery', 
        'Hi ' + name + ',\n\nYour temporary password is: ' + tempPass + '\n\nLog in with your name and this password.\n\n— Seed the Word Team');
      method = 'email';
    } else {
      return jsonResp_({ ok: false, error: 'No contact info on file. Ask an admin to reset your password.' });
    }

    return jsonResp_({ ok: true, method: method });
  } catch (err) {
    return jsonResp_({ ok: false, error: err.message });
  }
}
