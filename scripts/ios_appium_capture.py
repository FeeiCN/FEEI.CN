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


def tap_relative(driver: Any, x_ratio: float, y_ratio: float) -> tuple[int, int]:
    size = driver.get_window_size()
    x = int(size.get("width", 390) * x_ratio)
    y = int(size.get("height", 844) * y_ratio)
    try:
        driver.execute_script("mobile: tap", {"x": x, "y": y})
    except Exception:
        driver.tap([(x, y)], 100)
    return x, y


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


def build_invest_export(
    summary_path: Path,
    captured_at: str | None,
    asset_records: list[dict[str, Any]],
    holding_records: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
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


def write_invest_export(
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
        build_invest_export(
            summary_path,
            captured_at,
            asset_records,
            holding_records,
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
        "解锁支付宝",
    ]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        source = driver.page_source
        if not any(text in source for text in login_or_auth_patterns):
            return "未检测到登录或安全校验阻断"
        time.sleep(2)
    return "仍可能停留在登录或安全校验页面"


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
        time.sleep(args.wait)
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
                tapped = tap_any_text(driver, ["理财", "财富"], timeout=args.nav_timeout)
                if not tapped:
                    stop_reason = "未找到「理财」或「财富」入口"
                    raise RuntimeError(stop_reason)
                navigation.append({"step": "tapFinance", "text": tapped})
                print(f"已点击入口: {tapped}", flush=True)
                time.sleep(args.step_wait)
                dismissed = dismiss_optional_overlays(driver)
                if dismissed:
                    navigation.append({"step": "dismissFinanceOverlays", "texts": dismissed})

            auth_status = wait_for_manual_unblock(driver, args.manual_timeout)
            navigation.append({"step": "manualUnblockAfterFinance", "status": auth_status})
            print(f"理财页校验状态: {auth_status}", flush=True)

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
                time.sleep(args.step_wait)

            auth_status = wait_for_manual_unblock(driver, args.manual_timeout)
            navigation.append({"step": "manualUnblockAfterTotalAssets", "status": auth_status})
            print(f"总资产页校验状态: {auth_status}", flush=True)

            scroll_to_top(driver)
            tapped = tap_any_text(
                driver,
                ["我的资产", "总资产："],
                timeout=args.nav_timeout,
                contains=True,
            )
            if tapped:
                navigation.append({"step": "tapMyAssets", "text": tapped})
                print(f"已点击我的资产入口: {tapped}", flush=True)
                time.sleep(args.step_wait)
            else:
                x, y = tap_relative(driver, 0.26, 0.23)
                navigation.append(
                    {
                        "step": "tapMyAssets",
                        "text": None,
                        "coordinates": {"x": x, "y": y},
                        "note": "未找到我的资产文本入口,已点击总资产页顶部总资产金额区域",
                    }
                )
                print(f"未找到我的资产文本入口,已点击坐标 ({x}, {y})", flush=True)
                time.sleep(args.step_wait)

            tapped = tap_any_text(
                driver,
                ["全部持有", "持有明细", "持有", "查看全部"],
                timeout=args.nav_timeout,
                contains=True,
            )
            if tapped:
                navigation.append({"step": "tapHoldingDetails", "text": tapped})
                print(f"已点击持有明细入口: {tapped}", flush=True)
                time.sleep(args.step_wait)
            else:
                navigation.append(
                    {
                        "step": "tapHoldingDetails",
                        "text": None,
                        "note": "未找到更深一层入口,从当前页面开始滚动截图",
                    }
                )
                print("未找到持有明细入口,将从当前页面开始滚动截图", flush=True)

        holding_files, stop_reason = capture_scrolling_area(
            driver,
            out_dir,
            session_id,
            "holding-detail",
            max_screens=args.max_screens,
            settle_seconds=args.step_wait,
        )
        files.extend(holding_files)

        summary_path = out_dir / f"{session_id}-summary.json"
        captured_at = datetime.now().astimezone().isoformat(timespec="seconds")
        asset_records = extract_asset_records(files)
        holding_records = extract_holding_records(files)
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
        invest_output = write_invest_export(
            args.invest_output,
            summary_path,
            captured_at,
            asset_records,
            holding_records,
        )
        print(f"支付宝理财持有明细截图: {out_dir}")
        print(f"汇总: {summary_path}")
        if invest_output:
            print(f"投资数据: {invest_output}")
        print(f"停止原因: {stop_reason}")
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
        driver.quit()


def extract_existing_summary(args: argparse.Namespace) -> int:
    summary_path = args.extract_existing_summary.expanduser().resolve()
    data = json.loads(summary_path.read_text(encoding="utf-8"))
    files = data.get("files", [])
    if not isinstance(files, list):
        print(f"summary files 字段格式不正确: {summary_path}", file=sys.stderr)
        return 2
    data["assetRecords"] = extract_asset_records(files)
    data["holdingRecords"] = extract_holding_records(files)
    data["extractedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(summary_path, data)
    invest_output = write_invest_export(
        args.invest_output,
        summary_path,
        data.get("capturedAt"),
        data["assetRecords"],
        data["holdingRecords"],
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
    parser.add_argument("--extract-existing-summary", type=Path, help="从已有 summary 引用的 XML 重新提取资产/持仓数据")
    parser.add_argument(
        "--invest-output",
        type=Path,
        help="支付宝投资数据导出路径。未指定时按当天日期写入 static/data/invest/YYYY/MM/DD/alipay.json",
    )
    parser.add_argument("--skip-navigation", action="store_true", help="跳过导航,从当前页面直接滚动截图")
    parser.add_argument("--appium-url", default=DEFAULT_APPIUM_URL, help=f"Appium 服务地址,默认 {DEFAULT_APPIUM_URL}")
    parser.add_argument("--udid", help="iPhone UDID。未指定且只连接一台设备时自动识别")
    parser.add_argument("--bundle-id", default=DEFAULT_BUNDLE_ID, help=f"目标 App bundle id,默认 {DEFAULT_BUNDLE_ID}; --alipay-assets 默认使用 {ALIPAY_BUNDLE_ID}")
    parser.add_argument("--device-name", help="可选:iPhone 设备名")
    parser.add_argument("--platform-version", help="可选:iOS 版本号")
    parser.add_argument("--safari-url", help="目标 App 是 Safari 时打开指定 URL")
    parser.add_argument("--wait", type=float, default=1.0, help="连接后等待秒数,默认 1")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help=f"输出目录,默认 {DEFAULT_OUT_DIR}")
    parser.add_argument("--find", action="append", default=[], help="在页面树中检查文本是否存在,可重复传入")
    parser.add_argument("--max-screens", type=int, default=40, help="滚动截图最大屏数,默认 40")
    parser.add_argument("--nav-timeout", type=float, default=20, help="等待支付宝导航入口秒数,默认 20")
    parser.add_argument("--manual-timeout", type=float, default=120, help="等待手动完成登录/人脸/密码校验秒数,默认 120")
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
    if args.alipay_assets:
        if args.bundle_id == DEFAULT_BUNDLE_ID:
            args.bundle_id = ALIPAY_BUNDLE_ID
        if args.out_dir == DEFAULT_OUT_DIR:
            args.out_dir = ALIPAY_OUT_DIR
    if (args.alipay_assets or args.extract_existing_summary) and not args.invest_output:
        args.invest_output = default_invest_output_path()
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
    if args.alipay_assets:
        return run_alipay_assets_flow(args)
    return capture(args)


if __name__ == "__main__":
    raise SystemExit(main())
