"""
Post the daily Bible reading to the @seedtheword Telegram group.

Schedule: every Monday-Friday at 08:00 Pacific (wired up in
.github/workflows/daily-bible.yml). The reading plan mirrors
assets/js/bible-plan.js exactly — anchor date Apr 30 2026 (Mark 11)
advancing one chapter per weekday through the NT.

Message format follows the team's convention:

    Today's Reading: Mark Chapter 16 (<spotify-or-show-url>)

Where the URL prefers a per-chapter Spotify episode from
assets/data/bible-spotify-map.json and falls back to the main show URL.

Env vars:
  TELEGRAM_BIBLE_BOT_TOKEN   — bot token (GitHub Secret)
  BOT_CONFIG                 — path to telegram-bot.json (optional)
  SPOTIFY_MAP                — path to bible-spotify-map.json (optional)
  DRY_RUN                    — if set, log the post instead of sending
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
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
SPOTIFY_MAP_PATH = Path(os.environ.get("SPOTIFY_MAP", REPO_ROOT / "assets/data/bible-spotify-map.json"))
BOT_TOKEN = os.environ.get("TELEGRAM_BIBLE_BOT_TOKEN", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())


# ── Reading plan, mirrors assets/js/bible-plan.js ──────────────────────
NT_BOOKS = [
    ("Matthew", 28), ("Mark", 16), ("Luke", 24), ("John", 21),
    ("Acts", 28), ("Romans", 16), ("1 Corinthians", 16), ("2 Corinthians", 13),
    ("Galatians", 6), ("Ephesians", 6), ("Philippians", 4), ("Colossians", 4),
    ("1 Thessalonians", 5), ("2 Thessalonians", 3), ("1 Timothy", 6),
    ("2 Timothy", 4), ("Titus", 3), ("Philemon", 1), ("Hebrews", 13),
    ("James", 5), ("1 Peter", 5), ("2 Peter", 3), ("1 John", 5),
    ("2 John", 1), ("3 John", 1), ("Jude", 1), ("Revelation", 22),
]
NT_SEQUENCE = []
for name, chapters in NT_BOOKS:
    for c in range(1, chapters + 1):
        NT_SEQUENCE.append({"book": name, "chapter": c})

ANCHOR_DATE = date(2026, 4, 30)
ANCHOR_BOOK = "Mark"
ANCHOR_CHAPTER = 11
ANCHOR_INDEX = next(
    i for i, r in enumerate(NT_SEQUENCE)
    if r["book"] == ANCHOR_BOOK and r["chapter"] == ANCHOR_CHAPTER
)


def weekdays_between(from_date: date, to_date: date) -> int:
    """Number of weekdays (Mon-Fri) from from_date to to_date, signed."""
    if to_date == from_date:
        return 0
    step = timedelta(days=1) if to_date > from_date else timedelta(days=-1)
    count = 0
    cursor = from_date
    while cursor != to_date:
        cursor = cursor + step
        if cursor.weekday() < 5:  # Mon-Fri
            count += 1 if step.days > 0 else -1
    return count


def get_reading_for_date(d: date):
    if d.weekday() >= 5:  # Sat/Sun: no reading
        return None
    offset = weekdays_between(ANCHOR_DATE, d)
    idx = ANCHOR_INDEX + offset
    if idx < 0 or idx >= len(NT_SEQUENCE):
        return None
    return NT_SEQUENCE[idx]


# ── Main ───────────────────────────────────────────────────────────────
def main() -> int:
    full_cfg = load_json(BOT_CONFIG_PATH, None)
    if not full_cfg:
        log(f"Bot config missing at {BOT_CONFIG_PATH}; aborting.")
        return 1
    cfg = full_cfg.get("bible")
    if not isinstance(cfg, dict):
        log("No 'bible' section in telegram-bot.json; exiting.")
        return 0
    if cfg.get("enabled") is False:
        log("Bible bot disabled in config; exiting.")
        return 0

    tz = ZoneInfo(cfg.get("timezone", "America/Los_Angeles"))
    today_local = datetime.now(tz).date()
    reading = get_reading_for_date(today_local)
    if not reading:
        log(f"No reading scheduled for {today_local} ({today_local.strftime('%A')}); exiting.")
        return 0

    # Resolve URL — prefer per-chapter map, fall back to show URL
    spotify_cfg = load_json(SPOTIFY_MAP_PATH, {})
    chapters_map = spotify_cfg.get("chapters") or {}
    key = f"{reading['book']} {reading['chapter']}"
    url = chapters_map.get(key)
    if not url:
        url = cfg.get("fallbackShowUrl") \
            or spotify_cfg.get("defaultShowUrl") \
            or "https://open.spotify.com/show/2rK4fCJuHWp8ji7Cj66EXK"

    # Build MarkdownV2 message
    reading_label = f"{reading['book']} Chapter {reading['chapter']}"
    # Format: "Today's Reading: [Mark Chapter 16](spotify-url)"
    # MarkdownV2 link syntax, so the title is clickable.
    lines = []
    lines.append(f"📖 *Today\\'s Reading:* [{mdv2_escape(reading_label)}]({url})")

    chat_id = cfg.get("chatId")
    thread_id = cfg.get("messageThreadId")
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
        log(f"Telegram rejected the message: {resp}")
        return 1

    log(f"Posted daily Bible reading: {reading_label}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
