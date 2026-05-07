"""
Post the daily "Prayer Requests & Thanksgiving Announcements" nudge
to the main topic of @seedtheword.

The cron fires every weekday morning at 07:00 PT, but we only post
on a RANDOM 3 days per week so the nudge stays fresh and doesn't
spam the main channel. The selection is deterministic per ISO week
(so every scheduled run within the same week agrees on the same
3 days) and different across weeks (derived from a hash of year+week).

Message format follows the team's template:

    Today's Prayer Requests and Thanksgiving Announcements 5/7/2026:

    You can add your prayer/thanksgiving details either here in this
    main channel or in the 'Prayer & Thanksgiving' Topic.

    Members are encouraged to pray for one another and feel free to
    share your needs because we are called to carry each other's
    burdens.

    Reminder: If members don't want to share revealing information
    but have general details for the prayer request and/or
    thanksgiving, we will encourage full anonymity.

Env vars:
  TELEGRAM_PRAYER_BOT_TOKEN   — bot token (GitHub Secret)
  BOT_CONFIG                  — path to telegram-bot.json (optional)
  DRY_RUN                     — if set, log the post instead of sending
  FORCE_POST                  — if set, ignore the random-day filter
                                and post anyway (useful for manual
                                workflow_dispatch testing)
"""
from __future__ import annotations

import hashlib
import os
import random
import sys
from datetime import datetime, timezone
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
BOT_TOKEN = os.environ.get("TELEGRAM_PRAYER_BOT_TOKEN", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())
FORCE_POST = bool(os.environ.get("FORCE_POST", "").strip())

POSTS_PER_WEEK = 3  # How many weekday mornings to post out of Mon-Fri


def is_post_day(local_date) -> bool:
    """Deterministic per-week pick of POSTS_PER_WEEK weekdays (Mon-Fri).
    All runs within the same ISO week return the same set, so dry-runs
    and scheduled runs stay consistent even if the job retries."""
    iso = local_date.isocalendar()
    # Seed: year + week + site-specific salt so the pattern isn't guessable
    seed_input = f"stwm-prayer-nudge-{iso.year}-{iso.week}".encode("utf-8")
    seed_int = int(hashlib.sha256(seed_input).hexdigest(), 16)
    rng = random.Random(seed_int)
    weekdays = [0, 1, 2, 3, 4]  # Mon=0 .. Fri=4
    chosen = sorted(rng.sample(weekdays, min(POSTS_PER_WEEK, len(weekdays))))
    return local_date.weekday() in chosen


def build_message(local_dt, prayer_topic_url: str) -> str:
    # Example date: 5/7/2026
    date_str = f"{local_dt.month}/{local_dt.day}/{local_dt.year}"
    esc_date = mdv2_escape(date_str)

    # The prayer topic link is inserted as a clickable MarkdownV2 link
    topic_link = f"[Prayer \\& Thanksgiving]({prayer_topic_url})" if prayer_topic_url else "Prayer \\& Thanksgiving"

    lines = [
        f"🙏🏻🤍 *Today\\'s Prayer Requests and Thanksgiving Announcements {esc_date}:*",
        "",
        f"You can add your prayer/thanksgiving details either here in this main channel or in the {topic_link} Topic\\.",
        "",
        "Members are encouraged to pray for one another and feel free to share your needs because we are called to carry each other\\'s burdens\\.",
        "",
        "_*Reminder:* If members don\\'t want to share revealing information but have general details for the prayer request and/or thanksgiving, we will encourage full anonymity\\._",
    ]
    return "\n".join(lines)


def main() -> int:
    full_cfg = load_json(BOT_CONFIG_PATH, None)
    if not full_cfg:
        log(f"Bot config missing at {BOT_CONFIG_PATH}; aborting.")
        return 1
    cfg = full_cfg.get("prayer")
    if not isinstance(cfg, dict):
        log("No 'prayer' section in telegram-bot.json; exiting.")
        return 0
    if cfg.get("enabled") is False:
        log("Prayer bot disabled in config; exiting.")
        return 0

    tz = ZoneInfo(cfg.get("timezone", "America/Los_Angeles"))
    now_local = datetime.now(tz)
    today_local = now_local.date()

    # Skip Sat/Sun outright
    if today_local.weekday() >= 5:
        log(f"Today is {today_local.strftime('%A')}; no prayer nudge on weekends.")
        return 0

    if not FORCE_POST and not is_post_day(today_local):
        log(f"Today ({today_local.strftime('%A')} of week {today_local.isocalendar().week}) "
            f"is not one of this week's {POSTS_PER_WEEK} random post days. Skipping.")
        return 0

    prayer_url = cfg.get("prayerTopicUrl") or "https://t.me/seedtheword/21/3725"
    text = build_message(now_local, prayer_url)

    chat_id = cfg.get("chatId")
    thread_id = cfg.get("messageThreadId")

    try:
        resp = send_telegram_message(
            token=BOT_TOKEN,
            chat_id=chat_id,
            text=text,
            message_thread_id=thread_id,
            parse_mode="MarkdownV2",
            disable_web_page_preview=True,
            dry_run=DRY_RUN,
        )
    except Exception as exc:
        log(f"Telegram send failed: {exc}")
        return 1

    if not resp.get("ok"):
        log(f"Telegram rejected the message: {resp}")
        return 1

    log("Posted daily prayer & thanksgiving nudge.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
