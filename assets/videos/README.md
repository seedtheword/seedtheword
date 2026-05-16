# `assets/videos/` — Hero clip and ReadyClip swap notes

This folder holds the short, muted, looping decorative video that plays behind the welcome text on the homepage hero (`index.html` → `<section class="hero hero--jesus">`). The active file is `hero-jesus.mp4`. Other clips in this folder (`bible-flip.mp4`, `ministry-clip.mp4`, etc.) belong to other sections of the site and are not used by the hero.

The page is designed to look correct even when `hero-jesus.mp4` is missing, so it is safe to ship the site before the file lands. See "What happens if `hero-jesus.mp4` is missing" below.

## 1. First-time placeholder setup

Until the ministry has its own intro clip ready, we use a calm, royalty-free Pexels stock clip (sunlight through trees on a foggy forest path). Anyone with a browser can put the placeholder in place — no developer tooling required.

1. Open the source page in any browser:
   `https://www.pexels.com/video/sunlight-through-trees-14057075/`
2. Click the green **Free Download** button. In the dropdown, choose the **HD 1920×1080** variant. The SD version is too small; the 4K version is far too large for our 8 MB budget.
3. Save the file straight into this folder (`assets/videos/`) and rename it to exactly:
   `hero-jesus.mp4`
4. Right-click the file and check the on-disk size. It must be **8 MB or smaller**. The HD download from Pexels usually lands between 5 and 7 MB, so you are normally fine. If it is larger, see section 3 below to trim it.
5. Commit the file. The commit message body should record:
   - Source URL: `https://www.pexels.com/video/sunlight-through-trees-14057075/`
   - License: Pexels License (free for commercial and non-commercial use, no attribution required)
   - On-disk size in MB

That is the whole placeholder workflow. The homepage will pick the new clip up on the next deploy.

## 2. Optional — re-encode for the size budget

Only needed if the downloaded file is larger than 8 MB, or if you want to trim a longer clip down to a 14-second loop. Requires [ffmpeg](https://ffmpeg.org/download.html) to be installed locally.

```
ffmpeg -ss 00:00:04 -t 14 -i pexels-14057075.mp4 \
  -an \
  -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p \
  -movflags +faststart \
  -vf "scale=1920:1080:flags=lanczos,fps=24" \
  -crf 26 -preset slow \
  hero-jesus.mp4
```

What each flag does, plain-language:

- `-ss 00:00:04 -t 14` — start 4 seconds in, take 14 seconds. Pulls a stable section out of the middle of the source so the loop seam lands on a calm frame.
- `-an` — drop the audio track entirely. The hero player is muted, so audio would just bloat the file.
- `-c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p` — H.264 video, main profile, the codec/profile combo Safari and every other browser can decode without fuss.
- `-movflags +faststart` — moves the metadata header to the front of the file so playback can begin before the whole file has downloaded.
- `-vf "scale=1920:1080:flags=lanczos,fps=24"` — resize to 1920×1080 with high-quality scaling and lock to 24 fps.
- `-crf 26 -preset slow` — quality-targeted compression. CRF 26 at this resolution and frame rate lands at roughly 6 MB, well under the 8 MB cap.

After encoding, verify the result is ≤ 8 MB and ≤ 30 seconds, then commit as `hero-jesus.mp4`.

## 3. What happens if `hero-jesus.mp4` is missing

The page is built to fail quietly. If the video file is absent, fails to download, or the browser cannot decode it:

- The `<video>` element fires an `error` event.
- `assets/js/main.js` catches that event and hides the broken `<video>` element.
- The `.hero--jesus` CSS rule in `assets/css/main.css` already declares `background-image: url('../images/backgrounds/stw-background-1920x1080.jpg')`, so the same image used as the video poster shows in its place.
- The welcome text, ministry name, "Who is Jesus?" CTA, and scroll indicator render unchanged on top of that poster.

Net effect: a visitor never sees a broken page, just the still poster instead of the moving clip. This means it is safe to push code changes before the placeholder file is in place.

## 4. ReadyClip swap — when the ministry uploads its own intro

When the ministry has its own intro clip ready, drop it into this folder as `hero-jesus.mp4` (replacing whatever is there). No HTML, CSS, or JavaScript change is needed as long as the new file meets every constraint below.

| Constraint | Value |
|---|---|
| Container | MP4 |
| Video codec | H.264, baseline or main profile |
| Audio | none recommended (player is muted); AAC silently ignored |
| Pixel aspect | square pixels |
| Resolution | 1920×1080 recommended; 1280×720 minimum |
| Frame rate | 24 fps recommended; 30 fps acceptable |
| Duration | ≤ 30 seconds |
| File size | ≤ 8 MB |
| Loop seam | first and last frames visually similar to avoid a hard cut on loop |
| Content | no recognizable faces of non-ministry individuals; no embedded logos of other organizations; no audio track conveying information |

If a constraint is unclear, the encoding command in section 2 is a safe baseline — pointing it at any source file produces output that satisfies every row in the table except duration (use `-t` to control that) and content (only the source clip itself can satisfy that).

## 5. Spec reference

The full requirements, design rationale, and property tests for this hero video live in:

`.kiro/specs/jesus-storytelling-homepage-and-about/`

See `design.md` → "Placeholder clip selection" and "Constraints any future ReadyClip must satisfy" for the underlying decisions captured above.
