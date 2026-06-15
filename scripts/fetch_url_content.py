#!/usr/bin/env python3
"""抓取 URL 内容并转成 Markdown。

针对几种 URL 走特殊路径,其它走通用 HTML → Markdown：
- github.com/owner/repo → raw README.md
- x.com / twitter.com 推文 → fxtwitter API（含 Draft.js 长文）
- youtube.com / youtu.be → oembed
- 通用 → 自实现 HTML 解析,失败回退 Wayback Machine

抓取后默认会调用 translate_text 翻译成中文（仅在内容判定为英文时）。
--bilingual 时输出英中段间对照，每批段落只发一次翻译请求。

CLI: python fetch_url_content.py <url> [--timeout SECONDS] [--no-translate] [--bilingual]
输出: JSON 到 stdout, 字段:
    成功: status, title, markdown, source_url, content_type,
          translated, detected_source, translate_provider, pairs?
    失败: status="error", error
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from translate_text import TranslationError, is_english_text, translate_text


USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
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


def collapse_whitespace(value: str) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", value).strip()


def collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()


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


def parse_tweet_id(url: str) -> str | None:
    match = TWEET_URL_RE.search(url)
    return match.group(1) if match else None


def parse_youtube_id(url: str) -> str | None:
    match = YOUTUBE_URL_RE.search(url)
    return match.group(1) if match else None


def fetch_youtube_content(url: str, youtube_id: str, timeout: float) -> dict[str, Any]:
    """通过 YouTube oembed 抓取视频元数据。"""
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

    markdown = youtube_to_markdown(payload, source_url=url)
    title = collapse_whitespace(str(payload.get("title") or url))
    return {
        "status": "success",
        "content_type": "application/json",
        "title": title,
        "markdown": markdown,
        "source_url": url,
    }


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


def fetch_x_content(url: str, tweet_id: str, timeout: float) -> dict[str, Any]:
    """通过 fxtwitter 抓取推文/x 长文。"""
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
    title = build_tweet_title(tweet, fallback=url)

    return {
        "status": "success",
        "content_type": content_type,
        "title": title,
        "markdown": markdown,
        "source_url": source_url,
    }


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


def maybe_translate_markdown(
    markdown: str,
    *,
    target_language: str,
    timeout: float,
    bilingual: bool = False,
) -> dict[str, Any]:
    """判断 markdown 是否英文,是则翻译;返回附加字段 dict。"""
    fields: dict[str, Any] = {
        "translated": False,
        "detected_source": "",
        "translate_provider": "",
    }
    if not is_english_text(markdown):
        return fields

    try:
        result = translate_text(
            markdown,
            source_language="en",
            target_language=target_language,
            timeout=timeout,
            bilingual=bilingual,
        )
    except TranslationError as error:
        fields["translate_error"] = str(error)
        return fields

    fields["markdown"] = result.text
    fields["translated"] = True
    fields["detected_source"] = result.detected_source or "en"
    fields["translate_provider"] = result.provider_id
    if result.pairs is not None:
        fields["pairs"] = result.pairs
    return fields


def _apply_translation(
    result: dict[str, Any],
    *,
    target_language: str,
    timeout: float,
    bilingual: bool = False,
) -> None:
    """对成功结果应用翻译（原地修改）。"""
    markdown = result.get("markdown")
    if not markdown:
        return
    overrides = maybe_translate_markdown(
        markdown,
        target_language=target_language,
        timeout=timeout,
        bilingual=bilingual,
    )
    if "markdown" in overrides:
        result["markdown"] = overrides.pop("markdown")
    result.update(overrides)


def fetch_url_content(
    url: str,
    timeout: float,
    *,
    translate: bool = True,
    target_language: str = "zh-CN",
    bilingual: bool = False,
) -> dict[str, Any]:
    """主调度：根据 URL 类型走不同抓取路径,返回统一结构的 dict。"""
    try:
        result = _fetch_raw(url, timeout=timeout)
        if result.get("status") == "success":
            result.setdefault("translated", False)
            result.setdefault("detected_source", "")
            result.setdefault("translate_provider", "")
            if translate:
                _apply_translation(
                    result,
                    target_language=target_language,
                    timeout=timeout,
                    bilingual=bilingual,
                )
        return result
    except RuntimeError as error:
        return {
            "status": "error",
            "error": str(error),
        }


def _fetch_raw(url: str, *, timeout: float) -> dict[str, Any]:
    readme_url = github_readme_url(url)
    if readme_url:
        try:
            markdown, content_type = fetch(readme_url, timeout=timeout)
            return {
                "status": "success",
                "content_type": content_type,
                "title": markdown_title(markdown) or url,
                "markdown": markdown.strip(),
                "source_url": readme_url,
            }
        except RuntimeError:
            pass

    tweet_id = parse_tweet_id(url)
    if tweet_id:
        return fetch_x_content(url, tweet_id, timeout=timeout)

    youtube_id = parse_youtube_id(url)
    if youtube_id:
        return fetch_youtube_content(url, youtube_id, timeout=timeout)

    try:
        html, content_type = fetch(url, timeout=timeout)
        source_url = url
    except RuntimeError:
        wayback = try_wayback_fallback(url, timeout=timeout)
        if wayback is None:
            raise
        html, content_type, source_url = wayback

    page_title, markdown = html_to_markdown(html)
    return {
        "status": "success",
        "content_type": content_type,
        "title": page_title or url,
        "markdown": markdown,
        "source_url": source_url,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="抓取 URL 内容并转成 Markdown")
    parser.add_argument("url", help="要抓取的 URL")
    parser.add_argument("--timeout", type=float, default=20, help="抓取超时(秒),默认 20")
    parser.add_argument("--no-translate", dest="translate", action="store_false", help="跳过英文翻译步骤")
    parser.add_argument("--translate-target", default="zh-CN", help="翻译目标语言,默认 zh-CN")
    parser.add_argument("--bilingual", action="store_true", help="输出英中段间对照；每批段落只发一次翻译请求")
    args = parser.parse_args()

    result = fetch_url_content(
        args.url,
        timeout=args.timeout,
        translate=args.translate,
        target_language=args.translate_target,
        bilingual=args.bilingual,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("status") == "success" else 1)


if __name__ == "__main__":
    main()
