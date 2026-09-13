#!/usr/bin/env python3
"""Builds the per-language CSV templates the dashboard edits.

Source of truth for the key list is `i18n/refresh_inventory.py` (the Bengali
strings actually written in the app). This script writes one `key,value` CSV per
language into `backend/assets/lang/`, with the value column left empty:

    bn.csv    Bengali -> Bengali identity, so a key list is always available
    en.csv    Bengali key -> English (empty, to be filled)
    bpy.csv   Bengali key -> Bishnupriya Manipuri (empty, to be filled)

The dashboard's Languages page reads these files: it fills every empty cell from
the template when the page opens, and the "Load templates" button reads them
again on demand. Nothing is published until an editor presses Save there, which
writes the CSV into the `app_language_files` row the app reads.

Wording already in a template is carried over when this script runs, so a
translator who fills `backend/assets/lang/en.csv` by hand — or a pass committed
from the dashboard and pasted back — keeps it through the next regeneration. A
key that is new gets a blank value to fill.

Usage (from the repository root):
    python3 i18n/build_language_templates.py
    python3 i18n/build_language_templates.py --check   # fail if templates are stale
"""
from __future__ import annotations

import csv
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "i18n"))

import refresh_inventory  # noqa: E402  (same folder, no package)

LANG_DIR = ROOT / "backend/assets/lang"
LANGUAGES = {
    "bn": "বাংলা",
    "en": "English",
    "bpy": "বিষ্ণুপ্রিয়া মণিপুরী",
}


def csv_for(key: str, identity: bool) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["key", "value"])
    writer.writerow([key, key if identity else ""])
    return buffer.getvalue()


def build() -> dict[Path, str]:
    entries = refresh_inventory.collect()
    # UI copy only: content rows are publication text, not interface chrome.
    keys = sorted(
        (key for key, meta in entries.items() if meta["kind"] == "ui"),
        key=lambda value: value,
    )
    return {
        LANG_DIR / f"{lang}.csv": csv_for_all(
            keys,
            identity=(lang == "bn"),
            previous=read_pairs(LANG_DIR / f"{lang}.csv"),
        )
        for lang in LANGUAGES
    }


def read_pairs(path: Path) -> dict[str, str]:
    """The wording a template already carries, key -> value (blank dropped)."""
    if not path.exists():
        return {}
    rows = csv.reader(io.StringIO(path.read_text(encoding="utf-8")))
    pairs: dict[str, str] = {}
    for index, row in enumerate(rows):
        if index == 0 and row and row[0].strip().lower() == "key":
            continue
        if len(row) < 2 or not row[0].strip():
            continue
        value = ",".join(row[1:]).strip()
        if value:
            pairs[row[0]] = value
    return pairs


def csv_for_all(keys: list[str], identity: bool, previous: dict[str, str]) -> str:
    """The template for one language: the current key list, wording carried over.

    Bengali keeps its identity row (`key,key`) so the file is always a usable key
    list; a rewrite of it that somebody committed is kept instead. Every other
    language keeps whatever is already there and gets a blank cell for a new key.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["key", "value"])
    for key in keys:
        writer.writerow([key, previous.get(key) or (key if identity else "")])
    return buffer.getvalue()


def main(argv) -> int:
    templates = build()
    if "--check" in argv:
        stale = [
            path for path, text in templates.items()
            if not path.exists() or path.read_text(encoding="utf-8") != text
        ]
        for path in stale:
            print(f"stale: {path.relative_to(ROOT)}")
        return 1 if stale else 0

    LANG_DIR.mkdir(parents=True, exist_ok=True)
    kept = 0
    for path, text in templates.items():
        kept += len(read_pairs(path))
        path.write_text(text, encoding="utf-8")
    rows = templates[LANG_DIR / "bn.csv"].count("\n") - 1
    print(f"wrote {len(templates)} template(s) with {rows} keys into {LANG_DIR.relative_to(ROOT)}")
    print(f"kept {kept} value(s) already in the templates")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
