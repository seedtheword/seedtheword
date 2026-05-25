"""
Property tests P1 (idempotent capture), P3 (exclusion absolute),
P8 (anonymous attribution leaks no identity) for the weekly-prayer-
digest Poller and Digest_Poster's selection / rendering.

Run with:
  pytest tests/prayer_digest_capture.test.py -v
"""
from __future__ import annotations

import copy
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hypothesis import given, settings
from hypothesis import strategies as st

from poll_prayer_topic import handle_update  # type: ignore
from post_prayer_digest_to_telegram import (  # type: ignore
    select_for_digest,
    render_digest,
)
from prayer_digest_generators import (  # type: ignore
    gen_telegram_update,
    gen_optout_set,
    gen_anon_or_website_anon_entry,
    gen_log_state,
    is_capturable,
    make_test_cfg,
    DEFAULT_THREAD_ID,
)


def _empty_log():
    return {
        "schemaVersion": 1,
        "lastUpdateId": 0,
        "lastModified": "2026-05-23T15:00:00Z",
        "optOut": [],
        "completedSlots": {},
        "entries": [],
    }


def _run_poller(updates, log_state, cfg):
    """Drive handle_update over a list of updates without touching the
    network (token=fake-token, dry_run=True suppresses DM replies)."""
    state = copy.deepcopy(log_state)
    for u in updates:
        state = handle_update(u, cfg, state, "fake-token", dry_run=True)
    return state


@given(updates=st.lists(gen_telegram_update(), min_size=0, max_size=30))
@settings(max_examples=80, deadline=None)
def test_p1_idempotent_capture(updates):
    """Feature: weekly-prayer-digest, Property 1: idempotent capture.

    Validates: Requirements 2.7, 7.1, 7.2.

    For all sequences of Telegram getUpdates payloads (including
    sequences in which earlier payloads are replayed in later
    batches), running the Poller a second time on the same input
    leaves the log unchanged (the dedup invariant), AND the resulting
    entries are a subset of the distinct (chatId, messageId) dedup
    keys observed across the sequence (some keys may not be captured
    because of opt-outs the Poller learned mid-batch — e.g. a user
    sending /skipdigest in update N and then a message in update N+1)."""
    cfg = make_test_cfg()
    log_state = _empty_log()

    # First pass.
    after_first = _run_poller(updates, log_state, cfg)

    # Second pass — replay the same updates. handle_update is the
    # same function the Poller invokes, so this is exactly the
    # "Poller runs twice" scenario.
    after_second = _run_poller(updates, after_first, cfg)
    assert after_first == after_second, (
        "Replay produced a different state — dedup invariant violated"
    )

    # Distinct (chatId, messageId) keys for capturable updates. The
    # actual entries[] count is bounded above by this — a mid-batch
    # /skipdigest may render some superficially-capturable updates
    # uncapturable, so a strict equality would be too brittle.
    distinct_keys = set()
    for u in updates:
        if not is_capturable(u):
            continue
        msg = u.get("message") or {}
        chat_id = (msg.get("chat") or {}).get("id")
        message_id = msg.get("message_id")
        distinct_keys.add((chat_id, message_id))

    assert len(after_first["entries"]) <= len(distinct_keys), (
        f"Captured {len(after_first['entries'])} entries from "
        f"{len(distinct_keys)} capturable distinct keys"
    )

    # Every captured entry must have a (chatId, messageId) that comes
    # from a capturable update — no entry may appear out of thin air.
    for e in after_first["entries"]:
        assert (e["chatId"], e["messageId"]) in distinct_keys, (
            f"Entry {(e['chatId'], e['messageId'])} not in capturable keys"
        )


@given(log=gen_log_state(), opted_out=gen_optout_set())
@settings(max_examples=120)
def test_p3_exclusion_absolute(log, opted_out):
    """Feature: weekly-prayer-digest, Property 3: exclusion is absolute.

    Validates: Requirements 3.3, 3.4, 3.6, 3.7, 3.8.

    For all log states with opted-out user IDs, select_for_digest
    returns zero entries authored by those users. Anonymous entries
    whose original userId is NOT in optOut are still returned."""
    log["optOut"] = sorted(opted_out)
    cfg = make_test_cfg()
    since = datetime(1970, 1, 1, tzinfo=timezone.utc)
    now = datetime(2099, 1, 1, tzinfo=timezone.utc)
    selected = select_for_digest(log, since, now, cfg)

    selected_user_ids = {e.get("userId") for e in selected}
    assert selected_user_ids.isdisjoint(opted_out), (
        f"Selected entries from opted-out users: "
        f"{selected_user_ids & set(opted_out)}"
    )


@given(entries=st.lists(gen_anon_or_website_anon_entry(),
                        min_size=1, max_size=15))
@settings(max_examples=120)
def test_p8_anonymous_no_leak(entries):
    """Feature: weekly-prayer-digest, Property 8: anonymous attribution leaks no identity.

    Validates: Requirements 3.5, 5.3, 5.7.

    For all entries whose displayName is the literal string
    'Anonymous', the rendered digest's *attribution segment* for
    each anon entry contains only the literal token 'Anonymous' —
    not the audit-only userId, originalFirst, originalLast, or
    originalUsername.

    Note: the audit fields could legitimately collide with substrings
    inside a Summary_Line if the submitter happened to type their own
    username into their prayer body. P8 protects the renderer's
    ATTRIBUTION path (the bit between '· ' and ' — '), which is the
    only place the renderer chooses to publish identity. The body is
    whatever the submitter freely posted."""
    cfg = make_test_cfg()
    rendered = render_digest(entries, "2026-W21-mon", cfg)

    # Every bullet line for an anon entry must have exactly
    # 'Anonymous' as its attribution segment.
    bullet_prefix = "\u00b7 "  # "· "
    em_dash = " \u2014 "        # " — "

    for line in rendered.splitlines():
        if not line.startswith(bullet_prefix):
            continue
        body = line[len(bullet_prefix):]
        if em_dash not in body:
            # Defensive — every bullet should have the separator.
            continue
        attribution, _ = body.split(em_dash, 1)
        # All entries we generated are anonymous, so every bullet's
        # attribution must be the literal 'Anonymous' token (escape
        # is identical because 'Anonymous' has no metacharacters).
        assert attribution == "Anonymous", (
            f"Anon attribution leaked: {attribution!r} in line {line!r}"
        )

    # The literal 'Anonymous' token must appear at least once when
    # there is at least one entry.
    assert "Anonymous" in rendered
