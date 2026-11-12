#!/usr/bin/env python3
"""Render the fixed weight wallpaper from dated, sourced observations."""
import argparse
from datetime import date, datetime, timedelta
import json
import math
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TARGETS = (155, 150, 145, 140)


def observations(items, key, as_of):
    if not isinstance(items, list):
        raise ValueError(f'{key}: 记录必须为数组')
    result = {}
    for item in items:
        day = date.fromisoformat(item['date'])
        value = item[key]
        source = urlparse(item['source'])
        if day > as_of or day in result:
            raise ValueError(f'{key}: 日期重复或晚于本轮日期')
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f'{key}: 数值无效')
        if value < 0 or (key == 'weight_jin' and value == 0):
            raise ValueError(f'{key}: 数值不能为负，体重不能为零')
        if source.scheme != 'https' or source.hostname != 'feei.cn' or not source.path.startswith('/data/health/'):
            raise ValueError(f'{key}: 必须引用实际健康数据入口')
        result[day] = float(value)
    return dict(sorted(result.items()))


def normalize(data, expected_date=None):
    as_of = date.fromisoformat(data['as_of'])
    if expected_date is not None and as_of != expected_date:
        raise ValueError('as_of 必须是本轮北京时间日期，不能用旧日期冒充本轮')
    weights = observations(data['weights'], 'weight_jin', as_of)
    exercise = observations(data['exercise'], 'minutes', as_of)
    if not weights:
        raise ValueError('缺少真实体重记录，不能生成壁纸')
    current_year = {day: value for day, value in weights.items() if day.year == as_of.year}
    if not current_year:
        raise ValueError('当年尚无体重记录，不能绘制当年曲线')
    latest = max(weights)
    target = next((value for value in TARGETS if min(weights.values()) > value), None)
    monday = as_of - timedelta(days=as_of.weekday())
    complete_days = {day: value for day, value in exercise.items() if monday <= day < as_of}
    return {
        'as_of': as_of, 'weights': current_year, 'latest': latest, 'current': weights[latest],
        'target': target, 'exercise_days': len(complete_days),
        'exercise_successes': sum(value >= 30 for value in complete_days.values()),
        'exercise_latest': max(complete_days) if complete_days else None,
    }


def curve_segments(weights):
    segments = []
    for day, value in weights.items():
        if not segments or (day - segments[-1][-1][0]).days > 1:
            segments.append([])
        segments[-1].append((day, value))
    return segments


def render(data, output, preview=False):
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import dates as mdates, font_manager
    from matplotlib.figure import Figure
    from matplotlib.ticker import MaxNLocator

    state = normalize(data)
    available = {font.name for font in font_manager.fontManager.ttflist}
    family = next((name for name in ['Noto Sans CJK SC', 'Noto Sans CJK JP', 'PingFang SC',
                                     'Heiti TC', 'Arial Unicode MS'] if name in available), None)
    if family is None:
        raise ValueError('缺少中文字体，请安装 fonts-noto-cjk 后生成壁纸')
    matplotlib.rcParams.update({'font.family': family, 'axes.unicode_minus': False, 'svg.fonttype': 'path'})
    output.mkdir(parents=True, exist_ok=True)
    if any((output / name).is_symlink() for name in ['wallpaper.png', 'wallpaper.svg']):
        raise ValueError('壁纸输出不能是符号链接')
    foreground, muted, accent, background = '#f1f0eb', '#929a9f', '#a3d8bd', '#101518'
    fig = Figure(figsize=(13.2, 28.68), dpi=100, facecolor=background)
    target = state['target']
    gap = max(0, state['current'] - (target or 140))
    title = f'下一站，{target}斤' if target else ('回到，140斤' if gap else '保持，140斤')
    subtitle = f'还有 {gap:.1f} 斤' if gap else '保持已经达到的阶段'
    fig.text(.5, .70, title, ha='center', color=foreground, fontsize=60, weight='bold')
    fig.text(.5, .65, subtitle, ha='center', color=accent, fontsize=32)
    fig.text(.5, .59, f"当前 {state['current']:.1f} 斤  ·  {state['latest']:%Y-%m-%d}",
             ha='center', color=muted, fontsize=21)
    ax = fig.add_axes([.13, .31, .74, .22], facecolor=background)
    for segment in curve_segments(state['weights']):
        ax.plot([day for day, _ in segment], [value for _, value in segment],
                color=accent, linewidth=2.8, marker='o', markersize=3)
    year = state['as_of'].year
    ax.set_xlim(date(year, 1, 1), date(year, 12, 31))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m月'))
    ax.tick_params(colors=muted, labelsize=17, length=0, pad=16)
    ax.yaxis.set_major_locator(MaxNLocator(4))
    ax.grid(axis='y', color='#293238', linewidth=.8)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_ylabel('斤', color=muted, fontsize=17, rotation=0, labelpad=20)
    if state['exercise_days']:
        feedback = f"本周已记录 {state['exercise_days']} 天，运动满30分钟 {state['exercise_successes']} 天"
        cutoff = f"运动数据截至 {state['exercise_latest']:%m-%d}"
    else:
        feedback, cutoff = '本周运动记录待同步', '仅统计已结束且有记录的日期'
    fig.text(.5, .245, '今天，完成30分钟运动', ha='center', color=foreground, fontsize=29)
    fig.text(.5, .213, feedback, ha='center', color=muted, fontsize=19)
    fig.text(.5, .190, cutoff, ha='center', color=muted, fontsize=16)
    fig.text(.5, .167, '长期目标 140斤', ha='center', color=muted, fontsize=17)
    if preview:
        fig.text(.5, .11, '合成数据 · 版式验证', ha='center', color=muted, fontsize=18)
    fig.savefig(output / 'wallpaper.png', dpi=100, facecolor=background)
    fig.savefig(output / 'wallpaper.svg', facecolor=background)
    fig.clear()
    return state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default='output/wallpaper-data.json')
    args = parser.parse_args()
    data = json.loads((ROOT / args.data).read_text())
    normalize(data, datetime.now(ZoneInfo('Asia/Shanghai')).date())
    render(data, ROOT / 'output')
    print('固定版式壁纸已生成：output/wallpaper.png、output/wallpaper.svg')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        raise SystemExit(f'壁纸生成失败：{error}')
