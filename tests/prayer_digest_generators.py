"""
Shared `hypothesis` strategies for the weekly-prayer-digest property
tests. Non-test helper module — no @given-decorated functions live
here. Convention copied from tests/generators-testimonies.mjs.

Strategy table (per §14.3 of design.md):

  gen_user                       — minimal `from` shape (random id,
                                   nullable name fields)
  gen_user_with_metachars        — same shape but names drawn from a
                                   charset that includes every
                                   MarkdownV2 metacharacter
  gen_message_text               — random Unicode text up to ~500 chars
  gen_anon_tagged_body           — [anon] / [ANON] / [Anon] prefix +
                                   gen_message_text
  gen_private_tagged_body        — [private] prefix + gen_message_text
  gen_website_marker_body        — all four marker patterns
                                   (named/anon × prayer/thanksgiving)
  gen_telegram_update            — composes the above into a full
                                   Telegram update payload
  gen_optout_set                 — random subset of user IDs
  gen_log_state                  — composes entries spanning 30 days
  gen_entry_with_metachars       — for the P6 escape coverage test
  gen_anon_or_website_anon_entry — for the P8 leak test (carries
                                   audit-only originalFirst/Last/etc.)
  gen_website_entry_named        — for the P9 verbatim-attribution test

The `is_capturable` helper returns True iff a generated update would
result in a captured entry under the recognition cascade. Used by the
P1 idempotency test to compute the expected entries[] count.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from hypothesis import strategies as st


# ── Constants ─────────────────────────────────────────────────────────
DEFAULT_THREAD_ID = 21
DEFAULT_CHAT_ID = -1001234567890
WEBSITE_INTAKE_BOT_USER_ID = 999_999_999
WEBSITE_INTAKE_BOT_USERNAME = "stwprayerintakebot"
WEBSITE_INTAKE_BOT_FIRST = "Prayer Intake"

MARKDOWNV2_METACHARS = list("_*[]()~`>#+-=|{}.!")

# A small fixed user-ID pool so opt-out tests have a chance of
# generating overlap between optOut[] and entry.userId (otherwise
# random ints have astronomically low collision probability).
USER_ID_POOL = list(range(1, 21))

ANON_TAG_VARIANTS = ["[anon]", "[ANON]", "[Anon]", "[ aNoN ]"]
PRIVATE_TAG_VARIANTS = ["[private]", "[PRIVATE]", "[Private]"]


# ── Default cfg used by tests ─────────────────────────────────────────
def make_test_cfg(*, entry_cap: int = 15, summary_max: int = 60,
                  exclude_user_ids: list[int] | None = None) -> dict:
    return {
        "prayer": {
            "digest": {
                "enabled": True,
                "messageThreadId": DEFAULT_THREAD_ID,
                "entryCap": entry_cap,
                "summaryMaxChars": summary_max,
                "scheduleDays": ["mon", "thu", "sat"],
                "privateTags": ["[private]"],
                "anonTags": ["[anon]"],
                "excludeUserIds": list(exclude_user_ids or []),
                "websiteSubmissionMarker": "(via the website)",
            }
        }
    }


# ── User strategies ───────────────────────────────────────────────────
def _maybe(s: st.SearchStrategy[str], p: float = 0.7) -> st.SearchStrategy[str | None]:
    """A strategy that is `s` with probability ~p, else None."""
    return st.one_of(st.none(), s, s)  # 2/3 chance of a value


def gen_user() -> st.SearchStrategy[dict]:
    """Random Telegram `from` payload. is_bot is False so generated
    users are real members. Use gen_bot_user for the bot-author
    case."""
    return st.fixed_dictionaries({
        "id": st.sampled_from(USER_ID_POOL),
        "is_bot": st.just(False),
        "first_name": _maybe(st.text(min_size=1, max_size=12)),
        "last_name": _maybe(st.text(min_size=1, max_size=12)),
        "username": _maybe(st.text(
            alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="_"),
            min_size=3, max_size=20,
        )),
    })


def gen_user_with_metachars() -> st.SearchStrategy[dict]:
    """Same shape as gen_user but names drawn from a charset that
    includes every MarkdownV2 metacharacter. The P6 escape-coverage
    worst case."""
    metachar_text = st.text(
        alphabet=st.characters(
            whitelist_categories=("L", "N"),
            whitelist_characters="".join(MARKDOWNV2_METACHARS),
        ),
        min_size=1, max_size=20,
    )
    return st.fixed_dictionaries({
        "id": st.sampled_from(USER_ID_POOL),
        "is_bot": st.just(False),
        "first_name": _maybe(metachar_text),
        "last_name": _maybe(metachar_text),
        "username": _maybe(st.text(
            alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="_"),
            min_size=3, max_size=20,
        )),
    })


def gen_bot_user() -> st.SearchStrategy[dict]:
    return st.fixed_dictionaries({
        "id": st.integers(min_value=900_000_000, max_value=999_999_998),
        "is_bot": st.just(True),
        "first_name": st.just("Some Bot"),
        "username": st.just("somebot"),
    })


def gen_website_intake_bot() -> st.SearchStrategy[dict]:
    return st.just({
        "id": WEBSITE_INTAKE_BOT_USER_ID,
        "is_bot": True,
        "first_name": WEBSITE_INTAKE_BOT_FIRST,
        "username": WEBSITE_INTAKE_BOT_USERNAME,
    })


# ── Body strategies ───────────────────────────────────────────────────
def gen_message_text() -> st.SearchStrategy[str]:
    """Random Unicode text up to ~500 chars, excluding the leading
    marker / tag patterns so this generator only produces 'plain'
    bodies. Tag-prefixed bodies have their own generators."""
    base = st.text(min_size=0, max_size=500)
    return base.filter(lambda s: not (
        s.lstrip().lower().startswith("[anon]")
        or s.lstrip().lower().startswith("[private]")
        or s.lstrip().startswith("💌 New ")
    ))


def gen_anon_tagged_body() -> st.SearchStrategy[str]:
    return st.builds(
        lambda tag, body, lead_ws: lead_ws + tag + " " + body,
        st.sampled_from(ANON_TAG_VARIANTS),
        gen_message_text(),
        st.sampled_from(["", " ", "  ", "\n"]),
    )


def gen_private_tagged_body() -> st.SearchStrategy[str]:
    return st.builds(
        lambda tag, body, lead_ws: lead_ws + tag + " " + body,
        st.sampled_from(PRIVATE_TAG_VARIANTS),
        gen_message_text(),
        st.sampled_from(["", " ", "  "]),
    )


def gen_website_marker_body() -> st.SearchStrategy[tuple[str, dict]]:
    """Returns (marker_body, expected_meta) where expected_meta carries
    the `kind`, the captured `name`, and the captured `body` so tests
    can assert the parser round-trips correctly."""
    def _build(verb_kind: str, anonymous: bool, name: str, body: str
               ) -> tuple[str, dict]:
        verb = "prayer request" if verb_kind == "prayer" else "thanksgiving announcement"
        marker_name = "Anonymous" if anonymous else name
        text = f"💌 New {verb} from {marker_name} (via the website): {body}"
        kind = (
            "website-anonymous" if anonymous
            else "website"
        )
        return text, {
            "kind": kind,
            "expected_name": "Anonymous" if anonymous else name,
            "expected_body": body,
            "verb": verb,
        }

    return st.builds(
        _build,
        st.sampled_from(["prayer", "thanksgiving"]),
        st.booleans(),
        st.text(min_size=1, max_size=30).filter(
            lambda n: n.strip() and "(via the website)" not in n and ":" not in n
        ),
        gen_message_text(),
    )


# ── Update strategies ─────────────────────────────────────────────────
def _ts() -> st.SearchStrategy[int]:
    """Unix epoch seconds inside the last 30 days."""
    base = int(datetime(2026, 5, 23, tzinfo=timezone.utc).timestamp())
    return st.integers(min_value=base - 30 * 86400, max_value=base)


def gen_telegram_update(
    *,
    update_id_start: int = 1,
    weight_normal: int = 8,
    weight_anon: int = 2,
    weight_private: int = 2,
    weight_website: int = 2,
    weight_bot: int = 1,
    weight_dm: int = 1,
    weight_wrong_thread: int = 1,
) -> st.SearchStrategy[dict]:
    """Composes a full Telegram update dict. Mostly produces normal
    Prayer_Topic captures; the other variants exercise the rest of
    the cascade."""

    def _normal(user, body, ts, mid, uid):
        return {
            "update_id": uid,
            "message": {
                "message_id": mid,
                "date": ts,
                "chat": {"id": DEFAULT_CHAT_ID, "type": "supergroup"},
                "message_thread_id": DEFAULT_THREAD_ID,
                "from": user,
                "text": body,
            },
        }

    def _wrong_thread(user, body, ts, mid, uid):
        return {
            "update_id": uid,
            "message": {
                "message_id": mid,
                "date": ts,
                "chat": {"id": DEFAULT_CHAT_ID, "type": "supergroup"},
                "message_thread_id": 999,
                "from": user,
                "text": body,
            },
        }

    def _dm(user, body, ts, mid, uid):
        return {
            "update_id": uid,
            "message": {
                "message_id": mid,
                "date": ts,
                "chat": {"id": user["id"], "type": "private"},
                "from": user,
                "text": body,
            },
        }

    normal_strategy = st.builds(
        _normal, gen_user(), gen_message_text(), _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )
    anon_strategy = st.builds(
        _normal, gen_user(), gen_anon_tagged_body(), _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )
    private_strategy = st.builds(
        _normal, gen_user(), gen_private_tagged_body(), _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )
    website_strategy = st.builds(
        lambda intake_bot, marker_pair, ts, mid, uid: _normal(
            intake_bot, marker_pair[0], ts, mid, uid
        ),
        gen_website_intake_bot(), gen_website_marker_body(), _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )
    bot_strategy = st.builds(
        _normal, gen_bot_user(), gen_message_text(), _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )
    dm_strategy = st.builds(
        _dm, gen_user(),
        st.sampled_from([
            "/skipdigest", "/optindigest", "/skipdigest@stwprayerbot",
            "/OPTINDIGEST", "hello bot",
        ]),
        _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )
    wrong_thread_strategy = st.builds(
        _wrong_thread, gen_user(), gen_message_text(), _ts(),
        st.integers(min_value=1, max_value=100_000),
        st.integers(min_value=update_id_start, max_value=update_id_start + 10_000),
    )

    return st.one_of(
        *([normal_strategy] * weight_normal),
        *([anon_strategy] * weight_anon),
        *([private_strategy] * weight_private),
        *([website_strategy] * weight_website),
        *([bot_strategy] * weight_bot),
        *([dm_strategy] * weight_dm),
        *([wrong_thread_strategy] * weight_wrong_thread),
    )


def gen_optout_set() -> st.SearchStrategy[list[int]]:
    """Random subset of USER_ID_POOL."""
    return st.lists(
        st.sampled_from(USER_ID_POOL),
        min_size=0, max_size=5, unique=True,
    ).map(sorted)


# ── Entry strategies (for renderer / selection tests) ─────────────────
def _entry_ts() -> st.SearchStrategy[str]:
    base = datetime(2026, 5, 23, tzinfo=timezone.utc)
    return st.integers(min_value=-30 * 86400, max_value=0).map(
        lambda secs: (base + timedelta(seconds=secs)).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def _build_entry(
    chat_id: int, message_id: int, user_id: int, display_name: str,
    kind: str, text: str, ts: str,
    *, original_first: str = "", original_last: str = "",
    original_username: str = "",
) -> dict:
    e = {
        "chatId": chat_id,
        "messageId": message_id,
        "userId": user_id,
        "displayName": display_name,
        "anonymous": display_name == "Anonymous",
        "kind": kind,
        "text": text,
        "ts": ts,
    }
    # Audit-only fields used by P8 / P9 tests; not present in
    # production entries.
    if original_first:
        e["originalFirst"] = original_first
    if original_last:
        e["originalLast"] = original_last
    if original_username:
        e["originalUsername"] = original_username
    return e


def gen_entry_with_metachars() -> st.SearchStrategy[dict]:
    """Entries whose displayName + text both include MarkdownV2
    metacharacters. Used by P6."""
    metachar_text = st.text(
        alphabet=st.characters(
            whitelist_categories=("L", "N"),
            whitelist_characters="".join(MARKDOWNV2_METACHARS),
        ),
        min_size=1, max_size=30,
    )
    return st.builds(
        _build_entry,
        st.just(DEFAULT_CHAT_ID),
        st.integers(min_value=1, max_value=100_000),
        st.sampled_from(USER_ID_POOL),
        metachar_text,
        st.just("telegram"),
        metachar_text,
        _entry_ts(),
    )


def gen_anon_or_website_anon_entry() -> st.SearchStrategy[dict]:
    """Entries whose captured displayName is the literal `Anonymous`,
    carrying audit-only `originalFirst`/`originalLast`/`originalUsername`
    so P8 can assert no leak."""
    audit_first = st.text(min_size=1, max_size=12, alphabet=st.characters(whitelist_categories=("L", "N")))
    audit_last = st.text(min_size=0, max_size=12, alphabet=st.characters(whitelist_categories=("L", "N")))
    audit_username = st.text(
        min_size=3, max_size=12,
        alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="_"),
    )
    return st.builds(
        lambda mid, uid, kind, body, ts, first, last, uname: _build_entry(
            DEFAULT_CHAT_ID, mid, uid, "Anonymous", kind, body, ts,
            original_first=first, original_last=last, original_username=uname,
        ),
        st.integers(min_value=1, max_value=100_000),
        st.sampled_from(USER_ID_POOL),
        st.sampled_from(["telegram-anon", "website-anonymous"]),
        gen_message_text(),
        _entry_ts(),
        audit_first, audit_last, audit_username,
    )


def gen_website_entry_named() -> st.SearchStrategy[dict]:
    """Entries with kind=website and a non-anonymous display name. The
    user_id is the website-intake bot's ID; the displayName is the
    captured Submitter_Name. Used by P9."""
    submitter_name = st.text(min_size=1, max_size=30).filter(
        lambda n: n.strip() and n.strip() != "Anonymous" and ":" not in n
    )
    return st.builds(
        lambda mid, name, body, ts: _build_entry(
            DEFAULT_CHAT_ID, mid, WEBSITE_INTAKE_BOT_USER_ID,
            name.strip(), "website", body, ts,
        ),
        st.integers(min_value=1, max_value=100_000),
        submitter_name,
        gen_message_text(),
        _entry_ts(),
    )


def gen_log_state() -> st.SearchStrategy[dict]:
    """A whole Prayer_Log shape with a random mix of entries spanning
    30 days (so prune properties exercise both sides of the 14-day
    cutoff). lastUpdateId / completedSlots intentionally non-empty so
    selection tests are not running against an is_first_run shape."""
    entry_strategies = st.one_of(
        gen_entry_with_metachars(),
        gen_anon_or_website_anon_entry(),
        gen_website_entry_named(),
        st.builds(
            _build_entry,
            st.just(DEFAULT_CHAT_ID),
            st.integers(min_value=1, max_value=100_000),
            st.sampled_from(USER_ID_POOL),
            st.text(min_size=1, max_size=20),
            st.just("telegram"),
            gen_message_text(),
            _entry_ts(),
        ),
    )
    return st.fixed_dictionaries({
        "schemaVersion": st.just(1),
        "lastUpdateId": st.integers(min_value=0, max_value=10_000),
        "lastModified": st.just("2026-05-23T15:00:00Z"),
        "optOut": st.lists(st.sampled_from(USER_ID_POOL), min_size=0, max_size=5, unique=True),
        "completedSlots": st.fixed_dictionaries({
            "2026-W21-thu": st.fixed_dictionaries({
                "since": st.just("2026-05-21T15:00:00Z"),
                "messageId": st.integers(min_value=1, max_value=99999),
                "entryCount": st.integers(min_value=0, max_value=15),
                "postedAt": st.just("2026-05-21T15:00:09Z"),
            }),
        }),
        "entries": st.lists(entry_strategies, min_size=0, max_size=40, unique_by=lambda e: (e["chatId"], e["messageId"])),
    })


# ── Helpers used by tests ─────────────────────────────────────────────
def is_capturable(update: dict, *, opt_out: set[int] | None = None,
                  exclude_user_ids: set[int] | None = None) -> bool:
    """Return True iff the update would land in entries[] under the
    recognition cascade. Mirrors the cascade order from §8.1 of
    design.md but bypasses dedup (the caller computes the distinct
    dedup-key count directly)."""
    opt_out = opt_out or set()
    exclude_user_ids = exclude_user_ids or set()
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return False
    chat = msg.get("chat") or {}
    if (chat.get("type") or "").lower() == "private":
        return False  # DM commands never produce entries
    if msg.get("message_thread_id") != DEFAULT_THREAD_ID:
        return False
    body_raw = (msg.get("text") or msg.get("caption") or "")
    if not body_raw or not body_raw.strip():
        return False
    sender = msg.get("from") or {}
    body_lstripped = body_raw.lstrip()
    is_website = body_lstripped.startswith("💌 New ")
    if sender.get("is_bot") and not is_website:
        return False
    lowered = body_lstripped.lower()
    if any(lowered.startswith(t.lower()) for t in ["[private]"]):
        return False
    user_id = sender.get("id")
    if user_id is not None and (user_id in opt_out or user_id in exclude_user_ids):
        return False
    return True
