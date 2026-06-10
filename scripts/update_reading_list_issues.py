#!/usr/bin/env python3
"""重新抓取所有「稍后阅读」issue 的内容并写回 GitHub。

只针对标题以「稍后阅读：」开头的 issue，复用 export_safari_reading_list
里的抓取与渲染逻辑。默认行为：
- 重新生成 ## 来源 / ## 内容，写回 body
- 标题只在当前是「稍后阅读：<URL>」这种纯链接标题时，才替换为新抓到的标题
- 干跑模式：只打印变更，不调用 gh
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from export_safari_reading_list import (
    DEFAULT_GITHUB_REPO,
    build_issue_body,
    build_issue_title,
    fetch_entry_content,
    plain_title,
)


URL_PATTERN = re.compile(r"^- 原文: (https?://\S+)", re.MULTILINE)
TITLE_PREFIX = "稍后阅读："
URL_ONLY_TITLE = re.compile(rf"^{re.escape(TITLE_PREFIX)}https?://")


def run_gh(args: list[str], input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["gh", *args],
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def list_reading_list_issues(repo: str) -> list[dict[str, Any]]:
    completed = run_gh([
        "issue", "list", "--repo", repo,
        "--state", "all", "--limit", "1000",
        "--json", "number,title,body",
    ])
    if completed.returncode != 0:
        raise SystemExit(f"gh issue list 失败: {(completed.stderr or completed.stdout).strip()}")

    issues = json.loads(completed.stdout or "[]")
    reading_list = []
    for issue in issues:
        title = issue.get("title") or ""
        body = issue.get("body") or ""
        if not title.startswith(TITLE_PREFIX):
            continue
        if "## 来源" not in body:
            continue
        match = URL_PATTERN.search(body)
        if not match:
            continue
        reading_list.append({
            "number": issue["number"],
            "title": title,
            "body": body,
            "url": match.group(1).strip(),
        })
    reading_list.sort(key=lambda issue: issue["number"])
    return reading_list


def should_replace_title(current_title: str, new_title: str) -> bool:
    """只有当前标题是「稍后阅读：<URL>」这种无信息标题时才替换。"""
    if not current_title.startswith(TITLE_PREFIX):
        return False
    if not URL_ONLY_TITLE.match(current_title):
        return False
    return new_title != current_title


def process_issue(issue: dict[str, Any], timeout: float) -> dict[str, Any]:
    body_match = re.search(r"^- 添加时间: (.+)$", issue["body"], re.MULTILINE)
    preview_match = re.search(r"^- Safari 摘要: (.+)$", issue["body"], re.MULTILINE)
    status_match = re.search(r"^- 状态: (.+)$", issue["body"], re.MULTILINE)
    fallback_title = issue["title"]
    if fallback_title.startswith(TITLE_PREFIX):
        fallback_title = fallback_title[len(TITLE_PREFIX):]

    entry: dict[str, Any] = {
        "url": issue["url"],
        "title": fallback_title,
        "added_at": body_match.group(1).strip() if body_match else "",
        "preview": preview_match.group(1).strip() if preview_match else "",
        "unread": bool(status_match and "未读" in status_match.group(1)),
    }

    try:
        entry = fetch_entry_content(entry, timeout=timeout)
        new_body = build_issue_body(entry)
        new_title_raw = build_issue_title(entry)
        new_title = new_title_raw if should_replace_title(issue["title"], new_title_raw) else issue["title"]
    except Exception as error:
        return {
            "number": issue["number"],
            "url": issue["url"],
            "status": "fetch-error",
            "error": f"{type(error).__name__}: {error}",
        }

    old_body = issue["body"]
    body_changed = new_body.strip() != old_body.strip()
    title_changed = new_title != issue["title"]
    return {
        "number": issue["number"],
        "url": issue["url"],
        "old_title": issue["title"],
        "new_title": new_title,
        "old_body_len": len(old_body),
        "new_body_len": len(new_body),
        "body_changed": body_changed,
        "title_changed": title_changed,
        "new_body": new_body,
    }


def apply_update(plan: dict[str, Any], repo: str) -> tuple[bool, str]:
    args = ["issue", "edit", str(plan["number"]), "--repo", repo, "--body-file", "-"]
    completed = run_gh(args, input_text=plan["new_body"])
    if completed.returncode != 0:
        return False, (completed.stderr or completed.stdout).strip()
    if plan["title_changed"]:
        title_args = ["issue", "edit", str(plan["number"]), "--repo", repo, "--title", plan["new_title"]]
        title_completed = run_gh(title_args)
        if title_completed.returncode != 0:
            return False, f"body OK but title failed: {(title_completed.stderr or title_completed.stdout).strip()}"
    return True, ""


def main() -> None:
    parser = argparse.ArgumentParser(description="重新抓取并更新所有「稍后阅读」issue")
    parser.add_argument("--repo", default=DEFAULT_GITHUB_REPO, help=f"目标仓库，默认 {DEFAULT_GITHUB_REPO}")
    parser.add_argument("--timeout", type=float, default=20, help="单个 URL 抓取超时时间（秒），默认 20")
    parser.add_argument("--concurrency", type=int, default=4, help="并发抓取数，默认 4")
    parser.add_argument("--dry-run", action="store_true", help="只预览变更，不调用 gh")
    parser.add_argument("--filter", type=str, default=None, help="只更新标题/URL 含该子串的 issue")
    args = parser.parse_args()

    issues = list_reading_list_issues(args.repo)
    if args.filter:
        issues = [i for i in issues if args.filter in i["title"] or args.filter in i["url"]]
    print(f"共 {len(issues)} 个稍后阅读 issue 命中", file=sys.stderr)

    if args.concurrency > 1 and len(issues) > 1:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            plans = list(pool.map(
                lambda issue: process_issue(issue, timeout=args.timeout),
                issues,
            ))
    else:
        plans = [process_issue(issue, timeout=args.timeout) for issue in issues]

    updates = [p for p in plans if p.get("body_changed") or p.get("title_changed")]
    fetch_errors = [p for p in plans if p.get("status") == "fetch-error"]
    unchanged = [p for p in plans if not p.get("body_changed") and not p.get("title_changed") and p.get("status") != "fetch-error"]

    print(f"  - 抓取失败: {len(fetch_errors)}", file=sys.stderr)
    print(f"  - 无变化:   {len(unchanged)}", file=sys.stderr)
    print(f"  - 待更新:   {len(updates)}", file=sys.stderr)

    if not updates:
        return

    print()
    print(f"{'#':<6} {'title change':<10} {'body delta':<14} url")
    for plan in updates:
        body_delta = plan["new_body_len"] - plan["old_body_len"]
        body_delta_str = f"{body_delta:+d} ({plan['old_body_len']}->{plan['new_body_len']})"
        title_change = "yes" if plan.get("title_changed") else "no"
        title_str = f"{plan['old_title']} -> {plan['new_title']}" if plan.get("title_changed") else "(no)"
        print(f"#{plan['number']:<5} {title_change:<10} {body_delta_str:<14} {plan['url']}")
        if plan.get("title_changed"):
            print(f"        title: {title_str}")

    if args.dry_run:
        print()
        print("--dry-run：未调用 gh", file=sys.stderr)
        return

    print()
    print("开始写入 ...", file=sys.stderr)
    success = 0
    failures: list[tuple[int, str, str]] = []
    for plan in updates:
        ok, err = apply_update(plan, args.repo)
        if ok:
            success += 1
            print(f"  ✓ #{plan['number']}", file=sys.stderr)
        else:
            failures.append((plan["number"], plan["url"], err))
            print(f"  ✗ #{plan['number']}: {err}", file=sys.stderr)

    print()
    print(f"成功: {success} / 失败: {len(failures)} / 抓取失败: {len(fetch_errors)} / 无变化: {len(unchanged)}")
    if failures:
        for number, url, err in failures:
            print(f"  #{number} {url}: {err}")


if __name__ == "__main__":
    main()
