#!/usr/bin/env python3
"""Download book cover images from CDN to local static/reading/books/<bookId>/.

Reads static/reading/stats.json for cover URLs, downloads each one with a
3-attempt retry, and saves to static/reading/books/<bookId>/cover.<ext>.

Skips books that already have a local cover file. Idempotent.
"""

from __future__ import annotations

import json
import mimetypes
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
STATS = ROOT / "static" / "reading" / "stats.json"
BOOKS_DIR = ROOT / "static" / "reading" / "books"
TIMEOUT = 30
RETRIES = 3
RETRY_BACKOFF = 1.5
USER_AGENT = "Mozilla/5.0 (compatible; weread-cover-fetcher/1.0)"

EXT_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


def guess_ext_from_url(url: str) -> str:
    path = url.split("?", 1)[0]
    if "." in path.rsplit("/", 1)[-1]:
        ext = path.rsplit(".", 1)[-1].lower()
        if ext in {"jpg", "jpeg", "png", "webp", "gif"}:
            return "jpg" if ext == "jpeg" else ext
    return "jpg"


def download(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = resp.read()
                if not data:
                    raise ValueError("empty response")
                ctype = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
                ext = EXT_BY_TYPE.get(ctype) or guess_ext_from_url(url)
                dest.parent.mkdir(parents=True, exist_ok=True)
                final = dest.with_name("cover." + ext) if dest.name == "cover" else dest
                final.write_bytes(data)
                return True
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
            print(f"  [warn] attempt {attempt}/{RETRIES} {url}: {exc}", file=sys.stderr)
            if attempt < RETRIES:
                time.sleep(RETRY_BACKOFF ** attempt)
    return False


def main() -> int:
    if not STATS.exists():
        print(f"[err] {STATS} not found", file=sys.stderr)
        return 1
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    library = stats.get("library") or []

    todo: list[tuple[str, str]] = []
    for book in library:
        bid = book.get("bookId")
        cover = book.get("cover")
        if not bid or not cover:
            continue
        todo.append((bid, cover))

    if not todo:
        print("[info] no covers to download")
        return 0

    print(f"[info] {len(todo)} covers to fetch")
    ok = 0
    skip = 0
    fail = 0
    for idx, (bid, url) in enumerate(todo, start=1):
        book_dir = BOOKS_DIR / bid
        existing = list(book_dir.glob("cover.*")) if book_dir.exists() else []
        if existing and existing[0].stat().st_size > 0:
            skip += 1
            continue
        target = book_dir / "cover"
        if download(url, target):
            ok += 1
        else:
            fail += 1
        if idx % 20 == 0 or idx == len(todo):
            print(f"[info] {idx}/{len(todo)} (ok={ok} skip={skip} fail={fail})")
    print(f"[done] ok={ok} skip={skip} fail={fail}")
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
