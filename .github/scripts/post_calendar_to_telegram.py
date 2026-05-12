"""
Post Google Calendar events to our Telegram announcements chat.

Schedule (wired up in .github/workflows/telegram-announcements.yml):
  Every 15 minutes. Each run is idempotent — the dedup log prevents
  re-posting anything that has already fired for a given trigger kind.

Why so often: GitHub's free-tier scheduled actions can be delayed or
silently skipped. A post that missed its slot used to wait until the
next fixed-hour tick; with a 15-minute cadence, any single late or
dropped tick is caught by the next one within 15 minutes. A brand-new
event added to the calendar mid-day is picked up on the next tick.

Anti-spam logic (redundancy without duplication):
  * Three trigger kinds per event: 'upcoming' (first time seen),
    'reminder' (≤ reminderMinutesBefore of start), 'live' (start has
    passed, end has not).
  * The dedup log assets/data/telegram-announcement-log.json tracks
    which triggers have fired for each event. A trigger fires at most
    once per event. That means an event can yield up to three posts
    across its lifetime.
  * Every run re-evaluates every non-past event against the three
    triggers. If a previous tick missed its window (e.g. a 5-PM cron
    was delayed past the reminder window), the next tick still posts
    the reminder — as long as the reminder window hasn't fully passed.
  * Quiet-hours guard: non-LIVE posts only fire between
    quietHoursStart and quietHoursEnd (default 7 AM – 9 PM local).
    LIVE events bypass the guard because events don't typically run
    at 3 AM.
  * skipDaysOfWeek still works (default: Sunday for upcoming/reminder;
    LIVE events bypass since they're in-progress).

Env vars:
  TELEGRAM_BOT_TOKEN   — bot token (GitHub Secret); only secret required
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
# We read the calendar's public iCal feed so no auth/API key is needed.
# This sidesteps Google's HTTP-referrer restrictions that apply to the
# frontend's embedded API key (which would 403 from a server).
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


# ── Image extraction from event description ───────────────────────────
# Google Calendar iCal does not expose attachment metadata, but admins
# can paste image URLs into the event description (or via the Calendar
# UI's rich-text editor). We scan for http(s) URLs that look like
# images and return them in document order. If multiple are found we
# send them as a Telegram album.
# Google Drive share links (/file/d/<id>/view) are auto-rewritten to
# the direct-view endpoint, which serves raw image bytes that
# Telegram can fetch.
IMAGE_URL_RE = re.compile(
    r"https?://[^\s\"'<>]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s\"'<>]*)?",
    re.IGNORECASE,
)
# <img src="..."> in sanitized HTML (Google Calendar HTML descriptions).
IMG_TAG_RE = re.compile(
    r'<img\b[^>]*?\bsrc\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
# Google Drive share links — multiple canonical shapes:
#   drive.google.com/file/d/<ID>/view         (with optional ?usp=sharing)
#   docs.google.com/file/d/<ID>/view
#   drive.google.com/open?id=<ID>
DRIVE_FILE_RE = re.compile(
    r"https?://(?:drive|docs)\.google\.com/file/d/([A-Za-z0-9_-]+)(?:/[^\s\"'<>]*)?",
    re.IGNORECASE,
)
DRIVE_OPEN_RE = re.compile(
    r"https?://drive\.google\.com/open\?[^\s\"'<>]*?id=([A-Za-z0-9_-]+)[^\s\"'<>]*",
    re.IGNORECASE,
)


def _drive_file_to_direct_url(file_id: str) -> str:
    """Convert a Drive file ID to a URL Telegram can fetch as an image.

    Uses lh3.googleusercontent.com (the same host Google serves Drive
    previews from) instead of the unreliable drive.google.com/uc
    endpoint — /uc has been serving HTML interstitials for years even
    on public files, and Telegram's sendPhoto rejects non-image bytes.
    =w2000 caps the preview width at 2000px so albums of large photos
    don't exceed Telegram's per-photo size limit."""
    return "https://lh3.googleusercontent.com/d/" + file_id + "=w2000"


def extract_image_urls(html_or_text: str) -> list[str]:
    if not html_or_text:
        return []
    seen: set[str] = set()
    urls: list[str] = []

    def add(u: str) -> None:
        if not u or u in seen:
            return
        seen.add(u)
        urls.append(u)

    # Prefer <img src="..."> matches since those are intentional images.
    for m in IMG_TAG_RE.finditer(html_or_text):
        u = m.group(1).strip()
        if u.startswith("http"):
            add(u)
    # Google Drive /file/d/<ID>/...
    for m in DRIVE_FILE_RE.finditer(html_or_text):
        add(_drive_file_to_direct_url(m.group(1)))
    # Google Drive /open?id=<ID>
    for m in DRIVE_OPEN_RE.finditer(html_or_text):
        add(_drive_file_to_direct_url(m.group(1)))
    # Then loose URL matches ending in an image extension.
    for m in IMAGE_URL_RE.finditer(html_or_text):
        u = m.group(0).strip().rstrip(").,;")
        add(u)
    # Telegram's sendMediaGroup accepts 2–10 items per album; sendPhoto
    # handles 1. Cap at 10 to stay within the API limit.
    return urls[:10]


def strip_image_urls(text: str, urls: list[str]) -> str:
    """Remove the image URLs (and their original Drive share-link
    source) from the caption so they don't appear as literal text."""
    out = text or ""
    for u in urls:
        out = out.replace(u, "")
    # Also strip the Drive share-link variants admins actually paste
    # (the /file/d/ID/view and /open?id= forms) since those are the
    # sources we rewrote to the direct URLs above.
    out = DRIVE_FILE_RE.sub("", out)
    out = DRIVE_OPEN_RE.sub("", out)
    # Clean up any empty lines or trailing whitespace left behind.
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = re.sub(r"[ \t]+\n", "\n", out)
    return out.strip()


def url_is_public_image(url: str) -> tuple[bool, str]:
    """Best-effort check that a URL actually serves image bytes (and
    not a sign-in HTML page). Returns (ok, reason). Used to pre-flight
    image URLs before handing them to Telegram; if we get back an
    HTML login / interstitial page instead of bytes, Telegram's
    sendPhoto will reject the post outright, so we'd rather know now
    and fall back to a text-only post than lose the announcement.

    Uses a ranged GET request (first 1KB) instead of HEAD because
    lh3.googleusercontent.com — our target host for Drive images —
    returns 405 Method Not Allowed on HEAD requests. The Range header
    keeps the transfer cheap.
    """
    try:
        req = Request(url, headers={
            "User-Agent": "seedtheword-bot/1.0",
            "Accept": "image/*,*/*;q=0.8",
            "Range": "bytes=0-1023",
        })
        with urlopen(req, timeout=15) as resp:
            ct = (resp.headers.get("Content-Type") or "").lower()
            if ct.startswith("image/"):
                return True, "ok"
            # Drive's login/interstitial page is text/html. Return the
            # content-type so the caller can explain in logs.
            return False, f"content-type={ct or 'unknown'}"
    except HTTPError as e:
        return False, f"http {e.code}"
    except URLError as e:
        return False, f"url error: {e.reason}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


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


def build_announcement_markdown(
    event: dict,
    tz: ZoneInfo,
    now: datetime,
    share_url: str,
    image_urls: Optional[list[str]] = None,
    max_description_chars: int = 800,
) -> str:
    """Build a MarkdownV2 announcement string ready to send to Telegram.

    When the post will be sent as a photo/album, caller passes
    max_description_chars=600 or so (Telegram caption limit is 1024
    total characters including formatting + banner + venue) and the
    image URLs so they can be stripped from the description.
    """
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
    if image_urls:
        description_plain = strip_image_urls(description_plain, image_urls)
    description_plain = smart_trim(description_plain, max_description_chars)

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


# ── Google Calendar iCal fetcher ───────────────────────────────────────
def _ics_unfold(lines: list[str]) -> list[str]:
    """Join continuation lines (lines starting with a space/tab belong
    to the previous line per RFC 5545)."""
    out: list[str] = []
    for ln in lines:
        if ln.startswith((" ", "\t")) and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _ics_unescape(val: str) -> str:
    # Unescape in the order the spec specifies
    return (val
            .replace("\\N", "\n")
            .replace("\\n", "\n")
            .replace("\\,", ",")
            .replace("\\;", ";")
            .replace("\\\\", "\\"))


def _parse_ics_datetime(props: dict, raw_val: str) -> tuple[str, str]:
    """Returns (field_name, iso_value) where field_name is 'dateTime'
    or 'date' (matching the Google API v3 shape the rest of the code
    expects)."""
    val = raw_val.strip()
    if "T" not in val:
        # All-day date: 20260525
        y, m, d = val[:4], val[4:6], val[6:8]
        return ("date", f"{y}-{m}-{d}")
    # Date-time value: 20260525T190000Z or 20260525T190000 (local/TZID)
    if val.endswith("Z"):
        y, m, d = val[:4], val[4:6], val[6:8]
        hh, mm, ss = val[9:11], val[11:13], val[13:15]
        return ("dateTime", f"{y}-{m}-{d}T{hh}:{mm}:{ss}+00:00")
    # TZID-qualified or floating; treat as UTC best-effort, the frontend
    # tolerates it and event bodies rarely floating-time events
    y, m, d = val[:4], val[4:6], val[6:8]
    hh, mm, ss = val[9:11], val[11:13], val[13:15]
    tzid = props.get("TZID")
    if tzid:
        try:
            tz = ZoneInfo(tzid)
            local_dt = datetime(int(y), int(m), int(d), int(hh), int(mm), int(ss), tzinfo=tz)
            return ("dateTime", local_dt.astimezone(timezone.utc).isoformat())
        except Exception:
            pass
    # Fallback: treat as UTC
    return ("dateTime", f"{y}-{m}-{d}T{hh}:{mm}:{ss}+00:00")


def _parse_vevent_block(lines: list[str]) -> dict:
    """Turn a VEVENT block into an object shaped like Google API v3 events."""
    ev: dict = {"start": {}, "end": {}}
    for ln in lines:
        if ":" not in ln:
            continue
        name_raw, value = ln.split(":", 1)
        # name_raw may include parameters: DTSTART;TZID=America/Los_Angeles
        parts = name_raw.split(";")
        name = parts[0].upper()
        props = {}
        for p in parts[1:]:
            if "=" in p:
                k, v = p.split("=", 1)
                props[k.upper()] = v

        if name == "UID":
            ev["id"] = value.strip()
        elif name == "SUMMARY":
            ev["summary"] = _ics_unescape(value.strip())
        elif name == "DESCRIPTION":
            ev["description"] = _ics_unescape(value.strip())
        elif name == "LOCATION":
            ev["location"] = _ics_unescape(value.strip())
        elif name == "DTSTART":
            field, iso = _parse_ics_datetime(props, value)
            ev["start"][field] = iso
        elif name == "DTEND":
            field, iso = _parse_ics_datetime(props, value)
            ev["end"][field] = iso
    return ev


def fetch_events(time_min: datetime, time_max: datetime) -> list[dict]:
    """Fetch events from the calendar's public iCal feed. No API key
    required; Google publishes /public/basic.ics for any calendar that
    is set to 'Make available to public'."""
    ics_url = (
        "https://calendar.google.com/calendar/ical/"
        f"{quote(GOOGLE_CAL_ID, safe='')}/public/basic.ics"
    )
    req = Request(ics_url, headers={"Accept": "text/calendar", "User-Agent": "seedtheword-bot/1.0"})
    with urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    lines = _ics_unfold(raw.replace("\r\n", "\n").split("\n"))
    events: list[dict] = []
    in_event = False
    current: list[str] = []
    for ln in lines:
        if ln.strip() == "BEGIN:VEVENT":
            in_event = True
            current = []
            continue
        if ln.strip() == "END:VEVENT":
            in_event = False
            try:
                ev = _parse_vevent_block(current)
                if ev.get("start"):
                    events.append(ev)
            except Exception as err:
                log(f"Skipping unparseable VEVENT: {err}")
            continue
        if in_event:
            current.append(ln)

    # Narrow to the requested window; iCal feeds return everything.
    def _in_window(ev: dict) -> bool:
        start = parse_ev_start(ev)
        end = parse_ev_end(ev) or start
        if not start:
            return False
        # Keep anything whose window overlaps [time_min, time_max]
        return (end or start) >= time_min and start <= time_max

    filtered = [e for e in events if _in_window(e)]
    filtered.sort(key=lambda e: parse_ev_start(e) or datetime.max.replace(tzinfo=timezone.utc))
    return filtered


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


def send_telegram_photo(
    chat_id: str | int,
    message_thread_id: Optional[int],
    photo_url: str,
    caption: str,
) -> dict:
    """Send a single photo via URL. Telegram downloads the image itself."""
    if DRY_RUN:
        log("[DRY_RUN] Would sendPhoto to %s (thread %s): %s\ncaption:\n%s\n" % (
            chat_id, message_thread_id, photo_url, caption))
        return {"ok": True, "dry_run": True}
    if not TELEGRAM_BOT_TOKEN:
        raise SystemExit("Missing TELEGRAM_BOT_TOKEN; aborting.")
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    payload = {
        "chat_id": str(chat_id),
        "photo": photo_url,
        "caption": caption,
        "parse_mode": "MarkdownV2",
    }
    if message_thread_id:
        payload["message_thread_id"] = int(message_thread_id)
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log(f"Telegram sendPhoto error {e.code}: {err_body}")
        raise
    except URLError as e:
        log(f"Telegram sendPhoto URL error: {e.reason}")
        raise


def send_telegram_media_group(
    chat_id: str | int,
    message_thread_id: Optional[int],
    photo_urls: list[str],
    caption: str,
) -> dict:
    """Send 2–10 photos as an album. Only the first item carries the
    caption (Telegram API convention)."""
    if DRY_RUN:
        log("[DRY_RUN] Would sendMediaGroup to %s (thread %s): %s\ncaption:\n%s\n" % (
            chat_id, message_thread_id, photo_urls, caption))
        return {"ok": True, "dry_run": True}
    if not TELEGRAM_BOT_TOKEN:
        raise SystemExit("Missing TELEGRAM_BOT_TOKEN; aborting.")
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMediaGroup"
    media: list[dict] = []
    for i, u in enumerate(photo_urls[:10]):
        item = {"type": "photo", "media": u}
        if i == 0:
            item["caption"] = caption
            item["parse_mode"] = "MarkdownV2"
        media.append(item)
    payload = {
        "chat_id": str(chat_id),
        "media": media,
    }
    if message_thread_id:
        payload["message_thread_id"] = int(message_thread_id)
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log(f"Telegram sendMediaGroup error {e.code}: {err_body}")
        raise
    except URLError as e:
        log(f"Telegram sendMediaGroup URL error: {e.reason}")
        raise


# ── Main ───────────────────────────────────────────────────────────────
def main() -> int:
    full_cfg = load_json(BOT_CONFIG_PATH, None)
    if not full_cfg:
        log(f"Bot config missing at {BOT_CONFIG_PATH}; aborting.")
        return 1
    # Accept both the new nested shape (cfg["announcements"]) and the
    # legacy flat shape.
    cfg = full_cfg.get("announcements") if isinstance(full_cfg.get("announcements"), dict) else full_cfg
    if cfg.get("enabled") is False:
        log("Bot disabled in config; exiting.")
        return 0

    tz_name = cfg.get("timezone", "America/Los_Angeles")
    tz = ZoneInfo(tz_name)
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(tz)
    weekday = now_local.strftime("%A")

    chat_id = cfg.get("chatId")
    if not chat_id:
        log("No chatId in bot config; exiting.")
        return 1
    thread_id = cfg.get("messageThreadId")
    lookahead = int(cfg.get("lookaheadDays", 1))
    reminder_minutes = int(cfg.get("reminderMinutesBefore", 180))

    # Quiet-hours guard applies to non-LIVE posts only. Defaults to 7 AM –
    # 9 PM local. LIVE events bypass (an event started 3 minutes ago is
    # newsworthy regardless of what time "now" is).
    quiet_start = int(cfg.get("quietHoursStart", 7))
    quiet_end = int(cfg.get("quietHoursEnd", 21))
    in_quiet_hours = not (quiet_start <= now_local.hour < quiet_end)

    skip_days = [d.strip() for d in cfg.get("skipDaysOfWeek", [])]
    day_skipped = weekday in skip_days

    # Pull a wider time window than before so a single delayed run can
    # catch up: events starting anywhere in the next `lookahead` days,
    # plus anything that's live right now.
    time_min = now - timedelta(hours=6)
    end_of_lookahead = now_local.replace(hour=23, minute=59, second=59, microsecond=0)
    time_max = (end_of_lookahead + timedelta(days=lookahead)).astimezone(timezone.utc)

    try:
        events = fetch_events(time_min, time_max)
    except Exception as exc:
        log(f"Failed to fetch calendar events: {exc}")
        return 1
    log(f"Fetched {len(events)} events")

    # Filter to events still in scope: everything currently live, plus
    # anything starting today (local) or within the reminder_minutes
    # window. This is broader than "today's events only" because an
    # event created this morning with a start tomorrow at 8 AM should
    # first-time-announce as upcoming on today's runs.
    in_scope: list[dict] = []
    for ev in events:
        status = event_status(ev, now)
        if status == "past":
            continue
        start = parse_ev_start(ev)
        if not start:
            continue
        # Keep anything scheduled within the next `lookahead` days or
        # currently live.
        if status == "live":
            in_scope.append(ev)
            continue
        start_local = start.astimezone(tz)
        days_until = (start_local.date() - now_local.date()).days
        if days_until <= lookahead:
            in_scope.append(ev)

    if not in_scope:
        log("No in-scope events; nothing to announce.")
        return 0

    # Load dedup log
    dedup = load_json(LOG_PATH, {"updated": None, "events": {}})
    if "events" not in dedup:
        dedup["events"] = {}

    # Select events needing a post this tick.
    # Each event can fire three separate kinds in its lifetime:
    #   - upcoming: first-time we see it, queue it
    #   - reminder: within reminder_minutes of start, and that
    #               reminder hasn't been posted yet
    #   - live: start has passed, end has not, and that live post
    #           hasn't been sent yet
    to_post: list[tuple[dict, str]] = []
    for ev in in_scope:
        ev_id = ev.get("id")
        if not ev_id:
            continue
        entry = dedup["events"].get(ev_id, {})
        # Migrate legacy status field if present
        legacy_status = entry.get("status")
        if legacy_status == "upcoming":
            entry.setdefault("upcomingPosted", True)
        elif legacy_status == "live":
            entry.setdefault("upcomingPosted", True)
            entry.setdefault("livePosted", True)
        current = event_status(ev, now)
        start = parse_ev_start(ev)

        # LIVE: post once, the moment we first see it as live, even
        # outside quiet hours and skip-days (the ministry has started,
        # members want to know).
        if current == "live" and not entry.get("livePosted"):
            to_post.append((ev, "live"))
            continue

        # Upcoming & reminder are gated by quiet hours + skip days.
        if in_quiet_hours:
            continue
        if day_skipped:
            continue

        # Reminder: prefer it over "upcoming" when both would fire on the
        # same tick (reminder has more urgency and the explicit timing).
        if current == "upcoming" and not entry.get("reminderPosted") and start:
            mins_to_start = (start - now).total_seconds() / 60.0
            if 0 <= mins_to_start <= reminder_minutes:
                to_post.append((ev, "reminder"))
                continue

        # First-time upcoming post.
        if current == "upcoming" and not entry.get("upcomingPosted"):
            to_post.append((ev, "upcoming"))

    if not to_post:
        log("Everything relevant has already been announced; nothing to post.")
        return 0

    # Pick header based on the dominant kind in this batch. If ANY post
    # is live, the batch header is "live"; else if ANY is a reminder,
    # it's "reminder"; else it's the time-of-day slot (morning/midday/
    # evening) as before.
    kinds = {kind for _, kind in to_post}
    headers_cfg = cfg.get("header", {})
    if "live" in kinds:
        header_line = headers_cfg.get("evening") or "🔴 Live now at Seed the Word"
    elif "reminder" in kinds:
        header_line = headers_cfg.get("reminder") or "⏰ Starting soon"
    else:
        slot = day_slot(tz, now)
        header_line = headers_cfg.get(slot) or headers_cfg.get("morning") or "📅 Today"

    log(f"Posting {len(to_post)} event(s) with header: {header_line}")

    # Split posts into photo-bearing (sent individually with their
    # image(s)) vs text-only (batched into one combined message).
    # Photos take the caption limit of 1024 chars so their description
    # is trimmed harder.
    photo_posts: list[tuple[dict, str, list[str]]] = []
    text_posts: list[tuple[dict, str]] = []
    for ev, kind in to_post:
        urls = extract_image_urls(ev.get("description") or "")
        if urls:
            photo_posts.append((ev, kind, urls))
        else:
            text_posts.append((ev, kind))

    # Pre-flight each image URL before any sends go out. If a URL
    # doesn't serve image bytes (typical cause: Drive file not shared
    # publicly), drop it from the event's URL list. If no URLs remain
    # for an event, demote it to the text-only batch so the
    # announcement still fires as plain text. This is what keeps a
    # missing / private image from silently killing an announcement.
    degraded_photo_posts: list[tuple[dict, str, list[str]]] = []
    for ev, kind, urls in photo_posts:
        good_urls: list[str] = []
        for u in urls:
            ok, reason = url_is_public_image(u)
            if ok:
                good_urls.append(u)
            else:
                log(f"Image URL not usable for event {ev.get('id')}: {u} — {reason}")
        if good_urls:
            degraded_photo_posts.append((ev, kind, good_urls))
        else:
            text_posts.append((ev, kind))
            log(f"Event {ev.get('id')} has no reachable images; falling back to text-only.")
    photo_posts = degraded_photo_posts

    send_errors = 0

    # ── Text-only batch (unchanged behavior) ────────────────────────
    if text_posts:
        parts: list[str] = [f"*{mdv2_escape(header_line)}*"]
        for ev, kind in text_posts:
            announcement = build_announcement_markdown(ev, tz, now, build_share_url(ev))
            if kind == "live":
                parts.append("🔴 *LIVE NOW*")
            elif kind == "reminder":
                parts.append("⏰ *Starting in \\~" + str(int(reminder_minutes // 60)) + " hours*" if reminder_minutes >= 120 else "⏰ *Starting soon*")
            parts.append(announcement)
            parts.append("—" * 12)
        if parts and parts[-1].startswith("—"):
            parts.pop()
        footer = cfg.get("footer")
        if footer:
            parts.append("")
            parts.append(f"_{mdv2_escape(footer)}_")
        text = "\n\n".join(p for p in parts if p)
        try:
            resp = send_telegram_message(chat_id, thread_id, text)
            if not resp.get("ok"):
                log(f"Telegram rejected the text batch: {resp}")
                send_errors += 1
        except Exception as exc:
            log(f"Telegram text batch send failed: {exc}")
            send_errors += 1

    # ── Photo posts (per event; one or an album per event) ──────────
    for ev, kind, urls in photo_posts:
        # Caption budget: Telegram caps photo/media-group captions at
        # 1024 characters total including formatting. Reserve ~100
        # chars for banner + venue + header tag + emoji, leaving ~600
        # for the description itself. smart_trim handles the ellipsis.
        announcement = build_announcement_markdown(
            ev, tz, now, build_share_url(ev),
            image_urls=urls,
            max_description_chars=600,
        )
        tag = ""
        if kind == "live":
            tag = "🔴 *LIVE NOW*\n\n"
        elif kind == "reminder":
            if reminder_minutes >= 120:
                tag = "⏰ *Starting in \\~" + str(int(reminder_minutes // 60)) + " hours*\n\n"
            else:
                tag = "⏰ *Starting soon*\n\n"
        caption = f"*{mdv2_escape(header_line)}*\n\n{tag}{announcement}"
        # Telegram hard caps at 1024; trim the whole caption as a final
        # safety net (multi-byte emoji may make the MarkdownV2 wrapper
        # push us over). Leave 20 chars of slack.
        if len(caption) > 1000:
            caption = caption[:997] + "..."
        try:
            if len(urls) == 1:
                resp = send_telegram_photo(chat_id, thread_id, urls[0], caption)
            else:
                resp = send_telegram_media_group(chat_id, thread_id, urls, caption)
            if not resp.get("ok"):
                log(f"Telegram rejected photo post for {ev.get('id')}: {resp}")
                send_errors += 1
        except Exception as exc:
            log(f"Telegram photo send failed for {ev.get('id')}: {exc}")
            send_errors += 1
        # Light throttling between photo posts so Telegram's 30/min
        # channel limit doesn't throttle us during a catch-up tick.
        time.sleep(0.6)

    if send_errors and send_errors == (len(text_posts and [1] or []) + len(photo_posts)):
        # Every attempted send failed — don't update dedup, let the
        # next tick retry.
        log("All sends failed; leaving dedup log unchanged so the next tick retries.")
        return 1

    # Persist dedup state
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for ev, kind in to_post:
        ev_id = ev.get("id")
        entry = dedup["events"].setdefault(ev_id, {})
        # Drop legacy status field if migrated
        entry.pop("status", None)
        entry["title"] = (ev.get("summary") or "")[:120]
        entry["start"] = (ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date"))
        entry["lastPosted"] = ts
        if kind == "upcoming":
            entry["upcomingPosted"] = True
        elif kind == "reminder":
            entry["reminderPosted"] = True
        elif kind == "live":
            entry["livePosted"] = True
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
