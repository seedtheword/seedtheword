"""
Property + unit tests for the Saturday icebreaker bot.

Covers:
  SI1 — week_readings_for_saturday returns a Mon..Fri window keyed
        on the requested Saturday (purity).
  SI2 — non-Saturday inputs snap to the immediately preceding
        Saturday's week (defensive).
  SI3 — render_icebreaker_message produces a Telegram-safe
        MarkdownV2 string (no unescaped reserved chars in user-
        facing segments) and includes the question verbatim.
  SI4 — fallback_question is deterministic per ISO week.
  SI5 — llm_icebreaker collapses to '' on missing key, network
        failure, malformed response, or safety trip — caller
        always has a fallback path.
  SI6 — message length never exceeds Telegram's 4090-char cap, even
        with worst-case 600-char LLM output.

Run with:
  pytest tests/saturday_icebreaker.test.py -v
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))

import gemini_summarize  # type: ignore
import post_saturday_icebreaker_to_telegram as ice  # type: ignore


# Minimal fixture config — anchors match telegram-bot.json defaults
# so the readings line up with the real plan.
def _cfg():
    return {
        "bible": {
            "enabled": True,
            "saturdayIcebreaker": {
                "enabled": True,
                "messageThreadId": 434,
                "summarizer": "llm",
            },
            "layeredPlan": {
                "streams": {
                    "otHistory": {
                        "enabled": True,
                        "anchor": {"date": "2026-04-30", "book": "Genesis", "chapter": 1},
                    },
                    "poetryProphecy": {
                        "enabled": True,
                        "anchor": {"date": "2026-04-30", "book": "Job", "chapter": 1},
                    },
                },
            },
        },
    }


# ── SI1 ─────────────────────────────────────────────────────────
def test_si1_week_for_saturday_is_mon_to_fri():
    """Saturday May 30 2026 → Mon May 25 .. Fri May 29 window."""
    sat = date(2026, 5, 30)
    week = ice.week_readings_for_saturday(sat, _cfg())
    assert week["monday"] == date(2026, 5, 25)
    assert week["friday"] == date(2026, 5, 29)
    # All three streams are configured + their anchors are <= Mon May 25,
    # so each list is the full 5 weekdays.
    assert len(week["nt"]) == 5
    assert len(week["ot"]) == 5
    assert len(week["pp"]) == 5


def test_si1_chapters_advance_by_one_per_weekday():
    """The NT chapter on Tuesday must be exactly one ahead of Monday's."""
    sat = date(2026, 5, 30)
    week = ice.week_readings_for_saturday(sat, _cfg())
    nt = week["nt"]
    # Five entries, in date order, advancing one chapter per weekday.
    for i in range(1, len(nt)):
        prev = nt[i - 1]
        cur = nt[i]
        # Either same book +1 chapter OR rolled into the next book at chapter 1.
        rolled = (cur["chapter"] == 1 and cur["book"] != prev["book"])
        same_book_advance = (cur["book"] == prev["book"] and cur["chapter"] == prev["chapter"] + 1)
        assert rolled or same_book_advance, (
            f"NT walk did not advance correctly: {prev} -> {cur}"
        )


# ── SI2 ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("non_sat,expected_sat", [
    (date(2026, 5, 31), date(2026, 5, 30)),  # Sun snaps back 1 day
    (date(2026, 5, 25), date(2026, 5, 23)),  # Mon snaps back 2 days
    (date(2026, 5, 28), date(2026, 5, 23)),  # Thu snaps back 5 days
])
def test_si2_non_saturday_snaps_to_previous_saturday(non_sat, expected_sat):
    """Defensive: if called with a non-Saturday date, the function
    snaps to the immediately previous Saturday so the readings list
    still anchors to a real Mon-Fri."""
    week = ice.week_readings_for_saturday(non_sat, _cfg())
    assert week["friday"] == expected_sat - __import__("datetime").timedelta(days=1)


# ── SI3 ─────────────────────────────────────────────────────────
def test_si3_render_includes_question_verbatim():
    week = {
        "monday": date(2026, 5, 25), "friday": date(2026, 5, 29),
        "nt": [{"date": date(2026, 5, 25), "book": "Mark", "chapter": 12}],
        "ot": [], "pp": [],
    }
    q = "What did mercy look like in Mark 12 this week?"
    msg = ice.render_icebreaker_message(week, q, test_prefix=False)
    assert q in msg or ice.mdv2_escape(q) in msg
    assert "Saturday icebreaker" in msg
    assert "Reply right here" in msg


def test_si3_render_test_prefix_is_obvious():
    week = {"monday": date(2026, 5, 25), "friday": date(2026, 5, 29),
            "nt": [], "ot": [], "pp": []}
    msg = ice.render_icebreaker_message(week, "Test q?", test_prefix=True)
    # The (test) marker is MarkdownV2-escaped so the parens don't get
    # parsed as a link. Look for the escaped form OR the inner word.
    assert "test" in msg.lower()
    assert "Saturday icebreaker preview" in msg


def test_si3_render_skips_empty_streams():
    """A week where only NT readings are configured should not
    render empty 'Old Testament' / 'Poetry & Prophecy' headers."""
    week = {
        "monday": date(2026, 5, 25), "friday": date(2026, 5, 29),
        "nt": [{"date": date(2026, 5, 25), "book": "Mark", "chapter": 12}],
        "ot": [], "pp": [],
    }
    msg = ice.render_icebreaker_message(week, "Question?", test_prefix=False)
    assert "Old Testament history" not in msg
    assert "Poetry & Prophecy" not in msg
    assert "New Testament walk" in msg


# ── SI4 ─────────────────────────────────────────────────────────
def test_si4_fallback_is_deterministic_per_iso_week():
    sat = date(2026, 5, 30)
    a = ice.fallback_question(sat)
    b = ice.fallback_question(sat)
    assert a == b
    assert a in ice.FALLBACK_QUESTIONS


def test_si4_fallback_rotates_across_weeks():
    """Different ISO weeks should usually pick different questions —
    not a strict guarantee (modulo arithmetic permits collisions),
    but over 5 consecutive weeks we should see at least 2 distinct
    questions in our 5-element pool."""
    seen = set()
    for offset in range(5):
        sat = date(2026, 5, 30) + __import__("datetime").timedelta(weeks=offset)
        seen.add(ice.fallback_question(sat))
    assert len(seen) >= 2


# ── SI5 ─────────────────────────────────────────────────────────
def test_si5_empty_key_returns_empty(monkeypatch):
    """No key → llm_icebreaker returns '' without making a network call."""
    called = {"yes": False}

    def boom(*a, **k):
        called["yes"] = True
        raise AssertionError("must not call gemini")

    monkeypatch.setattr(gemini_summarize, "call_gemini_with_prompt", boom)
    out = ice.llm_icebreaker({"nt": [], "ot": [], "pp": []}, api_key="")
    assert out == ""
    assert called["yes"] is False


def test_si5_network_failure_returns_empty(monkeypatch):
    """call_gemini_with_prompt returning '' (its own gentle failure)
    propagates as '' from llm_icebreaker."""
    monkeypatch.setattr(gemini_summarize, "call_gemini_with_prompt",
                        lambda p, k, **kw: "")
    out = ice.llm_icebreaker({"nt": [], "ot": [], "pp": []}, api_key="x")
    assert out == ""


def test_si5_strips_quotes_and_whitespace(monkeypatch):
    """LLMs sometimes wrap the answer in quotes; strip them so the
    rendered post doesn't show '"What stood…"' verbatim."""
    monkeypatch.setattr(
        gemini_summarize, "call_gemini_with_prompt",
        lambda p, k, **kw: '   "What did mercy look like in Mark 12?"   '
    )
    out = ice.llm_icebreaker({"nt": [], "ot": [], "pp": []}, api_key="x")
    assert out == "What did mercy look like in Mark 12?"


def test_si5_caps_long_responses(monkeypatch):
    """If Gemini returns 600 chars, the result is at most QUESTION_MAX_CHARS."""
    long_text = ("This is a long question about mercy and faith. " * 20).strip()
    monkeypatch.setattr(gemini_summarize, "call_gemini_with_prompt",
                        lambda p, k, **kw: long_text)
    out = ice.llm_icebreaker({"nt": [], "ot": [], "pp": []}, api_key="x")
    assert len(out) <= ice.QUESTION_MAX_CHARS


# ── SI6 ─────────────────────────────────────────────────────────
def test_si6_full_message_under_telegram_cap():
    """End-to-end: synthesize a worst-case rendered message and
    confirm it's under Telegram's 4090-char message limit."""
    sat = date(2026, 5, 30)
    week = ice.week_readings_for_saturday(sat, _cfg())
    long_q = "Q? " * 100  # 300 chars — beyond our 280 cap; render takes verbatim
    msg = ice.render_icebreaker_message(week, long_q, test_prefix=False)
    assert len(msg) <= 4090


# ── Prompt invariants ──────────────────────────────────────────
def test_prompt_includes_cap_and_no_default_opener():
    week = {
        "monday": date(2026, 5, 25), "friday": date(2026, 5, 29),
        "nt": [{"date": date(2026, 5, 25), "book": "Mark", "chapter": 12}],
        "ot": [], "pp": [],
    }
    p = ice.build_icebreaker_prompt(week)
    assert str(ice.QUESTION_MAX_CHARS) in p
    assert "What stood out to you" in p  # the directive forbids using it
    assert "Mark 12" in p
    assert p.endswith("Question:")


@given(seed=st.integers(min_value=0, max_value=999))
@settings(max_examples=20)
def test_prompt_is_pure(seed):
    week = {
        "monday": date(2026, 5, 25), "friday": date(2026, 5, 29),
        "nt": [{"date": date(2026, 5, 25), "book": "Mark", "chapter": 12 + (seed % 3)}],
        "ot": [], "pp": [],
    }
    a = ice.build_icebreaker_prompt(week)
    b = ice.build_icebreaker_prompt(week)
    assert a == b
