#!/usr/bin/env python3
"""Bind owner review commands to a verified scheduled-task Issue and exact draft."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PLAN = '<!-- codex-driver:plan:'
BOT = 'github-actions[bot]'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def bot(author):
    return author.get('login') == BOT or (author.get('login') in {'github-actions', 'app/github-actions'} and
                                        author.get('is_bot', author.get('isBot', False)))


def registered_tasks():
    result = {}
    for path in (ROOT / '.github/workflows').glob('*.yml'):
        text = path.read_text()
        if 'uses: ./.github/workflows/automation-task.yml' not in text:
            continue
        match = re.search(r'^\s+task_id: ([a-z][a-z0-9-]*)\s*$', text, re.M)
        if match:
            result[match[1]] = str(path.relative_to(ROOT))
    return result


def task_source(issue, repo, runs, tasks=None):
    if not bot(issue.get('author', {})):
        raise ValueError('不是受支持的自动任务机器人 Issue')
    body = issue.get('body', '')
    match = re.match(r'<!-- automation-task:([a-z][a-z0-9-]*) -->', body)
    task = match[1] if match else None
    known = registered_tasks() if tasks is None else tasks
    if task not in known:
        raise ValueError('缺少已登记的定时任务标记')
    links = re.findall(r'https://github\.com/' + re.escape(repo) + r'/actions/runs/(\d+)(?!\d)', body)
    if len(set(links)) != 1:
        raise ValueError('缺少唯一的当前仓库任务运行链接')
    run = runs(links[0])
    if (run.get('path', '').split('@')[0] != known[task] or run.get('head_branch') != 'main'
            or run.get('head_repository', {}).get('full_name', '').lower() != repo.lower()
            or run.get('event') not in {'schedule', 'workflow_dispatch'}):
        raise ValueError('Issue 运行来源与定时任务 workflow 不一致')
    return task


def trusted_comments(issue, owner):
    return [c for c in issue.get('comments', [])
            if c.get('author', {}).get('login') == owner or bot(c.get('author', {}))]


def snapshot(issue, owner, exclude=None):
    return digest({
        'title': issue['title'], 'body': issue['body'],
        'owner_comments': [
            {k: c.get(k) for k in ['id', 'body', 'createdAt', 'updatedAt']}
            for c in issue.get('comments', [])
            if c.get('author', {}).get('login') == owner and c.get('id') != exclude
        ],
    })


def metadata(text, write=True):
    matches = re.findall(r'^## Plan metadata\s*\n```json\s*\n([\s\S]*?)\n```\s*$', text.strip(), re.M)
    if len(matches) != 1:
        raise ValueError('缺少唯一的 Plan metadata')
    value = json.loads(matches[0])
    paths = value.get('affected_files', [])
    if value.get('task_type') == 'analysis' and not write and not paths:
        return value
    if value.get('task_type') != 'implementation' or not paths:
        raise ValueError('写入计划必须列出具体内容文件')
    for name in paths:
        if (not isinstance(name, str) or '\\' in name or name.startswith('/')
                or '..' in PurePosixPath(name).parts
                or not name.startswith(('docs/', 'blog/', 'static/media/'))):
            raise ValueError('定时任务写入仅支持 docs/、blog/ 和 static/media/ 内的已审阅文件')
    return value


def draft_files(text, paths):
    blocks = re.findall(r'^### ([^\n]+)\n````(?:markdown|md|mdx|svg|text)\n([\s\S]*?)\n````[ \t]*$', text, re.M)
    if len(blocks) != len(paths) or {name for name, _ in blocks} != set(paths):
        raise ValueError('完整待审稿必须逐文件展示四反引号代码块，与 affected_files 一一对应')
    return {name: hashlib.sha256((body + '\n').encode()).hexdigest() for name, body in blocks}


def decide(issue, owner, actor, repo, runs, tasks=None):
    task = task_source(issue, repo, runs, tasks)
    context = {'task': task, 'scheduled': True, 'mode': 'skip', 'reason': ''}
    if actor != owner or issue.get('state') != 'OPEN':
        context['reason'] = '仅仓库本人可操作打开的任务 Issue'
        return context
    comments = trusted_comments(issue, owner)
    own = [c for c in comments if c.get('author', {}).get('login') == owner]
    if not own:
        return context
    request = own[-1]
    text = request['body'].strip()
    tokens = re.findall(r'^/(approve|review|revise|plan|replan|reject)(?:\s|$)', text, re.M)
    if not text:
        return context
    plans = [c for c in comments if bot(c.get('author', {})) and c['body'].startswith(PLAN)]
    plan = plans[-1] if plans else None
    # Ignore old commands when an Issue edit/manual rerun follows a delivered response.
    responses = [c for c in comments if bot(c.get('author', {})) and c['body'].startswith('<!-- codex-driver:')]
    if responses and max(c['createdAt'] for c in responses) >= request.get('updatedAt', request['createdAt']):
        return context
    if tokens == ['reject']:
        context['mode'] = 'paused'
        return context
    labels = {x['name'] for x in issue.get('labels', [])}
    if labels & {'codex:planning', 'codex:executing'}:
        context['reason'] = '任务正在处理，请等待完成后重新评论'
        return context
    if 'approve' in tokens:
        if tokens != ['approve'] or text != '/approve':
            raise ValueError('审批请单独评论 /approve；修改意见先单独发送并等待完整修订稿')
        if 'codex:plan-ready' not in labels or plan is None:
            raise ValueError('请先审阅完整修订稿与写入计划，再评论 /approve')
        match = re.match(r'<!-- codex-driver:plan:commit=([a-f0-9]+):review-source=([a-f0-9]{64}) -->', plan['body'])
        if match is None or match[2] != snapshot(issue, owner, request['id']):
            raise ValueError('正文或修改意见已变化，旧稿审批失效；请评论 /review 重新审阅')
        if plan.get('updatedAt', plan['createdAt']) >= request['createdAt']:
            raise ValueError('完整待审稿在审批后被编辑，请重新审阅并确认新版本')
        spec = metadata(plan['body'])
        context.update(mode='execute', source=match[2], base=match[1],
                       approval_id=request['id'], approval_digest=digest(request),
                       plan_id=plan['id'], plan_digest=digest(plan), files=spec['affected_files'],
                       file_hashes=draft_files(plan['body'], spec['affected_files']))
    else:
        context.update(mode='plan', source=snapshot(issue, owner))
    return context


def seal(issue, owner, text, base):
    spec = metadata(text, write=False)
    if spec['task_type'] == 'analysis':
        return '<!-- codex-driver:review:needs-input -->\n\n' + text + '\n\n请补充缺少的事实或正文，本轮尚无可批准的写入版本。'
    if not re.search(r'^## 完整待审稿\s*$', text, re.M):
        raise ValueError('定时任务必须展示完整待审稿后才能等待审批')
    draft_files(text, spec['affected_files'])
    body = (f'{PLAN}commit={base}:review-source={snapshot(issue, owner)} -->\n\n'
            + text + '\n\n---\n继续修改请直接评论或使用 `/revise`；确认本版完整正文及文件后，单独评论 `/approve` 写入 main；暂停使用 `/reject`。')
    if len(body.encode()) > 63000:
        raise ValueError('完整待审稿超出评论长度，不能截断后等待审批；请缩小本轮写入范围')
    return body


def read_comments(repo, number):
    pages = json.loads(subprocess.check_output(
        ['gh', 'api', '--paginate', '--slurp', f'repos/{repo}/issues/{number}/comments?per_page=100'], text=True))
    return [{'id': str(c['id']), 'author': {'login': c['user']['login']}, 'body': c.get('body') or '',
             'createdAt': c['created_at'], 'updatedAt': c['updated_at']}
            for page in pages for c in page]


def api_run(repo, run_id):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/actions/runs/{run_id}'], text=True))


def verify_files(context):
    base = context['base']
    paths = context['files']
    if subprocess.run(['git', 'diff', '--quiet', base, 'HEAD', '--', *paths], cwd=ROOT).returncode:
        raise ValueError('计划涉及文件已被 main 更新，请重新审阅')
    raw = subprocess.check_output(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd=ROOT)
    changed = []
    for item in raw.decode().split('\0'):
        if not item:
            continue
        if len(item) < 4 or 'R' in item[:2] or 'C' in item[:2]:
            raise ValueError('本轮不支持重命名或复制，请拆分明确计划')
        name = item[3:]
        if name not in paths or (ROOT / name).is_symlink():
            raise ValueError(f'发现计划外或符号链接文件：{name}')
        changed.append(name)
    if not changed:
        raise ValueError('没有与批准计划对应的内容变更')
    verify_content(context)


def verify_content(context):
    for name, expected in context['file_hashes'].items():
        path = ROOT / name
        if (path.is_symlink() or not path.resolve().is_relative_to(ROOT.resolve())
                or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected):
            raise ValueError(f'文件与已批准的完整版本不一致：{name}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['route', 'seal', 'verify', 'verify-approval', 'verify-consent'])
    args = parser.parse_args()
    state_dir = Path(os.environ.get('ISSUE_REVIEW_STATE_DIR', '/tmp'))
    issue = json.loads((state_dir / 'issue.json').read_text())
    owner, repo = os.environ['OWNER'], os.environ['REPO']
    def fresh_issue():
        data = json.loads(subprocess.check_output(
            ['gh', 'issue', 'view', os.environ['N'], '--repo', repo, '--json',
             'body,labels,author,state,title'], text=True))
        data['comments'] = read_comments(repo, os.environ['N'])
        return data
    if args.command == 'route':
        if not bot(issue.get('author', {})):
            print('scheduled-review=false')
            return
        issue['comments'] = read_comments(repo, os.environ.get('N') or os.environ.get('EVENT_ISSUE') or os.environ['MANUAL_ISSUE'])
        try:
            context = decide(issue, owner, os.environ['COMMAND_ACTOR'], repo,
                             lambda run_id: api_run(repo, run_id))
        except ValueError as error:
            context = {'scheduled': True, 'mode': 'skip', 'reason': str(error)}
        print('review-context=' + base64.b64encode(json.dumps(context).encode()).decode())
        issue['comments'] = trusted_comments(issue, owner)
        (state_dir / 'issue.json').write_text(json.dumps(issue, ensure_ascii=False))
        print('scheduled-review=true')
        print('mode=' + context['mode'])
        print('reason=' + context.get('reason', '').replace('\n', ' '))
    elif args.command == 'seal':
        text = (state_dir / 'result.txt').read_text()
        issue = fresh_issue()
        context = json.loads(base64.b64decode(os.environ['REVIEW_CONTEXT']))
        if context['source'] != snapshot(issue, owner):
            raise ValueError('审阅期间正文或本人意见发生变化，请重新评论 /review')
        (state_dir / 'comment.md').write_text(seal(issue, owner, text, os.environ['BASE']))
    else:
        context = json.loads(base64.b64decode(os.environ['REVIEW_CONTEXT']))
        fresh = fresh_issue()
        # The executing label replaces plan-ready after initial approval validation.
        fresh['labels'] = [x for x in fresh['labels'] if x['name'] != 'codex:executing'] + [{'name': 'codex:plan-ready'}]
        current = decide(fresh, owner, os.environ['COMMAND_ACTOR'], repo,
                         lambda run_id: api_run(repo, run_id))
        if current != context:
            raise ValueError('批准的 Issue、修订稿或审批已变化，停止写入')
        if args.command != 'verify-consent' and subprocess.run(['git', 'diff', '--quiet', context['base'], 'HEAD', '--', *context['files']], cwd=ROOT).returncode:
            raise ValueError('计划涉及文件已被 main 更新，请重新审阅')
        if args.command == 'verify':
            verify_files(context)
        elif args.command == 'verify-consent':
            verify_content(context)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'Issue 审阅失败：{error}')
