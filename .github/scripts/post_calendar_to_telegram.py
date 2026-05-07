"""
Post Google Calendar events to our Telegram announcements chat.

Schedule (wired up in .github/workflows/telegram-announcements.yml):
  07:00 / 12:00 / 17:00 Pacific, every day except Sunday.

Anti-spam logic:
  * Each run fetches today's events plus tomorrow's (so 5 PM can tease
    tomorrow's first thing).
  * We post an event at most once per status transition. Status is one
    of 'upcoming' (not started yet) or 'live' (started, not ended).
    An event can post twice: once when it's upcoming, again when it
    becomes live.
  * The dedup log is at assets/data/telegram-announcement-log.json
    and is committed back to the repo by the workflow.
  * If there's nothing new to post, the script exits cleanly without
    touching Telegram.

Formatting uses Telegram's MarkdownV2 so we can ship real *bold* and
_italic_. The body is built to match the ministry's existing
announcement template (banner line, venue line, address, description,
closer).

Env vars:
  TELEGRAM_BOT_TOKEN   — bot token (GitHub Secret)
  GOOGLE_CAL_API_KEY   — Google Calendar API key (GitHub Secret; we
                         reuse the same one the frontend uses, but
                         keep it secret-side for the Action)
  GOOGLE_CAL_ID        — calendar ID (defaults to the ministry's)
  BOT_CONFIG           — path to telegram-bot.json
                         (default: assets/data/telegram-bot.json)
  LOG_PATH             — path to the dedup log
                         (default: assets/data/telegram-announcement-log.json)
  SITE_BASE_URL        — optional, used to build deep links in posts
                         (default: https://seedtheword.github.io/seedtheword)
  DRY_RUN              — if set, print what would be posted without
                         hitting the Telegram API

Exit code 0 means the run completed even if nothing was posted.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo


# ── Config ─────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get("BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"))
LOG_PATH = Path(os.environ.get("LOG_PATH", REPO_ROOT / "assets/data/telegram-announcement-log.json"))
SITE_BASE_URL = os.environ.get("SITE_BASE_URL", "https://seedtheword.github.io/seedtheword").rstrip("/")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
# The Google Calendar API key is not actually secret — it's already
# embedded in the public frontend at assets/js/google-calendar.js so
# anyone can see it in browser devtools. We keep this default so the
# Action doesn't require a separate GitHub Secret; set GOOGLE_CAL_API_KEY
# in the environment to override.
_DEFAULT_CAL_API_KEY = "AIzaSyA6GMEdyQHxcRCJuun-OIrFlJgG67Zjtpc"
GOOGLE_CAL_API_KEY = (os.environ.get("GOOGLE_CAL_API_KEY") or _DEFAULT_CAL_API_KEY).strip()
GOOGLE_CAL_ID = os.environ.get("GOOGLE_CAL_ID", "seedthewordministry@gmail.com").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())


def log(msg: str) -> None:
    print(msg, flush=True)


# ── File helpers ───────────────────────────────────────────────────────
def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ── HTML → plain text (matches the frontend's stripHtmlToText) ─────────
ENTITY_MAP = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&hellip;": "…",
    "&mdash;": "—", "&ndash;": "–",
}


def strip_html(html: str) -> str:
    if not html:
        return ""
    s = str(html).replace("|", "\n")
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"<li[^>]*>", "• ", s, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", "", s)
    for k, v in ENTITY_MAP.items():
        s = s.replace(k, v)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def smart_trim(text: str, max_chars: int) -> str:
    if not text or len(text) <= max_chars:
        return text or ""
    hard = text[:max_chars]
    soft = re.sub(r"\s+\S*$", "", hard)
    base = soft if len(soft) > int(max_chars * 0.7) else hard
    return base.rstrip(",;:.-–— \n\t") + "…"


# ── Telegram MarkdownV2 escaping ───────────────────────────────────────
# These characters are reserved in MarkdownV2 and must be escaped when
# used as literal text: _ * [ ] ( ) ~ ` > # + - = | { } . !
MDV2_SPECIAL = r"_*[]()~`>#+\-=|{}.!"


def mdv2_escape(text: str) -> str:
    if not text:
        return ""
    return re.sub(f"([{re.escape(MDV2_SPECIAL)}])", r"\\\1", text)


# ── Event time helpers ─────────────────────────────────────────────────
def parse_ev_start(event: dict) -> Optional[datetime]:
    s = event.get("start", {})
    if "dateTime" in s:
        return datetime.fromisoformat(s["dateTime"].replace("Z", "+00:00"))
    if "date" in s:
        # All-day event — treat as the given local date at 00:00 UTC,
        # the caller converts to the bot's timezone.
        return datetime.fromisoformat(s["date"] + "T00:00:00+00:00")
    return None


def parse_ev_end(event: dict) -> Optional[datetime]:
    e = event.get("end", {})
    if "dateTime" in e:
        return datetime.fromisoformat(e["dateTime"].replace("Z", "+00:00"))
    if "date" in e:
        return datetime.fromisoformat(e["date"] + "T23:59:59+00:00")
    return None


def event_status(event: dict, now: datetime) -> str:
    """One of 'upcoming' | 'live' | 'past'."""
    start = parse_ev_start(event)
    end = parse_ev_end(event)
    if not start or not end:
        return "past"
    if now < start:
        return "upcoming"
    if start <= now <= end:
        return "live"
    return "past"


def day_slot(tz: ZoneInfo, now: datetime) -> str:
    """Which of the three daily slots are we in? Used for the header."""
    h = now.astimezone(tz).hour
    if h < 10:
        return "morning"
    if h < 15:
        return "midday"
    return "evening"


# ── Announcement text (matches the JS template closely) ────────────────
def build_banner(start_local: datetime, is_all_day: bool, now_local: datetime) -> str:
    today = now_local.date()
    diff = (start_local.date() - today).days
    if is_all_day:
        time_str = "ALL DAY"
    else:
        time_str = start_local.strftime("%I:%M%p").lstrip("0")
        time_str = time_str.replace(":00", "").upper()

    if diff == 0:
        prefix = "TONIGHT" if start_local.hour >= 16 else "TODAY"
    elif diff == 1:
        prefix = "TOMORROW"
    elif 1 < diff <= 7:
        prefix = start_local.strftime("%A").upper()
    else:
        prefix = start_local.strftime("%b %-d").upper() if os.name != "nt" else start_local.strftime("%b %#d").upper()

    return f"{prefix}, {time_str}"


def build_venue_line(title: str, location: str) -> Optional[str]:
    m = re.search(r"\s@\s(.+)$", title or "", flags=re.IGNORECASE)
    if m:
        return f"@ {m.group(1).strip()}!"
    if location:
        first_bit = location.split("\n")[0].split(",")[0].strip()
        if first_bit:
            return f"@ {first_bit}!"
    return None


def build_announcement_markdown(event: dict, tz: ZoneInfo, now: datetime, share_url: str) -> str:
    """Build a MarkdownV2 announcement string ready to send to Telegram."""
    start = parse_ev_start(event)
    if not start:
        return ""
    is_all_day = "dateTime" not in event.get("start", {})
    start_local = start.astimezone(tz)
    now_local = now.astimezone(tz)

    title = (event.get("summary") or "Seed the Word Event").strip()
    banner = build_banner(start_local, is_all_day, now_local)
    venue = build_venue_line(title, event.get("location") or "")
    location = (event.get("location") or "").replace("\n", " ").strip()
    description_plain = strip_html(event.get("description") or "")
    description_plain = smart_trim(description_plain, 800)

    # Assemble using MarkdownV2 for real bold + italic where it helps.
    lines: list[str] = []
    # Banner line — we bold the whole banner for emphasis
    lines.append(f"❕\\! *{mdv2_escape(banner)}* \\! ❕")
    lines.append(f"🌱 *Seed The Word\\!* 🌱")
    if venue:
        lines.append(mdv2_escape(venue))

    if location:
        lines.append("")
        lines.append("*Address:*")
        lines.append(f"📍{mdv2_escape(location)}")

    if description_plain:
        lines.append("")
        lines.append(f"🙏🏻🤍{mdv2_escape(description_plain)}")

    lines.append("")
    lines.append("We can't wait to see you there\\! ✨")
    # Telegram shows the URL preview when we pass link_preview=True, so
    # we leave the URL to ride along as the preview rather than as raw
    # text — keeps the post tidy.
    # (We still send disable_web_page_preview=False on the API call.)
    return "\n".join(lines)


def build_share_url(event: dict) -> str:
    ev_id = event.get("id") or ""
    return f"{SITE_BASE_URL}/news.html#event=" + quote(ev_id, safe="")


# ── Google Calendar API ────────────────────────────────────────────────
def fetch_events(time_min: datetime, time_max: datetime) -> list[dict]:
    if not GOOGLE_CAL_API_KEY:
        raise SystemExit("Missing GOOGLE_CAL_API_KEY; aborting.")
    params = {
        "key": GOOGLE_CAL_API_KEY,
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": "50",
    }
    url = (
        "https://www.googleapis.com/calendar/v3/calendars/"
        f"{quote(GOOGLE_CAL_ID, safe='')}/events?{urlencode(params)}"
    )
    req = Request(url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("items", [])


# ── Telegram API ───────────────────────────────────────────────────────
def send_telegram_message(
    chat_id: str | int,
    message_thread_id: Optional[int],
    text: str,
) -> dict:
    if DRY_RUN:
        log("[DRY_RUN] Would send to %s (thread %s):\n%s\n" % (chat_id, message_thread_id, text))
        return {"ok": True, "dry_run": True}
    if not TELEGRAM_BOT_TOKEN:
        raise SystemExit("Missing TELEGRAM_BOT_TOKEN; aborting.")
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": str(chat_id),
        "text": text,
        "parse_mode": "MarkdownV2",
        "disable_web_page_preview": False,
        "link_preview_options": {"is_disabled": False, "prefer_large_media": True},
    }
    if message_thread_id:
        payload["message_thread_id"] = int(message_thread_id)
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log(f"Telegram API error {e.code}: {err_body}")
        raise
    except URLError as e:
        log(f"Telegram URL error: {e.reason}")
        raise


# ── Main ───────────────────────────────────────────────────────────────
def main() -> int:
    cfg = load_json(BOT_CONFIG_PATH, None)
    if not cfg:
        log(f"Bot config missing at {BOT_CONFIG_PATH}; aborting.")
        return 1
    if cfg.get("enabled") is False:
        log("Bot disabled in config; exiting.")
        return 0

    tz_name = cfg.get("timezone", "America/Los_Angeles")
    tz = ZoneInfo(tz_name)
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(tz)
    weekday = now_local.strftime("%A")

    skip_days = [d.strip() for d in cfg.get("skipDaysOfWeek", [])]
    if weekday in skip_days:
        log(f"Today is {weekday}; in skip list, exiting.")
        return 0

    chat_id = cfg.get("chatId")
    if not chat_id:
        log("No chatId in bot config; exiting.")
        return 1
    thread_id = cfg.get("messageThreadId")
    lookahead = int(cfg.get("lookaheadDays", 1))

    # Window = now - 1h (for events that just started) through end of today+lookahead
    time_min = now - timedelta(hours=1)
    end_of_day = now_local.replace(hour=23, minute=59, second=59, microsecond=0)
    time_max = (end_of_day + timedelta(days=lookahead)).astimezone(timezone.utc)

    try:
        events = fetch_events(time_min, time_max)
    except Exception as exc:
        log(f"Failed to fetch calendar events: {exc}")
        return 1
    log(f"Fetched {len(events)} events")

    # Filter to today (in local tz) or live-right-now.
    # Tomorrow's events aren't posted until tomorrow's 7 AM run, so we
    # don't spam with "events 10+ hours from now".
    todays: list[dict] = []
    for ev in events:
        status = event_status(ev, now)
        if status == "past":
            continue
        start = parse_ev_start(ev)
        if not start:
            continue
        if start.astimezone(tz).date() != now_local.date() and status != "live":
            continue
        todays.append(ev)

    if not todays:
        log("No events today; nothing to announce.")
        return 0

    # Load dedup log
    dedup = load_json(LOG_PATH, {"updated": None, "events": {}})
    if "events" not in dedup:
        dedup["events"] = {}

    to_post: list[tuple[dict, str]] = []
    for ev in todays:
        ev_id = ev.get("id")
        if not ev_id:
            continue
        status = event_status(ev, now)
        prev = dedup["events"].get(ev_id, {}).get("status")
        if prev == status:
            continue  # already posted this status
        to_post.append((ev, status))

    if not to_post:
        log("Everything relevant has already been announced; nothing to post.")
        return 0

    slot = day_slot(tz, now)
    headers = cfg.get("header", {})
    header_line = headers.get(slot) or headers.get("morning") or "📅 Today"

    log(f"Posting {len(to_post)} event(s) with header: {header_line}")

    # Compose a single combined message so we don't flood the chat
    parts: list[str] = [f"*{mdv2_escape(header_line)}*"]
    for ev, status in to_post:
        announcement = build_announcement_markdown(ev, tz, now, build_share_url(ev))
        if status == "live":
            parts.append("🔴 *LIVE NOW*")
        parts.append(announcement)
        parts.append("—" * 12)
    # Drop the trailing divider
    if parts and parts[-1].startswith("—"):
        parts.pop()
    # Footer
    footer = cfg.get("footer")
    if footer:
        parts.append("")
        parts.append(f"_{mdv2_escape(footer)}_")

    text = "\n\n".join(p for p in parts if p)

    try:
        resp = send_telegram_message(chat_id, thread_id, text)
    except Exception as exc:
        log(f"Telegram send failed: {exc}")
        return 1

    if not resp.get("ok"):
        log(f"Telegram rejected the message: {resp}")
        return 1

    # Persist dedup state
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for ev, status in to_post:
        dedup["events"][ev.get("id")] = {
            "status": status,
            "title": (ev.get("summary") or "")[:120],
            "start": (ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date")),
            "lastPosted": ts,
        }
    # Garbage-collect old entries: anything whose start date is > 14 days ago
    cutoff = now - timedelta(days=14)
    stale = []
    for eid, info in dedup["events"].items():
        start_s = info.get("start")
        if not start_s:
            continue
        try:
            start_dt = datetime.fromisoformat(start_s.replace("Z", "+00:00")) \
                if "T" in start_s else datetime.fromisoformat(start_s + "T00:00:00+00:00")
            if start_dt < cutoff:
                stale.append(eid)
        except ValueError:
            pass
    for eid in stale:
        del dedup["events"][eid]
    dedup["updated"] = ts
    save_json(LOG_PATH, dedup)

    log("Announcement posted and dedup log updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
