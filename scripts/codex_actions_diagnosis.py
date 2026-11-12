"""Run one read-only Codex investigation and deliver validated per-run reports."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from actions_failure_diagnosis import eligible, find_delivery, gh, pages, redact, workflow_marker

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/codex-actions-diagnosis'
PROMPT = ROOT / 'docs/05-吴飞飞/01-关于/关于FEEI.CN/定时任务/Actions失败诊断任务提示词.md'
SCHEMA = {'type': 'object', 'additionalProperties': False, 'properties': {
    'coverage': {'type': 'string'},
    'findings': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
        'properties': {'run_id': {'type': 'integer'}, 'report_markdown': {'type': 'string'}},
        'required': ['run_id', 'report_markdown']}}}, 'required': ['coverage', 'findings']}


def marker(run):
    return f'<!-- actions-codex-run:{run["id"]}:attempt:{run["run_attempt"]} -->'


def delivered(repo, run):
    issue, _ = find_delivery(repo, run)
    if not issue:
        return None, False
    original = gh(f'repos/{repo}/issues/{issue}')
    comments = pages(f'repos/{repo}/issues/{issue}/comments')
    return issue, marker(run) in original.get('body', '') or any(
        entry.get('user', {}).get('login') == 'github-actions[bot]' and marker(run) in entry.get('body', '')
        for entry in comments)


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    repo = os.environ['GITHUB_REPOSITORY']
    workflows = pages(f'repos/{repo}/actions/workflows', 'workflows')
    target = os.environ.get('TARGET_RUN_ID', '')
    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ')
    runs = []
    if target:
        if not re.fullmatch(r'[1-9]\d*', target):
            raise ValueError('运行编号无效')
        runs = [gh(f'repos/{repo}/actions/runs/{target}')]
    else:
        # GitHub search returns at most 1000 results. Record this limit instead of claiming exhaustive history.
        for page in range(1, 11):
            batch = gh(f'repos/{repo}/actions/runs?branch=main&created=%3E%3D{since}&per_page=100&page={page}')['workflow_runs']
            runs.extend(batch)
            if len(batch) < 100:
                break
    failures = []
    for run in runs:
        if eligible(run, repo) and not delivered(repo, run)[1]:
            failures.append({key: run[key] for key in (
                'id', 'run_attempt', 'name', 'path', 'html_url', 'head_sha', 'conclusion', 'created_at')})
    context = {'repository': repo, 'workflows': workflows, 'failures': failures,
               'scope': f'全部已登记 workflow；运行范围：指定运行 {target}' if target else
                        f'全部已登记 workflow；main 最近7天，从 {since} 起，最多1000次运行，实际读取 {len(runs)} 次。',
               'recent_runs': [{key: run.get(key) for key in ('id', 'name', 'path', 'conclusion', 'head_sha', 'created_at')}
                               for run in runs]}
    (OUT / 'context.json').write_text(json.dumps(context, ensure_ascii=False))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'ready={str(bool(failures)).lower()}\n')


def validate(result, context):
    if not isinstance(result, dict) or set(result) != {'coverage', 'findings'}:
        raise ValueError('诊断结果字段无效')
    if not isinstance(result['coverage'], str) or not result['coverage'].strip():
        raise ValueError('缺少实际调查范围')
    if not isinstance(result['findings'], list):
        raise ValueError('诊断结果必须为列表')
    expected = {run['id'] for run in context['failures']}
    identifiers = []
    for item in result['findings']:
        if not isinstance(item, dict) or set(item) != {'run_id', 'report_markdown'}:
            raise ValueError('诊断条目无效')
        if type(item['run_id']) is not int or item['run_id'] not in expected:
            raise ValueError('诊断对象超出当前失败运行范围')
        text = item['report_markdown']
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > 45000:
            raise ValueError('报告为空或超过大小上限')
        if '<!--' in text or re.search(r'<(?:script|img|iframe)\b|!\[', text, re.I):
            raise ValueError('报告含不允许的标记')
        identifiers.append(item['run_id'])
    if len(set(identifiers)) != len(identifiers) or set(identifiers) != expected:
        raise ValueError('失败运行存在遗漏或重复；未发布部分报告')


def execute():
    context = json.loads((OUT / 'context.json').read_text())
    (OUT / 'schema.json').write_text(json.dumps(SCHEMA))
    result_path = OUT / 'result.json'
    result_path.unlink(missing_ok=True)
    config = {
        'default_permissions': 'diagnosis',
        'permissions.diagnosis': '{extends=":read-only", filesystem={":workspace_roots"={output="write"}}, network={enabled=true}}',
        'model_provider': 'custom', 'model_providers.custom.name': 'AI Proxy',
        'model_providers.custom.base_url': os.environ['OPENAI_BASE_URL'].rstrip('/'),
        'model_providers.custom.wire_api': 'responses',
        'model_providers.custom.env_key': 'OPENAI_API_KEY', 'model_reasoning_effort': 'high',
        'shell_environment_policy.exclude': ['OPENAI_*', 'ACTIONS_*'],
    }
    command = ['codex', 'exec', '--cd', str(ROOT), '--ephemeral']
    for key, value in config.items():
        command += ['--config', f'{key}={value if key == "permissions.diagnosis" else json.dumps(value)}']
    command += ['--model', os.environ['OPENAI_MODEL'], '--output-schema', str(OUT / 'schema.json'),
                '--output-last-message', str(result_path), '-']
    prompt = PROMPT.read_text() + '\n\n本轮输入见 output/codex-actions-diagnosis/context.json。'
    with (Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'actions-codex.log').open('w') as log:
        completed = subprocess.run(command, input=prompt, text=True, stdout=log, stderr=log,
                                   cwd=ROOT, timeout=2400)
    if completed.returncode:
        raise RuntimeError(f'Codex 诊断未完成，退出码 {completed.returncode}；未发布根因报告')
    if result_path.stat().st_size > 2000000:
        raise ValueError('诊断输出过大')
    validate(json.loads(result_path.read_text()), context)
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT).strip():
        raise ValueError('Codex 修改了受保护的仓库文件')


def publish():
    context = json.loads((OUT / 'context.json').read_text())
    result = json.loads((OUT / 'result.json').read_text())
    validate(result, context)
    repo = os.environ['GITHUB_REPOSITORY']
    if context['repository'] != repo:
        raise ValueError('交付仓库不匹配')
    summary = []
    for item in result['findings']:
        run = gh(f'repos/{repo}/actions/runs/{item["run_id"]}')
        original = next(entry for entry in context['failures'] if entry['id'] == run['id'])
        if not eligible(run, repo) or any(run[key] != original[key] for key in ('run_attempt', 'head_sha', 'path')):
            raise ValueError('运行来源或尝试版本变化，停止交付')
        issue, seen = delivered(repo, run)
        if seen:
            continue
        text = redact(item['report_markdown']).replace('@', '@\u200b')
        body = (workflow_marker(run) + '\n' + marker(run) + '\n\n'
                + f'运行：[{run["id"]}]({run["html_url"]}) · 第 {run["run_attempt"]} 次尝试\n\n'
                + text + '\n\n仅调查并提供方案，未自动修复、重跑或部署。\n')
        endpoint = f'repos/{repo}/issues/{issue}/comments' if issue else f'repos/{repo}/issues'
        data = {'body': body} if issue else {'title': 'Actions 失败诊断：' + run['name'][:150], 'body': body}
        response = gh(endpoint, 'POST', data)
        summary.append(response['html_url'])
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(redact(result['coverage']) + '\n\n' + '\n'.join(summary))


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('prepare', 'execute', 'publish'):
        raise SystemExit('用法：codex_actions_diagnosis.py prepare|execute|publish')
    globals()[sys.argv[1]]()
