#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
    HK IPO
    ~~~~~~

    查询港股打新数据。

    逻辑：
    - 查询近5年港股 FILLED_ALL 历史订单
    - 通过 get_stock_basicinfo 获取每只股票的上市日期
    - 交易日距上市日 ≤ IPO_DAYS_THRESHOLD 天视为打新单

    :author:    Feei <feei@feei.cn>
    :homepage:  https://github.com/FeeiCN/StockAnalysis
    :license:   GPL, see LICENSE for more details.
    :copyright: Copyright (c) 2024 Feei. All rights reserved
"""

import argparse
import json
import logging
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, date
from pathlib import Path

from futu import *
from futu.common.ft_logger import logger as futu_logger

from status_page import update_status_page


SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_DIR = SCRIPT_DIR / "cache"
LISTING_DATE_CACHE_FILE = CACHE_DIR / "listing_dates.json"
ISSUE_PRICE_CACHE_FILE = CACHE_DIR / "issue_prices.json"

FEEICN_REPO_ROOT = SCRIPT_DIR.parent
OUTPUT_PATH = FEEICN_REPO_ROOT / "docs/03-财务自由/03-投资/03-港股打新/04-港股打新数据.mdx"


def load_cache(path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def save_cache(path, data):
    CACHE_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


PORT_LABELS = {
    11111: "FeeiCN",
    11112: "FeeiCN2",
}

SECURITY_FIRM_MAP = {
    name: getattr(SecurityFirm, name)
    for name in ("FUTUSECURITIES", "FUTUINC", "FUTUSG", "FUTUAU")
    if hasattr(SecurityFirm, name)
}

TRD_ENV_MAP = {
    "REAL": TrdEnv.REAL,
    "SIMULATE": TrdEnv.SIMULATE,
}

# 交易日距上市日在此范围内视为打新单（负数=上市前申购，正数=上市后买入）
IPO_DAYS_BEFORE = 10
IPO_DAYS_AFTER = 5


def log(message):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", file=sys.stderr)


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def silence_futu_logs():
    futu_logger.console_level = logging.CRITICAL + 1


def dataframe_to_records(df):
    if df is None:
        return []
    return json.loads(df.to_json(orient="records", force_ascii=False))


def get_listing_dates(host, port, codes):
    """批量查询股票上市日期，有缓存则直接返回，返回 {code: date} 字典。"""
    if not codes:
        return {}
    cache = load_cache(LISTING_DATE_CACHE_FILE)
    missing = [c for c in codes if c not in cache]

    if missing:
        ctx = OpenQuoteContext(host=host, port=port)
        try:
            chunk_size = 100
            for i in range(0, len(missing), chunk_size):
                chunk = missing[i:i + chunk_size]
                ret, data = ctx.get_stock_basicinfo(Market.HK, SecurityType.STOCK, chunk)
                if ret != RET_OK:
                    continue
                for row in dataframe_to_records(data):
                    raw = row.get("listing_date", "")
                    if raw and raw != "N/A":
                        cache[row["code"]] = raw[:10]
        finally:
            ctx.close()
        save_cache(LISTING_DATE_CACHE_FILE, cache)

    result = {}
    for code in codes:
        raw = cache.get(code)
        if raw:
            try:
                result[code] = datetime.strptime(raw, "%Y-%m-%d").date()
            except ValueError:
                pass
    return result


def get_issue_prices(host, port, codes):
    """通过 get_company_profile 获取发行价，有缓存则直接返回，返回 {code: price}。
    需要 OpenD 10.x 以上版本支持。"""
    if not codes:
        return {}
    cache = load_cache(ISSUE_PRICE_CACHE_FILE)
    missing = [c for c in codes if c not in cache]

    if missing:
        ctx = OpenQuoteContext(host=host, port=port)
        try:
            for code in missing:
                ret, data = ctx.get_company_profile(code)
                if ret != RET_OK:
                    continue
                for row in dataframe_to_records(data):
                    if row.get("name") == "发行价格":
                        try:
                            price = float(row["value"])
                            if price > 0:
                                cache[code] = price
                        except (ValueError, TypeError):
                            pass
                        break
        finally:
            ctx.close()
        save_cache(ISSUE_PRICE_CACHE_FILE, cache)

    return {code: cache[code] for code in codes if code in cache}


def ipo_delta(trade_date_str, listing_date):
    """计算交易日距上市日的天数差（正数=上市后，负数=上市前）。"""
    if not listing_date or not trade_date_str:
        return None
    try:
        trade_date = datetime.strptime(trade_date_str[:10], "%Y-%m-%d").date()
        return (trade_date - listing_date).days
    except (ValueError, TypeError):
        return None


def query_account(args, port):
    label = PORT_LABELS.get(port, str(port))
    log(f"[{label}] 连接 port={port} ...")

    trd_ctx = OpenSecTradeContext(
        filter_trdmarket=TrdMarket.HK,
        host=args.host,
        port=port,
        security_firm=SECURITY_FIRM_MAP[args.security_firm],
    )
    try:
        ret, acc_list = trd_ctx.get_acc_list()
        if ret != RET_OK:
            fail(f"[{label}] get_acc_list error: {acc_list}")

        accounts = dataframe_to_records(acc_list)
        selected = next((a for a in accounts if a.get("trd_env") == args.env), None)
        if not selected:
            fail(f"[{label}] 未找到 trd_env={args.env} 的账户")
        acc_id = int(selected["acc_id"])
        trd_env = TRD_ENV_MAP[args.env]

        log(f"[{label}] 查询近5年港股历史订单 ...")
        end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=365 * 5)
        ret, order_df = trd_ctx.history_order_list_query(
            start=start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            end=end_dt.strftime("%Y-%m-%d %H:%M:%S"),
            trd_env=trd_env,
            acc_id=acc_id,
        )
        if ret != RET_OK:
            fail(f"[{label}] history_order_list_query error: {order_df}")

        all_orders = dataframe_to_records(order_df)
        hk_filled = [
            o for o in all_orders
            if str(o.get("code", "")).startswith("HK.")
            and o.get("order_status") == "FILLED_ALL"
        ]
    finally:
        trd_ctx.close()

    log(f"[{label}] 港股成交订单 {len(hk_filled)} 条，查询上市日期 ...")
    hk_codes = {o["code"] for o in hk_filled}
    listing_dates = get_listing_dates(args.host, port, hk_codes)

    orders_with_delta = []
    for o in hk_filled:
        code = o["code"]
        listing_date = listing_dates.get(code)
        delta = ipo_delta(o.get("create_time", ""), listing_date)
        is_ipo = (
            delta is not None
            and -IPO_DAYS_BEFORE <= delta <= IPO_DAYS_AFTER
        )
        orders_with_delta.append({
            **o,
            "listing_date": str(listing_date) if listing_date else "",
            "delta": delta,
            "is_ipo": is_ipo,
        })

    ipo_orders = [o for o in orders_with_delta if o["is_ipo"]]

    ipo_codes = {o["code"] for o in ipo_orders}
    log(f"[{label}] 查询 {len(ipo_codes)} 只股票的发行价格 ...")
    issue_prices = get_issue_prices(args.host, port, ipo_codes)
    if not issue_prices:
        log(f"[{label}] 警告：get_company_profile 无数据，请升级 OpenD 至 10.x 以上")

    for o in ipo_orders:
        code = o["code"]
        trade_price = o.get("price") or 0
        qty = o.get("qty") or 0
        issue_price = issue_prices.get(code)
        o["issue_price"] = issue_price
        if issue_price and trade_price:
            o["pnl"] = qty * (trade_price - issue_price)
            o["pnl_pct"] = (trade_price - issue_price) / issue_price * 100
        else:
            o["pnl"] = None
            o["pnl_pct"] = None

    log(f"[{label}] 完成，识别打新单 {len(ipo_orders)} 条")
    return {
        "label": label,
        "port": port,
        "ipo_orders": sorted(ipo_orders, key=lambda o: o.get("create_time", ""), reverse=True),
        "all_hk_orders": orders_with_delta,
    }


def fmt(value, default=""):
    if value is None:
        return default
    if isinstance(value, bool):
        return "✓" if value else ""
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def run_git_command(args, cwd):
    completed = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
    )
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        fail(f"git {' '.join(args)} failed: {details}")
    return completed


def write_to_feeicn(account_results):
    log("git pull FEEI.CN ...")
    run_git_command(["pull", "--ff-only"], FEEICN_REPO_ROOT)

    content = render_markdown(account_results)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(content, encoding="utf-8")
    log(f"写入 {OUTPUT_PATH.name}")

    status_path = update_status_page(
        key="hk-ipo",
        name="港股打新数据",
        script="scripts/hk_ipo.py",
        status="成功",
        run_time=datetime.now(),
        outputs=[{"title": "港股打新数据", "slug": "/hk-ipo-data"}],
    )
    log(f"写入状态页 -> {status_path.name}")

    relative_paths = [
        str(OUTPUT_PATH.relative_to(FEEICN_REPO_ROOT)),
        str(status_path.relative_to(FEEICN_REPO_ROOT)),
    ]
    run_git_command(["add", "--", *relative_paths], FEEICN_REPO_ROOT)
    diff = subprocess.run(
        ["git", "diff", "--cached", "--quiet", "--", *relative_paths],
        cwd=FEEICN_REPO_ROOT, capture_output=True,
    )
    if diff.returncode == 0:
        log("无变更，跳过 commit")
        return
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    log("git commit ...")
    run_git_command(["commit", "--only", "-m", f"更新港股打新数据 {timestamp}", "--", *relative_paths], FEEICN_REPO_ROOT)
    log("git push ...")
    run_git_command(["push"], FEEICN_REPO_ROOT)
    log("git push 完成")


def render_markdown(account_results):
    columns = [
        ("label",        "账户"),
        ("code",         "代码"),
        ("stock_name",   "名称"),
        ("create_time",  "交易时间"),
        ("listing_date", "上市日期"),
        ("delta_str",    "距上市"),
        ("qty",          "数量"),
        ("issue_price",  "发行价"),
        ("price",        "交易价"),
        ("amount",       "交易金额"),
        ("pnl_str",      "盈亏"),
        ("pnl_pct_str",  "盈亏率"),
    ]
    headers = [title for _, title in columns]
    sep = ["---"] * len(headers)

    # 合并所有账户订单
    all_orders = []
    for result in account_results:
        for o in result["ipo_orders"]:
            all_orders.append({**o, "label": result["label"]})
    all_orders.sort(key=lambda o: o.get("create_time", ""), reverse=True)

    total_pnl = sum(o["pnl"] for o in all_orders if o.get("pnl") is not None)
    total_count = len(all_orders)
    sign = "+" if total_pnl >= 0 else ""

    # ipoTrades：包含所有打新订单，未卖出时保留在图表里，方便看见未兑现仓位
    trades_for_chart = sorted(all_orders, key=lambda o: o.get("create_time", ""))
    trade_lines = []
    for o in trades_for_chart:
        date = (o.get("create_time") or "")[:10]
        account = o["label"]
        name = str(o.get("stock_name", "")).replace("'", "\\'")
        pnl = int(round(o["pnl"])) if o.get("pnl") is not None else 0
        sold = "true" if o.get("pnl") is not None else "false"
        trade_lines.append(
            f"  {{date: '{date}', account: '{account}', name: '{name}', pnl: {pnl}, sold: {sold}}},"
        )

    lines = [
        "---",
        "slug: /hk-ipo-data",
        "icon: chart-histogram-icon",
        "---",
        "",
        "import HKIPOCharts from '@site/src/components/HKIPOCharts';",
        "",
        "export const ipoTrades = [",
        *trade_lines,
        "];",
        "",
        "# 港股打新数据",
        "",
        "<HKIPOCharts trades={ipoTrades} />",
        "",
        f"共 {total_count} 条，合计盈亏 {sign}{total_pnl:.0f} HKD",
        "",
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(sep) + " |",
    ]

    for o in all_orders:
        qty = o.get("qty") or 0
        price = o.get("price") or 0
        pnl_str, pnl_pct_str = fmt_pnl(o.get("pnl"), o.get("pnl_pct"))
        row = {
            **o,
            "create_time": (o.get("create_time") or "")[:10],
            "delta_str": fmt_delta(o.get("delta")),
            "amount": f"{qty * price:.0f}",
            "pnl_str": pnl_str,
            "pnl_pct_str": pnl_pct_str,
        }
        cells = [fmt(row.get(key)) for key, _ in columns]
        lines.append("| " + " | ".join(cells) + " |")

    lines.append("")
    return "\n".join(lines)


def fmt_pnl(pnl, pnl_pct):
    if pnl is None:
        return "", ""
    sign = "+" if pnl >= 0 else ""
    return f"{sign}{pnl:.0f}", f"{sign}{pnl_pct:.1f}%"


def fmt_delta(delta):
    if delta is None:
        return ""
    if delta == 0:
        return "上市当天"
    if delta < 0:
        return f"上市前{abs(delta)}天"
    return f"上市后{delta}天"


def print_ipo_orders(account_results):
    cols = [
        ("code",         "代码",     10),
        ("stock_name",   "名称",     12),
        ("create_time",  "交易时间",  12),
        ("listing_date", "上市日期",  10),
        ("delta_str",    "距上市",    10),
        ("qty",          "数量",       6),
        ("issue_price",  "发行价",     8),
        ("price",        "交易价",     8),
        ("amount",       "交易金额",  10),
        ("pnl_str",      "盈亏",      10),
        ("pnl_pct_str",  "盈亏率",     8),
    ]

    for result in account_results:
        label = result["label"]
        orders = result["ipo_orders"]
        print(f"\n{'═' * 110}")
        print(f"  {label}  港股打新单（共 {len(orders)} 条）")
        print(f"{'═' * 110}")
        if not orders:
            print("  暂无打新记录\n")
            continue

        total_pnl = sum(o["pnl"] for o in orders if o.get("pnl") is not None)

        header = "  ".join(title.ljust(w) for _, title, w in cols)
        print(header)
        print("─" * len(header))
        for o in orders:
            qty = o.get("qty") or 0
            price = o.get("price") or 0
            pnl_str, pnl_pct_str = fmt_pnl(o.get("pnl"), o.get("pnl_pct"))
            row_data = {
                **o,
                "create_time": (o.get("create_time") or "")[:10],
                "delta_str": fmt_delta(o.get("delta")),
                "amount": f"{qty * price:.0f}",
                "pnl_str": pnl_str,
                "pnl_pct_str": pnl_pct_str,
            }
            row = "  ".join(fmt(row_data.get(key)).ljust(w) for key, _, w in cols)
            print(row)

        sign = "+" if total_pnl >= 0 else ""
        print("─" * len(header))
        print(f"  合计盈亏（上市收盘价计）：{sign}{total_pnl:.0f} HKD\n")


def build_parser():
    parser = argparse.ArgumentParser(description="查询港股打新历史")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ports", default="11111,11112", help="OpenD ports，逗号分隔")
    parser.add_argument("--env", default="REAL", choices=["REAL", "SIMULATE"])
    parser.add_argument(
        "--security-firm",
        default="FUTUSECURITIES",
        choices=sorted(SECURITY_FIRM_MAP.keys()),
    )
    parser.add_argument(
        "--days-after",
        type=int,
        default=IPO_DAYS_AFTER,
        help=f"上市后多少天内视为打新（默认 {IPO_DAYS_AFTER}）",
    )
    parser.add_argument(
        "--days-before",
        type=int,
        default=IPO_DAYS_BEFORE,
        help=f"上市前多少天内视为打新申购（默认 {IPO_DAYS_BEFORE}）",
    )
    return parser


def parse_ports(text):
    return [int(p.strip()) for p in text.split(",") if p.strip()]


def main():
    args = build_parser().parse_args()
    global IPO_DAYS_BEFORE, IPO_DAYS_AFTER
    IPO_DAYS_BEFORE = args.days_before
    IPO_DAYS_AFTER = args.days_after
    silence_futu_logs()

    ports = parse_ports(args.ports)
    log(f"并行查询 {len(ports)} 个账户 ...")
    account_results = [None] * len(ports)
    with ThreadPoolExecutor(max_workers=len(ports)) as executor:
        futures = {executor.submit(query_account, args, port): i for i, port in enumerate(ports)}
        for future in as_completed(futures):
            account_results[futures[future]] = future.result()

    print_ipo_orders(account_results)
    write_to_feeicn(account_results)


if __name__ == "__main__":
    main()
