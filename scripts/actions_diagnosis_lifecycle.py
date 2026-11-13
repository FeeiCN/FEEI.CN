"""Keep one current diagnosis per workflow, with independently verified recovery."""
import base64
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from actions_failure_diagnosis import eligible, gh, pages, workflow_marker, redact

BOT = 'github-actions[bot]'
STATE = '<!-- actions-diagnosis-state:'
PAUSED = 'diagnosis:paused'


class UnverifiedRecovery(ValueError):
    """A valid investigation whose recovery claim lacks sufficient evidence."""


def workflow_path(run):
    return run['path'].split('@')[0]


def trusted(run, repo):
    return ((run.get('repository') or {}).get('full_name', '').lower() == repo.lower()
            and (run.get('head_repository') or {}).get('full_name', '').lower() == repo.lower()
            and run.get('head_branch') == 'main')


def state(body):
    matches = re.findall(re.escape(STATE) + r'([A-Za-z0-9+/=]+) -->', body or '')
    if len(matches) != 1:
        return None
    try:
        value = json.loads(base64.b64decode(matches[0], validate=True))
        if (value.get('version') != 2 or value.get('state') not in {'active', 'uncertain', 'recovered'}
                or not re.fullmatch(r'[a-z0-9_-]{1,100}', value.get('fault_key', ''))
                or not isinstance(value.get('attempts'), list)
                or not all(isinstance(pair, list) and len(pair) == 2 and all(type(n) is int and n > 0 for n in pair) for pair in value['attempts'])):
            return None
        return value
    except (ValueError, TypeError):
        return None


def comment_digest(comment):
    return hashlib.sha256(json.dumps([comment.get('body'), comment.get('updated_at'), comment.get('user', {}).get('login')], sort_keys=True).encode()).hexdigest()


def issue_snapshot(issue, comments):
    return hashlib.sha256(json.dumps([issue.get('body'), issue.get('state'), issue.get('updated_at'),
                                     [(c['id'], c.get('body'), c.get('updated_at')) for c in comments]],
                                    sort_keys=True).encode()).hexdigest()


def inventory(repo):
    groups = {}
    for issue in pages(f'repos/{repo}/issues?state=all&creator=github-actions%5Bbot%5D'):
        marker = re.match(r'<!-- actions-failure-workflow:([a-f0-9]{20}) -->', issue.get('body') or '')
        if 'pull_request' in issue or issue.get('user', {}).get('login') != BOT or not marker:
            continue
        # Closed issues are a durable receipt, not new work.
        comments = pages(f'repos/{repo}/issues/{issue["number"]}/comments')
        entries = [{'body': issue['body'], 'endpoint': f'repos/{repo}/issues/{issue["number"]}', 'user': issue['user']}]
        entries += [{**c, 'endpoint': f'repos/{repo}/issues/comments/{c["id"]}'} for c in comments]
        managed = [(entry, state(entry.get('body'))) for entry in entries if entry.get('user', {}).get('login') == BOT]
        managed = [(entry, value) for entry, value in managed if value]
        groups.setdefault(marker[1], []).append({
            'number': issue['number'], 'state': issue['state'], 'body': issue['body'],
            'paused': any(label['name'] == PAUSED for label in issue.get('labels', [])),
            'snapshot': issue_snapshot(issue, comments),
            'comments': {str(c['id']): comment_digest(c) for c in comments},
            'managed': {'endpoint': managed[-1][0]['endpoint'], 'body': managed[-1][0]['body'], 'value': managed[-1][1]} if managed else None,
        })
    return groups


def latest_run(repo, path):
    # A green job in another matrix or workflow is not recovery evidence.
    for run in gh(f'repos/{repo}/actions/workflows/{quote(path.rsplit("/", 1)[-1])}/runs?branch=main&per_page=30')['workflow_runs']:
        if trusted(run, repo) and run.get('status') == 'completed' and run.get('conclusion') in {'failure', 'timed_out', 'success'}:
            return run
    return None


def collect(repo, target=''):
    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ')
    workflows = pages(f'repos/{repo}/actions/workflows', 'workflows')
    runs = []
    if target:
        if not re.fullmatch(r'[1-9]\d*', target):
            raise ValueError('运行编号无效')
        runs = [gh(f'repos/{repo}/actions/runs/{target}')]
    else:
        for page in range(1, 11):
            batch = gh(f'repos/{repo}/actions/runs?branch=main&created=%3E%3D{since}&per_page=100&page={page}')['workflow_runs']
            runs.extend(batch)
            if len(batch) < 100:
                break
    groups = inventory(repo)
    candidates = {}
    for run in runs:
        if eligible(run, repo):
            candidates.setdefault(workflow_path(run), []).append(run)
    # Existing open incidents still need review when the initial failure ages out of the scan window.
    for issues in groups.values():
        for issue in issues:
            if issue['state'] != 'open' or issue['paused']:
                continue
            match = re.search(r'<!-- actions-(?:codex|failure)-run:(\d+):attempt:', issue['body'])
            if match:
                identifier = max(issue['managed']['value']['attempts'])[0] if issue['managed'] and issue['managed']['value']['attempts'] else match[1]
                run = gh(f'repos/{repo}/actions/runs/{identifier}')
                if eligible(run, repo):
                    candidates.setdefault(workflow_path(run), []).append(run)
    failures, historical, paused = [], [], []
    for path, related in candidates.items():
        related = sorted({(r['id'], r['run_attempt']): r for r in related}.values(), key=lambda r: (r['created_at'], r['id']))
        run = related[-1]
        issues = groups.get(re.search(r':([a-f0-9]{20})', workflow_marker(run))[1], [])
        if any(issue['paused'] and issue['state'] == 'open' for issue in issues):
            paused.append({'path': path, 'issues': [issue['number'] for issue in issues if issue['state'] == 'open']})
            continue
        latest = latest_run(repo, path)
        active = [issue for issue in issues if issue['state'] == 'open']
        receipts = [issue['managed']['value'] for issue in issues if issue['managed']]
        handled = any([run['id'], run['run_attempt']] in value['attempts'] for value in receipts)
        if latest and latest['conclusion'] == 'success' and not active:
            historical.append({'path': path, 'failure': run['html_url'], 'later_success': latest['html_url']})
            continue
        latest_pair = [latest['id'], latest['run_attempt']] if latest else None
        unchanged = any(value.get('checked_run') == latest_pair for value in receipts)
        if handled and len(active) <= 1 and (unchanged or not latest or latest['conclusion'] != 'success') and not target:
            continue
        if not active and handled and not target:
            continue
        failures.append({**run, 'latest_run': latest, 'diagnosis_issues': issues,
                         'related_attempts': [[r['id'], r['run_attempt']] for r in related]})
    return {'version': 2, 'repository': repo, 'workflows': workflows, 'failures': failures,
            'issues': groups, 'historical': historical, 'paused': paused,
            'scope': f'main 最近7天最多1000次运行，实际读取 {len(runs)} 次；另检查现有故障 Issue，每个 workflow 只调查最新失败。',
            'recent_runs': [{k: r.get(k) for k in ['id', 'name', 'path', 'conclusion', 'head_sha', 'created_at']} for r in runs]}


def validate(result, context):
    paths = [workflow_path(run) for run in context['failures']]
    if len(set(paths)) != len(paths):
        raise ValueError('同一 workflow 必须先聚合后再交付')
    for finding in result['findings']:
        if set(finding) != {'run_id', 'report_markdown', 'fault_key', 'state', 'resolution'}:
            raise ValueError('缺少故障状态或验证依据')
        if finding['state'] not in {'active', 'uncertain', 'recovered'} or not isinstance(finding['fault_key'], str) or not re.fullmatch(r'[a-z0-9_-]{1,100}', finding['fault_key']):
            raise ValueError('故障状态或稳定原因标识无效')
        proof = finding['resolution']
        if (not isinstance(proof, dict) or set(proof) != {'run_id', 'fix_commit', 'jobs', 'explanation'}
                or type(proof['run_id']) is not int or not isinstance(proof['jobs'], list)
                or not all(isinstance(name, str) and name for name in proof['jobs'])
                or not isinstance(proof['fix_commit'], str) or not isinstance(proof['explanation'], str)):
            raise ValueError('恢复证据格式无效')
        if finding['state'] == 'recovered' and (proof['run_id'] <= 0 or not proof['jobs'] or not proof['explanation'].strip()):
            raise ValueError('恢复必须给出覆盖原失败条件的成功作业与具体依据')


def verify_recovery(repo, original, finding):
    proof = finding['resolution']
    run = gh(f'repos/{repo}/actions/runs/{proof["run_id"]}')
    if (not trusted(run, repo) or workflow_path(run) != workflow_path(original)
            or run.get('status') != 'completed' or run.get('conclusion') != 'success'
            or run['created_at'] <= original['created_at']):
        raise UnverifiedRecovery('恢复验证不是同一 workflow 后续成功运行')
    failed_jobs = pages(f'repos/{repo}/actions/runs/{original["id"]}/attempts/{original["run_attempt"]}/jobs', 'jobs')
    jobs = pages(f'repos/{repo}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs', 'jobs')
    failed = {job['name'] for job in failed_jobs if job.get('conclusion') in {'failure', 'timed_out'}}
    passed = {job['name'] for job in jobs if job.get('conclusion') == 'success'}
    if not failed or not failed.issubset(set(proof['jobs'])) or not set(proof['jobs']).issubset(passed):
        raise UnverifiedRecovery('成功验证未覆盖原失败作业；不同矩阵任务不能互相证明恢复')
    if proof['fix_commit']:
        if not re.fullmatch(r'[a-f0-9]{40}', proof['fix_commit']):
            raise UnverifiedRecovery('修复提交必须为完整 SHA')
        for index, (base, head) in enumerate([(original['head_sha'], proof['fix_commit']), (proof['fix_commit'], run['head_sha'])]):
            comparison = gh(f'repos/{repo}/compare/{base}...{head}')
            if comparison.get('status') not in ({'ahead'} if index == 0 else {'ahead', 'identical'}):
                raise UnverifiedRecovery('验证版本未包含原失败版本及修复提交')
    latest = latest_run(repo, workflow_path(original))
    if not latest or latest['conclusion'] != 'success' or latest['created_at'] < run['created_at']:
        raise UnverifiedRecovery('恢复验证后又出现失败，不能关闭故障')
    return run


def body_for(run, finding, attempts, duplicates):
    value = {'version': 2, 'state': finding['state'], 'fault_key': finding['fault_key'], 'attempts': sorted(attempts)[-1000:],
             'checked_run': [run['latest_run']['id'], run['latest_run']['run_attempt']] if run.get('latest_run') else None}
    encoded = base64.b64encode(json.dumps(value, separators=(',', ':')).encode()).decode()
    links = '\n'.join(f'- [历史诊断 #{number}](https://github.com/{os.environ["GITHUB_REPOSITORY"]}/issues/{number})' for number in duplicates)
    proof = finding['resolution']
    evidence = ''
    if finding['state'] == 'recovered':
        evidence = f'\n\n恢复验证：运行 {proof["run_id"]}；作业：' + '、'.join(proof['jobs']) + '\n' + proof['explanation']
    body = (workflow_marker(run) + f'\n<!-- actions-codex-run:{run["id"]}:attempt:{run["run_attempt"]} -->\n'
            + STATE + encoded + f' -->\n\n运行：[{run["id"]}]({run["html_url"]})\n\n' + finding['report_markdown'] + evidence
            + ('\n\n<details>\n<summary>历史诊断</summary>\n\n' + links + '\n\n</details>' if links else '')
            + '\n\n仅调查与维护故障状态，未自动修改目标任务、重跑或部署。\n')
    if len(body.encode()) > 60000:
        raise ValueError('聚合报告过长，保留运行产物并停止发布')
    return body


def check_snapshot(repo, issue, expected_body=None, merge_message=None, recovered=False, expected_marker=None):
    current = gh(f'repos/{repo}/issues/{issue["number"]}')
    comments = pages(f'repos/{repo}/issues/{issue["number"]}/comments')
    if (current.get('user', {}).get('login') != BOT or 'pull_request' in current
            or (expected_marker and not (current.get('body') or '').startswith(expected_marker))):
        raise ValueError('诊断 Issue 来源变化，停止交付')
    if any(label['name'] == PAUSED for label in current.get('labels', [])):
        raise ValueError('调查期间本人暂停了诊断，停止交付')
    unchanged = issue_snapshot(current, comments) == issue['snapshot']
    matched = [entry for entry in [{'body': current.get('body'), 'endpoint': f'repos/{repo}/issues/{issue["number"]}', 'user': current['user']}] + [
        {**c, 'endpoint': f'repos/{repo}/issues/comments/{c["id"]}'} for c in comments]
        if entry.get('user', {}).get('login') == BOT and expected_body and entry.get('body') == expected_body]
    merged = any(c.get('user', {}).get('login') == BOT and merge_message and c.get('body') == merge_message for c in comments)
    if not unchanged:
        baseline = issue.get('comments')
        present = {str(c['id']) for c in comments}
        own_retry = (baseline is not None and set(baseline).issubset(present)
                     and current.get('body') in [issue['body'], expected_body]
                     and (current['state'] == issue['state'] or (current['state'] == 'closed' and ((recovered and matched) or merged))))
        for comment in comments:
            identifier = str(comment['id'])
            if baseline is not None and baseline.get(identifier) == comment_digest(comment):
                continue
            allowed = [body for body in [expected_body, merge_message] if body]
            if comment.get('user', {}).get('login') != BOT or comment.get('body') not in allowed:
                own_retry = False
        if not own_retry:
            raise ValueError('诊断 Issue 在调查期间变化，停止覆盖或关闭')
    return {'state': current['state'], 'matched': matched[-1] if matched else None, 'merged': merged}


def publish(context, result):
    repo = os.environ['GITHUB_REPOSITORY']
    if context['repository'] != repo:
        raise ValueError('交付仓库不匹配')
    plans = []
    fresh_groups = None
    for finding in result['findings']:
        original = next(r for r in context['failures'] if r['id'] == finding['run_id'])
        run = gh(f'repos/{repo}/actions/runs/{original["id"]}')
        if not eligible(run, repo) or any(run[k] != original[k] for k in ['run_attempt', 'head_sha', 'path']):
            raise ValueError('失败来源或尝试版本变化，停止交付')
        issues = original['diagnosis_issues']
        active = sorted([issue for issue in issues if issue['state'] == 'open'], key=lambda issue: issue['number'])
        if any(issue['paused'] for issue in active):
            continue
        attempts = {tuple(pair) for pair in original['related_attempts']}
        for issue in original['diagnosis_issues']:
            if issue['managed']:
                attempts.update(tuple(pair) for pair in issue['managed']['value']['attempts'])
        if not active and finding['state'] != 'recovered':
            if fresh_groups is None:
                fresh_groups = inventory(repo)
            key = re.search(r':([a-f0-9]{20})', workflow_marker(original))[1]
            fresh = sorted([issue for issue in fresh_groups.get(key, []) if issue['state'] == 'open'], key=lambda issue: issue['number'])
            if fresh:
                expected = body_for(original, finding, attempts, [issue['number'] for issue in issues])
                if len(fresh) != 1 or not fresh[0]['managed'] or fresh[0]['managed']['body'] != expected:
                    raise ValueError('调查后已有新的故障 Issue，停止重复建单并等待重新核验')
                active = fresh
        if finding['state'] == 'recovered':
            try:
                verify_recovery(repo, original, finding)
            except UnverifiedRecovery as error:
                finding = json.loads(json.dumps(finding))
                finding['state'] = 'uncertain'
                finding['resolution'] = {'run_id': 0, 'fix_commit': '', 'jobs': [], 'explanation': str(error)}
                finding['report_markdown'] = ('恢复证据未通过程序核验，保持待验证，暂不关闭。\n\n'
                    + str(error) + '\n\n<details>\n<summary>原调查判断（待核验）</summary>\n\n'
                    + finding['report_markdown'] + '\n\n</details>')
        elif not active:
            latest = latest_run(repo, workflow_path(original))
            if latest and latest['conclusion'] == 'success':
                continue  # Historical failures never create new incidents after a later success.
        duplicates = [issue['number'] for issue in issues if not active or issue['number'] != active[0]['number']]
        body = body_for(original, finding, attempts, duplicates)
        merge_message = f'重复诊断已归并至 #{active[0]["number"]}；原报告和讨论保留，后续在该 Issue 跟进。' if active else ''
        for index, issue in enumerate(active):
            issue['live'] = check_snapshot(repo, issue, expected_body=body if index == 0 else None,
                                           merge_message=merge_message if index else None,
                                           recovered=finding['state'] == 'recovered',
                                           expected_marker=workflow_marker(original)) or {}
        plans.append((original, finding, active, body, merge_message))
    summary = [result['coverage']]
    for original, finding, active, body, merge_message in plans:
        canonical = active[0] if active else None
        if finding['state'] == 'recovered' and not canonical:
            continue
        prior = canonical.get('managed') if canonical else None
        if canonical:
            if canonical['live'].get('matched'):
                pass  # A validated artifact replay has already delivered this exact summary.
            elif prior and prior['value']['fault_key'] == finding['fault_key'] and prior['value']['state'] == finding['state']:
                if prior['body'] != body:
                    gh(prior['endpoint'], 'PATCH', {'body': body})
            else:
                gh(f'repos/{repo}/issues/{canonical["number"]}/comments', 'POST', {'body': body})
            number = canonical['number']
        else:
            response = gh(f'repos/{repo}/issues', 'POST', {'title': 'Actions 失败诊断：' + original['name'][:150], 'body': body})
            number = response['number']
        for duplicate in active[1:]:
            if duplicate['live'].get('state') == 'closed':
                continue
            if not duplicate['live'].get('merged'):
                gh(f'repos/{repo}/issues/{duplicate["number"]}/comments', 'POST', {'body': merge_message})
            gh(f'repos/{repo}/issues/{duplicate["number"]}', 'PATCH', {'state': 'closed', 'state_reason': 'not_planned'})
        if finding['state'] == 'recovered' and canonical['live'].get('state') != 'closed':
            gh(f'repos/{repo}/issues/{number}', 'PATCH', {'state': 'closed', 'state_reason': 'completed'})
        summary.append(f'- {workflow_path(original)}：{finding["state"]} · https://github.com/{repo}/issues/{number}')
    summary += [f'- 历史失败（未新建 Issue）：{entry["failure"]}；后续成功：{entry["later_success"]}' for entry in context['historical']]
    summary += [f'- 已暂停，未处理：{entry["path"]}' for entry in context['paused']]
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(redact('\n'.join(summary)) + '\n')
