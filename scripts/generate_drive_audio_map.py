#!/usr/bin/env python3
"""
generate_drive_audio_map.py
===========================
One-time script to build assets/data/bible-audio-drive-map.json from
the Google Drive folder containing the FCBH ESV audio files.

Usage:
    python scripts/generate_drive_audio_map.py --folder-id 1q76bkqzJdjX919DFGyv5oYurj3qSMuOv

Requirements:
    pip install google-api-python-client google-auth

Authentication:
    The folder is public ("anyone with link"), so we can use the Drive API
    with just an API key (no OAuth needed).

    Get a free API key:
    1. Go to https://console.cloud.google.com/
    2. Create a project → Enable "Google Drive API"
    3. Credentials → Create credentials → API key
    4. Pass it via --api-key or set GOOGLE_API_KEY env var

Output:
    Writes assets/data/bible-audio-drive-map.json with this shape:
    {
      "_help": "...",
      "folderUrl": "https://drive.google.com/drive/folders/...",
      "chapters": {
        "Matthew 1": "FILE_ID",
        "Matthew 2": "FILE_ID",
        ...
        "Revelation 22": "FILE_ID"
      }
    }

    Each value is the Google Drive file ID. To stream the audio:
      https://drive.google.com/uc?export=open&id=FILE_ID
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

FOLDER_ID = "1q76bkqzJdjX919DFGyv5oYurj3qSMuOv"

# FCBH NT book ordering — B01..B27
# The filenames use the OSIS-style short names padded with underscores.
FCBH_NT_BOOKS = [
    (1,  "Matthew",        "Matthew_____"),
    (2,  "Mark",           "Mark________"),
    (3,  "Luke",           "Luke________"),
    (4,  "John",           "John________"),
    (5,  "Acts",           "Acts________"),
    (6,  "Romans",         "Romans______"),
    (7,  "1 Corinthians",  "1Corinthians"),
    (8,  "2 Corinthians",  "2Corinthians"),
    (9,  "Galatians",      "Galatians___"),
    (10, "Ephesians",      "Ephesians___"),
    (11, "Philippians",    "Philippians_"),
    (12, "Colossians",     "Colossians__"),
    (13, "1 Thessalonians","1Thess______"),
    (14, "2 Thessalonians","2Thess______"),
    (15, "1 Timothy",      "1Timothy____"),
    (16, "2 Timothy",      "2Timothy____"),
    (17, "Titus",          "Titus_______"),
    (18, "Philemon",       "Philemon____"),
    (19, "Hebrews",        "Hebrews_____"),
    (20, "James",          "James_______"),
    (21, "1 Peter",        "1Peter______"),
    (22, "2 Peter",        "2Peter______"),
    (23, "1 John",         "1John_______"),
    (24, "2 John",         "2John_______"),
    (25, "3 John",         "3John_______"),
    (26, "Jude",           "Jude________"),
    (27, "Revelation",     "Revelation__"),
]

# NT chapter counts
NT_CHAPTERS = {
    "Matthew": 28, "Mark": 16, "Luke": 24, "John": 21,
    "Acts": 28, "Romans": 16, "1 Corinthians": 16, "2 Corinthians": 13,
    "Galatians": 6, "Ephesians": 6, "Philippians": 4, "Colossians": 4,
    "1 Thessalonians": 5, "2 Thessalonians": 3, "1 Timothy": 6,
    "2 Timothy": 4, "Titus": 3, "Philemon": 1, "Hebrews": 13,
    "James": 5, "1 Peter": 5, "2 Peter": 3, "1 John": 5,
    "2 John": 1, "3 John": 1, "Jude": 1, "Revelation": 22,
}

def build_expected_filenames():
    """Build a dict of expected filename prefix -> chapter key."""
    mapping = {}
    for book_num, book_name, fcbh_short in FCBH_NT_BOOKS:
        chapters = NT_CHAPTERS[book_name]
        for ch in range(1, chapters + 1):
            # FCBH format: B04___03_John________ENGGIDN1DA
            prefix = f"B{book_num:02d}___{ch:03d}_{fcbh_short}ENGGIDN1DA"
            chapter_key = f"{book_name} {ch}"
            mapping[prefix] = chapter_key
    return mapping

def match_filename(filename, expected):
    """Match a Drive filename to a chapter key."""
    # Strip extension
    base = re.sub(r'\.(mp3|m4a|wav|ogg)$', '', filename, flags=re.IGNORECASE)
    return expected.get(base)

def fetch_all_files(service, folder_id):
    """Fetch all files from a Drive folder (handles pagination)."""
    files = []
    page_token = None
    while True:
        query = f"'{folder_id}' in parents and trashed=false"
        resp = service.files().list(
            q=query,
            fields="nextPageToken, files(id, name)",
            pageSize=1000,
            pageToken=page_token
        ).execute()
        files.extend(resp.get('files', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return files

def main():
    parser = argparse.ArgumentParser(description='Generate bible audio Drive map')
    parser.add_argument('--folder-id', default=FOLDER_ID)
    parser.add_argument('--api-key', default=os.environ.get('GOOGLE_API_KEY'))
    parser.add_argument('--output', default='assets/data/bible-audio-drive-map.json')
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: provide --api-key or set GOOGLE_API_KEY env var", file=sys.stderr)
        print("Get a free key at https://console.cloud.google.com/", file=sys.stderr)
        sys.exit(1)

    try:
        from googleapiclient.discovery import build
    except ImportError:
        print("ERROR: run: pip install google-api-python-client", file=sys.stderr)
        sys.exit(1)

    service = build('drive', 'v3', developerKey=args.api_key)

    print(f"Fetching files from folder {args.folder_id}...")
    files = fetch_all_files(service, args.folder_id)
    print(f"Found {len(files)} files.")

    expected = build_expected_filenames()
    chapters = {}
    unmatched = []

    for f in files:
        chapter_key = match_filename(f['name'], expected)
        if chapter_key:
            chapters[chapter_key] = f['id']
        else:
            unmatched.append(f['name'])

    if unmatched:
        print(f"\nWARNING: {len(unmatched)} files did not match expected pattern:")
        for name in sorted(unmatched)[:10]:
            print(f"  {name}")
        if len(unmatched) > 10:
            print(f"  ... and {len(unmatched)-10} more")

    # Sort by canonical NT order
    order = []
    for _, book_name, _ in FCBH_NT_BOOKS:
        for ch in range(1, NT_CHAPTERS[book_name] + 1):
            key = f"{book_name} {ch}"
            if key in chapters:
                order.append((key, chapters[key]))

    ordered_chapters = {k: v for k, v in order}

    output = {
        "_help": (
            "Maps NT chapter keys (e.g. 'John 3') to Google Drive file IDs "
            "for the FCBH ESV audio recordings. "
            "Stream URL: https://drive.google.com/uc?export=open&id=FILE_ID "
            "Generated by scripts/generate_drive_audio_map.py — do not edit by hand."
        ),
        "folderUrl": f"https://drive.google.com/drive/folders/{args.folder_id}",
        "streamUrlTemplate": "https://drive.google.com/uc?export=open&id={fileId}",
        "chapters": ordered_chapters,
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + '\n')
    print(f"\nWrote {len(ordered_chapters)} chapters to {out_path}")

    missing = []
    for _, book_name, _ in FCBH_NT_BOOKS:
        for ch in range(1, NT_CHAPTERS[book_name] + 1):
            key = f"{book_name} {ch}"
            if key not in ordered_chapters:
                missing.append(key)
    if missing:
        print(f"\nMissing {len(missing)} chapters:")
        for m in missing:
            print(f"  {m}")
    else:
        print("All 260 NT chapters mapped successfully.")

if __name__ == '__main__':
    main()
