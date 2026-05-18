"""
One-time helper to mint a long-lived Spotify refresh token.

Run this ONCE on your machine, sign in with the Spotify account that
owns (or follows + can read) the community playlist, and copy the
refresh token it prints into a new GitHub Secret named
SPOTIFY_REFRESH_TOKEN.

Why this exists
---------------
The weekly playlist digest workflow uses the Client Credentials grant
by default, which can only read fully public playlists. Collaborative
or private playlists require a user-authenticated token.

This script does the Authorization Code dance just enough to obtain a
refresh token, then exits. The actual workflow (post_playlist_digest_
to_telegram.py) trades that refresh token for a short-lived access
token on every run — no further human interaction needed.

How to run
----------
  1. Make sure your Spotify dev app's Redirect URIs include
     `http://127.0.0.1:8765/callback` (Dashboard → app → Edit Settings
     → Redirect URIs → Add → Save).
  2. Set the two env vars and run this script:

       set SPOTIFY_CLIENT_ID=...your client id...
       set SPOTIFY_CLIENT_SECRET=...your client secret...
       python .github/scripts/spotify_get_refresh_token.py

  3. Your browser will open. Log in with the Spotify account that
     owns the community playlist and approve the requested scopes.
  4. The script prints the refresh token. Copy it into a new GitHub
     repository secret named SPOTIFY_REFRESH_TOKEN.

Scopes
------
We request `playlist-read-private playlist-read-collaborative` so the
weekly digest can read collaborative playlists too. No write scopes
are requested — this token cannot modify any of your playlists.

Security notes
--------------
A refresh token is long-lived (Spotify does not auto-expire them). If
you ever leak it, rotate it by clicking "Reset" on the Spotify dev app
page (this invalidates ALL refresh tokens issued under that app), then
re-run this helper.
"""
from __future__ import annotations

import base64
import http.server
import json
import os
import secrets
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from typing import Optional

CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
REDIRECT_URI = "http://127.0.0.1:8765/callback"
SCOPES = "playlist-read-private playlist-read-collaborative"


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    """Captures the `?code=...&state=...` redirect from Spotify."""

    received_code: Optional[str] = None
    received_state: Optional[str] = None
    received_error: Optional[str] = None

    def do_GET(self):  # noqa: N802 — http.server naming convention
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return
        params = urllib.parse.parse_qs(parsed.query)
        _CallbackHandler.received_code = (params.get("code") or [None])[0]
        _CallbackHandler.received_state = (params.get("state") or [None])[0]
        _CallbackHandler.received_error = (params.get("error") or [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        if _CallbackHandler.received_error:
            self.wfile.write(
                f"<h2>Spotify auth failed</h2><p>{_CallbackHandler.received_error}</p>".encode("utf-8")
            )
        else:
            self.wfile.write(
                b"<h2>Auth complete</h2>"
                b"<p>You can close this tab and return to your terminal.</p>"
            )

    def log_message(self, format, *args):  # noqa: A002 — silencing default access log
        pass


def main() -> int:
    if not CLIENT_ID or not CLIENT_SECRET:
        print("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars first.")
        return 1

    state = secrets.token_urlsafe(24)
    auth_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
        "show_dialog": "true",
    })

    server = http.server.HTTPServer(("127.0.0.1", 8765), _CallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    print("Opening Spotify login in your browser...")
    print(f"If it does not open, paste this URL manually:\n  {auth_url}")
    webbrowser.open(auth_url)

    # Wait until the callback has been received (or interrupted).
    print("Waiting for Spotify redirect on http://127.0.0.1:8765/callback ...")
    try:
        while _CallbackHandler.received_code is None and _CallbackHandler.received_error is None:
            pass
    except KeyboardInterrupt:
        server.shutdown()
        print("\nAborted.")
        return 130

    server.shutdown()

    if _CallbackHandler.received_error:
        print(f"Spotify returned an error: {_CallbackHandler.received_error}")
        return 1
    if _CallbackHandler.received_state != state:
        print("State mismatch — possible CSRF or stale callback. Aborting.")
        return 1

    code = _CallbackHandler.received_code
    print("Got authorization code, exchanging for refresh token...")

    basic = base64.b64encode(
        (CLIENT_ID + ":" + CLIENT_SECRET).encode("utf-8")
    ).decode("ascii")
    body = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=body,
        headers={
            "Authorization": "Basic " + basic,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        token_resp = json.loads(resp.read().decode("utf-8"))

    refresh_token = token_resp.get("refresh_token")
    if not refresh_token:
        print("No refresh_token in response:", json.dumps(token_resp, indent=2))
        return 1

    print()
    print("=" * 70)
    print("SUCCESS — copy the value below into a new GitHub repository secret")
    print("named SPOTIFY_REFRESH_TOKEN:")
    print("=" * 70)
    print()
    print(refresh_token)
    print()
    print("=" * 70)
    print("Next steps:")
    print("  1. Open the repo on GitHub → Settings → Secrets and variables")
    print("     → Actions → New repository secret")
    print("  2. Name: SPOTIFY_REFRESH_TOKEN")
    print("  3. Value: (paste the line above, no quotes, no trailing newline)")
    print("  4. Save, then re-run the Weekly Playlist Digest workflow.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
