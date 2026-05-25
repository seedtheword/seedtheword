"""
Property tests P2 (entry cap) + P7 (prune monotone) for the
weekly-prayer-digest selection and pruning logic.

Run with:
  pytest tests/prayer_digest_select.test.py -v
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hypothesis import given, settings
from hypothesis import strategies as st

from poll_prayer_topic import prune_old_entries  # type: ignore
from post_prayer_digest_to_telegram import (  # type: ignore
    select_for_digest,
    _parse_iso,
)
from prayer_digest_generators import (  # type: ignore
    gen_log_state,
    make_test_cfg,
)


@given(log=gen_log_state(), cap=st.integers(min_value=1, max_value=50))
@settings(max_examples=120)
def test_p2_entry_cap(log, cap):
    """Feature: weekly-prayer-digest, Property 2: entry cap respected.

    Validates: Requirement 6.3.

    For all synthetic Prayer_Log states with N eligible entries inside
    Capture_Window where N may exceed entryCap, select_for_digest
    returns min(N, cap) entries, sorted ascending by ts, containing
    the most recent entries by (ts, messageId)."""
    cfg = make_test_cfg(entry_cap=cap)
    since = datetime(1970, 1, 1, tzinfo=timezone.utc)
    now = datetime(2099, 1, 1, tzinfo=timezone.utc)

    # Compute eligible the same way select_for_digest would (ignoring
    # the cap). Opt-out and excludeUserIds are the only filters here
    # because since/now bracket all entries.
    opt_out = set(log.get("optOut") or [])
    excluded = set(cfg["prayer"]["digest"]["excludeUserIds"])
    eligible = [
        e for e in log["entries"]
        if e.get("userId") not in opt_out
        and e.get("userId") not in excluded
    ]

    selected = select_for_digest(log, since, now, cfg)

    assert len(selected) == min(len(eligible), cap)

    # Selected must be sorted ascending by ts.
    selected_keys = [(_parse_iso(e["ts"]), int(e.get("messageId") or 0)) for e in selected]
    assert selected_keys == sorted(selected_keys)

    # Selected must be the most recent `cap` entries.
    if eligible:
        most_recent = sorted(
            eligible,
            key=lambda e: (_parse_iso(e["ts"]), int(e.get("messageId") or 0)),
            reverse=True,
        )[:cap]
        expected_keys = {(e["chatId"], e["messageId"]) for e in most_recent}
        actual_keys = {(e["chatId"], e["messageId"]) for e in selected}
        assert expected_keys == actual_keys


@given(log=gen_log_state(), now_offset_days=st.integers(min_value=-30, max_value=30))
@settings(max_examples=120)
def test_p7_prune_monotone(log, now_offset_days):
    """Feature: weekly-prayer-digest, Property 7: pruning monotone in time.

    Validates: Requirement 7.6.

    For all synthetic Prayer_Log states and all 'now' timestamps t,
    after prune_old_entries(log, t):
      - surviving entries are exactly those with ts >= t - 14 days,
      - optOut, completedSlots, and lastUpdateId are unchanged."""
    base = datetime(2026, 5, 23, tzinfo=timezone.utc)
    now = base + timedelta(days=now_offset_days)
    cutoff = now - timedelta(days=14)

    original_optout = list(log.get("optOut") or [])
    original_slots = dict(log.get("completedSlots") or {})
    original_lastupdate = log.get("lastUpdateId")

    # prune mutates in place; capture the entries-before for later
    # comparison.
    entries_before = list(log["entries"])
    pruned = prune_old_entries(log, now)

    for e in pruned["entries"]:
        ts = _parse_iso(e["ts"])
        assert ts >= cutoff

    # No entry inside the window was dropped.
    for e in entries_before:
        try:
            ts = _parse_iso(e["ts"])
        except (TypeError, ValueError):
            continue
        if ts >= cutoff:
            assert e in pruned["entries"]

    # Other top-level fields untouched.
    assert pruned.get("optOut") == original_optout
    assert pruned.get("completedSlots") == original_slots
    assert pruned.get("lastUpdateId") == original_lastupdate
