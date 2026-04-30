"""
Scrape a public Instagram profile and write a JSON file with recent posts.

Designed to run inside the `instagram-scrape.yml` GitHub Action. On failure
it writes whatever data it had (or leaves the file unchanged) so the site
keeps working.
"""
import json
import os
import sys
import time
from pathlib import Path

import instaloader

HANDLE = os.environ.get("IG_HANDLE", "seedtheword")
OUT_PATH = Path(os.environ.get("OUT_PATH", "assets/data/instagram.json"))
MAX_POSTS = 12


def load_existing():
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"updated": None, "posts": []}


def write_output(data):
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def scrape():
    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        post_metadata_txt_pattern="",
    )

    try:
        profile = instaloader.Profile.from_username(L.context, HANDLE)
    except Exception as e:
        print(f"::warning::Could not load profile @{HANDLE}: {e}", file=sys.stderr)
        return None

    posts = []
    try:
        for i, post in enumerate(profile.get_posts()):
            if i >= MAX_POSTS:
                break
            posts.append({
                "id": post.shortcode,
                "url": f"https://www.instagram.com/p/{post.shortcode}/",
                "thumbnail": post.url,
                "caption": (post.caption or "").strip(),
                "likes": post.likes,
                "comments": post.comments,
                "date": post.date_utc.isoformat() + "Z",
                "is_video": post.is_video,
            })
            time.sleep(0.75)
    except Exception as e:
        print(f"::warning::Partial scrape failure after {len(posts)} posts: {e}", file=sys.stderr)
        if not posts:
            return None

    return posts


def main():
    existing = load_existing()

    fresh = scrape()
    if fresh is None:
        print("Scrape failed entirely; keeping existing data.")
        return 0

    data = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "posts": fresh,
    }
    write_output(data)
    print(f"Wrote {len(fresh)} posts to {OUT_PATH}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())