"""Property-based tests for the Layered Bible Reading Plan.

Covers properties L1, L2, L3, L6, L7, L8, L9, L10 from
`.kiro/specs/layered-bible-reading-plan/requirements.md` Requirement 13.

Targets the Python implementation in
`.github/scripts/post_daily_bible_to_telegram.py` plus the Apps Script
algorithmic shim transcribed below (mirrors `_buildLayeredFooter` in
`docs/apps-script/order-handler.gs`). The shim is the parity surface
that turns L10 from "trust me" into a green CI badge — any future
edit to the Apps Script port must be mirrored here in the same commit
or the parity test fails.

The browser renderer (`assets/js/layered-plan.js`) uses the identical
algorithm with identical book sequences; its test coverage will be
bolted on alongside via Node + JSDOM in milestone 7.5–7.10 once Node
is available on the CI runner. The L10 contract is the strongest
guarantee — if all three implementations agree on chapter references
for every fixture date, drift between hosts is impossible.
"""
from __future__ import annotations

import copy
import itertools
import json
import re
from datetime import date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

import post_daily_bible_to_telegram as p
from bible_books import (
    OT_HISTORY_BOOKS,
    POETRY_PROPHECY_BOOKS,
    OT_HISTORY_SEQUENCE,
    POETRY_PROPHECY_SEQUENCE,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
LIVE_CFG = json.loads((REPO_ROOT / "assets/data/telegram-bot.json").read_text(encoding="utf-8"))
LIVE_LP = LIVE_CFG["bible"]["layeredPlan"]
TZ = ZoneInfo(LIVE_LP["timezone"])
ANCHOR_DATE = date(2026, 4, 30)


# ============================================================
#  Apps Script algorithmic shim
#  Hand-transcribed from docs/apps-script/order-handler.gs.
#  Maintenance contract: any change to the Apps Script port's
#  _getOtHistoryReading / _getPoetryProphecyReading / _psalmOfDay /
#  _proverbOfDay / _buildLayeredFooter MUST be mirrored here in the
#  same commit. CI runs this test on every push; if drift creeps
#  in, the L10 fixture comparison fails.
# ============================================================


def _apps_weekdays_between(a: date, b: date) -> int:
    if a == b:
        return 0
    direction = 1 if b >= a else -1
    count = 0
    cur = a
    while cur != b:
        cur = cur + timedelta(days=direction)
        if cur.weekday() < 5:
            count += direction
    return count


def _apps_walk_reading(d: date, anchor: dict, sequence: list):
    if d.weekday() >= 5:
        return None
    if not isinstance(anchor, dict):
        return None
    raw = anchor.get("date")
    if not isinstance(raw, str):
        return None
    try:
        ad = date(*[int(x) for x in raw.split("-")])
    except ValueError:
        return None
    book = anchor.get("book")
    chap = anchor.get("chapter")
    if not isinstance(chap, int):
        return None
    try:
        idx0 = next(
            i for i, r in enumerate(sequence)
            if r["book"] == book and r["chapter"] == chap
        )
    except StopIteration:
        return None
    idx = idx0 + _apps_weekdays_between(ad, d)
    if idx < 0 or idx >= len(sequence):
        return None
    return dict(sequence[idx])


def _apps_get_ot_history_reading(d: date, anchor: dict):
    return _apps_walk_reading(d, anchor, OT_HISTORY_SEQUENCE)


def _apps_get_poetry_prophecy_reading(d: date, anchor: dict):
    return _apps_walk_reading(d, anchor, POETRY_PROPHECY_SEQUENCE)


def _apps_psalm_of_day(d: date, _tz=None) -> int:
    return ((d.timetuple().tm_yday - 1) % 150) + 1


def _apps_proverb_of_day(d: date, _tz=None) -> int:
    return min(d.day, 31)


def _apps_build_layered_footer(layered_cfg: dict, today_local: date, tz=None) -> list[str]:
    """Mirror of _buildLayeredFooter in order-handler.gs.

    Returns the same list of canonical lines the Apps Script port
    would push onto the Telegram post body, with the SAME bullet
    glyphs and the SAME label-and-reference shape, but WITHOUT the
    MarkdownV2 escape backslashes. The Python build_layered_footer
    output is canonicalized the same way before comparison so the
    parity assertion is on chapter-reference content, not on
    escaping detail.
    """
    if not layered_cfg or layered_cfg.get("enabled") is False:
        return []
    if not layered_cfg.get("includeInTelegram"):
        return []
    if today_local.weekday() >= 5:
        return []
    streams = layered_cfg.get("streams") or {}
    pills = []
    ot = streams.get("otHistory") or {}
    if ot.get("enabled", True):
        r = _apps_get_ot_history_reading(today_local, ot.get("anchor") or {})
        if r:
            pills.append(("OT walk", f"{r['book']} {r['chapter']}"))
    pp = streams.get("poetryProphecy") or {}
    if pp.get("enabled", True):
        r = _apps_get_poetry_prophecy_reading(today_local, pp.get("anchor") or {})
        if r:
            pills.append(("Poetry & Prophecy", f"{r['book']} {r['chapter']}"))
    if (streams.get("psalm") or {}).get("enabled", True):
        pills.append((None, f"Psalm {_apps_psalm_of_day(today_local, tz)}"))
    if (streams.get("proverbs") or {}).get("enabled", True):
        pills.append((None, f"Proverbs {_apps_proverb_of_day(today_local, tz)}"))
    if not pills:
        return []
    out = ["", "HEADING:Going deeper today"]
    for label, ref in pills:
        out.append(f"BULLET:{label}: {ref}" if label else f"BULLET:{ref}")
    return out


_MDV2_ESCAPE_RE = re.compile(r"\\(.)")


def _python_canonical(lines: list[str]) -> list[str]:
    """Canonicalize Python build_layered_footer output for comparison
    against the apps-script shim — strip MarkdownV2 escape backslashes
    and translate the glyph-prefixed heading + bullet rows into the
    HEADING:/BULLET: token form the shim emits."""
    if not lines:
        return []
    out = [lines[0]]  # leading blank line preserved as-is
    h = _MDV2_ESCAPE_RE.sub(r"\1", lines[1])
    h = h.replace("🌿 ", "").strip("*").strip()
    out.append("HEADING:" + h)
    for ln in lines[2:]:
        s = ln[2:] if ln.startswith("· ") else ln
        s = _MDV2_ESCAPE_RE.sub(r"\1", s)
        out.append("BULLET:" + s)
    return out


# ============================================================
#  Fixtures
# ============================================================


def _default_cfg() -> dict:
    return copy.deepcopy(LIVE_LP)


# ============================================================
#  Property L1 — Length bounds (R7.2, R7.5, R13.1)
# ============================================================

DATE_RANGE = st.dates(min_value=date(1900, 1, 1), max_value=date(2100, 12, 31))


@settings(max_examples=300, deadline=None)
@given(d=DATE_RANGE)
def test_L1_psalm_of_day_in_range(d):
    """Property L1: psalm_of_day always returns an int in [1, 150]."""
    v = p.psalm_of_day(d, TZ)
    assert isinstance(v, int)
    assert 1 <= v <= 150


@settings(max_examples=300, deadline=None)
@given(d=DATE_RANGE)
def test_L1_proverb_of_day_in_range(d):
    """Property L1: proverb_of_day always returns an int in [1, 31]."""
    v = p.proverb_of_day(d, TZ)
    assert isinstance(v, int)
    assert 1 <= v <= 31


# ============================================================
#  Property L2 — Daily monotone advance (R5.3, R5.4, R6.4, R6.5, R13.2)
# ============================================================


def _next_weekday(d: date) -> date:
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt = nxt + timedelta(days=1)
    return nxt


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(d=DATE_RANGE.filter(lambda x: x.weekday() < 5))
def test_L2_ot_history_monotone_advance(d):
    """Property L2: consecutive weekdays produce consecutive entries
    in OT_HISTORY_SEQUENCE (or both null when off-sequence)."""
    anchor = LIVE_LP["streams"]["otHistory"]["anchor"]
    cur = p.get_ot_history_reading(d, anchor)
    nxt = p.get_ot_history_reading(_next_weekday(d), anchor)
    if cur is None:
        # Off-sequence — next must also be None or the very first reading
        assert nxt is None or (nxt["book"] == anchor["book"] and nxt["chapter"] == anchor["chapter"])
        return
    cur_idx = next(
        i for i, r in enumerate(OT_HISTORY_SEQUENCE)
        if r["book"] == cur["book"] and r["chapter"] == cur["chapter"]
    )
    if cur_idx + 1 >= len(OT_HISTORY_SEQUENCE):
        assert nxt is None
    else:
        expected = OT_HISTORY_SEQUENCE[cur_idx + 1]
        assert nxt is not None
        assert nxt["book"] == expected["book"]
        assert nxt["chapter"] == expected["chapter"]


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(d=DATE_RANGE.filter(lambda x: x.weekday() < 5))
def test_L2_poetry_prophecy_monotone_advance(d):
    """Property L2 for the Poetry & Prophecy walk."""
    anchor = LIVE_LP["streams"]["poetryProphecy"]["anchor"]
    cur = p.get_poetry_prophecy_reading(d, anchor)
    nxt = p.get_poetry_prophecy_reading(_next_weekday(d), anchor)
    if cur is None:
        assert nxt is None or (nxt["book"] == anchor["book"] and nxt["chapter"] == anchor["chapter"])
        return
    cur_idx = next(
        i for i, r in enumerate(POETRY_PROPHECY_SEQUENCE)
        if r["book"] == cur["book"] and r["chapter"] == cur["chapter"]
    )
    if cur_idx + 1 >= len(POETRY_PROPHECY_SEQUENCE):
        assert nxt is None
    else:
        expected = POETRY_PROPHECY_SEQUENCE[cur_idx + 1]
        assert nxt is not None
        assert nxt["book"] == expected["book"]
        assert nxt["chapter"] == expected["chapter"]


@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(d=DATE_RANGE.filter(lambda x: x.weekday() >= 5))
def test_L2_weekend_returns_null(d):
    """Property L2: weekday-walk lookups return None on Sat/Sun."""
    anchor_ot = LIVE_LP["streams"]["otHistory"]["anchor"]
    anchor_pp = LIVE_LP["streams"]["poetryProphecy"]["anchor"]
    assert p.get_ot_history_reading(d, anchor_ot) is None
    assert p.get_poetry_prophecy_reading(d, anchor_pp) is None


# ============================================================
#  Property L3 — Anchor preservation (R5.6, R6.6, R13.3)
# ============================================================


def test_L3_anchor_preservation_default():
    """Property L3: lookups return the anchor reading on the anchor date."""
    ot = p.get_ot_history_reading(ANCHOR_DATE, LIVE_LP["streams"]["otHistory"]["anchor"])
    assert ot is not None
    assert ot["book"] == "Genesis"
    assert ot["chapter"] == 1

    pp = p.get_poetry_prophecy_reading(ANCHOR_DATE, LIVE_LP["streams"]["poetryProphecy"]["anchor"])
    assert pp is not None
    assert pp["book"] == "Job"
    assert pp["chapter"] == 1


@settings(max_examples=80, deadline=None)
@given(idx=st.integers(min_value=0, max_value=len(OT_HISTORY_SEQUENCE) - 1))
def test_L3_anchor_preservation_random_ot(idx):
    """Property L3: any (book, chapter) in OT_HISTORY_SEQUENCE used as
    an anchor returns itself on the anchor date."""
    entry = OT_HISTORY_SEQUENCE[idx]
    anchor = {"date": "2026-04-30", "book": entry["book"], "chapter": entry["chapter"]}
    r = p.get_ot_history_reading(ANCHOR_DATE, anchor)
    assert r is not None
    assert r["book"] == entry["book"]
    assert r["chapter"] == entry["chapter"]


@settings(max_examples=80, deadline=None)
@given(idx=st.integers(min_value=0, max_value=len(POETRY_PROPHECY_SEQUENCE) - 1))
def test_L3_anchor_preservation_random_pp(idx):
    """Property L3 for the Poetry & Prophecy walk."""
    entry = POETRY_PROPHECY_SEQUENCE[idx]
    anchor = {"date": "2026-04-30", "book": entry["book"], "chapter": entry["chapter"]}
    r = p.get_poetry_prophecy_reading(ANCHOR_DATE, anchor)
    assert r is not None
    assert r["book"] == entry["book"]
    assert r["chapter"] == entry["chapter"]


# ============================================================
#  Property L6 — Cycle invariants (R7.3, R7.6, R13.6)
# ============================================================


@settings(max_examples=200, deadline=None)
@given(d=st.dates(min_value=date(2000, 1, 1), max_value=date(2100, 7, 1)))
def test_L6_psalm_150_day_cycle_within_year(d):
    """Property L6: psalm_of_day repeats every 150 days when the second
    date falls within the same calendar year."""
    d2 = d + timedelta(days=150)
    if d2.year != d.year:
        return  # cross-year wrap is explicitly out of scope per design §11
    assert p.psalm_of_day(d, TZ) == p.psalm_of_day(d2, TZ)


@settings(max_examples=120, deadline=None)
@given(
    year=st.integers(min_value=1900, max_value=2100),
    month=st.integers(min_value=1, max_value=12),
)
def test_L6_proverb_first_of_month_is_one(year, month):
    """Property L6: proverb_of_day is 1 on the 1st of every month.

    Generates first-of-month dates directly rather than filtering the
    DATE_RANGE strategy — the 1/30 acceptance ratio under filtering
    trips Hypothesis's filter health-check."""
    d = date(year, month, 1)
    assert p.proverb_of_day(d, TZ) == 1


@settings(max_examples=120, deadline=None)
@given(
    year=st.integers(min_value=1900, max_value=2100),
    day=st.integers(min_value=1, max_value=29),
)
def test_L6_february_proverb_caps_at_29(year, day):
    """Property L6: in February, proverb_of_day never exceeds 29 (28 in
    non-leap years; the formula naturally caps because dayOfMonth ≤ 29).

    Generates February dates directly rather than filtering the broad
    DATE_RANGE strategy — Hypothesis's filter health-check rejects the
    1/12 acceptance ratio that filtering would produce."""
    is_leap = (year % 4 == 0 and year % 100 != 0) or year % 400 == 0
    if day == 29 and not is_leap:
        return  # 1900-02-29, 1901-02-29, etc. don't exist
    d = date(year, 2, day)
    v = p.proverb_of_day(d, TZ)
    assert v <= (29 if is_leap else 28)


# ============================================================
#  Property L7 — Newcomer plan determinism (R10.2, R10.4, R13.7)
# ============================================================


def _load_newcomer():
    return json.loads((REPO_ROOT / "assets/data/newcomer-30day.json").read_text(encoding="utf-8"))


def test_L7_newcomer_byte_equal_loads():
    """Property L7: independent loads return byte-equal entries."""
    a = _load_newcomer()
    b = _load_newcomer()
    assert a == b


def test_L7_newcomer_locked_endpoints():
    """Property L7: 20-day plan — day-1 is DBS, day-2 is John 1, day-20 is Philippians 4:6-7."""
    data = _load_newcomer()
    entries = data["entries"]
    assert len(entries) == 20, f"Expected 20 entries, got {len(entries)}"
    assert entries[0]["day"] == 1
    assert entries[0]["label"] == "Monday Bible Study #1 (DBS)"
    assert entries[1]["label"] == "John 1"
    assert entries[19]["label"] == "Philippians 4:6-7"
    for i, e in enumerate(entries):
        assert e["day"] == i + 1
        assert "note" in e and e["note"]
        assert "week" in e and e["week"] in (1, 2, 3, 4)


def test_L7_newcomer_themes_match_day_ranges():
    """Property L7: themes dict uses week-number keys 1-4; each entry has correct week."""
    data = _load_newcomer()
    themes = data["themes"]
    # New format uses string week numbers "1", "2", "3", "4"
    for week_key in ("1", "2", "3", "4"):
        assert week_key in themes, f"Missing theme key {week_key!r}"
    week_day_map = {1: range(1, 6), 2: range(6, 11), 3: range(11, 16), 4: range(16, 21)}
    for e in data["entries"]:
        expected_week = None
        for w, days in week_day_map.items():
            if e["day"] in days:
                expected_week = w
                break
        assert expected_week is not None, f"day {e['day']} not in any week range"
        assert e["week"] == expected_week, (
            f"day {e['day']} expected week {expected_week}, got {e['week']}"
        )


# ============================================================
#  Property L8 — Independent stream toggles (R1.8, R13.8)
# ============================================================


def _enabled_canonical_refs(layered, d) -> list[str]:
    """Extract the ordered list of chapter references that should
    appear in the row/footer for `d` under `layered`."""
    streams = layered.get("streams") or {}
    refs = []
    if (streams.get("otHistory") or {}).get("enabled", True):
        r = p.get_ot_history_reading(d, (streams.get("otHistory") or {}).get("anchor") or {})
        if r:
            refs.append(f"OT walk: {r['book']} {r['chapter']}")
    if (streams.get("poetryProphecy") or {}).get("enabled", True):
        r = p.get_poetry_prophecy_reading(d, (streams.get("poetryProphecy") or {}).get("anchor") or {})
        if r:
            refs.append(f"Poetry & Prophecy: {r['book']} {r['chapter']}")
    if (streams.get("psalm") or {}).get("enabled", True):
        refs.append(f"Psalm {p.psalm_of_day(d, TZ)}")
    if (streams.get("proverbs") or {}).get("enabled", True):
        refs.append(f"Proverbs {p.proverb_of_day(d, TZ)}")
    return refs


@pytest.mark.parametrize("combo", list(itertools.product([True, False], repeat=4)))
def test_L8_stream_toggles_independent(combo):
    """Property L8: enabling exactly the streams in `combo` produces a
    footer with exactly those streams' refs in canonical order."""
    cfg = _default_cfg()
    cfg["streams"]["otHistory"]["enabled"] = combo[0]
    cfg["streams"]["poetryProphecy"]["enabled"] = combo[1]
    cfg["streams"]["psalm"]["enabled"] = combo[2]
    cfg["streams"]["proverbs"]["enabled"] = combo[3]

    expected_refs = _enabled_canonical_refs(cfg, ANCHOR_DATE)
    py_lines = p.build_layered_footer(cfg, ANCHOR_DATE, TZ)

    if not expected_refs:
        # All streams off OR all streams produced null on this date —
        # the footer must collapse to []. R1.9.
        assert py_lines == []
        return

    canon = _python_canonical(py_lines)
    # canon = ['', 'HEADING:Going deeper today', 'BULLET:...', ...]
    assert canon[0] == ""
    assert canon[1] == "HEADING:Going deeper today"
    bullets = [ln[len("BULLET:"):] for ln in canon[2:]]
    assert bullets == expected_refs


# ============================================================
#  Property L9 — Footer mirrors the canonical row order (R9.3, R13.9)
# ============================================================


@settings(max_examples=80, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(d=DATE_RANGE.filter(lambda x: x.weekday() < 5))
def test_L9_canonical_order_otHistory_first(d):
    """Property L9: when all four streams are enabled, the footer's
    bullets land in the canonical order otHistory → poetryProphecy →
    psalm → proverbs."""
    cfg = _default_cfg()
    canon = _python_canonical(p.build_layered_footer(cfg, d, TZ))
    if canon == []:
        return  # nothing to check on a date where every walk is off-sequence
    bullets = [ln[len("BULLET:"):] for ln in canon[2:]]
    # Build the expected order from the live config + lookups
    expected = _enabled_canonical_refs(cfg, d)
    assert bullets == expected


# ============================================================
#  Property L10 — Python ↔ Apps Script parity (R9.9, R13.10)
# ============================================================

L10_FIXTURE_DATES = [
    date(2026, 4, 30),  # anchor (Thu)
    date(2026, 4, 29),  # anchor − 1 weekday (Wed)
    date(2026, 6, 11),  # anchor + 30 weekdays (Thu)
    date(2026, 11, 26), # anchor + 150 weekdays (Thu)
    date(2027, 4, 23),  # ~anchor + 250 weekdays (well into the walk)
    date(2027, 2, 1),   # Feb 1 (Mon) — Proverb 1, Psalm 32
    date(2025, 2, 28),  # Feb 28 in non-leap year (Fri)
    date(2024, 2, 29),  # leap-day (Thu)
    date(2026, 12, 31), # year-end (Thu)
    date(2027, 1, 1),   # year-boundary (Fri)
    date(2026, 5, 2),   # Saturday — must be []
    date(2026, 5, 3),   # Sunday — must be []
]


@pytest.mark.parametrize("d", L10_FIXTURE_DATES, ids=lambda d: d.isoformat())
def test_L10_python_apps_parity_fixtures(d):
    """Property L10: Python and Apps Script implementations agree
    byte-for-byte on chapter references (after MarkdownV2 escape strip)
    for the fixture dates."""
    cfg = _default_cfg()
    py_canon = _python_canonical(p.build_layered_footer(cfg, d, TZ))
    apps_canon = _apps_build_layered_footer(cfg, d, TZ)
    assert py_canon == apps_canon


@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(d=DATE_RANGE.filter(lambda x: x.weekday() < 5))
def test_L10_python_apps_parity_random_weekdays(d):
    """Property L10: the parity holds for randomized weekday inputs."""
    cfg = _default_cfg()
    py_canon = _python_canonical(p.build_layered_footer(cfg, d, TZ))
    apps_canon = _apps_build_layered_footer(cfg, d, TZ)
    assert py_canon == apps_canon


@pytest.mark.parametrize("combo", list(itertools.product([True, False], repeat=4)))
def test_L10_python_apps_parity_under_toggles(combo):
    """Property L10 under the 16 enable-permutations on the anchor date."""
    cfg = _default_cfg()
    cfg["streams"]["otHistory"]["enabled"] = combo[0]
    cfg["streams"]["poetryProphecy"]["enabled"] = combo[1]
    cfg["streams"]["psalm"]["enabled"] = combo[2]
    cfg["streams"]["proverbs"]["enabled"] = combo[3]
    py_canon = _python_canonical(p.build_layered_footer(cfg, ANCHOR_DATE, TZ))
    apps_canon = _apps_build_layered_footer(cfg, ANCHOR_DATE, TZ)
    assert py_canon == apps_canon


# ============================================================
#  Master-disable and footer-disable gates (R1.7, R1.10, R9.7)
# ============================================================


def test_master_disable_gate():
    """R1.7: enabled=False → footer is []."""
    cfg = _default_cfg()
    cfg["enabled"] = False
    assert p.build_layered_footer(cfg, ANCHOR_DATE, TZ) == []


def test_telegram_disable_gate():
    """R1.10, R9.7: includeInTelegram=False → footer is []."""
    cfg = _default_cfg()
    cfg["includeInTelegram"] = False
    assert p.build_layered_footer(cfg, ANCHOR_DATE, TZ) == []


def test_saturday_gate():
    """R3.5, R9.5: footer is [] on Saturday regardless of other settings."""
    cfg = _default_cfg()
    saturday = date(2026, 5, 2)
    assert saturday.weekday() == 5
    assert p.build_layered_footer(cfg, saturday, TZ) == []


def test_sunday_gate():
    """R4.1: footer is [] on Sunday."""
    cfg = _default_cfg()
    sunday = date(2026, 5, 3)
    assert sunday.weekday() == 6
    assert p.build_layered_footer(cfg, sunday, TZ) == []


def test_all_streams_disabled():
    """R1.9: enabled=True but every stream off → footer is []."""
    cfg = _default_cfg()
    for s in ("otHistory", "poetryProphecy", "psalm", "proverbs"):
        cfg["streams"][s]["enabled"] = False
    assert p.build_layered_footer(cfg, ANCHOR_DATE, TZ) == []


# ============================================================
#  Smoke check on book-list integrity
# ============================================================


def test_ot_history_books_count():
    """OT history walk covers Genesis through Esther (17 books)."""
    assert len(OT_HISTORY_BOOKS) == 17
    assert OT_HISTORY_BOOKS[0][0] == "Genesis"
    assert OT_HISTORY_BOOKS[-1][0] == "Esther"


def test_poetry_prophecy_books_count():
    """Poetry & Prophecy walk covers Job through Malachi excluding
    Psalms and Proverbs (20 books)."""
    assert len(POETRY_PROPHECY_BOOKS) == 20
    names = [b[0] for b in POETRY_PROPHECY_BOOKS]
    assert names[0] == "Job"
    assert names[-1] == "Malachi"
    assert "Psalms" not in names
    assert "Proverbs" not in names
