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
        "unread": bool(reading_list.get("IsUnread", False)),
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

        html, content_type = fetch(entry["url"], timeout=timeout)
        page_title, markdown = html_to_markdown(html)
        entry["content"] = {
            "status": "success",
            "content_type": content_type,
            "title": page_title or entry["title"],
            "markdown": markdown,
        }
    except RuntimeError as error:
        entry["content"] = {
            "status": "error",
            "error": str(error),
            "markdown": "",
        }
    return entry


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


def remove_reading_list_entries(path: Path, urls: set[str]) -> int:
    if not urls:
        return 0

    bookmarks = load_bookmarks(path)
    reading_list = find_reading_list_node(bookmarks)
    if not reading_list:
        raise SystemExit(f"未在 Safari 书签文件中找到稍后阅读列表: {path}")

    children = reading_list.get("Children", [])
    if not isinstance(children, list):
        return 0

    kept_children = []
    removed_count = 0
    for item in children:
        if isinstance(item, dict) and item.get("URLString") in urls:
            removed_count += 1
            continue
        kept_children.append(item)

    if removed_count:
        reading_list["Children"] = kept_children
        write_bookmarks(path, bookmarks)

    return removed_count


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
    metadata = [
        f"- 原文: {entry['url']}",
        f"- 内容来源: {content.get('source_url') or entry['url']}",
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
        parts.append(content.get("markdown", ""))

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


def find_existing_issue(repo: str, url: str) -> dict[str, Any] | None:
    cache = load_existing_issue_cache()
    if url in cache:
        return cache[url]

    issues = list_repo_issues(repo)
    cache = {issue.get("body", ""): issue for issue in issues}
    for body, issue in cache.items():
        if url in body:
            return issue
    return None


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
    if skip_existing:
        try:
            issues = list_repo_issues(repo)
            cache = {issue.get("body", ""): issue for issue in issues}
            save_existing_issue_cache(cache)
        except RuntimeError as error:
            print(f"无法拉取已有 issue 列表，跳过去重: {error}", file=sys.stderr)

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
    parser.add_argument("--unread-only", action="store_true", help="只输出未读条目")
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
        "--no-remove-created-from-reading-list",
        action="store_true",
        help="issue 创建成功后不从 Safari 稍后阅读中移除对应条目",
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
        created_urls = {
            result["source_url"]
            for result in issue_results
            if result.get("status") == "created" and result.get("source_url")
        }
        if created_urls and not args.no_remove_created_from_reading_list:
            removed_count = remove_reading_list_entries(args.source.expanduser(), created_urls)
            print(f"已从 Safari 稍后阅读移除 {removed_count} 条已创建 issue 的条目", file=sys.stderr)

    output = render_entries(entries, args.format)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
        print(f"已导出 {len(entries)} 条 Safari 稍后阅读到 {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
