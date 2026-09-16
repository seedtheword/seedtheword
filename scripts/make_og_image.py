"""Build a 1200x630 Open Graph share card from the tall STW logo.
Centers the full logo on a cream canvas that matches the logo background,
so link previews show the whole logo (no crop, no letterbox bars).
Run: python scripts/make_og_image.py
"""
from PIL import Image

SRC = "assets/images/stw-logo.jpg"
OUT = "assets/images/og-image.jpg"
W, H = 1200, 630
BG = (255, 246, 224)   # cream, sampled from the logo's own background
PAD = 40               # top/bottom breathing room

logo = Image.open(SRC).convert("RGB")
canvas = Image.new("RGB", (W, H), BG)

# Scale the logo to fit within the canvas height (with padding), keep aspect.
max_h = H - PAD * 2
scale = max_h / logo.height
new_w = int(logo.width * scale)
new_h = int(logo.height * scale)
logo_resized = logo.resize((new_w, new_h), Image.LANCZOS)

# Center it.
x = (W - new_w) // 2
y = (H - new_h) // 2
canvas.paste(logo_resized, (x, y))

canvas.save(OUT, "JPEG", quality=85, optimize=True)
print(f"wrote {OUT} at {W}x{H}, logo scaled to {new_w}x{new_h}")
