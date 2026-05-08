"""
Convert all PNG/JPG/JPEG images in docs/ and static/ to WebP,
then update image references in markdown and source files.

Usage:
    python3 scripts/compress_images.py
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image

REPO = Path(__file__).parent.parent
SEARCH_DIRS = [REPO / "docs", REPO / "static"]
REF_DIRS = [REPO / "docs", REPO / "src"]
IMG_EXTS = {".png", ".jpg", ".jpeg"}
REF_PATTERN = re.compile(r"(?i)(\.png|\.jpg|\.jpeg)(?=[\"'\)\s]|$)")
QUALITY = 82


def convert_images(dirs: list[Path]) -> tuple[int, int, int]:
    orig_total = new_total = count = 0
    for base in dirs:
        for img_path in base.rglob("*"):
            if img_path.suffix.lower() not in IMG_EXTS:
                continue
            webp_path = img_path.with_suffix(".webp")
            try:
                with Image.open(img_path) as im:
                    mode = "RGBA" if im.mode in ("P", "RGBA") else "RGB"
                    im.convert(mode).save(webp_path, "WEBP", quality=QUALITY, method=6)
                orig_total += img_path.stat().st_size
                new_total += webp_path.stat().st_size
                img_path.unlink()
                count += 1
            except Exception as e:
                print(f"  ERROR {img_path}: {e}")
    return count, orig_total, new_total


def update_references(dirs: list[Path]) -> int:
    updated = 0
    glob_patterns = ["*.md", "*.mdx", "*.ts", "*.tsx"]
    files: list[Path] = []
    for d in dirs:
        for pat in glob_patterns:
            files.extend(d.rglob(pat))
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
            new_text = REF_PATTERN.sub(".webp", text)
            if new_text != text:
                f.write_text(new_text, encoding="utf-8")
                updated += 1
        except Exception:
            pass
    return updated


def main() -> None:
    print("Converting images...")
    count, orig, new = convert_images(SEARCH_DIRS)
    saved = orig - new
    pct = 100 * saved / orig if orig else 0
    print(f"  Converted: {count} images")
    print(f"  Before:    {orig/1024/1024:.1f} MB")
    print(f"  After:     {new/1024/1024:.1f} MB")
    print(f"  Saved:     {saved/1024/1024:.1f} MB ({pct:.0f}%)")

    print("Updating references...")
    updated = update_references(REF_DIRS)
    print(f"  Updated:   {updated} files")


if __name__ == "__main__":
    main()
