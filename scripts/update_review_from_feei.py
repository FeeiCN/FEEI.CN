"""Update docs/05-review articles with latest content from feei.cn."""
from __future__ import annotations

import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Add scripts dir to path to reuse Converter
sys.path.insert(0, str(Path(__file__).parent))

from bs4 import BeautifulSoup

from import_feei_annual_review import (
    Converter,
    USER_AGENT,
    clean_text,
    normalize_markdown,
    yaml_title,
)

DOCS_REVIEW = Path(__file__).parent.parent / "docs" / "05-review"


def fetch_html(slug: str) -> str:
    url = f"https://feei.cn/{slug}/"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_frontmatter(text: str) -> tuple[str, str]:
    """Return (frontmatter_block, body). frontmatter_block includes the --- delimiters."""
    if not text.startswith("---"):
        return "", text
    end = text.index("---", 3)
    return text[: end + 3], text[end + 3 :]


def slug_from_frontmatter(fm: str) -> str | None:
    m = re.search(r"^slug:\s+/?(.+)$", fm, re.MULTILINE)
    return m.group(1).strip() if m else None


def update_file(md_file: Path) -> None:
    text = md_file.read_text(encoding="utf-8")
    fm, _ = extract_frontmatter(text)
    slug = slug_from_frontmatter(fm)
    if not slug:
        print(f"  SKIP (no slug): {md_file.relative_to(DOCS_REVIEW)}")
        return

    out_dir = md_file.parent

    print(f"  Fetching https://feei.cn/{slug}/ ...")
    try:
        html = fetch_html(slug)
    except Exception as exc:
        print(f"  ERROR fetching {slug}: {exc}")
        return

    soup = BeautifulSoup(html, "html.parser")
    content_div = soup.find("div", class_="entry-content")
    if not content_div:
        print(f"  WARN: no entry-content found for {slug}")
        return

    converter = Converter(out_dir)
    body = converter.convert_children(content_div)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    body = normalize_markdown(body, out_dir)

    # Remove leading "原文：..." lines that the old importer added
    body = re.sub(r"^> 原文：\[.*?\]\(.*?\)\s*\n+", "", body, flags=re.MULTILINE)

    new_text = fm + "\n\n\n\n" + body + "\n"
    md_file.write_text(new_text, encoding="utf-8")
    print(f"  OK: {md_file.relative_to(DOCS_REVIEW)}  ({len(converter.downloads)} images)")
    time.sleep(0.3)


def main() -> None:
    md_files = sorted(DOCS_REVIEW.rglob("*.md"))
    print(f"Found {len(md_files)} markdown files in docs/05-review\n")
    for md_file in md_files:
        update_file(md_file)
    print("\nDone.")


if __name__ == "__main__":
    main()
