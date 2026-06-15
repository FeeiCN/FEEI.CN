#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""免费多 Provider 翻译（英 → 中为主，可换目标语）。

抽离自 `~/Documents/auto-translate/src/background.js` 的翻译链路，
去掉 Chrome MV3 / 浏览器侧依赖，做成可被其它 Python 脚本 import 的工具。

特性
- Provider 链：MyMemory → Google GTX → LibreTranslate（按可用性与冷却自动降级）
- 限流 429 自动退避，Provider 级冷却
- 请求去重（同一进程内并发相同请求只发一次）
- 节流：相邻请求最小间隔，默认 800ms
- 失败重试：可重试错误指数退避，最多 2 次
- 本地文件缓存：JSON 落到 `scripts/cache/translation_cache.json`，7 天 TTL
- 源语言检测：基于 Unicode 范围（CJK / 日韩 / 西里尔 / 阿拉伯 / 拉丁）
- 短文本直发；长文本按段落切块后逐块翻译，再拼回

CLI: python translate_text.py "Hello world" [--source en] [--target zh-CN]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
JSON_ACCEPT = "application/json,text/plain,*/*"

REQUEST_MIN_INTERVAL_MS = 800
MAX_RETRY_ATTEMPTS = 2
RETRY_BASE_DELAY_MS = 1200
RATE_LIMIT_COOLDOWN_MS = 60 * 1000
CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
CACHE_VERSION = "v1"

DEFAULT_TIMEOUT = 20.0
MAX_CHARS_PER_REQUEST = 450
MAX_CHARS_PER_CHUNK = 1200
PROVIDER_ORDER = ("mymemory", "googlegtx", "libretranslate")

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CACHE_PATH = SCRIPT_DIR / "cache" / "translation_cache.json"

_provider_cooldown_until: dict[str, float] = {}
_current_provider_index = 0
_inflight_requests: dict[str, "TranslateResult"] = {}
_throttle_lock = threading.Lock()
_throttle_last_at = 0.0


@dataclass
class TranslateResult:
    text: str
    provider_id: str
    detected_source: str
    pairs: list[tuple[str, str]] | None = None
    bilingual: bool = False


class TranslationError(RuntimeError):
    def __init__(self, message: str, *, is_rate_limited: bool = False, retry_after_ms: int = 0) -> None:
        super().__init__(message)
        self.is_rate_limited = is_rate_limited
        self.retry_after_ms = retry_after_ms


def _parse_retry_after_ms(value: str | None) -> int:
    if not value:
        return RATE_LIMIT_COOLDOWN_MS
    try:
        seconds = float(value)
        if seconds > 0:
            return int(seconds * 1000)
    except (TypeError, ValueError):
        pass
    return RATE_LIMIT_COOLDOWN_MS


def _rate_limit_error(retry_after_ms: int) -> TranslationError:
    return TranslationError("HTTP 429", is_rate_limited=True, retry_after_ms=retry_after_ms)


def _normalize_language_code(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if not text or text.lower() == "auto":
        return ""
    if "-" in text:
        base, _, region = text.partition("-")
        if not base or not region:
            return ""
        return f"{base.lower()}-{region.upper()}"
    return text.lower()


def detect_source_language(text: str) -> str:
    if not text:
        return ""
    if re.search(r"[぀-ヿ]", text):
        return "ja"
    if re.search(r"[가-힯]", text):
        return "ko"
    if re.search(r"[一-鿿]", text):
        return "zh-CN"
    if re.search(r"[Ѐ-ӿ]", text):
        return "ru"
    if re.search(r"[؀-ۿ]", text):
        return "ar"
    if re.search(r"[֐-׿]", text):
        return "he"
    if re.search(r"[฀-๿]", text):
        return "th"
    if re.search(r"[ऀ-ॿ]", text):
        return "hi"
    if re.search(r"[A-Za-z]", text):
        return "en"
    return ""


def _map_language_for_mymemory(code: str) -> str:
    normalized = _normalize_language_code(code)
    if not normalized:
        return ""
    if normalized.startswith("zh"):
        return normalized if "-" in normalized else "zh-CN"
    return normalized


def _map_language_for_libretranslate(code: str) -> str:
    normalized = _normalize_language_code(code)
    if not normalized:
        return "auto"
    if normalized.startswith("zh"):
        return "zh"
    if "-" in normalized:
        return normalized.split("-", 1)[0]
    return normalized


def _map_language_for_google(code: str) -> str:
    normalized = _normalize_language_code(code)
    return normalized or "auto"


def is_english_text(text: str, *, min_latin_ratio: float = 0.6, min_latin_chars: int = 40) -> bool:
    """粗略判断一段文本是否主要使用拉丁字母（英语为主）。

    用途：抓取到的网页 Markdown 中如果主体是英文，则调用翻译；
    短文本（拉丁字母 < `min_latin_chars`）和含较多 CJK 字符的文本都视为非英语。
    """
    if not text:
        return False
    latin = len(re.findall(r"[A-Za-z]", text))
    total_letters = latin + len(re.findall(r"[一-鿿぀-ヿ가-힯]", text))
    if latin < min_latin_chars:
        return False
    if total_letters == 0:
        return False
    return latin / total_letters >= min_latin_ratio


def _fetch_json(url: str, *, method: str = "GET", payload: dict[str, Any] | None = None, timeout: float = DEFAULT_TIMEOUT) -> tuple[Any, dict[str, str]]:
    headers = {"User-Agent": USER_AGENT, "Accept": JSON_ACCEPT}
    data: bytes | None = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("content-type") or ""
            raw = response.read()
            header_map = {k.lower(): v for k, v in response.headers.items()}
    except HTTPError as error:
        header_map = {k.lower(): v for k, v in error.headers.items()} if error.headers else {}
        raise TranslationError(f"HTTP {error.code}") from error
    except URLError as error:
        raise TranslationError(str(error.reason)) from error

    if "json" not in content_type.lower():
        raise TranslationError(f"unexpected content-type: {content_type}")
    try:
        return json.loads(raw.decode("utf-8", errors="replace")), header_map
    except json.JSONDecodeError as error:
        raise TranslationError(f"invalid json: {error}") from error


def _request_mymemory(text: str, source: str, target: str, *, timeout: float) -> str:
    src = _map_language_for_mymemory(source)
    dst = _map_language_for_mymemory(target)
    if not src or not dst:
        raise TranslationError("MyMemory requires explicit source and target languages")
    url = "https://api.mymemory.translated.net/get?" + urlencode({"q": text, "langpair": f"{src}|{dst}"})
    try:
        payload, _ = _fetch_json(url, timeout=timeout)
    except TranslationError as error:
        if str(error).startswith("HTTP 429"):
            raise _rate_limit_error(RATE_LIMIT_COOLDOWN_MS) from error
        raise

    response_status = int((payload or {}).get("responseStatus") or 0)
    if response_status == 429:
        raise _rate_limit_error(RATE_LIMIT_COOLDOWN_MS)
    details = str((payload or {}).get("responseDetails") or "")
    if re.search(r"quota exceeded|too many requests|rate limit", details, re.I):
        raise _rate_limit_error(RATE_LIMIT_COOLDOWN_MS)
    if response_status >= 400:
        raise TranslationError(details or f"API error {response_status}")
    translated = str(((payload or {}).get("responseData") or {}).get("translatedText") or "").strip()
    if not translated:
        raise TranslationError("No translated text returned")
    return translated


def _request_google_gtx(text: str, source: str, target: str, *, timeout: float) -> str:
    params = {
        "client": "gtx",
        "sl": _map_language_for_google(source),
        "tl": _map_language_for_google(target),
        "dt": "t",
        "q": text,
    }
    url = "https://translate.googleapis.com/translate_a/single?" + urlencode(params)
    payload, _ = _fetch_json(url, timeout=timeout)
    segments = payload[0] if isinstance(payload, list) and payload else []
    translated = "".join(str(seg[0]) for seg in segments if isinstance(seg, list)).strip()
    if not translated:
        raise TranslationError("No translated text returned")
    return translated


def _request_libretranslate(text: str, source: str, target: str, *, timeout: float) -> str:
    payload = {
        "q": text,
        "source": _map_language_for_libretranslate(source),
        "target": _map_language_for_libretranslate(target),
        "format": "text",
    }
    payload_data, _ = _fetch_json("https://libretranslate.com/translate", method="POST", payload=payload, timeout=timeout)
    translated = str((payload_data or {}).get("translatedText") or "").strip()
    if not translated:
        error_text = str((payload_data or {}).get("error") or "").strip()
        if re.search(r"too many requests|rate limit", error_text, re.I):
            raise _rate_limit_error(RATE_LIMIT_COOLDOWN_MS)
        raise TranslationError(error_text or "No translated text returned")
    return translated


def _request_provider(provider_id: str, text: str, source: str, target: str, *, timeout: float) -> str:
    if provider_id == "mymemory":
        return _request_mymemory(text, source, target, timeout=timeout)
    if provider_id == "googlegtx":
        return _request_google_gtx(text, source, target, timeout=timeout)
    if provider_id == "libretranslate":
        return _request_libretranslate(text, source, target, timeout=timeout)
    raise TranslationError(f"Unknown provider: {provider_id}")


def _is_retryable(error: TranslationError) -> bool:
    message = str(error)
    return (
        message.startswith("HTTP 5")
        or message.startswith("HTTP 429")
        or message.startswith("API error 5")
        or message.startswith("API error 429")
        or "Failed to fetch" in message
    )


def _set_provider_cooldown(provider_id: str, cooldown_ms: int) -> None:
    _provider_cooldown_until[provider_id] = time.time() + max(0.001, cooldown_ms / 1000)


def _provider_cooldown_remaining(provider_id: str) -> float:
    until = _provider_cooldown_until.get(provider_id, 0.0)
    return max(0.0, until - time.time())


def _get_provider_order(source_language: str) -> list[str]:
    has_source = bool(_normalize_language_code(source_language))
    order: list[str] = []
    size = len(PROVIDER_ORDER)
    start = _current_provider_index % size
    for i in range(size):
        provider = PROVIDER_ORDER[(start + i) % size]
        if not has_source and provider == "mymemory":
            continue
        order.append(provider)
    if order:
        return order
    return list(PROVIDER_ORDER)


def _throttle() -> None:
    global _throttle_last_at
    with _throttle_lock:
        now = time.time()
        wait_s = max(0.0, REQUEST_MIN_INTERVAL_MS / 1000 - (now - _throttle_last_at))
        if wait_s > 0:
            time.sleep(wait_s)
        _throttle_last_at = time.time()


def _run_provider_with_retries(provider_id: str, text: str, source: str, target: str, *, timeout: float) -> str:
    last_error: TranslationError | None = None
    for attempt in range(MAX_RETRY_ATTEMPTS + 1):
        _throttle()
        try:
            return _request_provider(provider_id, text, source, target, timeout=timeout)
        except TranslationError as error:
            last_error = error
            if error.is_rate_limited:
                raise
            if attempt >= MAX_RETRY_ATTEMPTS or not _is_retryable(error):
                raise
            time.sleep((RETRY_BASE_DELAY_MS * (2 ** attempt)) / 1000)
    if last_error is None:
        raise TranslationError("Translation failed")
    raise last_error


def _cache_key(source: str, target: str, text: str) -> str:
    raw = f"{CACHE_VERSION}|{source}|{target}|{text}"
    return f"translation:{_simple_hash(raw)}"


def _simple_hash(value: str) -> str:
    h = 5381
    for char in value:
        h = ((h * 33) ^ ord(char)) & 0xFFFFFFFF
    return format(h, "x")


def _read_cache(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _write_cache(path: Path, cache: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(cache, handle, ensure_ascii=False)
        tmp_path.replace(path)
    except OSError:
        pass


def _cache_get(path: Path, key: str) -> dict[str, Any] | None:
    cache = _read_cache(path)
    record = cache.get(key)
    if not isinstance(record, dict) or not record.get("value") or not isinstance(record.get("createdAt"), (int, float)):
        return None
    if time.time() * 1000 - float(record["createdAt"]) > CACHE_TTL_MS:
        return None
    return record


def _cache_put(path: Path, key: str, value: str, provider_id: str) -> None:
    cache = _read_cache(path)
    cache[key] = {"value": value, "createdAt": int(time.time() * 1000), "providerId": provider_id}
    _write_cache(path, cache)


def _chunk_text(text: str, max_chars: int = MAX_CHARS_PER_CHUNK) -> list[str]:
    cleaned = text.strip()
    if not cleaned:
        return []
    if len(cleaned) <= max_chars:
        return [cleaned]
    chunks: list[str] = []
    paragraphs = re.split(r"\n\s*\n", cleaned)
    buffer = ""
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        candidate = f"{buffer}\n\n{paragraph}".strip() if buffer else paragraph
        if len(candidate) <= max_chars:
            buffer = candidate
            continue
        if buffer:
            chunks.append(buffer)
        if len(paragraph) <= max_chars:
            buffer = paragraph
            continue
        for start in range(0, len(paragraph), max_chars):
            chunks.append(paragraph[start : start + max_chars])
        buffer = ""
    if buffer:
        chunks.append(buffer)
    return chunks


def _fit_for_request(text: str, max_chars: int = MAX_CHARS_PER_REQUEST) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[:max_chars]}..."


def _split_paragraphs(text: str) -> list[str]:
    """按空行切分段落;长 block 含多行时,进一步按单换行切(避免整篇正文被当成一段)。

    列表块(每行都以 `-` / `*` / 数字开头)保持整体不分。
    """
    if not text or not text.strip():
        return []
    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", text.strip()) if chunk.strip()]
    result: list[str] = []
    for chunk in chunks:
        if len(chunk) > 400 and chunk.count("\n") >= 2 and not _looks_like_list_block(chunk):
            for line in chunk.split("\n"):
                line = line.strip()
                if line:
                    result.append(line)
            continue
        result.append(chunk)
    return result


_LIST_PREFIX_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")


def _looks_like_list_block(block: str) -> bool:
    """是否整段都是列表项(每行都以列表标记开头)。"""
    lines = [line for line in block.split("\n") if line.strip()]
    if len(lines) < 2:
        return False
    return all(_LIST_PREFIX_RE.match(line) for line in lines)


def _group_paragraphs(paragraphs: list[str], max_chars: int) -> list[list[str]]:
    """把段落打包成长度上限内的批次,尽量整批而不拆段。"""
    if not paragraphs:
        return []
    groups: list[list[str]] = []
    buffer: list[str] = []
    buffer_len = 0
    for paragraph in paragraphs:
        addition = len(paragraph) + (2 if buffer else 0)
        if buffer and buffer_len + addition > max_chars:
            groups.append(buffer)
            buffer = [paragraph]
            buffer_len = len(paragraph)
            continue
        buffer.append(paragraph)
        buffer_len += addition
        if len(paragraph) > max_chars:
            groups.append(buffer)
            buffer = []
            buffer_len = 0
    if buffer:
        groups.append(buffer)
    return groups


def _build_marked_text(paragraphs: list[str]) -> tuple[str, list[str]]:
    """段与段之间插入 [[XLT_P_NNNN]] 标记,返回(标记文本, 标记列表)。"""
    if not paragraphs:
        return "", []
    tokens: list[str] = []
    parts: list[str] = [paragraphs[0]]
    for i in range(1, len(paragraphs)):
        token = f"[[XLT_P{i:04d}]]"
        tokens.append(token)
        parts.append(f"\n\n{token}\n\n")
        parts.append(paragraphs[i])
    return "".join(parts), tokens


def _parse_marked_text(text: str, tokens: list[str]) -> list[str]:
    """把带标记的译文按标记位置拆回各段译文。

    标记在翻译中通常被保留;若丢失则在余下文本里继续找下一标记,
    找得到则用其位置作为当前段结尾,中间被跳过的段视为空。
    """
    if not tokens:
        return [_clean_inline(text)]

    parts: list[str] = []
    remaining = text
    i = 0
    n = len(tokens)

    while i < n:
        idx = remaining.find(tokens[i])
        if idx != -1:
            parts.append(_clean_inline(remaining[:idx]))
            remaining = remaining[idx + len(tokens[i]) :]
            i += 1
            continue

        found_later = False
        for j in range(i + 1, n):
            later_idx = remaining.find(tokens[j])
            if later_idx != -1:
                parts.append(_clean_inline(remaining[:later_idx]))
                for _ in range(j - i - 1):
                    parts.append("")
                remaining = remaining[later_idx + len(tokens[j]) :]
                i = j + 1
                found_later = True
                break

        if not found_later:
            parts.append(_clean_inline(remaining))
            remaining = ""
            parts.extend([""] * (n - len(parts) + 1))
            return parts

    parts.append(_clean_inline(remaining))
    return parts


def _clean_inline(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def format_bilingual_text(pairs: list[tuple[str, str]]) -> str:
    """把 (英文段, 中文段) 列表拼成英中段间交错的 markdown。"""
    blocks: list[str] = []
    for english, chinese in pairs:
        if english:
            blocks.append(english.strip())
        if chinese:
            blocks.append(chinese.strip())
    return "\n\n".join(blocks).strip()


def translate_text(
    text: str,
    *,
    source_language: str = "",
    target_language: str = "zh-CN",
    cache_path: Path | None = None,
    use_cache: bool = True,
    timeout: float = DEFAULT_TIMEOUT,
    bilingual: bool = False,
) -> TranslateResult:
    """翻译一段文本。

    Args:
        text: 待翻译文本；超过约 1200 字符会自动按段落切块。
        source_language: 源语言代码，留空则自动检测；`auto` 等价于留空。
        target_language: 目标语言代码，默认 `zh-CN`。
        cache_path: 缓存文件路径；`None` 时使用 `scripts/cache/translation_cache.json`。
        use_cache: 是否读写本地缓存。
        timeout: 单次 HTTP 请求超时秒数。
        bilingual: 是否返回英中段间对照；启用时每批段落只发一次翻译请求，
            解析标记 token 还原每段中文，并填充 `result.pairs`。

    Returns:
        TranslateResult，含译文、Provider ID、检测到的源语言。
        当 `bilingual=True` 时，`pairs` 字段是 `(英文, 中文)` 列表，
        `text` 字段是 `format_bilingual_text(pairs)` 的渲染结果。
    """
    if not text or not text.strip():
        raise TranslationError("Empty text")

    normalized_target = _normalize_language_code(target_language) or "zh-CN"
    normalized_source = _normalize_language_code(source_language) or detect_source_language(text) or ""

    if normalized_source and normalized_source.lower().startswith("zh") and normalized_target.lower().startswith("zh"):
        return _local_bilingual_result(text, normalized_source or "zh-CN", bilingual=bilingual)
    if normalized_source and normalized_source.lower() == normalized_target.lower():
        return _local_bilingual_result(text, normalized_source, bilingual=bilingual)

    cache_file = Path(cache_path) if cache_path else DEFAULT_CACHE_PATH
    if bilingual:
        pairs = _translate_bilingual_pairs(
            text,
            source=normalized_source,
            target=normalized_target,
            cache_file=cache_file,
            use_cache=use_cache,
            timeout=timeout,
        )
        return TranslateResult(
            text=format_bilingual_text(pairs),
            provider_id="googlegtx",
            detected_source=normalized_source or "auto",
            pairs=pairs,
            bilingual=True,
        )

    chunks = _chunk_text(text)
    if not chunks:
        raise TranslationError("Empty text")

    translated_chunks: list[str] = []
    provider_used = "local"
    for chunk in chunks:
        safe = _fit_for_request(chunk)
        if not safe:
            translated_chunks.append(chunk)
            continue
        cache_source = normalized_source or "auto"
        cache_key_value = _cache_key(cache_source, normalized_target, safe)

        if use_cache:
            cached = _cache_get(cache_file, cache_key_value)
            if cached is not None:
                translated_chunks.append(str(cached["value"]))
                provider_used = f"{cached.get('providerId', 'cache')}(cache)"
                continue

        if cache_key_value in _inflight_requests:
            result = _inflight_requests[cache_key_value]
            translated_chunks.append(result.text)
            provider_used = result.provider_id
            continue

        inflight = _translate_single(
            safe,
            source=normalized_source,
            target=normalized_target,
            cache_file=cache_file if use_cache else None,
            cache_key=cache_key_value,
            timeout=timeout,
        )
        _inflight_requests[cache_key_value] = inflight
        try:
            result = inflight
        finally:
            _inflight_requests.pop(cache_key_value, None)

        translated_chunks.append(result.text)
        if result.provider_id != "local":
            provider_used = result.provider_id

    if len(translated_chunks) == 1:
        joined = translated_chunks[0]
    else:
        joined = "\n\n".join(translated_chunks)
    return TranslateResult(text=joined, provider_id=provider_used, detected_source=normalized_source or "auto")


def _local_bilingual_result(text: str, detected_source: str, *, bilingual: bool) -> TranslateResult:
    paragraphs = _split_paragraphs(text) if bilingual else []
    pairs = [(paragraph, paragraph) for paragraph in paragraphs] if bilingual else []
    return TranslateResult(
        text=text,
        provider_id="local",
        detected_source=detected_source,
        pairs=pairs or None,
        bilingual=bilingual,
    )


def _translate_bilingual_pairs(
    text: str,
    *,
    source: str,
    target: str,
    cache_file: Path | None,
    use_cache: bool,
    timeout: float,
) -> list[tuple[str, str]]:
    """英中段间对照翻译：每批段落只发一次请求，解析 token 还原各段译文。"""
    paragraphs = _split_paragraphs(text)
    if not paragraphs:
        return []

    pairs: list[tuple[str, str]] = [("", "") for _ in paragraphs]
    groups = _group_paragraphs(paragraphs, MAX_CHARS_PER_CHUNK)
    cursor = 0
    for group in groups:
        group_start = cursor
        cursor += len(group)
        for offset, paragraph in enumerate(group):
            pairs[group_start + offset] = (paragraph, "")

        marked, tokens = _build_marked_text(group)
        if not marked:
            continue
        cache_source = source or "auto"
        cache_key_value = _cache_key(cache_source, target, marked)
        translated_marked = ""
        provider_used = "googlegtx"

        if use_cache and cache_file is not None:
            cached = _cache_get(cache_file, cache_key_value)
            if cached is not None:
                translated_marked = str(cached["value"])
                provider_used = str(cached.get("providerId", "cache"))
                _assign_translations(pairs, group_start, group, tokens, translated_marked)

        if not translated_marked:
            if cache_key_value in _inflight_requests:
                cached_result = _inflight_requests[cache_key_value]
                translated_marked = cached_result.text
                provider_used = cached_result.provider_id
                _assign_translations(pairs, group_start, group, tokens, translated_marked)
            else:
                result = _translate_single(
                    marked,
                    source=source,
                    target=target,
                    cache_file=cache_file if use_cache else None,
                    cache_key=cache_key_value,
                    timeout=timeout,
                )
                translated_marked = result.text
                provider_used = result.provider_id
                _assign_translations(pairs, group_start, group, tokens, translated_marked)

    return pairs


def _assign_translations(
    pairs: list[tuple[str, str]],
    group_start: int,
    group: list[str],
    tokens: list[str],
    translated_marked: str,
) -> None:
    parts = _parse_marked_text(translated_marked, tokens)
    expected = len(group) + 1
    if len(parts) < expected:
        parts = parts + [""] * (expected - len(parts))
    elif len(parts) > expected:
        parts = parts[:expected]
    for offset, paragraph in enumerate(group):
        chinese = parts[offset] if offset < len(parts) else ""
        pairs[group_start + offset] = (paragraph, chinese)


def _detect_provider_from_pairs(pairs: list[tuple[str, str]]) -> str:
    return "googlegtx"


def _translate_single(
    text: str,
    *,
    source: str,
    target: str,
    cache_file: Path | None,
    cache_key: str,
    timeout: float,
) -> TranslateResult:
    errors: list[str] = []
    providers = _get_provider_order(source)
    for provider_id in providers:
        remaining = _provider_cooldown_remaining(provider_id)
        if remaining > 0:
            errors.append(f"{provider_id}: rate-limited ({int(remaining) + 1}s left)")
            continue
        try:
            translated = _run_provider_with_retries(provider_id, text, source, target, timeout=timeout)
        except TranslationError as error:
            if error.is_rate_limited:
                _set_provider_cooldown(provider_id, error.retry_after_ms or RATE_LIMIT_COOLDOWN_MS)
                errors.append(f"{provider_id}: rate-limited")
                continue
            errors.append(f"{provider_id}: {error}")
            continue
        if cache_file is not None:
            _cache_put(cache_file, cache_key, translated, provider_id)
        return TranslateResult(text=translated, provider_id=provider_id, detected_source=source or "auto")
    raise TranslationError("All providers failed. " + " | ".join(errors) if errors else "No translation providers available")


def main() -> int:
    parser = argparse.ArgumentParser(description="免费多 Provider 翻译（默认英→中）")
    parser.add_argument("text", help="待翻译文本")
    parser.add_argument("--source", default="", help="源语言代码，留空自动检测")
    parser.add_argument("--target", default="zh-CN", help="目标语言代码，默认 zh-CN")
    parser.add_argument("--no-cache", action="store_true", help="跳过本地缓存读写")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="单次请求超时秒数")
    parser.add_argument("--bilingual", action="store_true", help="输出英中段间对照；每批段落只发一次翻译请求")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    args = parser.parse_args()

    try:
        result = translate_text(
            args.text,
            source_language=args.source,
            target_language=args.target,
            use_cache=not args.no_cache,
            bilingual=args.bilingual,
            timeout=args.timeout,
        )
    except TranslationError as error:
        if args.json:
            print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False))
        else:
            print(f"[error] {error}", file=sys.stderr)
        return 1

    if args.json:
        payload: dict[str, Any] = {
            "status": "success",
            "text": result.text,
            "provider_id": result.provider_id,
            "detected_source": result.detected_source,
            "bilingual": result.bilingual,
        }
        if result.pairs is not None:
            payload["pairs"] = result.pairs
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(result.text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
