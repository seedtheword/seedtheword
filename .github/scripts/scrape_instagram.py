"""
Fetch recent Instagram posts via an rss.app JSON feed and write
assets/data/instagram.json in the shape our front-end expects.

The rss.app feed URL is supplied via the FEED_URL env var (set in the
GitHub Action workflow). The script is intentionally defensive: any
failure leaves the existing JSON in place so the live site keeps
rendering whatever it already had.
"""
import json
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


FEED_URL = os.environ.get("FEED_URL", "").strip()
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
    OUT_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def fetch_feed(url):
    if not url:
        print("::error::FEED_URL is empty; set it in the workflow env.", file=sys.stderr)
        return None
    req = Request(
        url,
        headers={
            "User-Agent": "seedtheword-site-scraper/1.0 (+github actions)",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
        return json.loads(body)
    except (URLError, HTTPError) as e:
        print(f"::warning::Could not fetch feed: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"::warning::Feed returned invalid JSON: {e}", file=sys.stderr)
        return None


def normalize(feed):
    """Map rss.app JSON-Feed items to our internal post shape."""
    items = feed.get("items") or []
    posts = []
    for it in items[:MAX_POSTS]:
        url = it.get("url") or ""
        if not url:
            continue

        # Shortcode is the last path segment of the Instagram URL
        shortcode = url.rstrip("/").rsplit("/", 1)[-1]

        caption = (it.get("content_text") or it.get("title") or "").strip()
        image = it.get("image") or ""
        if not image:
            atts = it.get("attachments") or []
            if atts and isinstance(atts, list):
                image = atts[0].get("url", "")

        posts.append({
            "id": it.get("id") or shortcode,
            "url": url,
            "thumbnail": image,
            "caption": caption,
            # rss.app doesn't expose engagement counts; leave them null so
            # the front-end falls back to date-based ordering.
            "likes": None,
            "comments": None,
            "date": it.get("date_published") or "",
            "is_video": False,
        })
    return posts


def main():
    existing = load_existing()

    feed = fetch_feed(FEED_URL)
    if feed is None:
        print("Feed fetch failed; keeping existing data.")
        return 0

    posts = normalize(feed)
    if not posts:
        print("Feed had no usable items; keeping existing data.")
        return 0

    data = {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "rss.app",
        "posts": posts,
    }
    write_output(data)
    print(f"Wrote {len(posts)} posts to {OUT_PATH}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
