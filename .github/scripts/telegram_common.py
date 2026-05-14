"""
Shared helpers used by every Telegram-posting script in this repo.

Includes:
  * MarkdownV2 escaping
  * A small HTML→text stripper that matches the frontend's
    stripHtmlToText behavior
  * smart_trim for word-boundary-aware truncation
  * send_telegram_message that takes the bot token as an argument so
    each script uses its own bot
"""
from __future__ import annotations

import json
import os
import re
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


# MarkdownV2 reserved chars — escape when used as literal text
MDV2_SPECIAL = r"_*[]()~`>#+\-=|{}.!"


def log(msg: str) -> None:
    print(msg, flush=True)


def mdv2_escape(text) -> str:
    if not text:
        return ""
    return re.sub(f"([{re.escape(MDV2_SPECIAL)}])", r"\\\1", str(text))


ENTITY_MAP = {
    "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&hellip;": "…",
    "&mdash;": "—", "&ndash;": "–",
}


def strip_html(html) -> str:
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


def edit_forum_topic(
    token: str,
    chat_id,
    message_thread_id: int,
    name: Optional[str] = None,
    icon_custom_emoji_id: Optional[str] = None,
    dry_run: bool = False,
) -> dict:
    """Rename / re-icon a forum topic. Requires the bot to be an admin
    of the chat with the 'Manage topics' permission. Logs and returns
    the API response without raising on failure — caller decides
    whether topic rename failures should fail the whole job."""
    if dry_run:
        log(f"[DRY_RUN] Would rename thread {message_thread_id} in {chat_id} to {name!r}")
        return {"ok": True, "dry_run": True}
    if not token:
        log("edit_forum_topic: missing bot token; skipping rename.")
        return {"ok": False, "skipped": True}
    if not message_thread_id:
        log("edit_forum_topic: no message_thread_id; skipping rename.")
        return {"ok": False, "skipped": True}
    url = f"https://api.telegram.org/bot{token}/editForumTopic"
    payload = {
        "chat_id": str(chat_id),
        "message_thread_id": int(message_thread_id),
    }
    if name is not None:
        payload["name"] = str(name)[:128]  # Telegram caps topic names at 128 chars
    if icon_custom_emoji_id is not None:
        payload["icon_custom_emoji_id"] = str(icon_custom_emoji_id)
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log(f"editForumTopic API error {e.code}: {body}")
        _explain_edit_topic_error(e.code, body, chat_id, message_thread_id)
        return {"ok": False, "error_code": e.code, "description": body}
    except URLError as e:
        log(f"editForumTopic URL error: {e.reason}")
        return {"ok": False, "error": str(e.reason)}


def _explain_edit_topic_error(code: int, body: str, chat_id, thread_id) -> None:
    b = (body or "").lower()
    if code == 400 and "topic_not_modified" in b:
        # The topic already has the requested name. Not an error in any
        # meaningful sense — just no-op.
        log("editForumTopic: topic already has the target name (no-op).")
    elif code == 400 and ("not enough rights" in b or "manage_topics" in b):
        log("")
        log(f"FIX: Bot lacks 'Manage topics' admin permission in {chat_id!r}.")
        log("   1. Open Telegram → group title → Administrators → tap the bot.")
        log("   2. Toggle 'Manage Topics' ON.")
        log("   3. Save and re-run.")
        log("")
    elif code == 400 and "message thread not found" in b:
        log("")
        log(f"FIX: thread {thread_id} doesn't exist in {chat_id!r}. Update")
        log("   bible.todayChapterTopic.messageThreadId in telegram-bot.json.")
        log("")


def send_telegram_message(
    token: str,
    chat_id,
    text: str,
    message_thread_id: Optional[int] = None,
    parse_mode: str = "MarkdownV2",
    disable_web_page_preview: bool = False,
    dry_run: bool = False,
) -> dict:
    if dry_run:
        log("[DRY_RUN] Would send to %s (thread %s):\n%s\n" % (chat_id, message_thread_id, text))
        return {"ok": True, "dry_run": True}
    if not token:
        raise SystemExit("Missing bot token; aborting.")
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": str(chat_id),
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": disable_web_page_preview,
    }
    if message_thread_id:
        payload["message_thread_id"] = int(message_thread_id)
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log(f"Telegram API error {e.code}: {body}")
        _explain_telegram_error(e.code, body, chat_id, message_thread_id)
        raise
    except URLError as e:
        log(f"Telegram URL error: {e.reason}")
        raise


def _explain_telegram_error(code: int, body: str, chat_id, thread_id) -> None:
    """Log a plain-English walkthrough for common Telegram API errors so
    admins don't have to decode raw error strings to fix the problem."""
    b = (body or "").lower()
    if code == 403 and "not a member" in b:
        log("")
        log(f"FIX: The bot account is not in the chat {chat_id!r}.")
        log("   1. Open Telegram, go to the target group/channel.")
        log("   2. Tap the title → Members (or Subscribers) → Add Member.")
        log("   3. Search for the bot by its @username (from BotFather → /mybots).")
        log("   4. Add it, then tap the bot → Promote to Admin.")
        log("   5. Toggle 'Post Messages' ON. If the chat has topics, also")
        log("      toggle 'Manage Topics' ON so the bot can post into a thread.")
        log("   6. Re-run this workflow. The 403 will clear.")
        log("")
    elif code == 403 and "blocked" in b:
        log("")
        log("FIX: The bot was blocked by the user/chat. Unblock it in Telegram:")
        log(f"   open the {chat_id!r} chat → tap title → unblock bot, then re-run.")
        log("")
    elif code == 400 and thread_id and "message thread not found" in b:
        log("")
        log(f"FIX: messageThreadId {thread_id} does not exist in {chat_id!r}.")
        log("   1. In Telegram, open the target topic — the URL looks like")
        log("      https://t.me/<chat>/<threadId>/<messageId>. The middle")
        log("      number is the thread id.")
        log("   2. Update messageThreadId in assets/data/telegram-bot.json")
        log("      (Editor → Telegram bot config → the relevant bot section).")
        log("")
    elif code == 400 and "can't parse entities" in b:
        log("")
        log("FIX: The message has a MarkdownV2 formatting issue. Telegram's")
        log("   description above says which character it choked on. Usually")
        log("   this means an unescaped special character inside a link or")
        log("   italic run. Re-run with dry_run=true to see the raw payload,")
        log("   then look at the line number Telegram quoted.")
        log("")


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
