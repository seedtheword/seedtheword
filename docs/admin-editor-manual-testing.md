# Admin Editor — Manual Testing Checklist

Run this checklist after every Phase deploy (Phase A/B/C) and before flipping
any cutover flag. First pass uses **dry-run mode** so no real commits hit
GitHub. Second pass uses a real PAT.

Browsers to cover: Chrome (desktop), Safari (iOS), Firefox (desktop or Android).
Viewport sizes: 1280 × 900 desktop, 360 × 780 mobile.

## Phase A checklist

### Pre-flight
- [ ] Hard-refresh `admin-help.html` (Ctrl+Shift+R / Cmd+Shift+R) so the newest
      `?v=N` cache buster is loaded.
- [ ] Enter the team password. Unlock succeeds. Help content visible.
- [ ] Tabs row includes `✏️ Editor` at the right edge.

### Dry-run walk (no GitHub writes)
- [ ] Click the `✏️ Editor` tab. Help content hides, editor shell appears.
- [ ] If no PAT is present, the 5-step onboarding walkthrough renders.
      Five step cards visible in order.
- [ ] If a PAT is already stored, the content picker renders instead.
- [ ] Click the dry-run toggle at the top-right of the content picker.
      Page reloads, the yellow `🧪 DRY RUN` banner appears across the top.
- [ ] Click "Recommendations (listening + partners)". A brief "Loading…"
      state shows, then the form + live preview render.
- [ ] The listening and partners lists populate from whatever
      `assets/data/recommendations.json` currently contains on GitHub.
- [ ] Click `+ Add listening item` → new empty row at bottom. Pick the
      Spotify variant. Paste an `open.spotify.com/episode/...` URL, fill
      title + source. Live preview updates within ~300 ms and shows the
      Spotify embed.
- [ ] Click "Review changes →". Diff view shows a clean `+` block with
      your new entry. `+N added, -M removed` line is correct.
- [ ] Click "Commit →" → confirmation dialog with target path + commit
      message + change summary. Click "Yes, commit".
- [ ] Success panel renders with a `View commit on GitHub: dryrun-…`
      link. Console shows `[dry-run] writeFile { path: ..., bytes: ..., opts: {...} }`.

### Legacy builder handoff (shadow period)
- [ ] Switch back to the `🧰 How-tos` tab. Scroll to the Recommendations
      builder. Fill a Spotify entry. You should now see TWO buttons:
      `🚀 Commit to GitHub` (primary, dark) and `📋 Copy JSON` (secondary).
- [ ] Click `🚀 Commit to GitHub`. The Editor tab activates, the content
      picker loads, then the editor opens on Recommendations with your
      entry already appended to the listening list.
- [ ] Walk through diff → confirm → success in dry-run mode. Console log
      shows the writeFile for the appended row.
- [ ] Click "📋 Copy JSON" on the legacy builder — it still works; no
      regression for admins who prefer copy-paste during the shadow.

### Errors + recovery
- [ ] Intentionally type an invalid Spotify URL (e.g. `not-a-url`).
      Commit is blocked. Inline field error appears in red. Fix the URL —
      error clears.
- [ ] Disable dry-run, enter an obviously wrong PAT (e.g. `github_pat_FAKE`).
      Error message "GitHub rejected this token" appears. PAT is not
      persisted (reload and the walkthrough comes back).
- [ ] With a valid PAT, open the recommendations editor, make an edit, then
      in a separate browser tab, push a direct commit that modifies
      `assets/data/recommendations.json`. Come back to the editor and commit.
      The Conflict state should appear with "Reload and redo" option.

### Mobile (<768 px)
- [ ] Form, live preview, and diff panels stack vertically.
- [ ] Every button is at least 44 × 44 px (thumb-tappable).
- [ ] No horizontal scrolling of primary controls.
- [ ] Dry-run banner wraps cleanly, doesn't overflow.
- [ ] File picker (Phase B) works on iOS Safari.

### Cleanup before real PAT pass
- [ ] Toggle dry-run off. Banner disappears.
- [ ] Clear any test drafts: DevTools → Application → Session Storage →
      delete all `stwm-admin-draft:*` entries.

### Real PAT pass
Only do this after every dry-run check above passes.
- [ ] Commit ONE real listening entry via the editor. Verify it lands in
      `recommendations.json` on GitHub within 60 s. Commit message ends
      with `[via web admin]`. The commit is authored by YOUR GitHub account.
- [ ] The site's "What We're Listening To" section updates within another
      60 s (GitHub Pages rebuild).
- [ ] No unexpected files changed in the commit diff.

## Phase B checklist (added when Phase B ships)

_To be filled in when Phase B tasks are complete._

## Phase C checklist (added when Phase C ships)

_To be filled in when Phase C tasks are complete._
