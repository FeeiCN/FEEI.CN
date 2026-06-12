#!/usr/bin/env python3
"""WeRead API client utilities.

Provides the minimal call helpers shared by export scripts
(export_weread_data.py, refresh_injected_progress.py, ...):

  - api_call(api_name, **params)        — POST 到 weRead 网关，带 auth/重试
  - fetch_notebooks()                   — 拉取 /user/notebooks 全量（分页）
  - format_timestamp(ts)                — unix 时间戳 → "YYYY-MM-DD HH:MM:SS" 本地时区

调用方需自行 export WEREAD_API_KEY=<apikey>。
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from typing import Any


WE_READ_API_URL = "https://i.weread.qq.com/api/agent/gateway"
SKILL_VERSION = "1.0.3"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
NOTEBOOK_PAGE_SIZE = 100
API_RETRIES = 3

# 微信读书鉴权失败的常见 errcode；用于把 token 失效从普通 RuntimeError 中区分出来
WEREAD_AUTH_ERRCODES = {-2010, -2012, -2013, -2014}


class WeReadAuthError(RuntimeError):
    """WEREAD_API_KEY 鉴权失败，区别于网络/接口抖动。CI 入口据此返回退出码 2。"""


def _is_auth_error(data: dict[str, Any]) -> bool:
    code = data.get("errcode")
    if isinstance(code, int) and code in WEREAD_AUTH_ERRCODES:
        return True
    msg = str(data.get("errmsg") or data.get("errMsg") or "")
    if not msg:
        return False
    lowered = msg.lower()
    if "auth" in lowered or "token" in lowered or "unauthorized" in lowered:
        return True
    return any(keyword in msg for keyword in ("登录", "鉴权", "授权", "凭证"))


def api_call(api_name: str, **params: Any) -> dict[str, Any]:
    api_key = os.environ.get("WEREAD_API_KEY")
    if not api_key:
        raise SystemExit("未设置 WEREAD_API_KEY，请先 export WEREAD_API_KEY=<你的apikey>")

    payload = {"api_name": api_name, "skill_version": SKILL_VERSION, **params}
    request = Request(
        WE_READ_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(1, API_RETRIES + 1):
        try:
            with urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            if error.code in (401, 403):
                raise WeReadAuthError(f"微信读书接口 HTTP {error.code}") from error
            last_error = error
            if attempt < API_RETRIES:
                time.sleep(2 ** (attempt - 1))
                continue
            break
        except (URLError, json.JSONDecodeError) as error:
            last_error = error
            if attempt < API_RETRIES:
                time.sleep(2 ** (attempt - 1))
                continue
            break

        if isinstance(data, dict) and data.get("errcode", 0):
            if _is_auth_error(data):
                raise WeReadAuthError(f"微信读书接口鉴权失败: {data}")
            raise RuntimeError(f"微信读书接口返回错误: {data}")
        return data

    if isinstance(last_error, HTTPError):
        raise RuntimeError(f"微信读书接口 HTTP {last_error.code}") from last_error
    if isinstance(last_error, URLError):
        reason = getattr(last_error, "reason", last_error)
        raise RuntimeError(f"微信读书接口请求失败: {reason}") from last_error
    if isinstance(last_error, json.JSONDecodeError):
        raise RuntimeError(f"微信读书接口返回内容无法解析: {last_error}") from last_error
    raise RuntimeError("微信读书接口请求失败")


def fetch_notebooks() -> list[dict[str, Any]]:
    books: list[dict[str, Any]] = []
    last_sort: int | None = None

    while True:
        params: dict[str, Any] = {"count": NOTEBOOK_PAGE_SIZE}
        if last_sort is not None:
            params["lastSort"] = last_sort

        data = api_call("/user/notebooks", **params)
        page_books = data.get("books") or []
        books.extend(page_books)

        if not data.get("hasMore") or not page_books:
            break
        last_sort = int(page_books[-1].get("sort") or 0)
        if not last_sort:
            break

    return books


def format_timestamp(value: int | str | None) -> str:
    if not value:
        return ""
    ts = int(value)
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S")
