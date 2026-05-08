from __future__ import annotations

import argparse
import html
import json
import re
import struct
import time
import urllib.parse
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, Comment, NavigableString, Tag


USER_AGENT = "Mozilla/5.0 (compatible; wufeifei.com importer)"


def fetch_bytes(url: str) -> bytes:
    parsed = urllib.parse.urlsplit(url)
    safe_path = urllib.parse.quote(urllib.parse.unquote(parsed.path), safe="/")
    safe_query = urllib.parse.quote(urllib.parse.unquote(parsed.query), safe="=&?")
    safe_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, safe_path, safe_query, parsed.fragment))
    req = urllib.request.Request(safe_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def fetch_json(url: str) -> dict:
    return json.loads(fetch_bytes(url).decode("utf-8"))


def yaml_title(title: str) -> str:
    """Quote a title for YAML frontmatter if it contains special characters."""
    if ":" in title or '"' in title or "'" in title or "#" in title:
        if "'" not in title:
            return f"'{title}'"
        return '"' + title.replace('"', '\\"') + '"'
    return title


def clean_text(value: str) -> str:
    value = html.unescape(value)
    value = value.replace("\xa0", " ")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) >= 24 and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return struct.unpack(">II", data[16:24])
    return None


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or not data.startswith(b"\xff\xd8"):
        return None
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        index += 2
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(data):
            return None
        segment_length = int.from_bytes(data[index : index + 2], "big")
        if segment_length < 2 or index + segment_length > len(data):
            return None
        if 0xC0 <= marker <= 0xC3:
            height = int.from_bytes(data[index + 3 : index + 5], "big")
            width = int.from_bytes(data[index + 5 : index + 7], "big")
            return width, height
        index += segment_length
    return None


def webp_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8X" and len(data) >= 30:
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8 " and len(data) >= 30:
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    if chunk == b"VP8L" and len(data) >= 25:
        bits = int.from_bytes(data[21:25], "little")
        width = 1 + (bits & 0x3FFF)
        height = 1 + ((bits >> 14) & 0x3FFF)
        return width, height
    return None


def image_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()[:256 * 1024]
    except OSError:
        return None
    return png_dimensions(data) or jpeg_dimensions(data) or webp_dimensions(data)


def image_orientation(markdown_image: str, image_dir: Path) -> str:
    match = re.search(r"\]\((\./[^)]+)\)", markdown_image)
    if not match:
        return "unknown"
    local_path = image_dir / urllib.parse.unquote(match.group(1)[2:])
    dimensions = image_dimensions(local_path)
    if not dimensions:
        return "unknown"
    width, height = dimensions
    return "portrait" if height > width else "landscape"


def order_image_group(image_group: list[str], image_dir: Path) -> list[str]:
    if len(image_group) <= 1:
        return image_group

    orientations = [image_orientation(image, image_dir) for image in image_group]
    first_orientation = next((orientation for orientation in orientations if orientation != "unknown"), "landscape")
    second_orientation = "portrait" if first_orientation == "landscape" else "landscape"
    order = {first_orientation: 0, second_orientation: 1, "unknown": 2}
    indexed_images = list(enumerate(zip(image_group, orientations)))
    indexed_images.sort(key=lambda item: (order[item[1][1]], item[0]))
    return [image for _, (image, _) in indexed_images]


def group_adjacent_images(markdown: str, image_dir: Path) -> str:
    blocks = markdown.split("\n\n")
    grouped: list[str] = []
    image_group: list[str] = []
    image_block = re.compile(r"^!\[[^\]\n]*\]\([^)]+\)$")

    def flush_images() -> None:
        nonlocal image_group
        if image_group:
            ordered_images = order_image_group(image_group, image_dir)
            grouped.append("\n".join(ordered_images) if len(ordered_images) > 1 else ordered_images[0])
            image_group = []

    for block in blocks:
        if image_block.fullmatch(block.strip()):
            image_group.append(block.strip())
            continue
        flush_images()
        grouped.append(block)
    flush_images()
    return "\n\n".join(grouped)


def escape_mdx_angle_brackets(markdown: str) -> str:
    """Escape < outside fenced code blocks that would break MDX parsing."""
    result = []
    last_end = 0
    for m in re.finditer(r"```[\s\S]*?```", markdown):
        before = markdown[last_end:m.start()]
        result.append(re.sub(r"<(?![a-zA-Z_$\/]|!--)", "&lt;", before))
        result.append(m.group())
        last_end = m.end()
    result.append(re.sub(r"<(?![a-zA-Z_$\/]|!--)", "&lt;", markdown[last_end:]))
    return "".join(result)


def normalize_markdown(markdown: str, image_dir: Path) -> str:
    markdown = group_adjacent_images(markdown, image_dir)
    markdown = escape_mdx_angle_brackets(markdown)
    markdown = markdown.replace(
        "**2025 年，我累计阅读 80 本书，阅读 255 天，总时长超过 368 小时（较去年增长 133%），平均每天约 60 分钟，并留下 2223 条**阅读笔记** 。** 今年阅读主要围绕经济理财与个人提升方面。",
        "**2025 年，我累计阅读 80 本书，阅读 255 天，总时长超过 368 小时（较去年增长 133%），平均每天约 60 分钟，并留下 2223 条阅读笔记。** 今年阅读主要围绕经济理财与个人提升方面。",
    )
    markdown = re.sub(r"(?<!\\)(?<!\*)\*\*万", r"\\*\\*万", markdown)
    if "<!-- truncate -->" not in markdown:
        markdown = re.sub(r"\n\n(## )", "\n\n<!-- truncate -->\n\n\\1", markdown, count=1)
    return markdown


def inline_text(node) -> str:
    if isinstance(node, Comment):
        return ""
    if isinstance(node, NavigableString):
        return clean_text(str(node))
    if not isinstance(node, Tag):
        return ""
    if node.name == "br":
        return "\n"
    if node.name in {"strong", "b"}:
        inner = "".join(inline_text(child) for child in node.children).strip()
        return f"**{inner}** " if inner else ""
    if node.name in {"em", "i"}:
        inner = "".join(inline_text(child) for child in node.children).strip()
        return f"*{inner}*" if inner else ""
    if node.name == "code":
        inner = node.get_text("", strip=True)
        return f"`{inner}`" if inner else ""
    if node.name == "a":
        inner = "".join(inline_text(child) for child in node.children).strip()
        href = node.get("href")
        if href and inner:
            return f"[{inner}]({href})"
        return inner
    if node.name == "img":
        return ""
    return "".join(inline_text(child) for child in node.children)


def image_url(tag: Tag) -> str | None:
    for attr in ("data-src", "data-lazy-src", "src"):
        value = tag.get(attr)
        if value and "lazy_placeholder" not in value:
            return urllib.parse.urljoin("https://feei.cn/", value)
    return None


def background_url(tag: Tag) -> str | None:
    style = tag.get("style") or ""
    match = re.search(r"url\(([^)]+)\)", style)
    if not match:
        return None
    value = match.group(1).strip("\"'")
    return urllib.parse.urljoin("https://feei.cn/", value)


def local_image_path(url: str, used_names: set[str]) -> str:
    parsed = urllib.parse.urlparse(url)
    basename = urllib.parse.unquote(Path(parsed.path).name)
    basename = re.sub(r"\s+", "-", basename)
    basename = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "-", basename)
    if not basename:
        basename = "image"
    stem = Path(basename).stem
    suffix = Path(basename).suffix or ".png"
    candidate = basename
    index = 2
    while candidate in used_names:
        candidate = f"{stem}-{index}{suffix}"
        index += 1
    used_names.add(candidate)
    return candidate


class Converter:
    def __init__(self, out_dir: Path) -> None:
        self.out_dir = out_dir
        self.downloads: dict[str, str] = {}
        self.used_names: set[str] = set()

    def download_image(self, url: str) -> str:
        if url in self.downloads:
            return self.downloads[url]
        filename = local_image_path(url, self.used_names)
        target = self.out_dir / filename
        if not target.exists():
            target.write_bytes(fetch_bytes(url))
            time.sleep(0.05)
        # Convert to WebP on the fly; update filename so the md ref uses .webp
        if target.suffix.lower() != ".webp":
            webp_target = target.with_suffix(".webp")
            if not webp_target.exists():
                try:
                    from PIL import Image
                    with Image.open(target) as im:
                        mode = "RGBA" if im.mode in ("P", "RGBA") else "RGB"
                        im.convert(mode).save(webp_target, "WEBP", quality=82, method=6)
                except Exception:
                    webp_target = target  # fallback: keep original
            if webp_target != target and webp_target.exists():
                target.unlink()
            target = webp_target
        local = f"./{target.name}"
        self.downloads[url] = local
        return local

    def image_markdown(self, tag: Tag, fallback_url: str | None = None) -> str:
        url = fallback_url or image_url(tag)
        if not url or "wp-content/uploads" not in url:
            return ""
        alt = clean_text(tag.get("alt") or tag.get("aria-label") or "")
        local = self.download_image(url)
        return f"![{alt}]({local})"

    def convert_table(self, tag: Tag) -> str:
        def escape_cell(text: str) -> str:
            return text.replace("<", "&lt;").replace(">", "&gt;")

        rows: list[list[str]] = []
        for tr in tag.find_all("tr"):
            cells = [escape_cell(clean_text(cell.get_text(" ", strip=True))) for cell in tr.find_all(["th", "td"])]
            if cells:
                rows.append(cells)
        if not rows:
            return ""
        width = max(len(row) for row in rows)
        rows = [row + [""] * (width - len(row)) for row in rows]
        header = rows[0]
        body = rows[1:] or [[""] * width]
        lines = [
            "| " + " | ".join(header) + " |",
            "| " + " | ".join(["---"] * width) + " |",
        ]
        lines.extend("| " + " | ".join(row) + " |" for row in body)
        return "\n".join(lines)

    def convert_list(self, tag: Tag, ordered: bool = False, depth: int = 0) -> str:
        lines: list[str] = []
        for index, li in enumerate(tag.find_all("li", recursive=False), start=1):
            prefix = f"{index}." if ordered else "-"
            text_parts: list[str] = []
            nested: list[str] = []
            for child in li.children:
                if isinstance(child, Tag) and child.name in {"ul", "ol"}:
                    nested_text = self.convert_list(child, child.name == "ol", depth + 1)
                    if nested_text:
                        nested.append(nested_text)
                else:
                    text_parts.append(inline_text(child))
            text = clean_text("".join(text_parts))
            if text:
                lines.append(f"{'  ' * depth}{prefix} {text}")
            lines.extend(nested)
        return "\n".join(lines)

    def convert_node(self, node) -> str:
        if isinstance(node, Comment):
            return "{/* truncate */}" if "more" in str(node) else ""
        if isinstance(node, NavigableString):
            return clean_text(str(node))
        if not isinstance(node, Tag):
            return ""

        classes = set(node.get("class") or [])
        if "wp-block-uagb-table-of-contents" in classes or "uagb-toc__wrap" in classes:
            return ""
        if node.name in {"script", "style", "noscript"}:
            return ""

        if node.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            level = int(node.name[1])
            text = clean_text(node.get_text(" ", strip=True))
            return f"{'#' * level} {text}" if text else ""

        if node.name == "p":
            images = [self.image_markdown(img) for img in node.find_all("img")]
            images = list(dict.fromkeys(img for img in images if img))
            text = clean_text(inline_text(node))
            parts = []
            if text:
                parts.append(text)
            parts.extend(images)
            return "\n\n".join(parts)

        if node.name == "figure":
            parts: list[str] = []
            seen: set[str] = set()
            for img in node.find_all("img"):
                md = self.image_markdown(img)
                if md and md not in seen:
                    seen.add(md)
                    parts.append(md)
            caption = node.find("figcaption")
            if caption:
                caption_text = clean_text(caption.get_text(" ", strip=True))
                if caption_text:
                    parts.append(f"*{caption_text}*")
            if parts:
                return "\n\n".join(parts)

        if node.name == "img":
            return self.image_markdown(node)

        if node.name == "table":
            return self.convert_table(node)

        if node.name in {"ul", "ol"}:
            return self.convert_list(node, node.name == "ol")

        if node.name == "pre":
            code_tag = node.find("code")
            lang = ""
            if code_tag:
                for cls in (code_tag.get("class") or []):
                    if cls.startswith("language-"):
                        lang = cls[9:]
                        break
                text = code_tag.get_text()
            else:
                text = node.get_text()
            return f"```{lang}\n{text.rstrip()}\n```"

        if node.name == "blockquote":
            text = self.convert_children(node)
            return "\n".join(f"> {line}" if line else ">" for line in text.splitlines())

        bg_url = background_url(node)
        if bg_url and "wp-content/uploads" in bg_url:
            local = self.download_image(bg_url)
            text = self.convert_children(node)
            parts = [f"![]({local})"]
            if text:
                parts.append(text)
            return "\n\n".join(parts)

        if node.name in {"div", "section", "article", "main", "span"}:
            return self.convert_children(node)

        return self.convert_children(node)

    def convert_children(self, tag: Tag) -> str:
        parts: list[str] = []
        for child in tag.children:
            text = self.convert_node(child)
            if text:
                parts.append(text)
        return "\n\n".join(parts)


def fetch_post(slug: str) -> dict:
    api_url = f"https://feei.cn/wp-json/wp/v2/posts?slug={urllib.parse.quote(slug)}"
    posts = fetch_json(api_url)
    if not posts:
        raise SystemExit(f"No WordPress post found for slug: {slug}")
    return posts[0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a feei.cn annual review post into Docusaurus blog.")
    parser.add_argument("--slug", default="annual-review-for-2025")
    args = parser.parse_args()

    data = fetch_post(args.slug)
    title = clean_text(data["title"]["rendered"])
    date = data["date"][:10]
    slug = clean_text(data.get("slug") or args.slug)
    source_url = data.get("link") or f"https://feei.cn/{slug}/"
    out_dir = Path(f"blog/{date}-{slug}")
    out_file = out_dir / "index.md"
    content_html = data["content"]["rendered"]
    soup = BeautifulSoup(content_html, "html.parser")

    out_dir.mkdir(parents=True, exist_ok=True)
    converter = Converter(out_dir)
    body = converter.convert_children(soup)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    body = normalize_markdown(body, out_dir)

    frontmatter = f"""---\nslug: {slug}\ntitle: {yaml_title(title)}\ndate: {date}\ntags: [年度总结]\n---\n"""
    source_note = f"\n\n> 原文：[{title}]({source_url})\n\n"
    out_file.write_text(frontmatter + source_note + body + "\n", encoding="utf-8")
    print(f"Wrote {out_file}")
    print(f"Downloaded {len(converter.downloads)} images")


if __name__ == "__main__":
    main()
