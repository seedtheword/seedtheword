# Session Handoff — Seed the Word + Related Projects

Last updated: August 2026 — reflects full current state of the site.

---

## Environment

- **OS:** Windows, PowerShell shell
- **Primary workspace:** `c:\Users\David\Documents\min web files`
- **Primary repo:** `https://github.com/seedtheword/seedtheword` (branch: `main`)
- **Live site:** https://seedtheword.org (GitHub Pages)
- **Git note:** `gh` CLI is NOT installed. Identity: `seedthewordministry@gmail.com`.
  Terminal output can be garbled — redirect to a temp file and read it back.
  Use `git -C "path" ...` rather than `cd` + `git`. Avoid interactive rebase.
  Pull with `--no-rebase --no-edit` to avoid detached HEAD.
- **Temp file .gitignore:** All `*.txt` output files (gp*.txt, push-err.txt, etc.)
  are gitignored — don't commit them.

### Sibling repos
- **moft-evangelism** — `c:\Users\David\Documents\min web files\moft-evangelism`
  → `https://github.com/seedtheword/moft-evangelism`
- **vanessa-interiors** — `c:\Users\David\Documents\vanessa-interiors`
  → `https://github.com/seedtheword/vanessa-interiors` (branch: `master`)

---

## Design System (site-wide)

- **Fonts:** Playfair Display (serif headings), Source Sans 3 / Inter (body),
  IBM Plex Mono (labels/eyebrows), Caveat (handwritten accents)
- **Palette:** ivory `#FAFAF8`, gold `#B8860B`, gold-light `#D4A84B`,
  olive `#2C5F2E`, warm border `#E8E4DF`
- **Aesthetic:** Editorial magazine — mono uppercase labels, serif titles,
  gold accents, tight content density (no excessive whitespace)
- **CSS tokens:** `theme.css` (v1) + `main.css` (v35+)

---

## Project 1 — Seed the Word Ministry Website

### index.html — Homepage
- **Hero:** GTA V-style carousel with 19 team/outreach photos. Ken Burns pan/zoom
  via `requestAnimationFrame`. Desktop images swap to cropped versions at ≥768px.
  Overlaid text: "Seed the Word / that is / Jesus ✝ Christ"
- **Two hero CTAs:** "Who is Jesus?" (green `.btn-jesus` → about.html) +
  "Get a FREE Bible" (glassmorphism `.btn-bible-glass` → donate.html). Both
  min-width 180px, centered flex row, share 4.7s reveal animation.
- **Intro overlay:** Cross animates up → logo → transitions out
- **Showcase hub:** Search bar + daily verse + quick-links (Give/Reading Plan/
  News/Community/Store)
- **Young Adults RSVP:** Maple Park Mondays flyer + RSVP modal (POSTs
  `action:'rsvp'` to GAS handler). #Lynnwood4Jesus tag.
- **Outreach slideshow:** Pulls from `ministry-outreach.json` via
  `bundle-slideshow.js`
- **Careers carousel:** Glass-card volunteer roles (Social Media Admin,
  Greeter, Worship Singer/Musician, Sound Tech, Evangelism Team, etc.)
  linking to `join.html?role=...`

### about.html — "Who is Jesus?" Page
- **Hero + Billy Graham video card** (click-through to YouTube, not iframe)
- **7-movement Gospel journey:** Step 1 always visible; Steps 2–6 are
  `<details>` accordions with images + Scripture. Step 7 = "I want to encounter
  Jesus" button reveals prayer + CTAs (20-day plan, phone, free Bible)
- **Guided mode:** Sticky bottom nav bar (Back / progress / Continue)
- **Testimonies strip:** Pulls 1–2 recent entries from `testimonies.json`
- **S.E.E.D. 9-tile grid:** Hover/tap reveals overlay (Serve/Encounter/Embrace/
  Disciples + Mission/Vision + 3 harvest phases)
- **Team section, How We S.E.E.D. (5 movements), Contact form**
- Design system: Playfair/Source Sans/IBM Plex Mono, gold, ivory (inline `<style>`)

### news.html — Editorial Magazine
- Hero carousel with byline + mono section tag + read time
- **"What's Coming Up":** Merged announcements + calendar in one scrollable column.
  Events click to open `google-calendar.js` modal.
  Announcements: POST `{action:'getAnnouncements', passphrase_hash:'public-read'}`
- **Photo-essay:** Dynamic (pulls `ministry-outreach.json` + `images.json`). No header.
- Milestone banner (live Bible counter) + David's testimony
- Recent Testimonies preview cards → testimonies.html
- Share your story modal (share-story.js)
- **#Lynnwood4Jesus section** (`id="lynnwood4jesus"`)

### community.html — 5-Channel Social Platform
- Tabs: 🏠 Home / 📖 Scripture / 🙏 Prayer / 📚 eLibrary / ✨ Friends
- **Friends in Jesus** (community-catalog.js + store-catalog.css) — restored
- Home: reading card + feed + events collapse on mobile + RSVP
- Scripture: daily chapter reader, verse notes, discussion feed
- Prayer: wall + thanksgiving, type filter, likes/comments
- eLibrary: reading plan cards (lms.js, elibrary-catalog.js)
- Real-time features: compose, likes, comments/replies, share modal, DMs
- Sidebar (desktop): events, reading, quick-links, Join the Team CTA
- Bottom nav (mobile): Telegram/Instagram/Spotify/Twitch/Free Bible
- Dark mode, Google Calendar integration, unread badges

### store.html — Store
- Hero: Luke 6:45 quote + shimmer impact stats (Bibles/Languages/Events) +
  social links + language tags + giving quick-links ($10–$100 → donate.html)
- Glassmorphism Free Bible CTA above the search bar
- Sidebar + product grid (store-catalog.js) + search + category header
- Bundle builder JS loaded (`bundle-journey.js`, `bundle-item-catalog.js`)
- **Donate row (Venmo/CashApp/PayPal/Zelle) REMOVED** — already done

### bundle-builder.html — 5-Step Bundle Builder
Standalone page (not inline in store.html):
1. Select items (product grid with +/− qty)
2. Who's this for (recipient targeting)
3. Keepsake options (cover painting, packaging, labels)
4. Bundle review + pricing
5. Finishing touches → Continue to Cart

### donate.html — Give Page
- Storytelling hero with 3 CTAs (Click to donate / See impact / Get Free Bible)
- Impact counters (dark section) + 3D globe (`outreach-map.js`)
- Story cards (dynamic outreach events)
- **PayPal SDK** — server-verified, covers card/PayPal/Pay Later. Live mode.
- **Free Bible request modal** — full form (name/email/phone/language/city/state/ZIP/story + connect checkboxes)
- **Manual payment methods:** Cash App ($Vanessamind) + Zelle copy-to-clipboard (vanessamindone@gmail.com)
- Venmo removed from methods

### cart.html / checkout.html / orders.html
- Full cart with order summary + checkout form
- QR-code triggered in-person checkout
- "My Orders" history page

### connect.html
- Prayer requests, thanksgiving submissions, free Bible request form

### testimonies.html
- "From the Field" outreach newsletter archive

### admin-help.html — Admin Help Center
- Password-gated. Sidebar nav (grouped, collapsible, searchable).
- Sections: Quick routing, interactive walkthroughs, Team Portal guide,
  Content Studio guide, Editor, Recommendation builder, Images/media,
  Pages/content, Telegram bots, Site dependencies
- JS: `admin-help.js`, `walkthroughs.js`

### admin/ folder
| File | Purpose |
|---|---|
| `dashboard.html` | Content Studio — super-admin no-code CMS |
| `messaging.html` | Team messaging admin panel |
| `qr-labels.html` | QR label generator for Bible distribution |
| `pastor-faleke-dads-chicken.html` | Personal page for Pastor Faleke |
| `pastor-faleke-washington-solutions.html` | Business/personal page |
| `pastor-faleke-wave.html` | W.A.V.E. ministry info page |
| `field-log.html` | Redirect/tombstone |

### Other pages
- `start-here.html` — 20-Day Reading Plan
- `join.html` — Volunteer application
- `how-to-seed/grow/harvest.html` — Discipleship path pages
- `presentation.html` — Admin presentation deck (noindex)

---

## JavaScript (54 files in assets/js/)
Key files by category:
- **Store/Bundle:** `bundle-item-catalog.js`, `bundle-journey.js`, `bundle-slideshow.js`, `bundle-review.js`, `store-catalog.js`, `cart.js`, `cart-badge.js`, `cart-page.js`, `customizer.js`
- **Community/Social:** `community-catalog.js`, `community-social.js`
- **Admin:** `admin-editor.js` + 8 sub-modules, `admin-help.js`, `admin-studio.js`, `walkthroughs.js`
- **Ministry/Outreach:** `ministry-impact.js`, `ministry-outreach.js`, `outreach-map.js` (3D globe)
- **Bible/Spiritual:** `bible-plan.js`, `bible-counter.js`, `your-walk.js`, `layered-plan.js`, `flashcards.js`, `lms.js`
- **Integrations:** `instagram-feed.js`, `google-calendar.js`, `twitch-integration.js`, `telegram-stats.js`, `livestream.js`
- **Other:** `donate.js`, `donate-page.js`, `prayer-intake.js`, `share-story.js`, `testimonies.js`, `nav-auth.js`, `profile-settings.js`, `team-portal.js`, `theme-toggle.js`, `homepage-showcase.js`, `showcase-carousel.js`

## CSS (13 files in assets/css/)
`main.css` · `theme.css` · `store-catalog.css` · `admin-editor.css` · `admin-help.css` · `cart.css` · `community-forkful.css` · `community-social.css` · `customizer.css` · `flashcards.css` · `lms.css` · `outreach-map.css` · `team-social.css`

---

## Google Apps Script (docs/apps-script/)
- **`admin-dashboard.gs`** — Container-bound to STW Order Ledger. `onOpen()` builds STW Admin menu (including Finance Archive submenu). Inventory + Finances tabs.
  - CRITICAL: Only ONE `onOpen()` can exist per project. All menu items must live here.
- **`finance-sync.gs`** — Syncs Finances tab → STW Finances archive spreadsheet
  (ID: `1FcJqsROHdL6bo3YYBMWrHVloW697giVZUTQRK8PNpXg`).
  Per-month tabs + Annual Summary P&L. Nightly trigger. No `onOpen()` — uses admin-dashboard's.
- **`order-handler.gs`** — Store orders, RSVP, free Bible requests
- **`content-handler.gs`** — CMS operations
- **`social-handler.gs`** — Community feed
- **`team-messaging-handlers.gs`** — Team messaging
- `finance-reports.gs` — **DELETED** (made redundant)

### Known gotcha
Pasting a new `.gs` file with its own `onOpen()` kills the STW Admin menu — Apps Script only runs one. Merge all menu items into `admin-dashboard.gs`'s `onOpen()`.

---

## Project 2 — Firm Foundation (vanessa-interiors repo)

**Repo:** `https://github.com/seedtheword/vanessa-interiors` (branch: `master`)
**Local:** `c:\Users\David\Documents\vanessa-interiors`
**Live:** `https://seedtheword.github.io/vanessa-interiors/`

### Brand
- Name: "Firm Foundation" (Matthew 7:24 — built on the rock/cornerstone)
- Palette: White / Gold `#C9A84C` / Sage Green `#8FA98B`
- Fonts: Inter (thin display), Playfair Display (serif italic), Cormorant Garamond small-caps (labels/nav — replaces IBM Plex Mono)
- Aesthetic: Hald Atelier minimalist + Fitch Design + Victorian ornamentals + Christian elements

### About Vanessa
- 20 years old. "Builder by calling. Designer by gift. Inspector by trade. Follower of Jesus."
- Skills: graphic designer, video editor, artist, painter, Photoshop specialist
- Home inspector: OSHA conformance, municipal codes, real estate
- Outreach ministry: Bibles, evangelism, homeless/widows/orphans
- Snohomish County WA, drives out by appointment
- Photo: `assets/images/vanessa.jpg` (copied from Seed the Word photos)

### Site sections
- Hero: "Built on the *Cornerstone.*" + blinking gold cursor `|`
- Selected Work (project index table)
- Gallery (Unsplash interiors + Bible photo)
- Meet Vanessa (photo + facts table)
- Services: Staging / Interior Design / Inspections / Graphics+Video / Art / Consultation
- Scripture callouts: Matt 7:24, Prov 31:27, Col 3:23
- Contact: `vanessamindone@gmail.com` (large display) + "Send an Email" button + Instagram button (→ instagram.com/vanessamindone/) + **Google Calendar Appointment iframe** (placeholder URL — Vanessa needs to create an Appointment Schedule and swap it in)
- Footer: 3-col (Studio / Enquiries / Elsewhere)
- Victorian ornamental dividers (✽❁❀) between sections with gold gradient lines
- No logo (SVG was created and then DROPPED per user)

---

## Working Conventions

- Commit and push after every task.
- Commit messages: short single-token or `-F commitmsg.txt` (PowerShell splits on spaces with `-m`).
- Pull with `--no-rebase --no-edit` before pushing when rejected.
- Never use interactive rebase (caused detached HEAD).
- Temp `.txt` output files are gitignored — don't add them.
- User iterates on visual design frequently — expect follow-up tweaks.

---

## Kickoff prompt for a new session

> "Read SESSION-HANDOFF.md at the root of c:\Users\David\Documents\min web files.
> We're working on the Seed the Word ministry website (seedtheword/seedtheword,
> branch main), the Firm Foundation interior design site (seedtheword/vanessa-interiors,
> branch master), and the STW Order Ledger Apps Script finance automation.
> [Describe your specific task here.]"
