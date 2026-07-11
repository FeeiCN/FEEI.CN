#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any


TITLE_PATTERN = re.compile(
    r"(?<!\d)(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2}:\d{2}).*?(上车|下车)"
)


def parse_drive_title(title: str) -> tuple[str, str, str, str, str]:
    match = TITLE_PATTERN.search(title)
    if not match:
        raise ValueError(f"行车 issue 标题缺少 YYYY-MM-DD HH:MM:SS + 上车/下车: {title}")

    year, month, day, time_key, action = match.groups()
    datetime.strptime(f"{year}-{month}-{day} {time_key}", "%Y-%m-%d %H:%M:%S")
    return year, month, day, time_key, action


def event_time(event_key: str, value: dict[str, Any]) -> str:
    value_time = value.get("time")
    if isinstance(value_time, str) and value_time:
        return value_time
    return event_key.split("#", 1)[0]


def event_matches(
    event_key: str,
    value: object,
    *,
    time_key: str,
    action: str,
    address: str,
    issue_number: int,
) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get("issue_number") == issue_number:
        return True
    return (
        event_time(event_key, value) == time_key
        and value.get("action") == action
        and str(value.get("address") or "").strip() == address
    )


def allocate_event_key(data: dict[str, Any], time_key: str, issue_number: int) -> str:
    if time_key not in data:
        return time_key

    candidate = f"{time_key}#{issue_number}"
    suffix = 2
    while candidate in data:
        candidate = f"{time_key}#{issue_number}-{suffix}"
        suffix += 1
    return candidate


def upsert_drive_event(
    *,
    data_root: Path,
    title: str,
    address: str,
    issue_number: int,
) -> dict[str, Any]:
    year, month, day, time_key, action = parse_drive_title(title)
    normalized_address = address.strip()
    data_file = data_root / year / month / f"{day}.json"

    if data_file.is_file():
        data = json.loads(data_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"现有行车 JSON 顶层必须是对象: {data_file}")
    else:
        data = {}

    for event_key, value in data.items():
        if event_matches(
            event_key,
            value,
            time_key=time_key,
            action=action,
            address=normalized_address,
            issue_number=issue_number,
        ):
            return {
                "path": data_file.as_posix(),
                "event_key": event_key,
                "action": action,
                "changed": False,
            }

    event_key = allocate_event_key(data, time_key, issue_number)
    data[event_key] = {
        "time": time_key,
        "action": action,
        "address": normalized_address,
        "issue_number": issue_number,
    }
    data_file.parent.mkdir(parents=True, exist_ok=True)
    data_file.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "path": data_file.as_posix(),
        "event_key": event_key,
        "action": action,
        "changed": True,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Insert one drive issue into the daily drive JSON.")
    parser.add_argument("--title", default=os.environ.get("ISSUE_TITLE"))
    parser.add_argument("--address", default=os.environ.get("ISSUE_BODY", ""))
    parser.add_argument("--issue-number", default=os.environ.get("ISSUE_NUMBER"), type=int)
    parser.add_argument("--data-root", default="static/data/drive", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.title or not args.issue_number:
        raise SystemExit("必须提供 issue 标题和编号")

    result = upsert_drive_event(
        data_root=args.data_root,
        title=args.title,
        address=args.address,
        issue_number=args.issue_number,
    )
    print(json.dumps(result, ensure_ascii=False))

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as output:
            output.write(f"path={result['path']}\n")
            output.write(f"event_key={result['event_key']}\n")
            output.write(f"changed={'yes' if result['changed'] else 'no'}\n")

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with Path(step_summary).open("a", encoding="utf-8") as summary:
            summary.write("### drive JSON reconciled\n\n")
            summary.write(f"- issue: #{args.issue_number}\n")
            summary.write(f"- action: {result['action']}\n")
            summary.write(f"- event key: `{result['event_key']}`\n")
            summary.write(f"- path: `{result['path']}`\n")
            summary.write(f"- changed: `{result['changed']}`\n")


if __name__ == "__main__":
    main()
