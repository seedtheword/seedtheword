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
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import (  # type: ignore
    log,
    mdv2_escape,
    send_telegram_message,
    send_telegram_audio,
    edit_forum_topic,
    load_json,
)
from bible_books import (  # type: ignore
    NT_BOOKS,
    OT_HISTORY_BOOKS,
    POETRY_PROPHECY_BOOKS,
    OT_HISTORY_SEQUENCE,
    POETRY_PROPHECY_SEQUENCE,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get("BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"))
SPOTIFY_MAP_PATH = Path(os.environ.get("SPOTIFY_MAP", REPO_ROOT / "assets/data/bible-spotify-map.json"))
STUDY_SATURDAY_PATH = Path(os.environ.get("STUDY_SATURDAY_PATH", REPO_ROOT / "assets/data/study-saturday.json"))
DEDUP_LOG_PATH = Path(os.environ.get("BIBLE_LOG_PATH", REPO_ROOT / "assets/data/telegram-bible-log.json"))
DRIVE_AUDIO_MAP_PATH = Path(os.environ.get("DRIVE_AUDIO_MAP", REPO_ROOT / "assets/data/bible-audio-drive-map.json"))
BOT_TOKEN = os.environ.get("TELEGRAM_BIBLE_BOT_TOKEN", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())
FORCE_POST = bool(os.environ.get("FORCE_POST", "").strip())

# YouVersion ESV chapter URL builder
# Version 59 = ESV on bible.com
_YOUVERSION_ESV_ID = 59
_OSIS_CODES: dict[str, str] = {
    "Matthew": "MAT", "Mark": "MRK", "Luke": "LUK", "John": "JHN",
    "Acts": "ACT", "Romans": "ROM",
    "1 Corinthians": "1CO", "2 Corinthians": "2CO",
    "Galatians": "GAL", "Ephesians": "EPH", "Philippians": "PHP",
    "Colossians": "COL",
    "1 Thessalonians": "1TH", "2 Thessalonians": "2TH",
    "1 Timothy": "1TI", "2 Timothy": "2TI",
    "Titus": "TIT", "Philemon": "PHM", "Hebrews": "HEB",
    "James": "JAS", "1 Peter": "1PE", "2 Peter": "2PE",
    "1 John": "1JN", "2 John": "2JN", "3 John": "3JN",
    "Jude": "JUD", "Revelation": "REV",
}

def youversion_esv_url(book: str, chapter: int) -> str:
    """Return the YouVersion ESV chapter URL, e.g.
    https://www.bible.com/bible/59/JHN.2.ESV"""
    code = _OSIS_CODES.get(book, book.upper()[:3])
    return f"https://www.bible.com/bible/{_YOUVERSION_ESV_ID}/{code}.{chapter}.ESV"


def _load_dedup_log() -> dict:
    """Read the dedup log; on any error return an empty fresh log."""
    try:
        if DEDUP_LOG_PATH.exists():
            return json.loads(DEDUP_LOG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"Could not read dedup log ({exc}); starting fresh.")
    return {"posts": []}


def _save_dedup_log(data: dict) -> None:
    DEDUP_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    DEDUP_LOG_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _already_posted_today(today_local: date, post_kind: str) -> bool:
    """Return True if the dedup log already has a successful entry
    for this local date and post kind."""
    log_data = _load_dedup_log()
    today_str = today_local.isoformat()
    for entry in log_data.get("posts", []):
        if entry.get("date") == today_str and entry.get("kind") == post_kind and entry.get("ok"):
            return True
    return False


def _record_post(today_local: date, post_kind: str, ok: bool, detail: str = "") -> None:
    """Append a record to the dedup log. Garbage-collects entries
    older than 30 days so the file doesn't grow forever."""
    log_data = _load_dedup_log()
    posts = log_data.get("posts", [])
    posts.append({
        "date": today_local.isoformat(),
        "kind": post_kind,
        "ok": ok,
        "detail": detail[:200],
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    cutoff = (today_local - timedelta(days=30)).isoformat()
    posts = [p for p in posts if p.get("date", "") >= cutoff]
    log_data["posts"] = posts
    _save_dedup_log(log_data)


# ── Reading plan, mirrors assets/js/bible-plan.js ──────────────────────
# NT_BOOKS is imported from bible_books (single source of truth for the
# canonical 66-book list); the NT_SEQUENCE builder below is unchanged.
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


# ── Layered Bible Reading Plan companion-stream helpers ────────────────
# Pure functions. Mirror the algorithms in assets/js/layered-plan.js so
# Property L10 (Python ↔ JS ↔ Apps Script parity) holds.

def _parse_anchor_date(value) -> date | None:
    """Parse 'YYYY-MM-DD' (or accept a date instance) into a date.
    Returns None on bad input — the caller treats that as a silent
    missing reading rather than crashing the post."""
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _walk_reading(d: date, anchor: dict, sequence: list) -> dict | None:
    """Look up a chapter on a weekday-walk stream. Mirrors the JS
    _getWalkReading algorithm: weekend short-circuit, anchor-index
    lookup, signed weekday-offset against the flat sequence."""
    if d.weekday() >= 5:  # Sat/Sun: no reading
        return None
    if not isinstance(anchor, dict):
        return None
    anchor_date = _parse_anchor_date(anchor.get("date"))
    anchor_book = anchor.get("book")
    anchor_chapter = anchor.get("chapter")
    if anchor_date is None or not anchor_book or not isinstance(anchor_chapter, int):
        return None
    try:
        anchor_idx = next(
            i for i, r in enumerate(sequence)
            if r["book"] == anchor_book and r["chapter"] == anchor_chapter
        )
    except StopIteration:
        return None  # bad config — silent omit (R5.7-style fallthrough)
    offset = weekdays_between(anchor_date, d)
    idx = anchor_idx + offset
    if idx < 0 or idx >= len(sequence):
        return None
    return dict(sequence[idx])


def get_ot_history_reading(d: date, anchor: dict) -> dict | None:
    """OT History walk lookup (Genesis through Esther). R5.4-R5.8."""
    return _walk_reading(d, anchor, OT_HISTORY_SEQUENCE)


def get_poetry_prophecy_reading(d: date, anchor: dict) -> dict | None:
    """Poetry & Prophecy walk lookup (Job, Ecc, SoS, Isaiah-Malachi
    excluding Psalms and Proverbs). R6.4-R6.7."""
    return _walk_reading(d, anchor, POETRY_PROPHECY_SEQUENCE)


def psalm_of_day(d: date, tz: ZoneInfo | None = None) -> int:
    """Daily Psalm formula: ((dayOfYear - 1) mod 150) + 1. R7.1, L1, L6.
    `d` is interpreted as already being a calendar date in the configured
    timezone (the caller passes today_local, which is computed in tz)."""
    doy = d.timetuple().tm_yday
    return ((doy - 1) % 150) + 1


def proverb_of_day(d: date, tz: ZoneInfo | None = None) -> int:
    """Daily Proverb formula: min(dayOfMonth, 31). R7.4, L1, L6.
    February tops out at 28 (or 29 in leap years); chapters 30-31 are
    simply not read in February."""
    return min(d.day, 31)


def build_layered_footer(layered_cfg: dict, today_local: date, tz: ZoneInfo | None) -> list[str]:
    """Compose the 'Going deeper today' footer block for the Mon-Fri
    Telegram post. Pure function — no I/O, no escaping side effects.
    Returns a list of MarkdownV2-escaped lines ready to be
    `lines.extend()`-ed into the post body. Returns [] when any gate
    blocks emission. Implements §4.5.3 of design.md and supports
    Properties L1, L2, L8, L9, L10."""
    if not layered_cfg or not layered_cfg.get("enabled"):
        return []                                                 # R1.7
    if not layered_cfg.get("includeInTelegram"):
        return []                                                 # R1.10, R9.7
    if today_local.weekday() >= 5:
        return []                                                 # R3.5, R9.5

    streams = layered_cfg.get("streams") or {}
    pills: list[tuple[str | None, str]] = []

    ot = streams.get("otHistory") or {}
    if ot.get("enabled", True):
        r = get_ot_history_reading(today_local, ot.get("anchor") or {})
        if r:
            pills.append(("OT walk", f"{r['book']} {r['chapter']}"))

    pp = streams.get("poetryProphecy") or {}
    if pp.get("enabled", True):
        r = get_poetry_prophecy_reading(today_local, pp.get("anchor") or {})
        if r:
            pills.append(("Poetry & Prophecy", f"{r['book']} {r['chapter']}"))

    psalm = streams.get("psalm") or {}
    if psalm.get("enabled", True):
        pills.append((None, f"Psalm {psalm_of_day(today_local, tz)}"))

    proverbs = streams.get("proverbs") or {}
    if proverbs.get("enabled", True):
        pills.append((None, f"Proverbs {proverb_of_day(today_local, tz)}"))

    if not pills:
        return []                                                 # R1.9

    out = ["", f"🌿 *{mdv2_escape('Going deeper today')}*"]
    for label, ref in pills:
        if label:
            out.append(f"· {mdv2_escape(label + ': ' + ref)}")
        else:
            out.append(f"· {mdv2_escape(ref)}")
    return out


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
        post_kind = "saturday"
        if not FORCE_POST and _already_posted_today(today_local, post_kind):
            log(f"Already posted Saturday Study Saturday Live for {today_local}; skipping (dedup guard).")
            return 0
        rc = _post_study_saturday(full_cfg, cfg, tz, today_local, chat_id, thread_id)
        _record_post(today_local, post_kind, rc == 0, "study-saturday-live")
        return rc

    post_kind = "weekday"
    if not FORCE_POST and _already_posted_today(today_local, post_kind):
        log(f"Already posted weekday Bible reading for {today_local}; skipping (dedup guard).")
        return 0
    rc = _post_weekday_reading(full_cfg, cfg, tz, today_local, chat_id, thread_id)
    _record_post(today_local, post_kind, rc == 0, "weekday-reading")
    return rc


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

    # Going Deeper Today footer — companion streams (R9.1, R9.2, R9.3).
    layered_cfg = (full_cfg.get("bible") or {}).get("layeredPlan")
    lines.extend(build_layered_footer(layered_cfg, today_local, tz))

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
    _post_audio_to_chapter_topic(cfg, chat_id, reading)
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


def _post_audio_to_chapter_topic(cfg: dict, chat_id, reading: dict) -> None:
    """Post the ESV audio recording for today's chapter into the
    'Today's Chapter' Telegram topic with the standard template:

        Today's Audio: John Chapter 2
        Translation: English Standard Version - Bible Brain Audio Recording

        Following digitally or need to read online?
        [John 2](https://www.bible.com/bible/59/JHN.2.ESV)

    Best-effort — a missing Drive map or failed send does not fail
    the main workflow run.
    """
    topic_cfg = cfg.get("todayChapterTopic") or {}
    if not topic_cfg or topic_cfg.get("enabled") is False:
        return
    thread_id = topic_cfg.get("messageThreadId")
    if not thread_id:
        return

    # Load the Drive audio map (generated by scripts/generate_drive_audio_map.py)
    audio_map_data = load_json(DRIVE_AUDIO_MAP_PATH, None)
    if not audio_map_data:
        log(f"Audio map not found at {DRIVE_AUDIO_MAP_PATH}; skipping audio post. "
            "Run scripts/generate_drive_audio_map.py to generate it.")
        return

    chapters = audio_map_data.get("chapters") or {}
    book = reading.get("book", "")
    chapter = reading.get("chapter", 0)
    chapter_key = f"{book} {chapter}"
    file_id = chapters.get(chapter_key)

    if not file_id:
        log(f"No Drive audio file ID for '{chapter_key}'; skipping audio post.")
        return

    # Direct download URL — Telegram fetches this and caches the file
    audio_url = f"https://drive.google.com/uc?export=download&id={file_id}"

    # YouVersion ESV link for the "read online" line
    yv_url = youversion_esv_url(book, chapter)
    chapter_display = f"{book} {chapter}"
    chapter_label = f"{book} Chapter {chapter}"

    # Build MarkdownV2 caption following the exact template
    lines = [
        f"*{mdv2_escape('Today\u2019s Audio:')}* {mdv2_escape(chapter_label)}",
        mdv2_escape("Translation: English Standard Version - Bible Brain Audio Recording"),
        "",
        mdv2_escape("Following digitally or need to read online?"),
        f"[{mdv2_escape(chapter_display)}]({yv_url})",
    ]
    caption = "\n".join(lines)

    try:
        resp = send_telegram_audio(
            token=BOT_TOKEN,
            chat_id=chat_id,
            audio_url=audio_url,
            caption=caption,
            message_thread_id=thread_id,
            parse_mode="MarkdownV2",
            dry_run=DRY_RUN,
        )
    except Exception as exc:
        log(f"Audio post to chapter topic failed (non-fatal): {exc}")
        return

    if resp.get("ok"):
        log(f"Posted audio for {chapter_label} to chapter topic {thread_id}")
    elif not resp.get("dry_run"):
        log(f"Audio post rejected (non-fatal): {resp}")


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
