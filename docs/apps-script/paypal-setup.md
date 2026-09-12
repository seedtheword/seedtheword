# PayPal payment setup (Phase 1: server-verified pay-now)

This wires the store cart checkout and the donate page's Give section to accept
**PayPal, debit, and credit card** payments (one integration covers all three,
plus Pay Later where eligible — the buyer does **not** need a PayPal account to
pay by card).

Payments are **server-verified**: the browser renders the PayPal buttons, but
our Google Apps Script backend creates and captures the order and confirms the
captured amount before anything is marked paid. The client can never forge a
"paid" order.

> Do this in **Sandbox** first (test money), confirm it works end to end, then
> repeat with your **Live** credentials and flip `paypalMode` to `"live"`.

---

## 1. Create a PayPal REST app (get Client ID + Secret)

1. Go to <https://developer.paypal.com/dashboard/> and log in with the ministry
   PayPal account.
2. Top-right, make sure you're on **Sandbox** (toggle) for testing.
3. **Apps & Credentials → Create App**. Name it e.g. `Seed the Word Store`.
   Choose **Merchant** as the app type.
4. Copy the **Client ID** and the **Secret** (click "Show" under Secret).
   - **Client ID** is public and safe to put on the website.
   - **Secret** is private — it goes ONLY into Apps Script Script Properties
     (step 3 below), never into the repo or `site-config.json`.

When you later go live: switch the dashboard to **Live**, create (or use) the
Live app, and use those Live Client ID + Secret.

---

## 2. Put the Client ID in site-config

Edit `assets/data/site-config.json` (or use the admin editor → Site config):

```json
"paypalClientId": "PASTE_YOUR_CLIENT_ID_HERE",
"paypalMode": "sandbox",
"currency": "USD"
```

- Leave `paypalClientId` empty to **disable** online payment (checkout falls back
  to record-only "place order" and the donate card block stays hidden).
- Set `paypalMode` to `"live"` only when you switch to Live credentials.

Commit the change so GitHub Pages serves it.

---

## 3. Put the Secret in Apps Script Script Properties

The backend reads the Secret from Script Properties — it is never in the repo.

1. Open the Apps Script project (script.google.com) that hosts
   `docs/apps-script/order-handler.gs` (the same web app as `orderHandlerUrl`).
2. **Project Settings (gear) → Script properties → Add script property.**
3. Add these three properties:

   | Property                | Value                                  |
   | ----------------------- | -------------------------------------- |
   | `PAYPAL_CLIENT_ID`      | your PayPal **Client ID**              |
   | `PAYPAL_CLIENT_SECRET`  | your PayPal **Secret**                 |
   | `PAYPAL_MODE`           | `sandbox` (or `live` when you go live) |

   `PAYPAL_CLIENT_ID` here should match `paypalClientId` in site-config; both are
   needed (the site uses it for the SDK, the backend uses it to authenticate).

4. **Deploy → Manage deployments → Edit → Deploy** a new version so the added
   code (createPayPalOrder / capturePayPalOrder actions) goes live. The web app
   URL stays the same.

---

## 4. Test in Sandbox

1. Get a sandbox buyer account: developer dashboard → **Testing Tools → Sandbox
   Accounts** (there's a default personal/buyer account with an email + password).
2. On the live site (or a local copy) add an item to the cart, choose **pickup**
   (no shipping), proceed to checkout, and click the PayPal button.
3. Log in with the **sandbox buyer** and approve, or use the **Debit or Credit
   Card** option with a [PayPal test card](https://developer.paypal.com/tools/sandbox/card-testing/).
4. Confirm:
   - The success message shows "payment received".
   - The order appears in the Team Portal → Orders queue with a green **PAID** tag.
   - The StoreOrders sheet row has `payment_status = paid`, a `capture_id`, and
     `amount_paid_cents` matching the subtotal.
5. Repeat on the donate page: pick an amount → the "Give securely by card or
   PayPal" block appears → pay → thank-you message.

---

## How the two-track checkout behaves

| Situation at checkout        | What the shopper sees                    | Recorded payment_status |
| ---------------------------- | ---------------------------------------- | ----------------------- |
| Pickup, balance due          | PayPal / card buttons — **pays now**     | `paid`                  |
| Team code entered            | Plain "Place order" — no charge          | `comped`                |
| $0 total                     | Plain "Place order"                      | `unpaid` / `comped`     |
| Wants shipping               | "Request quote & invoice" — no charge yet| `pending_quote`         |

The shipping / invoice track (Phase 2) is where the team reviews the order,
adjusts items + adds real shipping, and sends a PayPal invoice for the final
total. That is not built yet — for now `pending_quote` orders are followed up by
the team.

---

## Notes

- **Donations** process as standard PayPal payments. Seed the Word is a
  registered nonprofit; if/when it enrolls in PayPal's confirmed-charity program,
  the donation flow can be upgraded (reduced fees, charity receipt) — the code is
  marked for that.
- **Currency** is controlled by `currency` in site-config and must match what the
  PayPal account supports.
- If payment ever fails to configure, nothing breaks: the buttons simply don't
  render and checkout falls back to the record-only path.
