#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Sync LLM token-usage summaries to static/llm-usage/<vendor>/.

Supports multiple vendors; each vendor has its own config + auth env var.
The fetched payload is dropped verbatim into
`static/llm-usage/<vendor>/usage_summary.json`, and the fetchedAt timestamp
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

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from status_page import update_status_page

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
OUT_DIR = REPO_ROOT / "static" / "llm-usage"
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
        "url": "https://api.openai.com/v1/usage",
        "auth_env": "OPENAI_ADMIN_KEY",
        "auth_header": "Authorization: Bearer {}",
        "accept": JSON_ACCEPT,
    },
}


def now_str() -> str:
    return datetime.now(tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def fetch_summary(vendor: str) -> dict[str, Any]:
    cfg = VENDOR_CONFIG[vendor]
    auth = os.environ.get(cfg["auth_env"], "").strip()
    if not auth:
        raise SystemExit(
            f"[{vendor}] 未设置 {cfg['auth_env']}，请先 export {cfg['auth_env']}=<凭证>"
        )

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


def write_summary(vendor: str, payload: dict[str, Any]) -> Path:
    target = OUT_DIR / vendor / "usage_summary.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    enriched = {"vendor": vendor, "fetchedAt": now_str(), **payload}
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
        description="拉取 LLM token 使用摘要并落盘到 static/llm-usage/，更新状态页"
    )
    parser.add_argument(
        "--vendor",
        action="append",
        default=[],
        help="仅刷新指定 vendor（可多次指定），默认刷新所有配置了凭证的 vendor",
    )
    args = parser.parse_args()

    requested = set(args.vendor) if args.vendor else None
    refreshed: list[str] = []
    for vendor in VENDOR_CONFIG:
        if requested and vendor not in requested:
            continue
        cfg = VENDOR_CONFIG[vendor]
        if not os.environ.get(cfg["auth_env"]):
            print(f"[skip] {vendor} 未设置 {cfg['auth_env']}", file=sys.stderr)
            continue
        refresh_vendor(vendor)
        refreshed.append(vendor)

    if not refreshed:
        print("[warn] 没有 vendor 被刷新", file=sys.stderr)
        return 1

    update_status_page(
        key="llm-usage",
        name="AI 使用数据",
        script="scripts/sync_llm_usage.py",
        status="成功",
        run_time=datetime.now(),
        outputs=collect_outputs(),
    )
    print(f"[info] refreshed vendors: {', '.join(refreshed)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
