#!/usr/bin/env python3
"""Read documented automation prompts and validate/deliver actual run results."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import gzip
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parents[1]
BACKSTAGE = Path('docs/05-吴飞飞/01-关于/关于FEEI.CN')
COMMON = BACKSTAGE / '定时任务/自动任务执行约定.md'
START = '<!-- automation-prompt:start -->'
END = '<!-- automation-prompt:end -->'
RESEARCH = {'security-event-research', 'ai-security-frontier-research',
            'ai-coding-rd-efficiency', 'security-architecture-defense', 'hk-ipo-alerts'}
REVIEW = RESEARCH | {'knowledge-base-governance'}
PERSONAL = {'personal-health-trend-research', 'update-weight-wallpaper', 'daily-personal-record'}
SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'status': {'type': 'string', 'enum': ['completed', 'no_update', 'blocked']},
        'report_markdown': {'type': 'string'},
        'sources': {'type': 'array', 'items': {'type': 'string'}},
        'artifacts': {'type': 'array', 'items': {'type': 'string'}},
        'audit': {
            'type': 'object', 'additionalProperties': False,
            'properties': {key: {'type': 'string'} for key in ['summary', 'data_cutoff', 'deduplication_reason']},
            'required': ['summary', 'data_cutoff', 'deduplication_reason'],
        },
    },
    'required': ['status', 'report_markdown', 'sources', 'artifacts', 'audit'],
}


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True, stderr=subprocess.PIPE)


def tasks():
    entries = []
    for path in sorted((ROOT / '.github/workflows').glob('*.yml')):
        workflow = yaml.safe_load(path.read_text())
        for job in workflow.get('jobs', {}).values():
            if job.get('uses') != './.github/workflows/automation-task.yml':
                continue
            inputs = job.get('with', {})
            trigger = workflow.get('on', workflow.get(True, {}))
            entries.append({
                'id': inputs.get('task_id'), 'title': workflow.get('name'),
                'prompt_source': inputs.get('prompt_source'),
                'delivery': inputs.get('delivery'),
                'schedule': [item['cron'] for item in trigger.get('schedule', [])],
                'workflow': str(path.relative_to(ROOT)), 'condition': job.get('if', ''),
                'manual': 'workflow_dispatch' in trigger,
            })
    return entries


def prompt(path):
    path = Path(path)
    if path.is_absolute() or '..' in path.parts or not path.is_relative_to(BACKSTAGE):
        raise ValueError('提示词必须位于网站幕后目录')
    content = (ROOT / path).read_text()
    if content.count(START) != 1 or content.count(END) != 1:
        raise ValueError(f'{path}: 必须有且仅有一对提示词标记')
    body = content.split(START)[1].split(END)[0].strip()
    if not body:
        raise ValueError(f'{path}: 提示词为空')
    return body


def check():
    entries = tasks()
    if not entries or len({t['id'] for t in entries}) != len(entries):
        raise ValueError('任务 ID 为空或重复')
    prompt(COMMON)
    for t in entries:
        if not isinstance(t['id'], str) or not re.fullmatch(r'[a-z][a-z0-9-]*', t['id']):
            raise ValueError('任务 ID 格式无效')
        if not isinstance(t['prompt_source'], str) or not t['prompt_source']:
            raise ValueError(f"{t['id']}: 缺少提示词路径")
        try:
            prompt(t['prompt_source'])
        except (ValueError, OSError) as error:
            raise ValueError(f"{t['workflow']}: {t['prompt_source']}: {error}") from error
        variable = 'AUTOMATION_' + t['id'].upper().replace('-', '_')
        if t['condition'] != "${{ vars." + variable + " == 'true' }}":
            raise ValueError(f"{t['id']}: 缺少对应的启用开关")
        if not t['schedule'] or not t['manual']:
            raise ValueError(f"{t['id']}: 缺少定时或手动触发入口")
        if t['delivery'] != 'issue':
            raise ValueError(f"{t['id']}: 无效的交付类型")
    print(f'通过：{len(entries)} 个 workflow 的任务配置、文档提示词与启用开关有效')


def destination(t):
    if t['delivery'] != 'issue':
        raise ValueError('任务仅支持当前仓库 Issue 交付')
    return os.environ['GITHUB_REPOSITORY']


def collect_personal_data(t, out):
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
    if t['id'] == 'update-weight-wallpaper':
        first = today.replace(month=1, day=1)
    elif t['id'] == 'personal-health-trend-research':
        first = today - timedelta(days=90)
    else:
        first = today - timedelta(days=7)
    dates = [first + timedelta(days=i) for i in range((today - first).days + 1)]
    folder = out / 'health'
    folder.mkdir()

    def fetch(date):
        relative = date.strftime('%Y/%m/%d.json')
        url = 'https://feei.cn/data/health/' + relative
        try:
            with urlopen(Request(url, headers={'User-Agent': 'FEEI-automation/1.0'}), timeout=30) as response:
                data = response.read(2_000_001)
            if len(data) > 2_000_000:
                return {'date': date.isoformat(), 'error': 'daily_index_too_large'}
            if data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            value = json.loads(data)
            if value.get('date') != date.isoformat() or value.get('version') != 5:
                return {'date': date.isoformat(), 'error': 'unsupported_or_mismatched_daily_index'}
            local = folder / f'{date.isoformat()}.json'
            local.write_text(json.dumps(value, ensure_ascii=False))
            return {'date': date.isoformat(), 'source': url, 'local': str(local.relative_to(ROOT)),
                    'sha256': hashlib.sha256(data).hexdigest()}
        except HTTPError as e:
            return {'date': date.isoformat(), 'error': f'HTTP_{e.code}'}
        except (URLError, OSError, ValueError):
            return {'date': date.isoformat(), 'error': 'network_or_json_error'}

    with ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(fetch, dates))
    missing_months = sorted({r['date'][:7] for r in records if 'error' in r})
    for month in missing_months:
        url = f"https://feei.cn/data/health/{month.replace('-', '/')}.json"
        try:
            with urlopen(Request(url, headers={'User-Agent': 'FEEI-automation/1.0'}), timeout=30) as response:
                raw = response.read(20_000_001)
            if len(raw) > 20_000_000:
                continue
            if raw[:2] == b'\x1f\x8b':
                raw = gzip.decompress(raw)
            value = json.loads(raw)
            if not isinstance(value.get('data', {}).get('healthMetrics', {}).get('metrics'), list):
                continue  # Generated month caches are not an original measurement source.
            local = folder / f'{month}-legacy.json'
            local.write_bytes(raw)
            records.append({'month': month, 'format': 'legacy_original', 'source': url,
                            'local': str(local.relative_to(ROOT)), 'sha256': hashlib.sha256(raw).hexdigest()})
        except (HTTPError, URLError, OSError, ValueError, AttributeError):
            continue
    if t['id'] == 'daily-personal-record':
        for relative in [today.strftime('sleep-score/%Y/%m/%d.json'),
                         f'reading/{today.year}.json', f'reading/weeks/{today.year}.json']:
            url = 'https://feei.cn/data/' + relative
            try:
                with urlopen(url, timeout=30) as response:
                    raw = response.read(10_000_001)
                if len(raw) > 10_000_000:
                    continue
                value = json.loads(raw)
                local = out / relative.replace('/', '-')
                local.write_text(json.dumps(value, ensure_ascii=False))
                records.append({'source': url, 'local': str(local.relative_to(ROOT)),
                                'sha256': hashlib.sha256(raw).hexdigest()})
            except (HTTPError, URLError, OSError, ValueError):
                records.append({'source': url, 'error': 'network_or_json_error'})
    (out / 'personal-data-index.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))


def prepare(t, out):
    out.mkdir(parents=True, exist_ok=True)
    repo = destination(t)
    from scheduled_issue_review import read_task_history, wallpaper_request
    reply_to = None
    request = [os.environ.get(key, '') for key in ['REVIEW_ISSUE', 'REVIEW_COMMENT', 'REVIEW_REQUEST_DIGEST']]
    if any(request):
        if t['id'] != 'update-weight-wallpaper':
            raise ValueError('只有壁纸任务支持原 Issue 重做')
        reply_to = wallpaper_request(repo, *request)
    history = read_task_history(repo, t['id'])
    previous = history['issues']
    history_scope = history['scope']
    context = {
        'time_utc': datetime.now(timezone.utc).isoformat(),
        'timezone': 'Asia/Shanghai',
        'repository_root': str(ROOT),
        'schedule_timezone': 'UTC',
        'task_id': t['id'], 'schedule': t['schedule'],
        'history': [{'url': i['html_url'], 'title': i['title'], 'updated_at': i['updated_at']}
                    for i in previous],
        'history_scope': history_scope,
        'history_bodies': 'output/history.json',
        'history_comments_scope': history['comments_scope'],
        'history_errors': history['errors'],
        'reply_to': reply_to,
        'schedule_check': json.loads((out / 'schedule-check.json').read_text()) if (out / 'schedule-check.json').exists() else None,
    }
    context['repository_activity'] = subprocess.check_output(
        ['git', 'log', '-25', '--format=%h %aI %s'], cwd=ROOT, text=True)
    if t['id'] in PERSONAL:
        context['personal_data_index'] = 'output/personal-data-index.json'
    (out / 'context.md').write_text(json.dumps(context, ensure_ascii=False, indent=2))
    (out / 'history.json').write_text(json.dumps(previous, ensure_ascii=False))
    text = prompt(COMMON) + '\n\n' + prompt(t['prompt_source'])
    (out / 'prompt.md').write_text(text)
    (out / 'schema.json').write_text(json.dumps(SCHEMA))
    meta = {
        'task_id': t['id'], 'prompt_source': t['prompt_source'],
        'prompt_sha256': hashlib.sha256(text.encode()).hexdigest(),
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'trigger_commit': os.environ.get('GITHUB_SHA', ''),
        'run_url': f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
        'delivery_repository': repo, 'prepared_at': context['time_utc'],
        'reply_to': reply_to,
        'schedule_check': json.loads((out / 'schedule-check.json').read_text()) if (out / 'schedule-check.json').exists() else None,
        'history_scope': history_scope, 'history_count': len(previous),
        'report_fingerprints': [digest for issue in previous for digest in
                                re.findall(r'<!-- report-sha256:([a-f0-9]{64}) -->', issue.get('body') or '')],
    }
    (out / 'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    if t['id'] in PERSONAL:
        collect_personal_data(t, out)
    print(f"{t['id']}: 文档提示词已读取，历史结果 {len(previous)} 条")


def validate_result(t, result, out):
    if set(result) != set(SCHEMA['required']):
        raise ValueError('结果字段不符合 schema')
    status = result['status']
    if status not in SCHEMA['properties']['status']['enum']:
        raise ValueError('无效的任务状态')
    report = result['report_markdown']
    if not isinstance(report, str) or not report.strip():
        raise ValueError(f'{status}: 缺少执行结果正文')
    audit = result['audit']
    if (not isinstance(audit, dict) or set(audit) != {'summary', 'data_cutoff', 'deduplication_reason'}
            or any(not isinstance(value, str) or not value.strip() for value in audit.values())):
        raise ValueError('缺少检查摘要、数据截止时间或去重说明')
    if not isinstance(result['sources'], list) or not isinstance(result['artifacts'], list):
        raise ValueError('来源和附件必须是数组')
    for url in result['sources']:
        if not isinstance(url, str) or urlparse(url).scheme not in {'https', 'http'} or not urlparse(url).netloc:
            raise ValueError('无效的来源 URL')
    if status == 'completed' and t['id'] in RESEARCH and len(set(result['sources'])) < 2:
        raise ValueError('研究结果缺少至少两个本轮核验来源')
    if status == 'no_update' and t['id'] != 'diary-prompt-sync' and not result['sources']:
        raise ValueError('无更新结果必须记录实际检查的来源')
    files = []
    for name in result['artifacts']:
        if not isinstance(name, str):
            raise ValueError('附件路径必须为字符串')
        path = Path(name)
        target = (ROOT / path).resolve()
        if (path.is_absolute() or '..' in path.parts or not target.is_relative_to(out.resolve())
                or path.name in {'prompt.md', 'context.md', 'history.json', 'metadata.json', 'result.json'}):
            raise ValueError('附件必须是 output/ 内生成的交付文件')
        if not target.is_file() or target.stat().st_size == 0 or (ROOT / path).is_symlink():
            raise ValueError('交付附件不存在、为空或是链接')
        files.append(target)
    if t['id'] == 'update-weight-wallpaper' and status == 'completed':
        from PIL import Image
        image = (out / 'wallpaper.png').resolve()
        if image not in files or (out / 'wallpaper.svg').resolve() not in files:
            raise ValueError('壁纸交付必须包含 PNG 和 SVG')
        with Image.open(image) as img:
            if img.size != (1320, 2868):
                raise ValueError('壁纸尺寸必须为 1320×2868')
    return status, report


def issue_title(report, fallback):
    heading = re.search(r'^# ([^\n]+)', report, re.M)
    title = heading[1].strip() if heading else fallback
    title = re.sub(r'^(?:\[(?:自动任务|completed|blocked|no_update)\]\s*)+', '', title, flags=re.I)
    title = re.sub(r'\s*[·｜|]\s*\d{4}-\d{2}-\d{2}(?:[ T].*)?$', '', title)
    return title[:200].strip() or fallback


def deliver(t, out):
    result = json.loads((out / 'result.json').read_text())
    status, report = validate_result(t, result, out)
    meta = json.loads((out / 'metadata.json').read_text())
    # Verify destination again immediately before publishing.
    repo = destination(t)
    if meta['delivery_repository'] != repo:
        raise ValueError('交付目的地发生变化')
    marker = f"<!-- automation-task:{t['id']} -->"
    digest = hashlib.sha256(report.encode()).hexdigest()
    fingerprint = f'<!-- report-sha256:{digest} -->'
    reply_to = meta.get('reply_to')
    if reply_to:
        from scheduled_issue_review import wallpaper_request
        if t['id'] != 'update-weight-wallpaper' or wallpaper_request(
                repo, reply_to['issue'], reply_to['comment_id'], reply_to['request_digest']) != reply_to:
            raise ValueError('壁纸原 Issue 或本人意见已变化，停止交付')
    duplicated = not reply_to and digest in meta.get('report_fingerprints', [])
    schedule = meta.get('schedule_check') or {}
    expired = bool(schedule.get('expires_at') and datetime.now(timezone.utc) > datetime.fromisoformat(schedule['expires_at']))
    if expired:
        status = 'no_update'
        result['audit']['summary'] = '研究完成时已超过提醒窗口，未发送过期提醒；本轮成果仅保存在附件。'
        meta['delivery_status'] = 'expired'
    body = (f"{marker}\n{fingerprint}\n<!-- status:{status} -->\n\n{report}\n\n---\n"
            f"运行：[Actions]({meta['run_url']}) · 提示词 `{meta['prompt_sha256'][:12]}` · "
            f"commit `{meta['commit'][:8]}`\n")
    if t['id'] == 'update-weight-wallpaper':
        body += '\n可直接提问，或说明“数据同步了，再做一次”，使用当前固定模板重做壁纸。\n'
    else:
        body += ('\n可直接提问或说明修改意见。已展示目标文件与完整稿时，可直接说“这版可以，写入网站吧”；'
                 '尚未展示具体版本时，会先整理待审稿。\n')
    if status == 'completed' and t['id'] in REVIEW:
        from scheduled_issue_review import seal_report
        body = seal_report(body, issue_title(report, t['title']), meta['commit'])
    if status != 'no_update' and not duplicated and not expired:
        if t['id'] == 'update-weight-wallpaper' and status == 'completed':
            artifact_id = os.environ.get('WALLPAPER_ARTIFACT_ID', '')
            run_id = os.environ.get('GITHUB_RUN_ID', '')
            if not re.fullmatch(r'[1-9][0-9]*', artifact_id) or not re.fullmatch(r'[1-9][0-9]*', run_id):
                raise ValueError('缺少已上传的 Actions 壁纸附件 ID 或运行 ID')
            download = f'https://github.com/{repo}/actions/runs/{run_id}/artifacts/{artifact_id}'
            body += (f'\n[下载壁纸 PNG、SVG]({download})（需登录 GitHub，保留 30 天；'
                     '过期或运行被删除后请重新生成）。不长期存图。\n')
        if len(body.encode('utf-8')) > 65000:
            raise ValueError('结果超过 Issue 正文限制，需整理完整交付方式后重试')
        (out / 'report.md').write_text(body)
        if reply_to:
            body = f"<!-- automation-wallpaper:request:{reply_to['comment_id']} -->\n\n" + body
            (out / 'report.md').write_text(body)
            gh('issue', 'comment', reply_to['issue'], '--repo', repo, '--body-file', str(out / 'report.md'))
            url = f"https://github.com/{repo}/issues/{reply_to['issue']}"
        else:
            task_label = f"任务：{t['title']}"
            state_label = '待补充' if status == 'blocked' else ('待审阅' if t['id'] in REVIEW else '已交付')
            for name, color in [(task_label, 'd4c5f9'), (state_label, 'fbca04' if status == 'blocked' else 'c2e0c6')]:
                gh('label', 'create', name, '--repo', repo, '--color', color, '--force')
            url = gh('issue', 'create', '--repo', repo, '--title', issue_title(report, t['title']),
                     '--label', task_label, '--label', state_label, '--body-file', str(out / 'report.md')).strip()
        meta['issue_url'] = url
    else:
        (out / 'report.md').write_text(body)
    meta['status'] = status
    meta['duplicate'] = duplicated
    meta['audit'] = result['audit']
    meta['sources'] = result['sources']
    meta['source_count'] = len(set(result['sources']))
    (out / 'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write(f"任务 `{t['id']}`：`{status}`。提示词摘要 `{meta['prompt_sha256'][:12]}`。\n")
            f.write(f"\n{result['audit']['summary']}\n\n数据截止：{result['audit']['data_cutoff']}。"
                    f"核验来源：{meta['source_count']} 个。历史：{meta.get('history_count', 0)} 条。\n\n"
                    f"去重说明：{result['audit']['deduplication_reason']}\n")
    print(f"{t['id']}: {status}")
    if status == 'blocked':
        raise ValueError('任务受阻，已记录到指定审阅渠道；不能标为成功')


def verify_sync(t, out):
    if t['id'] != 'diary-prompt-sync':
        raise ValueError('同步检查仅供 diary-prompt-sync 使用')
    try:
        check()
        status, report = 'no_update', '所有任务 workflow 与文档提示词一致，无需修改。'
    except (ValueError, OSError, KeyError, yaml.YAMLError) as error:
        status, report = 'blocked', (
            f'任务配置与提示词同步检查失败：\n\n{error}\n\n'
            '请修复上述任务的 workflow 输入、启用条件或对应文档标记，'
            '再在仓库根目录运行 `python3 scripts/automation_tasks.py check`；本轮没有自动修改文件。')
    (out / 'result.json').write_text(json.dumps({
        'status': status, 'report_markdown': report, 'sources': [], 'artifacts': [],
        'audit': {'summary': report, 'data_cutoff': datetime.now(timezone.utc).isoformat(),
                  'deduplication_reason': '本轮确定性检查配置与提示词；无差异时不创建 Issue。'},
    }, ensure_ascii=False))


def render_wallpaper(t, out):
    if t['id'] != 'update-weight-wallpaper':
        raise ValueError('固定壁纸渲染仅供 update-weight-wallpaper 使用')
    result = json.loads((out / 'result.json').read_text())
    if result['status'] != 'completed':
        meta = json.loads((out / 'metadata.json').read_text())
        if result['status'] == 'no_update' and meta.get('reply_to'):
            raise ValueError('本人明确要求重做壁纸，不能用 no_update 跳过交付')
        return
    from render_weight_wallpaper import normalize, render
    data = json.loads((out / 'wallpaper-data.json').read_text())
    state = normalize(data, datetime.now(ZoneInfo('Asia/Shanghai')).date())
    render(data, out)
    recent = [(day, weight) for day, weight in state['weights'].items()
              if day >= state['as_of'] - timedelta(days=6)]
    target = state['target'] or 140
    report = (f"壁纸已生成：PNG 1320×2868，SVG 使用相同固定版式。\n\n"
              f"最新称重为 **{state['latest']:%Y-%m-%d} 的 {state['current']:.1f} 市斤**，"
              f"阶段目标 **{target} 市斤**，当前高于目标 **{max(0, state['current'] - target):.1f} 市斤**。")
    if len(recent) > 1:
        report += f"近七个自然日有 {len(recent)} 天称重，首末变化 **{recent[-1][1] - recent[0][1]:+.1f} 市斤**。"
    else:
        report += f"近七个自然日有 {len(recent)} 天称重，不足以判断趋势。"
    report += (f"\n\n本周一至昨天已记录 {state['exercise_days']} 天运动，"
               f"其中达到30分钟的有 {state['exercise_successes']} 天；缺测保留间隔，不补零。")
    if state['latest'] < state['as_of']:
        report += '今天暂无称重，请称量并同步。'
    result['report_markdown'] = report
    result['audit']['summary'] = report
    result['audit']['data_cutoff'] = state['latest'].isoformat()
    result['artifacts'] = ['output/wallpaper.png', 'output/wallpaper.svg']
    validate_result(t, result, out)
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['check', 'prepare', 'deliver', 'verify-sync', 'render-wallpaper'])
    parser.add_argument('--task')
    args = parser.parse_args()
    os.chdir(ROOT)
    if args.command == 'check':
        check()
        return
    t = next((t for t in tasks() if t['id'] == args.task), None)
    if t is None:
        raise ValueError('任务不存在')
    for key, env in [('prompt_source', 'TASK_PROMPT_SOURCE'), ('delivery', 'TASK_DELIVERY')]:
        if os.environ.get(env) != t[key]:
            raise ValueError(f'执行参数 {env} 与任务 workflow 不一致')
    out = ROOT / 'output'
    {'prepare': prepare, 'deliver': deliver, 'verify-sync': verify_sync,
     'render-wallpaper': render_wallpaper}[args.command](t, out)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as e:
        # Never dump subprocess stderr, prompts, health data, or credentials into logs.
        print(f'自动任务失败：{type(e).__name__}: ' + (str(e) if isinstance(e, ValueError) else '请核对配置或服务状态'), file=sys.stderr)
        sys.exit(1)
