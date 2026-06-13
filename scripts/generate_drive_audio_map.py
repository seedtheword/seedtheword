#!/usr/bin/env python3
"""
generate_drive_audio_map.py
===========================
Builds assets/data/bible-audio-drive-map.json by listing all files in
the FCBH ESV audio Drive folder and mapping each filename to its Drive
file ID. Designed to run as a GitHub Action using the same OAuth
credentials already in place for the bible audio pipeline.

Usage (local):
    GDRIVE_OAUTH_CLIENT_ID=...
    GDRIVE_OAUTH_CLIENT_SECRET=...
    GDRIVE_OAUTH_REFRESH_TOKEN=...
    python scripts/generate_drive_audio_map.py

Usage (GitHub Action): see .github/workflows/bible-audio-map.yml

Output: assets/data/bible-audio-drive-map.json
  {
    "chapters": {
      "Matthew 1": "DRIVE_FILE_ID",
      ...
      "Revelation 22": "DRIVE_FILE_ID"
    }
  }

Stream URL pattern:
  https://drive.google.com/uc?export=download&id={fileId}
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

FOLDER_ID = "1q76bkqzJdjX919DFGyv5oYurj3qSMuOv"
OUTPUT_PATH = Path("assets/data/bible-audio-drive-map.json")

# ── NT book table ───────────────────────────────────────────────────────────
# Each tuple: (FCBH book number, display name, FCBH padded short name)
FCBH_NT_BOOKS = [
    (1,  "Matthew",          "Matthew_____"),
    (2,  "Mark",             "Mark________"),
    (3,  "Luke",             "Luke________"),
    (4,  "John",             "John________"),
    (5,  "Acts",             "Acts________"),
    (6,  "Romans",           "Romans______"),
    (7,  "1 Corinthians",    "1Corinthians"),
    (8,  "2 Corinthians",    "2Corinthians"),
    (9,  "Galatians",        "Galatians___"),
    (10, "Ephesians",        "Ephesians___"),
    (11, "Philippians",      "Philippians_"),
    (12, "Colossians",       "Colossians__"),
    (13, "1 Thessalonians",  "1Thess______"),
    (14, "2 Thessalonians",  "2Thess______"),
    (15, "1 Timothy",        "1Timothy____"),
    (16, "2 Timothy",        "2Timothy____"),
    (17, "Titus",            "Titus_______"),
    (18, "Philemon",         "Philemon____"),
    (19, "Hebrews",          "Hebrews_____"),
    (20, "James",            "James_______"),
    (21, "1 Peter",          "1Peter______"),
    (22, "2 Peter",          "2Peter______"),
    (23, "1 John",           "1John_______"),
    (24, "2 John",           "2John_______"),
    (25, "3 John",           "3John_______"),
    (26, "Jude",             "Jude________"),
    (27, "Revelation",       "Revelation__"),
]

NT_CHAPTERS = {
    "Matthew": 28, "Mark": 16, "Luke": 24, "John": 21,
    "Acts": 28, "Romans": 16, "1 Corinthians": 16, "2 Corinthians": 13,
    "Galatians": 6, "Ephesians": 6, "Philippians": 4, "Colossians": 4,
    "1 Thessalonians": 5, "2 Thessalonians": 3, "1 Timothy": 6,
    "2 Timothy": 4, "Titus": 3, "Philemon": 1, "Hebrews": 13,
    "James": 5, "1 Peter": 5, "2 Peter": 3, "1 John": 5,
    "2 John": 1, "3 John": 1, "Jude": 1, "Revelation": 22,
}


def build_expected_map() -> dict[str, str]:
    """Return {filename_without_extension: chapter_key} for all 260 NT chapters."""
    mapping = {}
    for book_num, book_name, fcbh_short in FCBH_NT_BOOKS:
        for ch in range(1, NT_CHAPTERS[book_name] + 1):
            prefix = f"B{book_num:02d}___{ch:02d}_{fcbh_short}ENGGIDN1DA"
            mapping[prefix] = f"{book_name} {ch}"
    return mapping


def build_drive_service():
    """Build a Drive v3 client using the existing OAuth credentials
    already stored as GitHub Secrets (same pattern as clean_bible_audio.py)."""
    try:
        from googleapiclient.discovery import build
        from google.oauth2.credentials import Credentials
    except ImportError:
        print("ERROR: run: pip install google-api-python-client google-auth", file=sys.stderr)
        sys.exit(1)

    client_id     = os.environ.get("GDRIVE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GDRIVE_OAUTH_CLIENT_SECRET")
    refresh_token = os.environ.get("GDRIVE_OAUTH_REFRESH_TOKEN")

    missing = [k for k, v in [
        ("GDRIVE_OAUTH_CLIENT_ID", client_id),
        ("GDRIVE_OAUTH_CLIENT_SECRET", client_secret),
        ("GDRIVE_OAUTH_REFRESH_TOKEN", refresh_token),
    ] if not v]
    if missing:
        print(f"ERROR: Missing env var(s): {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_all_files(service, folder_id: str) -> list[dict]:
    """Fetch all files from a Drive folder, handling pagination."""
    files = []
    page_token = None
    while True:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id, name)",
            pageSize=1000,
            pageToken=page_token,
        ).execute()
        files.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return files


def main() -> int:
    print(f"Connecting to Google Drive...")
    service = build_drive_service()

    print(f"Listing files in folder {FOLDER_ID}...")
    files = list_all_files(service, FOLDER_ID)
    print(f"Found {len(files)} files.")

    expected = build_expected_map()
    chapters: dict[str, str] = {}
    unmatched: list[str] = []

    for f in files:
        # Strip extension for matching
        base = re.sub(r"\.(mp3|m4a|wav|ogg|opus)$", "", f["name"], flags=re.IGNORECASE)
        chapter_key = expected.get(base)
        if chapter_key:
            chapters[chapter_key] = f["id"]
        else:
            unmatched.append(f["name"])

    if unmatched:
        print(f"\nWARNING: {len(unmatched)} files did not match FCBH pattern:")
        for name in sorted(unmatched)[:10]:
            print(f"  {name}")
        if len(unmatched) > 10:
            print(f"  ... and {len(unmatched) - 10} more")

    # Sort into canonical NT order
    ordered: dict[str, str] = {}
    for _, book_name, _ in FCBH_NT_BOOKS:
        for ch in range(1, NT_CHAPTERS[book_name] + 1):
            key = f"{book_name} {ch}"
            if key in chapters:
                ordered[key] = chapters[key]

    # Check for missing chapters
    missing = []
    for _, book_name, _ in FCBH_NT_BOOKS:
        for ch in range(1, NT_CHAPTERS[book_name] + 1):
            key = f"{book_name} {ch}"
            if key not in ordered:
                missing.append(key)

    output = {
        "_help": (
            "Maps NT chapter keys (e.g. 'John 3') to Google Drive file IDs "
            "for the FCBH ESV audio recordings (ENGGIDN1DA fileset). "
            "Stream URL: https://drive.google.com/uc?export=download&id=FILE_ID. "
            "Generated by scripts/generate_drive_audio_map.py — re-run via the "
            "bible-audio-map GitHub Actions workflow to refresh."
        ),
        "folderUrl": f"https://drive.google.com/drive/folders/{FOLDER_ID}",
        "streamUrlTemplate": "https://drive.google.com/uc?export=download&id={fileId}",
        "chapters": ordered,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"\n✓ Wrote {len(ordered)} chapters to {OUTPUT_PATH}")
    if missing:
        print(f"  Missing {len(missing)} chapters: {', '.join(missing[:5])}" +
              (f" ... and {len(missing)-5} more" if len(missing) > 5 else ""))
        return 1
    else:
        print("  All 260 NT chapters mapped successfully.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
