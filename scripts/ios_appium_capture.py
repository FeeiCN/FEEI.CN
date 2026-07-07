#!/usr/bin/env python3
"""用 Appium/XCUITest 连接 iPhone,导出当前页面信息与截图。

依赖需要在本机单独安装:
  brew install libimobiledevice ios-deploy
  npm install -g appium
  appium driver install xcuitest
  python3 -m pip install Appium-Python-Client

示例:
  appium
  python3 scripts/ios_appium_capture.py --bundle-id com.apple.mobilesafari
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


DEFAULT_APPIUM_URL = "http://127.0.0.1:4723"
DEFAULT_BUNDLE_ID = "com.apple.mobilesafari"
DEFAULT_OUT_DIR = Path("/tmp/ios-appium-capture")
ALIPAY_BUNDLE_ID = "com.alipay.iphoneclient"
ALIPAY_OUT_DIR = Path("/tmp/alipay-assets-capture")
HEALTH_AUTO_EXPORT_BUNDLE_ID = "com.ifunography.HealthExport"
CAITONG_BUNDLE_ID = "com.ctzq.ths.iphone"
CAITONG_OUT_DIR = Path("/tmp/caitong-assets-capture")
CAITONG_TRADE_PASSWORD_ENV = "CAITONG_TRADE_PASSWORD"
DEFAULT_INVEST_OUTPUT_ROOT = Path("static/data/invest")


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def run_command(args: list[str], timeout: float = 10) -> tuple[int, str, str]:
    try:
        result = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return 127, "", f"{args[0]} not found"
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout or ""
        stderr = error.stderr or ""
        return 124, stdout, stderr or f"{args[0]} timed out"
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def list_udids() -> list[str]:
    code, stdout, _ = run_command(["idevice_id", "-l"])
    if code != 0:
        return []
    return [line.strip() for line in stdout.splitlines() if line.strip()]


def detect_udid(explicit_udid: str | None) -> str | None:
    if explicit_udid:
        return explicit_udid
    udids = list_udids()
    if len(udids) == 1:
        return udids[0]
    return None


def check_environment() -> int:
    checks: list[dict[str, Any]] = []

    for command, version_args in (
        ("xcodebuild", ["xcodebuild", "-version"]),
        ("idevice_id", ["idevice_id", "-l"]),
        ("ios-deploy", ["ios-deploy", "--version"]),
        ("appium", ["appium", "--version"]),
    ):
        code, stdout, stderr = run_command(version_args)
        checks.append(
            {
                "name": command,
                "ok": command_exists(command) and code == 0,
                "detail": stdout or stderr,
            }
        )

    checks.append(
        {
            "name": "Appium-Python-Client",
            "ok": importlib.util.find_spec("appium") is not None,
            "detail": "python import appium",
        }
    )

    for item in checks:
        status = "OK" if item["ok"] else "MISSING"
        detail = item["detail"].splitlines()[0] if item["detail"] else ""
        print(f"{status:7} {item['name']}{': ' + detail if detail else ''}")

    devices = list_udids()
    if devices:
        print("\n已连接设备:")
        for udid in devices:
            print(f"- {udid}")
    else:
        print("\n未通过 idevice_id 发现已信任的 iPhone")

    return 0 if all(item["ok"] for item in checks) and devices else 1


def timestamp() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def predicate_literal(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def visible_elements(elements: list[Any]) -> list[Any]:
    result = []
    for element in elements:
        try:
            if element.is_displayed() and element.is_enabled():
                result.append(element)
        except Exception:
            continue
    return result


def find_by_text(driver: Any, text: str, contains: bool = False) -> list[Any]:
    from appium.webdriver.common.appiumby import AppiumBy

    if not contains:
        exact = visible_elements(driver.find_elements(AppiumBy.ACCESSIBILITY_ID, text))
        if exact:
            return exact

    op = "CONTAINS[c]" if contains else "=="
    literal = predicate_literal(text)
    predicate = (
        f"name {op} {literal} OR label {op} {literal} OR value {op} {literal}"
    )
    return visible_elements(driver.find_elements(AppiumBy.IOS_PREDICATE, predicate))


def wait_for_any_text(
    driver: Any,
    candidates: list[str],
    timeout: float,
    contains: bool = False,
) -> tuple[str, Any] | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for text in candidates:
            elements = find_by_text(driver, text, contains=contains)
            if elements:
                return text, elements[0]
        time.sleep(0.5)
    return None


def tap_any_text(
    driver: Any,
    candidates: list[str],
    timeout: float,
    contains: bool = False,
) -> str | None:
    match = wait_for_any_text(driver, candidates, timeout, contains=contains)
    if not match:
        return None
    text, element = match
    element.click()
    return text


def source_contains_any(driver: Any, candidates: list[str]) -> bool:
    source = driver.page_source
    return any(text in source for text in candidates)


def source_has_text_near_top(driver: Any, text: str, max_y: int = 140) -> bool:
    try:
        root = ElementTree.fromstring(driver.page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return False
    for element in root.iter():
        attrs = element.attrib
        if text not in (attrs.get("name", ""), attrs.get("label", ""), attrs.get("value", "")):
            continue
        try:
            if int(float(attrs.get("y", "9999"))) <= max_y:
                return True
        except ValueError:
            continue
    return False


def visible_text_rects(driver: Any, contains_text: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(driver.page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return []
    rects: list[dict[str, Any]] = []
    for element in root.iter():
        attrs = element.attrib
        text_values = [attrs.get("name", ""), attrs.get("label", ""), attrs.get("value", "")]
        if not any(contains_text in value for value in text_values):
            continue
        if attrs.get("visible") != "true":
            continue
        try:
            rects.append(
                {
                    "text": next(value for value in text_values if contains_text in value),
                    "x": int(float(attrs.get("x", "0"))),
                    "y": int(float(attrs.get("y", "0"))),
                    "width": int(float(attrs.get("width", "0"))),
                    "height": int(float(attrs.get("height", "0"))),
                }
            )
        except (ValueError, StopIteration):
            continue
    return rects


def visible_element_rects(
    driver: Any,
    text: str,
    *,
    element_type: str | None = None,
    contains: bool = False,
) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(driver.page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return []
    rects: list[dict[str, Any]] = []
    for element in root.iter():
        attrs = element.attrib
        if attrs.get("visible") != "true":
            continue
        if element_type and attrs.get("type") != element_type:
            continue
        text_values = [attrs.get("name", ""), attrs.get("label", ""), attrs.get("value", "")]
        matched = next(
            (
                value
                for value in text_values
                if value and ((text in value) if contains else (text == value))
            ),
            None,
        )
        if not matched:
            continue
        try:
            rects.append(
                {
                    "text": matched,
                    "type": attrs.get("type"),
                    "x": int(float(attrs.get("x", "0"))),
                    "y": int(float(attrs.get("y", "0"))),
                    "width": int(float(attrs.get("width", "0"))),
                    "height": int(float(attrs.get("height", "0"))),
                }
            )
        except ValueError:
            continue
    return rects


def tap_relative(driver: Any, x_ratio: float, y_ratio: float) -> tuple[int, int]:
    size = driver.get_window_size()
    x = int(size.get("width", 390) * x_ratio)
    y = int(size.get("height", 844) * y_ratio)
    try:
        driver.execute_script("mobile: tap", {"x": x, "y": y})
    except Exception:
        driver.tap([(x, y)], 100)
    return x, y


def tap_point(driver: Any, x: int, y: int) -> tuple[int, int]:
    try:
        driver.execute_script("mobile: tap", {"x": x, "y": y})
    except Exception:
        driver.tap([(x, y)], 100)
    return x, y


def tap_digit_text(driver: Any, digit: str, timeout: float = 1.5) -> bool:
    from appium.webdriver.common.appiumby import AppiumBy

    deadline = time.monotonic() + timeout
    height = int(driver.get_window_size().get("height", 844))
    while time.monotonic() < deadline:
        elements = visible_elements(driver.find_elements(AppiumBy.ACCESSIBILITY_ID, digit))
        for element in elements:
            try:
                rect = element.rect
                if int(rect.get("y", 0)) < int(height * 0.55):
                    continue
                element.click()
                return True
            except Exception:
                continue
        time.sleep(0.15)
    return False


def tap_numeric_keypad(driver: Any, text: str) -> list[dict[str, Any]]:
    size = driver.get_window_size()
    width = int(size.get("width", 390))
    height = int(size.get("height", 844))
    fallback_positions = {
        "1": (0.125, 0.759),
        "2": (0.374, 0.759),
        "3": (0.624, 0.759),
        "4": (0.125, 0.817),
        "5": (0.374, 0.817),
        "6": (0.624, 0.817),
        "7": (0.125, 0.876),
        "8": (0.374, 0.876),
        "9": (0.624, 0.876),
        "0": (0.374, 0.934),
    }
    actions: list[dict[str, Any]] = []
    for index, char in enumerate(text, start=1):
        if not char.isdigit():
            continue
        if tap_digit_text(driver, char):
            actions.append({"index": index, "method": "text"})
        else:
            x_ratio, y_ratio = fallback_positions[char]
            x = int(width * x_ratio)
            y = int(height * y_ratio)
            try:
                driver.execute_script("mobile: tap", {"x": x, "y": y})
            except Exception:
                driver.tap([(x, y)], 100)
            actions.append({"index": index, "method": "coordinate", "x": x, "y": y})
        time.sleep(0.15)
    return actions


def numeric_keypad_visible(driver: Any) -> bool:
    source = driver.page_source
    if source_contains_any(driver, ["删除", "完成", "收起键盘", "密码", "交易密码"]):
        return True
    try:
        rows = collect_visible_texts(source)
    except ElementTree.ParseError:
        return False
    height = int(driver.get_window_size().get("height", 844))
    digits = {
        row["text"]
        for row in rows
        if row["text"].isdigit()
        and len(row["text"]) == 1
        and row["y"] >= int(height * 0.55)
    }
    return len(digits) >= 6


def dismiss_optional_overlays(driver: Any) -> list[str]:
    dismissed = []
    for _ in range(3):
        tapped = tap_any_text(
            driver,
            ["关闭", "跳过", "以后再说", "稍后再说", "我知道了", "知道了", "取消"],
            timeout=1,
        )
        if not tapped:
            break
        dismissed.append(tapped)
        time.sleep(0.8)
    return dismissed


def create_driver(args: argparse.Namespace, udid: str):
    if importlib.util.find_spec("appium") is None:
        raise RuntimeError("缺少 Appium-Python-Client,请先执行: python3 -m pip install Appium-Python-Client")

    from appium import webdriver
    from appium.options.ios import XCUITestOptions

    options = XCUITestOptions()
    options.platform_name = "iOS"
    options.automation_name = "XCUITest"
    options.udid = udid
    options.bundle_id = args.bundle_id
    options.set_capability("noReset", True)
    options.set_capability("newCommandTimeout", args.new_command_timeout)
    if args.device_name:
        options.device_name = args.device_name
    if args.platform_version:
        options.platform_version = args.platform_version
    if args.show_xcode_log:
        options.set_capability("showXcodeLog", True)
    if args.xcode_org_id:
        options.set_capability("xcodeOrgId", args.xcode_org_id)
    if args.xcode_signing_id:
        options.set_capability("xcodeSigningId", args.xcode_signing_id)
    if args.updated_wda_bundle_id:
        options.set_capability("updatedWDABundleId", args.updated_wda_bundle_id)
    if args.wda_local_port:
        options.set_capability("wdaLocalPort", args.wda_local_port)
    if args.allow_provisioning_updates:
        options.set_capability("allowProvisioningUpdates", True)
    if args.allow_provisioning_device_registration:
        options.set_capability("allowProvisioningDeviceRegistration", True)

    return webdriver.Remote(args.appium_url, options=options)


def terminate_app_safely(driver: Any, bundle_id: str, label: str) -> bool:
    try:
        if driver.query_app_state(bundle_id) <= 1:
            return True
        driver.terminate_app(bundle_id)
    except Exception as error:
        print(f"{label}关闭失败: {error}", file=sys.stderr, flush=True)
        return False
    print(f"{label}已关闭", flush=True)
    return True


def restart_app(driver: Any, bundle_id: str, label: str, wait_seconds: float) -> None:
    terminate_app_safely(driver, bundle_id, label)
    driver.activate_app(bundle_id)
    time.sleep(wait_seconds)


def capture_artifacts(
    driver: Any,
    out_dir: Path,
    session_id: str,
    name: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, str]:
    page_source = driver.page_source
    screenshot_path = out_dir / f"{session_id}-{name}.png"
    source_path = out_dir / f"{session_id}-{name}.xml"
    metadata_path = out_dir / f"{session_id}-{name}.json"

    source_path.write_text(page_source, encoding="utf-8")
    driver.get_screenshot_as_file(str(screenshot_path))
    write_json(
        metadata_path,
        {
            "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "files": {
                "pageSource": str(source_path),
                "screenshot": str(screenshot_path),
            },
            **(metadata or {}),
        },
    )

    return {
        "pageSource": str(source_path),
        "screenshot": str(screenshot_path),
        "metadata": str(metadata_path),
    }


def source_has_alipay_total_asset_content(page_source: str) -> bool:
    return any(
        text in page_source
        for text in (
            "总资产：",
            "我的资产",
            "昨日收益",
            "今日收益",
            "三笔钱分布",
            "理财资产",
            "余额宝",
        )
    )


def capture_alipay_total_asset_artifacts(
    driver: Any,
    out_dir: Path,
    session_id: str,
) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    intervals = [0.0, 0.2, 0.3, 0.5, 0.8, 1.2]
    for index, interval in enumerate(intervals, start=1):
        if interval:
            time.sleep(interval)
        file_info = capture_artifacts(
            driver,
            out_dir,
            session_id,
            f"total-assets-{index:02d}",
            {"step": "totalAssets", "sample": index},
        )
        files.append(file_info)
        page_source = Path(file_info["pageSource"]).read_text(encoding="utf-8")
        daily_profit = extract_alipay_daily_profit_from_source(page_source)
        if daily_profit and daily_profit.get("name") == "昨日收益":
            break
        if source_has_alipay_total_asset_content(page_source) and index >= 3:
            break
    return files


def page_signature(page_source: str) -> str:
    try:
        root = ElementTree.fromstring(page_source.encode("utf-8"))
        values = []
        for element in root.iter():
            attrs = element.attrib
            text_attrs = [
                attrs.get("type", ""),
                attrs.get("name", ""),
                attrs.get("label", ""),
                attrs.get("value", ""),
                attrs.get("visible", ""),
                attrs.get("x", ""),
                attrs.get("y", ""),
                attrs.get("width", ""),
                attrs.get("height", ""),
            ]
            if any(text_attrs[1:4]):
                values.append("|".join(text_attrs))
        normalized = "\n".join(values)
    except ElementTree.ParseError:
        normalized = re.sub(r"\s+", " ", page_source)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def parse_amount(value: str) -> float | None:
    cleaned = value.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None
    return float(match.group(0))


def extract_asset_records_from_source(page_source: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    patterns = [
        re.compile(
            r"(?P<name>[^：，]+)：(?P<amount>[-\d,.]+)元，昨日收益：(?P<profit>[-\d,.]+)元"
        ),
        re.compile(r"(?P<name>总资产)：(?P<amount>[-\d,.]+)元"),
    ]

    try:
        root = ElementTree.fromstring(page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return records

    for element in root.iter():
        attrs = element.attrib
        candidates = [attrs.get("name", ""), attrs.get("label", ""), attrs.get("value", "")]
        for candidate in candidates:
            if not candidate:
                continue
            for pattern in patterns:
                match = pattern.search(candidate)
                if not match:
                    continue
                name = match.group("name").strip()
                amount_text = match.group("amount")
                key = (name, amount_text)
                if key in seen:
                    continue
                seen.add(key)
                record: dict[str, Any] = {
                    "name": name,
                    "amountText": amount_text,
                    "amount": parse_amount(amount_text),
                    "raw": candidate,
                    "frame": {
                        "x": attrs.get("x"),
                        "y": attrs.get("y"),
                        "width": attrs.get("width"),
                        "height": attrs.get("height"),
                    },
                }
                if "profit" in match.groupdict():
                    profit_text = match.group("profit")
                    record["yesterdayProfitText"] = profit_text
                    record["yesterdayProfit"] = parse_amount(profit_text)
                records.append(record)
    return records


def extract_asset_records(files: list[dict[str, str]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for file_info in files:
        source_path = file_info.get("pageSource")
        if not source_path:
            continue
        path = Path(source_path)
        if not path.exists():
            continue
        for record in extract_asset_records_from_source(path.read_text(encoding="utf-8")):
            key = (record.get("name", ""), record.get("amountText", ""))
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
    return records


def parse_signed_percent(value: str) -> float | None:
    amount = parse_amount(value)
    return amount


def is_amount_text(value: str) -> bool:
    return bool(re.fullmatch(r"[+-]?\d[\d,]*(?:\.\d+)?", value.strip()))


def extract_static_text_rows(page_source: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return []

    rows: list[dict[str, Any]] = []
    for element in root.iter():
        attrs = element.attrib
        if attrs.get("type") != "XCUIElementTypeStaticText":
            continue
        text = attrs.get("value") or attrs.get("name") or attrs.get("label") or ""
        text = text.strip()
        if not text:
            continue
        try:
            x = int(float(attrs.get("x", "0")))
            y = int(float(attrs.get("y", "0")))
            width = int(float(attrs.get("width", "0")))
            height = int(float(attrs.get("height", "0")))
        except ValueError:
            continue
        rows.append(
            {
                "text": text,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "visible": attrs.get("visible") == "true",
            }
        )
    return rows


def extract_text_rows(page_source: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(page_source.encode("utf-8"))
    except ElementTree.ParseError:
        return []

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for element in root.iter():
        attrs = element.attrib
        text = attrs.get("value") or attrs.get("name") or attrs.get("label") or ""
        text = text.strip()
        if not text:
            continue
        try:
            x = int(float(attrs.get("x", "0")))
            y = int(float(attrs.get("y", "0")))
            width = int(float(attrs.get("width", "0")))
            height = int(float(attrs.get("height", "0")))
        except ValueError:
            continue
        key = (text, x, y)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "text": text,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "visible": attrs.get("visible") == "true",
                "type": attrs.get("type", ""),
            }
        )
    return rows


def looks_like_holding_name(text: str) -> bool:
    ignored = {
        "全部持有",
        "收益明细",
        "交易记录",
        "全部保单",
        "总金额 (元)",
        "查看资产详情",
        "清仓分析",
        "收益地图",
        "基金定投",
        "专项计划",
        "全部",
        "持有收益排序",
        "名称/金额",
        "日收益",
        "持有收益",
        "累计收益",
        "占比",
        "以上按照持有收益排序",
        "基金",
        "帮你投",
        "养老金",
        "定活理财",
        "灵活取用",
        "进阶理财",
        "稳健理财",
        "投顾",
        "定投",
        "我的保单",
        "未来保障",
        "保障期限：",
        "被保险人：",
        "已保障",
        "查看我的免费保单",
    }
    if text in ignored or text == "%":
        return False
    if is_amount_text(text):
        return False
    if re.fullmatch(r"\d+\s*份?", text):
        return False
    if text.startswith("你有") or text.startswith("你近期") or text.startswith("图为"):
        return False
    if text.startswith("本页面非") or text.startswith("该页面由"):
        return False
    if text.endswith("个月正收益") or text.startswith("买入以来"):
        return False
    return True


def combine_percent(rows: list[dict[str, Any]], value_row: dict[str, Any]) -> str | None:
    x = value_row["x"]
    y = value_row["y"]
    has_percent_mark = any(
        row["text"] == "%"
        and abs(row["y"] - y) <= 3
        and 10 <= row["x"] - x <= 45
        for row in rows
    )
    if not has_percent_mark:
        return None
    return f"{value_row['text']}%"


def extract_holding_records_from_source(page_source: str) -> list[dict[str, Any]]:
    rows = [
        row
        for row in extract_static_text_rows(page_source)
        if row["visible"] and -80 <= row["y"] <= 980
    ]
    rows.sort(key=lambda row: (row["y"], row["x"]))
    records: list[dict[str, Any]] = []

    for row in rows:
        text = row["text"]
        if not (20 <= row["x"] <= 45 and 60 <= row["y"] <= 940):
            continue
        if not looks_like_holding_name(text):
            continue

        amount_rows = [
            item
            for item in rows
            if row["y"] + 38 <= item["y"] <= row["y"] + 68
            and is_amount_text(item["text"])
        ]
        first_col_amounts = [item for item in amount_rows if 20 <= item["x"] <= 110]
        if not first_col_amounts:
            continue

        tag_rows = [
            item["text"]
            for item in rows
            if row["y"] + 18 <= item["y"] <= row["y"] + 36
            and item["x"] >= 25
            and looks_like_holding_name(item["text"])
            and not is_amount_text(item["text"])
        ]
        amount_row = min(first_col_amounts, key=lambda item: item["x"])

        def find_amount(min_x: int, max_x: int) -> dict[str, Any] | None:
            candidates = [item for item in amount_rows if min_x <= item["x"] <= max_x]
            if not candidates:
                return None
            return min(candidates, key=lambda item: item["x"])

        day_profit = find_amount(130, 220)
        holding_profit = find_amount(220, 320)
        cumulative_profit = find_amount(320, 410)

        percent_rows = [
            item
            for item in rows
            if row["y"] + 62 <= item["y"] <= row["y"] + 96
            and is_amount_text(item["text"])
        ]
        asset_ratio = None
        holding_return_rate = None
        for item in percent_rows:
            percent_text = combine_percent(rows, item)
            if not percent_text:
                continue
            if 45 <= item["x"] <= 110 and asset_ratio is None:
                asset_ratio = percent_text
            elif 240 <= item["x"] <= 315 and holding_return_rate is None:
                holding_return_rate = percent_text

        record: dict[str, Any] = {
            "name": text,
            "tags": tag_rows,
            "amountText": amount_row["text"],
            "amount": parse_amount(amount_row["text"]),
            "frame": {
                "x": row["x"],
                "y": row["y"],
                "width": row["width"],
                "height": row["height"],
            },
        }
        if day_profit:
            record["dayProfitText"] = day_profit["text"]
            record["dayProfit"] = parse_amount(day_profit["text"])
        if holding_profit:
            record["holdingProfitText"] = holding_profit["text"]
            record["holdingProfit"] = parse_amount(holding_profit["text"])
        if cumulative_profit:
            record["cumulativeProfitText"] = cumulative_profit["text"]
            record["cumulativeProfit"] = parse_amount(cumulative_profit["text"])
        if asset_ratio:
            record["assetRatioText"] = asset_ratio
            record["assetRatio"] = parse_signed_percent(asset_ratio)
        if holding_return_rate:
            record["holdingReturnRateText"] = holding_return_rate
            record["holdingReturnRate"] = parse_signed_percent(holding_return_rate)
        records.append(record)

    return records


def extract_holding_records(files: list[dict[str, str]]) -> list[dict[str, Any]]:
    records_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for file_info in files:
        source_path = file_info.get("pageSource")
        if not source_path:
            continue
        path = Path(source_path)
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        if "全部持有" not in source:
            continue
        for record in extract_holding_records_from_source(source):
            key = (record.get("name", ""), record.get("amountText", ""))
            existing = records_by_key.get(key)
            if not existing:
                records_by_key[key] = record
                continue
            for field, value in record.items():
                if field == "tags":
                    existing_tags = existing.setdefault("tags", [])
                    for tag in value:
                        if tag not in existing_tags:
                            existing_tags.append(tag)
                elif field not in existing or existing[field] in (None, "", []):
                    existing[field] = value
    return list(records_by_key.values())


def extract_alipay_daily_profit_from_source(page_source: str) -> dict[str, Any] | None:
    rows = [
        row
        for row in extract_text_rows(page_source)
        if row["text"]
    ]
    label_rows = [
        row
        for row in rows
        if any(label in row["text"] for label in ("昨日收益", "今日收益"))
    ]
    for label_row in sorted(
        label_rows,
        key=lambda row: (
            0 if ("昨日收益" in row["text"] and row["visible"]) else 1,
            0 if "昨日收益" in row["text"] else 1,
            row["y"],
            row["x"],
        ),
    ):
        inline_match = re.search(r"(昨日收益|今日收益)[:：]\s*([+-]?\d[\d,]*(?:\.\d+)?)\s*元?", label_row["text"])
        if not inline_match:
            continue
        if label_row["y"] > 600:
            continue
        amount_text = inline_match.group(2)
        if not amount_text.startswith(("+", "-")):
            amount_text = f"+{amount_text}"
        return {
            "name": inline_match.group(1),
            "amountText": amount_text,
            "amount": parse_amount(amount_text),
            "source": "inlineLabel",
            "frame": {
                "x": label_row["x"],
                "y": label_row["y"],
                "width": label_row["width"],
                "height": label_row["height"],
            },
        }
    for label_row in sorted(label_rows, key=lambda row: (row["y"], row["x"])):
        if "更新" in label_row["text"]:
            continue
        candidates = [
            row
            for row in rows
            if row is not label_row
            and row["visible"]
            and abs(row["x"] - label_row["x"]) <= 90
            and 12 <= row["y"] - label_row["y"] <= 90
            and is_amount_text(row["text"])
        ]
        if not candidates:
            continue
        value_row = min(candidates, key=lambda row: (row["y"], abs(row["x"] - label_row["x"])))
        return {
            "name": label_row["text"],
            "amountText": value_row["text"],
            "amount": parse_amount(value_row["text"]),
            "source": "labelBelow",
            "frame": {
                "x": value_row["x"],
                "y": value_row["y"],
                "width": value_row["width"],
                "height": value_row["height"],
            },
        }
    return None


def extract_alipay_daily_profit(files: list[dict[str, str]]) -> dict[str, Any] | None:
    fallback: dict[str, Any] | None = None
    for file_info in files:
        source_path = file_info.get("pageSource")
        if not source_path:
            continue
        path = Path(source_path)
        if not path.exists():
            continue
        record = extract_alipay_daily_profit_from_source(path.read_text(encoding="utf-8"))
        if not record:
            continue
        if record.get("name") == "昨日收益":
            return record
        if fallback is None:
            fallback = record
    asset_records = extract_asset_records(files)
    yesterday_profits = [
        record["yesterdayProfit"]
        for record in asset_records
        if isinstance(record.get("yesterdayProfit"), (int, float))
    ]
    if yesterday_profits:
        amount = round(sum(yesterday_profits), 2)
        return {
            "name": "昨日收益",
            "amountText": f"{amount:+.2f}",
            "amount": amount,
            "source": "assetDistributionSum",
            "components": [
                {
                    "name": record.get("name"),
                    "amountText": record.get("yesterdayProfitText"),
                    "amount": record.get("yesterdayProfit"),
                }
                for record in asset_records
                if isinstance(record.get("yesterdayProfit"), (int, float))
            ],
        }
    return fallback


def normalize_label(text: str) -> str:
    return re.sub(r"\s+", "", text).replace("：", ":")


def collect_visible_texts(page_source: str) -> list[dict[str, Any]]:
    rows = [
        row
        for row in extract_static_text_rows(page_source)
        if row["visible"] and row["text"]
    ]
    return sorted(rows, key=lambda row: (row["y"], row["x"]))


def parse_money_text(value: str) -> float | None:
    cleaned = value.strip().replace(",", "")
    if cleaned == "--":
        return None
    if not re.search(r"\d", cleaned):
        return None
    if "%" in cleaned:
        return None
    return parse_amount(cleaned)


def parse_percent_text(value: str) -> float | None:
    if "%" not in value:
        return None
    return parse_amount(value)


def is_caitong_amount_text(value: str) -> bool:
    return value.strip() == "--" or is_amount_text(value.strip())


def is_caitong_value_text(value: str) -> bool:
    return is_caitong_amount_text(value) or bool(re.fullmatch(r"[+-]?\d[\d,]*(?:\.\d+)?%", value.strip()))


def find_nearby_value(
    rows: list[dict[str, Any]],
    label_patterns: list[str],
    *,
    max_dx: int = 260,
    max_dy: int = 70,
) -> dict[str, Any] | None:
    for label_row in rows:
        label_text = normalize_label(label_row["text"])
        if not any(pattern in label_text for pattern in label_patterns):
            continue
        candidates = []
        for row in rows:
            if row is label_row:
                continue
            if abs(row["y"] - label_row["y"]) > max_dy:
                continue
            if row["x"] < label_row["x"] - 10:
                continue
            if row["x"] - label_row["x"] > max_dx:
                continue
            amount = parse_money_text(row["text"])
            if amount is None:
                continue
            candidates.append((abs(row["y"] - label_row["y"]), row["x"], row, amount))
        if not candidates:
            continue
        _, _, value_row, amount = min(candidates, key=lambda item: item[:2])
        return {
            "label": label_row["text"],
            "valueText": value_row["text"],
            "value": amount,
            "frame": {
                "x": value_row["x"],
                "y": value_row["y"],
                "width": value_row["width"],
                "height": value_row["height"],
            },
        }
    return None


def extract_caitong_asset_records_from_source(page_source: str) -> list[dict[str, Any]]:
    rows = collect_visible_texts(page_source)
    fields = [
        ("totalAsset", ["总资产(人民币)", "总资产"]),
        ("dayProfit", ["当日参考盈亏"]),
        ("marketValue", ["证券总市值", "证券市值", "股票市值"]),
        ("totalProfit", ["总盈亏"]),
        ("positionRatio", ["仓位"]),
        ("availableCash", ["可用资金", "可用"]),
        ("withdrawableCash", ["可取"]),
        ("cashBalance", ["资金余额", "余额"]),
    ]
    records: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    for field, labels in fields:
        normalized_labels = [normalize_label(pattern) for pattern in labels]
        label_rows = [
            row
            for row in rows
            if 140 <= row["y"] <= 460
            and normalize_label(row["text"]) in normalized_labels
        ]
        for label_row in label_rows:
            value_rows = [
                row
                for row in rows
                if abs(row["x"] - label_row["x"]) <= 35
                and 18 <= row["y"] - label_row["y"] <= 65
                and is_caitong_value_text(row["text"])
            ]
            if not value_rows:
                continue
            value_row = min(value_rows, key=lambda row: (row["y"], row["x"]))
            label = label_row["text"]
            amount_text = value_row["text"]
            amount = parse_percent_text(amount_text) if "%" in amount_text else parse_money_text(amount_text)
            frame = {
                "x": value_row["x"],
                "y": value_row["y"],
                "width": value_row["width"],
                "height": value_row["height"],
            }
            break
        else:
            continue
        if label in seen_labels:
            continue
        seen_labels.add(label)
        records.append(
            {
                "field": field,
                "name": label,
                "amountText": amount_text,
                "amount": amount,
                "frame": frame,
            }
        )
    return records


def looks_like_caitong_position_name(text: str) -> bool:
    ignored = {
        "持仓",
        "资产",
        "交易",
        "查询",
        "买入",
        "卖出",
        "撤单",
        "银证转账",
        "股票",
        "名称",
        "代码",
        "市值",
        "盈亏",
        "可用",
        "数量",
        "成本",
        "现价",
        "证券市值",
        "总资产",
        "可用资金",
        "资金余额",
        "人民币",
        "刷新",
    }
    cleaned = text.strip()
    if cleaned in ignored:
        return False
    if len(cleaned) <= 1:
        return False
    if re.fullmatch(r"[A-Z]{1,6}", cleaned):
        return False
    if re.fullmatch(r"\d{5,6}", cleaned):
        return False
    if is_amount_text(cleaned) or "%" in cleaned:
        return False
    return bool(re.search(r"[\u4e00-\u9fffA-Za-z]", cleaned))


def extract_caitong_position_records_from_source(page_source: str) -> list[dict[str, Any]]:
    rows = [
        row
        for row in collect_visible_texts(page_source)
        if 80 <= row["y"] <= 980
    ]
    records: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    header_rows = [
        row
        for row in rows
        if row["text"] == "市值" and row["x"] <= 60
    ]
    header_y = min((row["y"] for row in header_rows), default=620)
    name_rows = [
        row
        for row in rows
        if row["y"] > header_y
        and 10 <= row["x"] <= 110
        and looks_like_caitong_position_name(row["text"])
    ]
    name_rows.sort(key=lambda row: row["y"])

    for index, row in enumerate(name_rows):
        text = row["text"]
        next_y = name_rows[index + 1]["y"] if index + 1 < len(name_rows) else row["y"] + 90
        group_bottom = min(next_y - 4, row["y"] + 86)
        group = [
            item
            for item in rows
            if row["y"] - 5 <= item["y"] <= group_bottom
        ]
        amount_rows = [
            item
            for item in group
            if is_caitong_amount_text(item["text"])
        ]
        value_rows = [
            item
            for item in group
            if is_caitong_value_text(item["text"])
        ]
        if len(amount_rows) < 2:
            continue
        code_rows = [item for item in group if re.fullmatch(r"\d{5,6}", item["text"])]
        code = code_rows[0]["text"] if code_rows else None

        def value_in_column(
            min_x: int,
            max_x: int,
            min_dy: int,
            max_dy: int,
            candidates_source: list[dict[str, Any]] | None = None,
        ) -> dict[str, Any] | None:
            source_rows = candidates_source or amount_rows
            candidates = [
                item
                for item in source_rows
                if min_x <= item["x"] <= max_x
                and min_dy <= item["y"] - row["y"] <= max_dy
            ]
            if not candidates:
                return None
            return min(candidates, key=lambda item: (item["y"], item["x"]))

        field_rows = {
            "marketValue": value_in_column(10, 110, 16, 45),
            "profit": value_in_column(110, 215, -8, 28),
            "profitRate": value_in_column(110, 215, 20, 60, value_rows),
            "quantity": value_in_column(215, 320, -8, 28),
            "available": value_in_column(215, 320, 20, 60),
            "cost": value_in_column(315, 420, -8, 28),
            "price": value_in_column(315, 420, 20, 60),
        }
        market_value_row = field_rows.get("marketValue")
        if not market_value_row or parse_money_text(market_value_row["text"]) is None:
            continue

        key = (text, code or market_value_row["text"])
        if key in seen:
            continue
        seen.add(key)

        record: dict[str, Any] = {
            "name": text,
            "rawValues": [item["text"] for item in sorted(amount_rows, key=lambda item: (item["y"], item["x"]))[:12]],
            "frame": {
                "x": row["x"],
                "y": row["y"],
                "width": row["width"],
                "height": row["height"],
            },
        }
        if code:
            record["code"] = code
        for field, value_row in field_rows.items():
            if not value_row:
                continue
            text_value = value_row["text"]
            record[f"{field}Text"] = text_value
            if field == "profitRate":
                record[field] = parse_percent_text(text_value)
            else:
                record[field] = parse_money_text(text_value)
        if "marketValue" in record:
            record["amountText"] = record["marketValueText"]
            record["amount"] = record["marketValue"]
        records.append(record)

    return records


def extract_caitong_records(
    files: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    asset_records_by_field: dict[str, dict[str, Any]] = {}
    position_records_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for file_info in files:
        source_path = file_info.get("pageSource")
        if not source_path:
            continue
        path = Path(source_path)
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8")
        for record in extract_caitong_asset_records_from_source(source):
            field = str(record.get("field") or record.get("name") or "")
            existing = asset_records_by_field.get(field)
            if not existing:
                asset_records_by_field[field] = record
                continue
            existing_text = str(existing.get("amountText") or "")
            record_text = str(record.get("amountText") or "")
            if "," not in existing_text and "," in record_text:
                asset_records_by_field[field] = record
        for record in extract_caitong_position_records_from_source(source):
            key = (record.get("name", ""), record.get("code", record.get("rawValues", [""])[0]))
            position_records_by_key.setdefault(key, record)
    return list(asset_records_by_field.values()), list(position_records_by_key.values())


def build_caitong_export(
    summary_path: Path,
    captured_at: str | None,
    asset_records: list[dict[str, Any]],
    holding_records: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "capturedAt": captured_at,
        "source": "caitong",
        "sourceSummary": str(summary_path),
        "assetRecords": asset_records,
        "holdingRecords": holding_records,
        "holdingCount": len(holding_records),
        "holdingAmountSum": round(
            sum((record.get("amount") or 0) for record in holding_records),
            2,
        ),
    }


def build_invest_export(
    summary_path: Path,
    captured_at: str | None,
    asset_records: list[dict[str, Any]],
    holding_records: list[dict[str, Any]],
    daily_profit: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "capturedAt": captured_at,
        "source": "alipay",
        "sourceSummary": str(summary_path),
        "assetRecords": asset_records,
        "holdingRecords": holding_records,
        "holdingCount": len(holding_records),
        "holdingAmountSum": round(
            sum((record.get("amount") or 0) for record in holding_records),
            2,
        ),
    }
    if daily_profit:
        payload["dailyProfit"] = daily_profit
    return payload


def write_invest_export(
    output_path: Path | None,
    summary_path: Path,
    captured_at: str | None,
    asset_records: list[dict[str, Any]],
    holding_records: list[dict[str, Any]],
    daily_profit: dict[str, Any] | None = None,
) -> Path | None:
    if not output_path:
        return None
    resolved_output = output_path.expanduser().resolve()
    resolved_output.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        resolved_output,
        build_invest_export(
            summary_path,
            captured_at,
            asset_records,
            holding_records,
            daily_profit,
        ),
    )
    update_invest_manifest(resolved_output)
    return resolved_output


def update_invest_manifest(output_path: Path) -> None:
    parts = output_path.parts
    try:
        invest_index = parts.index("invest")
        year, month, day = parts[invest_index + 1:invest_index + 4]
    except (ValueError, IndexError):
        return
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        return

    root = Path(*parts[:invest_index + 1])
    manifest_path = root / "index.json"
    date_key = f"{year}-{month}-{day}"
    dates: list[str] = []
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(manifest.get("dates"), list):
                dates = [str(date) for date in manifest["dates"]]
        except json.JSONDecodeError:
            dates = []
    if date_key not in dates:
        dates.append(date_key)
    write_json(manifest_path, {"dates": sorted(dates)})


def default_invest_output_path(now: datetime | None = None) -> Path:
    current = now or datetime.now().astimezone()
    return (
        DEFAULT_INVEST_OUTPUT_ROOT
        / f"{current:%Y}"
        / f"{current:%m}"
        / f"{current:%d}"
        / "alipay.json"
    )


def caitong_output_path_for_alipay_output(alipay_output: Path | None) -> Path:
    if alipay_output:
        return alipay_output.with_name("caitong.json")
    return default_invest_output_path().with_name("caitong.json")


def scroll_down(driver: Any) -> bool:
    size = driver.get_window_size()
    width = int(size.get("width", 390))
    height = int(size.get("height", 844))
    try:
        driver.swipe(
            int(width * 0.5),
            int(height * 0.78),
            int(width * 0.5),
            int(height * 0.28),
            650,
        )
        return True
    except Exception:
        pass

    try:
        driver.execute_script("mobile: scroll", {"direction": "down"})
        return True
    except Exception:
        return False


def scroll_up(driver: Any) -> bool:
    size = driver.get_window_size()
    width = int(size.get("width", 390))
    height = int(size.get("height", 844))
    try:
        driver.swipe(
            int(width * 0.5),
            int(height * 0.30),
            int(width * 0.5),
            int(height * 0.78),
            650,
        )
        return True
    except Exception:
        pass

    try:
        driver.execute_script("mobile: scroll", {"direction": "up"})
        return True
    except Exception:
        return False


def scroll_to_top(driver: Any, attempts: int = 4, settle_seconds: float = 0.6) -> None:
    previous_signature = ""
    for _ in range(attempts):
        source = driver.page_source
        signature = page_signature(source)
        if signature == previous_signature:
            return
        previous_signature = signature
        if not scroll_up(driver):
            return
        time.sleep(settle_seconds)


def capture_scrolling_area(
    driver: Any,
    out_dir: Path,
    session_id: str,
    prefix: str,
    max_screens: int,
    settle_seconds: float,
) -> tuple[list[dict[str, str]], str]:
    files = []
    seen_signatures: set[str] = set()

    for index in range(1, max_screens + 1):
        page_source = driver.page_source
        signature = page_signature(page_source)
        if signature in seen_signatures:
            return files, "页面内容重复,已到达底部或未发生滚动"
        seen_signatures.add(signature)

        files.append(
            capture_artifacts(
                driver,
                out_dir,
                session_id,
                f"{prefix}-{index:02d}",
                {"screenIndex": index, "signature": signature},
            )
        )

        if index >= max_screens:
            return files, f"达到最大截图数 {max_screens}"
        if not scroll_down(driver):
            return files, "滚动命令失败"
        time.sleep(settle_seconds)

    return files, "结束"


def capture(args: argparse.Namespace) -> int:
    udid = detect_udid(args.udid)
    if not udid:
        print("无法自动确定 UDID。请确认只连接一台 iPhone,或传入 --udid。", file=sys.stderr)
        return 2

    out_dir = args.out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    session_id = timestamp()
    driver = create_driver(args, udid)
    try:
        if args.safari_url:
            driver.get(args.safari_url)
        if args.wait:
            time.sleep(args.wait)

        page_source = driver.page_source
        screenshot_path = out_dir / f"{session_id}.png"
        source_path = out_dir / f"{session_id}.xml"
        metadata_path = out_dir / f"{session_id}.json"

        source_path.write_text(page_source, encoding="utf-8")
        driver.get_screenshot_as_file(str(screenshot_path))

        metadata: dict[str, Any] = {
            "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "appiumUrl": args.appium_url,
            "udid": udid,
            "bundleId": args.bundle_id,
            "safariUrl": args.safari_url,
            "windowSize": driver.get_window_size(),
            "capabilities": driver.capabilities,
            "files": {
                "pageSource": str(source_path),
                "screenshot": str(screenshot_path),
            },
        }

        if args.find:
            metadata["matches"] = [
                text for text in args.find if text and text in page_source
            ]

        write_json(metadata_path, metadata)

        print(f"页面树: {source_path}")
        print(f"截图: {screenshot_path}")
        print(f"元数据: {metadata_path}")
        if args.find:
            found = metadata.get("matches", [])
            print("匹配文本: " + (", ".join(found) if found else "无"))
        return 0
    finally:
        driver.quit()


def wait_for_manual_unblock(driver: Any, timeout: float) -> str:
    login_or_auth_patterns = [
        "登录支付宝",
        "立即登录",
        "账号登录",
        "密码登录",
        "刷脸验证",
        "人脸验证",
        "身份验证",
        "验证身份",
        "安全校验",
        "请输入支付密码",
        "请输入登录密码",
        "请输入交易密码",
        "交易密码",
        "确认登录",
        "解锁支付宝",
    ]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        source = driver.page_source
        if not any(text in source for text in login_or_auth_patterns):
            return "未检测到登录或安全校验阻断"
        time.sleep(2)
    return "仍可能停留在登录或安全校验页面"


def enter_alipay_if_prompted(driver: Any, timeout: float) -> str | None:
    tapped = tap_any_text(driver, ["进入支付宝"], timeout=timeout)
    if tapped:
        return tapped
    return None


def find_alipay_total_asset_number_rect(driver: Any) -> dict[str, Any] | None:
    rects = [
        rect
        for rect in visible_text_rects(driver, "总资产：")
        if rect["y"] >= 120 and rect["width"] >= 100
    ]
    if not rects:
        return None
    return min(rects, key=lambda item: item["y"])


def tap_alipay_total_asset_number(driver: Any) -> dict[str, Any]:
    rect = find_alipay_total_asset_number_rect(driver)
    if rect:
        x = rect["x"] + max(20, int(rect["width"] * 0.38))
        y = rect["y"] + max(10, int(rect["height"] * 0.55))
        tap_point(driver, x, y)
        return {"method": "amountElement", "text": rect["text"], "coordinates": {"x": x, "y": y}}

    scroll_to_top(driver, attempts=2)
    rect = find_alipay_total_asset_number_rect(driver)
    if rect:
        x = rect["x"] + max(20, int(rect["width"] * 0.38))
        y = rect["y"] + max(10, int(rect["height"] * 0.55))
        tap_point(driver, x, y)
        return {
            "method": "amountElementAfterScrollTop",
            "text": rect["text"],
            "coordinates": {"x": x, "y": y},
        }

    size = driver.get_window_size()
    candidates = [
        (0.30, 0.24),
        (0.38, 0.24),
        (0.30, 0.20),
    ]
    for x_ratio, y_ratio in candidates:
        x = int(size.get("width", 390) * x_ratio)
        y = int(size.get("height", 844) * y_ratio)
        tap_point(driver, x, y)
        time.sleep(0.8)
        if source_contains_any(driver, ["全部持有", "持有明细"]):
            return {
                "method": "coordinate",
                "coordinates": {"x": x, "y": y},
                "note": "点击总资产数字区域后进入持仓明细",
            }
    return {
        "method": "coordinate",
        "coordinates": {"x": x, "y": y},
        "note": "已点击总资产数字区域",
    }


def caitong_trade_password(args: argparse.Namespace) -> str | None:
    value = getattr(args, "caitong_trade_password", None)
    if value:
        return str(value)
    return os.environ.get(CAITONG_TRADE_PASSWORD_ENV)


def caitong_asset_page_visible(driver: Any) -> bool:
    return source_contains_any(driver, ["总资产(人民币)", "证券总市值", "持仓/可用"])


def caitong_trade_login_pending(driver: Any) -> bool:
    source = driver.page_source
    return "委托登录" in source or ("资金账号" in source and "登录" in source)


def wait_for_caitong_asset_page(driver: Any, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if caitong_asset_page_visible(driver):
            return True
        time.sleep(0.5)
    return False


def tap_caitong_login_button(driver: Any) -> dict[str, Any]:
    buttons = [
        rect
        for rect in visible_element_rects(
            driver,
            "登录",
            element_type="XCUIElementTypeButton",
        )
        if rect["x"] >= 300 and 80 <= rect["y"] <= 180
    ]
    if buttons:
        rect = max(buttons, key=lambda item: item["x"])
        x = rect["x"] + rect["width"] // 2
        y = rect["y"] + rect["height"] // 2
        tap_point(driver, x, y)
        return {
            "text": rect["text"],
            "coordinates": {"x": x, "y": y},
            "method": "buttonCenter",
        }
    x, y = tap_relative(driver, 0.91, 0.16)
    return {
        "text": None,
        "coordinates": {"x": x, "y": y},
        "method": "coordinate",
        "note": "未找到委托登录按钮文本,已点击右上登录按钮区域",
    }


def login_caitong_trade(driver: Any, args: argparse.Namespace) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    dismissed = dismiss_optional_overlays(driver)
    if dismissed:
        actions.append({"step": "dismissOverlays", "texts": dismissed})

    tapped = tap_any_text(driver, ["交易"], timeout=args.nav_timeout, contains=True)
    if not tapped:
        x, y = tap_relative(driver, 0.50, 0.93)
        actions.append(
            {
                "step": "tapTrade",
                "text": None,
                "coordinates": {"x": x, "y": y},
                "note": "未找到「交易」文本入口,已点击底部中间区域",
            }
        )
    else:
        actions.append({"step": "tapTrade", "text": tapped})
    time.sleep(args.step_wait)

    if caitong_asset_page_visible(driver):
        actions.append({"step": "tradeAlreadyLoggedIn", "status": "已在财通交易资产页"})
        return actions

    password = caitong_trade_password(args)
    if not password:
        raise RuntimeError(f"财通证券需要交易密码,请设置环境变量 {CAITONG_TRADE_PASSWORD_ENV}")

    if not numeric_keypad_visible(driver):
        if caitong_trade_login_pending(driver):
            for attempt in range(1, 4):
                login_tap = tap_caitong_login_button(driver)
                actions.append(
                    {
                        "step": "openTradePasswordKeyboard",
                        "attempt": attempt,
                        **login_tap,
                    }
                )
                time.sleep(args.step_wait)
                if caitong_asset_page_visible(driver) or numeric_keypad_visible(driver):
                    break

    if not numeric_keypad_visible(driver):
        raise RuntimeError("财通证券未弹出交易密码键盘")

    actions.append(
        {
            "step": "inputTradePassword",
            "passwordLength": len(password),
            "source": CAITONG_TRADE_PASSWORD_ENV,
        }
    )
    keypad_actions = tap_numeric_keypad(driver, password)
    actions.append(
        {
            "step": "tapNumericKeypad",
            "keyCount": len(keypad_actions),
            "methods": sorted({item["method"] for item in keypad_actions}),
        }
    )
    time.sleep(args.step_wait)
    tapped = tap_any_text(
        driver,
        ["确定", "确认登录", "确认", "登录", "登入"],
        timeout=args.nav_timeout,
        contains=True,
    )
    if not tapped:
        x, y = tap_relative(driver, 0.50, 0.56)
        actions.append(
            {
                "step": "confirmLogin",
                "text": None,
                "coordinates": {"x": x, "y": y},
                "note": "未找到确认登录按钮,已点击密码框下方主要按钮区域",
            }
        )
    else:
        actions.append({"step": "confirmLogin", "text": tapped})

    time.sleep(args.step_wait)
    if not wait_for_caitong_asset_page(driver, min(args.nav_timeout, 12)):
        if caitong_trade_login_pending(driver):
            raise RuntimeError("财通证券登录后仍停留在委托登录页")
    return actions


def write_caitong_export(
    output_path: Path | None,
    summary_path: Path,
    captured_at: str | None,
    asset_records: list[dict[str, Any]],
    holding_records: list[dict[str, Any]],
) -> Path | None:
    if not output_path:
        return None
    resolved_output = output_path.expanduser().resolve()
    resolved_output.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        resolved_output,
        build_caitong_export(
            summary_path,
            captured_at,
            asset_records,
            holding_records,
        ),
    )
    update_invest_manifest(resolved_output)
    return resolved_output


def run_caitong_assets_flow(args: argparse.Namespace, driver: Any | None = None) -> dict[str, Any]:
    own_driver = driver is None
    udid = detect_udid(args.udid)
    if not udid:
        raise RuntimeError("无法自动确定 UDID。请确认只连接一台 iPhone,或传入 --udid。")

    original_bundle_id = args.bundle_id
    args.bundle_id = getattr(args, "caitong_bundle_id", None) or CAITONG_BUNDLE_ID
    out_dir = args.caitong_out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    session_id = timestamp()
    navigation: list[dict[str, Any]] = []
    files: list[dict[str, str]] = []
    summary_path = out_dir / f"{session_id}-summary.json"

    try:
        if driver is None:
            driver = create_driver(args, udid)
        else:
            driver.activate_app(args.bundle_id)
        restart_app(driver, args.bundle_id, "财通证券", args.wait)

        files.append(
            capture_artifacts(
                driver,
                out_dir,
                session_id,
                "00-start",
                {"step": "start", "bundleId": args.bundle_id},
            )
        )
        print("已连接财通证券并保存起始截图", flush=True)

        if not args.skip_caitong_navigation:
            navigation.extend(login_caitong_trade(driver, args))
            navigation.append(
                {
                    "step": "tradePageContainsAssetsAndHoldings",
                    "status": "点击交易后当前页已包含资产和持仓,不再二次点击资产/持仓入口",
                }
            )

        files.append(
            capture_artifacts(
                driver,
                out_dir,
                session_id,
                "01-assets",
                {"step": "assets"},
            )
        )

        holding_files, stop_reason = capture_scrolling_area(
            driver,
            out_dir,
            session_id,
            "holding-detail",
            max_screens=args.caitong_max_screens,
            settle_seconds=args.step_wait,
        )
        files.extend(holding_files)

        captured_at = datetime.now().astimezone().isoformat(timespec="seconds")
        asset_records, holding_records = extract_caitong_records(files)
        if not asset_records:
            raise RuntimeError("财通证券未提取到资产记录")
        if not holding_records:
            raise RuntimeError("财通证券未提取到持仓记录")
        write_json(
            summary_path,
            {
                "capturedAt": captured_at,
                "udid": udid,
                "bundleId": args.bundle_id,
                "navigation": navigation,
                "stopReason": stop_reason,
                "assetRecords": asset_records,
                "holdingRecords": holding_records,
                "files": files,
            },
        )

        caitong_output = write_caitong_export(
            args.caitong_output,
            summary_path,
            captured_at,
            asset_records,
            holding_records,
        )
        print(f"财通证券资产持仓截图: {out_dir}", flush=True)
        print(f"财通证券汇总: {summary_path}", flush=True)
        if caitong_output:
            print(f"财通证券数据: {caitong_output}", flush=True)
        print(f"财通证券停止原因: {stop_reason}", flush=True)
        return {
            "summaryPath": str(summary_path),
            "outputPath": str(caitong_output) if caitong_output else None,
            "assetCount": len(asset_records),
            "holdingCount": len(holding_records),
            "stopReason": stop_reason,
        }
    except Exception as error:
        error_path = out_dir / f"{session_id}-error.json"
        if driver is not None:
            current_files = capture_artifacts(
                driver,
                out_dir,
                session_id,
                "error-screen",
                {"error": str(error), "navigation": navigation},
            )
            files.append(current_files)
        write_json(
            error_path,
            {
                "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "udid": udid,
                "bundleId": args.bundle_id,
                "navigation": navigation,
                "error": str(error),
                "files": files,
            },
        )
        raise RuntimeError(f"财通证券流程中断: {error}; 错误现场: {error_path}") from error
    finally:
        args.bundle_id = original_bundle_id
        if driver is not None:
            terminate_app_safely(driver, CAITONG_BUNDLE_ID, "财通证券")
        if own_driver and driver is not None:
            driver.quit()


def start_health_auto_export_server(driver: Any, args: argparse.Namespace) -> str:
    driver.activate_app(HEALTH_AUTO_EXPORT_BUNDLE_ID)
    time.sleep(args.step_wait)

    if source_contains_any(driver, ["停止服务器"]):
        return "Health Auto Export 服务器已在运行"

    if not source_contains_any(driver, ["服务器"]):
        menu = tap_any_text(driver, ["sidebar.left", "菜单", "Sidebar", "Menu"], timeout=3, contains=True)
        if not menu:
            tap_relative(driver, 0.1, 0.16)
        time.sleep(args.step_wait)
        tapped = tap_any_text(driver, ["服务器", "Server"], timeout=args.nav_timeout, contains=True)
        if not tapped:
            raise RuntimeError("未找到 Health Auto Export「服务器」入口")
        time.sleep(args.step_wait)

    if source_contains_any(driver, ["停止服务器"]):
        return "Health Auto Export 服务器已在运行"

    tapped = tap_any_text(driver, ["启动服务器", "Start Server", "启动", "Start"], timeout=args.nav_timeout, contains=True)
    if not tapped:
        raise RuntimeError("未找到 Health Auto Export「启动服务器」按钮")
    time.sleep(args.step_wait)

    if not source_contains_any(driver, ["停止服务器", "Stop Server", "9000"]):
        raise RuntimeError("Health Auto Export 服务器启动后未检测到运行状态")
    return "Health Auto Export 服务器已启动"


def run_alipay_assets_flow(args: argparse.Namespace) -> int:
    udid = detect_udid(args.udid)
    if not udid:
        print("无法自动确定 UDID。请确认只连接一台 iPhone,或传入 --udid。", file=sys.stderr)
        return 2

    args.bundle_id = args.bundle_id or ALIPAY_BUNDLE_ID
    out_dir = args.out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    session_id = timestamp()
    driver = create_driver(args, udid)
    navigation: list[dict[str, Any]] = []
    files: list[dict[str, str]] = []
    stop_reason = ""

    try:
        restart_app(driver, args.bundle_id, "支付宝", args.wait)
        dismissed = dismiss_optional_overlays(driver)
        if dismissed:
            navigation.append({"step": "dismissOverlays", "texts": dismissed})

        files.append(
            capture_artifacts(
                driver,
                out_dir,
                session_id,
                "00-start",
                {"step": "start", "bundleId": args.bundle_id},
            )
        )
        print("已连接支付宝并保存起始截图", flush=True)

        if not args.skip_navigation:
            tapped = enter_alipay_if_prompted(driver, timeout=3)
            if tapped:
                navigation.append({"step": "enterAlipay", "text": tapped})
                print(f"已点击: {tapped}", flush=True)
                time.sleep(args.step_wait)
                dismissed = dismiss_optional_overlays(driver)
                if dismissed:
                    navigation.append({"step": "dismissAfterEnterAlipay", "texts": dismissed})

            if source_contains_any(driver, ["总资产", "资产总额", "全部持有", "持有明细"]):
                navigation.append(
                    {
                        "step": "tapFinance",
                        "text": None,
                        "note": "当前已在资产相关页面,跳过理财入口",
                    }
                )
                print("当前已在资产相关页面,跳过理财入口", flush=True)
            else:
                tapped = tap_any_text(driver, ["理财"], timeout=args.nav_timeout)
                if not tapped:
                    stop_reason = "未找到「理财」入口"
                    raise RuntimeError(stop_reason)
                navigation.append({"step": "tapFinance", "text": tapped})
                print(f"已点击入口: {tapped}", flush=True)
                time.sleep(args.step_wait)
                dismissed = dismiss_optional_overlays(driver)
                if dismissed:
                    navigation.append({"step": "dismissFinanceOverlays", "texts": dismissed})

            if source_has_text_near_top(driver, "总资产") or source_contains_any(driver, ["全部持有", "持有明细"]):
                navigation.append(
                    {
                        "step": "tapTotalAssets",
                        "text": None,
                        "note": "当前已在总资产或持有区域,跳过资产入口",
                    }
                )
                print("当前已在总资产或持有区域,跳过资产入口", flush=True)
            else:
                tapped = tap_any_text(
                    driver,
                    ["总资产", "资产总额", "我的资产", "资产"],
                    timeout=args.nav_timeout,
                    contains=True,
                )
                if not tapped:
                    stop_reason = "未找到「总资产」入口"
                    raise RuntimeError(stop_reason)
                navigation.append({"step": "tapTotalAssets", "text": tapped})
                print(f"已点击资产入口: {tapped}", flush=True)
                time.sleep(min(args.step_wait, 0.6))

            files.extend(capture_alipay_total_asset_artifacts(driver, out_dir, session_id))
            total_amount_tap = tap_alipay_total_asset_number(driver)
            navigation.append({"step": "tapTotalAssetNumber", **total_amount_tap})
            print(f"已点击总资产数字区域: {total_amount_tap}", flush=True)
            time.sleep(args.step_wait)

        holding_files, stop_reason = capture_scrolling_area(
            driver,
            out_dir,
            session_id,
            "holding-detail",
            max_screens=args.max_screens,
            settle_seconds=args.step_wait,
        )
        files.extend(holding_files)

        captured_at = datetime.now().astimezone().isoformat(timespec="seconds")
        asset_records = extract_asset_records(files)
        holding_records = extract_holding_records(files)
        daily_profit = extract_alipay_daily_profit(files)
        if not holding_records:
            stop_reason = "支付宝未提取到持仓记录"
            raise RuntimeError(stop_reason)

        summary_path = out_dir / f"{session_id}-summary.json"
        write_json(
            summary_path,
            {
                "capturedAt": captured_at,
                "udid": udid,
                "bundleId": args.bundle_id,
                "navigation": navigation,
                "stopReason": stop_reason,
                "dailyProfit": daily_profit,
                "assetRecords": asset_records,
                "holdingRecords": holding_records,
                "files": files,
            },
        )
        invest_output = write_invest_export(
            args.invest_output,
            summary_path,
            captured_at,
            asset_records,
            holding_records,
            daily_profit,
        )
        print(f"支付宝理财持有明细截图: {out_dir}")
        print(f"汇总: {summary_path}")
        if invest_output:
            print(f"投资数据: {invest_output}")
        print(f"停止原因: {stop_reason}")
        terminate_app_safely(driver, ALIPAY_BUNDLE_ID, "支付宝")
        if args.sync_caitong:
            try:
                args.caitong_output = args.caitong_output or caitong_output_path_for_alipay_output(invest_output)
                caitong_result = run_caitong_assets_flow(args, driver=driver)
                navigation.append({"step": "syncCaitongAssets", **caitong_result})
                write_json(
                    summary_path,
                    {
                        "capturedAt": captured_at,
                        "udid": udid,
                        "bundleId": args.bundle_id,
                        "navigation": navigation,
                        "stopReason": stop_reason,
                        "dailyProfit": daily_profit,
                        "assetRecords": asset_records,
                        "holdingRecords": holding_records,
                        "files": files,
                    },
                )
            except Exception as error:
                navigation.append({"step": "syncCaitongAssets", "error": str(error)})
                write_json(
                    summary_path,
                    {
                        "capturedAt": captured_at,
                        "udid": udid,
                        "bundleId": args.bundle_id,
                        "navigation": navigation,
                        "stopReason": stop_reason,
                        "dailyProfit": daily_profit,
                        "assetRecords": asset_records,
                        "holdingRecords": holding_records,
                        "files": files,
                    },
                )
                if not args.continue_after_caitong_error:
                    raise
                print(f"财通证券流程中断,已继续后续流程: {error}", file=sys.stderr)
        if args.start_health_server:
            health_status = start_health_auto_export_server(driver, args)
            navigation.append({"step": "startHealthAutoExportServer", "status": health_status})
            write_json(
                summary_path,
                {
                    "capturedAt": captured_at,
                    "udid": udid,
                    "bundleId": args.bundle_id,
                    "navigation": navigation,
                    "stopReason": stop_reason,
                    "dailyProfit": daily_profit,
                    "assetRecords": asset_records,
                    "holdingRecords": holding_records,
                    "files": files,
                },
            )
            print(health_status)
        return 0
    except Exception as error:
        error_path = out_dir / f"{session_id}-error.json"
        current_files = capture_artifacts(
            driver,
            out_dir,
            session_id,
            "error-screen",
            {"error": str(error), "navigation": navigation},
        )
        files.append(current_files)
        write_json(
            error_path,
            {
                "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "udid": udid,
                "bundleId": args.bundle_id,
                "navigation": navigation,
                "error": str(error),
                "files": files,
            },
        )
        print(f"流程中断: {error}", file=sys.stderr)
        print(f"错误现场: {error_path}", file=sys.stderr)
        return 1
    finally:
        terminate_app_safely(driver, ALIPAY_BUNDLE_ID, "支付宝")
        terminate_app_safely(driver, CAITONG_BUNDLE_ID, "财通证券")
        driver.quit()


def extract_existing_summary(args: argparse.Namespace) -> int:
    summary_path = args.extract_existing_summary.expanduser().resolve()
    data = json.loads(summary_path.read_text(encoding="utf-8"))
    files = data.get("files", [])
    if not isinstance(files, list):
        print(f"summary files 字段格式不正确: {summary_path}", file=sys.stderr)
        return 2
    is_caitong_summary = (
        data.get("bundleId") == CAITONG_BUNDLE_ID
        or str(summary_path).find("caitong-assets-capture") >= 0
    )
    if is_caitong_summary:
        data["assetRecords"], data["holdingRecords"] = extract_caitong_records(files)
        data["dailyProfit"] = None
    else:
        data["assetRecords"] = extract_asset_records(files)
        data["holdingRecords"] = extract_holding_records(files)
        data["dailyProfit"] = extract_alipay_daily_profit(files)
    data["extractedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(summary_path, data)
    if is_caitong_summary:
        invest_output = write_caitong_export(
            args.caitong_output or caitong_output_path_for_alipay_output(args.invest_output),
            summary_path,
            data.get("capturedAt"),
            data["assetRecords"],
            data["holdingRecords"],
        )
    else:
        invest_output = write_invest_export(
            args.invest_output,
            summary_path,
            data.get("capturedAt"),
            data["assetRecords"],
            data["holdingRecords"],
            data.get("dailyProfit"),
        )
    print(f"已更新汇总: {summary_path}")
    if invest_output:
        print(f"投资数据: {invest_output}")
    print(f"资产记录: {len(data['assetRecords'])}")
    print(f"持仓记录: {len(data['holdingRecords'])}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="用 Appium/XCUITest 操作 iPhone 并导出当前页面信息。",
    )
    parser.add_argument("--check", action="store_true", help="检查本机依赖和已连接设备")
    parser.add_argument("--list-devices", action="store_true", help="列出 idevice_id 发现的设备 UDID")
    parser.add_argument("--alipay-assets", action="store_true", help="进入支付宝理财总资产,滚动截图全部持有明细")
    parser.add_argument("--caitong-assets", action="store_true", help="进入财通证券交易页,采集资产和持仓信息")
    parser.add_argument("--extract-existing-summary", type=Path, help="从已有 summary 引用的 XML 重新提取资产/持仓数据")
    parser.add_argument(
        "--invest-output",
        type=Path,
        help="支付宝投资数据导出路径。未指定时按当天日期写入 static/data/invest/YYYY/MM/DD/alipay.json",
    )
    parser.add_argument("--caitong-output", type=Path, help="财通证券投资数据导出路径。默认写入 alipay.json 同目录的 caitong.json")
    parser.add_argument("--caitong-out-dir", type=Path, default=CAITONG_OUT_DIR, help=f"财通证券临时输出目录,默认 {CAITONG_OUT_DIR}")
    parser.add_argument("--caitong-bundle-id", default=CAITONG_BUNDLE_ID, help=f"财通证券 bundle id,默认 {CAITONG_BUNDLE_ID}")
    parser.add_argument("--skip-navigation", action="store_true", help="跳过导航,从当前页面直接滚动截图")
    parser.add_argument("--skip-caitong-navigation", action="store_true", help="跳过财通证券导航,从当前页面直接采集资产/持仓")
    parser.add_argument("--appium-url", default=DEFAULT_APPIUM_URL, help=f"Appium 服务地址,默认 {DEFAULT_APPIUM_URL}")
    parser.add_argument("--udid", help="iPhone UDID。未指定且只连接一台设备时自动识别")
    parser.add_argument("--bundle-id", default=DEFAULT_BUNDLE_ID, help=f"目标 App bundle id,默认 {DEFAULT_BUNDLE_ID}; --alipay-assets 默认使用 {ALIPAY_BUNDLE_ID}; --caitong-assets 默认使用 {CAITONG_BUNDLE_ID}")
    parser.add_argument("--device-name", help="可选:iPhone 设备名")
    parser.add_argument("--platform-version", help="可选:iOS 版本号")
    parser.add_argument("--safari-url", help="目标 App 是 Safari 时打开指定 URL")
    parser.add_argument("--wait", type=float, default=1.0, help="连接后等待秒数,默认 1")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help=f"输出目录,默认 {DEFAULT_OUT_DIR}")
    parser.add_argument("--find", action="append", default=[], help="在页面树中检查文本是否存在,可重复传入")
    parser.add_argument("--max-screens", type=int, default=40, help="滚动截图最大屏数,默认 40")
    parser.add_argument("--nav-timeout", type=float, default=20, help="等待支付宝导航入口秒数,默认 20")
    parser.add_argument("--manual-timeout", type=float, default=120, help="等待手动完成登录/人脸/密码校验秒数,默认 120")
    parser.add_argument("--sync-caitong", action=argparse.BooleanOptionalAction, default=True, help="支付宝采集完成后同步财通证券资产和持仓,默认开启")
    parser.add_argument("--continue-after-caitong-error", action="store_true", help="财通证券同步失败后继续执行后续流程")
    parser.add_argument("--caitong-max-screens", type=int, default=20, help="财通证券持仓滚动截图最大屏数,默认 20")
    parser.add_argument("--start-health-server", action=argparse.BooleanOptionalAction, default=True, help="支付宝采集完成后启动 Health Auto Export 服务器,默认开启")
    parser.add_argument("--step-wait", type=float, default=1.5, help="点击或滚动后的等待秒数,默认 1.5")
    parser.add_argument("--new-command-timeout", type=int, default=300, help="Appium newCommandTimeout,默认 300")
    parser.add_argument("--show-xcode-log", action="store_true", help="让 Appium 输出 Xcode/WDA 日志")
    parser.add_argument("--xcode-org-id", help="Apple Developer Team ID,用于签名 WebDriverAgent")
    parser.add_argument("--xcode-signing-id", default="iPhone Developer", help="WDA 签名证书名,默认 iPhone Developer")
    parser.add_argument("--updated-wda-bundle-id", help="自定义 WDA bundle id,例如 com.feei.WebDriverAgentRunner")
    parser.add_argument("--wda-local-port", type=int, help="WDA 本地端口,多设备并发时使用")
    parser.add_argument("--allow-provisioning-updates", action="store_true", help="允许 xcodebuild 自动创建/更新 WDA provisioning profile")
    parser.add_argument("--allow-provisioning-device-registration", action="store_true", help="允许 xcodebuild 自动注册设备到开发团队")
    args = parser.parse_args()
    args.caitong_trade_password = os.environ.get(CAITONG_TRADE_PASSWORD_ENV)
    if args.alipay_assets:
        if args.bundle_id == DEFAULT_BUNDLE_ID:
            args.bundle_id = ALIPAY_BUNDLE_ID
        if args.out_dir == DEFAULT_OUT_DIR:
            args.out_dir = ALIPAY_OUT_DIR
    if args.caitong_assets:
        if args.bundle_id == DEFAULT_BUNDLE_ID:
            args.bundle_id = args.caitong_bundle_id
        if not args.caitong_output:
            args.caitong_output = caitong_output_path_for_alipay_output(None)
    if (args.alipay_assets or args.extract_existing_summary) and not args.invest_output:
        args.invest_output = default_invest_output_path()
    if args.alipay_assets and not args.caitong_output:
        args.caitong_output = caitong_output_path_for_alipay_output(args.invest_output)
    return args


def main() -> int:
    args = parse_args()
    if args.check:
        return check_environment()
    if args.extract_existing_summary:
        return extract_existing_summary(args)
    if args.list_devices:
        for udid in list_udids():
            print(udid)
        return 0
    if args.caitong_assets:
        try:
            run_caitong_assets_flow(args)
            return 0
        except Exception as error:
            print(error, file=sys.stderr)
            return 1
    if args.alipay_assets:
        return run_alipay_assets_flow(args)
    return capture(args)


if __name__ == "__main__":
    raise SystemExit(main())
