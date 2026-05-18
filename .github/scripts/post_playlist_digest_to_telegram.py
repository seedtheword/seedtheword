"""
Post a weekly "what's new in the community playlist" digest to Telegram.

Schedule: Saturday 08:00 Pacific (wired up in
.github/workflows/weekly-playlist-digest.yml). Reads the public
Spotify playlist configured under `bible.playlist` in
telegram-bot.json, diffs against a dedup log of previously-posted
track IDs, and posts a Markdown list of newly-added tracks.

Auth model: NONE — this script uses Spotify's public unauthenticated
endpoints (the rendered playlist page + the per-track embed page).
The Web API path was removed because dev apps owned by free Spotify
accounts cannot read playlist data via /v1/playlists/{id}/tracks
("Active premium subscription required for the owner of the app").
The scrape path works for any public playlist, no Spotify Premium
required, no client credentials, no refresh token.

Tradeoffs vs the Web API:
  - We do NOT get an `added_at` timestamp per track, so the digest
    treats EVERY track that's not in the dedup log as "new this run."
    On first run we backfill all current tracks as already-seen, so
    only genuinely-new entries get posted from then on.
  - We do NOT get a per-track "added Wed/Fri/Sat" day-of-week label
    in the message — those tags are dropped from the rendered post.
  - We do NOT get the `added_by` user id, so authorship attribution
    is unavailable.

Credentials (GitHub Secrets):
  TELEGRAM_BIBLE_BOT_TOKEN   — posts via the Bible bot

Env vars:
  BOT_CONFIG                 — path to telegram-bot.json
  PLAYLIST_LOG_PATH          — path to the seen-track-ids log
  DRY_RUN                    — if set, log the post instead of sending

Message shape:
  🎵 *New in the Community Playlist*

  · *Track A* — Artist A
  · *Track B* — Artist B
  · *Track C* — Artist C

  ▶️ Listen / add songs → https://open.spotify.com/playlist/...

If no genuinely-new tracks are detected, the post is skipped — we
don't send empty "nothing new" messages.
"""
from __future__ import annotations

import html as html_lib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import (  # type: ignore
    log,
    mdv2_escape,
    send_telegram_message,
    load_json,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get(
    "BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"
))
LOG_PATH = Path(os.environ.get(
    "PLAYLIST_LOG_PATH",
    REPO_ROOT / "assets/data/telegram-playlist-log.json",
))
BOT_TOKEN = os.environ.get("TELEGRAM_BIBLE_BOT_TOKEN", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())

# Browser-like UA — Spotify's public pages are picky about generic
# defaults like "python-urllib/3.x" and will return reduced HTML.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


# ── Public scrape helpers ─────────────────────────────────────────────
def _http_get(url: str) -> str:
    """Fetch a URL with browser-like headers and gzip support.

    Spotify's open.spotify.com/playlist/{id} page fingerprints requests
    aggressively (TLS, HTTP/2 features, header set) and serves Python's
    urllib a 6KB React-shell stub instead of the full playlist HTML. The
    /embed/playlist/{id} endpoint is much friendlier — it accepts plain
    urllib with a normal Chrome UA and returns the full SSR page with
    every track in the embedded __NEXT_DATA__ blob. So that's what we
    use."""
    req = Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
    })
    with urlopen(req, timeout=30) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def _extract_next_data(page_html: str) -> dict:
    """Pull the embedded __NEXT_DATA__ JSON blob out of a Spotify embed
    page. Returns an empty dict on parse failure rather than raising —
    the caller falls back to a stub track list."""
    m = re.search(
        r'<script id="__NEXT_DATA__"[^>]*>([^<]+)</script>',
        page_html,
    )
    if not m:
        return {}
    try:
        return json.loads(html_lib.unescape(m.group(1)))
    except json.JSONDecodeError:
        return {}


def fetch_playlist_tracks(playlist_id: str) -> list[dict]:
    """Fetch the public /embed/playlist/{id} page and parse the
    __NEXT_DATA__ blob for the full track list. Returns a list of
    {id, name, artists, url} dicts in playlist order. One HTTP
    request total — track names + artist names are bundled."""
    url = "https://open.spotify.com/embed/playlist/" + playlist_id
    page_html = _http_get(url)
    data = _extract_next_data(page_html)
    entity = (
        data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("data", {})
        .get("entity", {})
    ) or {}
    items = entity.get("trackList") or []
    out: list[dict] = []
    for item in items:
        uri = item.get("uri") or ""
        if not uri.startswith("spotify:track:"):
            continue
        tid = uri.split(":")[-1]
        name = (item.get("title") or "").strip()
        # `subtitle` is an artist list separated by ", " (with a U+00A0
        # nbsp after each comma). Normalize to a clean comma-joined
        # string for the rendered post.
        subtitle = (item.get("subtitle") or "").replace("\u00a0", " ").strip()
        artists = [a.strip() for a in subtitle.split(",") if a.strip()]
        out.append({
            "id": tid,
            "name": name,
            "artists": artists,
            "url": "https://open.spotify.com/track/" + tid,
        })
    return out


# ── Main ──────────────────────────────────────────────────────────────
def main() -> int:
    full_cfg = load_json(BOT_CONFIG_PATH, None)
    if not full_cfg:
        log(f"Bot config missing at {BOT_CONFIG_PATH}; aborting.")
        return 1
    bible_cfg = full_cfg.get("bible", {})
    cfg = bible_cfg.get("playlist") or {}
    if cfg.get("enabled") is False:
        log("Playlist digest disabled; exiting.")
        return 0

    playlist_id = cfg.get("playlistId")
    if not playlist_id:
        log("No playlistId in bible.playlist config; exiting.")
        return 0

    try:
        all_tracks = fetch_playlist_tracks(playlist_id)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        log(f"Playlist fetch failed: HTTP {exc.code} — body={body!r}")
        return 1
    except Exception as exc:
        log(f"Playlist fetch failed: {exc}")
        return 1
    log(f"Fetched {len(all_tracks)} tracks from playlist embed page")

    # Load the seen-track dedup log.
    dedup = load_json(LOG_PATH, {"updated": None, "seen": {}})
    seen: dict = dedup.get("seen") or {}
    now = datetime.now(timezone.utc)

    # First-run backfill — if the dedup log is empty, treat every
    # current track as already-seen so we don't dump the entire
    # playlist into the chat. Real "new this week" detection starts
    # with the next run.
    is_first_run = not seen
    new_tracks: list[dict] = []
    if is_first_run:
        log("First run — backfilling all current tracks as seen; nothing to post.")
        for t in all_tracks:
            tid = t.get("id")
            if tid:
                seen[tid] = {
                    "backfilled": now.isoformat(timespec="seconds"),
                    "name": t.get("name"),
                }
        dedup["seen"] = seen
        dedup["updated"] = now.isoformat(timespec="seconds")
        save_log(dedup)
        return 0

    # Subsequent runs — anything not in the dedup log is new this run.
    # Without `added_at` we can't enforce a 7-day window, so we trust
    # the dedup log to keep the post relevant week-to-week.
    for t in all_tracks:
        tid = t.get("id")
        if tid and tid not in seen:
            new_tracks.append(t)

    if not new_tracks:
        log("Nothing new on the playlist; skipping post.")
        dedup["updated"] = now.isoformat(timespec="seconds")
        save_log(dedup)
        return 0

    log(f"Detected {len(new_tracks)} new track(s) since last run")

    # ── Build the MarkdownV2 message ──────────────────────────────
    chat_id = bible_cfg.get("chatId") or "@seedtheword"
    thread_id = cfg.get("worshipTopicId") or bible_cfg.get("messageThreadId")

    public_url = cfg.get("publicUrl") \
        or ("https://open.spotify.com/playlist/" + playlist_id)
    invite_url = cfg.get("collaboratorInviteUrl") or public_url

    lines: list[str] = []
    lines.append("🎵 *New in the Community Playlist*")
    lines.append("")

    for meta in new_tracks:
        name = (meta.get("name") or "Untitled").strip()
        artists = ", ".join(meta.get("artists") or []).strip() or "Unknown artist"
        track_url = meta.get("url") or ""

        if track_url:
            title_md = f"[*{mdv2_escape(name)}*]({track_url})"
        else:
            title_md = f"*{mdv2_escape(name)}*"
        lines.append(f"· {title_md} — {mdv2_escape(artists)}")

    lines.append("")
    lines.append(
        f"▶️ [{mdv2_escape('Listen / add songs on Spotify →')}]({public_url})"
    )
    if invite_url and invite_url != public_url:
        lines.append(
            f"➕ [{mdv2_escape('Join as a collaborator (one-tap invite) →')}]({invite_url})"
        )

    text = "\n".join(lines)

    try:
        resp = send_telegram_message(
            token=BOT_TOKEN,
            chat_id=chat_id,
            text=text,
            message_thread_id=thread_id,
            parse_mode="MarkdownV2",
            disable_web_page_preview=False,
            dry_run=DRY_RUN,
        )
    except Exception as exc:
        log(f"Telegram send failed: {exc}")
        return 1
    if not resp.get("ok"):
        log(f"Telegram rejected the digest: {resp}")
        return 1

    # Record every newly-posted track as seen so the next run starts
    # from a clean baseline.
    for meta in new_tracks:
        tid = meta.get("id")
        if tid:
            seen[tid] = {
                "posted": now.isoformat(timespec="seconds"),
                "name": meta.get("name"),
            }
    dedup["seen"] = seen
    dedup["updated"] = now.isoformat(timespec="seconds")
    save_log(dedup)

    log(f"Posted {len(new_tracks)} new playlist track(s).")
    return 0


def save_log(data: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    sys.exit(main())
