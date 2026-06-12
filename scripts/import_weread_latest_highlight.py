#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


WE_READ_API_URL = "https://i.weread.qq.com/api/agent/gateway"
SKILL_VERSION = "1.0.3"
DEFAULT_REPO = "FeeiCN/FEEI.CN"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
STATE_FILE = Path(__file__).parent / "cache" / "weread_latest_highlight_state.json"
NOTEBOOK_PAGE_SIZE = 100
API_RETRIES = 3
GH_RETRIES = 3
TITLE_MAX_LENGTH = 80
INITIAL_LOOKBACK_HOURS = 48
OVERLAP_HOURS = 24
MAX_STATE_IDS = 500


def api_call(api_name: str, **params: Any) -> dict[str, Any]:
    api_key = os.environ.get("WEREAD_API_KEY")
    if not api_key:
        raise SystemExit("未设置 WEREAD_API_KEY，请先 export WEREAD_API_KEY=<你的apikey>")

    payload = {"api_name": api_name, "skill_version": SKILL_VERSION, **params}
    request = Request(
        WE_READ_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(1, API_RETRIES + 1):
        try:
            with urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, json.JSONDecodeError) as error:
            last_error = error
            if attempt < API_RETRIES:
                time.sleep(2 ** (attempt - 1))
                continue
            break

        if isinstance(data, dict) and data.get("errcode", 0):
            raise RuntimeError(f"微信读书接口返回错误: {data}")
        return data

    if isinstance(last_error, HTTPError):
        raise RuntimeError(f"微信读书接口 HTTP {last_error.code}") from last_error
    if isinstance(last_error, URLError):
        reason = getattr(last_error, "reason", last_error)
        raise RuntimeError(f"微信读书接口请求失败: {reason}") from last_error
    if isinstance(last_error, json.JSONDecodeError):
        raise RuntimeError(f"微信读书接口返回内容无法解析: {last_error}") from last_error
    raise RuntimeError("微信读书接口请求失败")


def run_gh(args: list[str], input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["gh", *args],
            input=input_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("未找到 GitHub CLI: gh。请先安装并执行 gh auth login。") from error


def run_gh_with_retry(args: list[str], input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    last_result: subprocess.CompletedProcess[str] | None = None
    for attempt in range(1, GH_RETRIES + 1):
        result = run_gh(args, input_text=input_text)
        if result.returncode == 0:
            return result
        last_result = result
        if attempt < GH_RETRIES:
            time.sleep(2 ** (attempt - 1))
            continue
    assert last_result is not None
    return last_result


def normalize_text(value: str) -> str:
    value = unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def format_timestamp(value: int | str | None) -> str:
    if not value:
        return ""
    ts = int(value)
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def state_ids(state: dict[str, Any]) -> set[str]:
    return set(state.get("bookmark_ids") or [])


def update_state(
    state: dict[str, Any],
    *,
    bookmark_ids: set[str],
    last_processed_create_time: int | None,
    issue_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    merged_ids = list(dict.fromkeys([*(state.get("bookmark_ids") or []), *sorted(bookmark_ids)]))
    if len(merged_ids) > MAX_STATE_IDS:
        merged_ids = merged_ids[-MAX_STATE_IDS:]

    payload: dict[str, Any] = {
        "bookmark_ids": merged_ids,
        "issue_map": {**state.get("issue_map", {}), **issue_map},
        "updated_at": format_timestamp(int(datetime.now(tz=timezone.utc).timestamp())),
    }
    if last_processed_create_time is not None:
        payload["last_processed_create_time"] = last_processed_create_time
    return payload


def extract_book_title(book: dict[str, Any]) -> str:
    return (
        book.get("title")
        or book.get("book", {}).get("title")
        or book.get("book", {}).get("book", {}).get("title")
        or ""
    )


def extract_book_author(book: dict[str, Any]) -> str:
    return (
        book.get("author")
        or book.get("book", {}).get("author")
        or book.get("book", {}).get("book", {}).get("author")
        or ""
    )


def fetch_notebooks() -> list[dict[str, Any]]:
    books: list[dict[str, Any]] = []
    last_sort: int | None = None

    while True:
        params: dict[str, Any] = {"count": NOTEBOOK_PAGE_SIZE}
        if last_sort is not None:
            params["lastSort"] = last_sort

        data = api_call("/user/notebooks", **params)
        page_books = data.get("books") or []
        books.extend(page_books)

        if not data.get("hasMore") or not page_books:
            break

        last_sort = int(page_books[-1].get("sort") or 0)
        if not last_sort:
            break

    return books


def fetch_book_highlight(book_entry: dict[str, Any]) -> dict[str, Any] | None:
    book_id = str(book_entry.get("bookId") or book_entry.get("book", {}).get("bookId") or "")
    if not book_id:
        return None

    bookmarklist = api_call("/book/bookmarklist", bookId=book_id)
    updated = bookmarklist.get("updated") or []
    if not updated:
        return None

    latest = max(updated, key=lambda item: int(item.get("createTime") or 0))
    chapters = {
        int(chapter.get("chapterUid")): chapter.get("title", "")
        for chapter in (bookmarklist.get("chapters") or [])
        if chapter.get("chapterUid") is not None
    }

    chapter_uid = int(latest.get("chapterUid") or 0)
    range_value = str(latest.get("range") or "")
    range_start, range_end = range_value.split("-", 1) if "-" in range_value else ("", "")
    mark_text = normalize_text(str(latest.get("markText") or ""))
    bookmark_id = str(latest.get("bookmarkId") or "")
    create_time = int(latest.get("createTime") or 0)

    return {
        "book_id": book_id,
        "book_title": extract_book_title(book_entry.get("book") or book_entry),
        "book_author": extract_book_author(book_entry.get("book") or book_entry),
        "bookmark_id": bookmark_id,
        "chapter_uid": chapter_uid,
        "chapter_title": chapters.get(chapter_uid, ""),
        "range": range_value,
        "range_start": range_start,
        "range_end": range_end,
        "mark_text": mark_text,
        "create_time": create_time,
        "create_time_text": format_timestamp(create_time),
        "bookmark_url": (
            "weread://bestbookmark?"
            f"bookId={book_id}"
            f"&chapterUid={chapter_uid}"
            f"&rangeStart={range_start}"
            f"&rangeEnd={range_end}"
        ),
    }


def fetch_recent_highlights(cutoff_time: int) -> list[dict[str, Any]]:
    notebooks = fetch_notebooks()
    if not notebooks:
        return []

    candidates: list[dict[str, Any]] = []
    for book_entry in notebooks:
        note_count = int(book_entry.get("noteCount") or 0)
        if note_count <= 0:
            continue
        book_id = str(book_entry.get("bookId") or book_entry.get("book", {}).get("bookId") or "")
        if not book_id:
            continue

        bookmarklist = api_call("/book/bookmarklist", bookId=book_id)
        updated = bookmarklist.get("updated") or []
        if not updated:
            continue

        chapters = {
            int(chapter.get("chapterUid")): chapter.get("title", "")
            for chapter in (bookmarklist.get("chapters") or [])
            if chapter.get("chapterUid") is not None
        }

        book_title = extract_book_title(book_entry.get("book") or book_entry)
        book_author = extract_book_author(book_entry.get("book") or book_entry)

        for latest in updated:
            create_time = int(latest.get("createTime") or 0)
            if create_time < cutoff_time:
                continue

            chapter_uid = int(latest.get("chapterUid") or 0)
            range_value = str(latest.get("range") or "")
            range_start, range_end = range_value.split("-", 1) if "-" in range_value else ("", "")
            mark_text = normalize_text(str(latest.get("markText") or ""))
            bookmark_id = str(latest.get("bookmarkId") or "")
            if not bookmark_id:
                continue

            candidates.append(
                {
                    "book_id": book_id,
                    "book_title": book_title,
                    "book_author": book_author,
                    "bookmark_id": bookmark_id,
                    "chapter_uid": chapter_uid,
                    "chapter_title": chapters.get(chapter_uid, ""),
                    "range": range_value,
                    "range_start": range_start,
                    "range_end": range_end,
                    "mark_text": mark_text,
                    "create_time": create_time,
                    "create_time_text": format_timestamp(create_time),
                    "bookmark_url": (
                        "weread://bestbookmark?"
                        f"bookId={book_id}"
                        f"&chapterUid={chapter_uid}"
                        f"&rangeStart={range_start}"
                        f"&rangeEnd={range_end}"
                    ),
                }
            )

    return sorted(candidates, key=lambda item: int(item.get("create_time") or 0))


def build_issue_title(highlight: dict[str, Any]) -> str:
    title = highlight["mark_text"]
    if len(title) <= TITLE_MAX_LENGTH:
        return title
    return title[: TITLE_MAX_LENGTH - 3].rstrip() + "..."


def build_issue_body(highlight: dict[str, Any]) -> str:
    lines = [
        f"来源：`{highlight['book_title']}` / {highlight['book_author']}".rstrip(),
        f"抓取时间：{highlight['create_time_text']}",
        f"bookmarkId：`{highlight['bookmark_id']}`",
        f"bookId：`{highlight['book_id']}`",
        f"章节：{highlight['chapter_title'] or highlight['chapter_uid']}",
        f"range：`{highlight['range']}`",
        "",
        "最新划线：",
        "",
        f"> {highlight['mark_text']}",
        "",
        "微信读书跳转：",
        "",
        f"`{highlight['bookmark_url']}`",
    ]
    return "\n".join(lines).strip() + "\n"


def find_existing_issue(repo: str, bookmark_id: str) -> dict[str, Any] | None:
    completed = run_gh_with_retry(
        [
            "issue",
            "list",
            "--repo",
            repo,
            "--state",
            "all",
            "--search",
            f'"{bookmark_id}"',
            "--json",
            "number,title,url,body",
            "--limit",
            "20",
        ]
    )
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"gh issue list 失败: {details}")

    issues = json.loads(completed.stdout or "[]")
    for issue in issues:
        haystack = f"{issue.get('title', '')}\n{issue.get('body', '')}"
        if bookmark_id in haystack:
            return issue
    return None


def issue_exists(repo: str, issue_number: int | None) -> bool:
    if not issue_number:
        return False
    completed = run_gh_with_retry(
        [
            "issue",
            "view",
            str(issue_number),
            "--repo",
            repo,
            "--json",
            "number,url",
        ]
    )
    return completed.returncode == 0


def create_issue(repo: str, title: str, body: str) -> dict[str, Any]:
    completed = run_gh_with_retry(["issue", "create", "--repo", repo, "--title", title, "--body-file", "-"], input_text=body)
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"gh issue create 失败: {details}")
    return {"url": completed.stdout.strip()}


def main() -> None:
    parser = argparse.ArgumentParser(description="把微信读书最新划线创建成 GitHub issue，并先检查是否已写入。")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub 仓库，默认 FeeiCN/FEEI.CN")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要创建的内容，不实际创建 issue")
    parser.add_argument("--lookback-hours", type=int, default=INITIAL_LOOKBACK_HOURS, help="首次运行回看窗口，默认 48 小时")
    parser.add_argument("--overlap-hours", type=int, default=OVERLAP_HOURS, help="每次运行的重叠回看窗口，默认 24 小时")
    args = parser.parse_args()

    state = load_state()
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    last_processed = int(state.get("last_processed_create_time") or 0)
    if last_processed > 0:
        cutoff_time = max(0, last_processed - args.overlap_hours * 3600)
    else:
        cutoff_time = max(0, now_ts - args.lookback_hours * 3600)

    highlights = fetch_recent_highlights(cutoff_time=cutoff_time)
    if not highlights:
        print("没有找到最近窗口内的新划线。")
        return

    processed_ids: set[str] = set()
    latest_seen = last_processed
    issue_map: dict[str, dict[str, Any]] = {}

    for highlight in highlights:
        bookmark_id = highlight["bookmark_id"]
        title = build_issue_title(highlight)
        body = build_issue_body(highlight)
        latest_seen = max(latest_seen, int(highlight.get("create_time") or 0))
        print(f"处理划线: {title}", file=sys.stderr)
        print(f"来源书籍: {highlight['book_title']} / {highlight['book_author']}", file=sys.stderr)
        print(f"bookmarkId: {bookmark_id}", file=sys.stderr)
        print(f"bookId: {highlight['book_id']}", file=sys.stderr)
        print(f"chapterUid: {highlight['chapter_uid']}", file=sys.stderr)
        print(f"range: {highlight['range']}", file=sys.stderr)

        if bookmark_id in state_ids(state):
            state_issue = (state.get("issue_map") or {}).get(bookmark_id, {})
            if issue_exists(args.repo, int(state_issue.get("issue_number") or 0)):
                continue

        existing = find_existing_issue(args.repo, bookmark_id)
        if existing:
            print(f"已存在 issue #{existing['number']}: {existing['url']}")
            issue_map[bookmark_id] = {
                "issue_number": existing["number"],
                "issue_url": existing["url"],
                "title": title,
                "created_at": highlight["create_time_text"],
            }
            processed_ids.add(bookmark_id)
            continue

        if args.dry_run:
            print(body)
            processed_ids.add(bookmark_id)
            continue

        created = create_issue(args.repo, title, body)
        issue_number = None
        issue_url = created["url"]
        match = re.search(r"/issues/(\d+)$", issue_url)
        if match:
            issue_number = int(match.group(1))
        issue_map[bookmark_id] = {
            "issue_number": issue_number,
            "issue_url": issue_url,
            "title": title,
            "created_at": highlight["create_time_text"],
        }
        processed_ids.add(bookmark_id)
        print(created["url"])

    new_state = update_state(
        state,
        bookmark_ids=processed_ids,
        last_processed_create_time=latest_seen if processed_ids else last_processed or None,
        issue_map=issue_map,
    )
    save_state(new_state)

    if args.dry_run:
        print(f"dry-run 完成，共扫描 {len(highlights)} 条，命中 {len(processed_ids)} 条。", file=sys.stderr)


if __name__ == "__main__":
    main()
