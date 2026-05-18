"""
Twice-weekly admin operations digest — Mon/Thu 08:00 PT.

Different audience and different content from send_weekly_digest.py:
  - Member digest: events, testimonies, outreach (the public face).
  - Admin digest:  orders needing action, stories awaiting review,
                   recent contacts, new subscribers, calendar status
                   (the operations dashboard).

Auth model: NONE \u2014 reads admins + ops data from the Apps Script
doGet endpoint, sends per-admin emails through the same Apps Script
MailApp bridge as the member digest.

Idempotency: digest-log.json (shared with the member digest) tracks
adminLastFiredOn = YYYY-MM-DD so manual re-runs of the workflow on
the same calendar day no-op unless FORCE=1 is set.

Env vars:
  APPS_SCRIPT_URL   required  same secret used by all Mail-bridge paths
  GOOGLE_CAL_ID     optional  defaults to the ministry's
  SITE_BASE_URL     optional
  DRY_RUN           optional  preview body without sending
  FORCE             optional  bypass once-per-day dedup

Exit 0 on completion (even when no admins or no actionable items).
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo


REPO_ROOT = Path(__file__).resolve().parents[2]
LOG_PATH = Path(os.environ.get(
    "DIGEST_LOG_PATH", REPO_ROOT / "assets/data/digest-log.json"
))
APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "").strip()
GOOGLE_CAL_ID = os.environ.get(
    "GOOGLE_CAL_ID", "seedthewordministry@gmail.com"
).strip()
SITE_BASE_URL = os.environ.get(
    "SITE_BASE_URL", "https://seedtheword.github.io/seedtheword"
).rstrip("/")
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())
FORCE = bool(os.environ.get("FORCE", "").strip())
TZ = ZoneInfo("America/Los_Angeles")


def log(msg: str) -> None:
    print(msg, flush=True)


def http_json_get(url: str, timeout: int = 30) -> Any:
    req = Request(url, headers={
        "User-Agent": "seedtheword-admin-digest/1.0",
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


def html_escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ── Calendar count (re-used pattern from check_calendar_thin.py) ────
def count_upcoming_events(days: int = 14) -> int:
    """Same iCal feed parse as check_calendar_thin.py but smaller \u2014
    we just want a count, not the full event list. Returns 0 on any
    failure so the digest still ships even if the calendar is down."""
    try:
        url = (
            "https://calendar.google.com/calendar/ical/"
            + quote(GOOGLE_CAL_ID, safe="") + "/public/basic.ics"
        )
        req = Request(url, headers={
            "User-Agent": "seedtheword-admin-digest/1.0",
            "Accept": "text/calendar",
        })
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", "replace")

        now = datetime.now(timezone.utc)
        horizon = now + timedelta(days=days)
        count = 0
        for m in re.finditer(r"DTSTART(?:;[^:]+)?:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?", raw):
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            hh, mm = int(m.group(4) or 0), int(m.group(5) or 0)
            try:
                start = datetime(y, mo, d, hh, mm, tzinfo=timezone.utc)
            except ValueError:
                continue
            if now <= start <= horizon:
                count += 1
        return count
    except Exception as exc:
        log(f"Calendar count failed (non-fatal): {exc}")
        return 0


# ── Digest body builders ──────────────────────────────────────────────
def build_admin_digest_html(data: dict, admin_name: str, now_local: datetime,
                            calendar_count: int) -> str:
    label = now_local.strftime("%A, %B ") + (
        now_local.strftime("%-d, %Y") if os.name != "nt"
        else now_local.strftime("%#d, %Y")
    )
    greeting = f"Dear {html_escape(admin_name) if admin_name else 'team'},"

    sections_html: list[str] = []

    # ── Orders needing action ───────────────────────────────────────
    orders = data.get("ordersNeedingAction") or []
    if orders:
        rows = []
        for o in orders:
            tag_color = {
                "new": "#d4a574",
                "confirming": "#3a7d3c",
                "packing": "#2C5F2E",
            }.get(o.get("status", "new"), "#d4a574")
            special = ""
            if o.get("is_special_order"):
                special = (
                    ' <span style="background: #fff3cd; color: #6c4500; '
                    'padding: 0.1rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">'
                    '\u2728 special order</span>'
                )
            rows.append(
                f"<tr>"
                f"<td style='padding: 0.5rem; border-bottom: 1px solid #f0ebe2;'>"
                f"<strong>{html_escape(o.get('order_id', '?'))}</strong>{special}<br>"
                f"<small style='color: #666;'>{html_escape(o.get('bundle', '?'))} for {html_escape(o.get('gifter_name', '?'))}</small>"
                f"</td>"
                f"<td style='padding: 0.5rem; border-bottom: 1px solid #f0ebe2; vertical-align: top;'>"
                f"<span style='background: {tag_color}; color: #fff; padding: 0.15rem 0.6rem; "
                f"border-radius: 4px; font-size: 0.85rem; text-transform: uppercase;'>"
                f"{html_escape(o.get('status', 'new'))}</span>"
                f"</td>"
                f"</tr>"
            )
        sections_html.append(
            f"<h3 style='font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;'>"
            f"\ud83d\udce6 Orders needing action ({len(orders)})</h3>"
            f"<table style='width: 100%; border-collapse: collapse;'>"
            f"<tbody>{''.join(rows)}</tbody></table>"
        )

    # ── Stories awaiting review ─────────────────────────────────────
    stories = data.get("storiesAwaitingReview") or []
    if stories:
        cards = []
        for s in stories[:5]:
            received = (s.get("received_at") or "")[:10]
            consent_bit = ""
            if s.get("consent_to_publish"):
                consent_bit = " <em style='color: #2C5F2E;'>(consent given)</em>"
            cards.append(
                f"<blockquote style='border-left: 3px solid #d4a574; padding: 0.5rem 1rem; "
                f"margin: 0.75rem 0; color: #333; line-height: 1.6;'>"
                f"<strong>{html_escape(s.get('name', 'Anonymous'))}</strong>"
                f" &middot; {html_escape(received)}{consent_bit}<br>"
                f"<small style='color: #666;'>{html_escape(s.get('email', ''))}</small><br>"
                f"&ldquo;{html_escape(s.get('story_snippet', ''))}&rdquo;"
                f"</blockquote>"
            )
        more_note = (
            f"<p style='color: #666; font-style: italic; margin-top: 0.5rem;'>"
            f"&hellip; and {len(stories) - 5} more. See the Stories tab for the full list.</p>"
            if len(stories) > 5 else ""
        )
        sections_html.append(
            f"<h3 style='font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;'>"
            f"\u2728 Stories awaiting review ({len(stories)})</h3>"
            f"{''.join(cards)}{more_note}"
        )

    # ── Recent contact-form messages ────────────────────────────────
    contacts = data.get("recentContacts") or []
    if contacts:
        cards = []
        for c in contacts[:5]:
            received = (c.get("received_at") or "")[:10]
            cards.append(
                f"<blockquote style='border-left: 3px solid #2C5F2E; padding: 0.5rem 1rem; "
                f"margin: 0.75rem 0; color: #333; line-height: 1.6;'>"
                f"<strong>{html_escape(c.get('name', 'Anonymous'))}</strong>"
                f" &middot; {html_escape(received)}<br>"
                f"<small style='color: #666;'>{html_escape(c.get('email', ''))}"
                f" &middot; <em>{html_escape(c.get('subject', '(no subject)'))}</em></small><br>"
                f"&ldquo;{html_escape(c.get('message_snippet', ''))}&rdquo;"
                f"</blockquote>"
            )
        more_note = (
            f"<p style='color: #666; font-style: italic; margin-top: 0.5rem;'>"
            f"&hellip; and {len(contacts) - 5} more. See the Contact tab for the full list.</p>"
            if len(contacts) > 5 else ""
        )
        sections_html.append(
            f"<h3 style='font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;'>"
            f"\u2709\ufe0f Recent contact messages ({len(contacts)})</h3>"
            f"{''.join(cards)}{more_note}"
        )

    # ── New subscribers ─────────────────────────────────────────────
    subs = data.get("newSubscribers") or []
    if subs:
        rows = []
        for s in subs:
            rows.append(
                f"<li>{html_escape(s.get('name', '?'))} \u2014 "
                f"<small style='color: #666;'>{html_escape(s.get('email', ''))}</small></li>"
            )
        sections_html.append(
            f"<h3 style='font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;'>"
            f"\ud83d\udc8c New subscribers this week ({len(subs)})</h3>"
            f"<ul style='line-height: 1.7;'>{''.join(rows)}</ul>"
        )

    # ── Calendar health ─────────────────────────────────────────────
    if calendar_count < 2:
        sections_html.append(
            f"<h3 style='font-family: Georgia, serif; color: #b54f2c; margin: 1.5rem 0 0.5rem;'>"
            f"\u26a0\ufe0f Calendar is thin ({calendar_count} events in next 14 days)</h3>"
            f"<p style='line-height: 1.7;'>The Telegram announcement bot has very little to "
            f"post this stretch. Add events through Google Calendar, or convert the past "
            f"weekly events to recurring so they fill in automatically.</p>"
        )
    elif calendar_count < 5:
        sections_html.append(
            f"<h3 style='font-family: Georgia, serif; color: #2C5F2E; margin: 1.5rem 0 0.5rem;'>"
            f"\ud83d\udcc5 Calendar status</h3>"
            f"<p style='line-height: 1.7;'>{calendar_count} events scheduled in the next "
            f"14 days. Consider adding more if the cadence supports it.</p>"
        )

    body_html = "".join(sections_html)
    if not body_html:
        body_html = (
            "<p style='color: #555; line-height: 1.7;'>Nothing actionable on the ops board "
            "right now. All orders are in terminal states, no stories awaiting review, no "
            "fresh contact messages this past week. The Lord is also at work in the quiet.</p>"
        )

    return f"""\
<!DOCTYPE html>
<html><body style="font-family: Arial, Helvetica, sans-serif; background: #fdf3e3;
    color: #1a1a1a; margin: 0; padding: 1rem;">
  <div style="max-width: 680px; margin: 0 auto; background: #ffffff;
       border-radius: 12px; overflow: hidden;
       box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
    <div style="background: linear-gradient(135deg, #2C5F2E, #3a7d3c);
         padding: 1.5rem 1.75rem; color: #fdf3e3;">
      <h1 style="margin: 0; font-family: Georgia, serif; font-size: 1.4rem;">
        Seed the Word \u2014 Admin Ops Digest
      </h1>
      <p style="margin: 0.25rem 0 0; opacity: 0.85;">{html_escape(label)}</p>
    </div>
    <div style="padding: 1.5rem 1.75rem;">
      <p style="line-height: 1.7;">{greeting}</p>
      <p style="line-height: 1.7;">Quick ops snapshot for the team. Sent every Monday and
        Thursday morning.</p>
      {body_html}
      <hr style="border: 0; border-top: 1px solid #e8e4de; margin: 2rem 0 1rem;">
      <p style="line-height: 1.7; color: #666; font-size: 0.92rem;">
        Manage subscribers, admins, and content through the
        <a href="{SITE_BASE_URL}/admin-help.html" style="color: #2C5F2E;">admin-help page</a>
        or the STW spreadsheet.
      </p>
      <p style="line-height: 1.7; color: #666; font-size: 0.85rem; font-style: italic;">
        Sincerely,<br>The Seed the Word automation
      </p>
    </div>
  </div>
</body></html>"""


def build_admin_digest_text(data: dict, admin_name: str, now_local: datetime,
                            calendar_count: int) -> str:
    label = now_local.strftime("%A, %B ") + (
        now_local.strftime("%-d, %Y") if os.name != "nt"
        else now_local.strftime("%#d, %Y")
    )
    parts: list[str] = [
        "Seed the Word \u2014 Admin Ops Digest",
        label,
        "",
        f"Dear {admin_name or 'team'},",
        "",
        "Quick ops snapshot for the team.",
        "",
    ]

    orders = data.get("ordersNeedingAction") or []
    if orders:
        parts.append(f"ORDERS NEEDING ACTION ({len(orders)})")
        for o in orders:
            special = " (SPECIAL ORDER)" if o.get("is_special_order") else ""
            parts.append(
                f"- [{o.get('status', 'new').upper()}] {o.get('order_id', '?')} \u2014 "
                f"{o.get('bundle', '?')} for {o.get('gifter_name', '?')}{special}"
            )
        parts.append("")

    stories = data.get("storiesAwaitingReview") or []
    if stories:
        parts.append(f"STORIES AWAITING REVIEW ({len(stories)})")
        for s in stories[:5]:
            received = (s.get("received_at") or "")[:10]
            consent = " (consent given)" if s.get("consent_to_publish") else ""
            parts.append(f"- {s.get('name', 'Anonymous')} ({received}){consent}")
            parts.append(f"  \"{s.get('story_snippet', '')}\"")
        if len(stories) > 5:
            parts.append(f"  ...and {len(stories) - 5} more in the Stories tab.")
        parts.append("")

    contacts = data.get("recentContacts") or []
    if contacts:
        parts.append(f"RECENT CONTACT MESSAGES ({len(contacts)})")
        for c in contacts[:5]:
            received = (c.get("received_at") or "")[:10]
            parts.append(f"- {c.get('name', 'Anonymous')} ({received}) \u2014 {c.get('subject', '')}")
            parts.append(f"  \"{c.get('message_snippet', '')}\"")
        if len(contacts) > 5:
            parts.append(f"  ...and {len(contacts) - 5} more in the Contact tab.")
        parts.append("")

    subs = data.get("newSubscribers") or []
    if subs:
        parts.append(f"NEW SUBSCRIBERS THIS WEEK ({len(subs)})")
        for s in subs:
            parts.append(f"- {s.get('name', '?')} ({s.get('email', '')})")
        parts.append("")

    if calendar_count < 2:
        parts.append(f"WARNING: Calendar is thin ({calendar_count} events in next 14 days).")
        parts.append("")

    if not (orders or stories or contacts or subs):
        parts.append("Nothing actionable on the ops board right now.")
        parts.append("All orders in terminal states, no stories awaiting review,")
        parts.append("no fresh contact messages this past week.")
        parts.append("")

    parts.append("---")
    parts.append(f"Admin help: {SITE_BASE_URL}/admin-help.html")
    parts.append("")
    parts.append("Sincerely,")
    parts.append("The Seed the Word automation")
    return "\n".join(parts)


# ── Main ──────────────────────────────────────────────────────────────
def fetch_admins() -> list[dict]:
    if not APPS_SCRIPT_URL:
        log("APPS_SCRIPT_URL is not set; cannot fetch admins.")
        return []
    url = APPS_SCRIPT_URL + ("&" if "?" in APPS_SCRIPT_URL else "?") + "action=admins"
    try:
        body = http_json_get(url)
    except Exception as exc:
        log(f"Admins fetch failed: {exc}")
        return []
    if not (isinstance(body, dict) and body.get("ok") and isinstance(body.get("admins"), list)):
        log(f"Admins response unexpected: {body}")
        return []
    return body["admins"]


def fetch_digest_data() -> dict:
    if not APPS_SCRIPT_URL:
        return {}
    url = APPS_SCRIPT_URL + ("&" if "?" in APPS_SCRIPT_URL else "?") + "action=admin-digest-data"
    try:
        body = http_json_get(url, timeout=60)
    except Exception as exc:
        log(f"Digest data fetch failed: {exc}")
        return {}
    if not (isinstance(body, dict) and body.get("ok")):
        log(f"Digest data response unexpected: {body}")
        return {}
    return body.get("data") or {}


def send_to(admin: dict, html: str, text: str, subject: str) -> bool:
    if DRY_RUN:
        log(f"[DRY_RUN] Would email {admin.get('email')} ({admin.get('name')})")
        return True
    payload = {
        "type": "weekly-digest-email",
        "to": admin.get("email"),
        "subject": subject,
        "html": html,
        "text": text,
        "name": admin.get("name") or "",
    }
    try:
        body = http_post_json(APPS_SCRIPT_URL, payload)
        if body.get("ok"):
            return True
        log(f"Send rejected for {admin.get('email')}: {body}")
        return False
    except Exception as exc:
        log(f"Send failed for {admin.get('email')}: {exc}")
        return False


def main() -> int:
    if not APPS_SCRIPT_URL and not DRY_RUN:
        log("APPS_SCRIPT_URL not set; aborting.")
        return 1

    now = datetime.now(timezone.utc)
    now_local = now.astimezone(TZ)
    today_str = now_local.strftime("%Y-%m-%d")

    dedup = load_json(LOG_PATH, {})
    if not FORCE and dedup.get("adminLastFiredOn") == today_str:
        log(f"Admin digest already fired today ({today_str}). Set FORCE=1 to re-send.")
        return 0

    admins = fetch_admins()
    log(f"Found {len(admins)} active admin(s)")

    data = fetch_digest_data()
    cal_count = count_upcoming_events(days=14)
    log(
        f"Ops snapshot: orders={len(data.get('ordersNeedingAction') or [])}, "
        f"stories={len(data.get('storiesAwaitingReview') or [])}, "
        f"contacts={len(data.get('recentContacts') or [])}, "
        f"newSubs={len(data.get('newSubscribers') or [])}, "
        f"calendar(14d)={cal_count}"
    )

    if not admins and not DRY_RUN:
        log("No active admins; nothing to send. Add rows to the Admins tab.")
        return 0

    weekday = now_local.strftime("%A")
    subject = f"Seed the Word \u2014 Admin Ops Digest ({weekday})"

    if DRY_RUN and not admins:
        sample = {"email": "preview@local", "name": "Preview"}
        html = build_admin_digest_html(data, sample["name"], now_local, cal_count)
        text = build_admin_digest_text(data, sample["name"], now_local, cal_count)
        log("---- Plain-text preview ----")
        log(text)
        return 0

    sent = 0
    failed = 0
    for admin in admins:
        html = build_admin_digest_html(data, admin.get("name") or "", now_local, cal_count)
        text = build_admin_digest_text(data, admin.get("name") or "", now_local, cal_count)
        if send_to(admin, html, text, subject):
            sent += 1
        else:
            failed += 1

    log(f"Admin digest done. Sent: {sent}, Failed: {failed}")

    dedup["adminLastFiredOn"] = today_str
    dedup["adminLastSummary"] = {
        "sent": sent,
        "failed": failed,
        "adminCount": len(admins),
        "ops": {
            "orders": len(data.get("ordersNeedingAction") or []),
            "stories": len(data.get("storiesAwaitingReview") or []),
            "contacts": len(data.get("recentContacts") or []),
            "newSubs": len(data.get("newSubscribers") or []),
            "calendar14d": cal_count,
        },
    }
    save_json(LOG_PATH, dedup)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
