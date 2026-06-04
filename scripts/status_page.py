#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
from datetime import datetime
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
STATUS_OUTPUT_TARGET = REPO_ROOT / "docs/05-吴飞飞/01-关于/FEEI.CN状态.md"
DATA_START = "<!-- status-page-data"
DATA_END = "-->"


def format_run_time(run_time):
    if isinstance(run_time, datetime):
        return run_time.strftime("%Y-%m-%d %H:%M:%S")
    if run_time:
        return str(run_time)
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_status_entries():
    if not STATUS_OUTPUT_TARGET.exists():
        return {}

    text = STATUS_OUTPUT_TARGET.read_text(encoding="utf-8")
    start = text.find(DATA_START)
    if start == -1:
        return {}

    start += len(DATA_START)
    end = text.find(DATA_END, start)
    if end == -1:
        return {}

    try:
        return json.loads(text[start:end].strip())
    except json.JSONDecodeError:
        return {}


def render_output_links(outputs):
    links = []
    for output in outputs:
        title = output.get("title", "")
        slug = output.get("slug", "")
        if title and slug:
            links.append(f"[{title}]({slug})")
        elif title:
            links.append(title)
    return "<br />".join(links)


def render_status_page(entries):
    rows = [
        "| 任务 | 运行状态 | 运行时间 | 输出页面 |",
        "| --- | --- | --- | --- |",
    ]

    for entry in sorted(entries.values(), key=lambda item: item.get("name", "")):
        rows.append(
            "| "
            + " | ".join([
                entry.get("name", ""),
                entry.get("status", ""),
                entry.get("run_time", ""),
                render_output_links(entry.get("outputs", [])),
            ])
            + " |"
        )

    data = json.dumps(entries, ensure_ascii=False, indent=2, sort_keys=True)

    return "\n".join([
        "---",
        "slug: /status",
        "title: FEEI.CN状态",
        "icon: simple-checked-icon",
        "---",
        "",
        "## 脚本运行状态",
        "",
        *rows,
        "",
        f"{DATA_START}",
        data,
        f"{DATA_END}",
    ])


def update_status_page(key, name, script, status, run_time=None, outputs=None):
    entries = load_status_entries()
    entries[key] = {
        "name": name,
        "script": script,
        "status": status,
        "run_time": format_run_time(run_time),
        "outputs": outputs or [],
    }

    STATUS_OUTPUT_TARGET.parent.mkdir(parents=True, exist_ok=True)
    STATUS_OUTPUT_TARGET.write_text(render_status_page(entries), encoding="utf-8")
    return STATUS_OUTPUT_TARGET


def parse_output(value):
    title, separator, slug = value.partition("=")
    if not separator:
        raise argparse.ArgumentTypeError("--output 格式应为 标题=slug")
    return {"title": title, "slug": slug}


def build_parser():
    parser = argparse.ArgumentParser(description="更新 FEEI.CN 脚本运行状态页")
    parser.add_argument("--key", required=True, help="状态记录唯一标识")
    parser.add_argument("--name", required=True, help="任务名称")
    parser.add_argument("--script", required=True, help="脚本路径")
    parser.add_argument("--status", default="成功", help="运行状态，默认 成功")
    parser.add_argument("--run-time", default="", help="运行时间，不传则使用当前时间")
    parser.add_argument("--output", action="append", type=parse_output, default=[], help="输出页面，格式为 标题=slug")
    return parser


def main():
    args = build_parser().parse_args()
    update_status_page(
        key=args.key,
        name=args.name,
        script=args.script,
        status=args.status,
        run_time=args.run_time,
        outputs=args.output,
    )


if __name__ == "__main__":
    main()
