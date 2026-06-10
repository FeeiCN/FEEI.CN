#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from plistlib import dump, load
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_BOOKMARKS_PATH = Path.home() / "Library/Safari/Bookmarks.plist"
READING_LIST_TITLE = "com.apple.ReadingList"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
DEFAULT_GITHUB_REPO = "FeeiCN/feei.cn"
GITHUB_ISSUE_BODY_LIMIT = 65536
MAX_ISSUE_BODY_LENGTH = GITHUB_ISSUE_BODY_LIMIT - 1024
EXISTING_ISSUE_CACHE_FILE = Path.home() / ".cache/export_safari_reading_list/existing_issues.json"
BLOCK_TAGS = {"address", "article", "aside", "blockquote", "body", "div", "footer", "header", "main", "nav", "section"}
IGNORED_TAGS = {"script", "style", "noscript", "template", "svg", "canvas", "form"}
TWEET_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:x|twitter)\.com/[^/?#]+/status/(\d+)(?:[?#/]|$)",
    re.IGNORECASE,
)
FXTWITTER_BASE = "https://api.fxtwitter.com"
YOUTUBE_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/watch\?.*?v=|youtu\.be/)([\w-]{11})(?:[?#/]|$)",
    re.IGNORECASE,
)
YOUTUBE_OEMBED_BASE = "https://www.youtube.com/oembed"
WAYBACK_BASE = "https://web.archive.org/web/0"


def normalize_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone().isoformat(timespec="seconds")
    if value is None:
        return ""
    return str(value)


def find_reading_list_node(node: dict[str, Any]) -> dict[str, Any] | None:
    if node.get("Title") == READING_LIST_TITLE:
        return node

    for child in node.get("Children", []):
        if isinstance(child, dict):
            found = find_reading_list_node(child)
            if found:
                return found

    return None


def load_bookmarks(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as file:
            data = load(file)
    except FileNotFoundError:
        raise SystemExit(f"未找到 Safari 书签文件: {path}") from None
    except PermissionError:
        raise SystemExit(
            "无法读取 Safari 书签文件。请给当前终端或运行环境开启“完全磁盘访问权限”，"
            f"或用 --source 指定可读取的 Bookmarks.plist: {path}"
        ) from None

    if not isinstance(data, dict):
        raise SystemExit(f"Safari 书签文件格式异常: {path}")

    return data


def write_bookmarks(path: Path, bookmarks: dict[str, Any]) -> None:
    backup_path = path.with_name(f"{path.name}.{datetime.now().strftime('%Y%m%d%H%M%S')}.bak")
    backup_path.write_bytes(path.read_bytes())
    with path.open("wb") as file:
        dump(bookmarks, file, sort_keys=False)
    print(f"已备份 Safari 书签文件到 {backup_path}", file=sys.stderr)


def extract_entry(item: dict[str, Any]) -> dict[str, Any] | None:
    url = item.get("URLString")
    if not url:
        return None

    uri = item.get("URIDictionary") or {}
    reading_list = item.get("ReadingList") or {}
    title_candidates = (
        uri.get("title"),
        reading_list.get("Title"),
        item.get("title"),
        item.get("Title"),
    )
    title = next((candidate for candidate in title_candidates if candidate), url)

    return {
        "title": title,
        "url": url,
        "preview": reading_list.get("PreviewText", ""),
        "added_at": normalize_datetime(reading_list.get("DateAdded")),
        "last_viewed_at": normalize_datetime(reading_list.get("DateLastViewed")),
        "last_fetched_at": normalize_datetime(reading_list.get("DateLastFetched")),
        "unread": "DateLastViewed" not in reading_list,
        "archived": bool(reading_list.get("IsArchived", False)),
    }


def collapse_whitespace(value: str) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", value).strip()


def slugify(value: str, fallback: str) -> str:
    slug = re.sub(r"[^\w一-鿿-]+", "-", value.lower(), flags=re.UNICODE)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:80] or fallback


def plain_title(value: str) -> str:
    value = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"[#*_`>\[\]()]+", " ", value)
    return collapse_whitespace(value)


def truncate_text(value: str, max_length: int) -> str:
    if len(value) <= max_length:
        return value
    marker = "\n\n<!-- 内容过长，已截断。请通过原文链接查看完整内容。 -->\n"
    return value[: max_length - len(marker)].rstrip() + marker


def parse_charset(content_type: str | None) -> str:
    if not content_type:
        return "utf-8"
    match = re.search(r"charset=([^;\s]+)", content_type, flags=re.I)
    return match.group(1).strip("\"'") if match else "utf-8"


def fetch(url: str, timeout: float) -> tuple[str, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("content-type")
            charset = parse_charset(content_type)
            body = response.read()
    except HTTPError as error:
        raise RuntimeError(f"HTTP {error.code}") from error
    except URLError as error:
        reason = getattr(error, "reason", error)
        raise RuntimeError(str(reason)) from error

    return body.decode(charset, errors="replace"), content_type or ""


def fetch_json(url: str, timeout: float) -> tuple[Any, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("content-type") or ""
            body = response.read()
    except HTTPError as error:
        raise RuntimeError(f"HTTP {error.code}") from error
    except URLError as error:
        reason = getattr(error, "reason", error)
        raise RuntimeError(str(reason)) from error

    if "json" not in content_type.lower():
        raise RuntimeError(f"unexpected content-type: {content_type}")
    try:
        return json.loads(body.decode("utf-8", errors="replace")), content_type
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid json: {error}") from error


def github_readme_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.netloc.lower() != "github.com":
        return None

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        return None
    if len(parts) >= 3 and parts[2] not in {"", "tree"}:
        return None

    owner, repo = parts[:2]
    return f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md"


def markdown_title(markdown: str) -> str:
    for line in markdown.splitlines():
        match = re.match(r"^#\s+(.+?)\s*$", line)
        if match:
            return collapse_whitespace(match.group(1))
    return ""


class MarkdownHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self.ignore_stack: list[str] = []
        self.link_stack: list[str] = []
        self.in_title = False
        self.in_pre = False
        self.list_stack: list[str] = []

    @property
    def ignored(self) -> bool:
        return bool(self.ignore_stack)

    def append(self, value: str) -> None:
        if value:
            self.parts.append(value)

    def blank_line(self) -> None:
        self.append("\n\n")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_map = dict(attrs)

        if tag in IGNORED_TAGS:
            self.ignore_stack.append(tag)
            return
        if self.ignored:
            return
        if tag == "title":
            self.in_title = True
            return
        if tag in BLOCK_TAGS:
            self.blank_line()
            if tag == "blockquote":
                self.append("> ")
            return
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            level = int(tag[1])
            self.blank_line()
            self.append("#" * level + " ")
            return
        if tag == "p":
            self.blank_line()
            return
        if tag in {"br", "hr"}:
            self.append("\n" if tag == "br" else "\n\n---\n\n")
            return
        if tag in {"ul", "ol"}:
            self.list_stack.append(tag)
            self.blank_line()
            return
        if tag == "li":
            marker = "1. " if self.list_stack and self.list_stack[-1] == "ol" else "- "
            self.append("\n" + marker)
            return
        if tag == "a":
            href = attr_map.get("href") or ""
            self.link_stack.append(href)
            if href:
                self.append("[")
            return
        if tag in {"strong", "b"}:
            self.append("**")
            return
        if tag in {"em", "i"}:
            self.append("*")
            return
        if tag == "code" and not self.in_pre:
            self.append("`")
            return
        if tag == "pre":
            self.in_pre = True
            self.append("\n\n```text\n")
            return
        if tag == "img":
            src = attr_map.get("src")
            alt = collapse_whitespace(attr_map.get("alt") or "")
            if src:
                self.append(f"\n\n![{alt}]({src})\n\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()

        if self.ignore_stack:
            if self.ignore_stack[-1] == tag:
                self.ignore_stack.pop()
            return
        if tag == "title":
            self.in_title = False
            return
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6", "p"}:
            self.blank_line()
            return
        if tag in {"ul", "ol"}:
            if self.list_stack:
                self.list_stack.pop()
            self.blank_line()
            return
        if tag == "li":
            self.append("\n")
            return
        if tag == "a":
            href = self.link_stack.pop() if self.link_stack else ""
            if href:
                self.append(f"]({href})")
            return
        if tag in {"strong", "b"}:
            self.append("**")
            return
        if tag in {"em", "i"}:
            self.append("*")
            return
        if tag == "code" and not self.in_pre:
            self.append("`")
            return
        if tag == "pre":
            self.in_pre = False
            self.append("\n```\n\n")

    def handle_data(self, data: str) -> None:
        if self.ignored:
            return
        text = unescape(data)
        if self.in_title:
            self.title_parts.append(text)
            return
        if self.link_stack:
            self.append(collapse_whitespace(text))
            return
        if self.in_pre:
            self.append(text)
            return
        if text.strip():
            self.append(collapse_whitespace(text) + " ")

    def handle_entityref(self, name: str) -> None:
        self.handle_data(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.handle_data(f"&#{name};")

    def markdown(self) -> str:
        text = "".join(self.parts)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def title(self) -> str:
        return collapse_whitespace("".join(self.title_parts))


def html_to_markdown(html: str) -> tuple[str, str]:
    parser = MarkdownHTMLParser()
    parser.feed(html)
    return parser.title(), parser.markdown()


def fetch_entry_content(entry: dict[str, Any], timeout: float) -> dict[str, Any]:
    try:
        readme_url = github_readme_url(entry["url"])
        if readme_url:
            try:
                markdown, content_type = fetch(readme_url, timeout=timeout)
                entry["content"] = {
                    "status": "success",
                    "content_type": content_type,
                    "title": markdown_title(markdown) or entry["title"],
                    "markdown": markdown.strip(),
                    "source_url": readme_url,
                }
                return entry
            except RuntimeError:
                pass

        tweet_id = parse_tweet_id(entry["url"])
        if tweet_id:
            entry = fetch_x_content(entry, tweet_id, timeout=timeout)
            return entry

        youtube_id = parse_youtube_id(entry["url"])
        if youtube_id:
            entry = fetch_youtube_content(entry, youtube_id, timeout=timeout)
            return entry

        try:
            html, content_type = fetch(entry["url"], timeout=timeout)
            source_url = entry["url"]
        except RuntimeError as error:
            wayback = try_wayback_fallback(entry["url"], timeout=timeout)
            if wayback is None:
                raise
            html, content_type, source_url = wayback
        page_title, markdown = html_to_markdown(html)
        entry["content"] = {
            "status": "success",
            "content_type": content_type,
            "title": page_title or entry["title"],
            "markdown": markdown,
            "source_url": source_url,
        }
    except RuntimeError as error:
        entry["content"] = {
            "status": "error",
            "error": str(error),
            "markdown": "",
        }
    return entry


def parse_tweet_id(url: str) -> str | None:
    match = TWEET_URL_RE.search(url)
    return match.group(1) if match else None


def parse_youtube_id(url: str) -> str | None:
    match = YOUTUBE_URL_RE.search(url)
    return match.group(1) if match else None


def fetch_youtube_content(entry: dict[str, Any], youtube_id: str, timeout: float) -> dict[str, Any]:
    """通过 YouTube oembed 抓取视频元数据，写入 entry['content']。"""
    candidates = [
        f"{YOUTUBE_OEMBED_BASE}?format=json&url=https://www.youtube.com/watch?v={youtube_id}",
        f"{YOUTUBE_OEMBED_BASE}?format=json&url=https://youtu.be/{youtube_id}",
    ]
    payload: Any = None
    last_error = ""
    for api_url in candidates:
        try:
            payload, _ = fetch_json(api_url, timeout=timeout)
            if isinstance(payload, dict) and payload.get("title"):
                break
        except RuntimeError as error:
            last_error = str(error)
            payload = None
    if not isinstance(payload, dict) or not payload.get("title"):
        raise RuntimeError(f"youtube oembed 失败: {last_error or 'empty response'}")

    markdown = youtube_to_markdown(payload, source_url=entry["url"])
    title = collapse_whitespace(str(payload.get("title") or entry["title"]))
    entry["content"] = {
        "status": "success",
        "content_type": "application/json",
        "title": title,
        "markdown": markdown,
        "source_url": entry["url"],
    }
    return entry


def youtube_to_markdown(oembed: dict[str, Any], source_url: str) -> str:
    """把 YouTube oembed 字段渲染为 Markdown。"""
    title = collapse_whitespace(str(oembed.get("title") or ""))
    author = collapse_whitespace(str(oembed.get("author_name") or ""))
    author_url = str(oembed.get("author_url") or "")
    provider = collapse_whitespace(str(oembed.get("provider_name") or "YouTube"))
    thumbnail = str(oembed.get("thumbnail_url") or "")
    html = str(oembed.get("html") or "")

    chunks: list[str] = []
    if thumbnail:
        chunks.append(f"![{title} 缩略图]({thumbnail})")
    if title:
        chunks.append(f"# {title}")

    if author and author_url:
        author_line = f"- 频道: [{author}]({author_url})"
    elif author:
        author_line = f"- 频道: {author}"
    else:
        author_line = ""
    meta = [author_line, f"- 平台: {provider}", f"- 原文: {source_url}"]
    chunks.append("\n".join(line for line in meta if line))

    if html:
        embed_src = re.search(r'src="([^"]+)"', html)
        if embed_src:
            chunks.append(f"- 嵌入: {embed_src.group(1)}")
    return "\n\n".join(chunks).strip()


def try_wayback_fallback(url: str, timeout: float) -> tuple[str, str, str] | None:
    """直接抓取失败时试 Wayback Machine；带 query 的 URL 在 wayback 没有时再去掉 query 重试。"""
    candidates = [url]
    if "?" in url:
        candidates.append(url.split("?", 1)[0])
    for candidate in candidates:
        wayback_url = f"{WAYBACK_BASE}/{candidate}"
        try:
            html, content_type = fetch(wayback_url, timeout=timeout)
        except RuntimeError:
            continue
        if len(html) >= 1024 and ("Wayback Machine" in html or "wayback" in html.lower()):
            return html, content_type, wayback_url
    return None


def fetch_x_content(entry: dict[str, Any], tweet_id: str, timeout: float) -> dict[str, Any]:
    """通过 fxtwitter 抓取推文/x 长文，并写入 entry['content']。"""
    api_url = f"{FXTWITTER_BASE}/i/status/{tweet_id}"
    payload, content_type = fetch_json(api_url, timeout=timeout)

    if not isinstance(payload, dict) or payload.get("tweet") is None:
        raise RuntimeError(f"fxtwitter 空响应: code={payload.get('code') if isinstance(payload, dict) else 'n/a'}")

    tweet = payload["tweet"]
    if not isinstance(tweet, dict):
        raise RuntimeError("fxtwitter 推文结构异常")

    author = tweet.get("author") or {}
    screen_name = author.get("screen_name") or "i"
    source_url = tweet.get("url") or f"https://x.com/{screen_name}/status/{tweet_id}"
    markdown = tweet_to_markdown(tweet, source_url=source_url)
    title = build_tweet_title(tweet, fallback=entry["title"])

    entry["content"] = {
        "status": "success",
        "content_type": content_type,
        "title": title,
        "markdown": markdown,
        "source_url": source_url,
    }
    return entry


def build_tweet_title(tweet: dict[str, Any], fallback: str) -> str:
    """从推文数据里挑一个最像标题的字段：x 长文用 article.title，普通推文截前 60 字。"""
    article = tweet.get("article") or {}
    if isinstance(article, dict) and article.get("title"):
        author = (tweet.get("author") or {}).get("name") or ""
        if author:
            return f"{author}：{collapse_whitespace(article['title'])}"
        return collapse_whitespace(article["title"])

    text = (tweet.get("text") or "").strip()
    if text:
        author = (tweet.get("author") or {}).get("name") or ""
        snippet = collapse_whitespace(text)
        if len(snippet) > 60:
            snippet = snippet[:60].rstrip() + "…"
        if author:
            return f"{author}：{snippet}"
        return snippet

    return fallback


def tweet_to_markdown(tweet: dict[str, Any], source_url: str) -> str:
    """把 fxtwitter 推文对象转成 Markdown。x 长文走 article.content.blocks，其它用 text + 媒体。"""
    article = tweet.get("article") or {}
    if isinstance(article, dict) and article.get("content"):
        body = article_to_markdown(article)
    else:
        body = regular_tweet_to_markdown(tweet)

    author = tweet.get("author") or {}
    author_line = ""
    if author.get("name") and author.get("screen_name"):
        profile_url = author.get("url") or f"https://x.com/{author['screen_name']}"
        author_line = f"- 作者: [{author['name']} (@{author['screen_name']})]({profile_url})"

    stats_line = format_tweet_stats(tweet)
    created_at = collapse_whitespace(str(tweet.get("created_at") or ""))
    meta_lines = [
        f"- 发布时间: {created_at}" if created_at else "",
        stats_line,
        author_line,
        f"- 原文: {source_url}",
    ]
    meta = "\n".join(line for line in meta_lines if line)

    parts = []
    title = article.get("title") if isinstance(article, dict) else None
    if title:
        parts.append(f"# {collapse_whitespace(title)}\n")
    if meta:
        parts.append(meta)
    if body:
        parts.append("\n" + body)
    return "\n\n".join(parts).strip()


def format_tweet_stats(tweet: dict[str, Any]) -> str:
    keys = (
        ("replies", "回复"),
        ("retweets", "转发"),
        ("quotes", "引用"),
        ("likes", "点赞"),
        ("bookmarks", "书签"),
        ("views", "浏览"),
    )
    items = [f"{label} {tweet.get(key)}" for key, label in keys if isinstance(tweet.get(key), int)]
    if not items:
        return ""
    return "- 互动: " + " / ".join(items)


def regular_tweet_to_markdown(tweet: dict[str, Any]) -> str:
    """普通推文：text（替换 t.co 为 expanded）+ 媒体 + 引用/转发中的推文。"""
    text = (tweet.get("text") or "").strip()
    text = expand_tweet_urls(text, tweet.get("entities") or {})

    chunks: list[str] = []
    if text:
        chunks.append(text)

    media = tweet.get("media") or {}
    for photo in media.get("photos") or []:
        url = photo.get("url")
        if not url:
            continue
        alt = collapse_whitespace(photo.get("altText") or "")
        chunks.append(f"![{alt}]({url})")
    for video in media.get("videos") or []:
        variants = video.get("variants") or []
        mp4 = max(
            (v for v in variants if v.get("content_type") == "video/mp4"),
            key=lambda v: v.get("bitrate") or 0,
            default=None,
        )
        if mp4 and mp4.get("url"):
            chunks.append(f"[视频]({mp4['url']})")
        elif video.get("url"):
            chunks.append(f"[视频]({video['url']})")

    quoted = tweet.get("quote") or tweet.get("quoting_tweet")
    if isinstance(quoted, dict) and quoted.get("url"):
        quoted_text = (quoted.get("text") or "").strip()
        if not quoted_text:
            quoted_text = (quoted.get("raw_text") or {}).get("text", "").strip()
        quoted_author = (quoted.get("author") or {}).get("screen_name") or "i"
        quoted_url = quoted["url"]
        if quoted_text:
            chunks.append(f"> [{quoted_author}]({quoted_url}): {quoted_text}")
        else:
            chunks.append(f"> 引用: [{quoted_author}]({quoted_url})")

    return "\n\n".join(chunks).strip()


def expand_tweet_urls(text: str, entities: dict[str, Any]) -> str:
    """把推文 text 里的 t.co 短链替换成 expanded_url，保留原始位置。"""
    urls = entities.get("urls") or []
    if not urls:
        return text
    for url_entity in urls:
        short = url_entity.get("url")
        expanded = url_entity.get("expanded_url")
        if short and expanded and short in text:
            text = text.replace(short, expanded)
    return text


def article_to_markdown(article: dict[str, Any]) -> str:
    """Draft.js 风格的 article.content.blocks 转 Markdown。"""
    content = article.get("content") or {}
    blocks = content.get("blocks") or []
    entity_map_list = content.get("entityMap") or []
    entity_map: dict[str, dict[str, Any]] = {
        str(item.get("key")): item.get("value") or {} for item in entity_map_list
    }
    media_entities = article.get("media_entities") or []
    media_by_id = {
        str(m.get("media_id")): m for m in media_entities if m.get("media_id") is not None
    }

    lines: list[str] = []
    for block in blocks:
        block_type = block.get("type") or "unstyled"
        text = block.get("text") or ""
        inline = render_draftjs_text(
            text,
            block.get("inlineStyleRanges") or [],
            block.get("entityRanges") or [],
            entity_map,
        )
        media_url = block_media_url(block, entity_map, media_by_id)

        if block_type == "atomic":
            if media_url:
                lines.append(f"\n![配图]({media_url})\n")
            continue

        if not inline.strip() and not media_url:
            continue

        if block_type in {"header-one", "header-two", "header-three", "header-four", "header-five", "header-six"}:
            level = {"header-one": 1, "header-two": 2, "header-three": 3, "header-four": 4, "header-five": 5, "header-six": 6}[block_type]
            lines.append(f"{'#' * level} {inline}")
        elif block_type == "blockquote":
            for line in inline.splitlines() or [""]:
                lines.append(f"> {line}" if line else ">")
        elif block_type == "ordered-list-item":
            lines.append(f"1. {inline}")
        elif block_type == "unordered-list-item":
            lines.append(f"- {inline}")
        else:
            lines.append(inline)

        if media_url and block_type != "atomic":
            lines.append(f"\n![配图]({media_url})")

    cover = ((article.get("cover_media") or {}).get("media_info") or {}).get("original_img_url")
    if cover:
        lines.insert(0, f"![封面]({cover})")

    return collapse_blank_lines("\n".join(lines))


def render_draftjs_text(text: str, styles: list[dict[str, Any]], entities: list[dict[str, Any]], entity_map: dict[str, dict[str, Any]]) -> str:
    """单个 Draft.js 块内的 inline 样式 + 链接实体转 Markdown。"""
    if not text:
        return ""

    marks: list[tuple[int, int, str, str]] = []
    for style in styles:
        start = int(style.get("offset", 0))
        end = start + int(style.get("length", 0))
        name = style.get("style")
        if name in {"Bold", "Italic", "Code"}:
            marks.append((start, end, name, ""))

    for entity in entities:
        start = int(entity.get("offset", 0))
        end = start + int(entity.get("length", 0))
        ent = entity_map.get(str(entity.get("key")))
        if not ent or ent.get("type") != "LINK":
            continue
        url = (ent.get("data") or {}).get("url", "")
        if url:
            marks.append((start, end, "LINK", url))

    if not marks:
        return text

    boundaries = sorted({0, len(text), *(start for start, _, _, _ in marks), *(end for _, end, _, _ in marks)})
    parts: list[str] = []
    for i in range(len(boundaries) - 1):
        seg_start, seg_end = boundaries[i], boundaries[i + 1]
        seg = text[seg_start:seg_end]
        if not seg:
            continue
        active_styles: set[str] = set()
        link_url = ""
        for start, end, kind, payload in marks:
            if start <= seg_start and end >= seg_end:
                if kind == "LINK":
                    link_url = payload
                else:
                    active_styles.add(kind)
        if "Code" in active_styles:
            seg = f"`{seg}`"
        if "Bold" in active_styles:
            seg = f"**{seg}**"
        if "Italic" in active_styles:
            seg = f"*{seg}*"
        if link_url:
            seg = f"[{seg}]({link_url})"
        parts.append(seg)
    return "".join(parts)


def block_media_url(block: dict[str, Any], entity_map: dict[str, dict[str, Any]], media_by_id: dict[str, dict[str, Any]]) -> str | None:
    """从 atomic 块（或带 media 链接的块）里解析出图片 URL。"""
    for entity in block.get("entityRanges") or []:
        ent = entity_map.get(str(entity.get("key")))
        if not ent or ent.get("type") != "MEDIA":
            continue
        for item in (ent.get("data") or {}).get("mediaItems") or []:
            media_id = str(item.get("mediaId") or "")
            media = media_by_id.get(media_id)
            if not media:
                continue
            info = media.get("media_info") or {}
            url = info.get("original_img_url") or info.get("media_url_https")
            if url:
                return url
    return None


def collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def export_reading_list(path: Path, include_archived: bool, unread_only: bool) -> list[dict[str, Any]]:
    bookmarks = load_bookmarks(path)
    reading_list = find_reading_list_node(bookmarks)
    if not reading_list:
        raise SystemExit(f"未在 Safari 书签文件中找到稍后阅读列表: {path}")

    entries = []
    for item in reading_list.get("Children", []):
        if not isinstance(item, dict):
            continue

        entry = extract_entry(item)
        if not entry:
            continue
        if entry["archived"] and not include_archived:
            continue
        if unread_only and not entry["unread"]:
            continue
        entries.append(entry)

    entries.sort(key=lambda entry: entry.get("added_at") or "", reverse=True)
    return entries


def mark_reading_list_entries_read(path: Path, urls: set[str]) -> int:
    if not urls:
        return 0

    bookmarks = load_bookmarks(path)
    reading_list = find_reading_list_node(bookmarks)
    if not reading_list:
        raise SystemExit(f"未在 Safari 书签文件中找到稍后阅读列表: {path}")

    children = reading_list.get("Children", [])
    if not isinstance(children, list):
        return 0

    marked_count = 0
    now = datetime.now().astimezone()
    for item in children:
        if not isinstance(item, dict) or item.get("URLString") not in urls:
            continue

        reading_list_data = item.get("ReadingList")
        if not isinstance(reading_list_data, dict):
            continue

        if "DateLastViewed" not in reading_list_data:
            reading_list_data["DateLastViewed"] = now
            marked_count += 1

    if marked_count:
        write_bookmarks(path, bookmarks)

    return marked_count


def render_json(entries: list[dict[str, Any]]) -> str:
    return json.dumps(entries, ensure_ascii=False, indent=2)


def escape_markdown_table(value: Any) -> str:
    return str(value or "").replace("|", "\\|").replace("\n", " ").strip()


def render_markdown_index(entries: list[dict[str, Any]]) -> str:
    rows = [
        "| 标题 | 链接 | 添加时间 | 状态 |",
        "| --- | --- | --- | --- |",
    ]

    for entry in entries:
        status = "未读" if entry["unread"] else "已读"
        if entry["archived"]:
            status = f"{status}，已归档"
        rows.append(
            "| "
            + " | ".join(
                [
                    escape_markdown_table(entry["title"]),
                    f"[打开]({entry['url']})",
                    escape_markdown_table(entry["added_at"]),
                    status,
                ]
            )
            + " |"
        )

    return "\n".join(rows)


def render_markdown(entries: list[dict[str, Any]]) -> str:
    if not any(entry.get("content") for entry in entries):
        return render_markdown_index(entries)

    sections = []
    for entry in entries:
        content = entry.get("content") or {}
        title = content.get("title") or entry["title"]
        sections.extend([
            f"# {title}",
            "",
            f"- 原文: {entry['url']}",
            f"- 内容来源: {content.get('source_url') or entry['url']}",
            f"- 添加时间: {entry['added_at'] or ''}",
            "",
        ])
        if content.get("status") == "error":
            sections.extend([f"抓取失败: {content.get('error', '')}", ""])
        else:
            sections.extend([content.get("markdown", ""), ""])

    return "\n".join(sections).strip()


def build_issue_title(entry: dict[str, Any]) -> str:
    content = entry.get("content") or {}
    title = plain_title(content.get("title") or entry["title"] or entry["url"])
    return truncate_text(f"稍后阅读：{title}", 120)


def build_issue_body(entry: dict[str, Any]) -> str:
    content = entry.get("content") or {}
    source_url = content.get("source_url") or entry["url"]
    metadata = [
        f"- 原文: {entry['url']}",
        f"- 内容来源: {source_url}",
        f"- 添加时间: {entry.get('added_at') or ''}",
        f"- 状态: {'未读' if entry.get('unread') else '已读'}",
    ]
    if entry.get("preview"):
        metadata.append(f"- Safari 摘要: {entry['preview']}")

    parts = [
        "## 来源",
        "",
        *metadata,
        "",
        "## 内容",
        "",
    ]

    if content.get("status") == "error":
        parts.append(f"抓取失败: {content.get('error', '')}")
    else:
        markdown = content.get("markdown", "")
        if not markdown:
            parts.append("内容未获取（页面需要 JS 渲染或登录后才能查看）")
        elif source_url.startswith(WAYBACK_BASE):
            parts.append(markdown)
            parts.append("")
            parts.append(f"> 注：原文对自动化访问有限制，内容取自 Wayback Machine 快照 ({source_url})。")
        else:
            parts.append(markdown)

    return truncate_text("\n".join(parts).strip(), MAX_ISSUE_BODY_LENGTH)


def run_gh(args: list[str], input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["gh", *args],
            input=input_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError:
        raise RuntimeError("未找到 GitHub CLI: gh。请先安装并执行 gh auth login。") from None


def load_existing_issue_cache() -> dict[str, dict[str, Any]]:
    if not EXISTING_ISSUE_CACHE_FILE.exists():
        return {}
    try:
        return json.loads(EXISTING_ISSUE_CACHE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_existing_issue_cache(cache: dict[str, dict[str, Any]]) -> None:
    EXISTING_ISSUE_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    EXISTING_ISSUE_CACHE_FILE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def list_repo_issues(repo: str) -> list[dict[str, Any]]:
    completed = run_gh([
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "all",
        "--json",
        "number,title,body,url",
        "--limit",
        "1000",
    ])
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"gh issue list 失败: {details}")

    return json.loads(completed.stdout or "[]")


def extract_url_from_issue_body(body: str) -> str | None:
    """从 build_issue_body 生成的正文中提取「原文」URL。"""
    match = re.search(r"^- 原文: (.+)$", body, re.MULTILINE)
    return match.group(1).strip() if match else None


def extract_issue_number(issue_url: str) -> int | None:
    """从 GitHub issue URL 中提取 issue 编号。"""
    match = re.search(r"/issues/(\d+)", issue_url)
    return int(match.group(1)) if match else None


def find_existing_issue(repo: str, url: str) -> dict[str, Any] | None:
    """按 URL 查找已存在的 issue。优先查本地缓存，缓存未命中再回源 GitHub 并回填。"""
    cache = load_existing_issue_cache()
    if url in cache:
        return cache[url]

    # 缓存未命中：查询 GitHub，按 URL 索引后写回缓存
    try:
        issues = list_repo_issues(repo)
    except RuntimeError:
        return None

    new_cache: dict[str, dict[str, Any]] = {}
    for issue in issues:
        body = issue.get("body", "") or ""
        issue_url = extract_url_from_issue_body(body)
        if issue_url:
            new_cache[issue_url] = {
                "number": issue.get("number"),
                "title": issue.get("title"),
                "url": issue.get("url"),
            }

    save_existing_issue_cache(new_cache)
    return new_cache.get(url)


def remember_created_issue(source_url: str, issue_url: str, title: str) -> None:
    """把本地刚创建的 issue 写入缓存，下次直接跳过。"""
    cache = load_existing_issue_cache()
    cache[source_url] = {
        "number": extract_issue_number(issue_url),
        "title": title,
        "url": issue_url,
    }
    save_existing_issue_cache(cache)


def create_github_issue(repo: str, title: str, body: str, labels: list[str]) -> dict[str, Any]:
    args = ["issue", "create", "--repo", repo, "--title", title, "--body-file", "-"]
    for label in labels:
        args.extend(["--label", label])

    completed = run_gh(args, input_text=body)
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"gh issue create 失败: {details}")

    issue_url = completed.stdout.strip()
    return {"url": issue_url}


def create_github_issues(
    entries: list[dict[str, Any]],
    repo: str,
    labels: list[str],
    dry_run: bool,
    skip_existing: bool,
) -> list[dict[str, Any]]:
    results = []
    for index, entry in enumerate(entries, 1):
        title = build_issue_title(entry)
        body = build_issue_body(entry)
        print(f"[{index}/{len(entries)}] issue: {title}", file=sys.stderr)

        if skip_existing:
            existing = find_existing_issue(repo, entry["url"])
            if existing:
                print(f"  跳过，已存在 #{existing['number']}: {existing['url']}", file=sys.stderr)
                results.append({"status": "skipped", "existing": existing, "title": title, "source_url": entry["url"]})
                continue

        if dry_run:
            print(f"  dry-run，正文长度 {len(body)}", file=sys.stderr)
            results.append({"status": "dry-run", "title": title, "body_length": len(body), "source_url": entry["url"]})
            continue

        created = create_github_issue(repo, title, body, labels)
        print(f"  已创建: {created['url']}", file=sys.stderr)
        if skip_existing:
            remember_created_issue(entry["url"], created["url"], title)
        results.append({"status": "created", "title": title, "source_url": entry["url"], **created})

    return results


def render_text(entries: list[dict[str, Any]]) -> str:
    lines = []
    for index, entry in enumerate(entries, 1):
        lines.append(f"{index}. {entry['title']}")
        lines.append(f"   {entry['url']}")
        if entry["added_at"]:
            lines.append(f"   添加时间: {entry['added_at']}")
        if entry["preview"]:
            lines.append(f"   摘要: {entry['preview']}")
        lines.append("")
    return "\n".join(lines).rstrip()


def render_entries(entries: list[dict[str, Any]], output_format: str) -> str:
    if output_format == "json":
        return render_json(entries)
    if output_format == "markdown":
        return render_markdown(entries)
    if output_format == "text":
        return render_text(entries)
    raise ValueError(f"Unsupported format: {output_format}")


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("必须是正整数")
    return number


def write_entry_markdown_files(entries: list[dict[str, Any]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    used_names: set[str] = set()

    for index, entry in enumerate(entries, 1):
        content = entry.get("content") or {}
        title = content.get("title") or entry["title"]
        parsed_url = urlparse(entry["url"])
        fallback = parsed_url.netloc or f"reading-list-{index}"
        base_name = slugify(title, fallback)
        file_name = f"{index:03d}-{base_name}.md"
        while file_name in used_names:
            base_name = f"{base_name}-{index}"
            file_name = f"{index:03d}-{base_name}.md"
        used_names.add(file_name)

        markdown = render_markdown([entry])
        (output_dir / file_name).write_text(markdown + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="导出 Safari 稍后阅读列表")
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_BOOKMARKS_PATH,
        help=f"Safari Bookmarks.plist 路径，默认 {DEFAULT_BOOKMARKS_PATH}",
    )
    parser.add_argument(
        "--format",
        choices=["json", "markdown", "text"],
        default="json",
        help="输出格式，默认 json",
    )
    parser.add_argument("--output", type=Path, help="输出文件路径，默认打印到 stdout")
    parser.add_argument("--limit", type=positive_int, help="最多输出多少条")
    parser.add_argument("--include-archived", action="store_true", help="包含已归档条目")
    parser.add_argument(
        "--unread-only",
        dest="unread_only",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="只处理未读条目（默认开启，--no-unread-only 关闭以重复处理已读条目）",
    )
    parser.add_argument("--fetch-content", action="store_true", help="抓取每个链接的网页内容并转成 Markdown")
    parser.add_argument("--timeout", type=float, default=20, help="网页抓取超时时间，默认 20 秒")
    parser.add_argument("--concurrency", type=positive_int, default=4, help="网页抓取并发数，默认 4")
    parser.add_argument("--content-output-dir", type=Path, help="把每个网页内容分别输出为 Markdown 文件")
    parser.add_argument(
        "--create-github-issues",
        dest="create_github_issues",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="把每条稍后阅读创建为 GitHub issue（默认开启，--no-create-github-issues 关闭）",
    )
    parser.add_argument("--github-repo", default=DEFAULT_GITHUB_REPO, help=f"目标 GitHub 仓库，默认 {DEFAULT_GITHUB_REPO}")
    parser.add_argument("--issue-label", action="append", default=None, help="创建 issue 时附加的 label，可重复传入")
    parser.add_argument("--issue-dry-run", action="store_true", help="只预览将要创建的 issue，不实际创建")
    parser.add_argument("--no-skip-existing", action="store_true", help="不按原文 URL 检查并跳过已有 issue")
    parser.add_argument(
        "--no-mark-processed-as-read",
        action="store_true",
        help="不把已处理（新建或已存在）的 Safari 稍后阅读条目标记为已读",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    labels = args.issue_label or []
    entries = export_reading_list(
        path=args.source.expanduser(),
        include_archived=args.include_archived,
        unread_only=args.unread_only,
    )
    if args.limit:
        entries = entries[: args.limit]

    if args.fetch_content or args.content_output_dir or args.create_github_issues:
        if args.concurrency > 1 and len(entries) > 1:
            with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                list(pool.map(
                    lambda entry: fetch_entry_content(entry, timeout=args.timeout),
                    entries,
                ))
        else:
            for index, entry in enumerate(entries, 1):
                print(f"[{index}/{len(entries)}] 抓取 {entry['url']}", file=sys.stderr)
                fetch_entry_content(entry, timeout=args.timeout)

    if args.content_output_dir:
        write_entry_markdown_files(entries, args.content_output_dir)
        print(f"已导出 {len(entries)} 个 Markdown 文件到 {args.content_output_dir}", file=sys.stderr)

    if args.create_github_issues:
        issue_results = create_github_issues(
            entries,
            repo=args.github_repo,
            labels=labels,
            dry_run=args.issue_dry_run,
            skip_existing=not args.no_skip_existing,
        )
        processed_urls = {
            result["source_url"]
            for result in issue_results
            if result.get("source_url") and result.get("status") in {"created", "skipped"}
        }
        if processed_urls and not args.no_mark_processed_as_read:
            marked_count = mark_reading_list_entries_read(args.source.expanduser(), processed_urls)
            print(f"已把 {marked_count} 条已处理（新建或已存在）的 Safari 稍后阅读标记为已读", file=sys.stderr)

    output = render_entries(entries, args.format)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(f"已导出 {len(entries)} 条 Safari 稍后阅读到 {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
