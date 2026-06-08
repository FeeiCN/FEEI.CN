#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
    Account Assets
    ~~~~~~~~~~~~~~

    Query Futu account list, funds and positions.

    :author:    Feei <feei@feei.cn>
    :homepage:  https://github.com/FeeiCN/StockAnalysis
    :license:   GPL, see LICENSE for more details.
    :copyright: Copyright (c) 2024 Feei. All rights reserved
"""

import argparse
import json
import logging
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
import sys

from futu import *
from futu.common.ft_logger import logger as futu_logger

from status_page import update_status_page


TRD_ENV_MAP = {
    "REAL": TrdEnv.REAL,
    "SIMULATE": TrdEnv.SIMULATE,
}

TRD_MARKET_MAP = {
    "HK": TrdMarket.HK,
    "US": TrdMarket.US,
    "HKCC": TrdMarket.HKCC,
    "CN": TrdMarket.CN,
    "SG": TrdMarket.SG,
    "JP": TrdMarket.JP,
    "AU": TrdMarket.AU,
    "CA": TrdMarket.CA,
    "MY": TrdMarket.MY,
}

SECURITY_FIRM_MAP = {
    name: getattr(SecurityFirm, name)
    for name in ("FUTUSECURITIES", "FUTUINC", "FUTUSG", "FUTUAU")
    if hasattr(SecurityFirm, name)
}

POSITION_MARKET_MAP = {
    "NONE": TrdMarket.NONE,
    **TRD_MARKET_MAP,
}

FUNDS_CURRENCY_MAP = {
    "HKD": Currency.HKD,
    "USD": Currency.USD,
    "CNH": Currency.CNH,
    "JPY": Currency.JPY,
    "SGD": Currency.SGD,
    "AUD": Currency.AUD,
}

SCRIPT_DIR = Path(__file__).resolve().parent
SNAPSHOT_DIR = SCRIPT_DIR / "snapshots"
FEEICN_REPO_ROOT = SCRIPT_DIR.parent
PORT_LABELS = {
    11111: "FeeiCN",
    11112: "FeeiCN2",
}
ACCOUNT_OUTPUT_TARGETS = {
    "FeeiCN2": FEEICN_REPO_ROOT / "docs/03-财务自由/03-投资/01-指数基金/01-指数数据.mdx",
    "FeeiCN": FEEICN_REPO_ROOT / "docs/03-财务自由/03-投资/02-个股/01-个股数据.mdx",
}
ACCOUNT_MDX_CONFIG = {
    "FeeiCN2": {
        "slug": "/index-data",
        "icon": "chart-line-icon",
        "title": "指数账号资产数据",
        "sidebar_badge": {"text": "数据", "color": "info"},
    },
    "FeeiCN": {
        "slug": "/stock-data",
        "icon": "chart-line-icon",
        "title": "个股账号资产数据",
        "sidebar_badge": {"text": "数据", "color": "info"},
    },
}


def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", file=sys.stderr)


def silence_futu_console_logs():
    futu_logger.console_level = logging.CRITICAL + 1


def run_git_command(args, cwd):
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout).strip()
        fail(f"git {' '.join(args)} failed: {details}")
    return completed


def git_pull_target_repo():
    log("git pull FEEI.CN ...")
    run_git_command(["pull", "--ff-only"], FEEICN_REPO_ROOT)
    log("git pull 完成")


def write_generated_mdx(account_label, markdown_text):
    target_path = ACCOUNT_OUTPUT_TARGETS.get(account_label)
    if not target_path:
        return None

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(markdown_text, encoding="utf-8")
    return target_path


def git_commit_and_push_target_repo(paths):
    relative_paths = [str(path.relative_to(FEEICN_REPO_ROOT)) for path in paths if path]
    if not relative_paths:
        return

    run_git_command(["add", "--", *relative_paths], FEEICN_REPO_ROOT)
    diff_check = subprocess.run(
        ["git", "diff", "--cached", "--quiet", "--", *relative_paths],
        cwd=FEEICN_REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if diff_check.returncode == 0:
        return
    if diff_check.returncode != 1:
        details = (diff_check.stderr or diff_check.stdout).strip()
        fail(f"git diff --cached failed: {details}")

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    log("git commit ...")
    run_git_command(
        ["commit", "--only", "-m", f"更新投资数据 {timestamp}", "--", *relative_paths],
        FEEICN_REPO_ROOT,
    )
    log("git push ...")
    run_git_command(["push"], FEEICN_REPO_ROOT)
    log("git push 完成")


def write_feeicn_outputs(port_results, run_finished_at):
    git_pull_target_repo()
    updated_paths = []
    for result in port_results:
        label = result["account_label"]
        config = ACCOUNT_MDX_CONFIG.get(label)
        if not config:
            continue
        mdx_text = render_account_mdx(result, config)
        updated_path = write_generated_mdx(label, mdx_text)
        if updated_path:
            log(f"写入 {label} -> {updated_path.name}")
            updated_paths.append(updated_path)
    status_path = update_status_page(
        key="financial-assets",
        name="财务自由数据",
        script="scripts/account_assets.py",
        status="成功",
        run_time=run_finished_at,
        outputs=[
            {"title": config["title"], "slug": config["slug"]}
            for result in port_results
            if (config := ACCOUNT_MDX_CONFIG.get(result["account_label"]))
        ],
    )
    log(f"写入状态页 -> {status_path.name}")
    updated_paths.append(status_path)
    git_commit_and_push_target_repo(updated_paths)


def dataframe_to_records(df):
    if df is None:
        return []
    return json.loads(df.to_json(orient="records", force_ascii=False))


def format_value(value):
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.1f}"
    if isinstance(value, int):
        return f"{value:.1f}"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def format_percent(value):
    if isinstance(value, (int, float)):
        return f"{format_value(value)}%"
    return format_value(value)


def infer_currency_by_market(position_market, fallback_currency=None):
    if position_market == "US":
        return "USD"
    if position_market == "HK":
        return "HKD"
    return fallback_currency or ""


def format_money(value, currency=None):
    text = format_value(value)
    if text == "":
        return ""
    return f"{text} {currency}" if currency else text


def format_signed_value(value):
    if not isinstance(value, (int, float)):
        return ""
    return f"{value:+.1f}"


def format_signed_money(value, currency=None):
    text = format_signed_value(value)
    if text == "":
        return ""
    return f"{text} {currency}" if currency else text


def colorize_number_text(text, value):
    if not isinstance(value, (int, float)) or value == 0:
        return text
    color = "red" if value > 0 else "green"
    return f'<span style={{{{color: "{color}"}}}}>{text}</span>'


def combine_values(*values):
    parts = [part for part in (format_value(value) for value in values) if part != ""]
    return "<br />".join(parts)


def combine_current_and_delta(current, delta):
    parts = []
    current_text = format_value(current)
    delta_text = format_signed_value(delta)
    if current_text != "":
        parts.append(current_text)
    if delta_text != "":
        parts.append(delta_text)
    return "<br />".join(parts)


def build_colored_pl_block(pl_val, pl_ratio, currency=None):
    return "<br />".join([
        colorize_number_text(format_money(pl_val, currency), pl_val),
        colorize_number_text(format_percent(pl_ratio), pl_ratio),
    ])


def weighted_ratio(records, value_key, weight_key):
    total_weight = 0.0
    total_value = 0.0
    for record in records:
        value = record.get(value_key)
        weight = record.get(weight_key)
        if isinstance(value, (int, float)) and isinstance(weight, (int, float)):
            total_value += float(value) * float(weight)
            total_weight += float(weight)
    if total_weight == 0:
        return None
    return total_value / total_weight


def split_positions_by_currency(positions):
    groups = {}
    for position in positions:
        currency = infer_currency_by_market(position.get("position_market"), position.get("currency"))
        groups.setdefault(currency, []).append(position)
    return groups


def markdown_table(records, columns):
    if not records:
        return "_无数据_"

    headers = [title for _, title in columns]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]

    for record in records:
        row = [format_value(record.get(key)) for key, _ in columns]
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)


def bold_record(record):
    return {key: f"**{format_value(value)}**" for key, value in record.items()}


def append_position_summary_rows(position_rows, positions, account_label):
    for currency, group_positions in split_positions_by_currency(positions).items():
        summary_row = {
            "account_label": f"**{account_label}**",
            "stock_name": f"**汇总 ({currency or 'N/A'})**",
            "position_market": "",
            "pl_combined": build_colored_pl_block(
                sum_numeric(group_positions, "pl_val"),
                weighted_ratio(group_positions, "pl_ratio", "market_val"),
                currency,
            ),
            "today_pl_val": colorize_number_text(
                format_signed_money(sum_numeric(group_positions, "today_pl_val"), currency),
                sum_numeric(group_positions, "today_pl_val"),
            ),
            "market_qty": combine_values(format_money(sum_numeric(group_positions, "market_val"), currency), sum_numeric(group_positions, "qty")),
            "price_cost": "",
            "today_buy_combined": combine_values(format_money(sum_numeric(group_positions, "today_buy_val"), currency), sum_numeric(group_positions, "today_buy_qty")),
            "today_trd_val": format_money(sum_numeric(group_positions, "today_trd_val"), currency),
            "today_sell_combined": combine_values(format_money(sum_numeric(group_positions, "today_sell_val"), currency), sum_numeric(group_positions, "today_sell_qty")),
            "unrealized_pl": format_money(sum_numeric(group_positions, "unrealized_pl"), currency),
            "realized_pl": format_money(sum_numeric(group_positions, "realized_pl"), currency),
        }
        position_rows.append(summary_row)


def snapshot_path(selected_account, port, snapshot_date=None):
    target_date = snapshot_date or datetime.now().date()
    return SNAPSHOT_DIR / target_date.strftime("%Y-%m-%d") / f"port_{port}_acc_{selected_account['acc_id']}_{selected_account['trd_env']}.json"


def load_snapshot_for_date(selected_account, port, snapshot_date):
    path = snapshot_path(selected_account, port, snapshot_date)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_latest_snapshot_before(selected_account, port, before_date):
    filename = f"port_{port}_acc_{selected_account['acc_id']}_{selected_account['trd_env']}.json"
    candidates = []

    for path in SNAPSHOT_DIR.glob(f"*/{filename}"):
        try:
            snapshot_day = datetime.strptime(path.parent.name, "%Y-%m-%d").date()
        except ValueError:
            continue
        if snapshot_day < before_date:
            candidates.append((snapshot_day, path))

    if not candidates:
        return None

    _, latest_path = max(candidates, key=lambda item: item[0])
    return json.loads(latest_path.read_text(encoding="utf-8"))


def load_all_snapshots(selected_account, port):
    filename = f"port_{port}_acc_{selected_account['acc_id']}_{selected_account['trd_env']}.json"
    snapshots = []
    for path in SNAPSHOT_DIR.glob(f"*/{filename}"):
        try:
            snapshot_day = datetime.strptime(path.parent.name, "%Y-%m-%d").date()
        except ValueError:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        snapshots.append((snapshot_day, data))
    snapshots.sort(key=lambda item: item[0], reverse=True)
    return snapshots


def load_previous_snapshot(selected_account, port):
    yesterday = datetime.now().date() - timedelta(days=1)
    snapshot = load_snapshot_for_date(selected_account, port, yesterday)
    if snapshot:
        return snapshot
    return load_latest_snapshot_before(selected_account, port, yesterday)


def load_t2_snapshot(selected_account, port):
    day_before_yesterday = datetime.now().date() - timedelta(days=2)
    return load_snapshot_for_date(selected_account, port, day_before_yesterday)


def save_snapshot(selected_account, port, funds, positions):
    path = snapshot_path(selected_account, port)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "selected_account": selected_account,
        "funds": funds,
        "positions": positions,
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def first_record(records):
    return records[0] if records else {}


def numeric_delta(current, previous, key):
    current_value = current.get(key)
    previous_value = previous.get(key)
    if isinstance(current_value, (int, float)) and isinstance(previous_value, (int, float)):
        return float(current_value) - float(previous_value)
    return None


def build_daily_comparison(previous_snapshot, funds, positions):
    if not previous_snapshot:
        return None, []

    previous_funds = first_record(previous_snapshot.get("funds", []))
    current_funds = first_record(funds)
    previous_positions = {item.get("code"): item for item in previous_snapshot.get("positions", [])}

    summary = {
        "previous_saved_at": previous_snapshot.get("saved_at", ""),
        "total_assets_change": numeric_delta(current_funds, previous_funds, "total_assets"),
        "cash_change": numeric_delta(current_funds, previous_funds, "cash"),
        "market_val_change": numeric_delta(current_funds, previous_funds, "market_val"),
        "today_pl_val": sum_numeric(positions, "today_pl_val"),
        "currency": current_funds.get("currency") or previous_funds.get("currency"),
    }

    details = []
    for position in positions:
        code = position.get("code")
        previous = previous_positions.get(code, {})
        qty_change = numeric_delta(position, previous, "qty")
        market_val_change = numeric_delta(position, previous, "market_val")
        pl_val_change = numeric_delta(position, previous, "pl_val")

        if any(value not in (None, 0, 0.0) for value in (qty_change, market_val_change, pl_val_change)):
            details.append({
                "code": code,
                "stock_name": position.get("stock_name"),
                "position_market": position.get("position_market"),
                "qty_change": qty_change,
                "market_val_change": market_val_change,
                "pl_val_change": pl_val_change,
                "today_pl_val": position.get("today_pl_val"),
                "currency": position.get("currency"),
            })

    previous_codes = set(previous_positions.keys())
    current_codes = {item.get("code") for item in positions}
    for removed_code in sorted(previous_codes - current_codes):
        previous = previous_positions[removed_code]
        details.append({
            "code": removed_code,
            "stock_name": previous.get("stock_name"),
            "position_market": previous.get("position_market"),
            "qty_change": -float(previous.get("qty", 0) or 0),
            "market_val_change": -float(previous.get("market_val", 0) or 0),
            "pl_val_change": -float(previous.get("pl_val", 0) or 0),
            "today_pl_val": None,
            "currency": previous.get("currency"),
        })

    return summary, details


def sum_numeric(records, key):
    total = 0.0
    for record in records:
        value = record.get(key)
        if isinstance(value, (int, float)):
            total += float(value)
    return total


def build_today_changes(positions):
    if not positions:
        return [], []

    summary = [{
        "today_pl_val": sum_numeric(positions, "today_pl_val"),
        "today_buy_qty": sum_numeric(positions, "today_buy_qty"),
        "today_buy_val": sum_numeric(positions, "today_buy_val"),
        "today_sell_qty": sum_numeric(positions, "today_sell_qty"),
        "today_sell_val": sum_numeric(positions, "today_sell_val"),
        "currency": ", ".join(sorted({str(item.get("currency")) for item in positions if item.get("currency")})),
    }]

    details = []
    for position in positions:
        if any(
            isinstance(position.get(key), (int, float)) and float(position.get(key)) != 0
            for key in ("today_pl_val", "today_buy_qty", "today_buy_val", "today_sell_qty", "today_sell_val")
        ):
            details.append(position)

    return summary, details


def build_today_summary_text(today_summary):
    if not today_summary:
        return "今日无持仓变动数据。"

    summary = today_summary[0]
    return (
        f"今日盈亏 {format_value(summary.get('today_pl_val'))}，"
        f"买入 {format_value(summary.get('today_buy_qty'))} / {format_value(summary.get('today_buy_val'))}，"
        f"卖出 {format_value(summary.get('today_sell_qty'))} / {format_value(summary.get('today_sell_val'))}"
        f"（币种: {format_value(summary.get('currency')) or 'N/A'}）"
    )


def build_daily_summary_text(daily_summary):
    if not daily_summary:
        return "暂无昨日快照。当前运行会保存今日快照，明天运行时可看到相对昨日的盈亏变化。"

    return (
        f"相对上一份快照（{format_value(daily_summary.get('previous_saved_at'))}），"
        f"总资产变动 {format_value(daily_summary.get('total_assets_change'))}，"
        f"现金变动 {format_value(daily_summary.get('cash_change'))}，"
        f"证券市值变动 {format_value(daily_summary.get('market_val_change'))}，"
        f"今日盈亏 {format_value(daily_summary.get('today_pl_val'))}"
        f"（币种: {format_value(daily_summary.get('currency')) or 'N/A'}）"
    )


_STOCK_NAME_OVERRIDES = {
    "ARK Autonomous Technology & Robotics ETF": "ARK ARKQ",
}
_ETF_PROVIDER_SUFFIXES = [
    "-Vanguard", "-Invesco QQQ Trust", "-iShares", "-SPDR", "-嘉实",
]

def shorten_name(name):
    if name in _STOCK_NAME_OVERRIDES:
        return _STOCK_NAME_OVERRIDES[name]
    for suffix in _ETF_PROVIDER_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def _js_num(value):
    v = round(float(value), 1)
    return "0" if v == 0 else str(v)


def render_account_mdx(result, config):
    all_snapshots = result.get("all_snapshots", [])
    positions = result.get("positions", [])

    history_lines = []
    reversed_snapshots = list(reversed(all_snapshots))
    for i, (snapshot_date, snapshot) in enumerate(reversed_snapshots):
        fund = first_record(snapshot.get("funds", []))
        total_assets = float(fund.get("total_assets") or 0)
        market_val = float(fund.get("market_val") or 0)
        if i == 0:
            daily_change = 0.0
        else:
            prev_fund = first_record(reversed_snapshots[i - 1][1].get("funds", []))
            daily_change = total_assets - float(prev_fund.get("total_assets") or 0)
        history_lines.append(
            f"    {{date: '{snapshot_date.strftime('%m-%d')}', "
            f"totalAssets: {_js_num(total_assets)}, "
            f"securitiesValue: {_js_num(market_val)}, "
            f"dailyChange: {_js_num(daily_change)}}},"
        )

    holding_lines = []
    for pos in positions:
        market_val = pos.get("market_val") or 0
        if not market_val:
            continue
        name = shorten_name(str(pos.get("stock_name", ""))).replace("'", "\\'")
        currency = pos.get("currency", "")
        pnl = pos.get("pl_val") or 0
        pnl_pct = pos.get("pl_ratio") or 0
        holding_lines.append(
            f"    {{name: '{name}', value: {_js_num(market_val)}, currency: '{currency}', pnl: {_js_num(pnl)}, pnlPct: {_js_num(pnl_pct)}}},"
        )

    markdown_body = render_markdown([result])
    if markdown_body.startswith("# 账户资产\n\n"):
        markdown_body = markdown_body[len("# 账户资产\n\n"):]

    badge = config.get("sidebar_badge")
    badge_lines = []
    if badge:
        badge_lines = [
            "sidebar_badge:",
            f"  text: {badge['text']}",
            f"  color: {badge.get('color', 'info')}",
        ]

    return "\n".join([
        "---",
        f"slug: {config['slug']}",
        f"icon: {config.get('icon', 'chart-line-icon')}",
        f"title: {config['title']}",
        *badge_lines,
        "---",
        "",
        "import PortfolioCharts from '@site/src/components/PortfolioCharts';",
        "",
        "export const portfolioData = {",
        "  history: [",
        *history_lines,
        "  ],",
        "  holdings: [",
        *holding_lines,
        "  ],",
        "};",
        "",
        "<PortfolioCharts data={portfolioData} />",
        "",
        markdown_body,
    ])


def render_markdown(port_results):
    fund_columns = [
        ("date", "日期"),
        ("account_label", "账户"),
        ("currency", "币种"),
        ("total_assets", "总资产"),
        ("total_assets_delta", "昨日差额"),
        ("cash", "现金"),
        ("market_val", "证券市值"),
        ("power", "最大购买力"),
        ("avl_withdrawal_cash", "可提现金"),
    ]
    position_columns = [
        ("account_label", "账户"),
        ("stock_name", "名称"),
        ("position_market", "市场"),
        ("pl_combined", "盈亏 / 盈亏比例"),
        ("today_pl_val", "今日盈亏"),
        ("market_qty", "市值 / 持仓数量"),
        ("price_cost", "市价 / 摊薄成本"),
        ("today_buy_combined", "今日买入金额 / 数量"),
        ("today_trd_val", "今日交易金额"),
        ("today_sell_combined", "今日卖出金额 / 数量"),
        ("unrealized_pl", "未实现盈亏"),
        ("realized_pl", "已实现盈亏"),
    ]
    fund_rows = []
    position_rows = []

    date_account_data = {}
    for result in port_results:
        for i, (snapshot_date, snapshot) in enumerate(result.get("all_snapshots", [])):
            fund = first_record(snapshot.get("funds", []))
            prev_snapshot = result["all_snapshots"][i + 1][1] if i + 1 < len(result["all_snapshots"]) else {}
            prev_fund = first_record(prev_snapshot.get("funds", []))
            date_account_data.setdefault(snapshot_date, {})[result["account_label"]] = (fund, prev_fund)

    for snapshot_date in sorted(date_account_data, reverse=True):
        date_str = snapshot_date.strftime("%Y-%m-%d")
        date_accounts = date_account_data[snapshot_date]
        date_raw = []

        for result in port_results:
            label = result["account_label"]
            if label not in date_accounts:
                continue
            fund, prev_fund = date_accounts[label]
            delta = numeric_delta(fund, prev_fund, "total_assets")
            fund_rows.append({
                "date": date_str,
                "account_label": label,
                "currency": fund.get("currency", ""),
                "total_assets": format_value(fund.get("total_assets")),
                "total_assets_delta": colorize_number_text(format_signed_value(delta), delta),
                "cash": format_value(fund.get("cash")),
                "market_val": format_value(fund.get("market_val")),
                "power": format_value(fund.get("power")),
                "avl_withdrawal_cash": format_value(fund.get("avl_withdrawal_cash")),
            })
            date_raw.append({**fund, "_delta": delta})

        if len(date_raw) > 1:
            total_delta = None if all(r.get("_delta") is None for r in date_raw) else sum((r.get("_delta") or 0) for r in date_raw)
            fund_rows.append({
                "date": date_str,
                "account_label": "**汇总**",
                "currency": date_raw[0].get("currency", ""),
                "total_assets": format_value(sum_numeric(date_raw, "total_assets")),
                "total_assets_delta": colorize_number_text(format_signed_value(total_delta), total_delta),
                "cash": format_value(sum_numeric(date_raw, "cash")),
                "market_val": format_value(sum_numeric(date_raw, "market_val")),
                "power": format_value(sum_numeric(date_raw, "power")),
                "avl_withdrawal_cash": format_value(sum_numeric(date_raw, "avl_withdrawal_cash")),
            })

    for result in port_results:
        account_label = result["account_label"]

        for position in result["positions"]:
            row = dict(position)
            row["account_label"] = account_label
            row["market_qty"] = combine_values(position.get("market_val"), position.get("qty"))
            row["price_cost"] = combine_values(position.get("nominal_price"), position.get("diluted_cost"))
            row["pl_combined"] = build_colored_pl_block(position.get("pl_val"), position.get("pl_ratio"))
            row["today_pl_val"] = colorize_number_text(
                format_signed_money(position.get("today_pl_val"), position.get("currency")),
                position.get("today_pl_val"),
            )
            row["today_buy_combined"] = combine_values(position.get("today_buy_val"), position.get("today_buy_qty"))
            row["today_trd_val"] = format_value(position.get("today_trd_val"))
            row["today_sell_combined"] = combine_values(position.get("today_sell_val"), position.get("today_sell_qty"))
            row["unrealized_pl"] = format_value(position.get("unrealized_pl"))
            row["realized_pl"] = format_value(position.get("realized_pl"))
            position_rows.append(row)

        append_position_summary_rows(position_rows, result["positions"], account_label)

    lines = [
        "# 账户资产",
        "",
        "## 资金",
        "",
        markdown_table(fund_rows, fund_columns),
        "",
        "## 持仓",
        "",
        markdown_table(position_rows, position_columns),
    ]
    return "\n".join(lines)


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def resolve_account(acc_list_df, trd_env, acc_id):
    accounts = dataframe_to_records(acc_list_df)

    if not accounts:
        fail("未获取到任何交易账户")

    if acc_id:
        for account in accounts:
            if int(account["acc_id"]) == acc_id and account["trd_env"] == trd_env:
                return account
        fail(f"未找到 acc_id={acc_id} 且 trd_env={trd_env} 的账户")

    for account in accounts:
        if account["trd_env"] == trd_env:
            return account

    fail(f"未找到 trd_env={trd_env} 的账户")


def build_parser():
    parser = argparse.ArgumentParser(description="查询富途账户、资金和持仓")
    parser.add_argument("--host", default="127.0.0.1", help="OpenD host，默认 127.0.0.1")
    parser.add_argument("--ports", default="11111,11112", help="OpenD ports，逗号分隔，默认 11111,11112")
    parser.add_argument(
        "--market",
        default="HK",
        choices=sorted(TRD_MARKET_MAP.keys()),
        help="OpenSecTradeContext 的 filter_trdmarket，默认 HK",
    )
    parser.add_argument(
        "--env",
        default="REAL",
        choices=sorted(TRD_ENV_MAP.keys()),
        help="交易环境，REAL 或 SIMULATE，默认 REAL",
    )
    parser.add_argument("--acc-id", type=int, default=0, help="指定业务账户 acc_id，不传则自动取目标环境下第一个账户")
    parser.add_argument(
        "--security-firm",
        default="FUTUSECURITIES",
        choices=sorted(SECURITY_FIRM_MAP.keys()),
        help="券商类型，默认 FUTUSECURITIES",
    )
    parser.add_argument(
        "--currency",
        default="CNH",
        choices=sorted(FUNDS_CURRENCY_MAP.keys()),
        help="资金接口计价货币，默认 CNH",
    )
    parser.add_argument(
        "--position-market",
        default="NONE",
        choices=sorted(POSITION_MARKET_MAP.keys()),
        help="持仓过滤市场，默认 NONE",
    )
    parser.add_argument(
        "--refresh-cache",
        action="store_true",
        help="强制从服务器刷新资金和持仓，不使用 OpenD 缓存",
    )
    parser.add_argument(
        "--no-save-snapshot",
        action="store_true",
        help="本次查询后不保存快照",
    )
    parser.add_argument(
        "--no-write-obsidian",
        "--no-write-feeicn",
        dest="no_write_feeicn",
        action="store_true",
        help="兼容旧参数：不写入 FEEI.CN，仅输出到终端",
    )
    return parser


def query_port(args, port):
    label = PORT_LABELS.get(port, str(port))
    log(f"[{label}] 连接 OpenD port={port} ...")
    trd_ctx = OpenSecTradeContext(
        filter_trdmarket=TRD_MARKET_MAP[args.market],
        host=args.host,
        port=port,
        security_firm=SECURITY_FIRM_MAP[args.security_firm],
    )

    try:
        log(f"[{label}] 获取账户列表 ...")
        ret, acc_list = trd_ctx.get_acc_list()
        if ret != RET_OK:
            fail(f"get_acc_list error: {acc_list}")

        selected_account = resolve_account(acc_list, args.env, args.acc_id)
        selected_acc_id = int(selected_account["acc_id"])
        trd_env = TRD_ENV_MAP[args.env]

        log(f"[{label}] 查询资金 ...")
        ret, funds = trd_ctx.accinfo_query(
            trd_env=trd_env,
            acc_id=selected_acc_id,
            refresh_cache=args.refresh_cache,
            currency=FUNDS_CURRENCY_MAP[args.currency],
        )
        if ret != RET_OK:
            fail(f"accinfo_query error: {funds}")

        log(f"[{label}] 查询持仓 ...")
        ret, positions = trd_ctx.position_list_query(
            trd_env=trd_env,
            acc_id=selected_acc_id,
            refresh_cache=args.refresh_cache,
            position_market=POSITION_MARKET_MAP[args.position_market],
        )
        if ret != RET_OK:
            fail(f"position_list_query error: {positions}")

        account_list_records = dataframe_to_records(acc_list)
        fund_records = dataframe_to_records(funds)
        position_records = dataframe_to_records(positions)
        previous_snapshot = load_previous_snapshot(selected_account, port)
        t2_snapshot = load_t2_snapshot(selected_account, port)
        if not args.no_save_snapshot:
            save_snapshot(selected_account, port, fund_records, position_records)
            log(f"[{label}] 快照已保存")
        all_snapshots = load_all_snapshots(selected_account, port)
        log(f"[{label}] 完成")
        return {
            "port": port,
            "account_label": PORT_LABELS.get(port, str(port)),
            "account_list": account_list_records,
            "selected_account": selected_account,
            "funds": fund_records,
            "positions": position_records,
            "previous_snapshot": previous_snapshot,
            "t2_snapshot": t2_snapshot,
            "all_snapshots": all_snapshots,
        }
    finally:
        trd_ctx.close()


def parse_ports(ports_text):
    ports = []
    for item in ports_text.split(","):
        item = item.strip()
        if not item:
            continue
        ports.append(int(item))
    return ports


def main():
    args = build_parser().parse_args()
    silence_futu_console_logs()

    ports = parse_ports(args.ports)
    log(f"并行查询 {len(ports)} 个账户: ports={ports}")
    port_results = [None] * len(ports)
    with ThreadPoolExecutor(max_workers=len(ports)) as executor:
        futures = {executor.submit(query_port, args, port): i for i, port in enumerate(ports)}
        for future in as_completed(futures):
            port_results[futures[future]] = future.result()

    log("渲染 Markdown ...")
    markdown_text = render_markdown(port_results)
    print(markdown_text)
    if not args.no_write_feeicn:
        log("写入 FEEI.CN ...")
        write_feeicn_outputs(port_results, datetime.now())
    log("全部完成")


if __name__ == "__main__":
    main()
