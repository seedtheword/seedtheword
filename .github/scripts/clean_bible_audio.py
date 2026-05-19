"""
Stage 2 — Bible Audio Pipeline cleanup script.

Walks the Drive folder pinned at `bible.audio.rawDriveFolderId`,
finds every raw recording whose Cleaned_Counterpart at
`<cleanedDriveFolderId>/<slug>/<message_id>.mp3` does not yet exist,
runs each one through a conservative ffmpeg filter chain, and
uploads the cleaned MP3 back to Drive.

Idempotent — runs that find no new files are no-ops. Per-file
failures are logged and skipped; the workflow exits non-zero only
when every attempted file failed (Requirement 5.6).

Env vars:
  GDRIVE_SERVICE_ACCOUNT_JSON  — service-account JSON key (required)
  BOT_CONFIG                   — path to telegram-bot.json (default
                                 'assets/data/telegram-bot.json')
  DRY_RUN                      — if set to any non-empty value, log
                                 the planned writes but skip the
                                 ffmpeg + upload steps

Exit codes:
  0  — success, OR `enabled=false` (intentional no-op), OR no work
       to do, OR partial success
  1  — config error (empty cleanedDriveFolderId), OR every attempted
       file failed
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload


# ── Helpers ────────────────────────────────────────────────────────


def log(msg: str) -> None:
    """Print to stdout with a stable prefix and an immediate flush so
    the line appears live in the GitHub Actions log stream."""
    print(f"clean_bible_audio: {msg}", flush=True)


def load_audio_config() -> dict:
    """Read assets/data/telegram-bot.json (or the path pinned by
    BOT_CONFIG) and return the `bible.audio` block."""
    path = os.environ.get("BOT_CONFIG", "assets/data/telegram-bot.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError as e:
        raise RuntimeError(
            f"telegram-bot.json not found at {path!r}: {e}"
        ) from e
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"telegram-bot.json at {path!r} is not valid JSON: {e}"
        ) from e

    bible = data.get("bible")
    if not isinstance(bible, dict):
        raise RuntimeError(
            f"telegram-bot.json at {path!r} is missing the `bible` block"
        )
    audio = bible.get("audio")
    if not isinstance(audio, dict):
        raise RuntimeError(
            f"telegram-bot.json at {path!r} is missing the `bible.audio` block"
        )
    return audio


def build_drive_service(json_blob: str):
    """Build a googleapiclient Drive v3 client from a service-account
    JSON blob (the raw string contents of the JSON key file)."""
    info = json.loads(json_blob)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _escape_drive_query(value: str) -> str:
    """Escape single quotes in a Drive `q=` literal by doubling the
    standard backslash escape."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


def list_two_level(drive, parent_id: str) -> dict[tuple[str, int], str]:
    """Walk ``<parent_id>/<slug>/<file>`` AND ``<parent_id>/<file>``
    and return a dict keyed by ``(slug, message_id)`` mapping to the
    Drive file id of the leaf file.

    Two paths into the index:

    * **Subfolder layout** (``<root>/<slug>/<msgid>.<ext>``): the
      Apps Script poller writes here. The basename must be all
      digits — that's the Telegram message_id. The slug subfolder
      name is the chapter slug.
    * **Root drop** (``<root>/<anything>.<ext>``): admins or
      volunteers can drag-drop files directly into the root of
      the Raw folder. Slug becomes ``"unknown-chapter"`` (folder
      will be auto-created in the Cleaned side), and the
      message_id key is a deterministic hash of the filename so
      re-running the cleanup is idempotent.

    Files whose name doesn't end in a recognised audio extension
    (``mp3``/``oga``/``ogg``/``m4a``/``wav``) are skipped to keep
    debris from incidental Drive edits out of the index.

    Requirement 5.2/5.3/5.7/5.8: this is the source of truth for
    the set difference ``raw \\ cleaned``. Returning a
    ``(slug, message_id)`` key means the cleanup loop's
    ``set(raw_index) - set(cleaned_index)`` is the formal P5
    statement.
    """
    out: dict[tuple[str, int], str] = {}
    AUDIO_EXTS = {"mp3", "oga", "ogg", "m4a", "wav"}

    def _is_audio(name: str) -> bool:
        if "." not in name:
            return False
        return name.rsplit(".", 1)[1].lower() in AUDIO_EXTS

    def _key_for(name: str, slug: str) -> tuple[str, int] | None:
        """Compute a deterministic ``(slug, message_id)`` key for
        a file name. If the basename is all digits, use it as the
        message_id directly (preserves the canonical layout the
        poller writes). Otherwise, hash the (slug, name) pair into
        a stable 53-bit positive integer so the same input always
        yields the same key — that's what makes idempotence work
        for manual drops."""
        if "." in name:
            basename = name.rsplit(".", 1)[0]
        else:
            basename = name
        if basename and basename.isdigit():
            return (slug, int(basename))
        if not name:
            return None
        # 53-bit positive integer derived from blake2b — smaller
        # than a Telegram message_id worst case (Telegram tops out
        # at 2^32) so the two namespaces never collide.
        import hashlib
        h = hashlib.blake2b(
            (slug + "\0" + name).encode("utf-8"), digest_size=7
        ).digest()
        return (slug, int.from_bytes(h, "big"))

    # ── Step 1: list direct (non-folder) children of the parent.
    #    These are admin drag-drops at the root of Raw.
    root_files_query = (
        f"'{_escape_drive_query(parent_id)}' in parents "
        "and mimeType != 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    page_token: str | None = None
    while True:
        resp = drive.files().list(
            q=root_files_query,
            fields="nextPageToken, files(id, name)",
            pageSize=1000,
            pageToken=page_token,
        ).execute()
        for f in resp.get("files", []):
            name = f.get("name", "")
            if not _is_audio(name):
                continue
            key = _key_for(name, "unknown-chapter")
            if key is None:
                continue
            out[key] = f["id"]
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    # ── Step 2: list slug subfolders directly under the parent.
    subfolder_query = (
        f"'{_escape_drive_query(parent_id)}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    subfolders: list[dict] = []
    page_token = None
    while True:
        resp = drive.files().list(
            q=subfolder_query,
            fields="nextPageToken, files(id, name)",
            pageSize=1000,
            pageToken=page_token,
        ).execute()
        subfolders.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    # ── Step 3: for each slug subfolder, list non-folder children.
    for sub in subfolders:
        slug = sub["name"]
        sub_id = sub["id"]
        file_query = (
            f"'{_escape_drive_query(sub_id)}' in parents "
            "and mimeType != 'application/vnd.google-apps.folder' "
            "and trashed = false"
        )
        page_token = None
        while True:
            resp = drive.files().list(
                q=file_query,
                fields="nextPageToken, files(id, name)",
                pageSize=1000,
                pageToken=page_token,
            ).execute()
            for f in resp.get("files", []):
                name = f.get("name", "")
                if not _is_audio(name):
                    continue
                key = _key_for(name, slug)
                if key is None:
                    continue
                out[key] = f["id"]
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    return out


def download_file(drive, file_id: str, dest_path: str) -> None:
    """Stream the contents of a Drive file to `dest_path` via the
    media-download endpoint."""
    request = drive.files().get_media(fileId=file_id)
    with open(dest_path, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _status, done = downloader.next_chunk()


def run_ffmpeg(in_path: str, out_path: str, ffmpeg_filter: str, bitrate: str) -> None:
    """Run the conservative noise-removal pipeline against `in_path`
    and write the MP3 result to `out_path`.

    The argv shape is pinned by the design's Stage 2 pseudocode and by
    Requirements 5.4 / 5.5: `-af <filter>`, `-ar 44100`, `-b:a <bitrate>`,
    `-ac 1` (mono — chapter readings are speech).

    Post-condition: `out_path` is non-empty after the run. ffmpeg can
    silently produce a 0-byte file when the input container is so
    corrupt the demuxer reads zero frames, so we explicitly guard
    against that case (per the design's Stage 2 error matrix).
    """
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-i",
            in_path,
            "-af",
            ffmpeg_filter,
            "-ar",
            "44100",
            "-b:a",
            bitrate,
            "-ac",
            "1",
            out_path,
        ],
        check=True,
    )
    if os.path.getsize(out_path) == 0:
        raise RuntimeError("ffmpeg produced 0-byte output")


def get_or_create_subfolder(drive, parent_id: str, name: str) -> str:
    """Return the Drive file id of the `<parent>/<name>` subfolder,
    creating it if it doesn't already exist."""
    query = (
        f"'{_escape_drive_query(parent_id)}' in parents "
        f"and name = '{_escape_drive_query(name)}' "
        "and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    resp = drive.files().list(
        q=query,
        fields="files(id, name)",
        pageSize=10,
    ).execute()
    files = resp.get("files", [])
    if files:
        return files[0]["id"]

    created = drive.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id",
    ).execute()
    return created["id"]


def upload_to_subfolder(
    drive,
    parent_id: str,
    slug: str,
    filename: str,
    src_path: str,
) -> str:
    """Upload `src_path` to `<parent_id>/<slug>/<filename>`, creating
    the slug subfolder on demand. Returns the new file id.

    `parent_id` is always the cleaned-folder root — Requirement 5.7
    forbids ever writing to the raw folder, so the caller MUST pass
    `cleanedDriveFolderId` here and nothing else.
    """
    sub_id = get_or_create_subfolder(drive, parent_id, slug)
    media = MediaFileUpload(src_path, mimetype="audio/mpeg", resumable=True)
    created = drive.files().create(
        body={"name": filename, "parents": [sub_id]},
        media_body=media,
        fields="id",
    ).execute()
    return created["id"]


# ── Entry point ────────────────────────────────────────────────────


def main() -> int:
    cfg = load_audio_config()

    if not cfg.get("enabled"):
        log("bible.audio.enabled is false; exiting 0")
        return 0
    if not cfg.get("cleanedDriveFolderId"):
        log("ERROR: bible.audio.cleanedDriveFolderId is empty")
        return 1  # Requirement 1.9
    if not cfg.get("rawDriveFolderId"):
        log("ERROR: bible.audio.rawDriveFolderId is empty")
        return 1

    dry_run = bool(os.environ.get("DRY_RUN"))

    sa_json = os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        log("ERROR: GDRIVE_SERVICE_ACCOUNT_JSON env var is not set")
        return 1

    drive = build_drive_service(sa_json)

    raw_index = list_two_level(drive, cfg["rawDriveFolderId"])
    cleaned_index = list_two_level(drive, cfg["cleanedDriveFolderId"])

    # Formal P5 statement: writes == raw \ cleaned_before.
    todo = sorted(set(raw_index) - set(cleaned_index))
    log(
        f"raw={len(raw_index)} cleaned={len(cleaned_index)} todo={len(todo)}"
        + (" (dry-run)" if dry_run else "")
    )
    if not todo:
        log("nothing to do")
        return 0

    ffmpeg_filter = cfg["ffmpegFilter"]
    bitrate = cfg["audioBitrate"]
    cleaned_root = cfg["cleanedDriveFolderId"]

    successes = 0
    failures = 0
    for (slug, msg_id) in todo:
        try:
            if dry_run:
                log(f"DRY_RUN: would clean {slug}/{msg_id}")
                successes += 1
                continue

            raw_file_id = raw_index[(slug, msg_id)]
            with tempfile.TemporaryDirectory() as tmp:
                in_path = os.path.join(tmp, f"in_{msg_id}")
                out_path = os.path.join(tmp, f"{msg_id}.mp3")
                download_file(drive, raw_file_id, in_path)
                run_ffmpeg(in_path, out_path, ffmpeg_filter, bitrate)
                upload_to_subfolder(
                    drive,
                    cleaned_root,
                    slug,
                    f"{msg_id}.mp3",
                    out_path,
                )
            log(f"cleaned {slug}/{msg_id}")
            successes += 1
        except Exception as e:  # per-file isolation per Req 5.6
            log(f"ERROR processing {slug}/{msg_id}: {e}")
            failures += 1
            continue

    log(f"done: successes={successes} failures={failures}")
    if successes == 0 and failures > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
