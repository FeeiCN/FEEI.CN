#!/usr/bin/env python3
"""Refresh only progress.json for the 169 injected shelf-only books.

Faster than full --full re-export: ~50s vs ~50min.
After: run `python3 scripts/export_weread_data.py --aggregate-only`.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from import_weread_latest_highlight import api_call, format_timestamp  # noqa: E402

OUT = ROOT / "static" / "reading"
NOTEBOOKS = OUT / "notebooks.json"
SHELF = OUT / "shelf.json"
BOOKS_DIR = OUT / "books"

nb = json.loads(NOTEBOOKS.read_text(encoding="utf-8"))
shelf = json.loads(SHELF.read_text(encoding="utf-8"))

shelf_ids = {str(b["bookId"]) for b in shelf.get("books", [])}
injected_ids = [
    str(b["bookId"])
    for b in nb.get("books", [])
    if str(b["bookId"]) in shelf_ids
]
print(f"[info] {len(injected_ids)} injected books to refresh", file=sys.stderr)

ok = 0
for idx, bid in enumerate(injected_ids, start=1):
    p = BOOKS_DIR / bid / "progress.json"
    try:
        data = {"fetchedAt": format_timestamp(int(time.time())), **api_call("/book/getprogress", bookId=bid)}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        ok += 1
    except Exception as exc:
        print(f"[warn] {bid}: {exc}", file=sys.stderr)
    if idx % 20 == 0 or idx == len(injected_ids):
        print(f"[info] {idx}/{len(injected_ids)} ok={ok}", file=sys.stderr)
    time.sleep(0.3)
print(f"[done] {ok}/{len(injected_ids)}")
