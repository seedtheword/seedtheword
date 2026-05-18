"""
Saturday weekly digest — emails subscribers a recap of the past week.

Schedule: Saturday 08:00 Pacific (wired in
.github/workflows/weekly-digest.yml). Reads:
  - Subscribers list from the Apps Script web app
    (?action=subscribers — see docs/apps-script/order-handler.gs).
  - Calendar events from the public iCal feed (same path the
    announcement bot uses) — pulls last 7 days + next 7 days.
  - Testimonies from assets/data/testimonies.json — anything with
    `published: true` whose `publishedAt` falls in the past 7 days.
  - Ministry outreach from assets/data/ministry-outreach.json —
    anything whose `eventDate` falls in the past 7 days.

Then composes a single HTML+plaintext email and sends one copy per
active subscriber via the Apps Script web app's existing MailApp
plumbing (the runner doesn't have direct send permissions).

Auth model: NONE — the subscribers endpoint is read-only-public, and
the email send goes through the Apps Script web app whose URL is
already a configured secret. We pass a per-message payload; the
script's MailApp call handles delivery.

Idempotency: the dedup log at assets/data/digest-log.json tracks
the last-fire timestamp. If the workflow is run again on the same
Saturday (e.g. manual re-run), the script noops unless DRY_RUN is
set or `?force=1` is passed via workflow_dispatch.

Env vars:
  APPS_SCRIPT_URL          — required; same URL secret the order
                              pipeline uses
  GOOGLE_CAL_ID            — calendar id (defaults to the ministry's)
  SITE_BASE_URL            — for deep links in the email
  DRY_RUN                  — if set, log what would be sent without
                              calling Apps Script
  FORCE                    — if set, re-fire even when the dedup log
                              shows a digest already went out today

Exit 0 means the run completed even when no digest was sent (e.g.
no subscribers, no week-relevant content).
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo


REPO_ROOT = Path(__file__).resolve().parents[2]
LOG_PATH = Path(os.environ.get(
    "DIGEST_LOG_PATH", REPO_ROOT / "assets/data/digest-log.json"
))
TESTIMONIES_PATH = REPO_ROOT / "assets/data/testimonies.json"
MINISTRY_OUTREACH_PATH = REPO_ROOT / "assets/data/ministry-outreach.json"
SITE_BASE_URL = os.environ.get(
    "SITE_BASE_URL", "https://seedtheword.github.io/seedtheword"
).rstrip("/")
APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "").strip()
GOOGLE_CAL_ID = os.environ.get(
    "GOOGLE_CAL_ID", "seedthewordministry@gmail.com"
).strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())
FORCE = bool(os.environ.get("FORCE", "").strip())
TZ = ZoneInfo("America/Los_Angeles")


def log(msg: str) -> None:
    print(msg, flush=True)


# ── HTTP helpers ──────────────────────────────────────────────────────
def http_json_get(url: str, timeout: int = 30) -> Any:
    req = Request(url, headers={
        "User-Agent": "seedtheword-digest/1.0",
        "Accept": "application/json",
    })
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def http_post_json(url: str, payload: dict, timeout: int = 30) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ── HTML helpers ──────────────────────────────────────────────────────
ENTITY_MAP = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&hellip;": "…",
    "&mdash;": "—", "&ndash;": "–",
}


def strip_html(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", "", s)
    for k, v in ENTITY_MAP.items():
        s = s.replace(k, v)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def html_escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def smart_trim(text: str, max_chars: int) -> str:
    if not text or len(text) <= max_chars:
        return text or ""
    soft = re.sub(r"\s+\S*$", "", text[:max_chars])
    base = soft if len(soft) > int(max_chars * 0.7) else text[:max_chars]
    return base.rstrip(",;:.-–— \n\t") + "…"


# ── Calendar (iCal feed, same path as the announcement bot) ───────────
def _ics_unfold(lines: list[str]) -> list[str]:
    out: list[str] = []
    for ln in lines:
        if ln.startswith((" ", "\t")) and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _ics_unescape(val: str) -> str:
    return (val
            .replace("\\N", "\n")
            .replace("\\n", "\n")
            .replace("\\,", ",")
            .replace("\\;", ";")
            .replace("\\\\", "\\"))


def _parse_ics_dt(props: dict, raw: str) -> tuple[str, str]:
    val = raw.strip()
    if "T" not in val:
        return ("date", f"{val[:4]}-{val[4:6]}-{val[6:8]}")
    if val.endswith("Z"):
        return ("dateTime", f"{val[:4]}-{val[4:6]}-{val[6:8]}T{val[9:11]}:{val[11:13]}:{val[13:15]}+00:00")
    tzid = props.get("TZID")
    y, m, d = val[:4], val[4:6], val[6:8]
    hh, mm, ss = val[9:11], val[11:13], val[13:15]
    if tzid:
        try:
            dt = datetime(int(y), int(m), int(d), int(hh), int(mm), int(ss), tzinfo=ZoneInfo(tzid))
            return ("dateTime", dt.astimezone(timezone.utc).isoformat())
        except Exception:
            pass
    return ("dateTime", f"{y}-{m}-{d}T{hh}:{mm}:{ss}+00:00")


def fetch_calendar_events() -> list[dict]:
    url = (
        "https://calendar.google.com/calendar/ical/"
        f"{quote(GOOGLE_CAL_ID, safe='')}/public/basic.ics"
    )
    req = Request(url, headers={"Accept": "text/calendar", "User-Agent": "seedtheword-digest/1.0"})
    with urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", "replace")

    lines = _ics_unfold(raw.replace("\r\n", "\n").split("\n"))
    events: list[dict] = []
    in_event = False
    cur: list[str] = []
    for ln in lines:
        if ln.strip() == "BEGIN:VEVENT":
            in_event = True
            cur = []
            continue
        if ln.strip() == "END:VEVENT":
            in_event = False
            ev: dict = {"start": {}, "end": {}}
            for ev_ln in cur:
                if ":" not in ev_ln:
                    continue
                name_raw, value = ev_ln.split(":", 1)
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
                    field, iso = _parse_ics_dt(props, value)
                    ev["start"][field] = iso
                elif name == "DTEND":
                    field, iso = _parse_ics_dt(props, value)
                    ev["end"][field] = iso
            if ev.get("start"):
                events.append(ev)
            continue
        if in_event:
            cur.append(ln)
    return events


def parse_event_start_dt(ev: dict) -> Optional[datetime]:
    s = ev.get("start", {})
    if "dateTime" in s:
        return datetime.fromisoformat(s["dateTime"].replace("Z", "+00:00"))
    if "date" in s:
        return datetime.fromisoformat(s["date"] + "T00:00:00+00:00")
    return None


# ── Aggregation ───────────────────────────────────────────────────────
def collect_week_content(now: datetime) -> dict:
    """Return a dict shaped {events_past, events_upcoming, testimonies,
    outreach} containing only items relevant to the past 7 days
    (looking backward) and next 7 days (looking forward)."""
    week_ago = now - timedelta(days=7)
    week_ahead = now + timedelta(days=7)

    # Calendar — events that fall inside the rolling two-week window.
    events_past: list[dict] = []
    events_upcoming: list[dict] = []
    try:
        for ev in fetch_calendar_events():
            start = parse_event_start_dt(ev)
            if not start:
                continue
            if week_ago <= start <= now:
                events_past.append(ev)
            elif now < start <= week_ahead:
                events_upcoming.append(ev)
        events_past.sort(key=lambda e: parse_event_start_dt(e) or now)
        events_upcoming.sort(key=lambda e: parse_event_start_dt(e) or now)
    except Exception as exc:
        log(f"Calendar fetch failed (non-fatal): {exc}")

    # Testimonies — anything published in the past 7 days.
    testimonies: list[dict] = []
    tdata = load_json(TESTIMONIES_PATH, {"testimonies": []})
    for t in tdata.get("testimonies") or []:
        if t.get("published") is not True:
            continue
        pub = (t.get("publishedAt") or "").strip()
        if not pub:
            continue
        try:
            pub_dt = datetime.fromisoformat(pub + "T00:00:00+00:00")
        except (ValueError, TypeError):
            continue
        if pub_dt >= week_ago:
            testimonies.append(t)
    testimonies.sort(key=lambda x: x.get("publishedAt") or "", reverse=True)

    # Ministry outreach — events whose date falls in the past 7 days.
    outreach: list[dict] = []
    odata = load_json(MINISTRY_OUTREACH_PATH, {"events": []})
    for o in odata.get("events") or []:
        date_str = (o.get("eventDate") or o.get("date") or "").strip()
        if not date_str:
            continue
        try:
            o_dt = datetime.fromisoformat(date_str + "T00:00:00+00:00")
        except (ValueError, TypeError):
            continue
        if week_ago <= o_dt <= now:
            outreach.append(o)
    outreach.sort(key=lambda x: x.get("eventDate") or x.get("date") or "", reverse=True)

    return {
        "events_past": events_past,
        "events_upcoming": events_upcoming,
        "testimonies": testimonies,
        "outreach": outreach,
    }


# ── Digest body builders ──────────────────────────────────────────────
def _fmt_event_date(ev: dict) -> str:
    start = parse_event_start_dt(ev)
    if not start:
        return ""
    local = start.astimezone(TZ)
    is_all_day = "date" in ev.get("start", {}) and "dateTime" not in ev.get("start", {})
    if is_all_day:
        return local.strftime("%A, %b ") + (local.strftime("%-d") if os.name != "nt" else local.strftime("%#d"))
    time_str = local.strftime("%I:%M%p").lstrip("0").replace(":00", "").lower()
    return local.strftime("%A, %b ") + (local.strftime("%-d") if os.name != "nt" else local.strftime("%#d")) + f" at {time_str}"


def build_digest_html(content: dict, recipient_name: str, now_local: datetime) -> str:
    week_label = now_local.strftime("Week of %B ") + (now_local.strftime("%-d, %Y") if os.name != "nt" else now_local.strftime("%#d, %Y"))
    greeting = f"Dear {html_escape(recipient_name) if recipient_name else 'friend'},"

    past_events_html = ""
    if content["events_past"]:
        rows = []
        for ev in content["events_past"]:
            title = html_escape((ev.get("summary") or "Event").strip())
            when = html_escape(_fmt_event_date(ev))
            location = html_escape((ev.get("location") or "").split("\n")[0].split(",")[0].strip())
            location_bit = f" at {location}" if location else ""
            rows.append(f"<li><strong>{title}</strong> &mdash; {when}{location_bit}</li>")
        past_events_html = (
            "<h3 style=\"font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;\">"
            "What happened this week</h3>"
            "<ul style=\"line-height: 1.7;\">" + "".join(rows) + "</ul>"
        )

    upcoming_events_html = ""
    if content["events_upcoming"]:
        rows = []
        for ev in content["events_upcoming"]:
            title = html_escape((ev.get("summary") or "Event").strip())
            when = html_escape(_fmt_event_date(ev))
            location = html_escape((ev.get("location") or "").split("\n")[0].split(",")[0].strip())
            location_bit = f" at {location}" if location else ""
            rows.append(f"<li><strong>{title}</strong> &mdash; {when}{location_bit}</li>")
        upcoming_events_html = (
            "<h3 style=\"font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;\">"
            "Coming up this week</h3>"
            "<ul style=\"line-height: 1.7;\">" + "".join(rows) + "</ul>"
        )

    testimonies_html = ""
    if content["testimonies"]:
        cards = []
        for t in content["testimonies"][:3]:
            name = "Anonymous" if t.get("anonymous") else (t.get("name") or "A friend").strip()
            excerpt = html_escape(smart_trim(t.get("excerpt") or t.get("body") or "", 280))
            verse = html_escape((t.get("anchorVerse") or "").strip())
            verse_bit = f"<br><span style=\"color: #888; font-style: italic;\">&mdash; {verse}</span>" if verse else ""
            cards.append(
                f"<blockquote style=\"border-left: 3px solid #d4a574; padding: 0.5rem 1rem; "
                f"margin: 1rem 0; color: #444; line-height: 1.7;\">"
                f"&ldquo;{excerpt}&rdquo;<br>"
                f"<strong style=\"color: #2C5F2E;\">&mdash; {html_escape(name)}</strong>"
                f"{verse_bit}</blockquote>"
            )
        testimonies_html = (
            "<h3 style=\"font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;\">"
            "Testimonies shared this week</h3>"
            + "".join(cards)
        )

    outreach_html = ""
    if content["outreach"]:
        rows = []
        for o in content["outreach"][:3]:
            title = html_escape((o.get("title") or "Outreach").strip())
            location = html_escape((o.get("location") or "").strip())
            summary = html_escape(smart_trim(o.get("summary") or o.get("description") or "", 200))
            location_bit = f" &middot; {location}" if location else ""
            rows.append(f"<li><strong>{title}</strong>{location_bit}<br>{summary}</li>")
        outreach_html = (
            "<h3 style=\"font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;\">"
            "From the field</h3>"
            "<ul style=\"line-height: 1.7;\">" + "".join(rows) + "</ul>"
        )

    body_html = past_events_html + upcoming_events_html + testimonies_html + outreach_html
    if not body_html:
        body_html = (
            "<p style=\"color: #555; line-height: 1.7;\">No new events, testimonies, or "
            "outreach to share this week — but the Lord is still at work in quieter "
            "ways. Keep watching for Him.</p>"
        )

    return f"""\
<!DOCTYPE html>
<html><body style="font-family: Arial, Helvetica, sans-serif; background: #fdf3e3;
    color: #1a1a1a; margin: 0; padding: 1rem;">
  <div style="max-width: 640px; margin: 0 auto; background: #ffffff;
       border-radius: 12px; overflow: hidden;
       box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
    <div style="background: linear-gradient(135deg, #2C5F2E, #3a7d3c);
         padding: 1.5rem 1.75rem; color: #fdf3e3;">
      <h1 style="margin: 0; font-family: Georgia, serif; font-size: 1.4rem;">
        Seed the Word &mdash; Weekly Digest
      </h1>
      <p style="margin: 0.25rem 0 0; opacity: 0.85;">{html_escape(week_label)}</p>
    </div>
    <div style="padding: 1.5rem 1.75rem;">
      <p style="line-height: 1.7;">{greeting}</p>
      <p style="line-height: 1.7;">Here's what the Lord has been doing through our
        ministry this week. Take a moment, brew some coffee, and read with us.</p>
      {body_html}
      <hr style="border: 0; border-top: 1px solid #e8e4de; margin: 2rem 0 1rem;">
      <p style="line-height: 1.7; color: #666; font-size: 0.92rem;">
        Find every story, the full calendar, and the rest of our community on the site:
        <a href="{SITE_BASE_URL}" style="color: #2C5F2E;">{html_escape(SITE_BASE_URL)}</a>
      </p>
      <p style="line-height: 1.7; color: #666; font-size: 0.85rem; font-style: italic;">
        Sincerely,<br>The Seed the Word team
      </p>
    </div>
  </div>
</body></html>"""


def build_digest_text(content: dict, recipient_name: str, now_local: datetime) -> str:
    week_label = now_local.strftime("Week of %B ") + (now_local.strftime("%-d, %Y") if os.name != "nt" else now_local.strftime("%#d, %Y"))
    greeting = f"Dear {recipient_name or 'friend'},"
    parts: list[str] = [
        f"Seed the Word — Weekly Digest",
        week_label,
        "",
        greeting,
        "",
        "Here's what the Lord has been doing through our ministry this week.",
        "",
    ]

    if content["events_past"]:
        parts.append("WHAT HAPPENED THIS WEEK")
        for ev in content["events_past"]:
            title = (ev.get("summary") or "Event").strip()
            when = _fmt_event_date(ev)
            parts.append(f"- {title} — {when}")
        parts.append("")

    if content["events_upcoming"]:
        parts.append("COMING UP THIS WEEK")
        for ev in content["events_upcoming"]:
            title = (ev.get("summary") or "Event").strip()
            when = _fmt_event_date(ev)
            parts.append(f"- {title} — {when}")
        parts.append("")

    if content["testimonies"]:
        parts.append("TESTIMONIES SHARED THIS WEEK")
        for t in content["testimonies"][:3]:
            name = "Anonymous" if t.get("anonymous") else (t.get("name") or "A friend").strip()
            excerpt = smart_trim(t.get("excerpt") or t.get("body") or "", 280)
            verse = (t.get("anchorVerse") or "").strip()
            parts.append(f'  "{excerpt}"')
            parts.append(f"  — {name}" + (f" ({verse})" if verse else ""))
            parts.append("")

    if content["outreach"]:
        parts.append("FROM THE FIELD")
        for o in content["outreach"][:3]:
            title = (o.get("title") or "Outreach").strip()
            location = (o.get("location") or "").strip()
            summary = smart_trim(o.get("summary") or o.get("description") or "", 200)
            parts.append(f"- {title}" + (f" ({location})" if location else ""))
            if summary:
                parts.append(f"  {summary}")
        parts.append("")

    if (not content["events_past"] and not content["events_upcoming"]
            and not content["testimonies"] and not content["outreach"]):
        parts.append("No new events, testimonies, or outreach to share this week —")
        parts.append("but the Lord is still at work in quieter ways. Keep watching for Him.")
        parts.append("")

    parts.append("---")
    parts.append(f"Find more on the site: {SITE_BASE_URL}")
    parts.append("")
    parts.append("Sincerely,")
    parts.append("The Seed the Word team")
    return "\n".join(parts)


# ── Main ──────────────────────────────────────────────────────────────
def fetch_subscribers() -> list[dict]:
    if not APPS_SCRIPT_URL:
        log("APPS_SCRIPT_URL is not set; cannot fetch subscribers.")
        return []
    url = APPS_SCRIPT_URL + ("&" if "?" in APPS_SCRIPT_URL else "?") + "action=subscribers"
    try:
        body = http_json_get(url)
    except (HTTPError, URLError) as exc:
        log(f"Subscribers fetch failed: {exc}")
        return []
    except Exception as exc:
        log(f"Subscribers fetch unexpected error: {exc}")
        return []
    if not (isinstance(body, dict) and body.get("ok") and isinstance(body.get("subscribers"), list)):
        log(f"Subscribers response unexpected shape: {body}")
        return []
    return body["subscribers"]


def send_digest_to(subscriber: dict, html: str, text: str, subject: str) -> bool:
    """POST to Apps Script's MailApp bridge. Best-effort — returns True
    on success, False on any error so the caller can keep going."""
    if DRY_RUN:
        log(f"[DRY_RUN] Would email {subscriber.get('email')} ({subscriber.get('name')}). "
            f"Body length: html={len(html)}, text={len(text)}")
        return True
    payload = {
        "type": "weekly-digest-email",
        "to": subscriber.get("email"),
        "subject": subject,
        "html": html,
        "text": text,
        "name": subscriber.get("name") or "",
    }
    try:
        body = http_post_json(APPS_SCRIPT_URL, payload)
        if body.get("ok"):
            return True
        log(f"Send rejected for {subscriber.get('email')}: {body}")
        return False
    except (HTTPError, URLError) as exc:
        log(f"Send failed for {subscriber.get('email')}: {exc}")
        return False
    except Exception as exc:
        log(f"Send unexpected error for {subscriber.get('email')}: {exc}")
        return False


def main() -> int:
    if not APPS_SCRIPT_URL and not DRY_RUN:
        log("APPS_SCRIPT_URL not set; aborting.")
        return 1

    now = datetime.now(timezone.utc)
    now_local = now.astimezone(TZ)
    today_str = now_local.strftime("%Y-%m-%d")

    # Idempotency — don't double-fire if the workflow runs twice on the
    # same day (e.g. manual re-run). FORCE bypasses for testing.
    dedup = load_json(LOG_PATH, {"lastFiredOn": None})
    if not FORCE and dedup.get("lastFiredOn") == today_str:
        log(f"Digest already fired today ({today_str}); set FORCE=1 to re-send. Exiting.")
        return 0

    subscribers = fetch_subscribers()
    log(f"Found {len(subscribers)} active subscriber(s)")
    if not subscribers and not DRY_RUN:
        log("No active subscribers; nothing to send. (Add rows to the Subscribers tab.)")
        return 0

    content = collect_week_content(now)
    log(
        "Week content: "
        f"{len(content['events_past'])} past events, "
        f"{len(content['events_upcoming'])} upcoming, "
        f"{len(content['testimonies'])} testimonies, "
        f"{len(content['outreach'])} outreach"
    )

    week_label = now_local.strftime("Week of %B ") + (now_local.strftime("%-d") if os.name != "nt" else now_local.strftime("%#d"))
    subject = f"Seed the Word — Weekly Digest ({week_label})"

    sent = 0
    failed = 0
    if DRY_RUN and not subscribers:
        # Dry-run sample so we can preview the body shape without
        # subscribers configured.
        sample = {"email": "preview@local", "name": "Preview"}
        html = build_digest_html(content, sample["name"], now_local)
        text = build_digest_text(content, sample["name"], now_local)
        log("---- HTML preview (first 800 chars) ----")
        log(html[:800])
        log("---- Plain-text preview ----")
        log(text)
        return 0

    for sub in subscribers:
        html = build_digest_html(content, sub.get("name") or "", now_local)
        text = build_digest_text(content, sub.get("name") or "", now_local)
        ok = send_digest_to(sub, html, text, subject)
        if ok:
            sent += 1
        else:
            failed += 1

    log(f"Digest done. Sent: {sent}, Failed: {failed}")

    # Update dedup log even on partial failure so a botched send
    # doesn't get re-attempted automatically (which would double-mail
    # successful subscribers). Manual FORCE rerun is the recovery path.
    dedup["lastFiredOn"] = today_str
    dedup["lastSummary"] = {
        "sent": sent,
        "failed": failed,
        "subscriberCount": len(subscribers),
        "weekContent": {
            "events_past": len(content["events_past"]),
            "events_upcoming": len(content["events_upcoming"]),
            "testimonies": len(content["testimonies"]),
            "outreach": len(content["outreach"]),
        },
    }
    save_json(LOG_PATH, dedup)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
