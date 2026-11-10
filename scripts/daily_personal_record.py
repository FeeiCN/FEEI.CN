"""Create a daily inbox quickly and maintain factual snapshots without editing diary prose."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Shanghai')
TASK_MARKER = '<!-- automation-task:daily-personal-record -->'
BOT = 'github-actions[bot]'
ROOT = Path(__file__).resolve().parents[1]


def api(endpoint, method='GET', data=None):
    command = ['gh', 'api', endpoint, '--method', method]
    if data is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=json.dumps(data) if data is not None else None,
                            capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError('GitHub API 请求失败，未输出响应或凭证')
    return json.loads(result.stdout)


def pages(endpoint, limit=10):
    items = []
    for page in range(1, limit + 1):
        batch = api(endpoint + ('&' if '?' in endpoint else '?') + f'per_page=100&page={page}')
        items.extend(batch)
        if len(batch) < 100:
            return items
    raise RuntimeError('分页超过范围，未将部分结果冒充完整记录')


def resolve(now, cron='', mode='auto', target=''):
    local = now.astimezone(TZ)
    if target:
        day = date.fromisoformat(target)
        if day > local.date() or (local.date() - day).days > 7:
            raise ValueError('仅支持最近7天，不能选择未来日期')
        return day, 'refresh' if mode == 'auto' else mode
    if mode != 'auto':
        return local.date(), mode
    if cron in ('15 15 * * *', '45 15 * * *', '15 16 * * *'):
        from automation_schedule import latest_slot
        slot = latest_slot([cron], now.astimezone(timezone.utc)).astimezone(TZ)
        day = slot.date() - timedelta(days=1) if slot.hour < 7 else slot.date()
        return day, 'refresh'
    if local.time() < time(7, 45):
        return local.date() - timedelta(days=1), 'refresh'
    return local.date(), 'refresh' if local.time() >= time(23, 15) else 'create'


def day_marker(day):
    return f'<!-- daily-personal-record:{day} -->'


def snapshot_marker(day):
    return f'<!-- daily-personal-data:{day} -->'


def find_issue(repo, day):
    since = datetime.combine(day, time.min, TZ).astimezone(timezone.utc).isoformat()
    issues = pages(f'repos/{repo}/issues?' + urlencode({'state': 'all', 'creator': BOT, 'since': since}))
    matches = []
    for issue in issues:
        body = issue.get('body') or ''
        if issue.get('pull_request') or issue.get('user', {}).get('login') != BOT or TASK_MARKER not in body:
            continue
        # Support existing daily records such as #864. Explicit markers win over creation dates.
        marked = re.search(r'<!-- daily-personal-record:(\d{4}-\d{2}-\d{2}) -->', body)
        created_day = datetime.fromisoformat(issue['created_at'].replace('Z', '+00:00')).astimezone(TZ).date()
        if (marked and marked[1] == str(day)) or (not marked and created_day == day):
            matches.append(issue)
    if len(matches) > 1:
        raise ValueError('同一天存在多个个人记录 Issue，停止以避免更新错误议题')
    return matches[0] if matches else None


def text(value):
    return str(value).replace('@', '@\u200b').replace('<', '&lt;').replace('>', '&gt;').replace('|', '／').replace('\n', ' ').replace('[', '［').replace(']', '］')[:250]


def publish_comment(repo, issue, marker, body):
    comments = pages(f'repos/{repo}/issues/{issue["number"]}/comments')
    existing = next((c for c in comments if c.get('user', {}).get('login') == BOT and marker in (c.get('body') or '')), None)
    if len(body.encode()) > 60000:
        raise ValueError('自动数据快照超过交付大小限制')
    if existing:
        if existing['body'] != body:
            api(f'repos/{repo}/issues/comments/{existing["id"]}', 'PATCH', {'body': body})
    else:
        api(f'repos/{repo}/issues/{issue["number"]}/comments', 'POST', {'body': body})


def get_json(url):
    with urlopen(Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'FEEI-daily/1.0'}), timeout=20) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('数据过大')
    return json.loads(raw)


def collect(repo, day, now):
    start = datetime.combine(day, time.min, TZ).astimezone(timezone.utc)
    end = min(now, start + timedelta(days=1))
    sources = {}
    def fetch(kind):
        try:
            if kind == 'health':
                url = 'https://feei.cn/data/health/' + day.strftime('%Y/%m/%d.json')
                value = get_json(url)
                if value.get('version') != 5 or value.get('date') != str(day):
                    raise ValueError('健康索引日期或版本不匹配')
            elif kind == 'sleep-score':
                from sleep_score_storage import validate_record
                url = 'https://feei.cn/data/sleep-score/' + day.strftime('%Y/%m/%d.json')
                value = get_json(url)
                validate_record(value)
                if value['date'] != str(day):
                    raise ValueError('评分日期不匹配')
            elif kind == 'reading':
                url = f'https://feei.cn/data/reading/{day.year}.json'
                value = get_json(url)
            else:
                path = f'static/data/llm-usage/{kind}/usage_summary.json'
                url = f'https://github.com/{repo}/blob/main/{path}'
                content = api(f'repos/{repo}/contents/{path}?ref=main')
                value = json.loads(base64.b64decode(content['content']))
            if not isinstance(value, dict):
                raise ValueError('来源不是有效数据对象')
            return kind, {'status': 'available', 'url': url, 'data': value}
        except (RuntimeError, OSError, ValueError, KeyError, TypeError):
            return kind, {'status': 'unavailable'}
    with ThreadPoolExecutor(max_workers=6) as pool:
        sources.update(pool.map(fetch, ('health', 'sleep-score', 'reading', 'openai', 'anthropic', 'minimax')))
    query = urlencode({'since': start.isoformat(), 'until': end.isoformat()})
    try:
        commits = pages(f'repos/{repo}/commits?{query}')
        sources['git'] = {'status': 'available', 'items': [
            {'sha': c['sha'], 'url': c['html_url'], 'message': c['commit']['message'].splitlines()[0],
             'author': (c.get('author') or {}).get('login') or c['commit']['author']['name'],
             'committed_at': c['commit']['committer']['date']} for c in commits
            if start <= datetime.fromisoformat(c['commit']['committer']['date'].replace('Z', '+00:00')) < end]}
    except (RuntimeError, KeyError, ValueError):
        sources['git'] = {'status': 'unavailable'}
    try:
        changed = pages(f'repos/{repo}/issues?' + urlencode({'state': 'all', 'since': start.isoformat(), 'sort': 'updated', 'direction': 'desc'}))
        items = []
        for item in changed:
            if item.get('pull_request'):
                continue
            activities = []
            for key, label in (('created_at', '创建'), ('closed_at', '关闭')):
                instant = item.get(key)
                if instant and start <= datetime.fromisoformat(instant.replace('Z', '+00:00')) < end:
                    activities.append(label)
            comments = []
            if len(items) < 40 and item.get('comments'):
                for comment in pages(f'repos/{repo}/issues/{item["number"]}/comments?since={start.isoformat()}'):
                    if start <= datetime.fromisoformat(comment['created_at'].replace('Z', '+00:00')) < end:
                        comments.append({'url': comment['html_url'], 'author': comment['user']['login']})
            if activities or comments:
                items.append({'number': item['number'], 'title': item['title'], 'url': item['html_url'],
                              'activities': activities, 'comments': comments})
        sources['issues'] = {'status': 'available', 'items': items, 'scope': '当前仓库；前40个相关议题读取评论，评论仅计创建时间，不含编辑或其他标签操作'}
    except (RuntimeError, KeyError, ValueError):
        sources['issues'] = {'status': 'unavailable'}
    return {'date': str(day), 'cutoff': end.astimezone(TZ).isoformat(), 'collected_at': now.astimezone(TZ).isoformat(), 'sources': sources}


def render(snapshot):
    rows = []
    sources = snapshot['sources']
    rows.append('<!-- source:health:start -->')
    health = sources['health']
    if health['status'] == 'available':
        value = health['data']
        activity, body, sleep = (value.get(k) or {} for k in ('activity', 'bodyMeasurements', 'sleep'))
        fields = [('步数', activity.get('steps'), '步'), ('运动', activity.get('exerciseMinutes'), '分钟'),
                  ('活动能量', activity.get('activeEnergyKJ'), 'kJ'), ('距离', activity.get('distanceKm'), 'km'),
                  ('体重', (body.get('weight') or {}).get('dailyKg'), 'kg'), ('睡眠', sleep.get('totalMinutes'), '分钟')]
        rows += [f'- {label}：{number} {unit}。' for label, number, unit in fields if isinstance(number, (int, float))]
        missing = [label for label, number, unit in fields if not isinstance(number, (int, float))]
        if missing:
            rows.append('- 当天索引缺失字段：' + '、'.join(missing) + '，不能解释为零或没有发生。')
        heart = value.get('heart') or {}
        for label, number, unit in (('静息心率', heart.get('restingHeartRateBpm'), 'bpm'),
                                    ('HRV', (heart.get('hrv') or {}).get('dailyMs'), 'ms')):
            if isinstance(number, (int, float)):
                rows.append(f'- {label}：{number} {unit}。')
        workouts = activity.get('workouts') or []
        rows += [f'- 训练：{text(w.get("type", "未注明类型"))}，{text(w.get("durationMinutes", "时长缺失"))} 分钟。' for w in workouts[:10]]
        rows.append(f'- [健康日索引]({health["url"]})：导出时间 {text(value.get("exportedAt", "未知"))}；仅代表该快照覆盖范围。')
    else:
        rows.append('- 健康、运动和体重：读取失败或尚无当天索引，未覆盖此前记录。')
    rows += ['<!-- source:health:end -->', '<!-- source:sleep-score:start -->']
    score = sources['sleep-score']
    if score['status'] == 'available':
        rows.append(f'- [睡眠评分]({score["url"]})：{score["data"]["score"]}；采集时间 {text(score["data"].get("capturedAt", "未知"))}。')
        rows += ['- 评分限制：' + text(w.get('message', '存在质量提示')) for w in score['data'].get('quality', {}).get('warnings', [])]
    else:
        rows.append('- 睡眠评分：缺失或不可用。')
    rows += ['<!-- source:sleep-score:end -->', '<!-- source:reading:start -->']
    reading = sources['reading']
    if reading['status'] == 'available':
        value = reading['data']
        seconds = (value.get('daily', {}).get(snapshot['date']) or {}).get('seconds')
        rows.append(f'- [阅读]({reading["url"]})：' + (f'{seconds} 秒' if isinstance(seconds, (int, float)) else '缺少当天条目，不能视为未阅读') + f'；源更新时间 {text(value.get("updatedAt", value.get("generatedAt", "未提供")))}。')
    else:
        rows.append('- 阅读：读取失败。')
    rows += ['<!-- source:reading:end -->', '', '### Token 用量', '']
    for vendor in ('openai', 'anthropic', 'minimax'):
        rows.append(f'<!-- source:{vendor}:start -->')
        entry = sources[vendor]
        if entry['status'] != 'available':
            rows.append(f'- {vendor}：来源不可用。')
            rows.append(f'<!-- source:{vendor}:end -->')
            continue
        value = entry['data']
        tokens = token_value(value, snapshot['date'])
        rows.append(f'- [{vendor}]({entry["url"]})：' + (f'{tokens:,} Token' if type(tokens) is int else '未提供当天数据') + f'；采集时间 {text(value.get("fetchedAt", "未知"))}。')
        rows.append(f'<!-- source:{vendor}:end -->')
    rows += ['', '各平台统计口径和账单时区可能不同，按源日期展示，不相加推断工作质量；夜间数据仍可能延迟。', '', '### Git 与 Issue 活动', '']
    for kind in ('git', 'issues'):
        rows.append(f'<!-- source:{kind}:start -->')
        entry = sources[kind]
        if entry['status'] != 'available':
            rows.append(f'- {kind}：读取失败，不能视为没有活动。')
            rows.append(f'<!-- source:{kind}:end -->')
            continue
        items = entry['items']
        rows.append(f'- {kind}：{len(items)} 条；' + ('按提交时间统计，含自动同步，不能都当作本人工作。' if kind == 'git' else entry['scope'] + '。'))
        for item in items[:15]:
            if kind == 'git':
                rows.append(f'  - [{item["sha"][:7]}]({item["url"]}) {text(item["message"])}（{text(item["author"])}）')
            else:
                rows.append(f'  - [#{item["number"]}]({item["url"]}) {text(item["title"])}：{text("、".join(item["activities"]))}；新增评论 {len(item["comments"])} 条。')
        if len(items) > 15:
            rows.append(f'  - 另有 {len(items) - 15} 条未展开。')
        rows.append(f'<!-- source:{kind}:end -->')
    return '\n'.join(rows)


def token_value(value, day):
    daily = value.get('daily_token_usage')
    return daily.get(day) if isinstance(daily, dict) else None


def usable(kind, entry, day):
    if entry.get('status') != 'available':
        return False
    if kind in ('openai', 'anthropic', 'minimax'):
        return type(token_value(entry['data'], day)) is int
    if kind == 'reading':
        return isinstance((entry['data'].get('daily', {}).get(day) or {}).get('seconds'), (int, float))
    return True


def preserve_sources(body, previous, snapshot):
    for kind, entry in snapshot['sources'].items():
        if usable(kind, entry, snapshot['date']):
            continue
        pattern = re.compile(r'<!-- source:' + re.escape(kind) + r':start -->.*?<!-- source:' + re.escape(kind) + r':end -->', re.S)
        old = pattern.search(previous)
        if old:
            replacement = old[0] + '\n本轮此来源缺失或不可用；上方保留上次快照，非本次更新。'
            body = pattern.sub(lambda _: replacement, body)
    return body


def fresh(snapshot):
    for kind, entry in snapshot['sources'].items():
        if not usable(kind, entry, snapshot['date']):
            return False
        if kind in ('health', 'openai', 'anthropic', 'minimax'):
            stamp = entry['data'].get('exportedAt' if kind == 'health' else 'fetchedAt', '')
            try:
                instant = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
                if instant.tzinfo is None:
                    instant = instant.replace(tzinfo=TZ)
                threshold = datetime.combine(date.fromisoformat(snapshot['date']), time(22, 30), TZ)
                if instant < threshold:
                    return False
            except (ValueError, TypeError):
                return False
    return True


def timing(repo, day, mode, now):
    planned = datetime.combine(day, time(23, 15) if mode == 'refresh' else time(7, 45), TZ)
    result = {'planned_at': planned.isoformat(), 'observed_at': now.astimezone(TZ).isoformat(),
              'note': '计划至运行创建的差值不是 Runner 排队时间，也不能证明 GitHub 内部延迟原因。'}
    if os.environ.get('GITHUB_RUN_ID'):
        run = api(f'repos/{repo}/actions/runs/{int(os.environ["GITHUB_RUN_ID"])}')
        result.update(run_created_at=run['created_at'], run_started_at=run['run_started_at'])
        created = datetime.fromisoformat(run['created_at'].replace('Z', '+00:00'))
        started = datetime.fromisoformat(run['run_started_at'].replace('Z', '+00:00'))
        result['plan_to_creation_minutes'] = round((created - planned).total_seconds() / 60, 1)
        result['creation_to_run_start_seconds'] = (started - created).total_seconds()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('prepare',))
    args = parser.parse_args()
    repo = os.environ['GITHUB_REPOSITORY']
    now = datetime.now(timezone.utc)
    out = ROOT / 'output'
    out.mkdir(exist_ok=True)
    day, mode = resolve(now, os.environ.get('TRIGGER_SCHEDULE', ''), os.environ.get('PERSONAL_MODE', 'auto'), os.environ.get('PERSONAL_DATE', ''))
    issue = find_issue(repo, day)
    created = issue is None
    if created:
        body = f'{TASK_MARKER}\n{day_marker(day)}\n\n今天发生了哪些真正值得记住的事？\n\n可以直接在这里记录；自动采集线索和数据在评论中更新，不代表已确认事实或网站发布。'
        issue = api(f'repos/{repo}/issues', 'POST', {'title': f'{day} 每日个人记录', 'body': body})
    schedule = timing(repo, day, mode, now)
    (out / 'daily-schedule.json').write_text(json.dumps(schedule, ensure_ascii=False))
    marker = snapshot_marker(day)
    comments = pages(f'repos/{repo}/issues/{issue["number"]}/comments')
    complete = any(c.get('user', {}).get('login') == BOT and marker in (c.get('body') or '') and '<!-- evening-complete -->' in c['body'] for c in comments)
    refresh = mode == 'refresh' and (not complete or os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch')
    # Morning retries do not recall the model or re-fetch snapshots after successful creation.
    existing_snapshot = any(c.get('user', {}).get('login') == BOT and marker in (c.get('body') or '') for c in comments)
    if refresh or (mode == 'create' and not existing_snapshot):
        snapshot = collect(repo, day, now)
        (out / 'personal-snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False))
        timing_line = f'计划：{day} {"23:15" if mode == "refresh" else "07:45"} Asia/Shanghai；实际采集：{snapshot["collected_at"]}；数据截止：{snapshot["cutoff"]}。'
        body = marker + f'\n\n## {day} {"晚间刷新" if mode == "refresh" else "早间快照"}\n\n' + timing_line + '\n\n' + render(snapshot)
        previous = next((c['body'] for c in comments if c.get('user', {}).get('login') == BOT and marker in (c.get('body') or '')), '')
        body = preserve_sources(body, previous, snapshot)
        if mode == 'refresh' and fresh(snapshot):
            body += '\n<!-- evening-complete -->'
        publish_comment(repo, issue, marker, body)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        # A placeholder without clues can be retried, but never replace an existing completed legacy report.
        has_clues = any(c.get('user', {}).get('login') == BOT and f'<!-- daily-personal-clues:{day} -->' in (c.get('body') or '')
                        and '<!-- daily-clues-status:completed -->' in c['body'] for c in comments)
        ready = mode == 'create' and not has_clues and '<!-- status:completed -->' not in (issue.get('body') or '')
        output.write(f'ready={str(ready).lower()}\ndate={day}\nissue={issue["number"]}\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write(f'个人记录 [{day}](https://github.com/{repo}/issues/{issue["number"]}) · {mode} · 实际执行 {now.astimezone(TZ).isoformat()}。\n')
        summary.write('\n```json\n' + json.dumps(schedule, ensure_ascii=False, indent=2) + '\n```\n')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('个人记录创建或刷新失败，未输出原始个人数据或凭证；后续补检查可重试。')
