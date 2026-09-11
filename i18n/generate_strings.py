#!/usr/bin/env python3
"""Generates the Bishnupriya Manipuri string table from the inventory CSV.

Reads `i18n/strings_inventory.csv` (fill the `bishnupriya` column) and writes
`app/src/main/java/com/ningshingche/app/ui/i18n/BishnupriyaStrings.kt`. Rows with
an empty `bishnupriya` cell are simply absent from the table, so the app falls
back to the Bengali source text for them — a partly filled CSV is a valid state.

Usage (from the repository root):
    python3 i18n/generate_strings.py
    python3 i18n/generate_strings.py --check    # fail if the Kotlin file is stale
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "i18n/strings_inventory.csv"
OUT = ROOT / "app/src/main/java/com/ningshingche/app/ui/i18n/BishnupriyaStrings.kt"

HEADER = """package com.ningshingche.app.ui.i18n

/**
 * GENERATED FILE - do not edit by hand.
 *
 * Written by `i18n/generate_strings.py` from `i18n/strings_inventory.csv`.
 * Keys are the Bengali source strings written in the Kotlin call sites;
 * values are the reviewed Bishnupriya Manipuri translations. A string that is
 * missing here is shown in Bengali, so translations can land a screen at a time.
 *
 * `{1}`, `{2}`, ... are the values passed to `t(...)`; they may be reordered.
 */
internal val BISHNUPRIYA: Map<String, String> = mapOf(
"""

FOOTER = """)


/** Distinct interface strings in the inventory this table was built from. */
internal const val BISHNUPRIYA_SOURCE_COUNT = {count}
"""


def kotlin_string(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("$", "\\$")
    )
    return f'"{escaped}"'


def build() -> str:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    translated = [
        (r["bengali"], r["bishnupriya"].strip())
        for r in rows
        if r.get("bishnupriya", "").strip()
    ]
    ui_total = sum(1 for r in rows if r.get("kind") == "ui")
    body = "".join(
        f"    {kotlin_string(bn)} to {kotlin_string(bp)},\n" for bn, bp in translated
    )
    return HEADER + body + FOOTER.format(count=ui_total)


def main(argv) -> int:
    generated = build()
    if "--check" in argv:
        if not OUT.exists():
            print("missing generated table")
            return 1
        current = OUT.read_text(encoding="utf-8")
        return 0 if current == generated else 1
    OUT.write_text(generated, encoding="utf-8")
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    done = sum(1 for r in rows if r.get("bishnupriya", "").strip())
    total = sum(1 for r in rows if r.get("kind") == "ui")
    print(f"wrote {OUT.relative_to(ROOT)}: {done}/{total} interface strings translated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
