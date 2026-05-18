"""
Calendar-thin monitor.

Pulls the public iCal feed for the ministry calendar, counts how many
events fall in the next N days, and emails the team a heads-up when
the count drops below the threshold.

The original failure mode this guards against:
  - Recurring events get created as one-off entries.
  - Someone seeds a few weeks ahead, then forgets to keep adding.
  - Calendar quietly runs out of events.
  - Telegram announcement bot has nothing to post for days/weeks.
  - Members notice that "things have gone quiet" and assume the
    ministry slowed down.

Schedule (wired up in .github/workflows/calendar-monitor.yml):
  Daily at 08:30 PT (after the heartbeat-piggybacked Bible bot has
  done its work). Most days the calendar is fine and this script
  no-ops; on a thin day it dispatches one email to TEAM_INBOX via
  the Apps Script Mail bridge.

Auth model: NONE — uses the public iCal feed for read, and the
existing Apps Script Web App (already auth'd via APPS_SCRIPT_URL
secret) for the email send. No new credentials.

Idempotency:
  Apps Script's MailApp.sendEmail is the only side-effect. We DO
  NOT track whether an alert has already gone out — instead we send
  one email per thin day. If the calendar stays thin for 5 days,
  the team gets 5 emails. That's intentional friction: the absence
  of a fresh email IS the signal that someone fixed the calendar.

Env vars:
  APPS_SCRIPT_URL   — required for delivery; same secret used by the
                      digest + announcement-SMS pipelines
  CAL_MONITOR_DAYS  — lookahead horizon (default 7)
  CAL_MONITOR_MIN   — threshold below which an alert fires (default 2)
  GOOGLE_CAL_ID     — calendar id (defaults to the ministry's)
  TEAM_INBOX        — recipient (defaults to seedthewordministry@gmail.com)
  DRY_RUN           — if set, log what would be sent without dispatch
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


def _env_int(name: str, default: int) -> int:
    """Read an int env var; treat empty string as 'not set'.

    Workflow_dispatch inputs default to '' rather than being absent,
    so plain int(os.environ.get(...)) blows up on a manual run that
    doesn't override the value. This wrapper lets either case fall
    back to the default cleanly."""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


GOOGLE_CAL_ID = os.environ.get(
    "GOOGLE_CAL_ID", "seedthewordministry@gmail.com"
).strip()
APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "").strip()
TEAM_INBOX = os.environ.get("TEAM_INBOX", "seedthewordministry@gmail.com").strip()
LOOKAHEAD_DAYS = _env_int("CAL_MONITOR_DAYS", 7)
MIN_EVENTS = _env_int("CAL_MONITOR_MIN", 2)
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())
SITE_BASE_URL = "https://seedtheword.github.io/seedtheword"


def log(msg: str) -> None:
    print(msg, flush=True)


def _unfold(lines: list[str]) -> list[str]:
    out: list[str] = []
    for ln in lines:
        if ln.startswith((" ", "\t")) and out:
            out[-1] += ln[1:]
        else:
            out.append(ln)
    return out


def _parse_dt(raw: str) -> datetime | None:
    v = raw.strip()
    try:
        if "T" in v:
            return datetime(
                int(v[:4]), int(v[4:6]), int(v[6:8]),
                int(v[9:11]), int(v[11:13]),
                tzinfo=timezone.utc,
            )
        return datetime(int(v[:4]), int(v[4:6]), int(v[6:8]), tzinfo=timezone.utc)
    except (ValueError, IndexError):
        return None


def fetch_upcoming(days: int) -> list[dict]:
    """Pull the iCal feed and return events whose DTSTART falls in
    [now, now + days]. Recurring rules (RRULE) are NOT expanded; this
    monitor specifically wants to catch the case where there ARE no
    rules and one-offs have run out, so leaving recurrence un-expanded
    is correct — it counts only the "concrete" upcoming entries."""
    url = (
        "https://calendar.google.com/calendar/ical/"
        + quote(GOOGLE_CAL_ID, safe="") + "/public/basic.ics"
    )
    req = Request(url, headers={
        "User-Agent": "seedtheword-cal-monitor/1.0",
        "Accept": "text/calendar",
    })
    raw = urlopen(req, timeout=30).read().decode("utf-8", "replace")
    lines = _unfold(raw.replace("\r\n", "\n").split("\n"))

    events: list[dict] = []
    in_event = False
    cur: list[str] = []
    for ln in lines:
        if ln.strip() == "BEGIN:VEVENT":
            in_event = True
            cur = []
        elif ln.strip() == "END:VEVENT":
            in_event = False
            ev = {}
            for c in cur:
                if ":" not in c:
                    continue
                name, val = c.split(":", 1)
                base = name.split(";")[0].upper()
                if base == "SUMMARY":
                    ev["summary"] = val.strip()
                elif base == "DTSTART":
                    parsed = _parse_dt(val)
                    if parsed:
                        ev["start"] = parsed
            if "start" in ev:
                events.append(ev)
        elif in_event:
            cur.append(ln)

    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=days)
    upcoming = [e for e in events if now <= e["start"] <= horizon]
    upcoming.sort(key=lambda x: x["start"])
    return upcoming


def build_alert_body(upcoming: list[dict], days: int, threshold: int) -> tuple[str, str]:
    """Return (subject, html_body) for the alert email."""
    count = len(upcoming)
    subject = f"[STW Calendar] Only {count} event{'s' if count != 1 else ''} scheduled for the next {days} days"

    if upcoming:
        rows = []
        for ev in upcoming:
            local = ev["start"]  # we render UTC-shaped, timezone is informational
            when = local.strftime("%a %b %-d at %I:%M%p UTC") if os.name != "nt" else local.strftime("%a %b %#d at %I:%M%p UTC")
            title = ev.get("summary", "(no title)")
            rows.append(f"<li><strong>{title}</strong> — {when}</li>")
        events_html = "<ul>" + "".join(rows) + "</ul>"
    else:
        events_html = "<p><strong>The calendar is empty for the next {} days.</strong></p>".format(days)

    html = f"""\
<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 1.5rem;
       background: #fff8f0; border: 1px solid #d4a574; border-radius: 10px;">
    <h2 style="color: #2C5F2E; margin-top: 0;">Heads up: the calendar is running thin</h2>
    <p>The ministry calendar has only <strong>{count}</strong>
       event{'s' if count != 1 else ''} scheduled in the next {days} days
       (threshold: {threshold}). The Telegram announcement bot only posts
       events that are actually on the calendar — if it stays empty,
       members will stop seeing reminders.</p>

    <h3 style="color: #2C5F2E;">What's currently on the calendar:</h3>
    {events_html}

    <h3 style="color: #2C5F2E;">What to do about it:</h3>
    <ol>
      <li>Open <a href="https://calendar.google.com/" style="color: #2C5F2E;">Google Calendar</a>
          and add the next few weeks of events.</li>
      <li>If most of these are weekly recurring (Bible Study, YA gatherings, etc.),
          consider editing one of the past one-offs and changing its
          repeat rule to "Weekly" so the calendar fills itself going forward.</li>
      <li>You'll stop getting these emails as soon as the upcoming-event count
          climbs back above {threshold}.</li>
    </ol>

    <p style="color: #666; font-size: 0.9rem; font-style: italic; margin-top: 2rem;">
      This is an automated notice from the calendar-thin monitor.
      Sent once daily when the count is low.
    </p>
  </div>
</body></html>"""

    return subject, html


def dispatch_alert(subject: str, html: str) -> bool:
    """POST to the Apps Script web app's weekly-digest-email route
    (which is generic enough to handle any HTML email send). Returns
    True on success, False otherwise."""
    if not APPS_SCRIPT_URL:
        log("APPS_SCRIPT_URL is not set; cannot dispatch alert.")
        return False
    if DRY_RUN:
        log(f"[DRY_RUN] Would email {TEAM_INBOX}: subject={subject!r}, html_len={len(html)}")
        return True
    payload = {
        "type": "weekly-digest-email",
        "to": TEAM_INBOX,
        "subject": subject,
        "html": html,
        "text": (
            "The ministry calendar is running thin. Open Google Calendar "
            "and add the next few weeks of events, or convert weekly "
            "events to recurring. You'll stop getting these emails as "
            "soon as the upcoming-event count climbs back above the "
            "threshold."
        ),
        "name": "STW Calendar Monitor",
    }
    try:
        body = json.dumps(payload).encode("utf-8")
        req = Request(APPS_SCRIPT_URL, data=body, headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8", "replace"))
        if result.get("ok"):
            log(f"Alert dispatched to {TEAM_INBOX}.")
            return True
        log(f"Alert rejected: {result}")
        return False
    except (HTTPError, URLError) as e:
        log(f"Alert dispatch failed: {e}")
        return False
    except Exception as e:
        log(f"Alert dispatch unexpected error: {e}")
        return False


def main() -> int:
    try:
        upcoming = fetch_upcoming(LOOKAHEAD_DAYS)
    except Exception as exc:
        log(f"iCal fetch failed: {exc}")
        return 1

    log(f"Found {len(upcoming)} event(s) in the next {LOOKAHEAD_DAYS} days; threshold is {MIN_EVENTS}.")
    if len(upcoming) >= MIN_EVENTS:
        log("Calendar is healthy; no alert.")
        return 0

    subject, html = build_alert_body(upcoming, LOOKAHEAD_DAYS, MIN_EVENTS)
    ok = dispatch_alert(subject, html)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
