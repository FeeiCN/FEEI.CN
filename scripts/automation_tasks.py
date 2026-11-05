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
COMMON = BACKSTAGE / '自动任务执行约定.md'
START = '<!-- automation-prompt:start -->'
END = '<!-- automation-prompt:end -->'
RESEARCH = {'security-event-research', 'ai-security-frontier-research',
            'ai-coding-rd-efficiency', 'security-architecture-defense', 'hk-ipo-alerts'}
SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'properties': {
        'status': {'type': 'string', 'enum': ['completed', 'no_update', 'blocked']},
        'report_markdown': {'type': 'string'},
        'sources': {'type': 'array', 'items': {'type': 'string'}},
        'artifacts': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['status', 'report_markdown', 'sources', 'artifacts'],
}


def gh(*args):
    return subprocess.check_output(['gh', *args], text=True, stderr=subprocess.PIPE)


def tasks():
    return yaml.safe_load((ROOT / 'automation/registry.yml').read_text())['tasks']


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
    manifest = json.loads((ROOT / '.github/chatgpt-tasks/tasks.json').read_text())['tasks']
    if len(entries) != 10 or len({t['id'] for t in entries}) != 10:
        raise ValueError('必须有十个唯一任务')
    prompt(COMMON)
    for t in entries:
        mirrors = [m for m in manifest if m['task_id'] == t['id']]
        if len(mirrors) != 1:
            raise ValueError(f"{t['id']}: 清单不唯一")
        mirror = mirrors[0]
        if ('prompt' in mirror or mirror['id'] != t['source_task_id']
                or mirror['prompt_source'] != t['prompt_source']):
            raise ValueError(f"{t['id']}: 提示词源或原任务 ID 不一致")
        prompt(t['prompt_source'])
        workflow = yaml.safe_load((ROOT / t['workflow']).read_text())
        trigger = workflow.get('on', workflow.get(True))
        job = workflow['jobs']['run']
        if (job['with']['task_id'] != t['id']
                or t['variable'] not in job['if']
                or job['uses'] != './.github/workflows/automation-task.yml'):
            raise ValueError(f"{t['id']}: workflow 消费链不一致")
        if trigger['schedule'][0]['cron'] != t['cron']:
            raise ValueError(f"{t['id']}: 调度时间不一致")
        if not t['enabled'] or t['writes_repository']:
            raise ValueError(f"{t['id']}: 启用状态或写入权限不正确")
    print('通过：10 个任务、文档提示词、源 ID 与 workflow 消费链一致')


def destination(t):
    repo = os.environ['GITHUB_REPOSITORY']
    if t['delivery'] == 'private_issue':
        repo = os.environ.get('AUTOMATION_PRIVATE_REPOSITORY', '')
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
            raise ValueError('私人任务缺少 AUTOMATION_PRIVATE_REPOSITORY，停止读取私人数据')
        info = json.loads(gh('api', f'repos/{repo}'))
        if not info.get('private'):
            raise ValueError('私人交付目标必须是私有仓库')
    return repo


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
        url = 'https://feei.cn/static/data/health/' + relative
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
    (out / 'personal-data-index.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))


def prepare(t, out):
    out.mkdir(parents=True, exist_ok=True)
    repo = destination(t)
    marker = f"<!-- automation-task:{t['id']} -->"
    raw = json.loads(gh('api', f'repos/{repo}/issues?state=all&sort=updated&per_page=100'))
    previous = [i for i in raw if marker in (i.get('body') or '')][:5]
    context = {
        'time_utc': datetime.now(timezone.utc).isoformat(),
        'timezone': 'Asia/Shanghai',
        'task_id': t['id'], 'schedule': t['schedule'],
        'history': [{'url': i['html_url'], 'body': i['body']} for i in previous],
    }
    context['repository_activity'] = subprocess.check_output(
        ['git', 'log', '-25', '--format=%h %aI %s'], cwd=ROOT, text=True)
    if t['delivery'] == 'private_issue':
        context['personal_data_index'] = 'output/personal-data-index.json'
    (out / 'context.md').write_text(json.dumps(context, ensure_ascii=False, indent=2))
    (out / 'history.json').write_text(json.dumps(previous, ensure_ascii=False))
    text = prompt(COMMON) + '\n\n' + prompt(t['prompt_source'])
    (out / 'prompt.md').write_text(text)
    (out / 'schema.json').write_text(json.dumps(SCHEMA))
    meta = {
        'task_id': t['id'], 'prompt_source': t['prompt_source'],
        'prompt_sha256': hashlib.sha256(text.encode()).hexdigest(),
        'commit': os.environ.get('GITHUB_SHA', ''),
        'run_url': f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
        'delivery_repository': repo, 'prepared_at': context['time_utc'],
    }
    (out / 'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    if t['delivery'] == 'private_issue':
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
        raise ValueError('缺少执行结果正文')
    if not isinstance(result['sources'], list) or not isinstance(result['artifacts'], list):
        raise ValueError('来源和附件必须是数组')
    for url in result['sources']:
        if not isinstance(url, str) or urlparse(url).scheme not in {'https', 'http'} or not urlparse(url).netloc:
            raise ValueError('无效的来源 URL')
    if status == 'completed' and t['id'] in RESEARCH and len(set(result['sources'])) < 2:
        raise ValueError('研究结果缺少至少两个本轮核验来源')
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
        image = out / 'wallpaper.png'
        if image not in files or out / 'wallpaper.svg' not in files:
            raise ValueError('壁纸交付必须包含 PNG 和 SVG')
        with Image.open(image) as img:
            if img.size != (1320, 2868):
                raise ValueError('壁纸尺寸必须为 1320×2868')
    return status, report


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
    history = json.loads((out / 'history.json').read_text())
    duplicated = any(fingerprint in (i.get('body') or '') for i in history)
    body = (f"{marker}\n{fingerprint}\n<!-- status:{status} -->\n\n{report}\n\n---\n"
            f"运行：[Actions]({meta['run_url']}) · 提示词 `{meta['prompt_sha256'][:12]}` · "
            f"commit `{meta['commit'][:8]}`\n")
    if len(body.encode('utf-8')) > 65000:
        raise ValueError('结果超过 Issue 正文限制，需整理完整交付方式后重试')
    (out / 'report.md').write_text(body)
    if status != 'no_update' and not duplicated:
        if t['delivery'] == 'private_issue' and result['artifacts']:
            tag = f"automation-{t['id']}-{os.environ['GITHUB_RUN_ID']}"
            files = [str(ROOT / name) for name in result['artifacts']]
            release = gh('release', 'create', tag, *files, '--repo', repo,
                         '--title', f"{t['title']} · {tag}", '--notes-file', str(out / 'report.md')).strip()
            body += f'\n交付附件：[私人版本]({release})\n'
            (out / 'report.md').write_text(body)
        date = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        url = gh('issue', 'create', '--repo', repo, '--title',
                 f"[自动任务][{status}] {t['title']} · {date}", '--body-file', str(out / 'report.md')).strip()
        meta['issue_url'] = url
    meta['status'] = status
    meta['duplicate'] = duplicated
    (out / 'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as f:
            f.write(f"任务 `{t['id']}`：`{status}`。提示词摘要 `{meta['prompt_sha256'][:12]}`。\n")
    print(f"{t['id']}: {status}")
    if status == 'blocked':
        raise ValueError('任务受阻，已记录到指定审阅渠道；不能标为成功')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['check', 'prepare', 'deliver'])
    parser.add_argument('--task')
    args = parser.parse_args()
    os.chdir(ROOT)
    if args.command == 'check':
        check()
        return
    t = next((t for t in tasks() if t['id'] == args.task), None)
    if t is None or not t['enabled']:
        raise ValueError('任务不存在或尚未启用')
    out = ROOT / 'output'
    {'prepare': prepare, 'deliver': deliver}[args.command](t, out)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as e:
        # Never dump subprocess stderr, prompts, health data, or credentials into logs.
        print(f'自动任务失败：{type(e).__name__}: ' + (str(e) if isinstance(e, ValueError) else '请核对配置或服务状态'), file=sys.stderr)
        sys.exit(1)
