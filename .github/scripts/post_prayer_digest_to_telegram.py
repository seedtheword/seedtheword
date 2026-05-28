"""
Post the triweekly prayer & thanksgiving digest into the
@seedtheword Telegram supergroup's `Prayer & Thanksgiving` topic
(thread 21).

Schedule: Mon / Thu / Sat 08:00 America/Los_Angeles (wired up in
.github/workflows/prayer-digest-post.yml). Reads the on-disk
Prayer_Log produced by poll_prayer_topic.py, selects entries inside
the current Capture_Window, formats them into a single MarkdownV2
message, and posts via Telegram sendMessage.

Auth model: Bot API. Reuses TELEGRAM_PRAYER_BOT_TOKEN — the same
secret the Poller uses. No new bot, no new GitHub Secret
(Requirement 1.13).

Env vars:
  BOT_CONFIG                  — path to telegram-bot.json
  PRAYER_LOG_PATH             — path to telegram-prayer-log.json
  DRY_RUN                     — if set, log the message instead of sending

Error semantics:
  • sendMessage HTTP / network / non-`ok` failure → log to stderr,
    do NOT mark slot complete, exit 1 (workflow fails). The slot can
    be replayed via workflow_dispatch after the operator fixes the
    cause (per §13 of design.md).
  • Empty Capture_Window → mark slot complete with messageId=null,
    entryCount=0, skip the post (Requirement 6.8).
  • First_Run → mark slot complete, do NOT post (Requirement 6.9).
  • Already-posted slot → log "already posted this slot" and exit 0
    (Requirement 7.5).

Public API (importable for tests):
  current_schedule_slot(now_la)        — '2026-W21-mon' style ID
  capture_window_lower_bound(log_state)— most-recent completedSlots[*].since
  is_first_run(log_state)              — True iff log is empty
  select_for_digest(log_state, since, now, cfg) — filter + cap entries
  render_digest(entries, slot, cfg)    — MarkdownV2 message
  mark_slot_complete(log_state, slot, since, message_id, entry_count)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import (  # type: ignore
    log,
    mdv2_escape,
    send_telegram_message,
    load_json,
)
# The summarizer + defensive-strip helpers live in poll_prayer_topic
# so capture-time and digest-time stripping share one implementation
# (per §4.4 of design.md).
from poll_prayer_topic import (  # type: ignore
    BOT_CONFIG_PATH,
    LOG_PATH,
    load_config,
    load_prayer_log,
    save_prayer_log,
    summarize,
)
# Optional LLM-backed summarizer. Gracefully no-ops when GEMINI_API_KEY
# is empty or the API call fails — the rule-based summarize() above
# is always the final fallback.
#
# Imported as a module (not via `from gemini_summarize import ...`) so
# tests can monkeypatch `gemini_summarize.llm_summarize` and have
# `_summarize_entry` actually pick up the patched version.
import gemini_summarize  # type: ignore  # noqa: E402


TOKEN = os.environ.get("TELEGRAM_PRAYER_BOT_TOKEN", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())

LA_TZ = ZoneInfo("America/Los_Angeles")

SLOT_DAY_CODES = {
    0: "mon", 1: "tue", 2: "wed", 3: "thu",
    4: "fri", 5: "sat", 6: "sun",
}

# Header copy keyed by day code. The structural skeleton is identical
# across all days (header / blank / N bullets / blank / footer);
# only the day-label varies (Requirement 6.6, §10.1 of design.md).
HEADER_BY_DAY = {
    "mon": "🙏 *Prayer & thanksgiving — Monday*",
    "tue": "🙏 *Prayer & thanksgiving — Tuesday*",
    "wed": "🙏 *Prayer & thanksgiving — Midweek*",
    "thu": "🙏 *Prayer & thanksgiving — Midweek*",
    "fri": "🙏 *Prayer & thanksgiving — Friday*",
    "sat": "🙏 *Prayer & thanksgiving — Weekend*",
    "sun": "🙏 *Prayer & thanksgiving — Weekend*",
}

# Footer per §10.3. The literal `[` `]` characters around `private`
# and `anon` are MarkdownV2 metacharacters and MUST be backslash-
# escaped so they render as text rather than starting a link span.
# The middle-dot separators match the bullet glyph.
FOOTER = (
    "_Reply with /skipdigest in DM to opt out · "
    "prefix a message with \\[private\\] to skip · "
    "\\[anon\\] to anonymize_"
)


# ── Schedule_Slot logic ───────────────────────────────────────────────
def current_schedule_slot(now_la: datetime) -> str:
    """Return e.g. '2026-W21-mon'. Computed in America/Los_Angeles so a
    23:50 UTC run on Sunday in DST does not collide with the Monday
    slot (per §4.6 / §7.3 of design.md)."""
    if now_la.tzinfo is None:
        now_la = now_la.replace(tzinfo=LA_TZ)
    elif now_la.tzinfo != LA_TZ:
        now_la = now_la.astimezone(LA_TZ)
    iso = now_la.isocalendar()
    code = SLOT_DAY_CODES[now_la.weekday()]
    # iso is a namedtuple; older Python returns a tuple. Both shapes
    # support [0]=year, [1]=week.
    iso_year = getattr(iso, "year", None) or iso[0]
    iso_week = getattr(iso, "week", None) or iso[1]
    return f"{iso_year}-W{iso_week:02d}-{code}"


def _parse_iso(ts: str) -> datetime:
    """Parse an ISO-8601 UTC timestamp (with trailing Z) into a tz-aware
    datetime. Tolerant of '+00:00' and naïve forms (assumed UTC)."""
    raw = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def is_first_run(log_state: dict) -> bool:
    """True iff completedSlots is empty AND entries is empty
    (Requirement 6.9, §3.2 of design.md)."""
    return (
        not (log_state.get("completedSlots") or {})
        and not (log_state.get("entries") or [])
    )


def capture_window_lower_bound(log_state: dict) -> datetime:
    """Return the lower bound of the next Capture_Window. Resolution
    order, per §3.2 of design.md:
      1. Most-recent completedSlots[*].since (max by `postedAt`).
      2. If completedSlots is empty but entries is not (fresh-pipe
         migration), the earliest entries[*].ts.
      3. Caller short-circuits on is_first_run() before this fn.
    """
    slots = log_state.get("completedSlots") or {}
    if slots:
        # Pick the slot with the most recent `since` field (the upper
        # bound of the previous run is the lower bound of the next).
        latest = max(slots.values(), key=lambda v: v.get("since") or "")
        since_str = latest.get("since")
        if since_str:
            return _parse_iso(since_str)
    entries = log_state.get("entries") or []
    if entries:
        timestamps = [_parse_iso(e["ts"]) for e in entries if e.get("ts")]
        if timestamps:
            return min(timestamps)
    # Defensive — should never be reached because is_first_run()
    # catches the both-empty case.
    return datetime.now(timezone.utc)


# ── Selection ─────────────────────────────────────────────────────────
def _is_eligible(entry: dict, log_state: dict, cfg: dict,
                 since: datetime, now: datetime) -> bool:
    ts_str = entry.get("ts")
    if not ts_str:
        return False
    try:
        ts = _parse_iso(ts_str)
    except (TypeError, ValueError):
        return False
    if not (since <= ts < now):
        return False
    user_id = entry.get("userId")
    opt_out = set(log_state.get("optOut") or [])
    excluded = set(cfg["prayer"]["digest"].get("excludeUserIds") or [])
    if user_id is not None and (user_id in opt_out or user_id in excluded):
        return False
    return True


def select_for_digest(log_state: dict, since: datetime, now: datetime,
                      cfg: dict) -> list[dict]:
    """Pure selection function (no clock reads, no I/O).

    Filter entries[] by:
      since <= ts < now
      AND userId not in optOut and not in excludeUserIds
      AND user is not a bot author (the Poller never appends those,
          but the entry's `kind` metadata gives us a defense-in-depth
          re-check here).

    Then keep the most recent `entryCap` entries by (ts, messageId)
    descending, and return them sorted by ts ascending for rendering.

    Validates Properties P2 and P3 (Requirements 3.3, 3.4, 3.6, 3.7,
    3.8, 6.2, 6.3, 6.6)."""
    entries = log_state.get("entries") or []
    eligible = [
        e for e in entries
        if _is_eligible(e, log_state, cfg, since, now)
    ]
    cap = int(cfg["prayer"]["digest"].get("entryCap") or 15)
    # Sort descending by (ts, messageId), take the top `cap`, then
    # sort ascending by ts for rendering (oldest first per Req 6.6).
    eligible.sort(
        key=lambda e: (_parse_iso(e["ts"]), int(e.get("messageId") or 0)),
        reverse=True,
    )
    selected = eligible[:cap]
    selected.sort(key=lambda e: (_parse_iso(e["ts"]), int(e.get("messageId") or 0)))
    return selected


# ── Rendering ─────────────────────────────────────────────────────────
def _summarize_entry(text: str, max_chars: int, summarizer_mode: str,
                     api_key: str) -> str:
    """Choose a summarizer for a single entry. The rule-based
    summarize() is always called as the FINAL step so the returned
    string is mathematically guaranteed to be length-capped (P4)
    and deterministic given the rule-based path (P5 holds on the
    rule-based mode; the LLM path is best-effort by design).

    Modes:
      'rule-based' (default) — call summarize() directly.
      'llm'                  — try llm_summarize() first; on empty
                               result (no key, network failure,
                               safety filter, etc.) fall back to
                               summarize() on the original text. The
                               LLM result, when non-empty, is also
                               passed through summarize() so the
                               length cap is enforced regardless of
                               what the model returned."""
    if summarizer_mode == "llm" and api_key:
        llm_out = gemini_summarize.llm_summarize(text, max_chars, api_key)
        if llm_out:
            return summarize(llm_out, max_chars)
    return summarize(text, max_chars)


def render_digest(entries: list[dict], slot: str, cfg: dict) -> str:
    """Render the full MarkdownV2 message: header + blank + bullets +
    blank + footer (Requirement 6.6, §10 of design.md). Every
    interpolated displayName and Summary_Line goes through
    mdv2_escape; the format markers (* for header bold, _ for footer
    italics, the literal \\[ \\] in the footer) are NOT escaped — they
    are markup, not user content."""
    digest_cfg = cfg["prayer"]["digest"]
    summary_max = int(digest_cfg.get("summaryMaxChars") or 60)
    summarizer_mode = str(digest_cfg.get("summarizer") or "rule-based").lower()

    day_code = slot.rsplit("-", 1)[-1]
    header = HEADER_BY_DAY.get(day_code, HEADER_BY_DAY["mon"])

    bullet_lines = []
    for e in entries:
        name = e.get("displayName") or "Anonymous"
        text = e.get("text") or ""
        summary = _summarize_entry(text, summary_max, summarizer_mode, GEMINI_API_KEY)
        bullet_lines.append(
            "· " + mdv2_escape(name) + " — " + mdv2_escape(summary)
        )

    return "\n".join([header, ""] + bullet_lines + ["", FOOTER])


# ── Slot completion ───────────────────────────────────────────────────
def mark_slot_complete(log_state: dict, slot: str, since: datetime,
                       message_id: Optional[int], entry_count: int) -> dict:
    """Record this slot's completion in completedSlots. `since` becomes
    the lower bound of the next run's Capture_Window. `message_id` is
    None for First_Run and empty-Capture_Window slots; otherwise it
    is the value Telegram returned (Requirements 6.8, 6.9, 7.3, 7.4,
    7.5)."""
    slots = log_state.get("completedSlots") or {}
    slots[slot] = {
        "since": since.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "messageId": message_id,
        "entryCount": int(entry_count),
        "postedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    log_state["completedSlots"] = slots
    return log_state


# ── Main ──────────────────────────────────────────────────────────────
def main() -> int:
    cfg = load_config()
    digest_cfg = cfg.get("prayer", {}).get("digest", {})
    if not digest_cfg.get("enabled", False):
        log("Prayer digest disabled; exiting.")
        return 0

    log_state = load_prayer_log()
    now_utc = datetime.now(timezone.utc)
    now_la = now_utc.astimezone(LA_TZ)
    slot = current_schedule_slot(now_la)

    # Idempotency: if this slot already posted, exit 0 (Req 7.5).
    completed = log_state.get("completedSlots") or {}
    if slot in completed:
        log(f"Slot {slot} already posted; exiting.")
        return 0

    # First_Run: do NOT post, just mark the slot complete (Req 6.9).
    if is_first_run(log_state):
        log_state = mark_slot_complete(
            log_state, slot, since=now_utc, message_id=None, entry_count=0
        )
        save_prayer_log(log_state)
        log(f"First_Run for slot {slot}; marked complete without posting.")
        return 0

    since = capture_window_lower_bound(log_state)
    eligible = select_for_digest(log_state, since=since, now=now_utc, cfg=cfg)

    if not eligible:
        log(f"No eligible entries for slot {slot}; marking complete and exiting.")
        log_state = mark_slot_complete(
            log_state, slot, since=now_utc, message_id=None, entry_count=0
        )
        save_prayer_log(log_state)
        return 0

    text = render_digest(eligible, slot, cfg)
    chat_id = cfg.get("prayer", {}).get("chatId") or "@seedtheword"
    thread_id = int(digest_cfg.get("messageThreadId") or 21)

    try:
        resp = send_telegram_message(
            TOKEN, chat_id, text,
            message_thread_id=thread_id,
            parse_mode="MarkdownV2",
            disable_web_page_preview=True,
            dry_run=DRY_RUN,
        )
    except Exception as e:
        log(f"Digest sendMessage raised: {e}; slot {slot} NOT marked complete.")
        return 1
    if not resp.get("ok"):
        log(f"Digest sendMessage returned non-ok: {resp}; slot {slot} NOT marked complete.")
        return 1

    if DRY_RUN:
        message_id = None
        log(f"[DRY_RUN] Would have marked slot {slot} complete with {len(eligible)} entries.")
    else:
        message_id = (resp.get("result") or {}).get("message_id")

    log_state = mark_slot_complete(
        log_state, slot, since=now_utc, message_id=message_id,
        entry_count=len(eligible),
    )
    save_prayer_log(log_state)
    log(f"Posted digest for slot {slot} with {len(eligible)} entries (message_id={message_id}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
