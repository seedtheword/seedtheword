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


def test_sentence_boundary_preferred_over_word_boundary():
    """When a complete sentence fits within (max_chars - 2), the
    summarizer ends at that sentence's period rather than truncating
    mid-thought at a word boundary. Verifies the May 2026 sentence-
    aware extension to §9 of design.md."""
    text = (
        "Members, what a pleasure it has been working with each one of you. "
        "I'm asking for prayer surrounding our ministry and life updates."
    )
    out = summarize(text, 80)
    # The first sentence is 65 chars and ends with '.', well under
    # the 78-char budget. We should land on the sentence boundary.
    assert out.endswith("you. \u2026"), repr(out)
    assert len(out) <= 80


def test_sentence_boundary_falls_back_to_word_boundary_when_no_sentence_fits():
    """If no whole sentence fits in the budget, the summarizer falls
    back to the original word-boundary walk (no content lost)."""
    text = "This is one very long single sentence with no period in the middle so the sentence-walk yields a single chunk that exceeds the budget"
    out = summarize(text, 50)
    assert out.endswith(" \u2026")
    assert len(out) <= 50
    # The result should be a prefix of the body up to a word boundary
    # — no period in there, so we know it took the word-walk path.
    assert "." not in out


def test_multi_sentence_partial_take():
    """Body of three short sentences, budget fits exactly two of
    them: result is the first two sentences."""
    text = "Pray for Mom. Pray for Dad. Pray for the kids."
    out = summarize(text, 35)
    assert out == "Pray for Mom. Pray for Dad. \u2026", repr(out)
    assert len(out) <= 35


def test_question_and_exclamation_count_as_sentence_terminators():
    text = "Is anyone willing to pray for me? It would mean a lot. Thanks!"
    out = summarize(text, 40)
    # First sentence ends at '?' and is 32 chars. Budget is 38. Fits.
    assert out.startswith("Is anyone willing to pray for me?")
    assert out.endswith(" \u2026")
    assert len(out) <= 40
