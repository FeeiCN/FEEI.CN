from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from import_feei_annual_review import Converter, clean_text, fetch_json, normalize_markdown, yaml_title


def fetch_category_id(slug: str) -> int:
    url = f"https://feei.cn/wp-json/wp/v2/categories?slug={urllib.parse.quote(slug)}"
    categories = fetch_json(url)
    if not categories:
        raise SystemExit(f"Category not found: {slug}")
    return categories[0]["id"]


def fetch_posts_in_category(category_id: int) -> list[dict]:
    posts: list[dict] = []
    page = 1
    while True:
        url = f"https://feei.cn/wp-json/wp/v2/posts?categories={category_id}&per_page=100&page={page}"
        batch = fetch_json(url)
        if not batch:
            break
        posts.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return posts


def import_post(data: dict, out_base: Path, tags: list[str]) -> None:
    from bs4 import BeautifulSoup

    title = clean_text(data["title"]["rendered"])
    date = data["date"][:10]
    slug = clean_text(data.get("slug") or "")
    source_url = data.get("link") or f"https://feei.cn/{slug}/"
    out_dir = out_base / f"{date}-{slug}"
    out_file = out_dir / "index.md"

    if out_file.exists():
        print(f"Skip (exists): {out_file}")
        return

    content_html = data["content"]["rendered"]
    soup = BeautifulSoup(content_html, "html.parser")

    out_dir.mkdir(parents=True, exist_ok=True)
    converter = Converter(out_dir)
    body = converter.convert_children(soup)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    body = normalize_markdown(body, out_dir)

    tags_str = "[" + ", ".join(tags) + "]"
    frontmatter = f"---\nslug: {slug}\ntitle: {yaml_title(title)}\ndate: {date}\ntags: {tags_str}\n---\n"
    source_note = f"\n\n> 原文：[{title}]({source_url})\n\n"
    out_file.write_text(frontmatter + source_note + body + "\n", encoding="utf-8")
    print(f"Wrote {out_file} ({len(converter.downloads)} images)")
    time.sleep(0.3)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import all posts from a feei.cn category into Docusaurus blog.")
    parser.add_argument("--category", default="cybersecurity")
    parser.add_argument("--out", default="blog")
    parser.add_argument("--tags", default="网络安全", help="Comma-separated tags")
    args = parser.parse_args()

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]

    category_id = fetch_category_id(args.category)
    print(f"Category '{args.category}' ID: {category_id}")

    posts = fetch_posts_in_category(category_id)
    print(f"Found {len(posts)} posts, importing to {args.out}/")

    out_base = Path(args.out)
    for post in posts:
        import_post(post, out_base, tags)

    print("Done.")


if __name__ == "__main__":
    main()
