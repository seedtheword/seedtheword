"""
One-time helper — generates a long-lived OAuth refresh token for the
Bible Audio cleanup workflow.

Service-account auth doesn't work for the cleanup workflow because
service accounts have no Drive storage quota on personal Gmail
accounts (they need either a Workspace shared drive or OAuth user
delegation). This script runs the OAuth installed-app flow once,
captures the refresh token, and prints the three values to paste
into GitHub Secrets.

Usage (run locally, on Windows or any machine with a browser):

    pip install google-auth google-auth-oauthlib
    python .github/scripts/gdrive_get_refresh_token.py \\
        --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>

It opens a browser to https://accounts.google.com asking you (the
admin) to grant Drive access. After you click Allow, the script
prints:

    GDRIVE_OAUTH_CLIENT_ID=...
    GDRIVE_OAUTH_CLIENT_SECRET=...
    GDRIVE_OAUTH_REFRESH_TOKEN=...

Paste each value into a separate GitHub repo secret with the
matching name (Settings -> Secrets and variables -> Actions ->
New repository secret).

The OAuth client must be a "Desktop application" type (not Web
application) created at https://console.cloud.google.com/apis/credentials
in the same GCP project where the Drive API is enabled.

Token lifetime: refresh tokens issued in this flow do not expire
unless you revoke them, change your Google password, or the OAuth
app is in "Testing" status (in which case they expire after 7 days).
Move the OAuth consent screen to "In production" to get permanent
refresh tokens.
"""
from __future__ import annotations

import argparse
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive"]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--client-id", required=True, help="OAuth client ID (ends in .apps.googleusercontent.com)")
    p.add_argument("--client-secret", required=True, help="OAuth client secret")
    p.add_argument("--port", type=int, default=8765, help="local redirect port (default 8765)")
    args = p.parse_args()

    client_config = {
        "installed": {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [f"http://localhost:{args.port}"],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=args.port, prompt="consent", access_type="offline")

    if not creds.refresh_token:
        print(
            "ERROR: no refresh token returned. Revoke the OAuth grant at "
            "https://myaccount.google.com/permissions and try again — Google only "
            "issues a refresh token on the first consent.",
            file=sys.stderr,
        )
        return 1

    print()
    print("==== Paste these three values into GitHub repo secrets ====")
    print()
    print(f"GDRIVE_OAUTH_CLIENT_ID={args.client_id}")
    print(f"GDRIVE_OAUTH_CLIENT_SECRET={args.client_secret}")
    print(f"GDRIVE_OAUTH_REFRESH_TOKEN={creds.refresh_token}")
    print()
    print("After pasting, delete this terminal output and close the tab.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
