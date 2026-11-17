"""GitHub adapter for the shared conversation engine and fixed delivery actions."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import conversation as core
import scheduled_issue_review as legacy

ROOT = Path(__file__).resolve().parents[1]
STATE = Path('output/conversation')


def gh(*args):
    return subprocess.check_output(['gh', *map(str, args)], text=True, stderr=subprocess.PIPE)


def fetch_issue(repo, number):
    issue = json.loads(gh('issue', 'view', number, '--repo', repo, '--json',
                          'number,title,body,author,state,createdAt,updatedAt'))
    issue['comments'] = legacy.read_comments(repo, number)
    return issue


def human_body(issue):
    if issue.get('body', '').startswith('<!-- automation-task:daily-personal-record -->'):
        from daily_personal_record import without_sections
        return without_sections(issue['body']).strip()
    return issue.get('body', '').strip()


def issue_requests(issue, owner, edited=False):
    own = [c for c in legacy.trusted_comments(issue, owner) if c['author']['login'] == owner and c['body'].strip()]
    own.sort(key=lambda item: (item.get('updatedAt', item['createdAt']), item['createdAt'], item['id']))
    root_request = None
    if issue['author']['login'] == owner or edited and issue['body'].startswith('<!-- automation-task:daily-personal-record -->'):
        body = human_body(issue)
        title = issue['title'].strip()
        root_request = {'id': 'title:' + core.digest({'title': title, 'body': body}),
                        'author': {'login': owner}, 'body': title + ('\n\n' + body if body else ''),
                        'createdAt': issue.get('createdAt', ''), 'updatedAt': issue.get('updatedAt', '')}
    if root_request and edited:
        return own + [root_request]
    return ([root_request] if root_request else []) + own


def restore(issue, repo, owner, task, root=ROOT):
    session_id = f'{repo}/issues/{issue["number"]}'
    state, old_plan = core.initial_state(session_id), None
    legacy_plan = legacy.latest_request_and_plan(issue, owner)[1]
    candidates = []
    if core.TURN in issue['body']:
        fingerprint = re.search(r'<!-- report-sha256:([a-f0-9]{64}) -->', issue['body'])
        if not fingerprint:
            raise ValueError('首次会话报告缺少来源指纹')
        initial = core.read_turn(issue['body'], repo + '/reports/' + task + '/' + fingerprint[1])
        candidates.append((issue.get('createdAt', ''), 'turn', ({'id': 'report'}, initial)))
    if legacy_plan:
        candidates.append((legacy_plan.get('createdAt', issue.get('createdAt', '')), 'legacy', legacy_plan))
    for item in legacy.trusted_comments(issue, owner):
        state['messages'].append({'id': item['id'], 'role': 'user' if item['author']['login'] == owner else 'assistant',
                         'body': item['body'], 'created_at': item['createdAt']})
        if legacy.bot(item['author']) and core.TURN in item['body']:
            turn = core.read_turn(item['body'], session_id)
            if (not item['body'].startswith('<!-- codex-conversation:reply -->\n')
                    or item.get('updatedAt', item['createdAt']) != item['createdAt']
                    or turn['header'] or turn['footer'] not in {'', run_footer({'repository': repo, 'source_run': turn['source_run']})}):
                raise ValueError('会话回执被编辑或来自其他交付入口')
            candidates.append((item['createdAt'], 'turn', (item, turn)))
    for _, kind, value in sorted(candidates, key=lambda entry: entry[0]):
        if kind == 'legacy':
            contents = legacy.draft_contents(value['body'])
            if value.get('origin') == 'report':
                base = value['base']
            else:
                match = re.match(r'<!-- codex-driver:plan:commit=([a-f0-9]+):review-source=([a-f0-9]{64}) -->', value['body'])
                if not match:
                    raise ValueError('旧稿缺少可验证的版本封存信息')
                base = match[1]
            state['current_draft'] = core.draft_version(session_id, [{'path': name, 'content': content} for name, content in contents.items()],
                                       core.git_baselines(base, contents, root), base)
            old_plan = value
        else:
            item, turn = value
            if turn is None:
                continue
            if turn['draft']:
                core.issue_paths(list(core.files_mapping(turn['draft']['files'])))
                if core.git_baselines(turn['draft']['base'], core.files_mapping(turn['draft']['files']), root) != turn['draft']['baseline']:
                    raise ValueError('稿件基线与其来源提交不一致')
                old_plan = None
            elif turn['response']['action'] == 'revise' and turn['response']['has_changes']:
                old_plan = None
            state = core.advance(state, turn['response'], turn['draft'], turn['handled_requests'], turn['commit'], turn.get('execution'))
    return {**state, 'legacy_draft': old_plan}


def make_context(issue, repo, owner, actor, event=None, root=ROOT):
    if actor != owner:
        raise ValueError('仅仓库本人可推进此会话')
    if issue.get('state') not in {'OPEN', 'CLOSED'}:
        raise ValueError('Issue 状态不受支持')
    title = issue['title'].strip()
    if (title == '睡眠评分' or title.startswith(('http://', 'https://'))
            or re.fullmatch(r'\d{4}-\d{2}-\d{2}.*(?:上车|下车)', title)
            or issue['body'].startswith('<!-- history-life-journey:session:')):
        return None
    task = 'owner-issue' if issue['author']['login'] == owner else legacy.task_source(issue, repo, lambda number: legacy.api_run(repo, number))
    event = event or {}
    edited = event.get('action') == 'edited' and 'comment' not in event
    requests = issue_requests(issue, owner, edited)
    if not requests:
        return None
    request = requests[-1]
    if 'comment' in event and str(event['comment']['id']) != request['id']:
        return None
    if edited and event.get('issue') and (event['issue']['title'] != issue['title'] or human_body(event['issue']) != human_body(issue)):
        return None
    state = restore(issue, repo, owner, task, root)
    failed = state.get('last_execution')
    retrying = bool(failed and failed['state'] == 'failed' and failed['request'] == {
        'id': request['id'], 'hash': core.request_hash(request)})
    if state['handled_requests'].get(request['id']) == core.request_hash(request) and not retrying:
        unhandled = [item for item in requests if state['handled_requests'].get(item['id']) != core.request_hash(item)]
        if event.get('comment') or not unhandled:
            return None
        request = unhandled[-1]
    draft = state['current_draft']
    pending = []
    if draft and not state['legacy_draft']:
        pending = core.pending_requests(state, requests, request)
    allowed = core.confirmation_allowed(state)
    if state['legacy_draft']:
        allowed = legacy.confirmation_requested(issue, owner, request, state['legacy_draft'])
    signature = core.digest({'goal': {'title': title, 'body': human_body(issue)},
                             'requests': {item['id']: core.request_hash(item) for item in requests},
                             'draft': core.digest(draft), 'handled': state['handled_requests'], 'applied': state['applied']})
    return {**state, 'version': 1, 'repository': repo, 'issue_number': issue['number'], 'owner': owner,
            'task': task, 'write_scope': 'issue', 'request': request, 'requests': requests, 'pending_requests': pending,
            'source_issue': {'title': issue['title'], 'body': issue['body']},
            'source_run': os.environ.get('GITHUB_RUN_ID', ''),
            'goal': {'title': title, 'body': human_body(issue)}, 'input_hash': signature,
            'approval_confirmation_allowed': allowed,
            'retry_allowed': core.retry_allowed(state, requests, request),
            'base': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
            'event': event, 'actor': actor}


def check_fresh(context, root=ROOT):
    issue = fetch_issue(context['repository'], context['issue_number'])
    fresh = make_context(issue, context['repository'], context['owner'], context['actor'], context['event'], root)
    if (fresh is None or fresh['input_hash'] != context['input_hash']
            or any(fresh[key] != context[key] for key in ('session_id', 'task', 'write_scope',
                                                         'current_draft', 'legacy_draft', 'pending_requests',
                                                         'approval_confirmation_allowed', 'retry_allowed', 'last_execution', 'handled_requests', 'applied'))
            or {item['id']: core.request_hash(item) for item in fresh['requests']}
            != {item['id']: core.request_hash(item) for item in context['requests']}
            or core.request_hash(fresh['request']) != core.request_hash(context['request'])):
        raise ValueError('会话请求、当前稿件或处理结果已变化，停止本轮交付')
    return issue, fresh


def decision(context, result, issue=None):
    value = core.validate_response(result['response'], context)
    if result['draft']:
        core.validate_draft(context['session_id'], result['draft'])
        core.issue_paths(list(core.files_mapping(result['draft']['files'])))
        if result['draft']['base'] != context['base']:
            raise ValueError('交付稿件未绑定本轮执行版本')
        if core.files_mapping(value['files']) != core.files_mapping(result['draft']['files']):
            raise ValueError('交付稿件与本轮模型结果不一致')
    elif value['files']:
        raise ValueError('文件修改缺少封存稿件')
    action = value['action']
    if action == 'approve':
        old = context.get('legacy_draft')
        if old and old.get('origin') != 'report':
            expected = re.search(r'review-source=([a-f0-9]{64})', old['body'])[1]
            legacy.approval_source(issue, context['owner'], context['request'], old, expected)
    if action == 'regenerate':
        if context['task'] != 'update-weight-wallpaper' or not core.explicit_action(value['quote'], 'regenerate'):
            raise ValueError('重做仅支持本人明确要求使用固定模板的壁纸任务')
    return action


def enrich_context(context, directory):
    task = context['task']
    if task not in {'owner-issue', legacy.WEREAD_TASK, legacy.DIAGNOSIS_TASK}:
        history = legacy.read_task_history(context['repository'], task)
        history['related_tasks'] = legacy.related_task_history(context['repository'], task)
        (directory / 'history.json').write_text(json.dumps(history, ensure_ascii=False))
        context['history'] = {'path': str(directory / 'history.json'), 'scope': history['scope']}
        context['history_errors'] = history['errors']
        workflow = (ROOT / legacy.registered_tasks()[task]).read_text()
        match = re.search(r'^\s+prompt_source: (.+?)\s*$', workflow, re.M)
        context['task_prompt_source'] = match[1] if match else None
    if task == 'daily-personal-record':
        match = re.search(r'<!-- daily-personal-record:(\d{4})-(\d{2})-(\d{2}) -->', context['goal']['body'])
        if match:
            months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
            context['goal']['diary_target'] = f'docs/05-吴飞飞/02-年度总结/{match[1]}/{months[int(match[2])-1]}/{match[3]}.md'


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def outputs(**values):
    target = os.environ.get('GITHUB_OUTPUT')
    if target:
        with open(target, 'a') as stream:
            for key, value in values.items():
                stream.write(key + '=' + str(value).replace('\n', ' ') + '\n')


def run_footer(context):
    run = context.get('source_run', '')
    return f'运行：[Actions](https://github.com/{context["repository"]}/actions/runs/{run})' if re.fullmatch(r'[1-9][0-9]*', run) else ''


def post(context, body, root=ROOT):
    check_fresh(context, root)
    path = STATE / 'delivery.md'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    gh('issue', 'comment', context['issue_number'], '--repo', context['repository'], '--body-file', path)


def apply_files(context, draft, root):
    if core.baselines(root, core.files_mapping(draft['files'])) != draft['baseline']:
        raise ValueError('目标文件已被更新，需要审阅新的完整版本')
    for name, content in core.files_mapping(draft['files']).items():
        path = core.target_path(root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode())


def verify_written(draft, root):
    files = core.files_mapping(draft['files'])
    if core.baselines(root, files) != draft['file_hashes']:
        raise ValueError('实际文件与批准稿件不一致')
    raw = subprocess.check_output(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd=root).decode()
    for item in filter(None, raw.split('\0')):
        if len(item) < 4 or item[3:] not in files or 'R' in item[:2] or 'C' in item[:2]:
            raise ValueError('发现批准范围之外的改动')


def validate_workflows(files, root):
    paths = [name for name in files if name.startswith('.github/workflows/')]
    if paths:
        script = "const fs=require('fs'),yaml=require('js-yaml');for(const file of process.argv.slice(1)){const w=yaml.load(fs.readFileSync(file,'utf8'));if(!w||typeof w!=='object'||!w.on||!w.jobs)throw Error('Workflow 缺少 on 或 jobs: '+file)}"
        subprocess.run(['node', '-e', script, *paths], cwd=root, check=True)


def build(root, directory):
    log = directory / 'build.log'
    with log.open('w') as stream:
        status = subprocess.run(['npm', 'run', 'build'], cwd=root, stdout=stream, stderr=subprocess.STDOUT).returncode
    text = log.read_text()
    if status or '[SUCCESS]' not in text or '[WARNING]' in text:
        raise ValueError('生产构建失败或存在警告，未推送；详见构建附件')
    subprocess.run(['npm', 'run', 'check:docs'], cwd=root, check=True)


def execute_approved(context, result, root, directory):
    issue, _ = check_fresh(context, root)
    if decision(context, result, issue) != 'approve':
        raise ValueError('本轮没有批准写入')
    draft = context['current_draft']
    core.validate_draft(context['session_id'], draft)
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
        raise ValueError('写入工作区存在其他改动')
    if core.baselines(root, core.files_mapping(draft['files'])) == draft['file_hashes']:
        commit = context['applied'].get(draft['id']) or subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        return {'state': 'unchanged', 'commit': commit,
                'message': '目标文件已与当前稿件一致，本轮没有重复提交。'}
    apply_files(context, draft, root)
    validate_workflows(draft['file_hashes'], root)
    build(root, directory)
    verify_written(draft, root)
    check_fresh(context, root)
    subprocess.run(['git', 'add', '--', *draft['file_hashes']], cwd=root, check=True)
    subprocess.run(['git', '-c', 'user.name=FeeiCN[bot]', '-c', 'user.email=feei@feei.cn',
                    'commit', '-m', f'写入已批准稿件 (#{context["issue_number"]})'], cwd=root, check=True)
    for attempt in (1, 2):
        check_fresh(context, root)
        if core.baselines(root, core.files_mapping(draft['files'])) != draft['file_hashes']:
            raise ValueError('提交后的文件不再等于批准版本')
        pushed = subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=root, capture_output=True, text=True)
        if not pushed.returncode:
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
            from workflow_delivery import delivery_report
            report = delivery_report(list(draft['file_hashes']), context['repository'], 'done', commit, '',
                                     f'https://github.com/{context["repository"]}/actions/runs/{os.environ.get("GITHUB_RUN_ID", "")}',
                                     root=root, checks='批准版本、文档检查及无警告生产构建均已核验。')
            return {'state': 'done', 'commit': commit, 'message': report}
        if attempt == 2 or not re.search(r'non-fast-forward|fetch first', pushed.stderr):
            raise ValueError('推送失败，未确认写入 main')
        subprocess.run(['git', 'pull', '--rebase', 'origin', 'main'], cwd=root, check=True)
        build(root, directory)
    raise ValueError('写入没有完成')



def publish_result(context, directory, outcome, root=ROOT):
    result_path, receipt_path = directory / 'result.json', directory / 'receipt.json'
    receipt = None
    execution = None
    if outcome == 'success' and result_path.exists():
        result = json.loads(result_path.read_text())
        issue, _ = check_fresh(context, root)
        action = decision(context, result, issue)
        if action in {'approve', 'regenerate'}:
            execution = {'action': action, 'state': 'failed', 'draft_id': (context['current_draft'] or {}).get('id', ''),
                         'request': {'id': context['request']['id'], 'hash': core.request_hash(context['request'])}}
        if result['draft'] and core.git_baselines(context['base'], result['draft']['file_hashes'], root) != result['draft']['baseline']:
            raise ValueError('交付稿件基线与本轮执行提交不一致')
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            states = {'approve': {'done', 'unchanged', 'failed'}, 'regenerate': {'requested', 'failed'}}
            if action not in states or receipt['state'] not in states[action]:
                raise ValueError('执行回执与本轮动作不一致')
            if receipt['commit'] and not re.fullmatch(r'[a-f0-9]{40}', receipt['commit']):
                raise ValueError('执行回执缺少有效提交编号')
            if receipt['state'] == 'done' and not receipt['commit'] or receipt['state'] in {'failed', 'requested'} and receipt['commit']:
                raise ValueError('执行结果与提交状态不一致')
            execution['state'] = receipt['state']
            value = {'action': 'applied' if receipt['commit'] else 'answer',
                     'message': receipt['message'], 'files': [],
                     'draft_id': (context['current_draft'] or {}).get('id', ''),
                     'quote': '', 'has_changes': False, 'risk': 'low', 'verification': []}
            fulfilled = receipt['state'] != 'failed'
            label = 'done' if receipt['state'] in {'done', 'unchanged'} else 'discussing' if fulfilled else 'failed'
            if not fulfilled and action == 'approve':
                value['message'] += '原批准版本保留，可以直接回复“继续”重试。'
            body = core.render_turn(context if fulfilled else {**context, 'requests': []}, value,
                                    commit=receipt['commit'], execution=execution, footer=run_footer(context))
        elif action not in {'approve', 'regenerate'}:
            body = core.render_turn(context, result['response'], result['draft'], footer=run_footer(context))
            label = 'plan-ready' if result['draft'] else 'paused' if action in {'pause', 'clarify'} else 'discussing'
        else:
            body = None
    else:
        body = None
    if body is None:
        diagnostic = directory / 'validation.json'
        reason = json.loads(diagnostic.read_text()).get('error', '') if diagnostic.exists() else ''
        message = ('本轮未完成：' + reason + '。' if reason else '本轮执行未完成，请查看运行记录。')
        value = {'action': 'answer', 'message': message + '尚未确认写入或发布，原请求和稿件保留，可以继续处理。',
                 'files': [], 'draft_id': '', 'quote': '', 'has_changes': False, 'risk': 'low', 'verification': []}
        if execution and execution['action'] == 'approve':
            value['message'] += '原批准版本保留，可以直接回复“继续”重试。'
        body = core.render_turn({**context, 'requests': []}, value, execution=execution, footer=run_footer(context))
        label = 'failed'
    post(context, body, root)
    outputs(label=label)
    if receipt and receipt['state'] in {'done', 'unchanged'}:
        try:
            gh('issue', 'close', context['issue_number'], '--repo', context['repository'], '--reason', 'completed')
        except subprocess.CalledProcessError:
            print('内容已写入，但自动关闭 Issue 失败。', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'respond', 'publish', 'apply', 'regenerate'])
    parser.add_argument('--issue', type=int, default=int(os.environ.get('ISSUE_NUMBER') or '0'))
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    repo = os.environ['GITHUB_REPOSITORY']
    owner = repo.split('/')[0]
    if args.command == 'prepare':
        event_path = os.environ.get('GITHUB_EVENT_PATH')
        event = json.loads(Path(event_path).read_text()) if event_path else {}
        number = args.issue or (event.get('issue') or {}).get('number') or int((event.get('inputs') or {}).get('issue_number', '0'))
        if not number:
            raise ValueError('缺少 Issue 编号')
        context = make_context(fetch_issue(repo, number), repo, owner, os.environ['GITHUB_ACTOR'], event, args.root)
        if context is None:
            outputs(ready='false')
            return
        enrich_context(context, STATE)
        write_json(STATE / 'context.json', context)
        outputs(ready='true', issue=number, execution_sha=context['base'])
        return
    context = json.loads((STATE / 'context.json').read_text())
    if context['repository'] != repo or str(context['issue_number']) != str(args.issue):
        raise ValueError('产物与当前仓库或 Issue 不一致')
    if (context['owner'] != owner or context['actor'] != owner or os.environ['GITHUB_ACTOR'] != owner
            or os.environ.get('GITHUB_TRIGGERING_ACTOR', owner) != owner):
        raise ValueError('产物未绑定仓库本人')
    if args.command == 'respond':
        check_fresh(context, args.root)
        result = core.respond(context, STATE, args.root)
        issue, _ = check_fresh(context, args.root)
        action = decision(context, result, issue)
        outputs(action=action)
        return
    result_path = STATE / 'result.json'
    if args.command == 'publish':
        publish_result(context, STATE, os.environ.get('TURN_OUTCOME', ''), args.root)
        return
    result = json.loads(result_path.read_text())
    if args.command == 'apply':
        try:
            receipt = execute_approved(context, result, args.root, STATE)
        except Exception:
            write_json(STATE / 'receipt.json', {'state': 'failed', 'commit': '', 'message': '本轮写入未完成；请核对运行记录，尚未确认推送或部署成功。'})
            raise
        write_json(STATE / 'receipt.json', receipt)
    elif args.command == 'regenerate':
        issue, _ = check_fresh(context, args.root)
        if decision(context, result, issue) != 'regenerate':
            raise ValueError('没有核验通过的壁纸重做请求')
        request = context['request']
        gh('workflow', 'run', 'update-weight-wallpaper.yml', '--repo', repo, '--ref', 'main',
           '-f', 'review_issue=' + str(args.issue), '-f', 'review_comment=' + request['id'],
           '-f', 'review_request_digest=' + legacy.digest(request))
        write_json(STATE / 'receipt.json', {'state': 'requested', 'commit': '', 'message': '已请求使用固定模板重做壁纸，完成后在本议题交付临时下载附件。'})


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(f'会话处理未完成：{error}')
