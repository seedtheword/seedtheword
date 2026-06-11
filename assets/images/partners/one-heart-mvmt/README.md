# One Heart MVMT — Partner Photos

Drop photos from One Heart MVMT events and Community Cookouts here.

## File naming
Use simple names: `01.jpg`, `02.jpg`, `cookout-1.jpg`, etc.

## Linking photos to the partner card
Once you have photos, add their paths to `recommendations.json` under
the `one-heart-mvmt` partner entry in the `"photos"` array:

```json
"photos": [
  "assets/images/partners/one-heart-mvmt/01.jpg",
  "assets/images/partners/one-heart-mvmt/02.jpg"
]
```

## Adding an outreach preview strip
When Community Cookout outreach events have their own folder under
`assets/images/ministry-outreach/`, add an `outreachEvents` entry to
the partner in `recommendations.json` to show the thumbnail strip on
the community page — the same way For Zion's Lake Stevens outreach works.
