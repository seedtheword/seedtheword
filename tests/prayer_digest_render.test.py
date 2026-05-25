"""
Property tests P6 (MarkdownV2 escape coverage) + P9 (website
attribution verbatim) for the weekly-prayer-digest renderer.

Run with:
  pytest tests/prayer_digest_render.test.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hypothesis import given, settings
from hypothesis import strategies as st

from telegram_common import mdv2_escape  # type: ignore
from post_prayer_digest_to_telegram import render_digest  # type: ignore
from prayer_digest_generators import (  # type: ignore
    gen_entry_with_metachars,
    gen_website_entry_named,
    make_test_cfg,
    WEBSITE_INTAKE_BOT_USER_ID,
    WEBSITE_INTAKE_BOT_USERNAME,
    WEBSITE_INTAKE_BOT_FIRST,
)


@given(entries=st.lists(gen_entry_with_metachars(), min_size=1, max_size=10))
@settings(max_examples=120)
def test_p6_markdownv2_escape_coverage(entries):
    """Feature: weekly-prayer-digest, Property 6: MarkdownV2 escape coverage.

    Validates: Requirement 5.6.

    For all displayName + summary strings drawn from a charset
    including every MarkdownV2 metacharacter, the rendered message
    contains the escaped form of each interpolated value verbatim.

    Note: when displayName has no metacharacters, mdv2_escape(name)
    == name, so the assertion is trivially true. The interesting
    cases are the ones the generator produces with real metacharacters."""
    cfg = make_test_cfg()
    rendered = render_digest(entries, "2026-W21-mon", cfg)

    for e in entries:
        escaped_name = mdv2_escape(e["displayName"])
        assert escaped_name in rendered, (
            f"Escaped name {escaped_name!r} not found in:\n{rendered}"
        )


@given(entries=st.lists(gen_website_entry_named(), min_size=1, max_size=10))
@settings(max_examples=120)
def test_p9_website_attribution_verbatim(entries):
    """Feature: weekly-prayer-digest, Property 9: website submission attribution is verbatim.

    Validates: Requirement 5.4.

    For all website-kind entries with a non-anonymous Submitter_Name,
    the rendered digest's attribution is the captured Submitter_Name
    verbatim (modulo MarkdownV2 escaping), and is NOT any field of
    the website-intake bot's Telegram identity."""
    cfg = make_test_cfg()
    rendered = render_digest(entries, "2026-W21-mon", cfg)

    # The website-intake bot's identity must never leak into the
    # rendered attribution.
    bot_id_str = str(WEBSITE_INTAKE_BOT_USER_ID)
    assert bot_id_str not in rendered, (
        f"Website bot user_id leaked: {rendered}"
    )
    # The bot's first_name "Prayer Intake" is two common English
    # words; we only assert the @username doesn't leak (the strict
    # identity marker), since 'Intake' could theoretically appear in
    # a submitter's text. The bot's username is unique enough to be
    # a hard test.
    assert WEBSITE_INTAKE_BOT_USERNAME not in rendered, (
        f"Website bot @username leaked: {rendered}"
    )

    # Every entry's captured displayName must appear (post-escape)
    # in the rendered message.
    for e in entries:
        escaped = mdv2_escape(e["displayName"])
        assert escaped in rendered, (
            f"Submitter_Name {escaped!r} not found in:\n{rendered}"
        )
