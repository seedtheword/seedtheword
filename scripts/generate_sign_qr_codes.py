"""
Generate one SVG QR code per registered sign in
assets/data/sign-locations.json. Output goes to
assets/images/sign-qr/<id>.svg.

Each SVG decodes to:
  https://seedtheword.github.io/seedtheword/donate.html?sign=<id>

Run from the repo root:
  python scripts/generate_sign_qr_codes.py

Requires: qrcode (pip install qrcode). The Apps Script side writes the
sign id into the Bibles row's sign_id column on every submission, so
a printed sign with QR -> donate.html?sign=<id> auto-correlates.

This is a one-time tooling script; it has no schedule. Run it again
when sign-locations.json changes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import qrcode
    from qrcode.image.svg import SvgImage
except ImportError:
    sys.stderr.write(
        "Missing dependency: qrcode\n"
        "Install with:  pip install qrcode\n"
    )
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parents[1]
SIGN_LOCATIONS_PATH = REPO_ROOT / "assets" / "data" / "sign-locations.json"
OUTPUT_DIR = REPO_ROOT / "assets" / "images" / "sign-qr"

# Use level H (highest error correction, ~30%) so a slightly damaged
# printed sign still scans cleanly. Box size 12 produces a sharp ~370px
# SVG that scales well in print.
QR_ERROR_LEVEL = qrcode.constants.ERROR_CORRECT_H
QR_BOX_SIZE = 12
QR_BORDER = 4


def main() -> int:
    if not SIGN_LOCATIONS_PATH.exists():
        sys.stderr.write(f"Sign locations not found: {SIGN_LOCATIONS_PATH}\n")
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with SIGN_LOCATIONS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    signs = data.get("signs") or []
    if not signs:
        print("No signs registered; nothing to generate.")
        return 0

    written = 0
    for sign in signs:
        sign_id = str(sign.get("id") or "").strip()
        if not sign_id:
            sys.stderr.write("Skipping sign with no id.\n")
            continue
        qr_url = (
            sign.get("qr_url")
            or f"https://seedtheword.github.io/seedtheword/donate.html?sign={sign_id}"
        )
        out_path = OUTPUT_DIR / f"{sign_id}.svg"

        qr = qrcode.QRCode(
            error_correction=QR_ERROR_LEVEL,
            box_size=QR_BOX_SIZE,
            border=QR_BORDER,
        )
        qr.add_data(qr_url)
        qr.make(fit=True)

        img = qr.make_image(image_factory=SvgImage)
        img.save(str(out_path))
        print(f"  ✓ {sign_id} → {out_path.relative_to(REPO_ROOT)}  ({qr_url})")
        written += 1

    print(f"\nGenerated {written} QR code(s) into {OUTPUT_DIR.relative_to(REPO_ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
