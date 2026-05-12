"""
Post the daily Bible reading to the @seedtheword Telegram group.

Schedule: every Monday-Saturday at 08:00 Pacific (wired up in
.github/workflows/daily-bible.yml). The reading plan mirrors
assets/js/bible-plan.js exactly — anchor date Apr 30 2026 (Mark 11)
advancing one chapter per weekday through the NT. Saturday reuses
the most recent weekday reading as a "This week's reading" review
entry so members have a consistent post to reference.

Message format (team convention):

    📖 Today's Reading: [Mark Chapter 16](<english-spotify-url>)
    (+ Читаем Слово Божие на Русском (<russian-spotify-url>))  ← if configured

    🙏 *Today's Prayer Requests and Thanksgiving Announcements MM/DD/YYYY:*

    > _You can add your prayer/thanksgiving details either here in
      this main channel or in the 'Prayer & Thanksgiving' topic._
    >
    > _Members are encouraged to pray for one another and feel free
      to share your needs because we are called to carry each other's
      burdens._
    >
    > _Reminder: If members don't want to share revealing information
      but have general details for the prayer request and/or
      thanksgiving, we will encourage full anonymity._

The prayer block is appended to the same message (not a second post)
so the whole daily brief reads as one unit. Use the `includePrayerBlock`
flag in telegram-bot.json → "bible" to turn the block off without
touching code.

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
    """Return the reading assigned to a specific date. Saturday falls
    back to the most recent weekday's reading (same as Friday's)
    so the post on review day points at this week's last chapter.
    Sunday returns None (no post)."""
    if d.weekday() == 6:  # Sunday — no post
        return None
    # For Saturday, reuse Friday's reading.
    lookup_date = d
    if d.weekday() == 5:  # Saturday
        lookup_date = d - timedelta(days=1)
    offset = weekdays_between(ANCHOR_DATE, lookup_date)
    idx = ANCHOR_INDEX + offset
    if idx < 0 or idx >= len(NT_SEQUENCE):
        return None
    reading = dict(NT_SEQUENCE[idx])
    reading["is_review"] = (d.weekday() == 5)
    return reading


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

    # Resolve the two Spotify URLs — English primary, Russian optional.
    spotify_cfg = load_json(SPOTIFY_MAP_PATH, {})
    chapters_map = spotify_cfg.get("chapters") or {}
    russian_map = spotify_cfg.get("russianChapters") or {}

    def _resolve_url(primary_map: dict, fallback_keys: list[str]) -> str:
        """Prefer the per-chapter URL; otherwise walk the fallback key
        list until we find a non-empty string on either the bible cfg
        or the spotify map."""
        key = f"{reading['book']} {reading['chapter']}"
        mapped = primary_map.get(key)
        if mapped and not key.startswith("__"):
            return mapped
        for fb_key in fallback_keys:
            candidate = cfg.get(fb_key) or spotify_cfg.get(fb_key)
            if candidate:
                return candidate
        return ""

    english_url = _resolve_url(chapters_map, ["fallbackShowUrl", "defaultShowUrl"])
    russian_url = _resolve_url(russian_map, ["russianFallbackShowUrl", "russianShowUrl"])

    reading_label = f"{reading['book']} Chapter {reading['chapter']}"

    # ── Build the MarkdownV2 message ──────────────────────────────
    lines: list[str] = []
    heading = "Today's Reading"
    if reading.get("is_review"):
        heading = "This Week's Reading (Review)"
    # MarkdownV2 link syntax so the title is clickable. Escape the
    # label (it can contain chars like ':' or '1' that MarkdownV2 is
    # picky about in link text — though numbers are safe, ':' needs
    # escape).
    if english_url:
        lines.append(
            f"📖 *{mdv2_escape(heading)}:* [{mdv2_escape(reading_label)}]({english_url})"
        )
    else:
        lines.append(f"📖 *{mdv2_escape(heading)}:* {mdv2_escape(reading_label)}")

    if russian_url:
        # Keep the Russian text unescaped where it's fine (cyrillic chars
        # aren't MarkdownV2-special) and escape the '+' sign.
        lines.append(
            f"\\+ [Читаем Слово Божие на Русском]({russian_url})"
        )

    # ── Prayer & Thanksgiving block ───────────────────────────────
    if cfg.get("includePrayerBlock", True):
        # Format today's date as MM/DD/YYYY for the header.
        date_label = today_local.strftime("%m/%d/%Y")
        prayer_topic_url = (
            full_cfg.get("prayer", {}).get("prayerTopicUrl")
            or cfg.get("prayerTopicUrl")
            or ""
        )

        lines.append("")
        prayer_heading = "Today's Prayer Requests and Thanksgiving Announcements"
        lines.append(
            f"🙏 *{mdv2_escape(prayer_heading)} {mdv2_escape(date_label)}:*"
        )
        lines.append("")
        # MarkdownV2 blockquote (each line starts with '>') + italic
        # (entire line wrapped in '_'). We keep 'Prayer & Thanksgiving'
        # as plain quoted text inside the italic sentence because
        # MarkdownV2 doesn't reliably allow a link to sit mid-italic
        # (the parser rejects overlapping entities). If a topic URL is
        # configured, we add a small non-italic follow-up line with a
        # direct "Open the Prayer & Thanksgiving topic →" link so the
        # phrase is still one tap away.
        lines.append(
            "> _" + mdv2_escape(
                "You can add your prayer/thanksgiving details either here in this "
                "main channel or in the 'Prayer & Thanksgiving' topic."
            ) + "_"
        )
        lines.append(">")
        lines.append(
            "> _" + mdv2_escape(
                "Members are encouraged to pray for one another and feel free to share "
                "your needs because we are called to carry each other's burdens."
            ) + "_"
        )
        lines.append(">")
        lines.append(
            "> _" + mdv2_escape(
                "Reminder: If members don't want to share revealing information but have "
                "general details for the prayer request and/or thanksgiving, we will "
                "encourage full anonymity."
            ) + "_"
        )
        if prayer_topic_url:
            lines.append("")
            lines.append(
                f"[{mdv2_escape('Open the Prayer & Thanksgiving topic →')}]({prayer_topic_url})"
            )

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

    log(f"Posted daily Bible reading: {reading_label} (review={reading.get('is_review', False)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
