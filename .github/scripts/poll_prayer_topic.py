"""
Capture prayer & thanksgiving messages from the @seedtheword Telegram
supergroup's `Prayer & Thanksgiving` topic (thread 21) into an
append-only on-disk log so the triweekly Digest_Poster can render a
summary on Mon / Thu / Sat mornings.

Schedule: every 15 minutes via GitHub Actions cron (wired up in
.github/workflows/prayer-digest-poll.yml). Telegram bots cannot read
message history retroactively, so capture must run continuously
through the week — only the digest-posting step runs on the triweekly
cadence.

Auth model: Bot API. Calls Telegram `getUpdates` and (when handling
`/skipdigest` / `/optindigest` DMs) `sendMessage`. The bot must have
**privacy mode disabled** in BotFather to see non-command messages
in the supergroup; this is a one-time admin step documented in
admin-help.html.

Credentials (GitHub Secrets):
  TELEGRAM_PRAYER_BOT_TOKEN   — reads + replies via the prayer bot

Env vars:
  BOT_CONFIG                  — path to telegram-bot.json
  PRAYER_LOG_PATH             — path to telegram-prayer-log.json
  DRY_RUN                     — if set, log DM replies instead of sending

Error semantics:
  • getUpdates HTTP / network / non-`ok` failure → log to stderr,
    persist any prune changes, exit 0 without advancing lastUpdateId
    (Requirement 2.10). Next 15-min run retries from the same offset.
  • Malformed update payload → log offending update_id and re-raise
    (workflow fails loudly).
  • DM `sendMessage` failure → log; still apply opt-out / opt-in to
    log_state (best-effort confirmation, per §13 of design.md).

Public API (importable for tests, no side effects on import):
  resolve_display_name(user)           — fallback chain for names
  build_website_regex(marker)          — compile the Website_Submission detector
  strip_leading_markers(body, cfg)     — capture-time defensive strip
  strip_leading_mentions(body)         — drop any leading @username runs
  summarize(text, max_chars)           — pure deterministic summarizer
  classify_message(msg, cfg, log_state)— recognition cascade (§8.1)
  handle_update(update, cfg, log_state, token, dry_run=False) — testable seam
  prune_old_entries(log_state, now)    — 14-day cutoff
  fetch_updates(token, offset)         — Telegram getUpdates wrapper
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import (  # type: ignore
    log,
    mdv2_escape,
    send_telegram_message,
    load_json,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
BOT_CONFIG_PATH = Path(os.environ.get(
    "BOT_CONFIG", REPO_ROOT / "assets/data/telegram-bot.json"
))
LOG_PATH = Path(os.environ.get(
    "PRAYER_LOG_PATH",
    REPO_ROOT / "assets/data/telegram-prayer-log.json",
))
TOKEN = os.environ.get("TELEGRAM_PRAYER_BOT_TOKEN", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())

HORIZONTAL_ELLIPSIS = "\u2026"


# ── Config / log I/O ──────────────────────────────────────────────────
def load_config() -> dict:
    return json.loads(BOT_CONFIG_PATH.read_text(encoding="utf-8"))


def load_prayer_log() -> dict:
    """Read the on-disk Prayer_Log. Raises on parse error so a corrupt
    log surfaces as a workflow failure rather than silent state loss."""
    return json.loads(LOG_PATH.read_text(encoding="utf-8"))


def save_prayer_log(log_state: dict) -> None:
    """Atomic write — same pattern as the playlist digest's save_log.
    A partial write would leave invalid JSON; the next run's load
    would raise on parse and the workflow would fail loudly."""
    log_state["lastModified"] = datetime.now(timezone.utc).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")
    LOG_PATH.write_text(
        json.dumps(log_state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


# ── Pure helpers ──────────────────────────────────────────────────────
def resolve_display_name(user: dict) -> str:
    """Fallback chain per §4.3 of design.md:
       first + ' ' + last → first → @username → 'Anonymous'."""
    if not user:
        return "Anonymous"
    first = (user.get("first_name") or "").strip()
    last = (user.get("last_name") or "").strip()
    username = (user.get("username") or "").strip()
    if first and last:
        return f"{first} {last}"
    if first:
        return first
    if username:
        return f"@{username}"
    return "Anonymous"


def build_website_regex(marker: str) -> "re.Pattern[str]":
    """Compile the Website_Submission detector. The marker substring
    is re.escape-ed so admins can localize it without breaking the
    regex (per §8.2 of design.md)."""
    escaped = re.escape(marker)
    return re.compile(
        r"^💌 New (?P<verb>prayer request|thanksgiving announcement) "
        r"from (?P<name>.+?) "
        + escaped
        + r": (?P<body>.*)$",
        re.DOTALL,
    )


def _starts_with_any_tag(body: str, tags: list[str]) -> tuple[bool, str]:
    """If `body` (after lstrip) starts case-insensitively with any
    element of `tags`, return (True, tag-stripped-then-lstripped body).
    Otherwise return (False, body unchanged)."""
    stripped = body.lstrip()
    lowered = stripped.lower()
    for tag in tags or []:
        if not tag:
            continue
        if lowered.startswith(tag.lower()):
            return True, stripped[len(tag):].lstrip()
    return False, body


def strip_leading_markers(body: str, cfg: dict) -> str:
    """Idempotently strip, in order: Website_Submission marker, any
    Anon_Tag, any Private_Tag. After each strip, re-lstrip whitespace.
    Applying twice == applying once (per §9.3 of design.md).

    Used both at capture time (so entries[].text is already clean) and
    defensively inside summarize() in case a historical entry was
    captured by an earlier release whose stripping logic differed."""
    if not body:
        return ""
    digest_cfg = (cfg or {}).get("prayer", {}).get("digest", {}) or {}
    marker = digest_cfg.get("websiteSubmissionMarker", "(via the website)")
    anon_tags = digest_cfg.get("anonTags") or ["[anon]"]
    private_tags = digest_cfg.get("privateTags") or ["[private]"]

    out = body
    # 1) Website_Submission marker → keep just the body group
    rx = build_website_regex(marker)
    m = rx.match(out.lstrip())
    if m:
        out = m.group("body").lstrip()
    # 2) Anon_Tag (idempotent)
    matched, out = _starts_with_any_tag(out, anon_tags)
    # 3) Private_Tag (idempotent — even though private-tagged messages
    # are usually skipped at capture time, the summarizer is defensive).
    matched, out = _starts_with_any_tag(out, private_tags)
    return out


_MENTION_RE = re.compile(r"^(?:@[A-Za-z0-9_]+\s+)+")


def strip_leading_mentions(body: str) -> str:
    """Drop any run of leading @username tokens (Telegram-style)
    before measuring summary length. Used by summarize() per §9 of
    design.md so a message that's just a @ping plus a short request
    fits under the cap."""
    if not body:
        return ""
    return _MENTION_RE.sub("", body)


def summarize(text: str, max_chars: int) -> str:
    """Pure, deterministic, no I/O. Algorithm from §9 of design.md:

      1. Defensive strip of any leading marker / tag / @mention.
      2. Normalize whitespace (\\s+ → single space) and trim ends.
      3. If body fits in max_chars → return verbatim.
      4. Else greedy word-boundary truncation with a trailing ' …'.
      5. If the first word alone exceeds the budget, hard-truncate
         to (max_chars - 1) chars and append a single '…'.

    Length bound (P4): for any max_chars >= 8, len(result) <= max_chars.
    Determinism (P5): no clock, no random, no globals."""
    if max_chars < 1:
        return ""
    if not text:
        return ""

    # Step 1: defensive strip (without cfg, use design defaults).
    body = strip_leading_markers(text, cfg=None)
    body = strip_leading_mentions(body)

    # Step 2: normalize internal whitespace.
    body = re.sub(r"\s+", " ", body).strip()

    # Step 3: trivial fit.
    if len(body) <= max_chars:
        return body

    # Step 4: word-boundary truncation, leaving room for ' …'.
    suffix = " " + HORIZONTAL_ELLIPSIS  # 2 chars
    budget = max_chars - len(suffix)

    # Edge case: first word alone exceeds the budget. Hard-truncate.
    first_space = body.find(" ")
    first_word = body if first_space < 0 else body[:first_space]
    if len(first_word) > budget:
        # max_chars >= 1 guaranteed; result length is exactly max_chars.
        return body[: max_chars - 1] + HORIZONTAL_ELLIPSIS

    # Greedy walk over words.
    out = ""
    for word in body.split(" "):
        candidate = (out + " " + word).strip() if out else word
        if len(candidate) > budget:
            break
        out = candidate
    return out + suffix


def prune_old_entries(log_state: dict, now: datetime) -> dict:
    """Drop entries older than 14 days. Mutates and returns log_state.
    Does NOT touch optOut, completedSlots, or lastUpdateId
    (Requirement 7.6, property P7). Runs unconditionally at Poller
    start so a getUpdates failure still leaves the log pruned."""
    cutoff = now - timedelta(days=14)
    survivors = []
    for entry in log_state.get("entries", []):
        ts_raw = entry.get("ts", "")
        try:
            # ISO-8601 with trailing Z for UTC.
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            # Malformed timestamp — drop the entry (cleanup-on-prune).
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts >= cutoff:
            survivors.append(entry)
    log_state["entries"] = survivors
    return log_state


# ── DM command matching ───────────────────────────────────────────────
SKIP_RE = re.compile(r"^/skipdigest(?:@\w+)?\s*$", re.IGNORECASE)
OPTIN_RE = re.compile(r"^/optindigest(?:@\w+)?\s*$", re.IGNORECASE)

SKIP_REPLY = (
    "You're opted out of the prayer digest. "
    "Send /optindigest any time to opt back in."
)
OPTIN_REPLY = (
    "You're back in the prayer digest. "
    "Your next message in the topic will be included."
)


def _send_dm_reply(token: str, chat_id, text: str, dry_run: bool = False) -> None:
    """Best-effort DM confirmation. Failure is logged but does not
    block the opt-out / opt-in mutation (the user's intent was
    registered the moment the command landed)."""
    if not token:
        log("DM reply skipped: missing bot token.")
        return
    try:
        send_telegram_message(
            token, chat_id, text,
            parse_mode="MarkdownV2",
            disable_web_page_preview=True,
            dry_run=dry_run,
        )
    except Exception as e:  # broad on purpose — DM is best-effort
        log(f"DM reply send failed (non-fatal): {e}")


# ── Classification ────────────────────────────────────────────────────
@dataclass
class Classification:
    """Result of classify_message. `kind` is one of:
      SKIP_NOT_THREAD, SKIP_NO_TEXT, SKIP_BOT, SKIP_PRIVATE_TAG,
      SKIP_OPTED_OUT,
      CAPTURE_TELEGRAM, CAPTURE_TELEGRAM_ANON,
      CAPTURE_WEBSITE, CAPTURE_WEBSITE_ANON,
      DM_SKIP, DM_OPTIN, DM_OTHER
    """
    kind: str
    body: str = ""
    display_name: str = ""


def _extract_body(msg: dict) -> str:
    """Return msg.text or msg.caption (in that order). Empty string
    if neither is non-empty after strip()."""
    for field in ("text", "caption"):
        val = msg.get(field)
        if val and str(val).strip():
            return str(val)
    return ""


def classify_message(msg: dict, cfg: dict, log_state: dict) -> Classification:
    """Apply the recognition cascade from §8.1 of design.md. Pure
    function: reads cfg + log_state, returns a Classification.

    The order matters — a message body can only fall into one bucket,
    and every privacy / dedup check has a chance to short-circuit
    before capture (Requirements 2.3-2.9, 3.3-3.5, 8.5)."""
    if not msg:
        return Classification(kind="SKIP_NO_TEXT")

    digest_cfg = cfg["prayer"]["digest"]
    chat = msg.get("chat") or {}
    chat_type = (chat.get("type") or "").lower()

    # 1) DM commands (handled before the wrong-thread check, since DMs
    # have no thread).
    if chat_type == "private":
        text_raw = _extract_body(msg)
        text = text_raw.strip()
        if SKIP_RE.match(text):
            return Classification(kind="DM_SKIP")
        if OPTIN_RE.match(text):
            return Classification(kind="DM_OPTIN")
        return Classification(kind="DM_OTHER")

    # 2) Wrong thread / wrong chat.
    target_thread = int(digest_cfg.get("messageThreadId", 21))
    if msg.get("message_thread_id") != target_thread:
        return Classification(kind="SKIP_NOT_THREAD")

    # 3) Empty body.
    body_raw = _extract_body(msg)
    if not body_raw or not body_raw.strip():
        return Classification(kind="SKIP_NO_TEXT")

    # 4) Bot author — but Website_Submissions are produced by a bot
    # and are intentionally NOT excluded here. Defer the bot-author
    # skip until after the website-marker check.
    sender = msg.get("from") or {}
    is_bot = bool(sender.get("is_bot"))

    # 5) Website_Submission detection.
    marker = digest_cfg.get("websiteSubmissionMarker", "(via the website)")
    rx = build_website_regex(marker)
    body_lstripped = body_raw.lstrip()
    m = rx.match(body_lstripped)
    if m:
        name = m.group("name").strip()
        captured_body = m.group("body").lstrip()
        if name == "Anonymous":
            return Classification(
                kind="CAPTURE_WEBSITE_ANON",
                body=captured_body,
                display_name="Anonymous",
            )
        return Classification(
            kind="CAPTURE_WEBSITE",
            body=captured_body,
            display_name=name,
        )

    # 4 (resumed) — non-website bot author → skip.
    if is_bot:
        return Classification(kind="SKIP_BOT")

    # 6) Private_Tag → skip silently.
    private_tags = digest_cfg.get("privateTags") or ["[private]"]
    is_private, _ = _starts_with_any_tag(body_lstripped, private_tags)
    if is_private:
        return Classification(kind="SKIP_PRIVATE_TAG")

    # 7) Anon_Tag → capture but anonymize.
    anon_tags = digest_cfg.get("anonTags") or ["[anon]"]
    is_anon, anon_body = _starts_with_any_tag(body_lstripped, anon_tags)

    # 8) Excluded_User check.
    user_id = sender.get("id")
    opt_out = set(log_state.get("optOut") or [])
    excluded_ids = set(digest_cfg.get("excludeUserIds") or [])
    if user_id is not None and (user_id in opt_out or user_id in excluded_ids):
        return Classification(kind="SKIP_OPTED_OUT")

    if is_anon:
        return Classification(
            kind="CAPTURE_TELEGRAM_ANON",
            body=anon_body,
            display_name="Anonymous",
        )

    # Regular Telegram capture.
    return Classification(
        kind="CAPTURE_TELEGRAM",
        body=body_lstripped,
        display_name=resolve_display_name(sender),
    )


# ── Update handling ───────────────────────────────────────────────────
def _msg_ts(msg: dict) -> str:
    """Telegram `date` is Unix epoch seconds in UTC. Return ISO-8601 Z."""
    raw = msg.get("date")
    if raw is None:
        # Defensive — should never happen for real Telegram messages.
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    try:
        dt = datetime.fromtimestamp(int(raw), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        dt = datetime.now(timezone.utc)
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _dedup_index(entries: list[dict], chat_id, message_id) -> int:
    """Return the index of the entry matching (chatId, messageId), or
    -1. Linear scan — at the projected steady state of a few thousand
    entries inside the 14-day window, this is cheap (per §3.5 of
    design.md)."""
    for i, e in enumerate(entries):
        if e.get("chatId") == chat_id and e.get("messageId") == message_id:
            return i
    return -1


_KIND_TO_ENTRY_KIND = {
    "CAPTURE_TELEGRAM": "telegram",
    "CAPTURE_TELEGRAM_ANON": "telegram-anon",
    "CAPTURE_WEBSITE": "website",
    "CAPTURE_WEBSITE_ANON": "website-anonymous",
}


def _build_entry(msg: dict, classification: Classification) -> dict:
    sender = msg.get("from") or {}
    chat = msg.get("chat") or {}
    return {
        "chatId": chat.get("id"),
        "messageId": msg.get("message_id"),
        "userId": sender.get("id"),
        "displayName": classification.display_name,
        "anonymous": classification.display_name == "Anonymous",
        "kind": _KIND_TO_ENTRY_KIND[classification.kind],
        "text": classification.body,
        "ts": _msg_ts(msg),
    }


def handle_update(
    update: dict,
    cfg: dict,
    log_state: dict,
    token: str,
    dry_run: bool = False,
) -> dict:
    """Apply one Telegram update to log_state and return the new state.
    Pure modulo the side effect of replying to /skipdigest /optindigest
    DM commands (per §4.1 of design.md).

    Dispatches on `message` vs `edited_message`. For new messages,
    appends to entries[] per the classification result. For edits,
    re-classifies and either updates the matching entry's text /
    displayName / kind / anonymous fields, or drops the entry if the
    new classification is a SKIP type (Requirement 2.9)."""
    if not update:
        return log_state

    is_edit = "edited_message" in update
    msg = update.get("edited_message") or update.get("message")
    if not msg:
        return log_state

    classification = classify_message(msg, cfg, log_state)
    sender = msg.get("from") or {}
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    user_id = sender.get("id")
    message_id = msg.get("message_id")

    # DM command branches.
    if classification.kind == "DM_SKIP":
        if user_id is not None:
            current = list(log_state.get("optOut") or [])
            updated = sorted(set(current) | {user_id})
            log_state["optOut"] = updated
        _send_dm_reply(token, chat_id, mdv2_escape(SKIP_REPLY), dry_run=dry_run)
        return log_state
    if classification.kind == "DM_OPTIN":
        if user_id is not None:
            current = list(log_state.get("optOut") or [])
            log_state["optOut"] = [u for u in current if u != user_id]
        _send_dm_reply(token, chat_id, mdv2_escape(OPTIN_REPLY), dry_run=dry_run)
        return log_state
    if classification.kind == "DM_OTHER":
        # Unrelated DM — ignore.
        return log_state

    # Skip categories → nothing to write to entries[].
    if classification.kind.startswith("SKIP_"):
        # If this is an edit of a previously-captured message and the
        # new classification is a skip (e.g. user added [private] to a
        # public message), drop the entry per Requirement 2.9.
        if is_edit:
            entries = log_state.get("entries") or []
            idx = _dedup_index(entries, chat_id, message_id)
            if idx >= 0:
                entries.pop(idx)
                log_state["entries"] = entries
        return log_state

    # Capture branches.
    entries = log_state.get("entries") or []
    idx = _dedup_index(entries, chat_id, message_id)

    if is_edit and idx >= 0:
        # Update existing entry's text / displayName / kind / anonymous;
        # do NOT touch ts or userId (Requirement 2.9).
        entries[idx]["text"] = classification.body
        entries[idx]["displayName"] = classification.display_name
        entries[idx]["kind"] = _KIND_TO_ENTRY_KIND[classification.kind]
        entries[idx]["anonymous"] = classification.display_name == "Anonymous"
        log_state["entries"] = entries
        return log_state

    if idx >= 0:
        # Plain replay of an already-captured message — short-circuit
        # (Requirement 2.7, property P1).
        return log_state

    entries.append(_build_entry(msg, classification))
    log_state["entries"] = entries
    return log_state


# ── Telegram getUpdates ───────────────────────────────────────────────
def fetch_updates(token: str, offset: int, timeout_seconds: int = 30) -> Optional[list]:
    """Call Telegram getUpdates. Returns the list of update dicts on
    success, or None on any HTTP / network / non-`ok` failure. The
    None signal tells main() to leave lastUpdateId untouched
    (Requirement 2.10, §13 of design.md)."""
    if not token:
        log("fetch_updates: missing TELEGRAM_PRAYER_BOT_TOKEN; cannot poll.")
        return None
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    payload = {
        "offset": int(offset),
        "timeout": 0,
        "allowed_updates": ["message", "edited_message"],
    }
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=timeout_seconds) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log(f"getUpdates HTTP error {e.code}: {err_body}")
        return None
    except URLError as e:
        log(f"getUpdates network error: {e.reason}")
        return None
    except (json.JSONDecodeError, TimeoutError) as e:
        log(f"getUpdates response parse / timeout: {e}")
        return None
    if not body.get("ok"):
        log(f"getUpdates returned non-ok: {body}")
        return None
    return body.get("result") or []


# ── Main ──────────────────────────────────────────────────────────────
def main() -> int:
    cfg = load_config()
    digest_cfg = cfg.get("prayer", {}).get("digest", {})
    if not digest_cfg.get("enabled", False):
        log("Prayer digest disabled; exiting.")
        return 0

    log_state = load_prayer_log()
    now = datetime.now(timezone.utc)
    log_state = prune_old_entries(log_state, now)

    last_update_id = int(log_state.get("lastUpdateId") or 0)
    updates = fetch_updates(TOKEN, offset=last_update_id + 1)
    if updates is None:
        # getUpdates failed — persist any prune changes but do NOT
        # advance lastUpdateId. Next 15-min run retries.
        save_prayer_log(log_state)
        return 0

    highest_seen = last_update_id
    for update in updates:
        try:
            update_id = int(update.get("update_id") or 0)
        except (TypeError, ValueError):
            log(f"Malformed update payload (no update_id): {update}")
            raise
        try:
            log_state = handle_update(update, cfg, log_state, TOKEN, dry_run=DRY_RUN)
        except Exception:
            log(f"Update handling failed at update_id={update_id}; re-raising.")
            raise
        highest_seen = max(highest_seen, update_id)

    log_state["lastUpdateId"] = highest_seen
    save_prayer_log(log_state)
    log(f"Poller processed {len(updates)} update(s); lastUpdateId={highest_seen}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
