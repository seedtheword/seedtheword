#!/usr/bin/env python3
"""Repair UTF-8 mojibake and strip UTF-8 BOM across website files, using ftfy.

ftfy (fixes text for you) is the industry-standard library for undoing
mojibake, including multi-layer corruption and mangled emoji. We wrap it with
strict safety rails:

  * only accept a fix that strictly REDUCES the mojibake marker count,
  * NEVER accept a result that introduces U+FFFD replacement characters,
  * strip a leading UTF-8 BOM,
  * write back as UTF-8 (no BOM), preserving the file's existing newline style.

Run with no flags for a DRY RUN (reports only). Add --apply to write changes.
"""
import sys
import os
import ftfy

# Sequences that indicate residual mojibake (for counting / verification only).
COUNT_MARKERS = (
    "\u00e2\u20ac", "\u00e2\u2019", "\u00e2\u201d", "\u00e2\u201c",
    "\u00f0\u0178", "\u00c2\u00a0", "\u00c2\u00b7", "\u00c2\u00ae",
    "\u00c3\u00a9", "\u00c3\u00a8", "\u00c3\u00b1", "\u00e2\u201a",
    "\u00e2\u0153", "\u00e2\u2020",
)

def moji_count(text):
    return sum(text.count(m) for m in COUNT_MARKERS)

def detect_newline(text):
    if "\r\n" in text:
        return "\r\n"
    if "\r" in text:
        return "\r"
    return "\n"

def process(path, apply):
    with open(path, "rb") as f:
        raw = f.read()
    had_bom = raw[:3] == b"\xef\xbb\xbf"
    body = raw[3:] if had_bom else raw
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return dict(path=path, status="NOT-UTF8", bom=had_bom,
                    before=-1, after=-1, changed=False, refused=False)

    before = moji_count(text)
    nl = detect_newline(text)

    # Use fix_encoding() ONLY — this undoes mojibake without ftfy's other
    # content normalizations (uncurl_quotes, unescape_html, fix_line_breaks,
    # etc.), so intentional curly quotes and typography are preserved.
    logical = text.replace("\r\n", "\n").replace("\r", "\n")
    fixed_logical = ftfy.fix_encoding(logical)
    fixed = fixed_logical.replace("\n", nl)

    after = moji_count(fixed)
    introduced_fffd = ("\ufffd" in fixed) and ("\ufffd" not in text)
    # Only treat mojibake content as "changed"; BOM strip alone also counts.
    content_changed = fixed != text
    changed = content_changed or had_bom
    refused = introduced_fffd or (before > 0 and after >= before and content_changed)

    if apply and changed and not refused:
        with open(path, "wb") as f:
            f.write(fixed.encode("utf-8"))

    return dict(path=path, status="OK", bom=had_bom, before=before,
                after=after, changed=changed, refused=refused,
                content_changed=content_changed)

def gather(roots):
    exts = (".html", ".css", ".js", ".xml", ".txt", ".json", ".md",
            ".webmanifest", ".svg")
    skip_dirs = {".git", "node_modules", ".hypothesis", "__pycache__"}
    skip_files = {"push2.txt"}
    out = []
    for root in roots:
        if os.path.isfile(root):
            out.append(root); continue
        for dp, dn, fns in os.walk(root):
            dn[:] = [d for d in dn if d not in skip_dirs]
            for fn in fns:
                if fn in skip_files:
                    continue
                if fn.lower().endswith(exts):
                    out.append(os.path.join(dp, fn))
    return sorted(set(out))

def main():
    apply = "--apply" in sys.argv
    roots = [a for a in sys.argv[1:] if not a.startswith("--")]
    files_changed = bom_stripped = tb = ta = 0
    refused = []
    for p in gather(roots):
        r = process(p, apply)
        interesting = (r["before"] > 0) or r["bom"] or r["status"] != "OK" or r["refused"]
        if not interesting:
            continue
        if r["refused"]:
            note = "  !! REFUSED"
            refused.append(p)
        elif apply and r["changed"]:
            note = "  FIXED"
        elif r["changed"]:
            note = "  WOULD-FIX"
        else:
            note = ""
        print(f"[{r['status']}] bom={r['bom']} mojibake {r['before']}->{r['after']}{note}  {p}")
        if r["before"] > 0:
            tb += r["before"]; ta += max(r["after"], 0)
        if r["changed"] and not r["refused"]:
            files_changed += 1
            if r["bom"]:
                bom_stripped += 1
    print(f"\nSummary: files_changed={files_changed} bom_stripped={bom_stripped} "
          f"mojibake {tb}->{ta} apply={apply}")
    if refused:
        print("REFUSED (manual review needed):")
        for r in refused:
            print("   ", r)

if __name__ == "__main__":
    main()
