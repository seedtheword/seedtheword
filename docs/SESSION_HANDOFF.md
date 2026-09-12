# Session Handoff — Seed the Word

_Last updated: 2026-09-12_

## Environment / workflow notes
- **Repo:** `c:\Users\dageyev\Documents\seedtheword` · branch `main`.
- **Git binary** is at `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (not on PATH).
- **No Node/Python** available in the working environment — verification was done
  by code review + brace/paren/JSON balance checks, never a live run.
- **Push flow:** `add <specific files>` → `commit` → `pull --rebase origin main`
  → `push`. Concurrent pushes to `main` happen often, so rebase each time.

## What was done recently
1. **Homepage hero** (`index.html` + `assets/css/main.css`): compacted spacing,
   centered the topbar, wrapped verse bar + Maple Park flyer + `#Lynnwood4Jesus`
   card into one `.showcase-hub` container.
2. **Donate + Store impact cards**: added the news-page interactive globe +
   "countries reached" counter to the donate impact block; replaced generic
   Gideons/YouVersion icons with brand-accurate inline SVGs on donate + store.
3. **Bundle builder** (`bundle-builder.html`): pulls the full Lists-tab catalog
   (Bibles/Tracts/Merch/Recommended Picks, grouped); converted to a 5-step
   animated wizard (Select Items → Who's This For → Make it a Keepsake incl.
   packaging + shimmering artistic options → Your Bundle → Finishing Touches)
   with a floating Back/Next nav; Single/Pack variant toggle (single default);
   pack-aware pricing; hands off to the cart (no direct order placement).
4. **Donate hero**: three CTAs — Click to donate (left) / bold See our impact
   (center) / Get Your Free Bible (right).
5. **PayPal Phase 1 + 2**: server-verified pay-now for cart + donate, plus the
   shipping invoice track. Details below.

## PayPal — current state (BUILT, NOT YET LIVE)
- **Backend** `docs/apps-script/order-handler.gs`: `createPayPalOrder`,
  `capturePayPalOrder` (server-verifies captured amount == recomputed subtotal),
  `createStoreInvoice`, `markStoreOrderPaid`, and an `INVOICING.INVOICE.PAID`
  webhook. StoreOrders gains `payment_status / payment_method / paypal_order_id /
  capture_id / amount_paid_cents / paypal_invoice_id / invoice_url` via
  `ensureColumn_`. Reads creds from Script Properties `PAYPAL_CLIENT_ID /
  PAYPAL_CLIENT_SECRET / PAYPAL_MODE`. `validateAdminPassphrase_` lives in
  `team-messaging-handlers.gs` (shared Apps Script project).
- **Cart** (`cart.html` / `assets/js/cart-page.js`): pay-now PayPal buttons for
  pickup + balance-due; free/comped → plain place-order; shipping →
  `pending_quote`; international address support added.
- **Donate** (`donate.html` / `assets/js/donate-page.js`): card/PayPal buttons per
  chosen amount; `paypal.me/vanessamind` removed.
- **Team portal** (`team.html`): PAID / INVOICED / AWAITING INVOICE / UNPAID tags
  + Create-invoice / Mark-paid actions.
- **Config** (`assets/data/site-config.json`): `paypalClientId` (empty → payment
  hidden), `paypalMode: "sandbox"`, `currency: "USD"`.

## Blocked on the user (nothing to code until then)
Payment stays invisible until the user:
1. Creates a PayPal **sandbox** REST app (Client ID + Secret).
2. Sets Script Properties `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_MODE=sandbox` (+ optional `PAYPAL_WEBHOOK_ID`).
3. **Pastes `order-handler.gs` into the Apps Script editor and redeploys a NEW
   version** (the deployed script is the source of truth; repo edits don't take
   effect until pasted + redeployed).
4. Puts the Client ID in `site-config.json` (`paypalClientId`) and commits.
Full steps: `docs/apps-script/paypal-setup.md` → "FULL REDEPLOY CHECKLIST".

## Open / possible next tasks
- Sandbox test PayPal end-to-end after the user redeploys.
- Optional: itemize each product on invoices (currently one summary line +
  shipping); log donations to a sheet + branded receipt; PayPal webhook
  signature verification.

## Status
All work is committed and pushed (latest commit at handoff: `e19b2724`). Nothing
is mid-edit or left broken.
