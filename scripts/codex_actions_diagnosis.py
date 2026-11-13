"""Run one read-only Codex investigation and deliver validated per-run reports."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from codex_runner import run_codex
from actions_failure_diagnosis import eligible, find_delivery, gh, pages, redact, workflow_marker

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/codex-actions-diagnosis'
PROMPT = ROOT / 'docs/05-吴飞飞/01-关于/关于FEEI.CN/定时任务/Actions失败诊断任务提示词.md'
SCHEMA = {'type': 'object', 'additionalProperties': False, 'properties': {
    'coverage': {'type': 'string'},
    'findings': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
        'properties': {'run_id': {'type': 'integer'}, 'report_markdown': {'type': 'string'}},
        'required': ['run_id', 'report_markdown']}}}, 'required': ['coverage', 'findings']}
WORKFLOW = '.github/workflows/actions-failure-diagnosis.yml'


def lifecycle_schema():
    value = json.loads(json.dumps(SCHEMA))
    item = value['properties']['findings']['items']
    item['properties'].update({
        'fault_key': {'type': 'string'},
        'state': {'type': 'string', 'enum': ['active', 'uncertain', 'recovered']},
        'resolution': {'type': 'object', 'additionalProperties': False, 'properties': {
            'run_id': {'type': 'integer'}, 'fix_commit': {'type': 'string'},
            'jobs': {'type': 'array', 'items': {'type': 'string'}}, 'explanation': {'type': 'string'},
        }, 'required': ['run_id', 'fix_commit', 'jobs', 'explanation']},
    })
    item['required'] = list(item['properties'])
    return value


def marker(run):
    return f'<!-- actions-codex-run:{run["id"]}:attempt:{run["run_attempt"]} -->'


def report_location(repo, run, issue):
    original = gh(f'repos/{repo}/issues/{issue}')
    comments = pages(f'repos/{repo}/issues/{issue}/comments')
    locations = [(f'repos/{repo}/issues/{issue}', original)] + [
        (f'repos/{repo}/issues/comments/{entry["id"]}', entry) for entry in comments]
    found = [(endpoint, entry) for endpoint, entry in locations
             if entry.get('user', {}).get('login') == 'github-actions[bot]' and marker(run) in entry.get('body', '')]
    if len(found) > 1:
        raise ValueError('同次运行存在多份报告，停止自动覆盖')
    return found[0] if found else None


def delivered(repo, run):
    issue, _ = find_delivery(repo, run)
    return issue, bool(issue and report_location(repo, run, issue))


def replay():
    repo = os.environ['GITHUB_REPOSITORY']
    identifier = os.environ.get('REPORT_RUN_ID', '')
    if os.environ.get('TARGET_RUN_ID'):
        raise ValueError('调查运行编号与交付重放编号不能同时指定')
    if not re.fullmatch(r'[1-9]\d*', identifier):
        raise ValueError('产物来源运行编号无效')
    source = gh(f'repos/{repo}/actions/runs/{identifier}')
    if (source.get('head_repository', {}).get('full_name') != repo or source.get('head_branch') != 'main'
            or source.get('path') != WORKFLOW or source.get('status') != 'completed'
            or source.get('event') not in ('schedule', 'workflow_dispatch')
            or (source['event'] == 'workflow_dispatch' and source.get('actor', {}).get('login') != repo.split('/')[0])):
        raise ValueError('产物必须来自本仓库 main 上的可信诊断运行')
    attempt = source['run_attempt']
    jobs = pages(f'repos/{repo}/actions/runs/{identifier}/attempts/{attempt}/jobs', 'jobs')
    if not any(job.get('name') == 'investigate' and job.get('conclusion') == 'success' for job in jobs):
        raise ValueError('来源调查未成功，不能重放未经校验的模型结果')
    names = {f'codex-actions-diagnosis-{identifier}-attempt-{attempt}'}
    if attempt == 1:
        names.add(f'codex-actions-diagnosis-{identifier}')
    artifacts = pages(f'repos/{repo}/actions/runs/{identifier}/artifacts', 'artifacts')
    selected = [entry for entry in artifacts if entry['name'] in names and not entry.get('expired')
                and 0 < entry.get('size_in_bytes', 0) <= 5_000_000]
    if len(selected) != 1:
        raise ValueError('未找到唯一、有效且大小合规的诊断产物')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'ready=true\nartifact-id={selected[0]["id"]}\nsource-run={identifier}\n')


def prepare():
    from actions_diagnosis_lifecycle import collect
    OUT.mkdir(parents=True, exist_ok=True)
    context = collect(os.environ['GITHUB_REPOSITORY'], os.environ.get('TARGET_RUN_ID', ''))
    (OUT / 'context.json').write_text(json.dumps(context, ensure_ascii=False))
    if not context['failures']:
        (OUT / 'result.json').write_text(json.dumps({'coverage': context['scope'], 'findings': []}, ensure_ascii=False))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'ready={str(bool(context["failures"])).lower()}\n')


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
        fields = {'run_id', 'report_markdown', 'fault_key', 'state', 'resolution'} if context.get('version') == 2 else {'run_id', 'report_markdown'}
        if not isinstance(item, dict) or set(item) != fields:
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
    if context.get('version') == 2:
        from actions_diagnosis_lifecycle import validate as validate_lifecycle
        validate_lifecycle(result, context)


def execute():
    context_bytes = (OUT / 'context.json').read_bytes()
    context = json.loads(context_bytes)
    (OUT / 'schema.json').write_text(json.dumps(lifecycle_schema() if context.get('version') == 2 else SCHEMA))
    result_path = OUT / 'result.json'
    result_path.unlink(missing_ok=True)
    prompt = PROMPT.read_text() + '\n\n本轮输入见 output/codex-actions-diagnosis/context.json。'
    log = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'actions-codex.log'
    run_codex(prompt, output=result_path, schema=OUT / 'schema.json', cwd=ROOT, timeout=2400,
              permissions='{extends=":read-only", filesystem={":workspace_roots"={output="write"}}, network={enabled=true}}',
              profile='diagnosis', github_read=True, stage='actions-diagnosis', stdout_log=log, stderr_log=log)
    if (OUT / 'context.json').read_bytes() != context_bytes:
        raise ValueError('调查输入在模型执行期间变化，停止交付')
    validate(json.loads(result_path.read_text()), context)
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT).strip():
        raise ValueError('Codex 修改了受保护的仓库文件')


def report_text(text):
    # Normalize a literal header-name reference, while retaining conservative redaction for values.
    lines = []
    for line in text.splitlines(keepends=True):
        def normalize(literal):
            if re.search(r'\b[\w.-]+\s*=\s*[^\s,;]+', line[literal.end():]):
                return literal[0]
            return 'Cookie 请求头前缀'
        lines.append(re.sub(r'`Cookie:\s*`\s*前缀', normalize, line, flags=re.I))
    return redact(''.join(lines)).replace('@', '@\u200b')


def report_body(run, text):
    return (workflow_marker(run) + '\n' + marker(run) + '\n\n'
            + f'运行：[{run["id"]}]({run["html_url"]}) · 第 {run["run_attempt"]} 次尝试\n\n'
            + text + '\n\n仅调查并提供方案，未自动修复、重跑或部署。\n')


def publish():
    context = json.loads((OUT / 'context.json').read_text())
    result = json.loads((OUT / 'result.json').read_text())
    validate(result, context)
    if context.get('version') == 2:
        from actions_diagnosis_lifecycle import publish as publish_lifecycle
        for item in result['findings']:
            item['report_markdown'] = report_text(item['report_markdown'])
            item['resolution']['explanation'] = report_text(item['resolution']['explanation'])
        return publish_lifecycle(context, result)
    repo = os.environ['GITHUB_REPOSITORY']
    if context['repository'] != repo:
        raise ValueError('交付仓库不匹配')
    repair = os.environ.get('REPLAY_REPORT') == 'true'
    if repair and (os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'
                   or os.environ.get('GITHUB_ACTOR') != repo.split('/')[0]):
        raise ValueError('仅本人手动重放可以更新已有机器人报告')
    summary = []
    for item in result['findings']:
        run = gh(f'repos/{repo}/actions/runs/{item["run_id"]}')
        original = next(entry for entry in context['failures'] if entry['id'] == run['id'])
        if not eligible(run, repo) or any(run[key] != original[key] for key in ('run_attempt', 'head_sha', 'path')):
            raise ValueError('运行来源或尝试版本变化，停止交付')
        issue, seen = delivered(repo, run)
        if seen and not repair:
            continue
        body = report_body(run, report_text(item['report_markdown']))
        if seen:
            location = report_location(repo, run, issue)
            if not location:
                raise ValueError('原机器人报告已变化，停止重放')
            endpoint, existing = location
            if existing['body'] == body:
                summary.append(existing['html_url'] + '（正文相同，未重复写入）')
                continue
            legacy = report_body(run, redact(item['report_markdown']).replace('@', '@\u200b'))
            if existing['body'] != legacy:
                raise ValueError('原报告与本次产物不一致，可能有人工修改；停止覆盖')
            response = gh(endpoint, 'PATCH', {'body': body})
            summary.append(response['html_url'] + '（已更新原报告）')
            continue
        endpoint = f'repos/{repo}/issues/{issue}/comments' if issue else f'repos/{repo}/issues'
        data = {'body': body} if issue else {'title': 'Actions 失败诊断：' + run['name'][:150], 'body': body}
        response = gh(endpoint, 'POST', data)
        summary.append(response['html_url'])
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(redact(result['coverage']) + '\n\n' + '\n'.join(summary))


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('prepare', 'execute', 'publish', 'replay'):
        raise SystemExit('用法：codex_actions_diagnosis.py prepare|execute|publish|replay')
    globals()[sys.argv[1]]()
