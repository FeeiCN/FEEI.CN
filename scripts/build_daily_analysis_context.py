#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
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


def extract_finance_context(paths: list[Path], report_date: date) -> dict[str, Any]:
    payloads = []
    for path in paths:
        payload = load_json(path)
        if isinstance(payload, dict):
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

    return {
        "source_files": [path.as_posix() for path, _ in payloads],
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


def main() -> None:
    args = parse_args()
    report_date = date.fromisoformat(args.report_date)
    allowed_paths = [Path(value) for value in args.allowed_files]

    health_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/health/")]
    reading_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/reading/")]
    finance_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/account-assets/")]
    ai_paths = [path for path in allowed_paths if path.as_posix().startswith("static/data/llm-usage/")]
    hk_ipo_paths = [path for path in allowed_paths if path.as_posix() == "static/data/hk-ipo/data.json"]

    context = {
        "report_date": report_date.isoformat(),
        "allowed_files": [path.as_posix() for path in allowed_paths],
        "health": extract_health_context(health_paths, report_date),
        "reading": extract_reading_context(reading_paths, report_date),
        "finance": extract_finance_context(finance_paths, report_date),
        "ai_usage": extract_ai_context(ai_paths, report_date),
        "hk_ipo": extract_hk_ipo_context(hk_ipo_paths, report_date),
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(context, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
