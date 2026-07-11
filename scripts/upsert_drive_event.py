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
    r"^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2}:\d{2})\s*(上车|下车)\s*$"
)


def parse_drive_title(title: str) -> tuple[str, str, str, str, str]:
    match = TITLE_PATTERN.fullmatch(title.strip())
    if not match:
        raise ValueError(f"行车 issue 标题缺少 YYYY-MM-DD HH:MM:SS + 上车/下车: {title}")

    year, month, day, time_key, action = match.groups()
    datetime.strptime(f"{year}-{month}-{day} {time_key}", "%Y-%m-%d %H:%M:%S")
    return year, month, day, time_key, action


def normalize_address(address: object) -> str:
    return " ".join(str(address or "").split())


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
        and normalize_address(value.get("address")) == normalize_address(address)
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
    stored_address = address.strip()
    address_key = normalize_address(stored_address)
    data_file = data_root / year / month / f"{day}.json"

    if data_file.is_file():
        data = json.loads(data_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"现有行车 JSON 顶层必须是对象: {data_file}")
    else:
        data = {}

    def write_data() -> None:
        data_file.parent.mkdir(parents=True, exist_ok=True)
        temporary_file = data_file.with_name(f".{data_file.name}.tmp")
        temporary_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary_file.replace(data_file)

    same_slot = [
        (event_key, value)
        for event_key, value in data.items()
        if isinstance(value, dict)
        and event_time(event_key, value) == time_key
        and normalize_address(value.get("address")) == address_key
    ]
    existing_up = next(
        ((event_key, value) for event_key, value in same_slot if value.get("action") == "上车"),
        None,
    )
    existing_down = [
        (event_key, value) for event_key, value in same_slot if value.get("action") == "下车"
    ]

    if existing_up and (action == "下车" or existing_down):
        up_key, up_value = existing_up
        canonical_value = dict(up_value)
        canonical_address = str(up_value.get("address") or "").strip() or stored_address
        canonical_value.update({"time": time_key, "action": "上车", "address": canonical_address})
        if action == "上车" and not canonical_value.get("issue_number"):
            canonical_value["issue_number"] = issue_number
        suppressed_issue_numbers = {
            value
            for value in canonical_value.get("suppressed_issue_numbers") or []
            if isinstance(value, int)
        }
        suppressed_issue_numbers.update(
            value.get("issue_number")
            for _, value in existing_down
            if isinstance(value.get("issue_number"), int)
        )
        if action == "下车":
            suppressed_issue_numbers.add(issue_number)
        if suppressed_issue_numbers:
            canonical_value["suppressed_issue_numbers"] = sorted(suppressed_issue_numbers)
        changed = len(same_slot) > 1 or up_key != time_key or data.get(time_key) != canonical_value
        if changed:
            for event_key, _ in same_slot:
                data.pop(event_key, None)
            data[time_key] = canonical_value
            write_data()
        return {
            "path": data_file.as_posix(),
            "event_key": time_key,
            "action": "上车",
            "status": "ignored_conflicting_down" if action == "下车" else "collapsed_conflicting_pair",
            "changed": changed,
        }

    if action == "上车" and existing_down:
        suppressed_issue_numbers = sorted(
            {
                value.get("issue_number")
                for _, value in existing_down
                if isinstance(value.get("issue_number"), int)
            }
        )
        for event_key, _ in existing_down:
            data.pop(event_key, None)
        data[time_key] = {
            "time": time_key,
            "action": action,
            "address": stored_address,
            "issue_number": issue_number,
        }
        if suppressed_issue_numbers:
            data[time_key]["suppressed_issue_numbers"] = suppressed_issue_numbers
        write_data()
        return {
            "path": data_file.as_posix(),
            "event_key": time_key,
            "action": action,
            "status": "replaced_conflicting_down",
            "changed": True,
        }

    for event_key, value in data.items():
        if event_matches(
            event_key,
            value,
            time_key=time_key,
            action=action,
            address=stored_address,
            issue_number=issue_number,
        ):
            changed = False
            status = "existing"
            if (
                isinstance(value, dict)
                and not value.get("issue_number")
                and event_time(event_key, value) == time_key
                and value.get("action") == action
                and normalize_address(value.get("address")) == address_key
            ):
                value["time"] = time_key
                value["issue_number"] = issue_number
                write_data()
                changed = True
                status = "enriched_existing"
            return {
                "path": data_file.as_posix(),
                "event_key": event_key,
                "action": action,
                "status": status,
                "changed": changed,
            }

    event_key = allocate_event_key(data, time_key, issue_number)
    data[event_key] = {
        "time": time_key,
        "action": action,
        "address": stored_address,
        "issue_number": issue_number,
    }
    write_data()
    return {
        "path": data_file.as_posix(),
        "event_key": event_key,
        "action": action,
        "status": "inserted",
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
    if not args.title or not args.issue_number or args.issue_number < 1:
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
            output.write(f"status={result['status']}\n")
            output.write(f"changed={'yes' if result['changed'] else 'no'}\n")

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with Path(step_summary).open("a", encoding="utf-8") as summary:
            summary.write("### drive JSON reconciled\n\n")
            summary.write(f"- issue: #{args.issue_number}\n")
            summary.write(f"- action: {result['action']}\n")
            summary.write(f"- event key: `{result['event_key']}`\n")
            summary.write(f"- path: `{result['path']}`\n")
            summary.write(f"- status: `{result['status']}`\n")
            summary.write(f"- changed: `{result['changed']}`\n")


if __name__ == "__main__":
    main()
