#!/usr/bin/env python3
"""通过系统健康 App 导出 Apple 睡眠评分。

默认导出当天。指定 --date 或 --start-date/--end-date 时，从当天开始向右
滑动睡眠评分详情，直到覆盖所需历史日期。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import ios_appium_capture as ios


APPLE_HEALTH_BUNDLE_ID = "com.apple.Health"
SLEEP_SCORE_TILE_ID = "UIA.Health.Sleep.SleepScoreRoom.ScoreTile"
SLEEP_SCORE_SNIPPET_ID = "UIA.Health.Snippet.HKDataTypeAppleSleepScore"
SLEEP_CATEGORY_ID = "UIA.Health.Search.HKDisplayCategoryIdentifierSleep"
SEARCH_TAB_ID = "UIA.Health.Tab.Search"
DEFAULT_OUTPUT_ROOT = Path("static/data/sleep-score")
DATE_LABEL_RE = re.compile(r"^(?P<month>\d{1,2})月(?P<day>\d{1,2})日(?:\s+.*)?$")
SCORE_RE = re.compile(r"睡眠评分\s*(?P<score>\d+)")
COMPONENT_RE = re.compile(
    r"^(?P<name>时长|就寝|中断)：、?(?P<score>\d+)/(?P<maximum>\d+)、?(?P<detail>.+)$"
)


def local_today() -> date:
    return datetime.now().astimezone().date()


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"日期格式应为 YYYY-MM-DD: {value}") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="导出系统健康 App 中的 Apple 睡眠评分")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--date", type=parse_date, help="仅导出指定日期")
    group.add_argument("--start-date", type=parse_date, help="历史导出的起始日期")
    parser.add_argument("--end-date", type=parse_date, help="历史导出的结束日期，默认今天")
    parser.add_argument("--max-days", type=int, default=730, help="历史向右滑动的最大天数，默认 730")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT, help="睡眠评分数据根目录")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已有的有效睡眠评分 JSON")
    parser.add_argument("--appium-url", default=ios.DEFAULT_APPIUM_URL)
    parser.add_argument("--udid", default=os.environ.get("IOS_DEVICE_UDID"), help="iPhone UDID，默认读取 IOS_DEVICE_UDID；未指定时自动识别")
    parser.add_argument("--wait", type=float, default=1.0, help="启动 App 后等待秒数")
    parser.add_argument("--step-wait", type=float, default=0.8, help="页面切换后的等待秒数")
    parser.add_argument("--nav-timeout", type=float, default=15.0, help="等待页面切换秒数")
    parser.add_argument("--new-command-timeout", type=int, default=300)
    parser.add_argument("--device-name")
    parser.add_argument("--platform-version")
    parser.add_argument("--show-xcode-log", action="store_true")
    parser.add_argument("--xcode-org-id", default=os.environ.get("XCODE_ORG_ID"), help="默认读取 XCODE_ORG_ID")
    parser.add_argument("--xcode-signing-id", default="iPhone Developer")
    parser.add_argument("--updated-wda-bundle-id", default=os.environ.get("UPDATED_WDA_BUNDLE_ID"), help="默认读取 UPDATED_WDA_BUNDLE_ID")
    parser.add_argument("--wda-local-port", type=int)
    parser.add_argument("--allow-provisioning-updates", action="store_true")
    parser.add_argument("--allow-provisioning-device-registration", action="store_true")
    args = parser.parse_args()

    today = local_today()
    if args.date:
        args.start_date = args.date
        args.end_date = args.date
    else:
        args.start_date = args.start_date or today
        args.end_date = args.end_date or today
    if args.start_date > args.end_date:
        parser.error("--start-date 不能晚于 --end-date")
    if args.end_date > today:
        parser.error("不能导出未来日期")
    if args.max_days < 1:
        parser.error("--max-days 必须大于 0")
    args.bundle_id = APPLE_HEALTH_BUNDLE_ID
    return args


def extract_visible_rows(page_source: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return []

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for element in root.iter():
        attrs = element.attrib
        if attrs.get("visible") != "true":
            continue
        text = (attrs.get("value") or attrs.get("name") or attrs.get("label") or "").strip()
        if not text:
            continue
        try:
            x = int(float(attrs.get("x", "0")))
            y = int(float(attrs.get("y", "0")))
        except ValueError:
            continue
        key = (text, x, y)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"text": text, "x": x, "y": y, "type": attrs.get("type", "")})
    return rows


def parse_sleep_score_page(page_source: str) -> dict[str, Any] | None:
    rows = [row for row in extract_visible_rows(page_source) if 0 <= row["x"] <= 428]
    date_label = extract_score_date_label(page_source)
    if not date_label:
        return None

    score_row = next(
        (
            row
            for row in rows
            if 150 <= row["y"] <= 270 and SCORE_RE.search(row["text"])
        ),
        None,
    )
    if not score_row:
        return None

    score_match = SCORE_RE.search(score_row["text"])
    if not score_match:
        return None
    components: dict[str, dict[str, Any]] = {}
    for row in rows:
        match = COMPONENT_RE.fullmatch(row["text"])
        if not match:
            continue
        name = match.group("name")
        if name in components:
            continue
        components[name] = {
            "score": int(match.group("score")),
            "maximum": int(match.group("maximum")),
            "detail": match.group("detail"),
        }

    grades = {"非常高", "高", "一般", "低", "非常低"}
    grade = next(
        (row["text"] for row in rows if 160 <= row["y"] <= 260 and row["text"] in grades),
        None,
    )
    return {
        "dateLabel": date_label,
        "score": int(score_match.group("score")),
        "classification": grade,
        "components": components,
    }


def extract_score_date_label(page_source: str) -> str | None:
    for row in extract_visible_rows(page_source):
        if 0 <= row["x"] <= 428 and 90 <= row["y"] <= 145 and DATE_LABEL_RE.fullmatch(row["text"]):
            return row["text"]
    return None


def resolve_score_date(date_label: str, ceiling: date) -> date:
    match = DATE_LABEL_RE.fullmatch(date_label)
    if not match:
        raise RuntimeError(f"无法解析睡眠评分日期: {date_label}")
    candidate = date(ceiling.year, int(match.group("month")), int(match.group("day")))
    if candidate > ceiling:
        candidate = date(ceiling.year - 1, int(match.group("month")), int(match.group("day")))
    return candidate


def tap_accessibility_id(driver: Any, identifier: str) -> bool:
    from appium.webdriver.common.appiumby import AppiumBy

    for element in driver.find_elements(AppiumBy.ACCESSIBILITY_ID, identifier):
        try:
            if element.is_displayed() and element.is_enabled():
                element.click()
                return True
        except Exception:
            continue
    return False


def wait_for_score_detail(driver: Any, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if parse_sleep_score_page(driver.page_source):
            return True
        time.sleep(0.4)
    return False


def open_sleep_score_detail(driver: Any, args: argparse.Namespace) -> None:
    driver.activate_app(APPLE_HEALTH_BUNDLE_ID)
    time.sleep(args.wait)
    # Health restores the previously viewed date. Entering Search first resets
    # the path to the newest sleep-score card, which is required for no-arg runs.
    if tap_accessibility_id(driver, SEARCH_TAB_ID):
        time.sleep(args.step_wait)
    else:
        ios.tap_relative(driver, 0.86, 0.93)
        time.sleep(args.step_wait)

    if not tap_accessibility_id(driver, SLEEP_CATEGORY_ID):
        raise RuntimeError("未找到系统健康 App 的「睡眠」分类")
    time.sleep(args.step_wait)
    if not tap_accessibility_id(driver, SLEEP_SCORE_SNIPPET_ID):
        raise RuntimeError("未找到系统健康 App 的「睡眠评分」卡片")
    time.sleep(args.step_wait)
    if not tap_accessibility_id(driver, SLEEP_SCORE_TILE_ID):
        raise RuntimeError("未找到睡眠评分详情的顶部评分模块")
    if not wait_for_score_detail(driver, args.nav_timeout):
        raise RuntimeError("未能导航到系统健康 App 的睡眠评分详情页")


def wait_for_previous_page(driver: Any, previous_label: str, timeout: float) -> tuple[str, dict[str, Any] | None] | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        page_source = driver.page_source
        date_label = extract_score_date_label(page_source)
        if date_label and date_label != previous_label:
            return date_label, parse_sleep_score_page(page_source)
        time.sleep(0.4)
    return None


def sleep_score_path(output_root: Path, score_date: date) -> Path:
    return output_root / f"{score_date:%Y}" / f"{score_date:%m}" / f"{score_date:%d}.json"


def has_valid_sleep_score(output_path: Path, score_date: date) -> bool:
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return (
        payload.get("date") == score_date.isoformat()
        and payload.get("dataType") == "HKDataTypeAppleSleepScore"
        and isinstance(payload.get("score"), int)
    )


def write_sleep_score(output_root: Path, score_date: date, record: dict[str, Any]) -> Path:
    output_path = sleep_score_path(output_root, score_date)
    payload = {
        "date": score_date.isoformat(),
        "source": "Apple Health",
        "dataType": "HKDataTypeAppleSleepScore",
        "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "score": record["score"],
        "classification": record["classification"],
        "components": {
            "duration": record["components"].get("时长"),
            "bedtime": record["components"].get("就寝"),
            "interruptions": record["components"].get("中断"),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output_path


def collect_sleep_scores(driver: Any, args: argparse.Namespace) -> tuple[list[tuple[date, Path]], list[tuple[date, Path]], list[date]]:
    open_sleep_score_detail(driver, args)
    saved: list[tuple[date, Path]] = []
    skipped: list[tuple[date, Path]] = []
    empty_dates: list[date] = []
    seen_dates: set[date] = set()
    ceiling = local_today()

    for _ in range(args.max_days):
        page_source = driver.page_source
        date_label = extract_score_date_label(page_source)
        if not date_label:
            raise RuntimeError("睡眠评分详情页未识别到日期")
        record = parse_sleep_score_page(page_source)
        score_date = resolve_score_date(date_label, ceiling)
        if score_date in seen_dates:
            break
        seen_dates.add(score_date)
        ceiling = score_date

        if record and args.start_date <= score_date <= args.end_date:
            output_path = sleep_score_path(args.output_root, score_date)
            if not args.overwrite and has_valid_sleep_score(output_path, score_date):
                skipped.append((score_date, output_path))
            else:
                saved.append((score_date, write_sleep_score(args.output_root, score_date, record)))
        elif args.start_date <= score_date <= args.end_date:
            empty_dates.append(score_date)
        if score_date <= args.start_date:
            break

        driver.swipe(105, 260, 360, 260, 500)
        if not wait_for_previous_page(driver, date_label, args.nav_timeout):
            break

    return saved, skipped, empty_dates


def main() -> int:
    args = parse_args()
    udid = ios.detect_udid(args.udid)
    if not udid:
        print("无法自动确定 UDID。请确认只连接一台 iPhone,或传入 --udid。", file=sys.stderr)
        return 2

    driver = ios.create_driver(args, udid)
    collection_error: Exception | None = None
    try:
        saved, skipped, empty_dates = collect_sleep_scores(driver, args)
    except Exception as error:
        collection_error = error

    try:
        print(ios.start_health_auto_export_server(driver, args))
        print(ios.keep_health_auto_export_foreground(driver, args))
    finally:
        driver.quit()

    if collection_error:
        raise collection_error

    if not saved and not skipped:
        print(f"未找到 {args.start_date.isoformat()} 至 {args.end_date.isoformat()} 的睡眠评分", file=sys.stderr)
        return 1
    for score_date, output_path in saved:
        print(f"{score_date.isoformat()}: {output_path}")
    print(f"已保存 {len(saved)} 天睡眠评分")
    if skipped:
        print(f"已跳过 {len(skipped)} 天已有睡眠评分")
    if empty_dates:
        print(f"已跳过 {len(empty_dates)} 天无睡眠评分")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
