"""
Fetch recent Instagram posts via an rss.app JSON feed, download each
post's image into the repo, and write assets/data/instagram.json with
stable local URLs.

Downloading images side-steps Instagram's short-lived signed CDN URLs,
which otherwise expire within hours and leave the live site showing
broken pictures.

Designed to run inside the `instagram-scrape.yml` GitHub Action. On any
failure the script leaves existing data/images in place so the live
site keeps working.
"""
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


FEED_URL = os.environ.get("FEED_URL", "").strip()
OUT_PATH = Path(os.environ.get("OUT_PATH", "assets/data/instagram.json"))
IMG_DIR = Path(os.environ.get("IMG_DIR", "assets/images/instagram"))
MAX_POSTS = 12

# How we expose local images to the frontend (relative to site root)
IMG_URL_PREFIX = "assets/images/instagram/"


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


def http_get(url, *, json_expected=False, timeout=30):
    req = Request(
        url,
        headers={
            "User-Agent": "seedtheword-site-scraper/1.0 (+github actions)",
            "Accept": "application/json" if json_expected else "image/*,*/*",
            "Referer": "https://www.instagram.com/",
        },
    )
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_feed(url):
    if not url:
        print("::error::FEED_URL is empty; set it in the workflow env.", file=sys.stderr)
        return None
    try:
        body = http_get(url, json_expected=True).decode("utf-8")
        return json.loads(body)
    except (URLError, HTTPError) as e:
        print(f"::warning::Could not fetch feed: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"::warning::Feed returned invalid JSON: {e}", file=sys.stderr)
        return None


def ext_for(content_type):
    if not content_type:
        return ".jpg"
    ct = content_type.split(";", 1)[0].strip().lower()
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(ct, ".jpg")


def download_image(post_id, remote_url):
    """Download a post image into IMG_DIR. Returns local web path or None."""
    if not remote_url:
        return None

    # Stable filename based on post id (plus a short hash of the URL to bust
    # caches if the underlying media actually changed).
    url_hash = hashlib.md5(remote_url.encode("utf-8")).hexdigest()[:6]
    base = f"{post_id}_{url_hash}"

    # If any file with this base already exists, reuse it.
    for existing in IMG_DIR.glob(f"{base}.*"):
        return IMG_URL_PREFIX + existing.name

    try:
        req = Request(
            remote_url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; seedtheword-bot/1.0)",
                "Referer": "https://www.instagram.com/",
            },
        )
        with urlopen(req, timeout=30) as resp:
            data = resp.read()
            ct = resp.headers.get("Content-Type", "")
    except (URLError, HTTPError) as e:
        print(f"::warning::Image download failed for {post_id}: {e}", file=sys.stderr)
        return None

    ext = ext_for(ct)
    filename = f"{base}{ext}"
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    (IMG_DIR / filename).write_bytes(data)
    return IMG_URL_PREFIX + filename


def prune_stale_images(active_filenames):
    """Delete image files that aren't referenced by any current post."""
    if not IMG_DIR.exists():
        return
    removed = 0
    for f in IMG_DIR.iterdir():
        if f.is_file() and f.name not in active_filenames:
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    if removed:
        print(f"Pruned {removed} stale image(s).")


def normalize(feed, existing_posts):
    """Map rss.app items into our shape; download images; return post list."""
    items = feed.get("items") or []
    posts = []
    active_filenames = set()

    # Build a lookup of existing posts by id so we can reuse already-
    # downloaded images if the rss.app URL hasn't changed.
    existing_by_id = {p.get("id"): p for p in existing_posts if p.get("id")}

    for it in items[:MAX_POSTS]:
        url = it.get("url") or ""
        if not url:
            continue

        post_id = it.get("id") or url.rstrip("/").rsplit("/", 1)[-1]
        caption = (it.get("content_text") or it.get("title") or "").strip()
        remote_image = it.get("image") or ""
        if not remote_image:
            atts = it.get("attachments") or []
            if atts and isinstance(atts, list):
                remote_image = atts[0].get("url", "")

        local_thumbnail = download_image(post_id, remote_image)

        # If download failed but we have a cached local image from a prior
        # run, reuse it. Otherwise fall back to the remote URL (may expire).
        if not local_thumbnail:
            prior = existing_by_id.get(post_id)
            if prior:
                prior_thumb = prior.get("thumbnail") or ""
                if prior_thumb.startswith(IMG_URL_PREFIX):
                    local_thumbnail = prior_thumb
            if not local_thumbnail:
                local_thumbnail = remote_image  # last resort

        if local_thumbnail and local_thumbnail.startswith(IMG_URL_PREFIX):
            active_filenames.add(local_thumbnail[len(IMG_URL_PREFIX):])

        posts.append({
            "id": post_id,
            "url": url,
            "thumbnail": local_thumbnail,
            "caption": caption,
            "likes": None,         # rss.app doesn't expose engagement counts
            "comments": None,
            "date": it.get("date_published") or "",
            "is_video": False,
        })

    # Clean up any old downloaded images that aren't referenced anymore.
    prune_stale_images(active_filenames)
    return posts


def main():
    existing = load_existing()

    feed = fetch_feed(FEED_URL)
    if feed is None:
        print("Feed fetch failed; keeping existing data.")
        return 0

    posts = normalize(feed, existing.get("posts") or [])
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
