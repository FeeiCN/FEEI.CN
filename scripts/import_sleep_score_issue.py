#!/usr/bin/env python3
"""Parse owner Shortcut OCR Issues and deliver verified persistent sleep scores."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import unicodedata
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from sleep_score_storage import COMPONENTS, canonical, validate_record

ROOT = Path(__file__).resolve().parents[1]
REMOTE_ROOT = '/data/wufeifei-assets/data/sleep-score'
DATA_BASE = 'https://feei.cn/data/sleep-score/'
MARKER = '<!-- sleep-score-import:'
LABELS = {'睡眠评分': '7057ff', '睡眠:已归档': '0e8a16', '睡眠:待核对': 'fbca04', '睡眠:处理中': '1d76db'}


def gh_api(repo, endpoint, method='GET', payload=None):
    command = ['gh', 'api', f'repos/{repo}/{endpoint}', '--method', method]
    if payload is not None:
        command += ['--input', '-']
    process = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                             text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if process.returncode:
        raise RuntimeError(f'GitHub API {method} {endpoint.split("?")[0]} 失败')
    return json.loads(process.stdout) if process.stdout.strip() else None


def pages(repo, endpoint):
    result, page = [], 1
    separator = '&' if '?' in endpoint else '?'
    while True:
        batch = gh_api(repo, f'{endpoint}{separator}per_page=100&page={page}')
        result.extend(batch)
        if len(batch) < 100:
            return result
        page += 1


def is_sleep_issue(issue, repo):
    return (not issue.get('pull_request') and issue.get('user', {}).get('login', '').lower() == repo.split('/')[0].lower()
            and issue.get('title', '').strip() == '睡眠评分')


def clock_after(text, label):
    values = re.findall(label + r'\s*[:：]?\s*([0-2]?\d:[0-5]\d)(?!\d)', text)
    values = list(dict.fromkeys(values))
    if len(values) != 1:
        return None
    hour, minute = map(int, values[0].split(':'))
    return f'{hour:02}:{minute:02}' if hour < 24 else None


def parse_issue(issue, repo):
    if not is_sleep_issue(issue, repo):
        raise ValueError('只处理仓库本人创建、标题为“睡眠评分”的 Issue')
    raw = issue.get('body') or ''
    if not raw.strip() or len(raw.encode()) > 100_000:
        raise ValueError('OCR 正文为空或超过长度限制')
    text = unicodedata.normalize('NFKC', raw).replace('\r\n', '\n')
    components = {}
    for chinese, key in [('时长', 'duration'), ('就寝', 'bedtime'), ('中断', 'interruptions')]:
        matches = re.findall(chinese + r'\s*[:：]\s*(\d+)\s*/\s*(\d+)', text)
        if len(matches) != 1:
            raise ValueError('缺少或存在重复的分项：' + chinese)
        score, maximum = map(int, matches[0])
        components[key] = {'score': score, 'maximum': maximum}
    totals = re.findall(r'^\s*(\d{1,3})\s*$', text, re.M)
    if not totals:
        totals = re.findall(r'睡眠评分\s*[:：]?\s*(\d{1,3})(?!\d|\s*/)', text)
    if len(totals) != 1:
        raise ValueError('未找到明确的单个总分，请检查 OCR 文本')
    created = datetime.fromisoformat(issue['created_at'].replace('Z', '+00:00'))
    if created.tzinfo is None:
        raise ValueError('Issue 创建时间缺少时区')
    local = created.astimezone(ZoneInfo('Asia/Shanghai'))
    record = {
        'date': local.date().isoformat(), 'source': 'Apple Health', 'dataType': 'HKDataTypeAppleSleepScore',
        'capturedAt': local.isoformat(timespec='seconds'), 'score': int(totals[0]), 'components': components,
        'provenance': {'method': 'shortcut_ocr', 'dateBasis': 'issue_created_at_asia_shanghai',
                       'issueNumber': issue['number'], 'issueUrl': issue['html_url'],
                       'issueCreatedAt': issue['created_at'], 'issueUpdatedAt': issue['updated_at'],
                       'bodySha256': hashlib.sha256(raw.encode()).hexdigest()},
    }
    grades = re.findall(r'^\s*(非常高|高|一般|尚可|低|非常低|优秀|良好|偏低)\s*$', text, re.M)
    if len(grades) == 1:
        record['classification'] = grades[0]
    observations = {}
    duration = re.findall(r'^\s*(\d+小时(?:\s*\d+分钟)?|\d+分钟)\s*$', text, re.M)
    if len(duration) == 1:
        observations['durationDisplay'] = duration[0]
        observations['durationPrecision'] = 'minutes' if '分钟' in duration[0] else 'display_hours'
        if '分钟' in duration[0]:
            components['duration']['detail'] = duration[0]
    for label, key in [('昨晚就寝时间', 'bedtimeClock'), ('平均就寝时间', 'averageBedtimeClock')]:
        value = clock_after(text, label)
        if value:
            observations[key] = value
    later = re.search(r'比平均就寝时间\s*(晚|早)\s*(\d+)\s*分钟', text)
    if later:
        offset = int(later[2]) * (1 if later[1] == '晚' else -1)
        observations['bedtimeOffsetMinutes'] = offset
        components['bedtime']['detail'] = f'比平均{later[1]}{later[2]}分钟'
    if observations.get('bedtimeClock'):
        components['bedtime']['detail'] = observations['bedtimeClock'] + (
            '，' + components['bedtime']['detail'] if components['bedtime'].get('detail') else '')
    vitals = re.search(r'生命体征\s*(?:\d+小时(?:\d+分钟)?\s*)?(正常|偏高|偏低|超出范围)', text)
    if vitals:
        observations['vitalSignsDisplay'] = vitals[1]
    shutdown = re.search(r'Apple\s*Watch\s*于?\s*([0-2]?\d:[0-5]\d)\s*关机', text, re.I)
    if shutdown:
        value = clock_after('关机 ' + shutdown[1], '关机')
        warning = {'code': 'watch_shutdown', 'message': 'Apple Watch 关机可能影响本次评分。'}
        if value:
            warning['time'] = value
            warning['message'] = f'Apple Watch 于 {value} 关机，可能影响本次评分。'
        record['quality'] = {'warnings': [warning]}
    elif '可能影响' in text and '评分' in text:
        record['quality'] = {'warnings': [{'code': 'capture_warning', 'message': '截图提示本次评分可能受影响。'}]}
    if observations:
        record['observations'] = observations
    validate_record(record, require_complete=True)
    return {'version': 1, 'rawText': raw, 'record': record}


def source_snapshot(issue):
    # Labels and our receipt also change updated_at; compare only source content.
    return {key: issue.get(key) for key in ('title', 'body', 'created_at')}


def storage_request(request, local_root=None):
    if local_root:
        from sleep_score_storage import dispatch
        return dispatch({**request, 'root': str(local_root)})
    source = (ROOT / 'scripts/sleep_score_storage.py').read_text()
    remote = os.environ['SLEEP_SCORE_SSH_TARGET']
    port = str(int(os.environ.get('SLEEP_SCORE_SSH_PORT', '10022')))
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+', remote):
        raise ValueError('SSH 目标格式无效')
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', port]
    if os.environ.get('SLEEP_SCORE_SSH_KEY'):
        command += ['-i', os.environ['SLEEP_SCORE_SSH_KEY']]
    # Supply code and data separately; OCR content is never interpolated into shell commands.
    wire_source = source.rsplit("if __name__ == '__main__':", 1)[0]
    wire_source += '\nprint(json.dumps(dispatch(json.load(sys.stdin)), ensure_ascii=False))\n'
    command += [remote, 'python3 -c ' + shlex.quote(wire_source)]
    process = subprocess.run(command, input=json.dumps({**request, 'root': REMOTE_ROOT}, ensure_ascii=False),
                             text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if process.returncode:
        raise RuntimeError('服务器睡眠评分存储失败；未关闭 Issue')
    return json.loads(process.stdout)


def ensure_labels(repo):
    existing = {item['name'] for item in pages(repo, 'labels')}
    for name, color in LABELS.items():
        if name not in existing:
            gh_api(repo, 'labels', 'POST', {'name': name, 'color': color})


def set_state(repo, issue, label):
    fresh = gh_api(repo, f"issues/{issue['number']}")
    labels = [item['name'] for item in fresh['labels'] if not item['name'].startswith('睡眠:')]
    gh_api(repo, f"issues/{issue['number']}/labels", 'PUT', {'labels': list(dict.fromkeys(labels + ['睡眠评分', label]))})


def upsert_comment(repo, number, body, marker):
    existing = [c for c in pages(repo, f'issues/{number}/comments')
                if c.get('user', {}).get('login') == 'github-actions[bot]' and c['body'].startswith(marker)]
    if existing:
        old_content = re.split(r'\[(?:运行记录|查看运行)\]\(', existing[-1]['body'])[0]
        new_content = re.split(r'\[(?:运行记录|查看运行)\]\(', body)[0]
        if old_content != new_content:
            gh_api(repo, f"issues/comments/{existing[-1]['id']}", 'PATCH', {'body': body})
    else:
        gh_api(repo, f'issues/{number}/comments', 'POST', {'body': body})


def verify_online(record):
    url = DATA_BASE + record['date'].replace('-', '/') + '.json'
    expected = hashlib.sha256(canonical(record)).hexdigest()
    for attempt in range(3):
        try:
            request = Request(url + '?revision=' + expected[:12], headers={'Cache-Control': 'no-cache'})
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read(250_001))
            if canonical(payload) == canonical(record):
                return url
        except (OSError, ValueError):
            pass
        if attempt < 2:
            time.sleep(2)
    raise RuntimeError('数据已存储，但线上读取尚未核对成功；保留 Issue 供重试')


def receipt(record, url, run_url, older=False):
    heading = f"已保存 {record['date']} 睡眠评分：**{record['score']} 分**。"
    if older:
        source = record.get('provenance', {})
        reference = (f"[Issue #{source['issueNumber']}]({source['issueUrl']})"
                     if source.get('issueUrl') else '采集记录')
        heading = f"本次输入已留档。{record['date']} 采用较新的{reference}：**{record['score']} 分**。"
    lines = [heading, '',
             '时长 {}/50，就寝 {}/30，中断 {}/20。'.format(*[
                 record['components'][key]['score'] if record['components'].get(key) else '缺失' for key in COMPONENTS])]
    lines += [item['message'] for item in record.get('quality', {}).get('warnings', [])]
    lines += ['', f'[查看评分数据]({url})', f'[运行记录]({run_url})']
    return '\n'.join(lines)


def process_issue(repo, number, run_url, local_root=None, verifier=verify_online):
    issue = gh_api(repo, f'issues/{int(number)}')
    if not is_sleep_issue(issue, repo):
        return {'number': number, 'status': 'skipped'}
    marker = MARKER + str(number) + ' -->'
    initial = source_snapshot(issue)
    try:
        submission = parse_issue(issue, repo)
        set_state(repo, issue, '睡眠:处理中')
        fresh = gh_api(repo, f'issues/{number}')
        if source_snapshot(fresh) != initial:
            return {'number': number, 'status': 'superseded'}
        result = storage_request({'operation': 'upsert', 'submission': submission}, local_root)
        if result['status'] == 'stale':
            raise ValueError('同一 Issue 已有更新版本，已保留本次来源，请稍后重试')
        record = result['record']
        url = verifier(record)
        fresh = gh_api(repo, f'issues/{number}')
        if source_snapshot(fresh) != initial:
            return {'number': number, 'status': 'superseded'}
        body = marker + '\n' + receipt(record, url, run_url, older=result['status'] == 'older')
        upsert_comment(repo, number, body, marker)
        set_state(repo, issue, '睡眠:已归档')
        gh_api(repo, f'issues/{number}', 'PATCH', {'state': 'closed', 'state_reason': 'completed'})
        return {'number': number, 'status': result['status'], 'url': url, 'date': record['date']}
    except (ValueError, RuntimeError, OSError) as error:
        fresh = gh_api(repo, f'issues/{number}')
        if source_snapshot(fresh) != initial:
            return {'number': number, 'status': 'superseded'}
        set_state(repo, issue, '睡眠:待核对')
        if fresh['state'] == 'closed':
            gh_api(repo, f'issues/{number}', 'PATCH', {'state': 'open'})
        message = marker + '\n睡眠评分暂未归档：' + str(error) + f'。\n\n[查看运行]({run_url})'
        upsert_comment(repo, number, message, marker)
        return {'number': number, 'status': 'blocked', 'reason': str(error)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--issue', type=int)
    parser.add_argument('--preview', action='store_true')
    parser.add_argument('--seed', action='store_true')
    parser.add_argument('--local-root', type=Path)
    args = parser.parse_args()
    repo = os.environ.get('GITHUB_REPOSITORY', 'FeeiCN/FEEI.CN')
    if args.preview:
        if not args.issue:
            parser.error('--preview 需要 --issue')
        print(json.dumps(parse_issue(gh_api(repo, f'issues/{args.issue}'), repo), ensure_ascii=False, indent=2))
        return
    if os.environ.get('IMPORT_ACTOR', '').lower() != repo.split('/')[0].lower():
        raise ValueError('仅仓库本人或经 workflow 验证的定时任务可以请求归档')
    ensure_labels(repo)
    if args.seed:
        records = [json.loads(p.read_text()) for p in sorted((ROOT / 'static/data/sleep-score').glob('20*/*/*.json'))]
        print(json.dumps(storage_request({'operation': 'seed', 'records': records}, args.local_root), ensure_ascii=False))
    numbers = [args.issue] if args.issue else [item['number'] for item in pages(repo, 'issues?state=open') if is_sleep_issue(item, repo)]
    url = f"https://github.com/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    results = [process_issue(repo, number, url, args.local_root) for number in sorted(numbers)]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            for item in results:
                stream.write(f"- [Issue #{item['number']}](https://github.com/{repo}/issues/{item['number']})：{item['status']}"
                             + (f" · [评分数据]({item['url']})" if item.get('url') else '') + '\n')
    if any(item['status'] == 'blocked' for item in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
