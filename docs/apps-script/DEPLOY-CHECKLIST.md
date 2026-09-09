# Apps Script Deploy Checklist — Seed the Word

**This is the single source of truth for what to paste, run, and redeploy.**
Whenever you touch a `.gs` file in this folder, come back here and follow the
matching row. There are **three separate Apps Script projects** — don't mix them up.

---

## The three projects

| # | Project | Where it lives | What it powers |
|---|---------|----------------|----------------|
| **P1** | **STW Order Handler (web app)** | The web-app project deployed at the `orderHandlerUrl` in `assets/data/site-config.json` | Almost everything the website POSTs to: orders, team login/scan, finance, content CMS, chat, **community social**, admin dashboard |
| **P2** | **STW Order Ledger (bound)** | Apps Script bound to the **Order Ledger** spreadsheet (`17j5TDDTZ-58MuZ7VO7c1ohPkyHw2LZ2GCWYMFb-CJ50`) | The **STW Admin** spreadsheet menu (onOpen), finance sync to the archive |
| **P3** | **STW Finances archive (bound)** | Apps Script bound to the **STW Finances** archive spreadsheet (`1FcJqsROHdL6bo3YYBMWrHVloW697giVZUTQRK8PNpXg`) | The **STW Reports** menu that makes monthly/annual PDFs |

> P1 and P2 may be the *same* script container in your setup if the web app is
> bound to the Order Ledger. If so, just keep all the P1 + P2 files in that one
> project. P3 is always separate (it's bound to a different spreadsheet).

---

## P1 — STW Order Handler (web app) — files to paste

Paste each of these as a file in the web-app project, then **redeploy** (see below).
`order-handler.gs` is the router (`doGet`/`doPost`); the others define the
`handle…_` functions it calls. If a handler file is missing, its actions return
`unknown-action`.

| File | Provides | Setup fn to run once | Sheet tabs it uses |
|------|----------|----------------------|--------------------|
| `order-handler.gs` | Router + orders, team login/scan/signup, profiles, admin-dashboard actions, walk, prayer intake, store catalog | `installPrayerIntake`, `installSubscribersTab`, `installAdminsTab`, `stwCommerceSetup`, `installYourWalk` (as needed) | Orders, TeamMembers, Prayers, etc. |
| `team-messaging-handlers.gs` | `validateTeamToken_` (⚠️ **many features depend on this**), announcements, DMs, member notes, **chat feed** (`sendChatMessage`/`getChatMessages`) | — (tabs auto-create) | Announcements, DirectMessages, MemberNotes, ChatMessages, TeamMembers |
| `social-handler.gs` | Community likes/comments/replies (`toggleLike`/`getLikes`/`postComment`/`getComments`) **and the new Posts feed** (`createPost`/`getFeed`/`editPost`/`deletePost`/moderation) | `installSocialTab` | Social, Posts |
| `content-handler.gs` | Super-admin CMS: outreach stories + testimonies (`listOutreachStories`/`saveOutreachStory`/`deleteOutreachStory`/`listTestimonies`/`saveTestimony`/`deleteTestimony`) + public `getPublishedContent` | `stwContentSetup` | OutreachStories, Testimonies |
| `finance-handler.gs` | Finance CRUD (`logFinanceEntry`/`getFinanceEntries`/`editFinanceEntry`/`deleteFinanceEntry`) | — | Finances |
| `connect-follow-up-handler.gs` | Connect intake + push-notify follow-ups | `installConnectTriggers` | Connect follow-up tabs |

### Script Properties (P1 — required)
Project settings (gear) → Script properties:

| Property | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather (same as the GitHub secret). Without it, Telegram sends silently fail. |

### Redeploy P1 (do this after ANY P1 file change)
1. Save all files in the editor.
2. **Deploy → Manage deployments → (pencil/edit) → Version: New version → Deploy.**
3. The URL stays the same, so `site-config.json` needs no change.

---

## P2 — STW Order Ledger (bound) — files

| File | Provides | Setup / notes |
|------|----------|---------------|
| `admin-dashboard.gs` | The **STW Admin** spreadsheet menu (`onOpen`), inventory/finance views, monthly PDF report generator, **Finance Archive → Sync** submenu | Reload the spreadsheet to see the menu. Only **one** `onOpen` may exist in this project. |
| `finance-sync.gs` | Syncs the Finances tab → the STW Finances archive (per-month tabs + Annual Summary). Must **not** define its own `onOpen` (menu is merged into admin-dashboard.gs). | Run `setupFinanceSyncTrigger` once for nightly auto-sync. |

---

## P3 — STW Finances archive (bound) — file

| File | Provides | Setup / notes |
|------|----------|---------------|
| `finance-archive-menu.gs` | The **STW Reports** menu on the archive spreadsheet: *Generate Monthly Report (PDF)* + *Generate Annual P&L (PDF)* → Drive "STW Finance Reports" + email | Extensions → Apps Script → paste → Save → reload the spreadsheet. First run authorizes Drive/Gmail. Its own `onOpen` is fine (separate project). |

---

## One-time setup functions (run from the Apps Script editor's Run menu)

| Function | Project | Purpose | Re-runnable? |
|----------|---------|---------|--------------|
| `installSocialTab` | P1 | Create the **Social** tab (likes/comments) | Yes (idempotent) |
| *(Posts tab)* | P1 | Auto-created by `createPost` on first use — no manual step | — |
| `stwContentSetup` | P1 | Create **OutreachStories** + **Testimonies** tabs | Yes |
| `installPrayerIntake` | P1 | Create the **Prayers** + drip tabs | Yes |
| `setupFinanceSyncTrigger` | P2 | Nightly finance archive sync | Yes |

---

## Community rich posts (photos + @mentions) — needs redeploy

The community feed now supports **photo attachments** and **@mention notifications**:
- `social-handler.gs` gained `handleUploadImage_` (base64 → Drive folder **"STW Community Uploads"** → public URL) and `@mention` parsing that relays a Telegram notice. `handleCreatePost_` also relays prayer/thanksgiving posts to Telegram thread 21 when the poster ticks "Share to Telegram".
- `order-handler.gs` routes the new `uploadImage` action.

> ⚠️ **Naming fix (important):** community stories use `COMMUNITY_STORIES_TAB` /
> `CommunityStories` sheet — NOT `STORIES_TAB`, which order-handler.gs already
> uses for the testimony pipeline. If you ever see
> `SyntaxError: Identifier 'STORIES_TAB' has already been declared`, an old copy
> of the stories code is still pasted somewhere; repaste the current
> `social-handler.gs`. A duplicate top-level identifier takes the ENTIRE web app
> down (login included).

Also added since: **Scripture study** (`saveStudyMark`/`getStudyMarks`, per-user verse highlights + notes, auto-creating `StudyNotes` tab), **Stories** (`createStory`/`getStories`, 24h ephemeral, auto-creating `CommunityStories` tab), **`deleteAnnouncement`** (super-admin removes announcements, in `team-messaging-handlers.gs`), and the community **Messages** panel (uses the existing `sendDm`/`getDmContacts`/`getDmMessages`).

To activate all of the above: repaste **`social-handler.gs`**, **`team-messaging-handlers.gs`**, and **`order-handler.gs`** into the P1 web-app project and **redeploy**. On the first photo/story upload, Apps Script prompts once to authorize **Drive**. No setup functions needed — the `Stories` + upload folder auto-create.

## Community group chats / forum topics — needs redeploy

Members (and the team, from the Team Portal **Forum** tab) can create named **group chats** to discuss Scripture. Group messages are ordinary **Posts** rows whose `channel` = `group:<id>`, so they reuse the existing likes/comments/feed machinery and **show up on the community page**.
- `social-handler.gs` gained: `handleCreateGroup_` / `handleListGroups_` / `handleRenameGroup_` / `handleDeleteGroup_`, a new **`CommunityGroups`** tab (unique const `COMMUNITY_GROUPS_TAB`, auto-creates), and a `groupTouch_` last-activity bump. `handleCreatePost_` now also honors a **`reply_as`** field — a display-name override that is **only** applied when the validated user is `super_admin` (used for the "Reply as Seed the Word" ministry voice). Non-super-admins can never override their author name.
- `order-handler.gs` routes the new `createGroup` / `listGroups` / `renameGroup` / `deleteGroup` actions.

> ⚠️ `COMMUNITY_GROUPS_TAB` is a **unique** top-level const — same rule as `COMMUNITY_STORIES_TAB`: never reuse an existing tab-name identifier or the whole web app (login included) goes down with a duplicate-declaration SyntaxError.

To activate: repaste **`social-handler.gs`** + **`order-handler.gs`** into P1 and **redeploy**. The `CommunityGroups` tab auto-creates on first `createGroup`. No setup function needed.

## Connect prayer wall → community feed (consent-gated) — needs redeploy

Prayers/thanksgivings submitted on **connect.html** can now appear on the community feed's Prayer & Thanksgiving section — but **only when the submitter opts in**.
- `connect.html` prayer form gained a **"Share this on our community prayer wall"** checkbox (`share_public`). Unchecked = stays private (default).
- `order-handler.gs`: `PRAYERS_HEADERS` gained a **`public_consent`** column (15th). `appendPrayersRow_` + `handlePrayerIntake_` now write `TRUE`/`FALSE` from the opt-in. A new **`handleGetPublicPrayers_`** returns ONLY consented prayers (anonymous submitters shown as "A community member"); it's routed in both `doPost` and `doGet` as `getPublicPrayers`.
- `community.html` `loadFeed()` fetches `getPublicPrayers` in parallel and merges consented prayers as read-only cards.

> ⚠️ Privacy: non-consented and private prayer requests are **never** returned by `getPublicPrayers`. The gate is a hard `public_consent === TRUE` check. Existing prayer rows (no consent column) are treated as not-consented.

To activate: repaste **`order-handler.gs`** into P1 and **redeploy**. The `public_consent` column is added to the Prayers header automatically only on a fresh tab; **for the EXISTING Prayers tab, add a `public_consent` header cell in the next empty column** (or leave it — new submissions will still record consent in column 15, and admins can set older rows to `TRUE` manually to feature them).

## Current status — what still needs doing (update as you go)

- [ ] **P1: paste `content-handler.gs`** + redeploy + run `stwContentSetup()` → Content Studio stories/testimonies + live News content.
- [ ] **P1: paste `team-messaging-handlers.gs`** + redeploy → chat feed, DMs, announcements, and `validateTeamToken_` (Content Studio + community depend on it).
- [ ] **P1: paste `social-handler.gs`** + redeploy + run `installSocialTab()` → community likes/comments/replies, the Posts feed, **and community group chats** (`createGroup`/`listGroups`/`renameGroup`/`deleteGroup` + `reply_as`).
- [ ] **P1: repaste `order-handler.gs`** (has the social-routing fix + Posts routes + **group-chat routes**) + redeploy.
- [ ] **P3: paste `finance-archive-menu.gs`** into the STW Finances archive bound script.
- [ ] **P1: confirm `TELEGRAM_BOT_TOKEN`** script property is set.
- [ ] **P1: repaste `order-handler.gs` + `team-messaging-handlers.gs`** + redeploy → store order management (`getStoreOrders`/`updateStoreOrderStatus`), packing→inventory+MinistryStats decrement, promo/comp codes (`generatePromoCode`/`listPromoCodes`/`deactivatePromoCode`), per-member permissions (`setMemberPermissions` + `permissions` on login/profile). See "Store order management + comp codes + per-member permissions" section below.
- [ ] **P1: repaste `order-handler.gs`** + redeploy → free-Bible requests now log to `Bibles` AND create a linked comped order in the Orders queue, 1-per-person gate, all-admin notify, triple-handoff-email fixed. See "Free-Bible requests → unified Orders queue" section below.

> After the P1 pastes, do **one** redeploy (New version) — it covers all of them.

---

## Quick "did it work?" checks

- **Community feed**: open `community.html` logged in → post something → refresh → it persists (not just optimistic).
- **Likes/comments**: like a post in one browser, reload in another → count matches.
- **Content Studio**: `admin/dashboard.html` as super-admin → add a story marked Published → appears on `news.html` within ~3 min.
- **Finance reports**: STW Finances archive → **STW Reports → Generate Monthly Report (PDF)**.


## Inventory movements + store-from-Lists + finance sync — needs redeploy (P1)

Team portal inventory logging is now a full movement flow, and the store reads real items + availability.
- **Date bug fixed**: all inventory/finance dates now use the ministry-local calendar day (`localToday_()` / client `toLocaleDateString('en-CA')`) instead of UTC, so evening-Pacific entries no longer log as "tomorrow."
- **`order-handler.gs`**:
  - Inventory schema: the `type` column carries the **movement type** (`restock` | `store-order` | `adjustment` | `outreach`); the **`notes` column (J) holds donor/attribution text** (the portal's "who covered/donated" dropdown reads its options from and writes to this column); **`cost_per_unit` (H) is ALWAYS filled from the Lists sheet** (never blank) and `total_cost` (I) = H × qty; a single **`detail_notes`** column holds optional extra remarks (auto-appended by header name via `ensureColumn_`). Columns `cost_status`, `covered_by`, `receipt_url` were **removed** — they aren't stored in Inventory.
  - `handleTeamScan_` accepts `movement_type`, `paid` (bool), `donor_note`, `detail_notes`, and (when paid) a base64 `receipt_data`. Restock = stock **in**; store-order/outreach = **out**; adjustment respects `direction`. Only outbound movements bump `total_scans` (token-based, not from the notes column). When `paid` is true it **auto-creates a Finances expense** for `cost_per_unit × qty` (which syncs to STW Finances overnight); the **receipt lives on the Finances tab** per its structure, not in Inventory.
  - `handleTeamLogin_` no longer recomputes `total_scans` from the Inventory notes column (that column is donor text now) — it returns the stored token-based counter.
  - New **`handleGetInventoryMeta_`** (`getInventoryMeta`) returns reusable donor names (`covered_by`), recent event sources, and the member's last event.
  - `handleTeamLogin_` now returns `last_event` (the member's most recent event source) so the portal prefills it (no more "not found").
  - `getStoreCatalog_` now attaches **`available`** per item = the maintained **MinistryStats** `item` count (via `getMinistryStockMap_`), joined by id. The store catalog (products + price) comes from the **Lists** tab; the quantity/availability comes from **MinistryStats** (the hand-kept `{"id":...,"count":N}` rows) — NOT the Inventory movement log.
- **`finance-handler.gs`**: `handleLogFinanceEntry_` now accepts a pre-uploaded `entry.receipt_url` (so an inventory movement's receipt lands on the finance row without re-uploading). It also accepts **multiple receipts** (`receipt_data`/`receipt_url` may be an array) — all uploaded to STW Receipts and **newline-joined into column J** (the Finance→STW Finances sync only reads columns A–G, so multi-URL in J is safe). And it accepts an optional **`items`** array + **`order_ref`** to tie an expense to the Bibles/items that went out (item lines folded into the description; order ref added to column G references). `handleGetFinanceEntries_` returns `receipt_urls[]` (split from column J).
- Finance form (`team.html`): the receipt input is now `multiple` with per-photo thumbnails, plus an optional "Related items / order" section (item picker from the Lists catalog + order/reference #). Inventory movements that we paid for pass their `INV-xxxx` as `order_ref` so the auto finance entry links back.

To activate: repaste **`order-handler.gs`** + **`finance-handler.gs`** into P1 and **redeploy**. The new Inventory columns auto-append on the next movement. No setup function needed.

> Store frontend (`store-catalog.js`) now also renders **Lists-tab rows that have no hardcoded product** and shows **live availability for all categories** — this ships via git (no Apps Script step), but availability numbers only populate once the redeployed `getCatalog` returns the `available` field.

## Store order management + comp codes + per-member permissions — needs redeploy (P1)

This is **Stage 1** of the store-orders / team-portal overhaul. It's all backend
(the UI that drives it ships separately via git in later stages). It adds three
things to the P1 web app, all in files you already have:

### What changed (files to repaste into P1)
- **`order-handler.gs`** (router + most handlers):
  - **Store order management (admin):** `getStoreOrders` (lists every StoreOrders
    row, newest first) and `updateStoreOrderStatus` (advances a store order's
    status). Both are **admin-gated with `passphrase_hash`** (same gate the
    Content Studio already uses). Statuses: `new · confirming · packing ·
    shipped · delivered · cancelled`.
  - **Inventory + MinistryStats on packing:** the FIRST time a store order moves
    to **`packing`**, each line item is logged to the **Inventory** tab as an
    `out` movement (`type: store-order`) AND the matching **MinistryStats**
    `item` count is **decremented** (`decrementMinistryStock_`), so the store's
    live availability drops. The storefront catalog cache is flushed so it shows
    immediately. Each status change also emails the shopper a branded letter
    (`buildStoreStatusEmail_`, reuses the existing `emailShell`).
  - **Promo / comp codes:** new **`PromoCodes`** tab (auto-creates) with
    `generatePromoCode` / `listPromoCodes` / `deactivatePromoCode` (super-admin
    or passphrase). `handlePlaceOrder_` now reads an optional **`promoCode`** on
    the order: a valid code **comps the order** (subtotal → $0, flagged, free-claim
    limit bypassed) and **decrements the code's remaining uses** (auto-deactivates
    when spent, `LockService`-guarded against double-spend). An invalid/exhausted
    code is a **hard error** (`code: 'promo-invalid'`) so the shopper knows it
    didn't apply. StoreOrders rows gain `comped` + `promo_code` columns (auto-appended).
  - **Per-member permissions:** `handleTeamLogin_` and `handleGetProfile_` now
    return a **`permissions`** array. `super_admin` always gets ALL permissions;
    others get their stored list, or a role-based default until a super-admin
    tunes them. Keys: `scanner, finance, orders, chat_admin, training_admin,
    content_studio, members_admin`.
- **`team-messaging-handlers.gs`**:
  - **`setMemberPermissions`** (super-admin/passphrase) writes a member's
    permission list (JSON) to the TeamMembers **`permissions`** column
    (auto-appended by header name — position-independent).
  - `getAdminMembers` now returns each member's resolved `permissions` (so the
    Content Studio grid can pre-check boxes).

### New doPost actions (all routed in `order-handler.gs`)
`getStoreOrders`, `updateStoreOrderStatus`, `generatePromoCode`,
`listPromoCodes`, `deactivatePromoCode`, `setMemberPermissions`.

### To activate
1. Repaste **`order-handler.gs`** and **`team-messaging-handlers.gs`** into the
   **P1** web-app project.
2. **Redeploy** P1 (Deploy → Manage deployments → edit → New version → Deploy).
3. No setup function needed — the `PromoCodes` tab, the StoreOrders
   `comped`/`promo_code`/`tracking_number` columns, and the TeamMembers
   `permissions` column all **auto-create on first use** via `ensureColumn_`.

### Quick "did it work?" checks
- **Generate a code:** from the Apps Script editor Run a test, OR (after Stage 3
  ships) use Content Studio → Members. Manual test payload (POST to the web-app
  URL, `Content-Type: text/plain`):
  `{"action":"generatePromoCode","passphrase_hash":"2e3df09a3a06ebdacb4cf637764073674243ed9497da164c94a955f7ae931440","code":"THANKYOUSTW","max_redemptions":5}`
  → expect `{ok:true,code:"THANKYOUSTW",max_redemptions:5}`.
- **List orders:** POST `{"action":"getStoreOrders","passphrase_hash":"2e3df09a…931440"}`
  → expect `{ok:true, orders:[…], statuses:[…]}`.
- **Advance a status:** POST `{"action":"updateStoreOrderStatus","passphrase_hash":"…","order_id":"STW-2026-XXXXXXXX","status":"packing"}`
  → the shopper gets the "being packed" email, the Inventory tab gets an `out`
  row, and the item's MinistryStats count drops.
- **Permissions:** log a non-super-admin member in on `team.html` and check the
  browser console `JSON.parse(localStorage['stwm-team-session']).permissions` —
  it should be an array (empty for a plain member, role-default for an admin).

> ⚠️ These handlers call `validateAdminPassphrase_` (in `team-messaging-handlers.gs`)
> and `ALL_PERMISSIONS`/`resolveMemberPermissions_` (in `order-handler.gs`). All
> `.gs` files in P1 share one global scope, so both files must be present and
> current in the SAME project — repaste both together, then one redeploy.

## Free-Bible requests → unified Orders queue + all-admin notify — needs redeploy (P1)

Reworks the free-Bible **request** flow so it's tracked and processed like a
store order, fixes the duplicate ("triple") handoff email, and notifies every
admin + super-admin instead of only the shared inbox. All in **`order-handler.gs`**.

### What changed
- **Logged to the `Bibles` tab (unchanged) AND mirrored into the Orders queue.**
  On submit, `handleBibleRequest_` still writes the detailed `Bibles` row
  (source of truth: story, contact, IP hash, privacy fields) AND now calls
  `createBibleQueueOrder_` to write a **comped $0 order** to the **StoreOrders**
  tab (order_id `BIB-YYYY-XXXXXXXX`, `comped=YES`, a `free-bible` line item, and
  a new `bible_submission_id` column linking the two). The `Bibles` row gets a
  `queue_order_id` back-link. So the team processes every request in the
  **Team Portal → Orders** tab alongside store orders.
- **1 free Bible per person.** `handleBibleRequest_` now enforces
  `checkFreeClaimAllowed_(email, phone)` (max 1 free claim per identity in the
  rolling window) plus `bibleIpAlreadyClaimed_` (soft IP-hash dedup, fail-open).
  A blocked request returns `code:'claim-limit'` with a friendly message. (Note:
  email+phone is the real gate; IP + the client token are soft signals.)
- **Approval moved to the queue.** Advancing a `BIB-` order in the Orders tab
  drives `buildBibleStatusEmail_`: **confirming = approve** → emails the
  requester "Your free Bible is approved — tell us where to send it" with the
  handoff link; **cancelled = gentle decline**; packing/shipped/delivered reuse
  the warm store letters. `mirrorBibleStatusFromOrder_` keeps the `Bibles` row
  status in sync (confirming→approved, packing→awaiting_handoff,
  shipped/delivered→fulfilled, cancelled→declined). The old email
  approve/decline GET links still exist as a harmless fallback.
- **Triple "Bible request handoff" email FIXED.** The handoff form is a GET
  form, and email link-scanners were re-hitting the submit URL, re-sending the
  notify each time. `handleBibleRequestHandoff_` now stamps a
  `handoff_notified_at` column FIRST and only emails/syncs once; a re-hit sees
  the stamp and no-ops. On the single real submit it also copies the address
  onto the linked order and advances it to **packing** (`applyBibleHandoffToOrder_`).
- **All admins + super-admins notified.** New `getAdminEmails_` /
  `emailAllAdmins_` (reads the TeamMembers sheet, role admin/super_admin, always
  includes `TEAM_INBOX`, falls back to it). Used for the new-request notice, the
  handoff notice, and the 48h review reminder (`sendBibleRequestReviewReminderEmail_`,
  now pointing admins to the Orders queue rather than GET links). The reminder
  cron `processBibleReviewReminders_` stays idempotent via `reminder_sent_at`.
- The consolidated intake form + retirement of the duplicate donate.js /
  donate-page.js request paths ships via git (frontend, no Apps Script step).

### New / changed columns (all auto-created via `ensureColumn_`, no manual step)
- StoreOrders: `bible_submission_id` (links the queue order back to the Bibles row).
- Bibles: `queue_order_id` (link forward to the queue order), `handoff_notified_at`
  (idempotency stamp for the handoff email).

### To activate
1. Repaste **`order-handler.gs`** into the **P1** web-app project.
2. **Redeploy** P1 (New version). No setup function needed — all new columns
   auto-create on first use.
3. Confirm the Script Property **`BIBLE_REQUEST_REVIEW_SECRET`** is still set
   (the handoff link is HMAC-signed with it).

### Quick "did it work?" checks
- Submit a free-Bible request (connect page). Expect: a `Bibles` row
  (`pending_review`), a `BIB-…` row in StoreOrders (`status=new`, `comped=YES`),
  a "we got it, reviewing" email to the requester, and one notice to every admin.
- In Team Portal → **Orders**, advance the `BIB-` order to **Confirming** →
  requester gets the "approved, tell us where to send it" email with the handoff
  link. Fill the handoff form once → exactly ONE handoff email to admins, the
  order flips to **Packing** with the address attached. Re-open/reload the
  handoff URL → NO duplicate email (the `handoff_notified_at` guard).
- Submit a SECOND request with the same email/phone → blocked with
  `code:'claim-limit'`.


## Profile-picture fix + community feed avatars — needs redeploy (P1)

Two related avatar fixes. Both are in P1 web-app files.

**What changed**
- `connect-follow-up-handler.gs` — `uploadProfilePicToDrive_` now returns a **stable** embeddable URL (`https://drive.google.com/uc?export=view&id=<fileId>`) instead of `file.getDownloadUrl()`. The old download URL was short-lived and broke in `<img>` tags, so the nav/profile avatar looked corrupted and vanished on scroll.
- `social-handler.gs` — the **Posts** sheet gets a new `author_pic` column (11th). `handleCreatePost_` snapshots the author's `profile_pic_url` onto the post (same pattern as `author_role`), and `handleGetFeed_` returns it (falling back to a live name→pic lookup for rows created before the column existed, via new `socialPicOf_`). This lets the community feed render real author profile pictures instead of initials-only.

**Frontend (ships via git, no Apps Script step)**
- `community.html` renders `author_pic` in post/compose avatars (via `avatarInner()` + the existing `driveImg()` normalizer, with initials fallback on image error).
- `nav-auth.js` avatar `<img>` now has an `onerror` fallback to the name (bumped to `?v=4` site-wide).

**Activate**
1. Repaste **`connect-follow-up-handler.gs`** and **`social-handler.gs`** into the P1 web-app project and **redeploy**.
2. The Posts `author_pic` column auto-appends on the next `createPost`. Existing posts fall back to a live name→pic lookup, so they show avatars too (for members who have a saved picture).
3. **Re-upload your profile picture once** in Team Portal → Profile Settings after deploy, so the new stable `uc?export=view` URL replaces any old broken `getDownloadUrl` value in the TeamMembers `profile_pic_url` cell.

**Did it work?**
- Team Portal profile card + nav badge show your picture and it stays put on scroll/refresh.
- On community.html, your posts show your avatar (not just initials).


## Instagram-style stories: per-member "seen" state — needs redeploy (P1)

**What changed**
- `social-handler.gs` — new `markStoryViewed` action + `StoryViews` tab (`story_id | viewer | viewed_at`). `handleGetStories_` now returns a per-viewer `seen` flag on each story (joined from StoryViews for the token's member). New helpers `getStoryViewsSheet_`, `storyViewsForViewer_`, `handleMarkStoryViewed_`.
- `order-handler.gs` — routes `markStoryViewed` → `handleMarkStoryViewed_` (next to `getStories`).

**Frontend (ships via git, no Apps Script step)**
- `community.html` — stories rail now groups by author with unseen (gradient) vs seen (gray) rings, unseen-first ordering; the viewer plays an author's stories in sequence with an animated segmented progress bar, hold-to-pause, tap zones (left=prev/right=next), swipe (left/right = author, down = close), and keyboard arrows/Esc. Viewing a story calls `markStoryViewed` so "seen" syncs across the member's devices.

**Activate**
1. Repaste **`social-handler.gs`** + **`order-handler.gs`** into the P1 web-app project and **redeploy**.
2. The `StoryViews` tab auto-creates on the first `markStoryViewed`. Until redeploy, stories still work; every story just shows as unseen (gradient ring) since the backend won't return `seen`.

**Did it work?** View a story on one device → its ring turns gray there and on another device after refresh.

> The story viewer engine is reused by the upcoming Phase 2 team-portal DM inbox (Instagram-style), so a stories rail can appear at the top of the inbox with no rebuild.


## Phase 2 — DM inbox (block + reachability + reports + throttled notify) — needs redeploy (P1)

Consolidates team DMs onto the **DirectMessages** tab with unread tracking, block + super-admin reachability rules, reports, and a quiet email notifier.

**What changed (all in `team-messaging-handlers.gs`, routes in `order-handler.gs`)**
- `handleSendDm_` reworked: validates recipient, enforces block + reachability (super-admin bypass), appends to DirectMessages (now with a `read_at` column, auto-added), Telegram nudge, and a **throttled email** (`notifyThrottled_`) — at most once per (recipient, sender) per day, only on real new activity, never an empty "no messages" email.
- `handleGetDmContacts_`: returns conversations newest-first with `last_message`, `last_ts`, `unread` count, and each contact's `pic` (via `socialPicOf_`).
- `handleGetDmMessages_`: returns the thread and **marks incoming unread rows read** (stamps `read_at`).
- New actions: `getDmSettings`, `blockUser`, `unblockUser`, `setDmRestriction` (super-admin), `reportUser`, `listDmReports` (moderators).
- New helpers: `getTeamMemberEmail_`, `getDmSettingsFor_`/`setDmSettingsFor_`, `dmCanReach_`, `notifyThrottled_` (reused by Phase 4 for prayers/thanksgiving), `getModerationEmails_`, `teamMemberExists_`.

**New sheet tabs (auto-create)**
- `DmSettings`: member | blocked_json | restricted | allowed_json
- `DmReports`: timestamp | reporter | reported | reason | status
- `NotifyLog`: recipient | counterparty | kind | date (throttle stamps)
- `DirectMessages` gains a `read_at` column (auto-added via ensureColumn_).

**Reachability rule (on send A→B):** allowed unless B blocked A, or B is restricted and A isn't in B's allow-list. Super-admin senders always allowed.

**Moderation permission:** grant an admin the `moderation` permission (in the TeamMembers `permissions` JSON) to receive reports + see the Content Studio moderation screen. Super-admins always have it.

**Activate:** repaste `team-messaging-handlers.gs` + `order-handler.gs` into P1 and redeploy. Tabs auto-create.

**Did it work?** Member A DMs B → B sees it in the portal Chat inbox with an unread dot + gets ONE email (not per message). B blocks A → A's next send is rejected. Super-admin sets B restricted with allow-list [C] → only C (and super-admins) can DM B. Report → appears in Content Studio → Moderation + emails moderators.


## Phase 2 — Content Studio Moderation screen — needs redeploy (P1) [pairs with the DM inbox above]

**What changed**
- `team-messaging-handlers.gs` — `handleGetAdminMembers_` now also returns `dm_restricted` ('YES'/'no') and `dm_allowed` (array) per member (via `getDmSettingsFor_`), so the Content Studio moderation screen can show current reachability.
- Frontend `admin/dashboard.html` + `admin-studio.js` (ship via git): new **Moderation** section — a reports inbox (`listDmReports`) and per-member **Restricted** toggle + allow-list (`setDmRestriction`). Added a `moderation` permission to the Members permission grid (grant via existing `setMemberPermissions`) so an admin can be appointed a moderator; super-admins always are.

**Activate:** already covered by repasting `team-messaging-handlers.gs` + `order-handler.gs` for the DM inbox — one redeploy does both.

**Did it work?** Content Studio → Moderation: toggle a member Restricted, pick allowed contacts, Save → only those (and super-admins) can DM them. Reports from the DM inbox appear here. Grant an admin the Moderation permission (Members section) → they get report emails + can see this screen.


## Announcements: audience + priority + emergency email — needs redeploy (P1)

**What changed (`team-messaging-handlers.gs`)**
- `handlePostAnnouncement_` now takes `audience {admins, members, public}` + `priority (normal|urgent|emergency)`. Fixed a bug where super-admins couldn't post (was `role !== 'admin'`); now allows admin/super_admin or the `chat_admin` permission (`announcerAllowed_`).
  - **Public** → Telegram (thread 553) + a mirrored **Community post** (channel `announcements`) so it shows on community.html.
  - **Emergency** → emails targeted recipients (`emailEmergencyAnnouncement_`): all admins/super-admins, plus members if Members is selected. **Respects `notify_pref: 'none'`** (does not bypass opt-out).
  - Adds an `audience_json` column to the Announcements sheet (auto).
- `handleGetAnnouncements_` returns `audience` + filters by caller: public-read sees only public; members see public + members-targeted; staff see all.

**Frontend (ships via git)**
- Announcement composer moved into the Chat/DM section (chat_admin-gated "📣 New announcement" button) with Audience checkboxes + Priority selector (green/yellow/red).
- Team portal renders active announcements as banners: emergency = existing red blaring banner; normal = green, urgent = yellow (`#announcement-banner`).
- Community feed renders public announcements with a priority-colored left accent (green/yellow/red).

**Activate:** repaste `team-messaging-handlers.gs` (+ `order-handler.gs` already pending) and redeploy.

**Did it work?** Post a Normal internal→members announcement → members see a green banner in the portal, admins see it too, community page does NOT. Post Public Urgent → yellow banner + community post + Telegram. Post Emergency w/ Members selected → red blaring banner + emails all admins + members who allow notifications.


## Announcements: email/newsletter audience + history + recent viewer — needs redeploy (P1)

**What changed (`team-messaging-handlers.gs`)**
- New **Email / newsletter** audience: `audience.email` → `emailAnnouncementNewsletter_` emails opted-in team members (notify_pref ≠ none) + the newsletter `Subscribers` list (BCC, de-duped, respects opt-out). Independent of priority.
- Telegram: response returns `telegram_sent` / `telegram_skipped`. Dedup now only blocks an **accidental rapid double-submit** of the same subject within `ANNOUNCEMENT_DEDUP_WINDOW_MS` (3 min) via `hasAnnouncementBeenSentRecently_` — a deliberate re-post later in the day is allowed (previously it blocked same-subject for the whole day). **`TELEGRAM_BOT_TOKEN` must hold the `news_seedtheword_bot` token (NOT the Bible bot).** Use `showTelegramTokenStatus` to verify; it warns if it matches `BIBLE_BOT_TOKEN`.
- New `getAnnouncementHistory` action (`handleGetAnnouncementHistory_`) → recent announcements w/ priority + audience + telegram_sent, for the composer's history panel. Routed in `order-handler.gs`.

**Frontend (git):** composer gains a 📧 Email/newsletter audience checkbox + a "Recently posted" history panel (so the team doesn't repost). Portal has a persistent **"📣 See recent announcements"** link that opens this week's list even after the banner is dismissed.

**Activate:** repaste `team-messaging-handlers.gs` + `order-handler.gs`, redeploy. Newsletter uses the existing `Subscribers` tab (run `installSubscribersTab()` once if not present).

**Note on "Telegram didn't post":** that was almost certainly because the new audience-based handler wasn't deployed yet (the old deployed code only sent Telegram on the legacy `send_telegram` flag, not `audience.public`). After this redeploy, Public → Telegram works provided `TELEGRAM_BOT_TOKEN` is set.
