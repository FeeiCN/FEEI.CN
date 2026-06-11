#!/usr/bin/env python3

"""Dump raw weRead API responses to static/reading/ for offline consumption.

Output structure (everything is the API's raw response, untouched):

  static/reading/
    YYYY/MM.json              # /readdata/detail mode=monthly
    books/<bookId>/*.json     # per-book endpoints
    notebooks.json            # /user/notebooks
    shelf.json                # /shelf/sync
    recommend.json            # /book/recommend
    search.json               # /store/search (default keyword)

Reuses api_call/fetch_notebooks/format_timestamp from weread_api.py.
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

sys.path.insert(0, str(Path(__file__).parent))
from weread_api import api_call, fetch_notebooks, format_timestamp  # noqa: E402

WEREAD_DEFAULT_SEARCH_KEYWORD = "投资"
BOOK_REFRESH_DAYS = 7
API_SLEEP_SECONDS = 0.3
READDATA_START_YEAR = 2016
NOTEPAD_PAGE_SIZE = 100
REVIEWS_PAGE_SIZE = 100
BESTBOOKMARKS_DEFAULT_CHAPTER = 0

OUT_DIR = Path(__file__).resolve().parent.parent / "static" / "reading"
CACHE_DIR = Path(__file__).resolve().parent / "cache" / "weread_data"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
STATE_PATH = CACHE_DIR / "state.json"


def now_str() -> str:
    return format_timestamp(int(datetime.now(tz=timezone.utc).timestamp()))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"monthly_ym": [], "books": {}}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"monthly_ym": [], "books": {}}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )


def fetch_notebooks_all() -> dict[str, Any]:
    """Paginate /user/notebooks, merge books[], return raw envelope."""
    all_books: list[dict[str, Any]] = []
    last_sort: int | None = None
    while True:
        params: dict[str, Any] = {"count": NOTEPAD_PAGE_SIZE}
        if last_sort is not None:
            params["lastSort"] = last_sort
        page = api_call("/user/notebooks", **params)
        books = page.get("books") or []
        all_books.extend(books)
        if not page.get("hasMore") or not books:
            break
        last_sort_value = books[-1].get("sort")
        if not last_sort_value:
            break
        last_sort = int(last_sort_value)
    return {
        "fetchedAt": now_str(),
        "totalBookCount": len(all_books),
        "books": all_books,
    }


def fetch_shelf() -> dict[str, Any]:
    return {"fetchedAt": now_str(), **api_call("/shelf/sync")}


def fetch_recommend() -> dict[str, Any]:
    return {
        "fetchedAt": now_str(),
        "keyword": WEREAD_DEFAULT_SEARCH_KEYWORD,
        **api_call("/book/recommend", count=12),
    }


def fetch_search_default() -> dict[str, Any]:
    return {
        "fetchedAt": now_str(),
        "keyword": WEREAD_DEFAULT_SEARCH_KEYWORD,
        **api_call(
            "/store/search",
            keyword=WEREAD_DEFAULT_SEARCH_KEYWORD,
            scope=10,
        ),
    }


def month_base_ts(year: int, month: int) -> int:
    return int(datetime(year, month, 15, tzinfo=timezone.utc).timestamp())


def merge_shelf_read_books(
    notebooks_payload: dict[str, Any],
    shelf_payload: dict[str, Any],
) -> int:
    """把 shelf 里 readingTime>0 但不在 notebooks 的书合成成 notebook 条目追加。

    返回合成条目数。合成条目的 `book` 字段照搬 shelf 原始字段，
    `bookId`/`noteCount`/`bookmarkCount` 等用合理默认，确保下游
    `collect_book_ids` / `build_stats_payload` / 单书接口拉取都能识别。
    """
    existing_ids = {
        str(b.get("bookId") or (b.get("book") or {}).get("bookId") or "")
        for b in (notebooks_payload.get("books") or [])
    }
    existing_ids.discard("")

    added = 0
    for sb in shelf_payload.get("books") or []:
        bid = str(sb.get("bookId") or "")
        rtime = int(sb.get("readingTime") or 0)
        if not bid or bid in existing_ids or rtime <= 0:
            continue
        # 合成 notebook 条目
        notebook_entry = {
            "bookId": bid,
            "book": {
                "bookId": bid,
                "title": sb.get("title") or "",
                "author": sb.get("author") or "",
                "cover": sb.get("cover") or "",
                "categories": [],
            },
            "noteCount": 0,
            "bookmarkCount": 0,
            "reviewCount": 0,
            "readingProgress": sb.get("progress") or 0,
            "markedStatus": 0,
        }
        notebooks_payload.setdefault("books", []).append(notebook_entry)
        existing_ids.add(bid)
        added += 1
    if added:
        total = len(notebooks_payload.get("books") or [])
        print(
            f"[info] 从 shelf 合成 {added} 本有读书进 notebooks，总数 {total}",
            file=sys.stderr,
        )
    return added


def fetch_monthly(year: int, month: int) -> dict[str, Any]:
    return {
        "fetchedAt": now_str(),
        "year": year,
        "month": month,
        **api_call(
            "/readdata/detail",
            mode="monthly",
            baseTime=month_base_ts(year, month),
        ),
    }


def iter_months_to_fetch(
    start_year: int, end_year: int, processed: set[str]
) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for y in range(start_year, end_year + 1):
        for m in range(1, 13):
            tag = f"{y}-{m:02d}"
            if tag in processed:
                continue
            out.append((y, m))
    return out


def fetch_book_info(book_id: str) -> dict[str, Any]:
    return {"fetchedAt": now_str(), **api_call("/book/info", bookId=book_id)}


def fetch_book_chapters(book_id: str) -> dict[str, Any]:
    return {"fetchedAt": now_str(), **api_call("/book/chapterinfo", bookId=book_id)}


def fetch_book_progress(book_id: str) -> dict[str, Any]:
    return {"fetchedAt": now_str(), **api_call("/book/getprogress", bookId=book_id)}


def fetch_book_bookmarks(book_id: str) -> dict[str, Any]:
    return {"fetchedAt": now_str(), **api_call("/book/bookmarklist", bookId=book_id)}


def fetch_book_reviews_all(book_id: str) -> dict[str, Any]:
    all_reviews: list[dict[str, Any]] = []
    synckey: int = 0
    while True:
        page = api_call(
            "/review/list/mine",
            bookid=book_id,
            count=REVIEWS_PAGE_SIZE,
            synckey=synckey,
        )
        items = page.get("reviews") or []
        all_reviews.extend(items)
        total = int(page.get("totalCount") or 0)
        if not page.get("hasMore") or not items or len(all_reviews) >= total:
            break
        synckey = int(page.get("synckey") or 0)
        if not synckey:
            break
    return {
        "fetchedAt": now_str(),
        "bookId": book_id,
        "totalCount": len(all_reviews),
        "reviews": all_reviews,
    }


def fetch_book_bestbookmarks(book_id: str) -> dict[str, Any]:
    return {
        "fetchedAt": now_str(),
        **api_call(
            "/book/bestbookmarks",
            bookId=book_id,
            chapterUid=BESTBOOKMARKS_DEFAULT_CHAPTER,
        ),
    }


def fetch_chapter_underlines(book_id: str, chapter_uid: int) -> dict[str, Any]:
    return {
        "fetchedAt": now_str(),
        **api_call(
            "/book/underlines",
            bookId=book_id,
            chapterUid=chapter_uid,
            synckey=0,
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "原样落盘微信读书 skill 各接口的原始回包。"
            "时间维度数据按 YYYY/MM.json 分文件，单书接口按 bookId 分目录。"
        )
    )
    parser.add_argument("--full", action="store_true", help="忽略 state，全量重拉")
    parser.add_argument(
        "--skip-readdata", action="store_true", help="跳过 /readdata/detail 月度数据"
    )
    parser.add_argument("--skip-books", action="store_true", help="跳过单书接口")
    parser.add_argument(
        "--skip-globals", action="store_true", help="跳过 notebooks/shelf/recommend/search"
    )
    parser.add_argument(
        "--start-year",
        type=int,
        default=READDATA_START_YEAR,
        help=f"月度数据起点年份，默认 {READDATA_START_YEAR}",
    )
    parser.add_argument(
        "--end-year",
        type=int,
        default=0,
        help="月度数据终点年份，默认当前年",
    )
    parser.add_argument(
        "--skip-aggregate",
        action="store_true",
        help="跳过 index.json / <year>.json / stats.json 聚合阶段",
    )
    parser.add_argument(
        "--aggregate-only",
        action="store_true",
        help="跳过所有 fetch，只跑 build_aggregates。便于 progress.json 单独刷新后让 stats.json 跟上",
    )
    return parser.parse_args()


def collect_book_ids(notebooks_payload: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for b in notebooks_payload.get("books") or []:
        bid = str(b.get("bookId") or b.get("book", {}).get("bookId") or "")
        if bid and bid not in out:
            out.append(bid)
    return out


def parse_iso_utc(s: str) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _ts_to_date_str(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")


def _iter_month_files(out_dir: Path, start_year: int, end_year: int):
    for y_dir in sorted(out_dir.glob("[0-9][0-9][0-9][0-9]")):
        if not y_dir.is_dir():
            continue
        try:
            y = int(y_dir.name)
        except ValueError:
            continue
        if y < start_year or y > end_year:
            continue
        for m_file in sorted(y_dir.glob("[0-9][0-9].json")):
            try:
                m = int(m_file.stem)
            except ValueError:
                continue
            try:
                payload = json.loads(m_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            yield y, m, payload


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def build_aggregates(out_dir: Path, start_year: int, end_year: int) -> dict[str, Any]:
    """Aggregate monthly files into heatmap data + dashboard stats.

    Writes:
      - <year>.json       per-year daily map consumed by ReadingHeatmap
      - index.json        year index + totals (consumed by ReadingHeatmap)
      - stats.json        dashboard payload (totals, yearly, library, collections)
    """
    years_data: dict[str, dict[str, dict[str, Any]]] = {}
    year_month_seconds: dict[str, list[int]] = {}
    year_book_times: dict[str, dict[str, dict[str, Any]]] = {}
    all_active_dates: set[str] = set()

    for y, m, payload in _iter_month_files(out_dir, start_year, end_year):
        ybt = year_book_times.setdefault(str(y), {})

        month_sec = 0
        for ts_str, seconds in (payload.get("readTimes") or {}).items():
            try:
                date = _ts_to_date_str(int(ts_str))
            except (ValueError, OSError, OverflowError):
                continue
            sec = int(seconds or 0)
            if sec <= 0:
                continue
            date_year = date[:4]
            yd = years_data.setdefault(date_year, {})
            bucket = yd.setdefault(date, {"seconds": 0, "books": []})
            bucket["seconds"] += sec
            all_active_dates.add(date)
            if date_year == str(y):
                month_sec += sec

        yms = year_month_seconds.setdefault(str(y), [0] * 12)
        if 1 <= m <= 12:
            yms[m - 1] += month_sec

        for entry in payload.get("readLongest") or []:
            book = entry.get("book") or {}
            bid = str(book.get("bookId") or "")
            rtime = int(entry.get("readTime") or 0)
            if not bid or rtime <= 0 or not book.get("title"):
                continue
            existing = ybt.get(bid)
            if existing is None:
                ybt[bid] = {"book": book, "readTime": rtime}
            else:
                existing["readTime"] += rtime

    year_totals: dict[str, dict[str, int]] = {}
    for y_key, daily in years_data.items():
        active = sum(1 for b in daily.values() if int(b.get("seconds") or 0) > 0)
        total = sum(int(b.get("seconds") or 0) for b in daily.values())
        year_totals[y_key] = {"activeDays": active, "totalReadSeconds": total}

    for y_key, daily in years_data.items():
        write_json(
            out_dir / f"{y_key}.json",
            {
                "year": y_key,
                "exportedAt": now_str(),
                "daily": daily,
                "yearTotals": year_totals[y_key],
            },
        )

    active_years = sorted(years_data.keys(), reverse=True)
    sorted_dates = sorted(all_active_dates)
    date_range = {"start": sorted_dates[0], "end": sorted_dates[-1]} if sorted_dates else None
    totals_active_days = sum(t["activeDays"] for t in year_totals.values())
    totals_seconds = sum(t["totalReadSeconds"] for t in year_totals.values())

    write_json(
        out_dir / "index.json",
        {
            "exportedAt": now_str(),
            "source": "static/reading/YYYY/MM.json aggregated",
            "activeYears": active_years,
            "dateRange": date_range,
            "totals": {
                "activeDays": totals_active_days,
                "totalReadSeconds": totals_seconds,
            },
        },
    )

    stats = build_stats_payload(
        out_dir,
        years_data=years_data,
        year_totals=year_totals,
        year_book_times=year_book_times,
        year_month_seconds=year_month_seconds,
        active_years=active_years,
        totals_active_days=totals_active_days,
        totals_seconds=totals_seconds,
        date_range=date_range,
    )
    write_json(out_dir / "stats.json", stats)
    return {
        "activeYears": active_years,
        "totals": stats["totals"],
        "libraryCount": len(stats["library"]),
    }


def build_stats_payload(
    out_dir: Path,
    years_data: dict[str, dict[str, dict[str, Any]]],
    year_totals: dict[str, dict[str, int]],
    year_book_times: dict[str, dict[str, dict[str, Any]]],
    year_month_seconds: dict[str, list[int]],
    active_years: list[str],
    totals_active_days: int,
    totals_seconds: int,
    date_range: dict[str, str] | None,
) -> dict[str, Any]:
    notebooks = _load_json(out_dir / "notebooks.json") or {"books": []}
    shelf = _load_json(out_dir / "shelf.json") or {"books": [], "archive": []}

    shelf_by_id: dict[str, dict[str, Any]] = {}
    for b in shelf.get("books") or []:
        bid = str(b.get("bookId") or "")
        if bid:
            shelf_by_id[bid] = b

    library: list[dict[str, Any]] = []
    for entry in notebooks.get("books") or []:
        book = entry.get("book") or {}
        bid = str(entry.get("bookId") or book.get("bookId") or "")
        if not bid:
            continue

        categories = book.get("categories") or []
        category = ""
        if categories and isinstance(categories[0], dict):
            category = categories[0].get("title") or ""

        progress_payload = _load_json(out_dir / "books" / bid / "progress.json")
        progress_book = (progress_payload or {}).get("book") or {}
        total_read_time = progress_book.get("readingTime")
        # progress.json 缺失或为 0 时回退到月度 readLongest 累加（shelf.books 没 readingTime 字段）
        if not total_read_time:
            rl_total = sum(
                int(e.get("readTime") or 0)
                for y in range(int(min(year_totals) or 2018) if year_totals else 2018,
                               int(max(year_totals) or 2026) if year_totals else 2027)
                for m in range(1, 13)
                for p in [out_dir / str(y) / f"{m:02d}.json"]
                if p.exists()
                for e in (json.loads(p.read_text(encoding="utf-8")).get("readLongest") or [])
                if str((e.get("book") or {}).get("bookId") or "") == bid
            )
            if rl_total > 0:
                total_read_time = rl_total
        if total_read_time is not None:
            total_read_time = int(total_read_time)
        progress_pct = progress_book.get("progress")
        if progress_pct is None:
            progress_pct = entry.get("readingProgress")
        if progress_pct is not None:
            try:
                progress_pct = int(progress_pct)
            except (TypeError, ValueError):
                progress_pct = None
        start_read_time = progress_book.get("startReadingTime")
        if start_read_time is not None:
            try:
                start_read_time = int(start_read_time)
            except (TypeError, ValueError):
                start_read_time = None
        last_update_time = progress_book.get("updateTime")
        if last_update_time is not None:
            try:
                last_update_time = int(last_update_time)
            except (TypeError, ValueError):
                last_update_time = None

        sh = shelf_by_id.get(bid) or {}
        read_update_time = sh.get("readUpdateTime")
        if read_update_time is not None:
            try:
                read_update_time = int(read_update_time)
            except (TypeError, ValueError):
                read_update_time = None
        finish_reading = bool(sh.get("finishReading"))

        bookmark_count = entry.get("bookmarkCount") or 0
        bb_payload = _load_json(out_dir / "books" / bid / "bestbookmarks.json")
        if bb_payload and bb_payload.get("totalCount") is not None:
            try:
                bookmark_count = int(bb_payload["totalCount"])
            except (TypeError, ValueError):
                pass

        ts_for_year = read_update_time or last_update_time
        year: int | None = None
        if ts_for_year:
            try:
                year = int(datetime.fromtimestamp(int(ts_for_year), tz=timezone.utc).strftime("%Y"))
            except (ValueError, OSError, OverflowError):
                year = None

        library.append(
            {
                "bookId": bid,
                "title": book.get("title") or "",
                "author": book.get("author") or "",
                "cover": book.get("cover") or "",
                "category": category,
                "totalReadTime": total_read_time,
                "progress": progress_pct,
                "markedStatus": entry.get("markedStatus"),
                "noteCount": entry.get("noteCount") or 0,
                "bookmarkCount": bookmark_count,
                "reviewCount": entry.get("reviewCount") or 0,
                "startReadTime": start_read_time,
                "lastReadTime": read_update_time or last_update_time,
                "finishTime": read_update_time if finish_reading else None,
                "year": year,
                "publisher": book.get("publisher") or "",
                "isbn": book.get("isbn") or "",
                "intro": book.get("intro") or "",
                "finishReading": finish_reading,
            }
        )

    library.sort(key=lambda b: b.get("lastReadTime") or 0, reverse=True)

    yearly: list[dict[str, Any]] = []
    for y_key in active_years:
        y_int = int(y_key)
        yt = year_totals.get(y_key, {"activeDays": 0, "totalReadSeconds": 0})
        books_in_year = [b for b in library if b.get("year") == y_int]
        books_finished = sum(
            1
            for b in books_in_year
            if (b.get("progress") or 0) >= 99 or b.get("finishReading")
        )
        notes_in_year = sum(int(b.get("noteCount") or 0) for b in books_in_year)
        ybt = year_book_times.get(y_key) or {}
        top_bid = max(ybt, key=lambda k: ybt[k]["readTime"]) if ybt else None
        longest = ybt.get(top_bid) if top_bid else None
        longest_book = (longest or {}).get("book") or {}
        yearly.append(
            {
                "year": y_key,
                "activeDays": yt["activeDays"],
                "totalReadSeconds": yt["totalReadSeconds"],
                "booksRead": len(books_in_year),
                "booksFinished": books_finished,
                "notesCount": notes_in_year,
                "monthlySeconds": year_month_seconds.get(y_key, [0] * 12),
                "longestRead": {
                    "bookId": longest_book.get("bookId"),
                    "title": longest_book.get("title") or "",
                    "author": longest_book.get("author") or "",
                    "cover": longest_book.get("cover") or "",
                    "readTime": int((longest or {}).get("readTime") or 0),
                }
                if longest_book
                else None,
            }
        )

    totals = {
        "activeDays": totals_active_days,
        "totalReadSeconds": totals_seconds,
        "booksInLibrary": len(library),
        "booksFinished": sum(
            1
            for b in library
            if (b.get("progress") or 0) >= 99 or b.get("finishReading")
        ),
        "notesTotal": sum(int(b.get("noteCount") or 0) for b in library),
        "bookmarksTotal": sum(int(b.get("bookmarkCount") or 0) for b in library),
        "traceableCount": sum(1 for b in library if b.get("year") is not None),
    }

    collections = [
        {"name": a.get("name") or "", "bookIds": a.get("bookIds") or []}
        for a in (shelf.get("archive") or [])
    ]

    return {
        "exportedAt": now_str(),
        "totals": totals,
        "yearly": yearly,
        "library": library,
        "collections": collections,
        "dateRange": date_range,
    }


def should_refresh_book(
    book_id: str, state: dict[str, Any], full: bool
) -> bool:
    if full:
        return True
    last = state.get("books", {}).get(book_id, {}).get("lastFetched", "")
    if not last:
        return True
    parsed = parse_iso_utc(last)
    if not parsed:
        return True
    age = datetime.now(tz=timezone.utc) - parsed
    return age.days >= BOOK_REFRESH_DAYS


def main() -> int:
    args = parse_args()
    state = load_state()
    today = datetime.now(tz=timezone.utc).astimezone()
    end_year = args.end_year or today.year
    end_month = today.month if end_year == today.year else 12

    # 所有模式都先：读已有 notebooks.json + shelf.json，把 shelf 里 readingTime>0 的书
    # 合并进 notebooks，防止后续 export 覆盖后丢失
    if not args.aggregate_only:
        existing_nb = _load_json(OUT_DIR / "notebooks.json") or {"books": []}
        existing_shelf = _load_json(OUT_DIR / "shelf.json") or {"books": []}
        merge_shelf_read_books(existing_nb, existing_shelf)
        write_json(OUT_DIR / "notebooks.json", existing_nb)

    if args.aggregate_only:
        print("[info] --aggregate-only: 跳过所有 fetch，仅重跑聚合", file=sys.stderr)
        try:
            summary = build_aggregates(OUT_DIR, args.start_year, end_year)
            print(
                f"[info] aggregate: {len(summary['activeYears'])} 年, "
                f"{summary['libraryCount']} 本, "
                f"activeDays={summary['totals']['activeDays']}",
                file=sys.stderr,
            )
        except Exception as exc:
            print(f"[warn] 聚合失败: {exc}", file=sys.stderr)
        return 0

    if args.skip_globals:
        existing = _load_json(OUT_DIR / "notebooks.json")
        notebooks_payload = existing or {"books": []}
    else:
        notebooks_payload = fetch_notebooks_all()
    print(
        f"[info] notebooks: {len(notebooks_payload.get('books', []))} 本",
        file=sys.stderr,
    )

    if not args.skip_globals:
        write_json(OUT_DIR / "notebooks.json", notebooks_payload)
        time.sleep(API_SLEEP_SECONDS)
        try:
            shelf_payload = fetch_shelf()
            write_json(OUT_DIR / "shelf.json", shelf_payload)
        except Exception as exc:
            print(f"[warn] shelf 失败: {exc}", file=sys.stderr)
            shelf_payload = _load_json(OUT_DIR / "shelf.json") or {"books": []}
        time.sleep(API_SLEEP_SECONDS)
        try:
            write_json(OUT_DIR / "recommend.json", fetch_recommend())
        except Exception as exc:
            print(f"[warn] recommend 失败: {exc}", file=sys.stderr)
        time.sleep(API_SLEEP_SECONDS)
        try:
            write_json(OUT_DIR / "search.json", fetch_search_default())
        except Exception as exc:
            print(f"[warn] search 失败: {exc}", file=sys.stderr)
    else:
        shelf_payload = _load_json(OUT_DIR / "shelf.json") or {"books": []}

    # 把 shelf 里 readingTime>0 的书合成进 notebooks，让它们能进 library
    merge_shelf_read_books(notebooks_payload, shelf_payload)
    if not args.skip_globals:
        write_json(OUT_DIR / "notebooks.json", notebooks_payload)

    if not args.skip_readdata:
        processed = set() if args.full else set(state.get("monthly_ym") or [])
        months = [
            (y, m)
            for y, m in iter_months_to_fetch(args.start_year, end_year, processed)
            if not (y == end_year and m > end_month)
        ]
        print(
            f"[info] 待拉月度 {len(months)} 个 (起点 {args.start_year}, 终点 {end_year}-{end_month:02d})",
            file=sys.stderr,
        )
        for y, m in months:
            try:
                payload = fetch_monthly(y, m)
                write_json(OUT_DIR / f"{y}" / f"{m:02d}.json", payload)
                state.setdefault("monthly_ym", []).append(f"{y}-{m:02d}")
                print(f"[info] wrote {y}/{m:02d}.json", file=sys.stderr)
            except Exception as exc:
                print(f"[warn] {y}-{m:02d} 失败: {exc}", file=sys.stderr)
            time.sleep(API_SLEEP_SECONDS)

    if not args.skip_books:
        book_ids = collect_book_ids(notebooks_payload)
        to_refresh = [bid for bid in book_ids if should_refresh_book(bid, state, args.full)]
        print(
            f"[info] books: {len(book_ids)} 本, 待刷 {len(to_refresh)} 本",
            file=sys.stderr,
        )
        for idx, book_id in enumerate(to_refresh, start=1):
            book_dir = OUT_DIR / "books" / book_id
            try:
                write_json(book_dir / "info.json", fetch_book_info(book_id))
                time.sleep(API_SLEEP_SECONDS)
                chapters_payload = fetch_book_chapters(book_id)
                write_json(book_dir / "chapters.json", chapters_payload)
                time.sleep(API_SLEEP_SECONDS)
                write_json(book_dir / "progress.json", fetch_book_progress(book_id))
                time.sleep(API_SLEEP_SECONDS)
                write_json(book_dir / "bookmarks.json", fetch_book_bookmarks(book_id))
                time.sleep(API_SLEEP_SECONDS)
                write_json(book_dir / "reviews.json", fetch_book_reviews_all(book_id))
                time.sleep(API_SLEEP_SECONDS)
                write_json(book_dir / "bestbookmarks.json", fetch_book_bestbookmarks(book_id))
                time.sleep(API_SLEEP_SECONDS)

                for ch in chapters_payload.get("chapters") or []:
                    uid = ch.get("chapterUid")
                    if uid is None:
                        continue
                    try:
                        write_json(
                            book_dir / "underlines" / f"{uid}.json",
                            fetch_chapter_underlines(book_id, int(uid)),
                        )
                    except Exception as exc:
                        print(
                            f"[warn] underlines {book_id} {uid} 失败: {exc}",
                            file=sys.stderr,
                        )
                    time.sleep(API_SLEEP_SECONDS)

                state.setdefault("books", {})[book_id] = {"lastFetched": now_str()}
                if idx % 20 == 0 or idx == len(to_refresh):
                    save_state(state)
                    print(
                        f"[info] books 进度 {idx}/{len(to_refresh)}",
                        file=sys.stderr,
                    )
            except Exception as exc:
                print(f"[warn] book {book_id} 失败: {exc}", file=sys.stderr)

    save_state(state)
    print("[info] done", file=sys.stderr)

    if not args.skip_aggregate:
        try:
            summary = build_aggregates(OUT_DIR, args.start_year, end_year)
            print(
                f"[info] aggregate: {len(summary['activeYears'])} 年, "
                f"{summary['libraryCount']} 本, "
                f"activeDays={summary['totals']['activeDays']}",
                file=sys.stderr,
            )
        except Exception as exc:
            print(f"[warn] 聚合失败: {exc}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
