# Verse Studio — soundtrack credits

The optional background music presets in Verse Studio use **CC0 / Public Domain**
tracks from **FreePD.com** (curated by Kevin MacLeod and "Music by Pete").
CC0 means no attribution is legally required and the tracks may be used for any
purpose, including commercial and public social posts. We credit them here as a
courtesy.

Source collection: https://freepd.com  (mirror: https://archive.org/details/freepd)
License: CC0 1.0 Universal (Public Domain Dedication) — https://creativecommons.org/publicdomain/zero/1.0/

Preset tracks:

| File name                | Track (FreePD "Scoring") | Mood        | Status         |
|--------------------------|--------------------------|-------------|----------------|
| after-the-end.mp3        | After the End            | reflective  | live           |
| garden-of-prayer.mp3     | Magic in the Garden *    | gentle      | live           |
| novus-initium.mp3        | Novus Initium            | hopeful     | not added yet  |
| the-lagoon.mp3           | The Lagoon               | calm        | not added yet  |

\* The FreePD track is titled "Magic in the Garden"; we host it as
`garden-of-prayer.mp3` and label it "Garden of Prayer" in the app so the name
suits a Christian ministry. The audio file is unchanged and still CC0.

The first two are included and appear in the Verse Studio soundtrack dropdown.
The other two can be added later (download from FreePD, drop in here, then add
them back to the SOUNDTRACKS list in assets/js/verse-studio.js).

## How to add the files
Automated download from this environment was blocked, so the MP3s need to be
dropped in manually (one time):

1. Go to https://freepd.com and open the **Scoring** category
   (or the mirror: https://archive.org/download/freepd/scoring ).
2. Download the four tracks listed above.
3. Rename each to the file name in the table and place it in this
   `assets/audio/` folder.
4. Commit + push. The presets in Verse Studio will then play and record.

Until the files are present, the presets appear in the dropdown but selecting
one has no audio; the "upload your own audio" option works regardless.

Note for public Reels: even with CC0 music, adding music through Instagram's own
licensed library is the safest route for reach/monetization. These presets are
provided for convenience and are safe to bake into downloaded clips.
