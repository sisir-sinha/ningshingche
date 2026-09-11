#!/usr/bin/env python3
"""Builds the Bishnupriya-translation inventory from the Kotlin sources.

Scans `app/src/main/java` for Bengali string literals, drops anything that is
not user-visible (keys, ids, log lines, SQL, code fragments), de-duplicates and
writes one row per distinct string with its occurrence count and the screens it
appears in. The `bishnupriya` column is what a reviewer fills in; nothing in the
app is translated until that column has a value.

Usage (from the repository root):
    python3 i18n/refresh_inventory.py            # rewrite i18n/strings_inventory.csv
    python3 i18n/refresh_inventory.py --check    # fail if the file is stale
"""
from __future__ import annotations

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app/src/main/java"
OUT = ROOT / "i18n/strings_inventory.csv"

# Files that carry publication content rather than interface chrome. Their text
# is what the magazine publishes (author bios, standing copy), so it is listed
# for completeness but is not part of the UI translation.
CONTENT_FILES = {
    "NinghsingCheContentData.kt",
    "AuthorProfiles.kt",
    "SiteContact.kt",
}

BENGALI = re.compile(r"[\u0980-\u09FF]")
LITERAL = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
INTERPOLATION = re.compile(r"\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*")

# Strings that are technically Bengali but are not UI copy.
NOISE = re.compile(
    r"^(?:[a-z0-9_/.-]+|https?://\S+|\+?\d[\d\s()-]*)$", re.IGNORECASE
)


def is_ui_copy(value: str) -> bool:
    if not BENGALI.search(value):
        return False
    if NOISE.match(value.strip()):
        return False
    # GraphQL/SQL/JSON fragments and path-ish strings are never shown verbatim.
    lowered = value.lower()
    if any(token in lowered for token in ("select ", "insert into", "json", "eq.", "&")):
        return False
    return True


def normalise(value: str) -> str:
    """`গান ${count}টি` and `গান ${total}টি` are one string to a translator."""
    return INTERPOLATION.sub("…", value).strip()


def collect():
    entries: dict[str, dict] = defaultdict(
        lambda: {"count": 0, "files": set(), "kind": "ui"}
    )
    for path in sorted(SRC.rglob("*.kt")):
        text = path.read_text(encoding="utf-8")
        for raw in LITERAL.findall(text):
            value = raw.replace('\\"', '"').replace("\\n", " ").replace('\\$', '$')
            if not is_ui_copy(value):
                continue
            key = normalise(value)
            if not key:
                continue
            bucket = entries[key]
            bucket["count"] += 1
            bucket["files"].add(path.name)
            if path.name in CONTENT_FILES:
                bucket["kind"] = "content"
    return entries


def write(entries) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(entries.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
    with OUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["bengali", "bishnupriya", "kind", "uses", "screens"])
        for key, meta in rows:
            writer.writerow(
                [
                    key,
                    "",
                    meta["kind"],
                    meta["count"],
                    ", ".join(sorted(meta["files"])),
                ]
            )
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} distinct strings")


def main(argv) -> int:
    entries = collect()
    if "--check" in argv:
        if not OUT.exists():
            print("missing inventory")
            return 1
        before = OUT.read_text(encoding="utf-8")
        write(entries)
        after = OUT.read_text(encoding="utf-8")
        return 0 if before == after else 1
    write(entries)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
