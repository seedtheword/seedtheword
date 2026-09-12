/* ============================================================
   walkthroughs.js — standalone interactive help walkthroughs

   Drop this one file on any page (team.html, admin/dashboard.html,
   admin-help.html). It:
     • injects its own theme-safe CSS (uses site theme.css color/radius tokens),
     • carries all walkthrough definitions as data,
     • auto-wires any  <button data-walkthrough="ID">?</button>  trigger,
     • opens the matching walkthrough in a modal with a click-through player
       (spotlight + animated cursor + Back/Next/Replay).

   No dependency on the admin-help gate/sidebar. Safe to include twice
   (guards against double-init). Also exposes window.Walkthroughs.open(id).
   ============================================================ */
(function (global) {
  'use strict';
  if (global.Walkthroughs && global.Walkthroughs.__ready) return;

  // ── Definitions ─────────────────────────────────────────────
  // Each walkthrough: { id, badge, eyebrow, title, tabs?, controls[], steps[] }
  //   controls: [{ ctl, label?, text, cls? }]  — the simulated UI rows
  //   steps:    [{ target, tab?, title, body, behind? }]
  // `cls` on a control: 'pill' | 'btn' | 'btn-green' | 'row:<a>,<b>' (row group)
  var WT = {
    'finance-deposit': {
      badge: '💰', eyebrow: 'Team Portal · Finance tab', title: 'Record a deposit & attach a receipt',
      tabs: [['dash', '📊 Dash'], ['finance', '💰 Finance'], ['orders', '🛒 Orders']],
      controls: [
        { ctl: 'fin-tab', cls: 'pill', text: '💰 Open Finance tab' },
        { ctl: 'fin-type', label: 'Type', text: 'Income ▼' },
        { row: [{ ctl: 'fin-amount', label: 'Amount ($)', text: '250.00' }, { ctl: 'fin-payment', label: 'Payment method', text: 'Zelle ▼' }] },
        { ctl: 'fin-category', label: 'Category', text: 'Designated Scripture ▼' },
        { ctl: 'fin-receipt', label: 'Receipt photos', text: '📸 Tap to take photos or choose files' },
        { ctl: 'fin-save', cls: 'btn-green', text: '💾 Save Entry' }
      ],
      steps: [
        { target: 'fin-tab', tab: 'finance', title: 'Open the Finance tab', body: 'In the Team Portal, tap the <strong>💰 Finance</strong> tab. This is where every dollar in and out of the ministry is logged.', behind: 'The tab only appears if your account has the <b>Finance</b> permission. Opening it loads your recent entries and this month\'s totals.' },
        { target: 'fin-type', tab: 'finance', title: 'Set the Type to "Income" or "Donation"', body: 'There\'s no separate "deposit" button — a deposit is money coming in. Open the <strong>Type</strong> dropdown and choose <strong>Income</strong> or a <strong>Donation</strong> option. (Leave it on "Expense" only for money going out.)', behind: 'The Type decides whether the amount adds to income or subtracts as an expense in the monthly Net figure and the P&L report.' },
        { target: 'fin-amount', tab: 'finance', title: 'Enter the amount', body: 'Type the dollar amount, e.g. <strong>250.00</strong>. The date defaults to today — change it if the deposit was earlier.' },
        { target: 'fin-payment', tab: 'finance', title: 'Pick how it arrived', body: 'Choose the <strong>Payment Method</strong> — for a bank deposit that\'s usually <strong>Zelle</strong>, <strong>Card</strong>, or <strong>Venmo</strong>; use <strong>Cash</strong> for cash handed in.', behind: 'This is how a bank deposit is told apart from physical cash later, so the books reconcile against the bank statement.' },
        { target: 'fin-category', tab: 'finance', title: 'Choose a category', body: 'Pick the <strong>Category</strong> that fits — e.g. <strong>Designated Scripture</strong> for Bible-fund gifts. Add a short description too.' },
        { target: 'fin-receipt', tab: 'finance', title: 'Attach the receipt or deposit slip', body: 'Tap <strong>📸 Receipt Photos</strong> to snap or choose files — a deposit slip, a transfer screenshot, whatever you have. You can add <strong>more than one</strong>.', behind: 'Photos stay on your device until you save. On save they upload to the ministry\'s Google Drive "STW Receipts" folder and link next to the entry.' },
        { target: 'fin-save', tab: 'finance', title: 'Save the entry', body: 'Tap <strong>💾 Save Entry</strong>. You\'ll see "Saving…", then a green confirmation, and it appears in the Recent list.', behind: 'Written to the Finances tab of the ledger and synced overnight into the STW Finances archive, where it rolls into the monthly/annual reports.' }
      ]
    },

    'scan-add': {
      badge: '📦', eyebrow: 'Team Portal · Scan tab', title: 'Manually add an item',
      tabs: [['scan', '📷 Scan'], ['finance', '💰 Finance']],
      controls: [
        { ctl: 'scan-tab', cls: 'pill', text: '📷 Open Scan tab' },
        { ctl: 'scan-manual', text: '✋ Add Item Manually' },
        { ctl: 'scan-pick', label: 'Choose from list', text: 'NIV Bible · BIB-001' },
        { row: [{ ctl: 'scan-qty', label: 'Quantity', text: '− 3 +' }, { ctl: 'scan-type', label: 'Movement', text: '📦 Restock' }] },
        { ctl: 'scan-paid', label: 'Did the ministry pay?', text: '🎁 No — donated' },
        { ctl: 'scan-log', cls: 'btn-green', text: 'Log movement' }
      ],
      steps: [
        { target: 'scan-tab', tab: 'scan', title: 'Open the Scan tab', body: 'Tap the <strong>📷 Scan</strong> tab. This is your field logger — every item handed out or restocked goes through here.' },
        { target: 'scan-manual', tab: 'scan', title: 'Tap "Add Item Manually"', body: 'Below the camera scanner there\'s an <em>"or"</em> divider and a <strong>✋ Add Item Manually</strong> button. Tap it when there\'s no QR code.', behind: 'This opens the item picker, which loads the live catalog from the ministry\'s price list — names and IDs always match the system.' },
        { target: 'scan-pick', tab: 'scan', title: 'Pick the item', body: 'Search or scroll and tap the item, e.g. <strong>NIV Bible</strong>. That opens the movement sheet.' },
        { target: 'scan-qty', tab: 'scan', title: 'Set the quantity', body: 'Use <strong>−</strong> / <strong>+</strong> (or type) to set how many. A box of 3 Bibles = <strong>3</strong>.' },
        { target: 'scan-type', tab: 'scan', title: 'Choose the movement type', body: 'Pick <strong>Given out</strong>, <strong>Restock</strong>, <strong>Store order</strong>, or <strong>Adjustment</strong>.', behind: '"Given out" counts toward outreach totals; "Restock" adds stock <b>in</b> and doesn\'t count as given out.' },
        { target: 'scan-paid', tab: 'scan', title: 'Say whether the ministry paid', body: 'Tap <strong>No — donated</strong> if it was given to us, or <strong>Yes — we paid</strong> if we bought it. "Yes" reveals an optional receipt.', behind: 'Choosing "Yes" auto-creates a matching <b>expense</b> in Finances (cost from the price list) and files any receipt with it — no double entry.' },
        { target: 'scan-log', tab: 'scan', title: 'Log the movement', body: 'Tap <strong>Log movement</strong>. You\'ll see "✅ Logged" and the sheet closes.', behind: 'A new row is written to the Inventory tab with quantity, direction, cost, and your name.' }
      ]
    },

    'order-process': {
      badge: '🛒', eyebrow: 'Team Portal · Orders tab', title: 'Process a store order',
      tabs: [['orders', '🛒 Orders']],
      controls: [
        { ctl: 'ord-tab', cls: 'pill', text: '🛒 Open Orders tab' },
        { ctl: 'ord-filter', label: 'Filter', text: 'Open orders ▼' },
        { ctl: 'ord-card', label: 'Order STW-1042 · Jane D.', text: '1× NIV Bible · Received' },
        { ctl: 'ord-confirm', cls: 'btn', text: 'Mark Confirming →' },
        { ctl: 'ord-packing', cls: 'btn', text: 'Mark Packing →' },
        { ctl: 'ord-shipped', cls: 'btn', text: 'Mark Shipped →' }
      ],
      steps: [
        { target: 'ord-tab', tab: 'orders', title: 'Open the Orders tab', body: 'Tap <strong>🛒 Orders</strong>. It shows the order queue with each order\'s current status.', behind: 'Visible only with the <b>Store orders</b> permission. Opening it loads live orders from the store backend.' },
        { target: 'ord-filter', tab: 'orders', title: 'Filter to what needs work', body: 'Leave it on <strong>Open orders</strong> to see everything not delivered/cancelled, or filter to a status.' },
        { target: 'ord-card', tab: 'orders', title: 'Read the order card', body: 'Each card shows the ID, customer, items, total (or "No charge" if comped), shipping address, and a progress bar.' },
        { target: 'ord-confirm', tab: 'orders', title: 'Mark it Confirming', body: 'A new order shows one button for the next step: <strong>Mark Confirming →</strong>. Tap it once you\'ve reviewed the order.', behind: 'Status updates and the shopper is emailed. Only the next step is offered, so orders can\'t skip stages.' },
        { target: 'ord-packing', tab: 'orders', title: 'Mark it Packing', body: 'When you start boxing it up, tap <strong>Mark Packing →</strong>.', behind: 'The important one: marking <b>Packing</b> logs the items <b>out of inventory</b> automatically and emails the shopper.' },
        { target: 'ord-shipped', tab: 'orders', title: 'Mark it Shipped (add tracking)', body: 'Once mailed, tap <strong>Mark Shipped →</strong>. You\'ll be asked for an optional <strong>tracking number</strong>.', behind: 'The shopper gets a "shipped" email with tracking if added. Final step Delivered is marked on arrival. To stop an order use Cancel — refunds are handled with your payment provider.' }
      ]
    },

    'announcement': {
      badge: '📣', eyebrow: 'Team Portal · Chat tab', title: 'Post an announcement',
      tabs: [['chat', '💬 Chat']],
      controls: [
        { ctl: 'ann-open', cls: 'pill', text: '📣 New announcement' },
        { ctl: 'ann-audience', label: 'Who should see this?', text: '☑ Admins ☑ Members ☐ 🌍 Public ☐ 📧 Email' },
        { ctl: 'ann-priority', label: 'Priority', text: '🟢 Normal · 🟡 Urgent · 🔴 Emergency' },
        { ctl: 'ann-text', label: 'Subject & message', text: 'Study Saturday moved to 6pm…' },
        { ctl: 'ann-photo', label: 'Optional', text: '🖼️ Add photo' },
        { ctl: 'ann-send', cls: 'btn-green', text: 'Post announcement' }
      ],
      steps: [
        { target: 'ann-open', tab: 'chat', title: 'Open the composer', body: 'Go to the <strong>💬 Chat</strong> tab and tap <strong>📣 New announcement</strong>.', behind: 'The button only appears with the <b>Announcements</b> permission. It opens the composer inline.' },
        { target: 'ann-audience', tab: 'chat', title: 'Pick who sees it', body: 'Check one or more: <strong>Admins</strong>, <strong>Members</strong>, <strong>🌍 Public</strong>, or <strong>📧 Email / newsletter</strong>.', behind: 'Public posts to the community page and Telegram. Email goes to opted-in team + newsletter subscribers.' },
        { target: 'ann-priority', tab: 'chat', title: 'Choose the priority', body: 'Pick <strong>🟢 Normal</strong>, <strong>🟡 Urgent</strong>, or <strong>🔴 Emergency</strong>.', behind: 'Emergency emails everyone selected who allows notifications. Urgent + Emergency always go to Telegram, skipping the anti-spam wait.' },
        { target: 'ann-text', tab: 'chat', title: 'Write the subject & message', body: 'Type a short <strong>Subject</strong> and the <strong>Message</strong> body.' },
        { target: 'ann-photo', tab: 'chat', title: 'Add a photo (optional)', body: 'Tap <strong>🖼️ Add photo</strong> to attach images. Photos only go out with the <strong>Public</strong> audience.', behind: 'Each photo uploads to Drive and is sent with the Telegram post; the first also shows on the mirrored community post.' },
        { target: 'ann-send', tab: 'chat', title: 'Post it', body: 'Tap <strong>Post announcement</strong>. You\'ll get a confirmation of where it went.', behind: 'A public post goes to Telegram + the community feed. If the same subject was just sent, Telegram is skipped to avoid spam — super-admins get a one-tap "force send."' }
      ]
    },

    'dms': {
      badge: '💬', eyebrow: 'Team Portal · Chat tab · DMs', title: 'Send a direct message',
      tabs: [['chat', '💬 Chat']],
      controls: [
        { ctl: 'dm-open', cls: 'pill', text: '✉️ DMs' },
        { ctl: 'dm-new', label: 'Start a conversation', text: '✎ New message' },
        { ctl: 'dm-pick', label: 'Pick a member', text: 'David A.' },
        { row: [{ ctl: 'dm-input', label: 'Message', text: 'Praying for the outreach today 🙏' }, { ctl: 'dm-send', cls: 'btn', text: '➤' }] },
        { ctl: 'dm-menu', label: 'Conversation options ⋯', text: '🚫 Block · 🚩 Report' }
      ],
      steps: [
        { target: 'dm-open', tab: 'chat', title: 'Open the DM inbox', body: 'On the <strong>💬 Chat</strong> tab, the <strong>DMs</strong> inbox is the default view — your conversations on the left.' },
        { target: 'dm-new', tab: 'chat', title: 'Start a new message', body: 'Tap the <strong>✎</strong> new-message button at the top of the list.', behind: 'This opens a member picker that loads the team roster to search who to message.' },
        { target: 'dm-pick', tab: 'chat', title: 'Pick a team member', body: 'Search and tap the person. That opens the conversation thread.', behind: 'If someone is <b>Restricted</b> (Content Studio → Moderation), only their allowed contacts and super-admins can reach them.' },
        { target: 'dm-input', tab: 'chat', title: 'Type your message', body: 'Write in the <strong>Message…</strong> box at the bottom of the thread.' },
        { target: 'dm-send', tab: 'chat', title: 'Send it', body: 'Tap <strong>➤</strong> (or Enter). It appears instantly in the thread.', behind: 'Saved privately between you and the recipient — DMs never appear on the public community page.' },
        { target: 'dm-menu', tab: 'chat', title: 'Block or report (if needed)', body: 'The <strong>⋯</strong> menu lets you <strong>🚫 Block</strong> someone or <strong>🚩 Report</strong> a message.', behind: 'Reports land in Content Studio → Moderation, and super-admins (plus admins with Moderation) are emailed.' }
      ]
    },

    'incoming-activity': {
      badge: '🔔', eyebrow: 'Team Portal · Community tab', title: 'Respond to incoming activity',
      tabs: [['community', '📝 Community']],
      controls: [
        { ctl: 'act-open', cls: 'pill', text: '🔔 Incoming activity' },
        { ctl: 'act-filter', label: 'Filter', text: 'All · New · 🙏 Prayer · 🛒 Orders · ✉️ Contact' },
        { ctl: 'act-item', label: 'A friend · Prayer · ● New', text: '"Please pray for my job interview…"' },
        { ctl: 'act-reply', cls: 'btn-green', text: '🙏 Reply on community' },
        { ctl: 'act-seen', text: 'Mark seen' }
      ],
      steps: [
        { target: 'act-open', tab: 'community', title: 'Open Incoming Activity', body: 'Go to the <strong>📝 Community</strong> tab. The <strong>🔔 Incoming activity</strong> panel sits at the top.', behind: 'Visible to admins with the <b>Announcements</b> or <b>Moderation</b> permission. A badge on the tab shows how many new items wait.' },
        { target: 'act-filter', tab: 'community', title: 'Filter to what you need', body: 'Use the filters — All, New, 🙏 Prayer, 🎉 Thanks, 🛒 Orders, 📖 Bible, ✉️ Contact.', behind: 'Aggregates the last 30 days from prayers, orders, Bible requests, and the contact form into one list.' },
        { target: 'act-item', tab: 'community', title: 'Read an item', body: 'Each card shows who it\'s from, the type, a status (● New / Seen / ✓ Responded), and the message.' },
        { target: 'act-reply', tab: 'community', title: 'Reply where it belongs', body: 'For a public prayer/thanksgiving, tap <strong>🙏 Reply on community</strong>. Orders show <strong>Open in Orders</strong>; contact shows <strong>✉️ Reply by email</strong>.', behind: 'Replying posts a public comment on the mirrored community post and marks it <b>Responded</b>. Private prayers show "Private — not shared publicly."' },
        { target: 'act-seen', tab: 'community', title: 'Mark it handled', body: 'Tap <strong>Mark seen</strong> on anything reviewed so the team knows it\'s covered.', behind: 'Status is shared team-wide so two people don\'t respond to the same thing. The badge updates as items are handled.' }
      ]
    },

    'publish-story': {
      badge: '✨', eyebrow: 'Content Studio · Content', title: 'Publish an outreach story',
      tabs: [['studio', '✨ Content Studio']],
      controls: [
        { ctl: 'st-nav', cls: 'pill', text: '📸 Outreach Stories' },
        { ctl: 'st-title', label: 'Title', text: 'Bellevue Park Outreach' },
        { row: [{ ctl: 'st-loc', label: 'Location', text: 'Bellevue, WA' }, { ctl: 'st-img', label: 'Image URL', text: 'https://…' }] },
        { ctl: 'st-body', label: 'Story', text: 'A few sentences on the day…' },
        { ctl: 'st-pub', label: 'Publish', text: '☑ Published (visible on News)' },
        { ctl: 'st-save', cls: 'btn-green', text: '💾 Save story' }
      ],
      steps: [
        { target: 'st-nav', tab: 'studio', title: 'Go to Content → Outreach Stories', body: 'In Content Studio\'s sidebar pick <strong>Content Studio</strong>, then the <strong>📸 Outreach Stories</strong> card.', behind: 'Content Studio is super-admin-only. It trusts your Team Portal login — non-super-admins see a locked screen.' },
        { target: 'st-title', tab: 'studio', title: 'Give it a title', body: 'Enter a <strong>Title</strong> like "Bellevue Park Outreach." This is the only required field.' },
        { target: 'st-loc', tab: 'studio', title: 'Add location & image', body: 'Fill in the <strong>Location</strong> and paste a public <strong>Image URL</strong>.', behind: 'The image link needs to be publicly viewable (e.g. a Drive "anyone with the link" image).' },
        { target: 'st-body', tab: 'studio', title: 'Write the story', body: 'Add a few sentences in the <strong>Story</strong> box — what happened, who you served.' },
        { target: 'st-pub', tab: 'studio', title: 'Tick "Published"', body: 'Check <strong>Published</strong> to make it live now, or leave unchecked to save a draft.' },
        { target: 'st-save', tab: 'studio', title: 'Save it', body: 'Tap <strong>💾 Save story</strong>. A published story appears at the top of the News photo essay within a couple of minutes.', behind: 'Saved to the content sheet and read live by the News page. If the backend is offline, the site falls back to built-in content.' }
      ]
    },

    'publish-testimony': {
      badge: '🗣️', eyebrow: 'Content Studio · Content', title: 'Publish a testimony',
      tabs: [['studio', '✨ Content Studio']],
      controls: [
        { ctl: 't-nav', cls: 'pill', text: '🗣️ Testimonies' },
        { ctl: 't-name', label: 'Name', text: 'Maria G.' },
        { ctl: 't-anon', label: 'Privacy', text: '☐ Show as anonymous' },
        { ctl: 't-excerpt', label: 'Short excerpt', text: '"I hadn\'t opened a Bible in years…"' },
        { ctl: 't-body', label: 'Full testimony', text: 'The full story in their words…' },
        { ctl: 't-verse', label: 'Anchor verse', text: 'John 3:16' },
        { ctl: 't-pub', label: 'Publish', text: '☑ Published (visible on site)' },
        { ctl: 't-save', cls: 'btn-green', text: '💾 Save testimony' }
      ],
      steps: [
        { target: 't-nav', tab: 'studio', title: 'Switch to Testimonies', body: 'In Content Studio → Content, tap the <strong>🗣️ Testimonies</strong> card.' },
        { target: 't-name', tab: 'studio', title: 'Enter the name', body: 'Type the person\'s <strong>Name</strong> (first or full).' },
        { target: 't-anon', tab: 'studio', title: 'Anonymous?', body: 'If they\'d rather not be named, tick <strong>Show as anonymous</strong>.', behind: 'You must enter a name <b>or</b> mark it anonymous before it will save.' },
        { target: 't-excerpt', tab: 'studio', title: 'Add a short excerpt', body: 'Write a one-line <strong>excerpt</strong> — the pull quote shown in the list.' },
        { target: 't-body', tab: 'studio', title: 'Write the full testimony', body: 'Put the full story in their words in the <strong>Full testimony</strong> box.' },
        { target: 't-verse', tab: 'studio', title: 'Add an anchor verse (optional)', body: 'Add a verse like <strong>John 3:16</strong>, and a media URL if you have one.' },
        { target: 't-pub', tab: 'studio', title: 'Tick "Published"', body: 'Check <strong>Published</strong> to show it now, or leave as a draft.' },
        { target: 't-save', tab: 'studio', title: 'Save it', body: 'Tap <strong>💾 Save testimony</strong>. It shows on News + the Testimonies page within a couple of minutes.' }
      ]
    },

    'outreach-map': {
      badge: '🗺️', eyebrow: 'Content Studio · Outreach Map', title: 'Add a country, state, or city',
      tabs: [['studio', '✨ Content Studio']],
      controls: [
        { ctl: 'map-nav', cls: 'pill', text: '🗺️ Outreach Map' },
        { ctl: 'map-type', label: 'Type', text: '🌍 Country ▼' },
        { ctl: 'map-name', label: 'Name', text: 'Pakistan' },
        { ctl: 'map-iso', label: 'Country code', text: 'PK' },
        { ctl: 'map-pub', label: 'Publish', text: '☑ Published' },
        { ctl: 'map-save', cls: 'btn-green', text: '💾 Save location' }
      ],
      steps: [
        { target: 'map-nav', tab: 'studio', title: 'Open the Outreach Map', body: 'In Content Studio\'s sidebar, pick <strong>🗺️ Outreach Map</strong>.' },
        { target: 'map-type', tab: 'studio', title: 'Pick the type', body: 'Choose <strong>Country</strong>, <strong>State / region</strong>, or <strong>City</strong>.' },
        { target: 'map-name', tab: 'studio', title: 'Enter the name', body: 'Type the place name, e.g. <strong>Pakistan</strong>. For a city, put its state in "Region / parent."' },
        { target: 'map-iso', tab: 'studio', title: 'Add the country code (countries only)', body: 'For a country, add the 2-letter code (<strong>US</strong>, <strong>SR</strong>, <strong>PK</strong>…) so it pins on the globe.', behind: 'The code field auto-disables for states and cities — only countries tint the world map.' },
        { target: 'map-pub', tab: 'studio', title: 'Keep "Published" on', body: 'Leave <strong>Published</strong> checked to show it live.', behind: 'The "countries reached" number counts only <b>published countries</b>; states/cities show in lists but don\'t bump that count.' },
        { target: 'map-save', tab: 'studio', title: 'Save the location', body: 'Tap <strong>💾 Save location</strong>. The globe and count update within a couple of minutes.' }
      ]
    },

    'members': {
      badge: '👥', eyebrow: 'Content Studio · Members', title: 'Set a role & permissions',
      tabs: [['studio', '✨ Content Studio']],
      controls: [
        { ctl: 'mem-nav', cls: 'pill', text: '👥 Members' },
        { ctl: 'mem-role', label: 'David A. · Role', text: 'Admin ▼' },
        { ctl: 'mem-perms', label: 'Permissions ▾', text: '☑ Finance ☑ Store orders ☐ Moderation' },
        { ctl: 'mem-save', cls: 'btn-green', text: 'Save permissions' }
      ],
      steps: [
        { target: 'mem-nav', tab: 'studio', title: 'Open Members', body: 'In Content Studio\'s sidebar, pick <strong>👥 Members</strong> to see the roster.', behind: 'Managing members is super-admin territory (the "Manage members" permission).' },
        { target: 'mem-role', tab: 'studio', title: 'Set the role', body: 'On a member\'s card, use the role dropdown: <strong>Member</strong>, <strong>Admin</strong>, or <strong>Super Admin</strong>.', behind: 'Super-admins automatically get every permission — the grid locks all-on. It saves the moment you change the dropdown.' },
        { target: 'mem-perms', tab: 'studio', title: 'Fine-tune permissions', body: 'Tap <strong>Permissions ▾</strong> and tick exactly what they can open: Scanner, Finance, Store orders, Announcements, Training admin, Content Studio, Manage members, Moderation.', behind: 'These control which tabs appear in that person\'s Team Portal — e.g. Finance only shows with the Finance permission.' },
        { target: 'mem-save', tab: 'studio', title: 'Save permissions', body: 'Tap <strong>Save permissions</strong>. It takes effect next time they open their portal.' }
      ]
    },

    'comp-code': {
      badge: '🎟️', eyebrow: 'Content Studio · Codes', title: 'Generate a comp code',
      tabs: [['studio', '✨ Content Studio']],
      controls: [
        { ctl: 'code-nav', cls: 'pill', text: '🎟️ Codes' },
        { row: [{ ctl: 'code-str', label: 'Code (optional)', text: 'THANKYOUSTW' }, { ctl: 'code-max', label: 'Max uses', text: '5' }] },
        { ctl: 'code-note', label: 'Note', text: 'Volunteer appreciation' },
        { ctl: 'code-gen', cls: 'btn-green', text: 'Generate code' }
      ],
      steps: [
        { target: 'code-nav', tab: 'studio', title: 'Open Codes', body: 'In Content Studio\'s sidebar, pick <strong>🎟️ Codes</strong>.' },
        { target: 'code-str', tab: 'studio', title: 'Choose a code (or leave blank)', body: 'Type a memorable <strong>code</strong> like "THANKYOUSTW," or leave blank to auto-generate one.' },
        { target: 'code-max', tab: 'studio', title: 'Set max uses', body: 'Set <strong>Max uses</strong> — how many no-charge orders it allows. Each order spends one use.', behind: 'When the last use is spent, the code auto-deactivates so it can\'t be over-redeemed.' },
        { target: 'code-note', tab: 'studio', title: 'Add a note', body: 'Jot a <strong>note</strong> so you remember who/what it\'s for.' },
        { target: 'code-gen', tab: 'studio', title: 'Generate it', body: 'Tap <strong>Generate code</strong>. It appears in the list below with its usage count. Deactivate any code from the list to kill remaining uses instantly.' }
      ]
    },

    'editor-commit': {
      badge: '✏️', eyebrow: 'Admin Help · Editor', title: 'Edit & commit site content',
      controls: [
        { ctl: 'ed-open', text: '✏️ Open the Editor' },
        { ctl: 'ed-pat', label: 'First time only', text: '🔐 Connect & validate GitHub token' },
        { ctl: 'ed-pick', label: 'Pick what to edit', text: 'Recommendations · Daily verses · Images · Telegram config…' },
        { ctl: 'ed-edit', label: 'Edit form + live preview', text: 'Fill fields, watch the preview' },
        { ctl: 'ed-review', cls: 'btn', text: 'Review changes →' },
        { ctl: 'ed-diff', label: 'Diff', text: '+3 added, −1 removed' },
        { ctl: 'ed-commit', cls: 'btn-green', text: 'Yes, commit' }
      ],
      steps: [
        { target: 'ed-open', title: 'Open the Editor', body: 'On the Admin Help page, tap <strong>✏️ Open the Editor</strong> at the bottom of the sidebar.', behind: 'The Editor is a no-code form UI over the site\'s data files — it reads and writes them for you so you never touch raw JSON.' },
        { target: 'ed-pat', title: 'Connect GitHub (first time only)', body: 'The first time, paste a GitHub <strong>access token</strong> and tap <strong>Connect & validate</strong>. A 5-step guide helps you create one.', behind: 'The token lets the Editor save changes to the site\'s repository on your behalf. It\'s stored only in your browser and re-checked each visit.' },
        { target: 'ed-pick', title: 'Pick what to edit', body: 'Choose from the grouped list: <strong>Recommendations</strong>, <strong>Daily verses</strong>, image folders, <strong>Telegram bot config</strong>, store <strong>bundles</strong>, the homepage carousel, and more.' },
        { target: 'ed-edit', title: 'Fill the form — watch the preview', body: 'Edit fields on the left; a <strong>live preview</strong> on the right shows exactly how it\'ll look on the site.', behind: 'Changes autosave as a draft in your browser, so you won\'t lose work if interrupted.' },
        { target: 'ed-review', title: 'Review changes', body: 'Tap <strong>Review changes →</strong>. The Editor checks your entries and highlights anything off before you continue.' },
        { target: 'ed-diff', title: 'Check the diff', body: 'You\'ll see the exact lines added and removed — no surprises. Tap <strong>Commit →</strong> when it looks right.' },
        { target: 'ed-commit', title: 'Confirm & commit', body: 'A commit message is pre-filled (editable). Tap <strong>Yes, commit</strong>.', behind: 'The Editor saves to the repository; GitHub Pages rebuilds the live site in ~30–60 seconds. Then hard-refresh.' }
      ]
    },

    'calendar-event': {
      badge: '📅', eyebrow: 'Google Calendar', title: 'Add an event the site will show',
      controls: [
        { ctl: 'cal-signin', label: 'calendar.google.com', text: 'Sign in · seedthewordministry@gmail.com' },
        { ctl: 'cal-click', label: 'On the date', text: 'Click the day / time slot' },
        { ctl: 'cal-details', label: 'Details', text: 'Title · start/end time · description' },
        { ctl: 'cal-save', cls: 'btn-green', text: 'Save' }
      ],
      steps: [
        { target: 'cal-signin', title: 'Sign in to Google Calendar', body: 'Open <strong>calendar.google.com</strong> and sign in with the ministry account (<strong>seedthewordministry@gmail.com</strong>).', behind: 'The site reads events live from this one calendar — no other setup needed.' },
        { target: 'cal-click', title: 'Click the date', body: 'Click anywhere on the calendar on the day (and time) the event happens.' },
        { target: 'cal-details', title: 'Fill in the details', body: 'Enter a <strong>title</strong>, pick a <strong>start/end time</strong>, add a <strong>description</strong>.' },
        { target: 'cal-save', title: 'Save', body: 'Tap <strong>Save</strong>. The event shows on the News page (and homepage feed) <strong>within about a minute</strong>.', behind: 'The announcements Telegram bot also picks up calendar events and posts upcoming/live ones on its schedule.' }
      ]
    },

    'deploy': {
      badge: '🚀', eyebrow: 'Google Apps Script', title: 'Redeploy the backend',
      controls: [
        { ctl: 'dep-paste', label: '1 · Paste', text: 'Copy each .gs file → matching file → Save' },
        { ctl: 'dep-deploy', label: '2 · Deploy', text: 'Deploy → Manage deployments → ✏️ edit' },
        { ctl: 'dep-version', label: 'Version', text: 'New version → Deploy' },
        { ctl: 'dep-setup', label: '3 · Setup (if noted)', text: 'Run the one-time setup function' }
      ],
      steps: [
        { target: 'dep-paste', title: 'Paste the updated files', body: 'Open the <strong>STW Order Handler</strong> Apps Script project. Copy each updated <code>.gs</code> file from <code>docs/apps-script/</code> into its matching file and <strong>Save</strong>.', behind: 'The full list of files + setup functions per feature is in <code>docs/apps-script/DEPLOY-CHECKLIST.md</code>.' },
        { target: 'dep-deploy', title: 'Open Manage deployments', body: 'Click <strong>Deploy → Manage deployments</strong>, then the <strong>✏️ edit</strong> (pencil) on the existing web app.', behind: 'Editing the existing deployment keeps the same URL — so the site\'s config needs no change.' },
        { target: 'dep-version', title: 'Deploy a New version', body: 'Set <strong>Version → New version</strong> and click <strong>Deploy</strong>. <em>Not</em> "New deployment" — that makes a different URL.', behind: 'The step people forget: if a feature "does nothing" or shows old data, the backend probably wasn\'t redeployed to a new version.' },
        { target: 'dep-setup', title: 'Run setup (new features only)', body: 'For a brand-new feature, run its one-time setup function once from the Run menu (e.g. <code>stwLocationsSetup()</code>).', behind: 'Setup functions just create the spreadsheet tabs a feature needs. Safe to re-run. Then hard-refresh (Ctrl+Shift+R).' }
      ]
    }
  };

  // ── CSS (injected once) ─────────────────────────────────────
  var CSS = [
    '.wt-help{display:inline-flex;align-items:center;justify-content:center;width:1.3rem;height:1.3rem;flex-shrink:0;border-radius:var(--radius-full,9999px);border:1.5px solid var(--color-gold,#D97736);background:var(--color-gold-soft,rgba(217,119,54,0.1));color:var(--color-gold,#D97736);font-family:var(--font-sans,sans-serif);font-size:0.8rem;font-weight:800;line-height:1;cursor:pointer;padding:0;vertical-align:middle;transition:background .15s,transform .15s,color .15s;}',
    '.wt-help:hover,.wt-help:focus-visible{background:var(--color-gold,#D97736);color:#fff;transform:scale(1.1);outline:none;}',
    '.wt-overlay{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,0.5);backdrop-filter:blur(3px);}',
    '.wt-overlay.is-open{display:flex;animation:wt-fade .18s ease;}',
    '@keyframes wt-fade{from{opacity:0}to{opacity:1}}',
    '.wt-modal{background:var(--color-surface,#fff);color:var(--color-text,#1A1E24);width:100%;max-width:860px;max-height:92vh;overflow:auto;border-radius:var(--radius-lg,18px);box-shadow:var(--shadow-lg,0 8px 40px rgba(0,0,0,.2));border:1px solid var(--color-border,#E8E4DF);animation:wt-pop .2s ease;}',
    '@keyframes wt-pop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}',
    '.wt-head{display:flex;align-items:center;gap:.75rem;padding:1rem 1.25rem;background:linear-gradient(135deg,var(--color-olive-soft,rgba(44,74,62,.08)),var(--color-gold-soft,rgba(217,119,54,.1)));border-bottom:1px solid var(--color-border,#E8E4DF);border-radius:var(--radius-lg,18px) var(--radius-lg,18px) 0 0;position:sticky;top:0;}',
    '.wt-badge{flex-shrink:0;width:2.2rem;height:2.2rem;border-radius:var(--radius-full,9999px);background:linear-gradient(135deg,var(--color-gold,#D97736),var(--color-gold-hover,#c06628));color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.15rem;}',
    '.wt-titles{flex:1;min-width:0;}',
    '.wt-eyebrow{font-family:var(--font-mono,monospace);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--color-text-muted,#6b7280);margin:0;}',
    '.wt-title{font-family:var(--font-sans,sans-serif);font-size:1.05rem;font-weight:800;color:var(--color-text,#1A1E24);margin:.1rem 0 0;}',
    '.wt-close{flex-shrink:0;width:2rem;height:2rem;border-radius:var(--radius-full,9999px);border:0;background:var(--color-bg-subtle,#f4f4f4);color:var(--color-text,#333);font-size:1.2rem;cursor:pointer;line-height:1;transition:background .15s;}',
    '.wt-close:hover{background:var(--color-border,#e0e0e0);}',
    '.wt-body{display:grid;grid-template-columns:1.1fr 1fr;gap:0;}',
    '@media(max-width:720px){.wt-body{grid-template-columns:1fr;}}',
    '.wt-stage{position:relative;padding:1.3rem;background:var(--color-bg-subtle,#f8f6f3);border-right:1px solid var(--color-border,#E8E4DF);min-height:280px;}',
    '@media(max-width:720px){.wt-stage{border-right:0;border-bottom:1px solid var(--color-border,#E8E4DF);}}',
    '.wt-frame{background:var(--color-surface,#fff);border:1px solid var(--color-border,#E8E4DF);border-radius:var(--radius-md,14px);padding:.9rem;box-shadow:var(--shadow-sm,0 1px 3px rgba(0,0,0,.06));}',
    '.wt-tabs{display:flex;gap:.3rem;margin-bottom:.85rem;flex-wrap:wrap;}',
    '.wt-tab{font-size:.72rem;font-weight:700;padding:.3rem .55rem;border-radius:var(--radius-sm,10px);border:1px solid var(--color-border,#E8E4DF);background:var(--color-surface,#fff);color:var(--color-text-muted,#6b7280);white-space:nowrap;}',
    '.wt-tab.is-active{background:var(--color-gold,#D97736);border-color:var(--color-gold,#D97736);color:#fff;}',
    '.wt-ctl{position:relative;border:1.5px solid var(--color-border,#E8E4DF);border-radius:var(--radius-sm,10px);padding:.55rem .7rem;margin:.4rem 0;font-size:.82rem;color:var(--color-text-secondary,#4a5260);background:var(--color-surface,#fff);transition:border-color .25s,box-shadow .25s,transform .25s,opacity .25s;}',
    '.wt-ctl__label{display:block;font-size:.64rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--color-text-muted,#6b7280);margin-bottom:.2rem;}',
    '.wt-ctl--btn{background:var(--color-gold,#D97736);border-color:var(--color-gold,#D97736);color:#fff;font-weight:700;text-align:center;}',
    '.wt-ctl--btn-green{background:var(--color-olive,#2C4A3E);border-color:var(--color-olive,#2C4A3E);color:#fff;font-weight:700;text-align:center;}',
    '.wt-ctl--pill{display:inline-block;width:auto;border-radius:var(--radius-full,9999px);}',
    '.wt-row{display:flex;gap:.4rem;flex-wrap:wrap;}',
    '.wt-row .wt-ctl{flex:1;min-width:0;}',
    '.wt-ctl.is-spot{border-color:var(--color-gold,#D97736);box-shadow:0 0 0 3px var(--color-gold-soft,rgba(217,119,54,.18)),var(--shadow-md,0 4px 16px rgba(0,0,0,.08));transform:translateY(-1px);z-index:2;animation:wt-pulse 1.6s var(--ease,ease) infinite;}',
    '@keyframes wt-pulse{0%,100%{box-shadow:0 0 0 3px var(--color-gold-soft,rgba(217,119,54,.18)),var(--shadow-md,0 4px 16px rgba(0,0,0,.08));}50%{box-shadow:0 0 0 6px var(--color-gold-soft,rgba(217,119,54,.12)),var(--shadow-md,0 4px 16px rgba(0,0,0,.08));}}',
    '.wt-ctl.is-dim{opacity:.4;filter:saturate(.7);}',
    '.wt-cursor{position:absolute;width:20px;height:20px;pointer-events:none;z-index:5;font-size:1.1rem;transition:left .45s var(--ease,ease),top .45s var(--ease,ease),opacity .2s;opacity:0;}',
    '.wt-cursor.is-on{opacity:1;}',
    '.wt-explain{padding:1.3rem;display:flex;flex-direction:column;}',
    '.wt-step{font-family:var(--font-mono,monospace);font-size:.64rem;letter-spacing:.12em;text-transform:uppercase;color:var(--color-gold-hover,#c06628);font-weight:700;margin:0 0 .35rem;}',
    '.wt-htitle{font-size:1.1rem;font-weight:800;color:var(--color-text,#1A1E24);margin:0 0 .5rem;}',
    '.wt-htext{font-size:.92rem;line-height:1.6;color:var(--color-text-secondary,#4a5260);margin:0 0 .75rem;flex:1;}',
    '.wt-behind{font-size:.84rem;line-height:1.55;color:var(--color-text-secondary,#4a5260);background:var(--color-bg-subtle,#f8f6f3);border-left:3px solid var(--color-gold,#D97736);border-radius:0 var(--radius-sm,10px) var(--radius-sm,10px) 0;padding:.6rem .8rem;margin:0 0 1rem;}',
    '.wt-behind b{color:var(--color-text,#1A1E24);}',
    '.wt-progress{display:flex;gap:4px;margin:0 0 1rem;}',
    '.wt-dot{width:100%;height:4px;border-radius:var(--radius-full,9999px);background:var(--color-border,#E8E4DF);transition:background .25s;}',
    '.wt-dot.is-done{background:var(--color-gold-soft,rgba(217,119,54,.4));}',
    '.wt-dot.is-current{background:var(--color-gold,#D97736);}',
    '.wt-controls{display:flex;align-items:center;gap:.6rem;}',
    '.wt-btn{font-family:inherit;font-size:.86rem;font-weight:700;padding:.55rem 1.1rem;border-radius:var(--radius-sm,10px);border:1.5px solid var(--color-border,#E8E4DF);background:var(--color-surface,#fff);color:var(--color-text,#1A1E24);cursor:pointer;transition:border-color .15s,background .15s,color .15s,opacity .15s;}',
    '.wt-btn:hover{border-color:var(--color-gold,#D97736);color:var(--color-gold-hover,#c06628);}',
    '.wt-btn--next{background:var(--color-gold,#D97736);border-color:var(--color-gold,#D97736);color:#fff;}',
    '.wt-btn--next:hover{background:var(--color-gold-hover,#c06628);color:#fff;}',
    '.wt-btn[disabled]{opacity:.4;cursor:default;}',
    '.wt-btn--replay{margin-left:auto;}',
    '.wt-done{font-size:.9rem;color:var(--color-olive,#2C4A3E);font-weight:700;display:none;align-items:center;gap:.4rem;margin-top:.5rem;}',
    '.wt-done.is-visible{display:flex;}',
    '@media (prefers-reduced-motion: reduce){.wt-ctl.is-spot{animation:none;}.wt-cursor{transition:none;}}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('wt-styles')) return;
    var s = document.createElement('style');
    s.id = 'wt-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ── Helpers ─────────────────────────────────────────────────
  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : s); return d.innerHTML; }
  function ctlClass(cls) {
    if (cls === 'btn') return ' wt-ctl--btn';
    if (cls === 'btn-green') return ' wt-ctl--btn-green';
    if (cls === 'pill') return ' wt-ctl--pill';
    return '';
  }
  function ctlHtml(c) {
    var inner = (c.label ? '<span class="wt-ctl__label">' + esc(c.label) + '</span>' : '') + (c.text || '');
    return '<div class="wt-ctl' + ctlClass(c.cls) + '" data-ctl="' + esc(c.ctl) + '">' + inner + '</div>';
  }

  // ── Modal (built once, reused) ──────────────────────────────
  var overlay, els = {}, active = null, idx = 0;

  function buildModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'wt-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="wt-modal" role="document">' +
        '<div class="wt-head">' +
          '<span class="wt-badge" data-el="badge"></span>' +
          '<div class="wt-titles"><p class="wt-eyebrow" data-el="eyebrow"></p><p class="wt-title" data-el="title"></p></div>' +
          '<button class="wt-close" data-el="close" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="wt-body">' +
          '<div class="wt-stage" data-el="stage"><span class="wt-cursor" data-el="cursor" aria-hidden="true">👆</span><div class="wt-frame" data-el="frame"></div></div>' +
          '<div class="wt-explain">' +
            '<p class="wt-step" data-el="step"></p>' +
            '<h3 class="wt-htitle" data-el="htitle"></h3>' +
            '<div class="wt-htext" data-el="htext"></div>' +
            '<div class="wt-behind" data-el="behind"></div>' +
            '<div class="wt-progress" data-el="progress"></div>' +
            '<div class="wt-controls">' +
              '<button class="wt-btn wt-btn--back" data-el="back">← Back</button>' +
              '<button class="wt-btn wt-btn--next" data-el="next">Next →</button>' +
              '<button class="wt-btn wt-btn--replay" data-el="replay">↻ Replay</button>' +
            '</div>' +
            '<p class="wt-done" data-el="done">✓ You\'ve got it!</p>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-el]').forEach(function (n) { els[n.getAttribute('data-el')] = n; });

    els.close.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('is-open')) close(); });
    els.next.addEventListener('click', function () { if (idx < active.steps.length - 1) { idx++; render(); } });
    els.back.addEventListener('click', function () { if (idx > 0) { idx--; render(); } });
    els.replay.addEventListener('click', function () { idx = 0; render(); });
  }

  function renderFrame() {
    var html = '';
    if (active.tabs && active.tabs.length) {
      html += '<div class="wt-tabs">' + active.tabs.map(function (t) {
        return '<span class="wt-tab" data-tab="' + esc(t[0]) + '">' + esc(t[1]) + '</span>';
      }).join('') + '</div>';
    }
    active.controls.forEach(function (c) {
      if (c.row) html += '<div class="wt-row">' + c.row.map(ctlHtml).join('') + '</div>';
      else html += ctlHtml(c);
    });
    els.frame.innerHTML = html;
  }

  function moveCursor(spot) {
    if (!spot) { els.cursor.classList.remove('is-on'); return; }
    var sRect = els.stage.getBoundingClientRect();
    var cRect = spot.getBoundingClientRect();
    els.cursor.style.left = (cRect.left - sRect.left) + Math.min(cRect.width - 14, cRect.width * 0.5) + 'px';
    els.cursor.style.top = (cRect.top - sRect.top) + cRect.height * 0.5 + 'px';
    els.cursor.classList.add('is-on');
  }

  function render() {
    var step = active.steps[idx];
    var total = active.steps.length;
    els.step.textContent = 'Step ' + (idx + 1) + ' of ' + total;
    els.htitle.innerHTML = step.title || '';
    els.htext.innerHTML = step.body || '';
    if (step.behind) { els.behind.innerHTML = '<b>Behind the scenes:</b> ' + step.behind; els.behind.style.display = ''; }
    else els.behind.style.display = 'none';

    if (step.tab) els.frame.querySelectorAll('.wt-tab').forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-tab') === step.tab); });

    var spot = null;
    els.frame.querySelectorAll('.wt-ctl').forEach(function (ctl) {
      var isT = ctl.getAttribute('data-ctl') === step.target;
      ctl.classList.toggle('is-spot', isT);
      ctl.classList.toggle('is-dim', !isT);
      if (isT) spot = ctl;
    });
    global.requestAnimationFrame(function () { moveCursor(spot); });

    els.progress.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var d = document.createElement('span');
      d.className = 'wt-dot' + (i < idx ? ' is-done' : (i === idx ? ' is-current' : ''));
      els.progress.appendChild(d);
    }
    els.back.disabled = idx === 0;
    var last = idx === total - 1;
    els.next.textContent = last ? 'Finish ✓' : 'Next →';
    els.done.classList.toggle('is-visible', last);
  }

  function open(id) {
    if (!WT[id]) { console.warn('[walkthroughs] unknown id: ' + id); return; }
    injectCss();
    buildModal();
    active = WT[id];
    idx = 0;
    els.badge.textContent = active.badge || '🎬';
    els.eyebrow.textContent = active.eyebrow || '';
    els.title.textContent = active.title || '';
    renderFrame();
    render();
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    els.next.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  // ── Auto-wire [data-walkthrough] triggers ───────────────────
  // Any element with data-walkthrough="ID" becomes a click trigger.
  // A bare <button class="wt-help" data-walkthrough="ID"> gets a "?" filled in.
  function wire(root) {
    (root || document).querySelectorAll('[data-walkthrough]').forEach(function (btn) {
      if (btn.__wtWired) return;
      btn.__wtWired = true;
      if (btn.classList.contains('wt-help') && !btn.textContent.trim()) btn.textContent = '?';
      if (!btn.getAttribute('aria-label')) {
        var wt = WT[btn.getAttribute('data-walkthrough')];
        btn.setAttribute('aria-label', 'How to: ' + (wt ? wt.title : 'help'));
      }
      if (btn.tagName === 'BUTTON' && !btn.getAttribute('type')) btn.setAttribute('type', 'button');
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        open(btn.getAttribute('data-walkthrough'));
      });
    });
  }

  function init() { injectCss(); wire(document); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.Walkthroughs = { __ready: true, open: open, close: close, wire: wire, list: Object.keys(WT) };
})(typeof window !== 'undefined' ? window : this);
