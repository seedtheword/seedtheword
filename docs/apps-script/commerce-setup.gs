/**
 * Seed the Word — Commerce Setup (one-time, run-once helper)
 * ────────────────────────────────────────────────────────────────
 * Paste this file into the SAME Apps Script project that holds
 * order-handler.gs, then run stwCommerceSetup() ONCE from the editor.
 *
 * It sets up everything the store commerce features need on the
 * "STW Order Ledger" spreadsheet:
 *   1. Creates the "CustomOptions" tab (headers + example rows) if missing.
 *   2. Creates the "StoreOrders" tab (headers) if missing.
 *   3. Ensures the "Lists" tab has a header note for column H
 *      (the "customizable" flag — put YES in col H for products you
 *      want to be customizable).
 *
 * SAFE TO RE-RUN: it never overwrites existing tabs/data — it only
 * creates what's missing and only writes example rows to a brand-new
 * CustomOptions tab.
 *
 * HOW TO RUN:
 *   1. script.google.com → your STW Order Handler project.
 *   2. Add a file, paste this in (or paste at the bottom of Code.gs).
 *   3. Select "stwCommerceSetup" in the function dropdown → Run.
 *   4. Authorize if prompted. Check the execution log for a summary.
 *
 * After running, remember to Deploy → Manage deployments → Edit →
 * New version → Deploy so the getCatalog/placeOrder changes go live.
 */

// Reuses LEDGER_SHEET_ID from order-handler.gs when present; falls back
// to the known STW Order Ledger id so this file can run stand-alone.
function stwCommerceSetupSheetId_() {
  try { if (typeof LEDGER_SHEET_ID === 'string' && LEDGER_SHEET_ID) return LEDGER_SHEET_ID; } catch (e) {}
  return '17j5TDDTZ-58MuZ7VO7c1ohPkyHw2LZ2GCWYMFb-CJ50';
}

function stwCommerceSetup() {
  var ss = SpreadsheetApp.openById(stwCommerceSetupSheetId_());
  var log = [];

  // ── 1. CustomOptions tab ──────────────────────────────────────
  // One row per option per product. Columns:
  //   A product_id     — matches the id in Lists column B
  //   B option_key      — machine key (main_text, main_style, sleeve_text...)
  //   C label           — shown to the shopper
  //   D type            — text | style | producttype | image | checkbox
  //   E max_chars       — character limit for text types (blank = none)
  //   F price_add_cents — add-on price in CENTS (e.g. 100 = +$1.00)
  //   G required        — YES to require before Add to Cart
  //   H choices         — for style/producttype: "Label|imgUrl;Label2|imgUrl2"
  //   I zone            — text overlay spot: main | secondary | sleeve
  //                        OR explicit "x,y,width" as % of the preview
  var customOptions = ss.getSheetByName('CustomOptions');
  if (!customOptions) {
    customOptions = ss.insertSheet('CustomOptions');
    customOptions.appendRow([
      'product_id', 'option_key', 'label', 'type',
      'max_chars', 'price_add_cents', 'required', 'choices', 'zone'
    ]);
    // Example rows for a hypothetical "custom-hoodie" product. Delete or
    // edit these; they only exist to show the format. To activate, also
    // put YES in the Lists tab column H for the matching product id.
    customOptions.appendRow(['custom-hoodie', 'main_text',   'Custom Main Text',      'text',        34,  0,   'YES', '',                                    'main']);
    customOptions.appendRow(['custom-hoodie', 'main_style',  'Main Text Style',       'style',       0,   0,   '',    'Curve|;Not Curve|',                    '']);
    customOptions.appendRow(['custom-hoodie', 'second_text', 'Custom Secondary Text', 'text',        50,  0,   '',    '',                                    'secondary']);
    customOptions.appendRow(['custom-hoodie', 'sleeve_text', 'Custom Sleeve Text',    'text',        1000,100, '',    '',                                    'sleeve']);
    customOptions.appendRow(['custom-hoodie', 'product_type','Select Product Type',   'producttype', 0,   0,   'YES', 'T-Shirt|;Crewneck|;Hoodie|',           '']);
    customOptions.appendRow(['custom-hoodie', 'artwork',     'Upload Your Artwork',   'image',       0,   0,   '',    '',                                    '']);
    // Style header row visually.
    customOptions.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#2C5F2E').setFontColor('#ffffff');
    customOptions.setFrozenRows(1);
    log.push('Created "CustomOptions" tab with headers + example rows for "custom-hoodie".');
  } else {
    log.push('"CustomOptions" tab already exists — left untouched.');
  }

  // ── 2. StoreOrders tab ────────────────────────────────────────
  var storeOrders = ss.getSheetByName('StoreOrders');
  if (!storeOrders) {
    storeOrders = ss.insertSheet('StoreOrders');
    storeOrders.appendRow([
      'order_id', 'received_at', 'name', 'email', 'phone',
      'wants_shipping', 'shipping_address', 'notes',
      'subtotal_cents', 'currency', 'item_count', 'items_json', 'status'
    ]);
    storeOrders.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#2C5F2E').setFontColor('#ffffff');
    storeOrders.setFrozenRows(1);
    log.push('Created "StoreOrders" tab with headers.');
  } else {
    log.push('"StoreOrders" tab already exists — left untouched.');
  }

  // ── 3. Lists tab — column H "customizable" reminder ───────────
  var lists = ss.getSheetByName('Lists');
  if (lists) {
    // The Lists tab intentionally has NO header row (data starts row 1),
    // so we don't add one. Instead we drop a note on cell H1 only if the
    // whole H column is currently empty, so we never clobber real data.
    var hVals = lists.getRange(1, 8, Math.max(1, lists.getLastRow()), 1).getValues();
    var hHasData = hVals.some(function (r) { return String(r[0]).trim() !== ''; });
    if (!hHasData) {
      lists.getRange(1, 8).setNote('Customizable flag: put YES here for any product row you want to be customizable in the store. Leave blank otherwise.');
      log.push('Added a note on Lists!H1 explaining the customizable flag (column H).');
    } else {
      log.push('Lists column H already has data — left untouched (put YES to mark a product customizable).');
    }
  } else {
    log.push('WARNING: "Lists" tab not found — check the spreadsheet.');
  }

  // ── Summary ───────────────────────────────────────────────────
  var summary = 'STW Commerce setup complete:\n - ' + log.join('\n - ') +
    '\n\nNext: Deploy → Manage deployments → Edit → New version → Deploy.';
  Logger.log(summary);
  try {
    SpreadsheetApp.getUi().alert(summary);
  } catch (e) {
    // getUi() only works when run from a bound context / with a UI; the
    // Logger output above is the fallback when run headless.
  }
  return summary;
}
