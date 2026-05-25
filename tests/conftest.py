"""
Pytest configuration for the prayer-digest property tests.

Adds the repository root and its `.github/scripts` directory to
sys.path so test files can import both the production scripts
(poll_prayer_topic, post_prayer_digest_to_telegram, telegram_common)
and the shared generators module (prayer_digest_generators) without
relying on a packaging step.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / ".github/scripts"
TESTS = Path(__file__).resolve().parent

for p in (SCRIPTS, TESTS):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
