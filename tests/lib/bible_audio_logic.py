"""Python mirror of the pure logic in ``docs/apps-script/bible-audio.gs``.

The implementations in this module must match the JavaScript copy exactly —
any drift between this module and ``bible-audio.gs`` is caught by the
optional golden cross-check at ``tests/property/test_bible_audio_slug_golden.py``
(spec task 5.7).

The functions here are pure and I/O-free. They feed the property tests in
``tests/property/`` (P1, P3, P4, P5, P6, P7) so we can exercise the dedup,
ordering, fallback, and notifier-acknowledgment logic without actually
calling Telegram, Google Drive, or MailApp.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any, Iterable

# Make .github/scripts importable so we can pull the canonical 66-book list
# from the same source of truth used by the production scripts. Pytest is
# invoked from the repo root, so resolve relative to this file.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / ".github" / "scripts"))
from bible_books import BIBLE_BOOK_NAMES  # noqa: E402  (sys.path side-effect)

# Anchor URL the Notifier email body links to. Must match the constant of
# the same name in bible-audio.gs.
ADMIN_HELP_ANCHOR = (
    "https://seedtheword.github.io/seedtheword/admin-help.html"
    "#publish-a-new-podcast-episode"
)

# ── Pure helpers (mirror bible-audio.gs) ──────────────────────────────


def derive_chapter_slug(topic_name: Any, template: Any) -> str:
    """Mirror of ``_deriveChapterSlug`` from ``bible-audio.gs``.

    Maps a topic-name string to a kebab-case Chapter_Slug or to
    ``"unknown-chapter"`` when the input does not match the configured
    name template.
    """
    if not isinstance(topic_name, str) or not isinstance(template, str):
        return "unknown-chapter"
    if not topic_name or not template:
        return "unknown-chapter"

    # Sentinel placeholders that survive regex-escaping unchanged so we
    # can swap them for the real capture groups afterward.
    book_token = "\u0001BOOK\u0001"
    chap_token = "\u0001CHAP\u0001"
    seeded = template.replace("{book}", book_token).replace(
        "{chapter}", chap_token
    )
    escaped = re.escape(seeded)
    # re.escape preserves the sentinel U+0001 bytes verbatim, so we can
    # swap them out for the real capture groups now.
    pattern = escaped.replace(book_token, "(.+?)").replace(
        chap_token, r"(\d+)"
    )
    try:
        rx = re.compile("^" + pattern + "$", re.IGNORECASE)
    except re.error:
        return "unknown-chapter"

    m = rx.match(topic_name)
    if not m:
        return "unknown-chapter"

    book_raw = m.group(1)
    chapter_raw = m.group(2)
    if not book_raw or not chapter_raw:
        return "unknown-chapter"

    slug_book = re.sub(r"[^a-z0-9]+", "-", book_raw.lower())
    slug_book = slug_book.strip("-")
    if not slug_book:
        return "unknown-chapter"

    return f"{slug_book}-{chapter_raw}"


def slug_to_chapter_display(slug: Any) -> str:
    """Mirror of ``_slugToChapterDisplay`` from ``bible-audio.gs``.

    Inverse of :func:`derive_chapter_slug` for the canonical 66 books.
    """
    if slug == "unknown-chapter":
        return "Unknown chapter"
    if not isinstance(slug, str) or not slug:
        return "Unknown chapter"

    # Compute (name, kebab) pairs and sort by descending kebab length so a
    # longer book name like "song-of-solomon" matches before a shorter
    # prefix like "song" would.
    candidates = [
        (name, re.sub(r"[^a-z0-9]+", "-", name.lower()))
        for name in BIBLE_BOOK_NAMES
    ]
    candidates.sort(key=lambda pair: len(pair[1]), reverse=True)

    for name, kebab in candidates:
        prefix = kebab + "-"
        if slug.startswith(prefix):
            rest = slug[len(prefix):]
            if rest.isdigit() and rest:
                return f"{name} {rest}"
            return "Unknown chapter"
    return "Unknown chapter"


def infer_file_extension(
    mime_type: Any, file_name: Any, kind: str
) -> str:
    """Mirror of ``_inferFileExtension`` from ``bible-audio.gs``.

    Returns one of ``"mp3"``, ``"oga"``, ``"ogg"``, ``"m4a"``, ``"wav"``.
    Defaults to ``"oga"`` for voice messages and ``"mp3"`` for audio
    messages when the inputs do not pin a specific extension.
    """
    if mime_type and isinstance(mime_type, str):
        mt = mime_type.lower()
        if mt == "audio/mpeg":
            return "mp3"
        if mt in ("audio/mp4", "audio/aac", "audio/m4a"):
            return "m4a"
        if mt == "audio/ogg":
            return "oga" if kind == "voice" else "ogg"
        if mt in ("audio/wav", "audio/x-wav", "audio/wave"):
            return "wav"
    if file_name and isinstance(file_name, str):
        m = re.search(r"\.(mp3|m4a|ogg|oga|wav)$", file_name.lower())
        if m:
            return m.group(1)
    return "oga" if kind == "voice" else "mp3"


def render_notification_email(entry: dict) -> dict:
    """Mirror of ``_renderNotificationEmail`` from ``bible-audio.gs``.

    Renders the email subject + plain-text body for one cleaned recording.
    The exact wording, indentation, and unicode glyphs (em-dash U+2014,
    right-arrow U+2192) match the JS copy line-for-line.
    """
    display = slug_to_chapter_display(entry["slug"])
    subject = (
        "[STW Audio Ready] "
        + display
        + " \u2014 cleaned recording awaiting upload"
    )

    body = (
        "Hi,\n"
        "\n"
        "A cleaned chapter recording is ready to upload to Spotify.\n"
        "\n"
        "  Chapter:    " + display + "\n"
        "  Slug:       " + entry["slug"] + "\n"
        "  Message:    Telegram message " + str(entry["messageId"]) + "\n"
        "  Download:   " + entry["downloadUrl"] + "\n"
        "\n"
        "Walkthrough:  " + ADMIN_HELP_ANCHOR + "\n"
        "\n"
        "5-step upload checklist (Path A, ~3 minutes):\n"
        "\n"
        "  1. Click the Download link above. Right-click the file in Drive and\n"
        "     pick \"Download\" to save the MP3 locally.\n"
        "\n"
        "  2. Open https://podcasters.spotify.com in a new tab. Log in with the\n"
        "     ministry Spotify account.\n"
        "\n"
        "  3. Click \"Add new episode\" \u2192 drag-drop the MP3. In the title field,\n"
        "     paste the chapter name exactly as shown above (" + display + ").\n"
        "     Description is optional. Click Publish.\n"
        "\n"
        "  4. Wait ~5 minutes for Spotify to finish processing. Once the episode\n"
        "     page loads, copy the episode URL from the address bar.\n"
        "\n"
        "  5. Open the admin editor (Editor \u2192 Bible \u2192 Spotify chapter map).\n"
        "     Find the row keyed \"" + display + "\". Paste the Spotify URL into\n"
        "     its value field. Save & commit. The Bible bot's next 08:00 PT post\n"
        "     will link to the new episode automatically.\n"
        "\n"
        "\u2014 STW Bible Audio (Apps Script project)\n"
    )

    return {"subject": subject, "body": body}


# ── Simulators (drive the property tests) ─────────────────────────────


def simulate_poll(
    updates_windows: Iterable[Iterable[dict]],
    processed_ids: Iterable[int],
    telegram_topic_id: int,
    name_template: str,
    current_topic_name: Any,
) -> tuple[list[tuple[str, int, str]], frozenset[int]]:
    """In-memory simulation of the Stage-1 poller dedup loop.

    Mirrors the JavaScript ``pollTelegramChapterAudio`` per-window logic:
    filter by thread id, filter by audio/voice payload, sort by
    ``message_id``, dedup against the running ``processed_ids`` set, and
    record the would-be Drive writes.

    Used by P1 (idempotent dedup), P3 (ordered processing), and P4
    (topic-name fallback). The simulation does NOT model Telegram offset
    advancement — those properties are about dedup/order/fallback, not
    offset bookkeeping.

    Args:
        updates_windows: iterable of windows; each window is an iterable
            of update dicts shaped like ``{"update_id": int, "message":
            {"message_id": int, "message_thread_id": int|None,
            "audio"|"voice": {...}}}``. ``message`` may be falsy.
        processed_ids: starting set of already-processed message ids.
            Treated as immutable input — a copy is made internally.
        telegram_topic_id: the thread id messages must match.
        name_template: ``bible.todayChapterTopic.nameTemplate`` value.
        current_topic_name: the topic name the regex evaluates against,
            or any non-string falsy value to force the
            ``unknown-chapter`` fallback path.

    Returns:
        ``(writes, processed_ids_after)`` where ``writes`` is the list of
        ``(slug, message_id, ext)`` tuples in Drive-write order across
        all windows, and ``processed_ids_after`` is the updated set as a
        frozenset.
    """
    processed: set[int] = set(int(x) for x in processed_ids)
    writes: list[tuple[str, int, str]] = []

    topic_for_slug = current_topic_name if isinstance(current_topic_name, str) else ""
    slug = derive_chapter_slug(topic_for_slug, name_template)

    for window in updates_windows:
        candidates: list[tuple[int, dict, str, dict]] = []
        for update in window:
            message = update.get("message") if isinstance(update, dict) else None
            if not message:
                continue
            if message.get("message_thread_id") != telegram_topic_id:
                continue
            audio = message.get("audio")
            voice = message.get("voice")
            if audio:
                payload = audio
                kind = "audio"
            elif voice:
                payload = voice
                kind = "voice"
            else:
                continue
            message_id = message.get("message_id")
            if not isinstance(message_id, int):
                continue
            if message_id in processed:
                continue
            candidates.append((message_id, message, kind, payload))

        # Sort ascending by message_id to mirror the JS poller.
        candidates.sort(key=lambda c: c[0])

        for message_id, _message, kind, payload in candidates:
            if message_id in processed:
                # Duplicate within the same window — JS behavior would
                # have already added the first one to processedIds, so
                # the later copy is skipped.
                continue
            ext = infer_file_extension(
                payload.get("mime_type") if isinstance(payload, dict) else None,
                payload.get("file_name") if isinstance(payload, dict) else None,
                kind,
            )
            writes.append((slug, message_id, ext))
            processed.add(message_id)

    return writes, frozenset(processed)


def simulate_notifier_run(
    cleaned_entries: Iterable[dict],
    acknowledged_ids: Iterable[int],
    send_outcomes: Iterable[bool],
) -> tuple[list[tuple[int, str, str]], frozenset[int]]:
    """In-memory simulation of ``notifyCleanedAudio``.

    Mirrors the dedup-and-send loop: skip any entry whose ``messageId``
    is already in ``acknowledged_ids``, render the email, attempt to
    send (driven by the supplied per-entry boolean outcome), and only
    add to ``acknowledged_ids`` on success.

    Used by P6 (notifier dedup) and P7 (email format).

    Args:
        cleaned_entries: iterable of ``{"slug", "messageId",
            "downloadUrl"}`` dicts. Sorted ascending by ``messageId``
            internally to match the JS implementation.
        acknowledged_ids: starting set of already-emailed ids. Treated
            as immutable input — a copy is made internally.
        send_outcomes: iterable of booleans, one per entry that needs
            sending (i.e. not already acknowledged). ``True`` means the
            ``MailApp.sendEmail`` call succeeded; ``False`` means it
            raised. If shorter than the to-send list, the tail is
            padded with ``True``; extras are ignored.

    Returns:
        ``(emails_sent, acknowledged_ids_after)`` where ``emails_sent``
        is the list of ``(message_id, subject, body)`` tuples in send
        order, ONLY for successful sends.
    """
    acked: set[int] = set(int(x) for x in acknowledged_ids)
    sorted_entries = sorted(
        cleaned_entries, key=lambda e: int(e["messageId"])
    )
    to_send = [e for e in sorted_entries if int(e["messageId"]) not in acked]

    outcomes_iter = iter(send_outcomes)
    emails_sent: list[tuple[int, str, str]] = []

    for entry in to_send:
        try:
            outcome = next(outcomes_iter)
        except StopIteration:
            outcome = True
        rendered = render_notification_email(entry)
        message_id = int(entry["messageId"])
        if outcome:
            emails_sent.append(
                (message_id, rendered["subject"], rendered["body"])
            )
            acked.add(message_id)
        # Failed sends are NOT added to acknowledged_ids — Req 6.6.

    return emails_sent, frozenset(acked)


def simulate_cleanup_run(
    raw_set: Iterable[tuple[str, int]],
    cleaned_set_before: Iterable[tuple[str, int]],
) -> frozenset[tuple[str, int]]:
    """In-memory simulation of ``clean_bible_audio.py``'s set-diff logic.

    Used by P5 (pipeline-boundary dedup). Returns the would-be writes
    into the cleaned folder, equal to ``set(raw) - set(cleaned_before)``.
    """
    raw = {(str(slug), int(msg_id)) for slug, msg_id in raw_set}
    cleaned = {(str(slug), int(msg_id)) for slug, msg_id in cleaned_set_before}
    return frozenset(raw - cleaned)
