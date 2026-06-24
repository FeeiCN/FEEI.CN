#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Sync LLM token-usage summaries to static/data/llm-usage/<vendor>/.

Supports multiple vendors; each vendor has its own config + auth env var.
The fetched payload is dropped verbatim into
`static/data/llm-usage/<vendor>/usage_summary.json`, and the fetchedAt timestamp
is overlaid on top of the raw envelope so the front-end can position the
daily array on a calendar.

Run with no args to refresh every registered vendor whose auth is set.
Skip a vendor by unsetting its env var or by passing --vendor <name>.

Per-vendor auth: each entry in VENDOR_CONFIG declares `auth_env` (env var
name) and `auth_header` (a `"<Header-Name>: {}"` template; `{}` is replaced
by the env-var value). `extra_headers` is merged in verbatim. For vendors
that need a secondary token (e.g. group id), use `<VENDOR>_EXTRA_*` env vars
and reference them inside `extra_headers` via a custom fetcher.
"""

from __future__ import annotations
import subprocess

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from git_ops import git_commit_and_push_target_repo, git_pull_target_repo
from tz import BEIJING_TZ

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
OUT_DIR = REPO_ROOT / "static" / "data" / "llm-usage"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/148.0.0.0 Safari/537.36"
)
BROWSER_ACCEPT = "application/json, text/plain, */*"
JSON_ACCEPT = "application/json"
REQUEST_TIMEOUT = 30
RETRIES = 3

VENDOR_CONFIG: dict[str, dict[str, Any]] = {
    "minimax": {
        "url": "https://www.minimaxi.com/backend/account/token_plan/usage_summary",
        "auth_env": "MINIMAX_COOKIE",
        "auth_header": "Cookie: {}",
        "accept": BROWSER_ACCEPT,
        "extra_headers": {
            "Origin": "https://platform.minimaxi.com",
            "Referer": "https://platform.minimaxi.com/",
        },
    },
    "anthropic": {
        "url": "https://api.anthropic.com/v1/organizations/usage",
        "auth_env": "ANTHROPIC_ADMIN_KEY",
        "auth_header": "x-api-key: {}",
        "accept": JSON_ACCEPT,
        "extra_headers": {
            "anthropic-version": "2023-06-01",
        },
    },
    "openai": {
        "url": "https://ai.feei.cn/api/v1/admin/usage/stats",
        "auth_env": "OPENAI_ADMIN_KEY",
        "auth_header": "x-api-key: {}",
        "accept": JSON_ACCEPT,
        "custom_fetcher": "feeiai_usage_stats",
        "sync_days": 30,
        "user_id": "1",
    },
}


def now_str() -> str:
    return datetime.now(tz=BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")

def fetch_summary(vendor: str) -> dict[str, Any]:
    cfg = VENDOR_CONFIG[vendor]
    auth = os.environ.get(cfg["auth_env"], "").strip()
    if not auth:
        raise SystemExit(
            f"[{vendor}] 未设置 {cfg['auth_env']}，请先 export {cfg['auth_env']}=<凭证>"
        )

    if cfg.get("custom_fetcher") == "feeiai_usage_stats":
        return fetch_feeiai_usage_stats(vendor, cfg, auth)

    auth_template = cfg.get("auth_header") or "Cookie: {}"
    header_name, _, _ = auth_template.partition(":")
    headers: dict[str, str] = {
        header_name.strip(): auth_template.replace("{}", auth, 1),
        "User-Agent": USER_AGENT,
        "Accept": cfg.get("accept", JSON_ACCEPT),
    }
    for k, v in (cfg.get("extra_headers") or {}).items():
        headers[k] = v

    request = Request(cfg["url"], headers=headers)
    last_error: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return payload
        except (HTTPError, URLError, json.JSONDecodeError) as error:
            last_error = error
            if attempt < RETRIES:
                time.sleep(2 ** (attempt - 1))
                continue
            break
    raise RuntimeError(f"[{vendor}] 接口请求失败: {last_error}")


def _request_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = Request(url, headers=headers)
    last_error: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict):
                raise RuntimeError(f"接口返回不是 JSON object: {type(payload).__name__}")
            return payload
        except (HTTPError, URLError, json.JSONDecodeError, RuntimeError) as error:
            last_error = error
            if attempt < RETRIES:
                time.sleep(2 ** (attempt - 1))
                continue
            break
    raise RuntimeError(f"接口请求失败: {last_error}")


def fetch_feeiai_usage_stats(vendor: str, cfg: dict[str, Any], auth: str) -> dict[str, Any]:
    """Fetch daily OpenAI-compatible usage from ai.feei.cn.

    The endpoint returns one date range summary. We query each Beijing date
    separately so local history can keep date->tokens maps.
    """
    sync_days = int(os.environ.get("OPENAI_SYNC_DAYS") or cfg.get("sync_days") or 30)
    user_id = os.environ.get("OPENAI_USER_ID") or cfg.get("user_id")
    end_date = datetime.now(tz=BEIJING_TZ).date()
    start_date = end_date - timedelta(days=max(sync_days - 1, 0))
    headers = {
        "x-api-key": auth,
        "User-Agent": USER_AGENT,
        "Accept": cfg.get("accept", JSON_ACCEPT),
    }

    daily_token_usage: dict[str, int] = {}
    date_usage_stats: dict[str, Any] = {}
    total_requests = 0
    total_cost = 0.0
    total_actual_cost = 0.0

    day = start_date
    while day <= end_date:
        date_key = day.isoformat()
        query = urlencode(
            {
                "user_id": user_id,
                "start_date": date_key,
                "end_date": date_key,
                "timezone": "Asia/Shanghai",
            }
        )
        payload = _request_json(f"{cfg['url']}?{query}", headers)
        if payload.get("code") != 0:
            raise RuntimeError(
                f"[{vendor}] 接口报错 code={payload.get('code')} message={payload.get('message')}"
            )
        data = payload.get("data") or {}
        if not isinstance(data, dict):
            raise RuntimeError(f"[{vendor}] data 不是对象: {type(data).__name__}")

        total_tokens = int(data.get("total_tokens") or 0)
        if total_tokens > 0:
            daily_token_usage[date_key] = total_tokens
        total_requests += int(data.get("total_requests") or 0)
        total_cost += float(data.get("total_cost") or 0)
        total_actual_cost += float(data.get("total_actual_cost") or 0)
        date_usage_stats[date_key] = {
            "total_requests": int(data.get("total_requests") or 0),
            "total_input_tokens": int(data.get("total_input_tokens") or 0),
            "total_output_tokens": int(data.get("total_output_tokens") or 0),
            "total_cache_tokens": int(data.get("total_cache_tokens") or 0),
            "total_cache_creation_tokens": int(data.get("total_cache_creation_tokens") or 0),
            "total_cache_read_tokens": int(data.get("total_cache_read_tokens") or 0),
            "total_tokens": total_tokens,
            "total_cost": round(float(data.get("total_cost") or 0), 6),
            "total_actual_cost": round(float(data.get("total_actual_cost") or 0), 6),
            "average_duration_ms": data.get("average_duration_ms"),
        }
        day += timedelta(days=1)

    return {
        "source": "ai.feei.cn",
        "source_endpoint": cfg["url"],
        "timezone": "Asia/Shanghai",
        "sync_window": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "days": sync_days,
        },
        "daily_token_usage": daily_token_usage,
        "date_usage_stats": date_usage_stats,
        "window_total_requests": total_requests,
        "window_total_cost": round(total_cost, 6),
        "window_total_actual_cost": round(total_actual_cost, 6),
    }


def write_summary(vendor: str, payload: dict[str, Any]) -> Path:
    target = OUT_DIR / vendor / "usage_summary.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    enriched = {"vendor": vendor, "fetchedAt": now_str(), **payload}
    target.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _format_date(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _array_to_date_map(
    daily: list[Any], anchor_str: str
) -> dict[str, int]:
    """将 API 返回的 daily_token_usage 数组转成 date→tokens map。

    API 通常只返回到昨日的数据，所以数组最后一个元素对应 anchor 的前一天，
    倒推前面每一天的日期。
    """
    anchor = _parse_date(anchor_str)
    if anchor is None or not daily:
        return {}
    out: dict[str, int] = {}
    for idx, raw in enumerate(daily):
        days_ago = len(daily) - idx
        d = anchor - timedelta(days=days_ago)
        out[_format_date(d)] = int(raw or 0)
    return out


def _format_token_count(value: float) -> str:
    if value <= 0:
        return "0"
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}K"
    return str(int(value))


def merge_with_history(
    existing: dict[str, Any] | None,
    new: dict[str, Any],
    new_fetched_at: str,
) -> dict[str, Any]:
    """把新 daily_token_usage 与本地历史数据按日期合并，覆盖写回。

    远端只返回最近窗口（~30 天），但本地要保留全量历史。重复日期取较大值。
    同步重算 total_token_consumed / active_days / total_days /
    current_consecutive_days / most_active_day；usage_ranking_percent 保留最新 API 值。

    daily_token_usage 始终以 date→tokens 字典形式落盘（无数据的日期不入字典）。
    """
    new_daily = _normalize_daily(new.get("daily_token_usage"), new_fetched_at)
    existing_raw = (existing or {}).get("daily_token_usage") or {}
    existing_anchor = (existing or {}).get("fetchedAt") or new_fetched_at
    if isinstance(existing_raw, dict):
        existing_daily = {k: int(v or 0) for k, v in existing_raw.items() if int(v or 0) > 0}
    else:
        existing_daily = {
            k: v
            for k, v in _array_to_date_map(existing_raw, existing_anchor).items()
            if v > 0
        }

    new_active_days = sum(1 for v in new_daily.values() if v > 0)
    new_total_tokens = sum(new_daily.values())
    new_daily_avg = _format_token_count(
        new_total_tokens / new_active_days if new_active_days > 0 else 0
    )

    if not existing_daily:
        return {
            **new,
            "daily_token_usage": new_daily,
            "daily_avg_token_consumed": new_daily_avg,
        }

    merged_map: dict[str, int] = dict(existing_daily)
    for date_str, tokens in new_daily.items():
        prev = merged_map.get(date_str, 0)
        if tokens > prev:
            merged_map[date_str] = tokens

    if not merged_map:
        return {
            **new,
            "daily_token_usage": new_daily,
            "daily_avg_token_consumed": new_daily_avg,
        }

    sorted_dates = sorted(merged_map.keys())
    latest = datetime.strptime(sorted_dates[-1], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    today = _parse_date(new_fetched_at)
    streak_start = today - timedelta(days=1) if today else latest

    total_tokens = sum(merged_map.values())
    active_days = sum(1 for v in merged_map.values() if v > 0)

    consecutive = 0
    cur = streak_start
    while _format_date(cur) >= sorted_dates[0]:
        date_str = _format_date(cur)
        if merged_map.get(date_str, 0) > 0:
            consecutive += 1
            cur = cur - timedelta(days=1)
        else:
            break

    max_date = max(merged_map, key=lambda d: merged_map[d])
    max_tokens = merged_map[max_date]

    most_active = (new.get("most_active_day") or {}).copy() if isinstance(new.get("most_active_day"), dict) else {}
    most_active.update({
        "date": max_date,
        "token_count": _format_token_count(max_tokens),
    })

    merged_usage_stats = {}
    existing_usage_stats = (existing or {}).get("date_usage_stats") or {}
    new_usage_stats = new.get("date_usage_stats") or {}
    if isinstance(existing_usage_stats, dict):
        merged_usage_stats.update(existing_usage_stats)
    if isinstance(new_usage_stats, dict):
        merged_usage_stats.update(new_usage_stats)

    merged = {
        **new,
        "total_token_consumed": _format_token_count(total_tokens),
        "total_days": active_days,
        "active_days": active_days,
        "current_consecutive_days": consecutive,
        "most_active_day": most_active,
        "daily_token_usage": merged_map,
        "daily_avg_token_consumed": _format_token_count(
            total_tokens / active_days if active_days > 0 else 0
        ),
    }
    if merged_usage_stats:
        merged["date_usage_stats"] = merged_usage_stats
    return merged


def _normalize_daily(value: Any, anchor_str: str) -> dict[str, int]:
    """把 API 返回的 daily_token_usage 统一成 date→tokens 字典。"""
    if isinstance(value, dict):
        return {k: int(v or 0) for k, v in value.items() if int(v or 0) > 0}
    if not value:
        return {}
    return {k: v for k, v in _array_to_date_map(value, anchor_str).items() if v > 0}


def load_existing_summary(vendor: str) -> dict[str, Any] | None:
    path = OUT_DIR / vendor / "usage_summary.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_summary(vendor: str, payload: dict[str, Any]) -> Path:
    target = OUT_DIR / vendor / "usage_summary.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    fetched_at = now_str()
    merged = merge_with_history(load_existing_summary(vendor), payload, fetched_at)
    enriched = {"vendor": vendor, "fetchedAt": fetched_at, **merged}
    target.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def refresh_vendor(vendor: str) -> Path:
    print(f"[info] refreshing {vendor} ...", file=sys.stderr)
    payload = fetch_summary(vendor)
    base_resp = payload.get("base_resp") or {}
    if base_resp.get("status_code") not in (0, None):
        raise RuntimeError(
            f"[{vendor}] 接口报错 status_code={base_resp.get('status_code')} "
            f"status_msg={base_resp.get('status_msg')}"
        )
    path = write_summary(vendor, payload)
    print(f"[info] wrote {path.relative_to(REPO_ROOT)}", file=sys.stderr)
    return path


def collect_outputs() -> list[dict[str, str]]:
    return [
        {"title": "AI 使用数据", "slug": "/ai-usage-data"},
    ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="拉取 LLM token 使用摘要并落盘到 static/data/llm-usage/，更新状态页"
    )
    parser.add_argument(
        "--vendor",
        action="append",
        default=[],
        help="仅刷新指定 vendor（可多次指定），默认刷新所有配置了凭证的 vendor",
    )
    args = parser.parse_args()

    git_pull_target_repo(REPO_ROOT)
    requested = set(args.vendor) if args.vendor else None
    refreshed: list[str] = []
    written_paths: list[Path] = []
    failed: list[tuple[str, Exception]] = []
    for vendor in VENDOR_CONFIG:
        if requested and vendor not in requested:
            continue
        cfg = VENDOR_CONFIG[vendor]
        if not os.environ.get(cfg["auth_env"]):
            print(f"[skip] {vendor} 未设置 {cfg['auth_env']}", file=sys.stderr)
            continue
        try:
            written_paths.append(refresh_vendor(vendor))
            refreshed.append(vendor)
        except Exception as error:
            failed.append((vendor, error))
            print(f"[error] {vendor} 刷新失败: {error}", file=sys.stderr)
            continue

    if not refreshed:
        print("[warn] 没有 vendor 被刷新", file=sys.stderr)
        if failed:
            print(
                "[warn] failed vendors: "
                + ", ".join(vendor for vendor, _ in failed),
                file=sys.stderr,
            )
        return 1

    print(f"[info] refreshed vendors: {', '.join(refreshed)}", file=sys.stderr)
    if failed:
        print(
            "[warn] skipped failed vendors: "
            + ", ".join(vendor for vendor, _ in failed),
            file=sys.stderr,
        )
    git_commit_and_push_target_repo(
        written_paths,
        repo_root=REPO_ROOT,
        description="更新 LLM 使用数据",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
