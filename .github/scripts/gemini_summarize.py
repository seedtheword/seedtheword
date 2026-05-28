"""
Gemini-backed summarizer for the weekly prayer digest.

Optional layer over the rule-based `summarize()` in poll_prayer_topic.
When `prayer.digest.summarizer` in telegram-bot.json is set to "llm"
AND the GEMINI_API_KEY GitHub Secret is present, this module calls
Google AI Studio's REST endpoint for Gemini 2.5 Flash and returns a
1-2 sentence summary in the human's own voice. Otherwise (config flag
"rule-based", no key, network error, malformed response, content
filter trip), the caller falls back to the rule-based summarizer
without raising — the digest MUST always render.

Design constraints:
  * No new pip dependencies. urllib only, like every other script.
  * No external SDK. The REST endpoint is documented and stable.
  * Pure-ish: the public function takes (text, max_chars, api_key)
    and returns a string. No global state mutation. Network I/O is
    contained in `_call_gemini`. Everything else is testable.
  * The LLM output is ALWAYS passed through the rule-based
    summarizer before return so the length cap is mathematically
    enforced even if Gemini ignores the prompt's "under N chars"
    instruction.
  * `[private]`-tagged messages NEVER reach this module — they're
    filtered upstream by classify_message in the Poller (§8.1 of
    design.md). The `[anon]` resolution to "Anonymous" in the FROM
    field is also upstream; the LLM only sees post-strip body text.

Privacy model:
  Per the May 2026 ministry decision logged in this commit, prayer
  channel content already published to the public @seedtheword
  Telegram channel is allowed to be sent to Gemini for summarization.
  PrayerDrip (private email drip to the submitter) deliberately
  remains rule-based and never calls this module.

Public API:
  llm_summarize(text, max_chars, api_key, model='gemini-2.5-flash')
      → str. Empty string on failure (caller falls back).
  build_prompt(text, max_chars) → str. Pure, testable.
  parse_response(payload) → str. Pure, testable. Returns '' on
      malformed / safety-blocked responses.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from telegram_common import log  # type: ignore


# Google AI Studio REST endpoint. Free tier as of May 2026 supports
# Gemini 2.5 Flash with a generous per-day request budget that far
# exceeds our triweekly × 15-entry workload (~2,340 calls/year).
GEMINI_ENDPOINT_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent?key={key}"
)

# Conservative network timeout. Free tier latency is typically
# 1-3 seconds; 10s gives us margin without delaying the workflow.
GEMINI_TIMEOUT_SECONDS = 10


def build_prompt(text: str, max_chars: int) -> str:
    """Build the single-shot summarization prompt. Pure function so
    tests can assert prompt invariants (e.g. the prompt always
    includes the cap and the no-paraphrase instruction)."""
    return (
        "You are summarizing a prayer request or thanksgiving message "
        "for a community digest. Compress this message into ONE clear "
        f"sentence under {max_chars} characters. Keep the human's "
        "voice and concrete facts. Do NOT add interpretation, do NOT "
        "add 'praying for' or 'asks God for', do NOT paraphrase as a "
        "third-person request. Just compress what the person actually "
        "said. Output the summary sentence and nothing else — no "
        "preamble, no quotes, no commentary.\n\n"
        f"Message:\n{text}\n\nSummary:"
    )


def parse_response(payload: dict) -> str:
    """Extract the model's text from a Gemini generateContent response.
    Returns '' on any of:
      * No `candidates` array.
      * Candidate has finishReason == 'SAFETY' or 'RECITATION' or
        'OTHER' (content filter trips, model refusing).
      * Content has no text parts.
      * Any KeyError / TypeError from a malformed shape.

    Caller treats '' as "fall back to rule-based", per §13."""
    if not isinstance(payload, dict):
        return ""
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    cand = candidates[0]
    finish = (cand.get("finishReason") or "").upper()
    # 'STOP' and 'MAX_TOKENS' are normal; anything else is a refusal
    # or a problem we don't want to surface in the digest.
    if finish and finish not in {"STOP", "MAX_TOKENS"}:
        return ""
    content = cand.get("content") or {}
    parts = content.get("parts") or []
    text_chunks = []
    for part in parts:
        if isinstance(part, dict):
            t = part.get("text")
            if isinstance(t, str):
                text_chunks.append(t)
    return "".join(text_chunks).strip()


def _call_gemini(prompt: str, api_key: str, model: str) -> dict:
    """POST to Gemini generateContent. Raises HTTPError / URLError /
    TimeoutError on network problems; the caller catches and falls
    back to the rule-based summarizer.

    `temperature` is intentionally low (0.2) so the same input
    consistently produces the same shape of output across runs. We
    also cap output tokens — even at 256 tokens the response cost
    is well inside free tier."""
    url = GEMINI_ENDPOINT_TEMPLATE.format(model=model, key=api_key)
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.95,
            "maxOutputTokens": 256,
        },
    }
    data = json.dumps(body).encode("utf-8")
    req = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=GEMINI_TIMEOUT_SECONDS) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def llm_summarize(text: str, max_chars: int, api_key: str,
                  model: str = "gemini-2.5-flash") -> str:
    """Call Gemini and return a summary, or '' on any failure.

    Empty `api_key` short-circuits to '' without making a request —
    so the function is always safe to call; the caller decides
    whether to use the result or the rule-based fallback.

    The returned string is NOT length-capped here. The caller MUST
    pass the result through the rule-based `summarize()` before
    rendering, so the post-LLM string still satisfies P4 (length
    bound) even if Gemini exceeds the requested character cap."""
    if not text or not str(text).strip():
        return ""
    if not api_key:
        return ""
    prompt = build_prompt(text, max_chars)
    try:
        payload = _call_gemini(prompt, api_key, model)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as e:
        log(f"llm_summarize: API call failed ({type(e).__name__}); falling back")
        return ""
    except Exception as e:  # noqa: BLE001
        # Any other unexpected error — log loudly, return '' so the
        # digest still renders. We never want a Gemini hiccup to
        # block prayer requests from posting.
        log(f"llm_summarize: unexpected error ({type(e).__name__}: {e}); falling back")
        return ""
    return parse_response(payload)
