"""
Tests for the Gemini-backed LLM summarizer in
.github/scripts/gemini_summarize.py and the dispatcher in
post_prayer_digest_to_telegram._summarize_entry.

Network calls are stubbed via monkeypatching `_call_gemini` so these
tests are hermetic and run in CI without an API key.

Run with:
  pytest tests/prayer_digest_llm_summarize.test.py -v

Property coverage:
  PL1 — Empty api_key short-circuits to '' without I/O.
  PL2 — Network failure → '' (caller falls back to rule-based).
  PL3 — Safety-blocked / malformed responses → '' (graceful fallback).
  PL4 — Length cap holds: even when LLM returns a 4000-char string,
        the dispatcher's final result is <= summary_max.
  PL5 — Determinism on the rule-based fallback path: with mode=
        'rule-based' OR empty api_key, repeated calls match.
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.error import URLError

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))

import gemini_summarize  # type: ignore
import post_prayer_digest_to_telegram as poster  # type: ignore
from poll_prayer_topic import summarize  # type: ignore


# ── PL1 ─────────────────────────────────────────────────────────
def test_empty_api_key_short_circuits(monkeypatch):
    """No API key → llm_summarize returns '' WITHOUT hitting the
    network. Caller is expected to fall back to rule-based."""
    called = {"yes": False}

    def boom(*_args, **_kwargs):
        called["yes"] = True
        raise AssertionError("must not be called when api_key is empty")

    monkeypatch.setattr(gemini_summarize, "_call_gemini", boom)
    out = gemini_summarize.llm_summarize("Pray for John", 200, api_key="")
    assert out == ""
    assert called["yes"] is False


# ── PL2 ─────────────────────────────────────────────────────────
def test_network_failure_falls_back_silently(monkeypatch):
    """Any URLError / HTTPError / TimeoutError from _call_gemini
    must not raise — llm_summarize returns ''."""
    def fail(*_args, **_kwargs):
        raise URLError("name resolution failed")

    monkeypatch.setattr(gemini_summarize, "_call_gemini", fail)
    out = gemini_summarize.llm_summarize("Pray for John", 200, api_key="x")
    assert out == ""


def test_unexpected_exception_falls_back_silently(monkeypatch):
    """Unknown exception types still return '' — the digest must
    always render."""
    def fail(*_args, **_kwargs):
        raise RuntimeError("surprise")

    monkeypatch.setattr(gemini_summarize, "_call_gemini", fail)
    out = gemini_summarize.llm_summarize("Pray for John", 200, api_key="x")
    assert out == ""


# ── PL3 ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("payload", [
    {},                                                       # empty
    {"candidates": []},                                       # no candidates
    {"candidates": [{"finishReason": "SAFETY"}]},             # safety block
    {"candidates": [{"finishReason": "RECITATION"}]},         # recitation block
    {"candidates": [{"finishReason": "OTHER"}]},              # other refusal
    {"candidates": [{"content": {}}]},                        # no parts
    {"candidates": [{"content": {"parts": []}}]},             # empty parts
    {"candidates": [{"content": {"parts": [{"foo": "bar"}]}}]},  # no text key
    None,                                                     # not a dict
    "not a dict",                                             # str instead of dict
])
def test_parse_response_malformed_returns_empty(payload):
    """parse_response is the parsing seam — every malformed shape
    must collapse to '' so the dispatcher falls back."""
    assert gemini_summarize.parse_response(payload) == ""


def test_parse_response_happy_path():
    """Well-formed STOP-finish response with one text part returns
    the trimmed text."""
    payload = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": "  David asks for ministry guidance.  "}]}
        }]
    }
    assert gemini_summarize.parse_response(payload) == "David asks for ministry guidance."


def test_parse_response_concatenates_multiple_parts():
    """Some responses split text across parts — concatenate in order."""
    payload = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [
                {"text": "Asks for prayer "},
                {"text": "over ministry direction."},
            ]}
        }]
    }
    out = gemini_summarize.parse_response(payload)
    assert out == "Asks for prayer over ministry direction."


# ── Prompt invariants ──────────────────────────────────────────
def test_build_prompt_includes_cap_and_no_paraphrase_directive():
    p = gemini_summarize.build_prompt("Pray for me", 200)
    assert "under 200 characters" in p
    assert "Do NOT add interpretation" in p
    assert "Pray for me" in p
    assert p.endswith("Summary:")


def test_build_prompt_is_pure():
    """Same inputs → identical prompts (P5 invariant on the prompt
    construction itself)."""
    a = gemini_summarize.build_prompt("Hello", 100)
    b = gemini_summarize.build_prompt("Hello", 100)
    assert a == b


# ── PL4 — length cap holds even with LLM in the loop ────────────
def test_dispatcher_caps_long_llm_response(monkeypatch):
    """Even if Gemini returns a 4000-char wall of text, the rendered
    summary must still satisfy P4 (len <= summary_max). The
    dispatcher passes the LLM output through summarize() as the
    final length-bound."""
    long_response = ("This is a long sentence that goes on. " * 200).strip()
    monkeypatch.setattr(gemini_summarize, "llm_summarize",
                        lambda text, mc, key: long_response)
    out = poster._summarize_entry("Pray for me", 200, "llm", api_key="x")
    assert len(out) <= 200


def test_dispatcher_uses_llm_when_mode_is_llm_and_key_present(monkeypatch):
    """Happy path: mode='llm' + api_key set + LLM returns text →
    dispatcher uses the LLM result (after length-capping)."""
    monkeypatch.setattr(gemini_summarize, "llm_summarize",
                        lambda text, mc, key: "David asks for ministry guidance.")
    out = poster._summarize_entry("a long original message", 200, "llm",
                                  api_key="x")
    assert out == "David asks for ministry guidance."


def test_dispatcher_falls_back_when_llm_returns_empty(monkeypatch):
    """LLM returned '' (any failure mode) → dispatcher uses
    summarize() on the original text."""
    monkeypatch.setattr(gemini_summarize, "llm_summarize",
                        lambda text, mc, key: "")
    text = "Members, what a pleasure it has been working with each of you."
    out = poster._summarize_entry(text, 200, "llm", api_key="x")
    assert out == summarize(text, 200)


def test_dispatcher_skips_llm_when_mode_is_rule_based(monkeypatch):
    """mode='rule-based' must NEVER call the LLM, even if api_key
    is set."""
    called = {"yes": False}

    def boom(*_a, **_k):
        called["yes"] = True
        return "should not be used"

    monkeypatch.setattr(gemini_summarize, "llm_summarize", boom)
    text = "Pray for John."
    out = poster._summarize_entry(text, 200, "rule-based", api_key="x")
    assert called["yes"] is False
    assert out == summarize(text, 200)


def test_dispatcher_skips_llm_when_api_key_empty(monkeypatch):
    """mode='llm' but api_key is '' → behaves like rule-based mode.
    Ensures a missing GitHub Secret doesn't break the digest."""
    called = {"yes": False}

    def boom(*_a, **_k):
        called["yes"] = True
        return "should not be used"

    monkeypatch.setattr(gemini_summarize, "llm_summarize", boom)
    text = "Pray for John."
    out = poster._summarize_entry(text, 200, "llm", api_key="")
    assert called["yes"] is False
    assert out == summarize(text, 200)


# ── PL5 — determinism on rule-based fallback path ───────────────
@given(text=st.text(min_size=0, max_size=500),
       max_chars=st.integers(min_value=20, max_value=300))
@settings(max_examples=100)
def test_pl5_rule_based_path_is_deterministic(text, max_chars):
    """When mode is 'rule-based' the dispatcher reduces to the pure
    summarize() call. Repeated invocations match."""
    a = poster._summarize_entry(text, max_chars, "rule-based", api_key="x")
    b = poster._summarize_entry(text, max_chars, "rule-based", api_key="x")
    assert a == b


@given(text=st.text(min_size=0, max_size=500),
       max_chars=st.integers(min_value=20, max_value=300))
@settings(max_examples=100)
def test_pl5_empty_key_path_is_deterministic(text, max_chars):
    """mode='llm' + empty key reduces to rule-based; same property."""
    a = poster._summarize_entry(text, max_chars, "llm", api_key="")
    b = poster._summarize_entry(text, max_chars, "llm", api_key="")
    assert a == b
