#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""用 Claude Code 翻译文本,产出 逐行翻译 + 复杂词汇标注 + 通俗讲解 三段式 Markdown。

替代原 MyMemory / Google GTX / LibreTranslate 链路的脚本实现。
调用 `claude -p --output-format json`(参照 .github/workflows/claude-code-issue-driver.yml),
让 Claude 直接做翻译 / 标注 / 讲解,质量与可控性都比免费 API 翻译好。

CLI: python translate_text.py "text" [--source en] [--target zh-CN] [--json]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
DEFAULT_TIMEOUT = 300.0
CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
CACHE_VERSION = "v2"

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CACHE_PATH = SCRIPT_DIR / "cache" / "translation_cache.json"

SYSTEM_PROMPT = """你是英中翻译,擅长把英文文章(尤其技术 / 商业 / 长文推文)翻译成通俗易懂的中文。

## 任务

对用户提供的英文文本,严格按以下 2 个 section 输出(必须用 Markdown,顺序固定):

### 1. 逐行翻译
保持原文的 Markdown 结构(标题、列表、代码块、链接、引用、加粗、斜体等),保留原有每句/每段英文，并在其下增加对应中文:
- 保留 URL、代码块、专有名词、人名、产品名、品牌名等英文原文,不要硬翻
- 中文表达要自然流畅,避免生硬的逐词翻译
- 如果原文是列表项 / 标题 / 引用,翻译后保持相同结构
- 行间用空行分隔,便于阅读
- 标题翻译后用对应数量的 `#` 保留层级
- 复杂词汇标注：英文中出现的 **复杂 / 专业 / 容易误解** 的词汇或短语应当用下面的 Markdown 格式备注在英文原文中:**<英文原文>**（<中文翻译> — <一句话解释,说清在这个语境里的含义>）

### 2. 通俗讲解
用 3-5 段中文,讲清楚整篇文章的核心论点、关键推理和结论。要求:
- 读者是 **没读过原文** 的人
- 读完后能复述文章的中心论点
- 能讲清关键的因果链 / 推理步骤
- 能说出文章与同类话题的差异点 / 立场
- 直接陈述观点,不要"本文介绍 / 本文探讨"这类废话开头
- 不引用具体数字和统计数据作为论据(用定性描述替代)

## 硬约束

- 严格按 2 个 section 输出,顺序、标题、Markdown 格式都按上面要求
- 不在输出中提到 "我 / 我的 / 作为 AI" 等元话语
- 不要加前言、总结、寒暄,直接进 2 个 section
- 单次输出足够长,不要因为省 token 而偷工减料
"""


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


def is_english_text(text: str, *, min_latin_ratio: float = 0.6, min_latin_chars: int = 40) -> bool:
    """粗略判断一段文本是否主要使用拉丁字母(英语为主)。

    用途：抓取到的网页 Markdown 中如果主体是英文,则调用翻译;
    短文本(拉丁字母 < `min_latin_chars`)和含较多 CJK 字符的文本都视为非英语。
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


def _simple_hash(value: str) -> str:
    h = 5381
    for char in value:
        h = ((h * 33) ^ ord(char)) & 0xFFFFFFFF
    return format(h, "x")


def _cache_key(source: str, target: str, text: str) -> str:
    raw = f"{CACHE_VERSION}|{source}|{target}|{text}"
    return f"translation:{_simple_hash(raw)}"


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


def _resolve_claude_bin() -> str:
    claude_bin = shutil.which("claude")
    if not claude_bin:
        raise TranslationError(
            "claude 命令未找到。请先安装 Claude Code CLI:`npm install -g @anthropic-ai/claude-code`"
        )
    return claude_bin


def _call_claude(article: str, *, timeout: float, model: str | None) -> str:
    """调 `claude -p` 拿翻译结果。返回纯文本(已剥 JSON 包装)。"""
    claude_bin = _resolve_claude_bin()
    cmd = [claude_bin, "-p", "--output-format", "json"]
    if model:
        cmd.extend(["--model", model])
    full_prompt = f"{SYSTEM_PROMPT}\n\n## 待翻译原文\n\n{article}\n"

    try:
        result = subprocess.run(
            cmd,
            input=full_prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise TranslationError(f"claude 调用超时({timeout}s)") from error
    except OSError as error:
        raise TranslationError(f"claude 调用失败: {error}") from error

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()[:500]
        raise TranslationError(f"claude exit={result.returncode}: {stderr or '(no stderr)'}")

    raw = (result.stdout or "").strip()
    if not raw:
        raise TranslationError("claude 输出为空")

    text: str | None = None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        text = raw
    else:
        if isinstance(payload, dict):
            for key in ("result", "message", "content", "text"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    text = value
                    break
            if text is None and isinstance(payload.get("result"), dict):
                # 兼容 {result: {text: ...}} 这类嵌套
                inner = payload["result"]
                if isinstance(inner.get("text"), str):
                    text = inner["text"]
        elif isinstance(payload, str):
            text = payload

    if text is None or not text.strip():
        raise TranslationError("claude 输出无法解析为文本")
    return text.strip()


def translate_text(
    text: str,
    *,
    source_language: str = "",
    target_language: str = "zh-CN",
    cache_path: Path | None = None,
    use_cache: bool = True,
    timeout: float = DEFAULT_TIMEOUT,
    bilingual: bool = False,
    model: str | None = None,
) -> TranslateResult:
    """翻译一段文本。

    Args:
        text: 待翻译文本。
        source_language: 源语言代码,留空则自动检测;`auto` 等价于留空。
        target_language: 目标语言代码,默认 `zh-CN`。
        cache_path: 缓存文件路径;`None` 时使用 `scripts/cache/translation_cache.json`。
        use_cache: 是否读写本地缓存。
        timeout: claude 调用超时秒数,默认 300。
        bilingual: 兼容旧 API,本实现忽略(Claude 输出本身就是结构化对照)。
        model: 覆盖 Claude 模型,默认读 `ANTHROPIC_MODEL` 环境变量或 claude 默认。

    Returns:
        TranslateResult,`text` 字段是 Claude 输出的三段式 Markdown
        (逐行翻译 + 词汇标注 + 通俗讲解);`pairs` 始终为 None。
    """
    if not text or not text.strip():
        raise TranslationError("Empty text")

    normalized_target = _normalize_language_code(target_language) or "zh-CN"
    normalized_source = _normalize_language_code(source_language) or detect_source_language(text) or ""

    if normalized_source and normalized_source.lower() == normalized_target.lower():
        return TranslateResult(
            text=text,
            provider_id="local",
            detected_source=normalized_source,
            bilingual=bilingual,
        )

    cache_file = Path(cache_path) if cache_path else DEFAULT_CACHE_PATH
    cache_source = normalized_source or "auto"
    cache_key_value = _cache_key(cache_source, normalized_target, text)

    if use_cache:
        cached = _cache_get(cache_file, cache_key_value)
        if cached is not None:
            return TranslateResult(
                text=str(cached["value"]),
                provider_id=f"{cached.get('providerId', 'claude-code')}(cache)",
                detected_source=normalized_source or "auto",
                bilingual=bilingual,
            )

    resolved_model = model or os.environ.get("ANTHROPIC_MODEL")
    translated = _call_claude(text, timeout=timeout, model=resolved_model)

    if use_cache:
        _cache_put(cache_file, cache_key_value, translated, "claude-code")

    return TranslateResult(
        text=translated,
        provider_id="claude-code",
        detected_source=normalized_source or "auto",
        bilingual=bilingual,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="用 Claude Code 翻译文本(逐行翻译 + 词汇标注 + 通俗讲解)")
    parser.add_argument("text", help="待翻译文本")
    parser.add_argument("--source", default="", help="源语言代码,留空自动检测")
    parser.add_argument("--target", default="zh-CN", help="目标语言代码,默认 zh-CN")
    parser.add_argument("--no-cache", action="store_true", help="跳过本地缓存读写")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="claude 调用超时秒数,默认 300")
    parser.add_argument("--bilingual", action="store_true", help="兼容旧 API(本实现忽略)")
    parser.add_argument("--model", default=None, help="覆盖 Claude 模型,默认读 ANTHROPIC_MODEL")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    args = parser.parse_args()

    try:
        result = translate_text(
            args.text,
            source_language=args.source,
            target_language=args.target,
            use_cache=not args.no_cache,
            timeout=args.timeout,
            bilingual=args.bilingual,
            model=args.model,
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
