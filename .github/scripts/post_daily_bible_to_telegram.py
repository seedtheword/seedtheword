"""
Post the daily Bible reading to the @seedtheword Telegram group.

Schedule: every Monday-Saturday at 08:00 Pacific (wired up in
.github/workflows/daily-bible.yml). The Mon-Fri messages follow the
reading plan in assets/js/bible-plan.js (anchor date Apr 30 2026 =
Mark 11, advancing one chapter per weekday). The Saturday message
uses a dedicated Study Saturday Live template that pulls this week's
review passages from assets/data/study-saturday.json.

Mon-Fri format:

    📖 Today's Reading: [Mark Chapter 16](<english-spotify-url>)
    (+ Читаем Слово Божие на Русском (<russian-spotify-url>))  ← if configured

    🙏 *Today's Prayer Requests and Thanksgiving Announcements MM/DD/YYYY:*
    > _three italic blockquote paragraphs_

Saturday format (Study Saturday Live):

    🎙 *Discuss Scripture: Study Saturday Live*
    TONIGHT @ 7pm, May 9th, 2026
    Watch STW on Twitch —> https://www.twitch.tv/seedtheword

    *Study Saturday Live!*

    Join us in the Word, brought to you by Seed the Word Ministry.

    We'll be reviewing what we have been reading throughout the
    week, catching up on missed discussions, diving deeper into
    God's Word.

    The goal is to promote critical thinking amongst the body of
    Jesus Christ, who are capable of discerning what is Scripture
    based and that of what is from the enemy.

    Please review the S.E.E.D. Rules for more information on
    recent changes.

    📖 This week's study focus: <oldTestament>
    📖 This week's reading: <newTestament>

    🙏 Prayer & Thanksgiving block (same as Mon-Fri)

Env vars:
  TELEGRAM_BIBLE_BOT_TOKEN   — bot token (GitHub Secret)
  BOT_CONFIG                 — path to telegram-bot.json (optional)
  SPOTIFY_MAP                — path to bible-spotify-map.json (optional)
  STUDY_SATURDAY_PATH        — path to study-saturday.json (optional)
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
    edit_forum_topic,
    load_json,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get("BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"))
SPOTIFY_MAP_PATH = Path(os.environ.get("SPOTIFY_MAP", REPO_ROOT / "assets/data/bible-spotify-map.json"))
STUDY_SATURDAY_PATH = Path(os.environ.get("STUDY_SATURDAY_PATH", REPO_ROOT / "assets/data/study-saturday.json"))
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
    """Return the reading assigned to a specific date (Mon-Fri only).
    Returns None for Saturday + Sunday; Saturday has a dedicated
    Study Saturday Live post built from study-saturday.json rather
    than the NT reading plan."""
    if d.weekday() >= 5:  # Sat + Sun: no NT-reading post
        return None
    offset = weekdays_between(ANCHOR_DATE, d)
    idx = ANCHOR_INDEX + offset
    if idx < 0 or idx >= len(NT_SEQUENCE):
        return None
    return dict(NT_SEQUENCE[idx])


def pick_current_study_week(weeks: list) -> dict:
    """Pick the study-saturday entry closest to today-or-earlier.
    Mirrors the website's selection rule in assets/js/study-saturday.js."""
    if not weeks:
        return {}
    today = date.today()
    candidates = []
    for w in weeks:
        if not isinstance(w, dict) or not w.get("weekOf"):
            continue
        try:
            dt = datetime.strptime(str(w["weekOf"]), "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        if dt <= today:
            candidates.append((dt, w))
    if not candidates:
        return {}
    candidates.sort(key=lambda p: p[0], reverse=True)
    return candidates[0][1]


def ordinal_date(d: date) -> str:
    """Return the date as 'May 9th, 2026' (month full, day with ordinal,
    year). Used in the Saturday TONIGHT header."""
    day = d.day
    if 11 <= day <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{d.strftime('%B')} {day}{suffix}, {d.year}"


def build_prayer_block(full_cfg: dict, cfg: dict, today_local: date) -> list[str]:
    """Return the lines of the Prayer & Thanksgiving block. Shared by
    the Mon-Fri reading post and the Saturday Study-Saturday-Live post."""
    if not cfg.get("includePrayerBlock", True):
        return []
    date_label = today_local.strftime("%m/%d/%Y")
    prayer_topic_url = (
        full_cfg.get("prayer", {}).get("prayerTopicUrl")
        or cfg.get("prayerTopicUrl")
        or ""
    )
    lines: list[str] = []
    prayer_heading = "Today's Prayer Requests and Thanksgiving Announcements"
    lines.append("")
    lines.append(
        f"🙏 *{mdv2_escape(prayer_heading)} {mdv2_escape(date_label)}:*"
    )
    lines.append("")
    # MarkdownV2 blockquote (each line starts with '>') + italic
    # (wrapped in '_'). 'Prayer & Thanksgiving' stays as plain
    # quoted text because Telegram rejects overlapping link-inside-
    # italic entities.
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
    return lines


def resolve_spotify_url(
    reading: dict,
    cfg: dict,
    spotify_cfg: dict,
    primary_map_key: str,
    fallback_keys: list[str],
) -> str:
    """Prefer the per-chapter URL; otherwise walk the fallback key list
    until we find a non-empty string on either the bible cfg or the
    spotify map. Returns empty string if nothing is configured."""
    primary_map = spotify_cfg.get(primary_map_key) or {}
    key = f"{reading['book']} {reading['chapter']}"
    mapped = primary_map.get(key)
    if mapped and not key.startswith("__"):
        return mapped
    for fb_key in fallback_keys:
        candidate = cfg.get(fb_key) or spotify_cfg.get(fb_key)
        if candidate:
            return candidate
    return ""


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
    chat_id = cfg.get("chatId")
    thread_id = cfg.get("messageThreadId")

    # Saturday = Study Saturday Live post (different template).
    # Sunday = no post.
    if today_local.weekday() == 6:
        log(f"Sunday ({today_local}); no Bible post scheduled. Exiting.")
        return 0

    if today_local.weekday() == 5:
        return _post_study_saturday(full_cfg, cfg, tz, today_local, chat_id, thread_id)

    return _post_weekday_reading(full_cfg, cfg, tz, today_local, chat_id, thread_id)


def _post_weekday_reading(full_cfg, cfg, tz, today_local, chat_id, thread_id) -> int:
    reading = get_reading_for_date(today_local)
    if not reading:
        log(f"No reading scheduled for {today_local} ({today_local.strftime('%A')}); exiting.")
        return 0

    spotify_cfg = load_json(SPOTIFY_MAP_PATH, {})
    english_url = resolve_spotify_url(
        reading, cfg, spotify_cfg,
        "chapters", ["fallbackShowUrl", "defaultShowUrl"],
    )
    russian_url = resolve_spotify_url(
        reading, cfg, spotify_cfg,
        "russianChapters", ["russianFallbackShowUrl", "russianShowUrl"],
    )

    reading_label = f"{reading['book']} Chapter {reading['chapter']}"
    lines: list[str] = []
    heading = "Today's Reading"
    if english_url:
        lines.append(
            f"📖 *{mdv2_escape(heading)}:* [{mdv2_escape(reading_label)}]({english_url})"
        )
    else:
        lines.append(f"📖 *{mdv2_escape(heading)}:* {mdv2_escape(reading_label)}")

    if russian_url:
        lines.append(
            f"\\+ [Читаем Слово Божие на Русском]({russian_url})"
        )

    # Prayer & Thanksgiving block appended to the same message.
    lines.extend(build_prayer_block(full_cfg, cfg, today_local))

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
    _rename_today_chapter_topic(cfg, chat_id, reading)
    return 0


def _rename_today_chapter_topic(cfg: dict, chat_id, reading: dict) -> None:
    """After a successful weekday reading post, rename the
    'Today's Chapter is ...' forum topic so the topic title matches
    the day's reading. Best-effort — failures are logged but do not
    fail the workflow run."""
    topic_cfg = cfg.get("todayChapterTopic") or {}
    if not topic_cfg or topic_cfg.get("enabled") is False:
        return
    thread_id = topic_cfg.get("messageThreadId")
    if not thread_id:
        return
    template = topic_cfg.get("nameTemplate") or "Today's Chapter is {book} {chapter}"
    try:
        new_name = template.format(
            book=reading.get("book", ""),
            chapter=reading.get("chapter", ""),
        )
    except (KeyError, IndexError) as exc:
        log(f"Topic rename template error ({template!r}): {exc}")
        return
    resp = edit_forum_topic(
        token=BOT_TOKEN,
        chat_id=chat_id,
        message_thread_id=thread_id,
        name=new_name,
        dry_run=DRY_RUN,
    )
    if resp.get("ok"):
        log(f"Renamed topic {thread_id} → {new_name!r}")
    elif not resp.get("skipped"):
        log(f"Topic rename skipped (non-fatal). Response: {resp}")


def _post_study_saturday(full_cfg, cfg, tz, today_local, chat_id, thread_id) -> int:
    """Saturday morning Study Saturday Live teaser. Includes this
    week's review passages (Old Testament + New Testament from
    study-saturday.json) plus the standard Prayer & Thanksgiving block."""
    sat_cfg = cfg.get("saturday") or {}
    if sat_cfg.get("enabled") is False:
        log("Saturday Study Saturday Live post disabled; exiting.")
        return 0

    study_cfg = load_json(STUDY_SATURDAY_PATH, {}) or {}
    weeks = study_cfg.get("weeks") if isinstance(study_cfg, dict) else []
    current = pick_current_study_week(weeks or [])
    old_testament = (current.get("oldTestament") or "").strip() if current else ""
    new_testament = (current.get("newTestament") or "").strip() if current else ""

    twitch_url = (sat_cfg.get("twitchUrl") or "https://www.twitch.tv/seedtheword").strip()
    stream_time = (sat_cfg.get("streamStartTimePT") or "7:00 PM").strip()
    rules_url = (sat_cfg.get("rulesUrl") or "").strip()
    body_intro = sat_cfg.get("bodyIntro") or ""
    body_review = sat_cfg.get("bodyReview") or ""
    body_goal = sat_cfg.get("bodyGoal") or ""
    body_rules = sat_cfg.get("bodyRulesNote") or ""

    # Date for TONIGHT header: e.g. "May 9th, 2026"
    tonight_date = ordinal_date(today_local)

    lines: list[str] = []
    # Header group
    lines.append(f"🎙 *{mdv2_escape('Discuss Scripture: Study Saturday Live')}*")
    lines.append(
        f"{mdv2_escape('TONIGHT @ ' + stream_time + ', ' + tonight_date)}"
    )
    lines.append(
        f"{mdv2_escape('Watch STW on Twitch —>')} {twitch_url}"
    )
    lines.append("")

    # Sub-headline
    lines.append(f"*{mdv2_escape('Study Saturday Live!')}*")
    lines.append("")

    # Body paragraphs, each on its own line, blank line between.
    for paragraph in (body_intro, body_review, body_goal):
        if paragraph:
            lines.append(mdv2_escape(paragraph))
            lines.append("")

    # Rules note — with optional link
    if body_rules:
        if rules_url:
            # Replace 'S.E.E.D. Rules' with a link to rules_url if the
            # phrase appears in the note; otherwise append a follow-up
            # link line.
            target = "S.E.E.D. Rules"
            if target in body_rules:
                before, _, after = body_rules.partition(target)
                lines.append(
                    mdv2_escape(before)
                    + f"[{mdv2_escape(target)}]({rules_url})"
                    + mdv2_escape(after)
                )
            else:
                lines.append(mdv2_escape(body_rules))
                lines.append(f"[{mdv2_escape('S.E.E.D. Rules →')}]({rules_url})")
        else:
            lines.append(mdv2_escape(body_rules))
        lines.append("")

    # This week's review passages (from study-saturday.json) — only
    # render the lines that are present so a missing field doesn't
    # leave an orphaned label.
    study_focus_label = "This week's study focus:"
    reading_label = "This week's reading:"
    if old_testament:
        lines.append(
            f"📖 *{mdv2_escape(study_focus_label)}* {mdv2_escape(old_testament)}"
        )
    if new_testament:
        lines.append(
            f"📖 *{mdv2_escape(reading_label)}* {mdv2_escape(new_testament)}"
        )

    # Prayer & Thanksgiving block — shared with weekday posts.
    lines.extend(build_prayer_block(full_cfg, cfg, today_local))

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
    log(f"Posted Study Saturday Live teaser (week of {current.get('weekOf', 'unknown')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
