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
        raise
    except URLError as e:
        log(f"Telegram URL error: {e.reason}")
        raise


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
