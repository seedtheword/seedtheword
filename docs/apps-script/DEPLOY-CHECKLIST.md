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

To activate: repaste **`social-handler.gs`** + **`order-handler.gs`** into the P1 web-app project and **redeploy**. On the first photo upload, Apps Script will prompt to authorize **Drive** access (one time). No new setup function needed — the upload folder auto-creates.

## Current status — what still needs doing (update as you go)

- [ ] **P1: paste `content-handler.gs`** + redeploy + run `stwContentSetup()` → Content Studio stories/testimonies + live News content.
- [ ] **P1: paste `team-messaging-handlers.gs`** + redeploy → chat feed, DMs, announcements, and `validateTeamToken_` (Content Studio + community depend on it).
- [ ] **P1: paste `social-handler.gs`** + redeploy + run `installSocialTab()` → community likes/comments/replies **and the new Posts feed**.
- [ ] **P1: repaste `order-handler.gs`** (has the social-routing fix + Posts routes) + redeploy.
- [ ] **P3: paste `finance-archive-menu.gs`** into the STW Finances archive bound script.
- [ ] **P1: confirm `TELEGRAM_BOT_TOKEN`** script property is set.

> After the P1 pastes, do **one** redeploy (New version) — it covers all of them.

---

## Quick "did it work?" checks

- **Community feed**: open `community.html` logged in → post something → refresh → it persists (not just optimistic).
- **Likes/comments**: like a post in one browser, reload in another → count matches.
- **Content Studio**: `admin/dashboard.html` as super-admin → add a story marked Published → appears on `news.html` within ~3 min.
- **Finance reports**: STW Finances archive → **STW Reports → Generate Monthly Report (PDF)**.
