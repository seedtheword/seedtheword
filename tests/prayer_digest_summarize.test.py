"""
Property tests P4 + P5 for the weekly-prayer-digest summarizer.

Run with:
  pytest tests/prayer_digest_summarize.test.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))

from hypothesis import given, settings
from hypothesis import strategies as st

from poll_prayer_topic import summarize  # type: ignore


@given(text=st.text(), max_chars=st.integers(min_value=8, max_value=500))
def test_p4_length_bound(text, max_chars):
    """Feature: weekly-prayer-digest, Property 4: summary length bound.

    Validates: Requirement 4.2.

    For all captured message texts and all summaryMaxChars >= 8, the
    summarizer's output is at most summaryMaxChars long, counting any
    trailing ellipsis."""
    out = summarize(text, max_chars)
    assert len(out) <= max_chars, (len(out), max_chars, repr(out), repr(text))


@given(text=st.text(), max_chars=st.integers(min_value=8, max_value=500))
@settings(max_examples=200)
def test_p5_determinism(text, max_chars):
    """Feature: weekly-prayer-digest, Property 5: summarizer determinism.

    Validates: Requirements 4.3, 4.4, 4.5, 4.6.

    Calling summarize twice with the same inputs in the same process
    returns string-equal outputs. The summarizer reads no clock, no
    random source, no network, no global mutable state."""
    assert summarize(text, max_chars) == summarize(text, max_chars)


def test_trivial_fit_returns_verbatim():
    """Sanity check — bodies that fit the cap are returned verbatim
    (Requirement 4.4)."""
    assert summarize("Pray for John", 60) == "Pray for John"


def test_empty_input_returns_empty():
    assert summarize("", 60) == ""
    assert summarize(None, 60) == ""  # type: ignore


def test_truncation_appends_horizontal_ellipsis():
    text = "I just got news that my mom needs surgery on Tuesday and we are scared"
    out = summarize(text, 30)
    assert out.endswith("\u2026")
    assert len(out) <= 30


def test_first_word_overflow_hard_truncates():
    """When the first word alone exceeds the budget, hard-truncate
    to (max_chars - 1) chars + a single ellipsis."""
    long_word = "a" * 100
    out = summarize(long_word, 20)
    assert len(out) == 20
    assert out.endswith("\u2026")
