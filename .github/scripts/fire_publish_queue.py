"""Fire due scheduled posts from the Publish tab queue.

Called by the telegram-announcements.yml cron every 15 minutes (alongside
the existing calendar-announcement script).  POSTs to the Apps Script web
app with type:'fire-scheduled-posts', which reads the "Scheduled Posts"
sheet for due waiting rows (status=waiting, send_at<=now), sends each to
Telegram thread 553 + community feed, and marks them sent/failed.

Auth model: NONE beyond the Apps Script URL being a secret.  The web-app
URL is not published; the queue-firing action has no team-token requirement
(matching the existing admin-sms-cc pattern used by the SMS gateway path).

Exit code is always 0 — a failure here must never block the rest of the
workflow (the dedup-log commit, etc.).  The Telegram post itself is the
source of truth; this step is the delivery layer.

Env vars:
  APPS_SCRIPT_URL — the web-app URL (GitHub Secret, already used by the
                    SMS-CC path in post_calendar_to_telegram.py)
  DRY_RUN         — if set, skip the actual POST
"""
from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "").strip()
DRY_RUN = bool(os.environ.get("DRY_RUN", "").strip())


def main() -> int:
    if not APPS_SCRIPT_URL:
        print("APPS_SCRIPT_URL not set — skipping scheduled-post firing.")
        return 0
    if DRY_RUN:
        print("[DRY_RUN] Would POST type:'fire-scheduled-posts' to Apps Script.")
        return 0

    payload = json.dumps({"type": "fire-scheduled-posts"}).encode("utf-8")
    try:
        req = Request(
            APPS_SCRIPT_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            # Surface the fired/failed counts so the Actions log shows
            # something useful without digging into the Apps Script.
            try:
                result = json.loads(body)
                if result.get("ok"):
                    print(
                        "Scheduled posts fired: "
                        f"{result.get('fired', 0)} sent, "
                        f"{result.get('failed', 0)} failed."
                    )
                else:
                    print(f"Apps Script returned error: {result.get('error', body[:200])}")
            except (json.JSONDecodeError, ValueError):
                print(f"Apps Script reply: {body[:300]}")
            return 0
    except (HTTPError, URLError) as e:
        print(f"Failed to fire scheduled posts (non-fatal): {e}")
        return 0
    except Exception as e:  # noqa: BLE001 — best-effort delivery layer
        print(f"Unexpected error (non-fatal): {e}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
