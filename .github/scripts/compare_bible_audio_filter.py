"""
A/B helper for tuning the Bible Audio cleanup ffmpeg filter chain.

Walks the same Raw_Folder the production cleanup uses, runs every
file through a CALLER-PROVIDED filter chain, and uploads the
output to ``<cleanedDriveFolderId>/_compare/<tag>/<basename>.mp3``
so you can listen side-by-side with the production-cleaned MP3 and
pick a winner.

Triggered via workflow_dispatch from
``.github/workflows/bible-audio-compare.yml``. Uses the same OAuth
user refresh token the production cleanup uses (no extra secrets).

Env vars:
  GDRIVE_OAUTH_CLIENT_ID       — required
  GDRIVE_OAUTH_CLIENT_SECRET   — required
  GDRIVE_OAUTH_REFRESH_TOKEN   — required
  BOT_CONFIG                   — path to telegram-bot.json
  COMPARE_TAG                  — short slug naming this experiment
                                 (e.g. "aggressive", "default", "loudnorm")
  COMPARE_FILTER               — full ffmpeg -af value to use
  COMPARE_BITRATE              — output bitrate (default 128k)

Layout produced:

    <Cleaned>/_compare/
      default/
        49429301316637808.mp3    (untouched; reference for current prod chain)
      aggressive/
        49429301316637808.mp3
      loudnorm/
        49429301316637808.mp3

Each subfolder is one filter-chain experiment. Listen to all three
to compare.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

from clean_bible_audio import (  # type: ignore
    log,
    load_audio_config,
    build_drive_service,
    list_two_level,
    download_file,
    get_or_create_subfolder,
)
from googleapiclient.http import MediaFileUpload


def _upload_under_compare_tag(drive, cleaned_root_id: str, tag: str, basename: str, src_path: str) -> str:
    """Upload to ``<cleaned_root>/_compare/<tag>/<basename>``.
    Creates both the ``_compare`` and ``<tag>`` subfolders on demand.
    """
    compare_root = get_or_create_subfolder(drive, cleaned_root_id, "_compare")
    tag_folder = get_or_create_subfolder(drive, compare_root, tag)
    media = MediaFileUpload(src_path, mimetype="audio/mpeg", resumable=True)
    created = drive.files().create(
        body={"name": basename, "parents": [tag_folder]},
        media_body=media,
        fields="id",
    ).execute()
    return created["id"]


def main() -> int:
    cfg = load_audio_config()

    if not cfg.get("rawDriveFolderId"):
        log("ERROR: bible.audio.rawDriveFolderId is empty")
        return 1
    if not cfg.get("cleanedDriveFolderId"):
        log("ERROR: bible.audio.cleanedDriveFolderId is empty")
        return 1

    tag = (os.environ.get("COMPARE_TAG") or "").strip()
    custom_filter = (os.environ.get("COMPARE_FILTER") or "").strip()
    bitrate = (os.environ.get("COMPARE_BITRATE") or "128k").strip()
    if not tag:
        log("ERROR: COMPARE_TAG env var must be set (short slug naming this experiment)")
        return 1
    if not custom_filter:
        log("ERROR: COMPARE_FILTER env var must be set (full ffmpeg -af value)")
        return 1
    # Sanity: tag must be filename-safe
    if not all(ch.isalnum() or ch in "-_" for ch in tag):
        log(f"ERROR: COMPARE_TAG {tag!r} must contain only [a-zA-Z0-9_-]")
        return 1

    drive = build_drive_service()

    raw_index = list_two_level(drive, cfg["rawDriveFolderId"])
    if not raw_index:
        log("nothing in Raw_Folder; nothing to compare")
        return 0

    log(f"compare run: tag={tag} bitrate={bitrate} files={len(raw_index)}")
    log(f"compare filter: {custom_filter}")

    successes = 0
    failures = 0
    for (slug, msg_id), file_id in sorted(raw_index.items()):
        try:
            with tempfile.TemporaryDirectory() as tmp:
                in_path = os.path.join(tmp, f"in_{msg_id}")
                out_path = os.path.join(tmp, f"{msg_id}.mp3")
                download_file(drive, file_id, in_path)
                subprocess.run(
                    [
                        "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
                        "-i", in_path,
                        "-af", custom_filter,
                        "-ar", "44100",
                        "-b:a", bitrate,
                        "-ac", "1",
                        out_path,
                    ],
                    check=True,
                )
                if os.path.getsize(out_path) == 0:
                    raise RuntimeError("ffmpeg produced 0-byte output")
                _upload_under_compare_tag(
                    drive,
                    cfg["cleanedDriveFolderId"],
                    tag,
                    f"{msg_id}.mp3",
                    out_path,
                )
            log(f"compare: {tag}/{msg_id}.mp3 uploaded")
            successes += 1
        except Exception as e:
            log(f"compare ERROR processing {slug}/{msg_id}: {e}")
            failures += 1
            continue

    log(f"compare done: tag={tag} successes={successes} failures={failures}")
    return 0 if successes else 1


if __name__ == "__main__":
    sys.exit(main())
