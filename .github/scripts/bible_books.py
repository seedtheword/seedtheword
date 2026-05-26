"""Single source of truth for the canonical 66-book Protestant Bible.

This module exposes three constants used throughout the bible-audio-pipeline
(P2, P4, P7 generators, the Telegram_Poller's slug reverse-lookup, and the
chapter-display helpers) so that every consumer agrees on the same book
ordering and chapter counts:

- ``OT_BOOKS``: 39 ``(name, chapter_count)`` tuples, Genesis…Malachi.
- ``NT_BOOKS``: 27 ``(name, chapter_count)`` tuples, Matthew…Revelation.
- ``BIBLE_BOOKS``: ``OT_BOOKS + NT_BOOKS`` (66 entries).
- ``BIBLE_BOOK_NAMES``: just the book names, in canonical order.

Numbered books use the form ``"1 Samuel"``, ``"2 Corinthians"``, etc. The
fifth wisdom book is named ``"Song of Solomon"``.

The module is intentionally dependency-free and uses only absolute imports
so it can be imported from both ``.github/scripts/*`` and ``tests/*``.
"""

from __future__ import annotations

# ── Old Testament (39 books, Genesis…Malachi) ──────────────────────────
OT_BOOKS = [
    ("Genesis", 50), ("Exodus", 40), ("Leviticus", 27), ("Numbers", 36),
    ("Deuteronomy", 34), ("Joshua", 24), ("Judges", 21), ("Ruth", 4),
    ("1 Samuel", 31), ("2 Samuel", 24), ("1 Kings", 22), ("2 Kings", 25),
    ("1 Chronicles", 29), ("2 Chronicles", 36), ("Ezra", 10),
    ("Nehemiah", 13), ("Esther", 10), ("Job", 42), ("Psalms", 150),
    ("Proverbs", 31), ("Ecclesiastes", 12), ("Song of Solomon", 8),
    ("Isaiah", 66), ("Jeremiah", 52), ("Lamentations", 5), ("Ezekiel", 48),
    ("Daniel", 12), ("Hosea", 14), ("Joel", 3), ("Amos", 9),
    ("Obadiah", 1), ("Jonah", 4), ("Micah", 7), ("Nahum", 3),
    ("Habakkuk", 3), ("Zephaniah", 3), ("Haggai", 2), ("Zechariah", 14),
    ("Malachi", 4),
]

# ── New Testament (27 books, Matthew…Revelation) ───────────────────────
# Lifted verbatim from .github/scripts/post_daily_bible_to_telegram.py so
# the existing reading-plan logic continues to use the same data.
NT_BOOKS = [
    ("Matthew", 28), ("Mark", 16), ("Luke", 24), ("John", 21),
    ("Acts", 28), ("Romans", 16), ("1 Corinthians", 16), ("2 Corinthians", 13),
    ("Galatians", 6), ("Ephesians", 6), ("Philippians", 4), ("Colossians", 4),
    ("1 Thessalonians", 5), ("2 Thessalonians", 3), ("1 Timothy", 6),
    ("2 Timothy", 4), ("Titus", 3), ("Philemon", 1), ("Hebrews", 13),
    ("James", 5), ("1 Peter", 5), ("2 Peter", 3), ("1 John", 5),
    ("2 John", 1), ("3 John", 1), ("Jude", 1), ("Revelation", 22),
]

# ── Full canonical 66-book list (used by P2, P4, P7 generators and by
#    Telegram_Poller's _slugToChapterDisplay reverse-lookup) ────────────
BIBLE_BOOKS = OT_BOOKS + NT_BOOKS

# ── Convenience: just the names, in canonical order ────────────────────
BIBLE_BOOK_NAMES = [name for name, _ in BIBLE_BOOKS]


# ── Layered Bible Reading Plan companion-stream sequences ──────────────
# Two flat-sequence book lists used by both the website renderer
# (assets/js/layered-plan.js, byte-equivalent contents) and the Telegram
# bot footer (build_layered_footer in post_daily_bible_to_telegram.py).
# Property L10 asserts that all three implementations agree on chapter
# references for the same date.
#
# OT_HISTORY_BOOKS — Genesis through Esther in canonical order.
# POETRY_PROPHECY_BOOKS — Job through Malachi in canonical order, with
#   Psalms and Proverbs DELIBERATELY EXCLUDED because they have their
#   own daily formula-driven streams (psalm_of_day, proverb_of_day).

OT_HISTORY_BOOKS = [
    ("Genesis", 50), ("Exodus", 40), ("Leviticus", 27), ("Numbers", 36),
    ("Deuteronomy", 34), ("Joshua", 24), ("Judges", 21), ("Ruth", 4),
    ("1 Samuel", 31), ("2 Samuel", 24), ("1 Kings", 22), ("2 Kings", 25),
    ("1 Chronicles", 29), ("2 Chronicles", 36), ("Ezra", 10),
    ("Nehemiah", 13), ("Esther", 10),
]

POETRY_PROPHECY_BOOKS = [
    ("Job", 42), ("Ecclesiastes", 12), ("Song of Solomon", 8),
    ("Isaiah", 66), ("Jeremiah", 52), ("Lamentations", 5),
    ("Ezekiel", 48), ("Daniel", 12), ("Hosea", 14), ("Joel", 3),
    ("Amos", 9), ("Obadiah", 1), ("Jonah", 4), ("Micah", 7),
    ("Nahum", 3), ("Habakkuk", 3), ("Zephaniah", 3), ("Haggai", 2),
    ("Zechariah", 14), ("Malachi", 4),
]


def _flatten_book_list(books):
    """Flatten [(book, n_chapters), ...] into a list of {'book', 'chapter'} dicts."""
    seq = []
    for name, count in books:
        for c in range(1, count + 1):
            seq.append({"book": name, "chapter": c})
    return seq


OT_HISTORY_SEQUENCE = _flatten_book_list(OT_HISTORY_BOOKS)
POETRY_PROPHECY_SEQUENCE = _flatten_book_list(POETRY_PROPHECY_BOOKS)
