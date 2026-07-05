#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build structured daily analysis context from allowed data files."
    )
    parser.add_argument("--report-date", required=True, help="Target date in YYYY-MM-DD")
    parser.add_argument(
        "--allowed-file",
        action="append",
        default=[],
        dest="allowed_files",
        help="Allowed input file path. Repeat this flag for each file.",
    )
    parser.add_argument("--output", required=True, help="Output JSON path")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any] | list[Any] | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def parse_day_key(value: str) -> date | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S %z",
        "%Y-%m-%d %H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def avg(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def safe_round(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def ratio_to_baseline(value: float | None, baseline: float | None, digits: int = 3) -> float | None:
    if value is None or baseline in (None, 0):
        return None
    return round(value / baseline, digits)


def extract_health_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    metric_aliases = {
        "step_count": "steps",
        "walking_running_distance": "distance_km",
        "active_energy": "active_energy_kj",
        "apple_exercise_time": "exercise_min",
        "apple_stand_hour": "stand_hours",
        "weight_body_mass": "weight_kg",
        "body_fat_percentage": "body_fat_pct",
        "body_mass_index": "bmi",
        "resting_heart_rate": "resting_hr",
        "walking_heart_rate_average": "walking_hr",
        "heart_rate_variability": "hrv_sdnn",
        "blood_oxygen_saturation": "oxygen_saturation",
        "lean_body_mass": "lean_body_mass_kg",
        "sleep_analysis": "sleep",
    }

    month_payloads: list[dict[str, Any]] = []
    for path in paths:
        payload = load_json(path)
        if isinstance(payload, dict):
            month_payloads.append(payload)

    metrics_by_name: dict[str, list[dict[str, Any]]] = {}
    exported_at: list[str] = []
    coverage_notes: list[str] = []

    for payload in month_payloads:
        exported = payload.get("exportedAt")
        if isinstance(exported, str):
            exported_at.append(exported)
        metrics = (
            (((payload.get("data") or {}).get("healthMetrics") or {}).get("metrics"))
            or []
        )
        for metric in metrics:
            name = metric.get("name")
            if not name:
                continue
            metrics_by_name.setdefault(name, []).extend(metric.get("data") or [])

    def value_for_metric(name: str, target: date) -> dict[str, Any] | None:
        items = metrics_by_name.get(name) or []
        for item in items:
            item_date = parse_day_key(str(item.get("date") or ""))
            if item_date == target:
                return item
        return None

    def series_for_metric(name: str, days: int) -> list[float]:
        items = metrics_by_name.get(name) or []
        start = report_date - timedelta(days=days)
        out: list[float] = []
        for item in items:
            item_date = parse_day_key(str(item.get("date") or ""))
            if item_date is None or item_date >= report_date or item_date < start:
                continue
            qty = item.get("qty")
            if isinstance(qty, (int, float)):
                out.append(float(qty))
        return out

    today_metrics: dict[str, Any] = {}
    baselines: dict[str, Any] = {}

    for raw_name, short_name in metric_aliases.items():
        record = value_for_metric(raw_name, report_date)
        if raw_name == "sleep_analysis":
            if record:
                today_metrics[short_name] = {
                    "total_sleep_hours": safe_round(float(record.get("totalSleep") or 0), 2),
                    "deep_sleep_hours": safe_round(float(record.get("deep") or 0), 2),
                    "rem_sleep_hours": safe_round(float(record.get("rem") or 0), 2),
                    "awake_hours": safe_round(float(record.get("awake") or 0), 2),
                    "source": record.get("source"),
                }
            baseline_sleep = []
            for item in metrics_by_name.get(raw_name) or []:
                item_date = parse_day_key(str(item.get("date") or ""))
                if item_date is None or item_date >= report_date or item_date < report_date - timedelta(days=7):
                    continue
                total_sleep = item.get("totalSleep")
                if isinstance(total_sleep, (int, float)):
                    baseline_sleep.append(float(total_sleep))
            baselines[short_name] = {
                "avg_7d": safe_round(avg(baseline_sleep), 2),
                "median_7d": safe_round(median(baseline_sleep), 2),
                "sample_size": len(baseline_sleep),
            }
            continue

        qty = None
        source = None
        if record:
            qty_raw = record.get("qty")
            if isinstance(qty_raw, (int, float)):
                qty = float(qty_raw)
            source = record.get("source")
        if raw_name == "walking_running_distance" and qty is not None:
            qty = qty / 1000.0
        if raw_name == "body_fat_percentage" and qty is not None:
            qty = qty
        today_metrics[short_name] = {
            "value": safe_round(qty, 2),
            "source": source,
        }
        baseline_values = series_for_metric(raw_name, 7)
        if raw_name == "walking_running_distance":
            baseline_values = [value / 1000.0 for value in baseline_values]
        baselines[short_name] = {
            "avg_7d": safe_round(avg(baseline_values), 2),
            "median_7d": safe_round(median(baseline_values), 2),
            "min_7d": safe_round(min(baseline_values), 2) if baseline_values else None,
            "max_7d": safe_round(max(baseline_values), 2) if baseline_values else None,
            "sample_size": len(baseline_values),
        }

    latest_export = max(
        (parse_datetime(value) for value in exported_at if parse_datetime(value)),
        default=None,
    )
    if latest_export:
        if latest_export.date() == report_date:
            coverage_notes.append("目标日健康数据可能仍是当日切片，需结合 exportedAt 判断是否全天完整。")
        elif latest_export.date() < report_date:
            coverage_notes.append("健康数据导出时间落后于目标日，可能存在同步延迟。")

    completeness_flags = {
        key: value
        for key, value in {
            "has_steps": today_metrics.get("steps", {}).get("value") is not None,
            "has_sleep": bool(today_metrics.get("sleep")),
            "has_weight": today_metrics.get("weight_kg", {}).get("value") is not None,
            "has_hrv": today_metrics.get("hrv_sdnn", {}).get("value") is not None,
        }.items()
    }

    recovery_summary = {
        "sleep_vs_7d_avg_hours": None,
        "resting_hr_vs_7d_avg": None,
        "hrv_vs_7d_avg": None,
    }
    if today_metrics.get("sleep"):
        sleep_value = today_metrics["sleep"].get("total_sleep_hours")
        sleep_avg = baselines.get("sleep", {}).get("avg_7d")
        if sleep_value is not None and sleep_avg is not None:
            recovery_summary["sleep_vs_7d_avg_hours"] = safe_round(sleep_value - sleep_avg, 2)
    for metric_key, baseline_key in (("resting_hr", "resting_hr"), ("hrv_sdnn", "hrv_sdnn")):
        value = today_metrics.get(metric_key, {}).get("value")
        baseline_avg = baselines.get(baseline_key, {}).get("avg_7d")
        if value is not None and baseline_avg is not None:
            recovery_summary[
                "resting_hr_vs_7d_avg" if metric_key == "resting_hr" else "hrv_vs_7d_avg"
            ] = safe_round(value - baseline_avg, 2)

    relative_position = {
        "steps_vs_7d_avg_ratio": ratio_to_baseline(
            today_metrics.get("steps", {}).get("value"),
            baselines.get("steps", {}).get("avg_7d"),
        ),
        "active_energy_vs_7d_avg_ratio": ratio_to_baseline(
            today_metrics.get("active_energy_kj", {}).get("value"),
            baselines.get("active_energy_kj", {}).get("avg_7d"),
        ),
        "hrv_vs_7d_avg_ratio": ratio_to_baseline(
            today_metrics.get("hrv_sdnn", {}).get("value"),
            baselines.get("hrv_sdnn", {}).get("avg_7d"),
        ),
        "weight_vs_7d_avg_delta": safe_round(
            (
                today_metrics.get("weight_kg", {}).get("value")
                - baselines.get("weight_kg", {}).get("avg_7d")
            )
            if today_metrics.get("weight_kg", {}).get("value") is not None
            and baselines.get("weight_kg", {}).get("avg_7d") is not None
            else None,
            2,
        ),
    }

    return {
        "source_files": [path.as_posix() for path in paths],
        "exported_at": sorted(exported_at),
        "today": today_metrics,
        "baseline_7d": baselines,
        "completeness": completeness_flags,
        "recovery_summary": recovery_summary,
        "relative_position": relative_position,
        "notes": coverage_notes,
    }


def extract_reading_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    monthly_path = None
    stats_path = None
    for path in paths:
        if path.name == "stats.json":
            stats_path = path
        elif (
            path.suffix == ".json"
            and path.parent.name == f"{report_date.year:04d}"
            and path.stem == f"{report_date.month:02d}"
        ):
            monthly_path = path

    monthly_payload = load_json(monthly_path) if monthly_path else None
    stats_payload = load_json(stats_path) if stats_path else None
    if not isinstance(monthly_payload, dict):
        return {"source_files": [p.as_posix() for p in paths], "missing": True}

    read_times = monthly_payload.get("readTimes") or {}
    compare = monthly_payload.get("compare")
    prefer_books = monthly_payload.get("readLongest") or []
    prefer_categories = monthly_payload.get("preferCategory") or []
    read_stat = monthly_payload.get("readStat") or []

    yearly_totals = {}
    if isinstance(stats_payload, dict):
        yearly_totals = stats_payload.get("totals") or {}

    target_key = str(int(datetime(report_date.year, report_date.month, report_date.day).timestamp()))

    def date_window_values(days: int) -> list[int]:
        out: list[int] = []
        for offset in range(1, days + 1):
            day = report_date - timedelta(days=offset)
            day_key = str(int(datetime(day.year, day.month, day.day).timestamp()))
            value = read_times.get(day_key)
            if isinstance(value, (int, float)):
                out.append(int(value))
        return out

    today_seconds = read_times.get(target_key)
    today_seconds_int = int(today_seconds) if isinstance(today_seconds, (int, float)) else None
    baseline_7d = date_window_values(7)
    baseline_30d = date_window_values(30)
    avg_7d = avg([float(v) for v in baseline_7d])
    avg_30d = avg([float(v) for v in baseline_30d])

    top_books = []
    for item in prefer_books[:5]:
        book = item.get("book") or {}
        top_books.append(
            {
                "title": book.get("title"),
                "author": book.get("author"),
                "read_time_seconds": item.get("readTime"),
                "tags": item.get("tags") or [],
            }
        )

    category_mix = []
    for item in prefer_categories[:6]:
        category_mix.append(
            {
                "title": item.get("categoryTitle"),
                "reading_time_seconds": item.get("readingTime"),
                "reading_count": item.get("readingCount"),
            }
        )

    return {
        "source_files": [p.as_posix() for p in paths],
        "fetched_at": monthly_payload.get("fetchedAt"),
        "today": {
            "read_seconds": today_seconds_int,
            "read_minutes": safe_round(today_seconds_int / 60.0, 1) if today_seconds_int is not None else None,
            "compare_to_previous_ratio": safe_round(float(compare), 3) if isinstance(compare, (int, float)) else None,
            "vs_7d_avg_ratio": ratio_to_baseline(
                float(today_seconds_int) if today_seconds_int is not None else None,
                avg_7d,
            ),
            "vs_30d_avg_ratio": ratio_to_baseline(
                float(today_seconds_int) if today_seconds_int is not None else None,
                avg_30d,
            ),
        },
        "baseline_7d": {
            "avg_seconds": safe_round(avg_7d, 1),
            "median_seconds": safe_round(median([float(v) for v in baseline_7d]), 1),
            "sample_size": len(baseline_7d),
        },
        "baseline_30d": {
            "avg_seconds": safe_round(avg_30d, 1),
            "sample_size": len(baseline_30d),
        },
        "month_stats": read_stat,
        "top_books": top_books,
        "category_mix": category_mix,
        "yearly_totals": yearly_totals,
    }


def _asset_record_amount(records: list[dict[str, Any]], *, fields: tuple[str, ...] = (), names: tuple[str, ...] = ()) -> float | None:
    for record in records:
        if fields and record.get("field") in fields and isinstance(record.get("amount"), (int, float)):
            return float(record["amount"])
        if names and record.get("name") in names and isinstance(record.get("amount"), (int, float)):
            return float(record["amount"])
    return None


def _summarize_invest_payload(path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    asset_records = [row for row in payload.get("assetRecords") or [] if isinstance(row, dict)]
    holding_records = [row for row in payload.get("holdingRecords") or [] if isinstance(row, dict)]
    source = payload.get("source") or path.stem

    total_asset = _asset_record_amount(
        asset_records,
        fields=("totalAsset",),
        names=("总资产", "总资产(人民币)"),
    )
    market_value = _asset_record_amount(asset_records, fields=("marketValue",), names=("证券总市值",))
    total_profit = _asset_record_amount(asset_records, fields=("totalProfit",), names=("总盈亏",))
    day_profit = _asset_record_amount(asset_records, fields=("dayProfit",), names=("当日参考盈亏",))
    position_ratio = _asset_record_amount(asset_records, fields=("positionRatio",), names=("仓位",))
    available_cash = _asset_record_amount(asset_records, fields=("availableCash",), names=("可用",))

    holding_amount_sum = payload.get("holdingAmountSum")
    if not isinstance(holding_amount_sum, (int, float)):
        holding_amount_sum = sum(float(row.get("amount") or 0) for row in holding_records)

    def profit_value(row: dict[str, Any]) -> float:
        for key in ("profit", "holdingProfit", "cumulativeProfit", "dayProfit"):
            value = row.get(key)
            if isinstance(value, (int, float)):
                return float(value)
        return 0.0

    top_holdings = sorted(
        holding_records,
        key=lambda row: float(row.get("amount") or row.get("marketValue") or 0),
        reverse=True,
    )[:8]
    largest_winners = sorted(holding_records, key=profit_value, reverse=True)[:5]
    largest_losers = sorted(holding_records, key=profit_value)[:5]

    return {
        "source": source,
        "source_file": path.as_posix(),
        "captured_at": payload.get("capturedAt"),
        "total_asset": safe_round(total_asset, 2),
        "market_value": safe_round(market_value, 2),
        "total_profit": safe_round(total_profit, 2),
        "day_profit": safe_round(day_profit, 2),
        "position_ratio": safe_round(position_ratio, 2),
        "available_cash": safe_round(available_cash, 2),
        "holding_count": payload.get("holdingCount") if isinstance(payload.get("holdingCount"), int) else len(holding_records),
        "holding_amount_sum": safe_round(float(holding_amount_sum), 2),
        "top_holdings": top_holdings,
        "largest_winners": largest_winners,
        "largest_losers": largest_losers,
    }


def extract_finance_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    payloads = []
    invest_payloads = []
    for path in paths:
        payload = load_json(path)
        if isinstance(payload, dict):
            if path.as_posix().startswith("static/data/invest/") and path.name != "index.json":
                invest_payloads.append((path, payload))
            else:
                payloads.append((path, payload))

    account_daily = []
    positions = []
    fetched_at = []

    for path, payload in payloads:
        fetched = payload.get("fetchedAt")
        if isinstance(fetched, str):
            fetched_at.append(fetched)
        for row in payload.get("fundRows") or []:
            if row.get("date") == report_date.isoformat():
                account_daily.append(row)
        for row in payload.get("positionRows") or []:
            positions.append(row)

    daily_by_account = {row.get("accountLabel"): row for row in account_daily}

    total_assets = 0.0
    total_delta = 0.0
    total_market = 0.0
    total_cash = 0.0
    for row in account_daily:
        total_assets += float(row.get("totalAssets") or 0)
        total_delta += float(row.get("totalAssetsDelta") or 0)
        total_market += float(row.get("marketVal") or 0)
        total_cash += float(row.get("cash") or 0)

    summary_rows = [row for row in positions if row.get("isSummary") is True]
    detail_rows = [row for row in positions if row.get("isSummary") is not True]
    largest_winners = sorted(
        detail_rows,
        key=lambda row: float(row.get("plVal") or 0),
        reverse=True,
    )[:5]
    largest_losers = sorted(
        detail_rows,
        key=lambda row: float(row.get("plVal") or 0),
    )[:5]

    account_contributions = []
    for row in account_daily:
        delta = float(row.get("totalAssetsDelta") or 0)
        contribution_ratio = None
        if total_delta:
            contribution_ratio = safe_round(delta / total_delta, 3)
        account_contributions.append(
            {
                "account_label": row.get("accountLabel"),
                "total_assets": safe_round(float(row.get("totalAssets") or 0), 1),
                "total_assets_delta": safe_round(delta, 1),
                "delta_contribution_ratio": contribution_ratio,
                "market_value": safe_round(float(row.get("marketVal") or 0), 1),
                "cash": safe_round(float(row.get("cash") or 0), 1),
            }
        )

    investment_sources = [
        _summarize_invest_payload(path, payload)
        for path, payload in sorted(invest_payloads, key=lambda item: item[0].as_posix())
    ]
    investment_total_assets = sum(
        float(source.get("total_asset") or source.get("holding_amount_sum") or 0)
        for source in investment_sources
    )
    investment_market_value = sum(float(source.get("market_value") or 0) for source in investment_sources)
    investment_cash = sum(float(source.get("available_cash") or 0) for source in investment_sources)

    return {
        "source_files": [path.as_posix() for path, _ in payloads + invest_payloads],
        "fetched_at": sorted(fetched_at),
        "today": {
            "accounts": account_daily,
            "total_assets": safe_round(total_assets, 1),
            "total_assets_delta": safe_round(total_delta, 1),
            "total_market_value": safe_round(total_market, 1),
            "total_cash": safe_round(total_cash, 1),
            "cash_ratio": ratio_to_baseline(total_cash, total_assets),
            "market_value_ratio": ratio_to_baseline(total_market, total_assets),
        },
        "account_contributions": account_contributions,
        "summary_rows": summary_rows,
        "largest_winners": largest_winners,
        "largest_losers": largest_losers,
        "account_count": len(daily_by_account),
        "investment": {
            "source_count": len(investment_sources),
            "sources": investment_sources,
            "total_assets": safe_round(investment_total_assets, 2),
            "market_value": safe_round(investment_market_value, 2),
            "available_cash": safe_round(investment_cash, 2),
            "market_value_ratio": ratio_to_baseline(investment_market_value, investment_total_assets),
            "cash_ratio": ratio_to_baseline(investment_cash, investment_total_assets),
        },
    }


def extract_ai_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    entries = []
    target_key = report_date.isoformat()

    for path in paths:
        payload = load_json(path)
        if not isinstance(payload, dict):
            continue
        vendor = payload.get("vendor") or path.parent.name
        daily = payload.get("daily_token_usage") or {}
        today_value = daily.get(target_key)
        recent: list[dict[str, Any]] = []
        for offset in range(1, 8):
            day = report_date - timedelta(days=offset)
            value = daily.get(day.isoformat())
            if isinstance(value, (int, float)):
                recent.append({"date": day.isoformat(), "tokens": int(value)})
        model_usage = payload.get("date_model_usage") or {}
        if isinstance(model_usage, list):
            normalized_model_usage: dict[str, Any] = {}
            for item in model_usage:
                if not isinstance(item, dict):
                    continue
                key = item.get("date") or item.get("key")
                value = item.get("models") or item.get("value")
                if key:
                    normalized_model_usage[str(key)] = value
            model_usage = normalized_model_usage
        if not isinstance(model_usage, dict):
            model_usage = {}
        entries.append(
            {
                "vendor": vendor,
                "fetched_at": payload.get("fetchedAt"),
                "today_tokens": int(today_value) if isinstance(today_value, (int, float)) else None,
                "baseline_7d_avg": safe_round(avg([float(item["tokens"]) for item in recent]), 1),
                "today_vs_7d_avg_ratio": ratio_to_baseline(
                    float(today_value) if isinstance(today_value, (int, float)) else None,
                    avg([float(item["tokens"]) for item in recent]),
                ),
                "recent_days": recent,
                "current_consecutive_days": payload.get("current_consecutive_days"),
                "total_days": payload.get("total_days"),
                "total_token_consumed": payload.get("total_token_consumed"),
                "top_models_today": model_usage.get(target_key),
            }
        )

    return {
        "source_files": [path.as_posix() for path in paths],
        "vendors": entries,
    }


def extract_hk_ipo_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    path = paths[0] if paths else None
    payload = load_json(path) if path else None
    if not isinstance(payload, dict):
        return {"source_files": [path.as_posix() for path in paths] if path else []}

    rows = payload.get("records") or payload.get("data") or payload.get("items") or []
    target = []
    report_key = report_date.isoformat()
    for row in rows:
        values = [str(row.get(key) or "") for key in ("date", "tradeDate", "listingDate")]
        if report_key in values:
            target.append(row)

    return {
        "source_files": [path.as_posix() for path in paths],
        "fetched_at": payload.get("fetchedAt"),
        "summary": payload.get("summary"),
        "target_day_records": target,
    }


def _first_value(items: Any, key: str = "value") -> Any:
    if isinstance(items, list) and items and isinstance(items[0], dict):
        return items[0].get(key)
    return None


def extract_weather_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    path = paths[0] if paths else None
    payload = load_json(path) if path else None
    if not isinstance(payload, dict):
        return {
            "source_files": [path.as_posix() for path in paths] if path else [],
            "missing": True,
        }

    current_raw = (payload.get("current_condition") or [{}])[0]
    area_raw = (payload.get("nearest_area") or [{}])[0]
    forecast_raw = None
    for item in payload.get("weather") or []:
        if item.get("date") == report_date.isoformat():
            forecast_raw = item
            break

    hourly_summary = []
    if isinstance(forecast_raw, dict):
        for item in forecast_raw.get("hourly") or []:
            desc = _first_value(item.get("lang_zh-cn")) or _first_value(item.get("weatherDesc"))
            hourly_summary.append(
                {
                    "time": item.get("time"),
                    "description": desc,
                    "temp_c": item.get("tempC"),
                    "feels_like_c": item.get("FeelsLikeC"),
                    "chance_of_rain": item.get("chanceofrain"),
                    "precip_mm": item.get("precipMM"),
                    "humidity": item.get("humidity"),
                    "wind_kmph": item.get("windspeedKmph"),
                    "uv_index": item.get("uvIndex"),
                }
            )

    current_desc = _first_value(current_raw.get("lang_zh-cn")) or _first_value(current_raw.get("weatherDesc"))
    area = {
        "name": _first_value(area_raw.get("areaName")),
        "region": _first_value(area_raw.get("region")),
        "country": _first_value(area_raw.get("country")),
        "latitude": area_raw.get("latitude"),
        "longitude": area_raw.get("longitude"),
    }

    return {
        "source_files": [path.as_posix() for path in paths],
        "missing": False,
        "current": {
            "description": current_desc,
            "temp_c": current_raw.get("temp_C"),
            "feels_like_c": current_raw.get("FeelsLikeC"),
            "humidity": current_raw.get("humidity"),
            "precip_mm": current_raw.get("precipMM"),
            "wind_kmph": current_raw.get("windspeedKmph"),
            "observation_time": current_raw.get("observation_time"),
        },
        "area": area,
        "forecast": {
            "date": forecast_raw.get("date") if isinstance(forecast_raw, dict) else None,
            "min_temp_c": forecast_raw.get("mintempC") if isinstance(forecast_raw, dict) else None,
            "max_temp_c": forecast_raw.get("maxtempC") if isinstance(forecast_raw, dict) else None,
            "avg_temp_c": forecast_raw.get("avgtempC") if isinstance(forecast_raw, dict) else None,
            "sun_hour": forecast_raw.get("sunHour") if isinstance(forecast_raw, dict) else None,
            "uv_index": forecast_raw.get("uvIndex") if isinstance(forecast_raw, dict) else None,
            "astronomy": (forecast_raw.get("astronomy") or [None])[0] if isinstance(forecast_raw, dict) else None,
            "hourly": hourly_summary,
        },
    }


def extract_drive_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    path = paths[0] if paths else None
    payload = load_json(path) if path else None
    if not isinstance(payload, dict):
        return {
            "source_files": [path.as_posix() for path in paths] if path else [],
            "missing": True,
            "events": [],
            "event_count": 0,
        }

    events = []
    for time_key, value in sorted(payload.items()):
        if not isinstance(value, dict):
            continue
        events.append(
            {
                "time": time_key,
                "datetime": f"{report_date.isoformat()} {time_key}",
                "action": value.get("action"),
                "address": value.get("address"),
            }
        )

    trips = []
    pending_start = None
    for event in events:
        if event.get("action") == "上车":
            pending_start = event
        elif event.get("action") == "下车" and pending_start:
            trips.append({"start": pending_start, "end": event})
            pending_start = None

    return {
        "source_files": [path.as_posix() for path in paths],
        "missing": False,
        "events": events,
        "event_count": len(events),
        "trips": trips,
        "unpaired_event": pending_start,
    }


def extract_daily_diary_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    path = paths[0] if paths else None
    if not path or not path.is_file():
        return {
            "source_files": [path.as_posix() for path in paths] if path else [],
            "missing": True,
        }

    text = path.read_text(encoding="utf-8").strip()
    paragraphs = [item.strip() for item in text.split("\n\n") if item.strip()]
    image_count = text.count("![")
    link_count = text.count("](")
    preview_paragraphs = []
    for paragraph in paragraphs[:6]:
        compact = " ".join(paragraph.split())
        if len(compact) > 220:
            compact = compact[:217].rstrip() + "..."
        preview_paragraphs.append(compact)

    return {
        "source_files": [path.as_posix()],
        "missing": False,
        "date": report_date.isoformat(),
        "char_count": len(text),
        "paragraph_count": len(paragraphs),
        "image_count": image_count,
        "link_count": link_count,
        "preview_paragraphs": preview_paragraphs,
        "full_text": text[:6000],
        "truncated": len(text) > 6000,
    }


def extract_git_context(report_date: date) -> dict[str, Any]:
    since = f"{report_date.isoformat()} 00:00:00 +0800"
    until = f"{(report_date + timedelta(days=1)).isoformat()} 00:00:00 +0800"
    command = [
        "git",
        "log",
        "--date=iso-strict",
        f"--since={since}",
        f"--until={until}",
        "--pretty=format:%H%x1f%h%x1f%ad%x1f%s%x1e",
        "--",
    ]
    try:
        completed = subprocess.run(command, check=True, text=True, capture_output=True)
    except Exception as exc:
        return {"available": False, "error": str(exc), "commits": [], "commit_count": 0}

    commits = []
    for raw in completed.stdout.split("\x1e"):
        raw = raw.strip()
        if not raw:
            continue
        parts = raw.split("\x1f")
        if len(parts) != 4:
            continue
        full_hash, short_hash, committed_at, subject = parts
        commits.append(
            {
                "hash": short_hash,
                "full_hash": full_hash,
                "committed_at": committed_at,
                "subject": subject,
            }
        )

    return {
        "available": True,
        "since": since,
        "until": until,
        "commit_count": len(commits),
        "commits": commits[:30],
    }


def main() -> None:
    args = parse_args()
    report_date = date.fromisoformat(args.report_date)
    allowed_paths = [Path(value) for value in args.allowed_files]

    health_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/health/")]
    reading_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/reading/")]
    finance_paths = [
        path
        for path in allowed_paths
        if path.as_posix().startswith("static/data/account-assets/")
        or path.as_posix().startswith("static/data/invest/")
    ]
    ai_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/llm-usage/")]
    hk_ipo_paths = [path for path in allowed_paths if path.as_posix() == "static/data/hk-ipo/data.json"]
    weather_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/weather/")]
    drive_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/drive/")]
    daily_diary_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/daily/")]

    context = {
        "report_date": report_date.isoformat(),
        "allowed_files": [path.as_posix() for path in allowed_paths],
        "health": extract_health_context(health_paths, report_date),
        "reading": extract_reading_context(reading_paths, report_date),
        "finance": extract_finance_context(finance_paths, report_date),
        "ai_usage": extract_ai_context(ai_paths, report_date),
        "hk_ipo": extract_hk_ipo_context(hk_ipo_paths, report_date),
        "weather": extract_weather_context(weather_paths, report_date),
        "drive": extract_drive_context(drive_paths, report_date),
        "daily_diary": extract_daily_diary_context(daily_diary_paths, report_date),
        "git_activity": extract_git_context(report_date),
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(context, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
