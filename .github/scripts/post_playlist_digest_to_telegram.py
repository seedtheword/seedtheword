"""
Post a weekly "what's new in the community playlist" digest to Telegram.

Schedule: Saturday 08:00 Pacific (wired up in
.github/workflows/weekly-playlist-digest.yml). Reads the public
Spotify playlist configured under `bible.playlist` in
telegram-bot.json, diffs against a dedup log of previously-posted
track IDs, and posts a Markdown list of genuinely-new additions
from the past week.

Auth model:
  - If SPOTIFY_REFRESH_TOKEN is set, the script trades it for a
    short-lived user-authenticated access token via the Authorization
    Code refresh grant. This is the only path that can read
    collaborative or private playlists.
  - Otherwise, falls back to the Client Credentials grant (app-only),
    which can only read fully public playlists.

Credentials (GitHub Secrets):
  TELEGRAM_BIBLE_BOT_TOKEN   — posts via the Bible bot
  SPOTIFY_CLIENT_ID          — from developer.spotify.com/dashboard
  SPOTIFY_CLIENT_SECRET      — same place
  SPOTIFY_REFRESH_TOKEN      — optional; mint via
                               .github/scripts/spotify_get_refresh_token.py

Env vars:
  BOT_CONFIG                 — path to telegram-bot.json
  PLAYLIST_LOG_PATH          — path to the seen-track-ids log
  DRY_RUN                    — if set, log the post instead of sending

Message shape:
  🎵 *New in the Community Playlist this week*

  · *Track A* — Artist A (added Wed)
  · *Track B* — Artist B (added Fri)
  · *Track C* — Artist C (added Sat)

  ▶️ Listen / add songs → https://open.spotify.com/playlist/...

If no tracks were added in the past week, the post is skipped
entirely — we don't send empty "nothing new" messages.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import (  # type: ignore
    log,
    mdv2_escape,
    send_telegram_message,
    load_json,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get("BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"))
LOG_PATH = Path(os.environ.get(
    "PLAYLIST_LOG_PATH",
    REPO_ROOT / "assets/data/telegram-playlist-log.json",
))
BOT_TOKEN = os.environ.get("TELEGRAM_BIBLE_BOT_TOKEN", "").strip()
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
SPOTIFY_REFRESH_TOKEN = os.environ.get("SPOTIFY_REFRESH_TOKEN", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())


# ── Spotify helpers ───────────────────────────────────────────────────
def _basic_auth_header() -> str:
    return base64.b64encode(
        (SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).encode("utf-8")
    ).decode("ascii")


def get_spotify_user_token_via_refresh() -> str:
    """Authorization Code refresh grant — returns a short-lived access
    token authenticated as the user who originally minted the refresh
    token. This is the path that can read collaborative or private
    playlists."""
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        raise SystemExit("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET.")
    data = urlencode({
        "grant_type": "refresh_token",
        "refresh_token": SPOTIFY_REFRESH_TOKEN,
    }).encode("utf-8")
    req = Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={
            "Authorization": "Basic " + _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    token = body.get("access_token")
    if not token:
        raise SystemExit(
            f"Spotify refresh-token response missing access_token: {body}"
        )
    return token


def get_spotify_app_token() -> str:
    """Client Credentials grant — returns a short-lived access token
    scoped to public data only. No user consent required, but cannot
    read collaborative or private playlists."""
    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        raise SystemExit("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET.")
    data = urlencode({"grant_type": "client_credentials"}).encode("utf-8")
    req = Request(
        "https://accounts.spotify.com/api/token",
        data=data,
        headers={
            "Authorization": "Basic " + _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    token = body.get("access_token")
    if not token:
        raise SystemExit(f"Spotify token response missing access_token: {body}")
    return token


def get_spotify_token() -> str:
    """Prefer the user-authenticated refresh-token path when configured —
    that's the only way to read collaborative or private playlists.
    Fall back to the app-only client-credentials path for a fully public
    playlist."""
    if SPOTIFY_REFRESH_TOKEN:
        log("Using user-authenticated Spotify token (refresh-token grant).")
        return get_spotify_user_token_via_refresh()
    log("Using app-only Spotify token (client-credentials grant).")
    return get_spotify_app_token()


def _whoami(token: str) -> dict:
    """Call /v1/me — purely diagnostic. Returns the auth'd user object
    or an error dict so we can surface 'logged in as the wrong account'
    failures clearly in the workflow log."""
    req = Request(
        "https://api.spotify.com/v1/me",
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode("utf-8", "replace")}
    except Exception as e:  # noqa: BLE001 — diagnostic-only path
        return {"error": str(e)}


def fetch_playlist_tracks(playlist_id: str, token: str) -> list[dict]:
    """Fetch every track on the playlist with its added_at timestamp.
    Handles Spotify's 100-items-per-page limit by following `next`.

    On HTTP errors, surfaces both the status and the response body in
    the raised exception so workflow logs make the failure mode obvious
    (403 from Spotify can mean: wrong account, dev-mode allowlist,
    revoked scopes, or playlist removed)."""
    items: list[dict] = []
    url = (
        "https://api.spotify.com/v1/playlists/"
        + playlist_id
        + "/tracks?limit=100"
        + "&fields=items(added_at,added_by(id),track(id,name,artists(name),external_urls(spotify))),next"
    )
    while url:
        req = Request(url, headers={"Authorization": "Bearer " + token})
        try:
            with urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            err_body = e.read().decode("utf-8", "replace")
            who = _whoami(token)
            user_id = who.get("id") if isinstance(who, dict) else "?"
            display = who.get("display_name") if isinstance(who, dict) else "?"
            raise RuntimeError(
                f"Spotify {e.code} on {url} — body={err_body!r} "
                f"auth'd_as={user_id!r} display_name={display!r}"
            ) from e
        for item in body.get("items", []) or []:
            if item and item.get("track") and item["track"].get("id"):
                items.append(item)
        url = body.get("next")
    return items


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
        token = get_spotify_token()
        items = fetch_playlist_tracks(playlist_id, token)
    except Exception as exc:
        log(f"Spotify fetch failed: {exc}")
        return 1
    log(f"Fetched {len(items)} playlist tracks from Spotify")

    # Load the seen-track dedup log.
    dedup = load_json(LOG_PATH, {"updated": None, "seen": {}})
    seen: dict = dedup.get("seen") or {}

    # Compute "new this week" — tracks we've never posted AND added in
    # the past 7.5 days. The half-day padding catches the case where
    # the weekly run is delayed by a few hours.
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=7, hours=12)
    new_items: list[dict] = []
    for item in items:
        track = item.get("track") or {}
        track_id = track.get("id")
        if not track_id:
            continue
        if track_id in seen:
            continue
        added_at_str = item.get("added_at") or ""
        try:
            added_at = datetime.fromisoformat(added_at_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        if added_at < cutoff:
            # Back-fill the log with older tracks so we never re-post
            # the playlist's entire history on the first run.
            seen[track_id] = {
                "backfilled": now.isoformat(timespec="seconds"),
                "name": track.get("name"),
            }
            continue
        new_items.append(item)

    if not new_items:
        log("Nothing new on the playlist this week; skipping post.")
        # Still save the backfill so the next run starts cleanly.
        dedup["seen"] = seen
        dedup["updated"] = now.isoformat(timespec="seconds")
        save_log(dedup)
        return 0

    # Pick the destination — prefer the Worship & Music topic, fall
    # back to the Bible bot's default thread.
    chat_id = bible_cfg.get("chatId") or "@seedtheword"
    thread_id = cfg.get("worshipTopicId") or bible_cfg.get("messageThreadId")

    # ── Build the MarkdownV2 message ──────────────────────────────
    public_url = cfg.get("publicUrl") \
        or ("https://open.spotify.com/playlist/" + playlist_id)
    invite_url = cfg.get("collaboratorInviteUrl") or public_url

    lines: list[str] = []
    lines.append("🎵 *New in the Community Playlist this week*")
    lines.append("")

    for item in sorted(new_items, key=lambda i: i.get("added_at") or ""):
        track = item.get("track") or {}
        name = (track.get("name") or "Untitled").strip()
        artists = ", ".join(
            (a.get("name") or "").strip() for a in (track.get("artists") or []) if a
        ).strip() or "Unknown artist"
        track_url = (track.get("external_urls") or {}).get("spotify") or ""
        added_at_str = item.get("added_at") or ""
        try:
            added_at = datetime.fromisoformat(added_at_str.replace("Z", "+00:00"))
            day = added_at.strftime("%a")
        except (ValueError, TypeError):
            day = ""

        # MarkdownV2: bold track name (linked if we have a URL), em-dash,
        # artist(s), optional day-of-week suffix.
        if track_url:
            title_md = f"[*{mdv2_escape(name)}*]({track_url})"
        else:
            title_md = f"*{mdv2_escape(name)}*"
        suffix = f" \\({mdv2_escape('added ' + day)}\\)" if day else ""
        lines.append(f"· {title_md} — {mdv2_escape(artists)}{suffix}")

    lines.append("")
    lines.append(f"▶️ [{mdv2_escape('Listen / add songs on Spotify →')}]({public_url})")
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

    # Record every track as seen so next week's digest has a clean baseline.
    for item in new_items:
        track = item.get("track") or {}
        track_id = track.get("id")
        if track_id:
            seen[track_id] = {
                "posted": now.isoformat(timespec="seconds"),
                "name": track.get("name"),
            }
    dedup["seen"] = seen
    dedup["updated"] = now.isoformat(timespec="seconds")
    save_log(dedup)

    log(f"Posted {len(new_items)} new playlist track(s).")
    return 0


def save_log(data: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    sys.exit(main())
