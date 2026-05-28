"""
Post a Saturday icebreaker to the @seedtheword Telegram supergroup's
"Discuss Scripture" topic (thread 434).

Schedule: every Saturday at ~09:00 PT, fired by an Apps Script kick
that hits this workflow's `workflow_dispatch` endpoint. Mirrors the
kicker pattern already in use for daily-bible / heartbeat / prayer-
digest. Idempotent: a once-per-Saturday dedup log entry keyed by
local date + 'saturday_icebreaker' kind ensures the bot can be
kicked multiple times in a day and only posts once.

What it does:
  1. Computes Mon-Fri of the local Saturday's week — that's the five
     reading days that just ended.
  2. For each weekday: NT walk chapter + OT history walk chapter +
     Poetry/Prophecy walk chapter. All three streams use the same
     anchor-based weekday-walk algorithm in
     post_daily_bible_to_telegram.py.
  3. Sends those 15 (chapter, book) tuples to Gemini with a careful
     icebreaker prompt; output is one short, warm question someone
     can answer in 1-2 sentences.
  4. Falls back deterministically to a small rotation of evergreen
     icebreakers if Gemini is missing / unreachable / safety-tripped.
  5. Posts with `linkPreviewOptions: is_disabled: true` so the
     dispatch button on Telegram (in-app) doesn't fight a fat
     preview card.

Privacy: the LLM only sees the chapter references (e.g. "Mark 12,
1 Samuel 24"), NOT user content. Same approval level as the prayer
digest's LLM mode.

Test path (Apps Script `kickSaturdayIcebreakerTest`): the same
workflow_dispatch supports a `test_run` input which posts the exact
message to the same topic but prefixed with a "(test)" header so
admins can verify the look and feel without confusing members.

Env vars:
  TELEGRAM_BIBLE_BOT_TOKEN   — bot token (GitHub Secret, reused)
  GEMINI_API_KEY             — optional; missing key → fallback rotation
  BOT_CONFIG                 — path to telegram-bot.json (optional)
  BIBLE_LOG_PATH             — path to telegram-bible-log.json (optional)
  TEST_RUN                   — if set, post '(test)'-prefixed and skip dedup
  DRY_RUN                    — if set, log the post instead of sending
  FORCE_POST                 — if set, bypass the once-per-day dedup
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import (  # type: ignore
    log,
    mdv2_escape,
    send_telegram_message,
)
from post_daily_bible_to_telegram import (  # type: ignore
    get_reading_for_date,
    get_ot_history_reading,
    get_poetry_prophecy_reading,
)
import gemini_summarize  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get(
    "BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"
))
DEDUP_LOG_PATH = Path(os.environ.get(
    "BIBLE_LOG_PATH", REPO_ROOT / "assets/data/telegram-bible-log.json"
))

BOT_TOKEN = os.environ.get("TELEGRAM_BIBLE_BOT_TOKEN", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())
FORCE_POST = bool(os.environ.get("FORCE_POST", "").strip())
TEST_RUN = bool(os.environ.get("TEST_RUN", "").strip())

LA_TZ = ZoneInfo("America/Los_Angeles")

ICEBREAKER_KIND = "saturday_icebreaker"

# Hard cap on the icebreaker question itself. The full message
# (header + reading list + question + footer) ends up ~700 chars
# worst case, well under Telegram's 4096-char cap.
QUESTION_MAX_CHARS = 280


# ── Config ────────────────────────────────────────────────────────────
def load_config() -> dict:
    return json.loads(BOT_CONFIG_PATH.read_text(encoding="utf-8"))


# ── Week computation ─────────────────────────────────────────────────
def week_readings_for_saturday(saturday_local: date, cfg: dict) -> dict:
    """For a Saturday `saturday_local`, build the Mon..Fri reading
    list across all three configured walks. Pure function — no I/O.

    Returns:
      {
        "monday": date,
        "friday": date,
        "nt":      [{"date", "book", "chapter"}],   # 0-5 entries
        "ot":      [{"date", "book", "chapter"}],   # 0-5 entries
        "pp":      [{"date", "book", "chapter"}],   # 0-5 entries
      }

    Stream lookup is gated by the same enabled flags layered-plan.js
    and the daily Bible bot use, so disabling a stream removes it
    from the icebreaker context too."""
    if saturday_local.weekday() != 5:
        # Defensive — caller usually checks first, but if someone
        # invokes this on a non-Saturday we still want a sensible
        # week (the immediately preceding Mon-Fri).
        days_back = (saturday_local.weekday() + 2) % 7
        saturday_local = saturday_local - timedelta(days=days_back)

    monday = saturday_local - timedelta(days=5)  # Sat - 5 = Mon
    week = {"monday": monday, "friday": monday + timedelta(days=4)}

    bible_cfg = (cfg or {}).get("bible", {}) or {}
    layered = bible_cfg.get("layeredPlan") or {}
    streams = layered.get("streams") or {}
    ot_cfg = streams.get("otHistory") or {}
    pp_cfg = streams.get("poetryProphecy") or {}

    nt, ot, pp = [], [], []
    for offset in range(5):
        d = monday + timedelta(days=offset)
        # NT walk — bible-plan.js anchor (Apr 30 2026 = Mark 11).
        nt_r = get_reading_for_date(d)
        if nt_r:
            nt.append({"date": d, **nt_r})
        if ot_cfg.get("enabled", True):
            ot_r = get_ot_history_reading(d, ot_cfg.get("anchor") or {})
            if ot_r:
                ot.append({"date": d, **ot_r})
        if pp_cfg.get("enabled", True):
            pp_r = get_poetry_prophecy_reading(d, pp_cfg.get("anchor") or {})
            if pp_r:
                pp.append({"date": d, **pp_r})

    week["nt"] = nt
    week["ot"] = ot
    week["pp"] = pp
    return week


def format_chapter_list(readings: list) -> str:
    """Turn [{book:'Mark', chapter:11}, ...] → 'Mark 11, Mark 12, ...'.
    Empty list → ''."""
    return ", ".join(f"{r['book']} {r['chapter']}" for r in readings)


# ── Prompt + LLM ──────────────────────────────────────────────────────
def build_icebreaker_prompt(week: dict) -> str:
    """Pure: same readings → same prompt. Tests assert prompt
    invariants (cap, no-paraphrase directive, no sermonic lift)."""
    pieces = []
    nt_list = format_chapter_list(week.get("nt") or [])
    ot_list = format_chapter_list(week.get("ot") or [])
    pp_list = format_chapter_list(week.get("pp") or [])
    if nt_list:
        pieces.append(f"New Testament walk: {nt_list}.")
    if ot_list:
        pieces.append(f"Old Testament history walk: {ot_list}.")
    if pp_list:
        pieces.append(f"Poetry & Prophecy walk: {pp_list}.")
    readings_block = "\n".join(pieces) if pieces else "(no readings configured)"

    return (
        "You are crafting a single warm icebreaker question for a "
        "Christian community Bible study group's Saturday discussion "
        "topic on Telegram. The group has been reading these chapters "
        f"this past week:\n\n{readings_block}\n\n"
        "Write ONE short, conversational icebreaker question (max "
        f"{QUESTION_MAX_CHARS} characters) that invites the group to "
        "discuss something specific from this week's reading. "
        "Constraints:\n"
        "- One question only. Do not include any preamble, intro, or "
        "  explanation.\n"
        "- Anchor the question in something concrete from the chapters: "
        "  a character, a moment, a tension, a recurring theme.\n"
        "- Cross-reference between Old and New Testament when natural — "
        "  that's a feature.\n"
        "- Someone should be able to answer in 1-2 sentences without "
        "  having read every chapter perfectly.\n"
        "- Do NOT use the question 'What stood out to you?' — that is "
        "  our default opener for in-person studies.\n"
        "- Do NOT be sermonic. Do NOT moralize. Do NOT add devotional "
        "  framing.\n"
        "- Output the question and nothing else.\n\n"
        "Question:"
    )


# ── Fallback question rotation ────────────────────────────────────────
# Used when GEMINI_API_KEY is missing, the API errors, the response is
# safety-blocked, or the response is malformed. Deterministic rotation
# by ISO week number so the same week always produces the same
# fallback (idempotency under retries / dedup replays).
FALLBACK_QUESTIONS = [
    "If you could ask one of the people in this week's reading a single question, who would it be and what would you ask?",
    "Which moment from this week's chapters has stayed with you the longest, and why do you think that is?",
    "Where did you notice God's character — His kindness, patience, justice, or mercy — show up most clearly this week?",
    "Was there anything in this week's reading that troubled you or didn't sit easily? Bring it here.",
    "If this week's chapters had a single sentence summary, what would yours be?",
]


def fallback_question(saturday_local: date) -> str:
    iso_week = saturday_local.isocalendar()[1]
    return FALLBACK_QUESTIONS[iso_week % len(FALLBACK_QUESTIONS)]


def llm_icebreaker(week: dict, api_key: str) -> str:
    """Pure-ish: builds the prompt, calls Gemini, returns '' on any
    failure. Caller is responsible for fallback."""
    if not api_key:
        return ""
    prompt = build_icebreaker_prompt(week)
    out = gemini_summarize.call_gemini_with_prompt(
        prompt, api_key,
        temperature=0.4,        # higher than summarizer for variety
        max_output_tokens=200,  # ~280 chars worth of text + slack
    )
    if not out:
        return ""
    out = out.strip().strip('"').strip("'").strip()
    if not out:
        return ""
    # Defensive cap: if the LLM ignored our request and returned 600
    # characters, hard-truncate at the last sentence boundary that
    # fits before QUESTION_MAX_CHARS, falling through to a hard slice
    # if no boundary exists.
    if len(out) <= QUESTION_MAX_CHARS:
        return out
    cut = out[:QUESTION_MAX_CHARS]
    last_q = max(cut.rfind("?"), cut.rfind("."), cut.rfind("!"))
    if last_q >= 80:  # require some minimum content before truncating
        return cut[: last_q + 1]
    return cut.rstrip() + "\u2026"


# ── Message rendering ─────────────────────────────────────────────────
def render_icebreaker_message(week: dict, question: str,
                              test_prefix: bool = False) -> str:
    """Build the MarkdownV2 message body. The reading list is
    displayed in italic blockquote so the eye lands on the question
    underneath. Every chapter reference goes through mdv2_escape;
    the format markers (* / _) are markup, not user content."""
    lines = []
    if test_prefix:
        # A clear, humble test header so a dispatched test message
        # is unmistakeably distinguishable from a real Saturday post.
        lines.append("⚙️ *\\(test\\) Saturday icebreaker preview*")
    else:
        lines.append("💬 *Saturday icebreaker*")
    lines.append("")

    # This week's reading lines. Each stream renders only if it has
    # entries — a config-disabled or anchor-out-of-range stream is
    # silently omitted.
    readings_lines = []
    if week.get("nt"):
        readings_lines.append(
            "_New Testament walk: " + mdv2_escape(format_chapter_list(week["nt"])) + "_"
        )
    if week.get("ot"):
        readings_lines.append(
            "_Old Testament history: " + mdv2_escape(format_chapter_list(week["ot"])) + "_"
        )
    if week.get("pp"):
        readings_lines.append(
            "_Poetry & Prophecy: " + mdv2_escape(format_chapter_list(week["pp"])) + "_"
        )
    if readings_lines:
        # Telegram MarkdownV2 blockquote: every line prefixed with '>'.
        for r in readings_lines:
            lines.append("> " + r)
        lines.append("")

    lines.append(mdv2_escape(question))
    lines.append("")
    lines.append("_Reply right here in this topic 👇_")

    return "\n".join(lines)


# ── Dedup log (shared with daily-bible bot) ──────────────────────────
def _load_dedup_log() -> dict:
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


def _already_posted(today_local: date, kind: str) -> bool:
    today_str = today_local.isoformat()
    for entry in _load_dedup_log().get("posts", []):
        if entry.get("date") == today_str and entry.get("kind") == kind and entry.get("ok"):
            return True
    return False


def _record_post(today_local: date, kind: str, ok: bool, detail: str = "") -> None:
    data = _load_dedup_log()
    posts = data.get("posts") or []
    cutoff = today_local - timedelta(days=30)
    posts = [p for p in posts if p.get("date", "") >= cutoff.isoformat()]
    posts.append({
        "date": today_local.isoformat(),
        "kind": kind,
        "ok": bool(ok),
        "detail": detail,
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    })
    data["posts"] = posts
    _save_dedup_log(data)


# ── Main ──────────────────────────────────────────────────────────────
def main() -> int:
    cfg = load_config()
    bible_cfg = cfg.get("bible") or {}
    if not bible_cfg.get("enabled", False):
        log("Bible bot disabled at top level; exiting 0.")
        return 0
    ice_cfg = bible_cfg.get("saturdayIcebreaker") or {}
    if not ice_cfg.get("enabled", False):
        log("Saturday icebreaker disabled in config; exiting 0.")
        return 0

    now_la = datetime.now(LA_TZ)
    today_local = now_la.date()

    # Saturdays only (unless TEST_RUN — then we synthesize a
    # 'recent Saturday' so admins can preview any day of the week).
    if not TEST_RUN and today_local.weekday() != 5:
        log(f"Today ({today_local}, weekday {today_local.weekday()}) is not Saturday; exiting 0.")
        return 0

    # In test mode on a non-Saturday, snap to the most recent Saturday
    # so the readings list still makes sense.
    target_saturday = today_local
    if TEST_RUN and today_local.weekday() != 5:
        days_back = (today_local.weekday() + 2) % 7  # back to last Saturday
        target_saturday = today_local - timedelta(days=days_back)

    # Dedup gate (skipped in TEST_RUN and FORCE_POST).
    if not TEST_RUN and not FORCE_POST and _already_posted(today_local, ICEBREAKER_KIND):
        log(f"Saturday icebreaker already posted on {today_local}; exiting 0.")
        return 0

    week = week_readings_for_saturday(target_saturday, cfg)
    total_readings = len(week["nt"]) + len(week["ot"]) + len(week["pp"])
    if total_readings == 0:
        log(f"No readings configured for week of {week['monday']}–{week['friday']}; skipping icebreaker.")
        return 0

    # Try LLM, fall back to rotation.
    summarizer_mode = str(ice_cfg.get("summarizer") or "llm").lower()
    question = ""
    if summarizer_mode == "llm":
        question = llm_icebreaker(week, GEMINI_API_KEY)
    if not question:
        question = fallback_question(target_saturday)

    text = render_icebreaker_message(week, question, test_prefix=TEST_RUN)

    chat_id = bible_cfg.get("chatId") or "@seedtheword"
    thread_id = int(ice_cfg.get("messageThreadId") or 434)

    if not BOT_TOKEN and not DRY_RUN:
        log("TELEGRAM_BIBLE_BOT_TOKEN missing and DRY_RUN unset; refusing to post.")
        return 1

    try:
        resp = send_telegram_message(
            BOT_TOKEN, chat_id, text,
            message_thread_id=thread_id,
            parse_mode="MarkdownV2",
            disable_web_page_preview=True,
            dry_run=DRY_RUN,
        )
    except Exception as e:
        log(f"sendMessage raised: {e}")
        if not TEST_RUN:
            _record_post(today_local, ICEBREAKER_KIND, ok=False, detail=str(e)[:200])
        return 1

    ok = bool(resp.get("ok"))
    if not ok:
        log(f"sendMessage returned non-ok: {resp}")
        if not TEST_RUN:
            _record_post(today_local, ICEBREAKER_KIND, ok=False, detail=json.dumps(resp)[:200])
        return 1

    log(f"Saturday icebreaker posted (test_run={TEST_RUN}, dry_run={DRY_RUN}).")
    if not TEST_RUN and not DRY_RUN:
        _record_post(today_local, ICEBREAKER_KIND, ok=True,
                     detail=f"thread {thread_id}, q='{question[:60]}...'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
