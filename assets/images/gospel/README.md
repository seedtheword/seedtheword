# `assets/images/gospel/` — Seven gospel-stage images

This folder holds the seven photographs displayed in the about-page Gospel section (`about.html` → `<section class="section section--jesus-background">`). Each image sits next to one stage of the Gospel narrative on a desktop viewport, and stacks above the prose on mobile.

The about-page markup references these files by exact name. If a file is missing, the browser shows the descriptive `alt` text in its place — the page still renders, it just looks bare. So it is safe to push the about-page changes before the images land.

## What goes where

Each filename matches a `gospel-stage--{slug}` wrapper in `about.html`. Drop the chosen JPEG in at the path on the left.

| File path | Alt text used in markup | Subject to look for |
|---|---|---|
| `who-he-is.jpg`           | An open Bible with golden light falling across the pages                                     | Open Bible. Light. The "Word made flesh" image. |
| `his-birth.jpg`           | A single bright star above a calm dark night sky                                             | A single bright star. Night sky. Star of Bethlehem framing. |
| `his-life.jpg`            | Open hands held palms up in a gesture of compassion and giving                                | Open hands, palms up. Compassion / serving / blessing. |
| `his-death.jpg`           | A simple wooden cross silhouetted against a sunset sky                                        | A simple wooden cross at sunset. No people in frame. |
| `his-resurrection.jpg`    | A stone tomb entrance with morning light streaming through the opening                        | Stone tomb entrance with morning light, OR sunrise over still water. |
| `his-promised-return.jpg` | Mountain peaks at first dawn light, the new day breaking across the horizon                  | Mountain dawn. First light. The day yet to break. |

(There is intentionally no `respond.jpg` — the Respond stage is the InvitationCTA card, not an image stage.)

## Sourcing — first-time setup

Use [Unsplash](https://unsplash.com) (Unsplash License: free for commercial and non-commercial use, attribution appreciated but not required). The license is permissive enough that you can drop these images straight into the repo without a license header.

1. Open Unsplash in your browser.
2. For each row in the table above, search the suggested terms (e.g. `open bible light`, `star bethlehem`, `helping hands`, `cross silhouette sunset`, `empty tomb sunrise`, `mountain dawn`).
3. Pick the image whose subject matches the alt text **as closely as possible** so the alt-text description is accurate for assistive technology users.
4. Click **Download** → choose the **Medium** size (Unsplash typically offers Small / Medium / Large; Medium is usually 1920×1280 or so).
5. Resize/crop to **1200×800** (3:2 aspect ratio) using whatever tool you prefer:
   - macOS: Preview → Tools → Adjust Size
   - Windows: built-in Photos app → Edit → Resize
   - Online: [squoosh.app](https://squoosh.app) (also handles compression)
6. Export as JPEG, quality 80, target **≤ 250 KB** on disk per image. Squoosh shows the file size live as you adjust.
7. Save the file directly into `assets/images/gospel/` with the exact filename from the table above.
8. Commit. The commit message body should record, for each image:
   - The Unsplash photo URL (e.g. `https://unsplash.com/photos/xxxxx`)
   - The photographer's name (Unsplash credits them on every page)
   - The descriptive alt text (so reviewers can verify it matches what the markup expects)

## What happens if an image is missing

Each `<img>` carries a descriptive `alt` attribute, so a missing image renders as a captioned blank box — assistive tech users still hear the description. The `<figure class="gospel-stage__media">` wrapper retains the layout, so the prose column stays aligned. The page never looks broken.

## Optimization tips

The `<img>` markup uses `loading="lazy"`, so only the first image (Stage 1: Who He Is) downloads on initial paint. The rest stream in as the visitor scrolls.

If file sizes feel large after export:
- Squoosh's MozJPEG plugin at quality 75–80 typically shaves 30% off without visible quality loss
- Strip EXIF metadata (most exporters do this by default)
- Avoid PNG for photographs — JPEG is dramatically smaller for natural images

## Spec reference

The full requirements, image-plan rationale, and property tests for this folder live in:

`.kiro/specs/jesus-storytelling-homepage-and-about/`

See `design.md` → "Image plan per stage" and "AboutGospelSection — Detailed Design" for the underlying decisions captured above.
