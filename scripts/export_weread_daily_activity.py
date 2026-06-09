#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from import_weread_latest_highlight import (
    api_call,
    extract_book_title,
    fetch_notebooks,
    format_timestamp,
)

sys.path.insert(0, str(Path(__file__).parent))
from status_page import update_status_page


REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = Path(__file__).parent / "cache" / "reading_daily_state.json"
OUT_DIR = REPO_ROOT / "static" / "reading"
LEGACY_OUT_PATH = OUT_DIR / "reading_daily.json"
INDEX_PATH = OUT_DIR / "index.json"
STATUS_OUTPUT_PATH = REPO_ROOT / "docs/05-吴飞飞/01-关于/关于FEEI.CN/FEEI.CN状态.md"
TRACKED_PATHS = [OUT_DIR, STATUS_OUTPUT_PATH]
STATUS_KEY = "reading-heatmap"
STATUS_NAME = "阅读日历"
STATUS_OUTPUT_LINKS = [{"title": "阅读数据", "slug": "/read-data"}]
OVERLAP_SECONDS = 7 * 24 * 3600
DEFAULT_YEAR_START = 2018


def run_git(args: list[str], *, check: bool = False) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if check and completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        print(f"[warn] git {' '.join(args)} 失败: {details}", file=sys.stderr)
    return completed


def git_pull() -> None:
    print("[info] git pull ...", file=sys.stderr)
    completed = run_git(["pull", "--ff-only"])
    if completed.returncode != 0:
        print(f"[warn] git pull 失败: {(completed.stderr or completed.stdout).strip()}", file=sys.stderr)
    else:
        print("[info] git pull 完成", file=sys.stderr)


def git_commit_and_push() -> None:
    relative_paths = [str(p.relative_to(REPO_ROOT)) for p in TRACKED_PATHS]
    add_completed = run_git(["add", "--", *relative_paths])
    if add_completed.returncode != 0:
        print(f"[warn] git add 失败: {(add_completed.stderr or add_completed.stdout).strip()}", file=sys.stderr)
        return

    diff_check = run_git(["diff", "--cached", "--quiet", "--", *relative_paths])
    if diff_check.returncode == 0:
        print("[info] 无变化，跳过 commit", file=sys.stderr)
        return
    if diff_check.returncode != 1:
        print(f"[warn] git diff 检查异常 rc={diff_check.returncode}", file=sys.stderr)
        return

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    print("[info] git commit ...", file=sys.stderr)
    commit_completed = run_git(
        ["commit", "--only", "-m", f"[auto] 刷新阅读日历 {timestamp}", "--", *relative_paths]
    )
    if commit_completed.returncode != 0:
        print(f"[warn] git commit 失败: {(commit_completed.stderr or commit_completed.stdout).strip()}", file=sys.stderr)
        return

    print("[info] git push ...", file=sys.stderr)
    push_completed = run_git(["push"])
    if push_completed.returncode != 0:
        print(f"[warn] git push 失败: {(push_completed.stderr or push_completed.stdout).strip()}", file=sys.stderr)
    else:
        print("[info] git push 完成", file=sys.stderr)


def load_daily_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_daily_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def to_local_date(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().strftime("%Y-%m-%d")


def parse_years(text: str) -> list[int]:
    out: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            out.extend(range(int(start), int(end) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))


def fetch_month_readtime(year: int, month: int) -> dict[str, int]:
    base_ts = int(datetime(year, month, 15, tzinfo=timezone.utc).timestamp())
    try:
        data = api_call("/readdata/detail", mode="monthly", baseTime=base_ts)
    except RuntimeError as error:
        print(f"[warn] /readdata/detail {year}-{month:02d} 失败: {error}", file=sys.stderr)
        return {}

    read_times = data.get("readTimes") or {}
    if not read_times:
        return {}

    parsed: dict[str, int] = {}
    for ts_key, secs in read_times.items():
        try:
            ts = int(ts_key)
            secs_int = int(secs)
        except (TypeError, ValueError):
            continue
        if secs_int <= 0:
            continue
        parsed[to_local_date(ts)] = secs_int
    return parsed


def iter_year_months(years: list[int], today_year: int, today_month: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for year in years:
        last_month = 12 if year < today_year else today_month
        for month in range(1, last_month + 1):
            out.append((year, month))
    return out


def collect_book_highlights(cutoff_time: int) -> tuple[dict[str, dict[str, Any]], int]:
    notebooks = fetch_notebooks()
    daily: dict[str, dict[str, Any]] = {}
    latest_create_time = 0

    for index, book_entry in enumerate(notebooks, start=1):
        book = book_entry.get("book") or book_entry
        book_id = str(book_entry.get("bookId") or book.get("bookId") or "")
        if not book_id:
            continue
        title = extract_book_title(book)
        try:
            bookmarklist = api_call("/book/bookmarklist", bookId=book_id)
        except RuntimeError as error:
            print(f"[warn] 拉取划线失败 bookId={book_id}: {error}", file=sys.stderr)
            continue
        for item in bookmarklist.get("updated") or []:
            create_time = int(item.get("createTime") or 0)
            if create_time <= 0 or create_time < cutoff_time:
                continue
            date = to_local_date(create_time)
            bucket = daily.setdefault(date, {"books": []})
            if title and title not in bucket["books"]:
                bucket["books"].append(title)
            latest_create_time = max(latest_create_time, create_time)
        if index % 20 == 0:
            print(f"[info] 已处理 {index}/{len(notebooks)} 本", file=sys.stderr)

    return daily, latest_create_time


def merge_payload(
    existing_daily: dict[str, dict[str, Any]],
    readtime_delta: dict[str, int],
    books_delta: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for date, bucket in existing_daily.items():
        merged[date] = {
            "seconds": int(bucket.get("seconds", 0)),
            "books": list(bucket.get("books") or []),
        }

    for date, secs in readtime_delta.items():
        bucket = merged.setdefault(date, {"seconds": 0, "books": []})
        if secs > int(bucket.get("seconds", 0)):
            bucket["seconds"] = int(secs)

    for date, payload in books_delta.items():
        bucket = merged.setdefault(date, {"seconds": 0, "books": []})
        for book in payload.get("books") or []:
            if book and book not in bucket["books"]:
                bucket["books"].append(book)

    for date in list(merged.keys()):
        if int(merged[date].get("seconds", 0)) <= 0 and not merged[date].get("books"):
            del merged[date]

    return merged


def load_existing_split(out_dir: Path) -> dict[str, dict[str, Any]]:
    index_path = out_dir / "index.json"
    if not index_path.exists():
        return {}
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    years = index.get("activeYears") or []
    merged: dict[str, dict[str, Any]] = {}
    for y in years:
        yf = out_dir / f"{y}.json"
        if not yf.exists():
            continue
        try:
            payload = json.loads(yf.read_text(encoding="utf-8"))
        except Exception:
            continue
        for date, bucket in (payload.get("daily") or {}).items():
            merged[date] = {
                "seconds": int(bucket.get("seconds", 0)),
                "books": list(bucket.get("books") or []),
            }
    return merged


def load_legacy_payload(legacy_path: Path) -> dict[str, dict[str, Any]]:
    if not legacy_path.exists():
        return {}
    try:
        data = json.loads(legacy_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for date, bucket in (data.get("daily") or {}).items():
        out[date] = {
            "seconds": int(bucket.get("seconds", 0)),
            "books": list(bucket.get("books") or []),
        }
    return out


def write_split_files(
    out_dir: Path,
    daily: dict[str, dict[str, Any]],
    *,
    with_books: bool,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    by_year: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for date, bucket in daily.items():
        by_year[date[:4]][date] = bucket

    for year, year_daily in by_year.items():
        active_days = sum(1 for b in year_daily.values() if int(b.get("seconds", 0)) > 0)
        total_seconds = sum(int(b.get("seconds", 0)) for b in year_daily.values())
        payload = {
            "year": year,
            "exportedAt": format_timestamp(int(time.time())),
            "source": "weread",
            "sourceDetail": {
                "primary": "readdata.detail.readTimes (mode=monthly)",
                "secondary": "book.bookmarklist" if with_books else None,
            },
            "yearTotals": {
                "activeDays": active_days,
                "totalReadSeconds": total_seconds,
            },
            "daily": {date: year_daily[date] for date in sorted(year_daily.keys())},
        }
        (out_dir / f"{year}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    active_days_all = sum(1 for b in daily.values() if int(b.get("seconds", 0)) > 0)
    total_seconds_all = sum(int(b.get("seconds", 0)) for b in daily.values())
    years_sorted = sorted(by_year.keys())
    dates_sorted = sorted(daily.keys())
    index = {
        "exportedAt": format_timestamp(int(time.time())),
        "source": "weread",
        "activeYears": years_sorted,
        "yearRange": {"start": min(years_sorted), "end": max(years_sorted)} if years_sorted else {"start": "", "end": ""},
        "dateRange": {"start": dates_sorted[0], "end": dates_sorted[-1]} if dates_sorted else {"start": "", "end": ""},
        "totals": {
            "activeDays": active_days_all,
            "totalReadSeconds": total_seconds_all,
        },
    }
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return index


def delete_legacy_file(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "导出微信读书每日阅读时长用于阅读热力图。"
            "按年分文件输出（index.json + YYYY.json），支持 cron 模式只拉当月。"
        )
    )
    parser.add_argument("--years", default=str(DEFAULT_YEAR_START), help=f"按年扫描起点，从该年到当前年。默认 {DEFAULT_YEAR_START}")
    parser.add_argument("--full", action="store_true", help="忽略 state 强制重建所有月份")
    parser.add_argument("--cron", action="store_true", help="cron 模式：只拉当月 1 次 API，写当年年文件")
    parser.add_argument("--no-books", dest="with_books", action="store_false", help="不拉划线书名")
    parser.add_argument("--no-pull", dest="git_pull_enabled", action="store_false", help="跳过运行前 git pull")
    parser.add_argument("--no-push", dest="git_push_enabled", action="store_false", help="跳过运行后 git commit + push")
    parser.add_argument("--dry-run", action="store_true", help="只打印统计，不写文件")
    parser.add_argument("--state-file", type=Path, default=STATE_PATH, help=f"state 文件路径")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR, help=f"输出目录")
    parser.set_defaults(with_books=True, git_pull_enabled=True, git_push_enabled=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.git_pull_enabled:
        git_pull()

    if not os.environ.get("WEREAD_API_KEY"):
        print("[warn] 未设置 WEREAD_API_KEY，跳过拉取，保留已有数据。", file=sys.stderr)
        return 0

    today = datetime.now(tz=timezone.utc).astimezone()

    if args.cron:
        pending = [(today.year, today.month)]
        print(
            f"[info] cron 模式：只拉 {today.year}-{today.month:02d}（1 次 API）",
            file=sys.stderr,
        )
    else:
        start_year = int(args.years)
        years = list(range(start_year, today.year + 1))
        ym_to_fetch = iter_year_months(years, today.year, today.month)
        state = {} if args.full else load_daily_state(args.state_file)
        processed_ym: set[str] = set() if args.full else set(state.get("monthly_ym_processed") or [])
        pending = [
            ym
            for ym in ym_to_fetch
            if args.full or f"{ym[0]:04d}-{ym[1]:02d}" not in processed_ym
        ]
        print(
            f"[info] 扫描 {start_year}-{today.year}（共 {len(ym_to_fetch)} 月）; "
            f"已处理 {len(processed_ym)} 月; 待处理 {len(pending)} 月",
            file=sys.stderr,
        )

    state = load_daily_state(args.state_file)
    last_highlights_ts = int(state.get("last_highlights_ts") or 0)
    bookmarks_cutoff = 0 if last_highlights_ts == 0 else max(0, last_highlights_ts - OVERLAP_SECONDS)

    readtime_delta: dict[str, int] = {}
    for index, (year, month) in enumerate(pending, start=1):
        month_map = fetch_month_readtime(year, month)
        readtime_delta.update(month_map)
        print(
            f"[info] 拉取 {year}-{month:02d} 完成，得到 {len(month_map)} 天有阅读数据",
            file=sys.stderr,
        )

    books_delta: dict[str, dict[str, Any]] = {}
    new_last_highlights = last_highlights_ts
    if args.with_books and not args.cron:
        print(f"[info] 拉取划线书名，截止时间 {bookmarks_cutoff}", file=sys.stderr)
        books_delta, latest_ts = collect_book_highlights(bookmarks_cutoff)
        new_last_highlights = max(last_highlights_ts, latest_ts)
        print(f"[info] 划线聚合到 {len(books_delta)} 天", file=sys.stderr)
    elif args.with_books and args.cron:
        print("[info] cron 模式跳过划线拉取（独立周期，下次全量时补）", file=sys.stderr)

    split_daily = load_existing_split(args.out_dir)
    legacy_daily = load_legacy_payload(LEGACY_OUT_PATH)
    base_daily = {**legacy_daily, **split_daily}
    if legacy_daily and not args.dry_run:
        print(f"[info] 从旧 reading_daily.json 迁移 {len(legacy_daily)} 天历史数据", file=sys.stderr)
    merged = merge_payload(base_daily, readtime_delta, books_delta)

    active_days = sum(1 for b in merged.values() if int(b.get("seconds", 0)) > 0)
    total_seconds = sum(int(b.get("seconds", 0)) for b in merged.values())
    print(
        f"[info] 合并后 activeDays={active_days} "
        f"totalReadSeconds={total_seconds} "
        f"({total_seconds // 3600}h{total_seconds % 3600 // 60}m)",
        file=sys.stderr,
    )

    if args.dry_run:
        print("[info] dry-run 模式，不写文件", file=sys.stderr)
        return 0

    index = write_split_files(args.out_dir, merged, with_books=args.with_books)
    print(
        f"[info] 已写入 {len(index['activeYears'])} 个年文件 + index.json "
        f"({args.out_dir}/)",
        file=sys.stderr,
    )

    if legacy_daily:
        delete_legacy_file(LEGACY_OUT_PATH)
        print(f"[info] 已删除旧文件 {LEGACY_OUT_PATH}", file=sys.stderr)

    processed_ym_full = set(state.get("monthly_ym_processed") or [])
    for y, m in pending:
        processed_ym_full.add(f"{y:04d}-{m:02d}")

    save_daily_state(
        args.state_file,
        {
            "monthly_ym_processed": sorted(processed_ym_full),
            "last_highlights_ts": new_last_highlights,
            "updated_at": format_timestamp(int(time.time())),
            "active_days": active_days,
            "last_cron_year_month": f"{today.year:04d}-{today.month:02d}",
        },
    )

    status_path = update_status_page(
        key=STATUS_KEY,
        name=STATUS_NAME,
        script="scripts/export_weread_daily_activity.py",
        status="成功",
        run_time=datetime.now(tz=timezone.utc).astimezone(),
        outputs=STATUS_OUTPUT_LINKS,
    )
    print(f"[info] 已写入状态页 -> {status_path.name}", file=sys.stderr)

    if args.git_push_enabled:
        git_commit_and_push()

    return 0


if __name__ == "__main__":
    sys.exit(main())
