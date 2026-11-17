"""Read legacy Issue drafts and verify task provenance, history and wallpaper requests."""
import base64
import hashlib
from html import unescape
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from datetime import date
from conversation import explicit_action, pure_confirmation


ROOT = Path(__file__).resolve().parents[1]



PLAN = '<!-- codex-driver:plan:'



REPORT_PLAN = '<!-- codex-driver:report-plan:'



BOT = 'github-actions[bot]'



WEREAD_TASK = 'weread-highlight'



WEREAD_WORKFLOW = '.github/workflows/sync-weread-highlights.yml'



DIAGNOSIS_TASK = 'actions-failure-diagnosis'



class ReviewFormatError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code



def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()



def bot(author):
    return author.get('login') == BOT or (author.get('login') in {'github-actions', 'app/github-actions'} and
                                        author.get('is_bot', author.get('isBot', False)))



def registered_tasks():
    result = {WEREAD_TASK: WEREAD_WORKFLOW}
    for path in (ROOT / '.github/workflows').glob('*.yml'):
        text = path.read_text()
        if 'uses: ./.github/workflows/automation-task.yml' not in text:
            continue
        match = re.search(r'^\s+task_id: ([a-z][a-z0-9-]*)\s*$', text, re.M)
        if match:
            result[match[1]] = str(path.relative_to(ROOT))
    return result



def legacy_weread_source(issue):
    body = issue.get('body', '')
    if not body.startswith('来源：'):
        return False
    fields = {}
    for name in ['bookmarkId', 'bookId', 'range']:
        matches = re.findall(r'^' + name + r'：`([^`\n]+)`\s*$', body, re.M)
        if len(matches) != 1:
            return False
        fields[name] = matches[0]
    if not re.fullmatch(r'\d+', fields['bookId']):
        return False
    bookmark = re.fullmatch(r'(\d+)_(\d+)_(\d+-\d+)', fields['bookmarkId'])
    if not bookmark or bookmark[1] != fields['bookId'] or bookmark[3] != fields['range']:
        return False
    jump = (f"weread://bestbookmark?bookId={fields['bookId']}&chapterUid={bookmark[2]}"
            f"&rangeStart={fields['range'].split('-')[0]}&rangeEnd={fields['range'].split('-')[1]}")
    if f'`{jump}`' not in body:
        return False
    quotes = re.findall(r'^最新划线：\s*\n\s*\n> ([^\n]+)', body, re.M)
    if len(quotes) != 1:
        return False
    try:
        data = json.loads((ROOT / 'static/data/reading/books' / fields['bookId'] / 'bookmarks.json').read_text())
    except (OSError, ValueError):
        return False
    if not isinstance(data, dict) or not isinstance(data.get('updated'), list):
        return False
    return any(
        str(item.get('bookId')) == fields['bookId']
        and item.get('bookmarkId') == fields['bookmarkId']
        and str(item.get('chapterUid')) == bookmark[2]
        and item.get('range') == fields['range']
        and re.sub(r'\s+', ' ', unescape(str(item.get('markText', '')))).strip() == quotes[0]
        for item in data.get('updated', []) if isinstance(item, dict)
    )



def task_source(issue, repo, runs, tasks=None):
    if not bot(issue.get('author', {})):
        raise ValueError('不是受支持的自动任务机器人 Issue')
    body = issue.get('body', '')
    diagnosis = re.match(r'<!-- actions-failure-workflow:([a-f0-9]{20}) -->\n<!-- actions-(?:codex|failure)-run:(\d+):attempt:(\d+)(?::version:\d+)? -->', body)
    if diagnosis:
        run = runs(diagnosis[2])
        workflow = run.get('path', '').split('@')[0]
        expected = hashlib.sha256(workflow.encode()).hexdigest()[:20]
        if (diagnosis[1] != expected or not workflow.startswith('.github/workflows/')
                or run.get('head_branch') != 'main'
                or run.get('head_repository', {}).get('full_name', '').lower() != repo.lower()
                or run.get('conclusion') not in {'failure', 'timed_out', 'cancelled', 'action_required'}
                or f'https://github.com/{repo}/actions/runs/{diagnosis[2]}' not in body):
            raise ValueError('失败诊断 Issue 的运行来源未通过核验')
        return DIAGNOSIS_TASK
    match = re.match(r'<!-- automation-task:([a-z][a-z0-9-]*) -->', body)
    if not match and legacy_weread_source(issue):
        return WEREAD_TASK
    task = match[1] if match else None
    known = registered_tasks() if tasks is None else tasks
    if task not in known:
        raise ValueError('Issue 来源未通过核验：缺少已登记的任务标记，且无法匹配仓库已同步的历史微信读书划线')
    if '<!-- codex-conversation:v1:' in body:
        from conversation import read_turn
        fingerprint = re.search(r'<!-- report-sha256:([a-f0-9]{64}) -->', body)
        if not fingerprint:
            raise ValueError('首次会话稿件缺少来源指纹')
        turn = read_turn(body, repo + '/reports/' + task + '/' + fingerprint[1])
        run_id = turn['source_run']
        if not re.fullmatch(r'[1-9][0-9]*', str(run_id)) or f'https://github.com/{repo}/actions/runs/{run_id}' not in body:
            raise ValueError('首次会话稿件缺少可验证的运行来源')
        body = f'https://github.com/{repo}/actions/runs/{run_id}'
    if task == 'daily-personal-record':
        from daily_personal_record import without_sections
        body = without_sections(body)
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



def approval_source(issue, owner, request, plan, expected):
    candidate = {**issue, 'comments': [c for c in issue.get('comments', []) if c['id'] != request['id']]}
    if snapshot(candidate, owner) == expected:
        return expected
    # Pure confirmations and standalone retries do not change the proposed files.
    for c in reversed(candidate['comments'][:]):
        if c['author']['login'] != owner or c['createdAt'] <= plan['createdAt']:
            continue
        text = c['body'].strip()
        if not confirmation_requested(issue, owner, c, plan) and not explicit_action(text, 'approve'):
            break
        candidate['comments'] = [item for item in candidate['comments'] if item['id'] != c['id']]
        if snapshot(candidate, owner) == expected:
            return expected
    raise ValueError('正文或修改意见已变化，旧稿审批失效；请评论“重新整理完整待审稿”，审阅新稿后再确认写入')



def content_paths(paths):
    if (not isinstance(paths, list) or not paths or not all(isinstance(name, str) for name in paths)
            or len(set(paths)) != len(paths)):
        raise ValueError('写入计划必须列出不重复的具体内容文件')
    for name in paths:
        if (not isinstance(name, str) or '\\' in name or name.startswith('/')
                or '..' in PurePosixPath(name).parts or str(PurePosixPath(name)) != name
                or not (name.startswith(('docs/', 'blog/', 'static/media/'))
                        or re.fullmatch(r'\.github/workflows/[a-zA-Z0-9_-]+\.ya?ml', name))):
            raise ValueError('写入仅支持 docs/、blog/、static/media/ 和 .github/workflows/ 内的已审阅文件')
    return paths



def metadata(text, write=True):
    matches = re.findall(r'^## Plan metadata\s*\n```json\s*\n([\s\S]*?)\n```\s*$', text.strip(), re.M)
    if len(matches) != 1:
        raise ReviewFormatError('metadata_missing', '缺少唯一的 Plan metadata')
    try:
        value = json.loads(matches[0])
    except json.JSONDecodeError as error:
        raise ReviewFormatError('metadata_invalid', 'Plan metadata 不是有效 JSON') from error
    if (not isinstance(value, dict)
            or set(value) != {'task_type', 'affected_files', 'risk', 'verification'}
            or not isinstance(value['task_type'], str) or not isinstance(value['risk'], str)
            or value['task_type'] not in {'analysis', 'discussion', 'implementation'}
            or value['risk'] not in {'low', 'medium', 'high'}
            or not isinstance(value['verification'], list) or not value['verification']
            or any(not isinstance(item, str) or not item.strip() for item in value['verification'])):
        raise ReviewFormatError('metadata_invalid', 'Plan metadata 字段、任务类型、风险或验证项无效')
    paths = value.get('affected_files', [])
    if not isinstance(paths, list):
        raise ReviewFormatError('metadata_invalid', 'affected_files 必须是仓库相对路径数组')
    if value.get('task_type') in {'analysis', 'discussion'} and not write and not paths:
        return value
    if value.get('task_type') != 'implementation' or not paths:
        raise ReviewFormatError('draft_paths_missing', '写入计划必须列出具体内容文件')
    content_paths(paths)
    if any(name.startswith('.github/workflows/') for name in paths) and value.get('risk') not in {'medium', 'high'}:
        raise ValueError('workflow 修改的 risk 至少为 medium')
    return value



def draft_contents(text):
    blocks = re.findall(r'^### ([^\n]+?)[ \t]*\n(?:[ \t]*\n)*````(?:markdown|md|mdx|svg|text|yaml|yml)\n([\s\S]*?)\n````[ \t]*$', text, re.M)
    if not blocks:
        return {}
    content_paths([name for name, _ in blocks])
    return {name: body + '\n' for name, body in blocks}



def draft_files(text, paths):
    blocks = draft_contents(text)
    if not blocks or set(blocks) != set(paths):
        raise ValueError('完整待审稿必须逐文件展示四反引号代码块，与 affected_files 一一对应')
    return {name: hashlib.sha256(body.encode()).hexdigest() for name, body in blocks.items()}



def seal_report(body, title, base):
    if not re.search(r'^## 完整待审稿\s*$', body, re.M):
        return body
    contents = draft_contents(body)
    if any(name.startswith('.github/workflows/') for name in contents):
        raise ValueError('workflow 修改必须在本人评论请求后展示待审版本，不支持自动报告直接发布')
    if not contents or not re.fullmatch(r'[a-f0-9]{40}', base):
        raise ValueError('首次待审稿缺少完整文件或有效的 main 基线')
    if REPORT_PLAN in body:
        raise ValueError('首次待审稿不能自带审批封存标记')
    body = readable_draft(body)
    value = {'version': 1, 'base': base, 'title': title,
             'body_sha256': hashlib.sha256(body.encode()).hexdigest(),
             'file_hashes': draft_files(body, list(contents))}
    encoded = base64.b64encode(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).decode()
    return body + REPORT_PLAN + encoded + ' -->\n'



def report_draft(issue):
    if not bot(issue.get('author', {})):
        return None
    body = issue.get('body', '')
    matches = list(re.finditer(re.escape(REPORT_PLAN) + r'([A-Za-z0-9+/=]+) -->\n?$', body, re.M))
    if len(matches) != 1 or body[matches[0].end():].strip():
        return None
    match = matches[0]
    try:
        value = json.loads(base64.b64decode(match[1], validate=True))
        if (set(value) != {'version', 'base', 'title', 'body_sha256', 'file_hashes'}
                or value['version'] != 1 or not re.fullmatch(r'[a-f0-9]{40}', value['base'])
                or value['title'] != issue['title']
                or hashlib.sha256(body[:match.start()].encode()).hexdigest() != value['body_sha256']
                or draft_files(body[:match.start()], list(value['file_hashes'])) != value['file_hashes']):
            return None
    except (ValueError, TypeError, KeyError):
        return None
    return {'id': 'report:' + value['body_sha256'], 'body': body, 'origin': 'report',
            'base': value['base'], 'file_hashes': value['file_hashes']}



def latest_request_and_plan(issue, owner):
    comments = trusted_comments(issue, owner)
    own = [c for c in comments if c['author']['login'] == owner]
    edited = os.environ.get('EVENT_ACTION') == 'edited'
    daily_edit = (edited and os.environ.get('COMMAND_ACTOR') == owner and bot(issue.get('author', {}))
                  and issue.get('body', '').startswith('<!-- automation-task:daily-personal-record -->'))
    if daily_edit or (not own and initial_owner_request(issue, owner)) or (
            edited and issue.get('author', {}).get('login') == owner
            and issue.get('title', '').strip()
            and issue.get('state') in {'OPEN', 'CLOSED'}):
        body = issue.get('body', '').strip()
        if daily_edit:
            from daily_personal_record import without_sections
            body = without_sections(body).strip()
        request_body = issue['title'].strip() + ('\n\n' + body if body else '')
        identity = digest({'title': issue['title'], 'body': body})
        prefix = 'edit:' if edited else 'title:'
        own = [{
            'id': f'{prefix}{identity}',
            'author': {'login': owner},
            'body': request_body,
            'createdAt': issue.get('createdAt', ''),
            'updatedAt': issue.get('updatedAt', issue.get('createdAt', '')),
        }]
    plans = [c for c in comments if bot(c['author']) and c['body'].startswith(PLAN)]
    return (own[-1] if own else None, plans[-1] if plans else report_draft(issue))



def confirmation_requested(issue, owner, request, plan):
    if not plan or not pure_confirmation(request['body']):
        return False
    if plan.get('createdAt', '') >= request['createdAt']:
        return False
    try:
        if plan.get('origin') != 'report':
            draft_files(plan['body'], metadata(plan['body'])['affected_files'])
    except ValueError:
        return False
    replies = [c for c in trusted_comments(issue, owner) if bot(c['author'])
               and c.get('updatedAt', c['createdAt']) < request['createdAt']
               and c['createdAt'] >= plan.get('createdAt', '')]
    prompt = replies[-1]['body'] if replies else plan['body']
    if prompt.startswith(PLAN) or plan.get('origin') == 'report' and not replies:
        prompt = prompt.rsplit('\n---\n', 1)[-1]
    else:
        try:
            if not prompt.startswith('<!-- codex-driver:review:reply -->') or draft_contents(prompt):
                return False
        except ValueError:
            return False
    return bool(re.search(r'确认|批准|可直接说', prompt) and re.search(r'写入|发布|提交', prompt))



def initial_owner_request(issue, owner):
    title = issue.get('title', '').strip()
    if (issue.get('author', {}).get('login') != owner or issue.get('state') != 'OPEN'
            or not title
            or title.startswith(('http://', 'https://', '/', '[自动任务]'))
            or title == '睡眠评分' or any(word in title for word in ('天气', '上车', '下车', '日记'))
            or issue.get('body', '').startswith('<!-- history-life-journey:session:')):
        return False
    return not any(c['author']['login'] == owner or
                   (bot(c['author']) and c['body'].startswith('<!-- codex-driver:'))
                   for c in trusted_comments(issue, owner))



def readable_draft(text):
    previews = []
    for name, content in draft_contents(text).items():
        if not name.endswith(('.md', '.mdx')):
            continue
        front = re.match(r'\A---\n([\s\S]*?)\n---\n', content)
        title = None
        if front:
            match = re.search(r'^title: *(.+)$', front[1], re.M)
            title = match[1].strip().strip('\"\'') if match else None
            content = content[front.end():].lstrip('\n')
        previews.append(('### ' + (title or PurePosixPath(name).stem) + '\n\n' + content).rstrip())
    if not previews:
        return text
    introduction = text.split('## 完整待审稿', 1)[0].strip()
    introduction = re.split(r'<details\b', introduction, maxsplit=1, flags=re.I)[0].strip()
    return ((introduction + '\n\n' if introduction else '')
            + '## 正文预览\n\n' + '\n\n---\n\n'.join(previews)
            + '\n\n<details>\n<summary>文件源码与写入计划（供核对）</summary>\n\n'
            + text + '\n\n</details>')



def seal(issue, owner, text, base, initial_approval=False):
    spec = metadata(text, write=False)
    if spec['task_type'] in {'analysis', 'discussion'}:
        if draft_contents(text):
            raise ReviewFormatError('draft_type_mismatch', '已展示仓库完整文件，必须使用 implementation 并列出 affected_files，不能作为普通讨论交付')
        if ('<!-- automation-task:daily-personal-record -->' in issue.get('body', '')
                and re.search(r'^## 完整(?:修订稿|待审稿)\s*$', text, re.M)):
            raise ValueError('日记完整稿必须提供逐文件待审版本，不能作为普通讨论稿交付')
        reply = re.sub(r'^## Plan metadata\s*\n```json\s*\n[\s\S]*?\n```\s*$', '', text, flags=re.M).strip()
        kind = 'needs-input' if spec['task_type'] == 'analysis' else 'reply'
        body = f'<!-- codex-driver:review:{kind} -->\n\n{reply}'
        if len(body.encode()) > 63000:
            raise ValueError('回复超出评论长度，请缩小本轮讨论范围')
        return body
    if not re.search(r'^## 完整待审稿\s*$', text, re.M):
        raise ReviewFormatError('draft_heading_missing', '仓库待写入版本必须展示 ## 完整待审稿 后才能等待审批')
    draft_files(text, spec['affected_files'])
    notice = ('本次先整理完整待写入稿，尚未写入仓库。'
              '请审阅下方具体版本，确认后直接说明“这版可以，写入网站吧”。\n\n' if initial_approval else '')
    body = (f'{PLAN}commit={base}:review-source={snapshot(issue, owner)} -->\n\n'
            + notice + readable_draft(text) + '\n\n---\n继续修改、提问或暂停都可直接说明；确认本版完整正文及文件后，请明确说“这版可以，写入网站吧”。')
    if len(body.encode()) > 63000:
        raise ValueError('完整待审稿超出评论长度，不能截断后等待审批；请缩小本轮写入范围')
    return body



def read_comments(repo, number):
    pages = json.loads(subprocess.check_output(
        ['gh', 'api', '--paginate', '--slurp', f'repos/{repo}/issues/{number}/comments?per_page=100'], text=True))
    return [{'id': str(c['id']), 'author': {'login': c['user']['login']}, 'body': c.get('body') or '',
             'createdAt': c['created_at'], 'updatedAt': c['updated_at']}
            for page in pages for c in page]



def read_task_history(repo, task, comment_limit=10):
    def api(*args):
        return json.loads(subprocess.check_output(['gh', 'api', *args], text=True, stderr=subprocess.PIPE))

    errors = []
    try:
        found = api('search/issues', '--method', 'GET', '-f',
                    f'q=repo:{repo} is:issue in:body "automation-task:{task}"',
                    '-f', 'sort=updated', '-f', 'per_page=100')
        raw = found['items']
        scope = 'task_search_latest_100'
        if found.get('incomplete_results') or found.get('total_count', 0) > 100:
            scope += '_incomplete'
    except (subprocess.CalledProcessError, KeyError, ValueError):
        scope = 'repository_latest_100_fallback_incomplete'
        errors.append('任务搜索不可用，仅回退到最近 100 个议题')
        try:
            raw = api(f'repos/{repo}/issues?state=all&sort=updated&per_page=100')
        except (subprocess.CalledProcessError, ValueError):
            raw = []
            errors.append('历史议题读取失败，不能据此判断没有历史')
    marker = f'<!-- automation-task:{task} -->'
    owner = repo.split('/')[0]
    issues = []
    for original in raw:
        if (original.get('pull_request') or not (original.get('body') or '').startswith(marker)
                or not bot(original.get('user', {}))):
            continue
        match = re.fullmatch(r'https://github.com/' + re.escape(repo) + r'/issues/([1-9][0-9]*)', original.get('html_url', ''))
        if not match:
            continue
        item = {k: original.get(k) for k in ['html_url', 'title', 'body', 'state', 'created_at', 'updated_at']}
        item['comments_scope'] = 'not_fetched_outside_latest_10'
        if len(issues) < comment_limit:
            try:
                item['comments'] = trusted_comments({'comments': read_comments(repo, match[1])}, owner)
                item['comments_scope'] = 'all_owner_and_bot_comments'
            except (subprocess.CalledProcessError, ValueError, KeyError):
                item['comments_scope'] = 'unavailable'
                errors.append(f"{original['html_url']}: 评论读取失败")
        issues.append(item)
    return {'issues': issues, 'scope': scope, 'comments_scope': f'latest_{comment_limit}_issues_all_owner_and_bot_comments',
            'errors': errors}



def related_task_history(repo, task):
    peers = {'daily-reading-selection': 'weekly-reading-review',
             'weekly-reading-review': 'daily-reading-selection'}
    peer = peers.get(task)
    return {peer: read_task_history(repo, peer)} if peer else {}



def wallpaper_request(repo, number, comment_id, request_digest):
    if (not re.fullmatch(r'[1-9][0-9]*', str(number)) or not re.fullmatch(r'[1-9][0-9]*', str(comment_id))
            or not re.fullmatch(r'[a-f0-9]{64}', request_digest)):
        raise ValueError('壁纸重做请求参数无效')
    issue = json.loads(subprocess.check_output(
        ['gh', 'issue', 'view', str(number), '--repo', repo, '--json', 'body,labels,author,state,title'], text=True))
    issue['comments'] = read_comments(repo, number)
    owner = repo.split('/')[0]
    if task_source(issue, repo, lambda run_id: api_run(repo, run_id)) != 'update-weight-wallpaper':
        raise ValueError('仅支持体重壁纸任务原 Issue')
    own = [c for c in issue['comments'] if c['author']['login'] == owner]
    if (not own or own[-1]['id'] != str(comment_id) or not explicit_action(own[-1]['body'].strip(), 'regenerate')
            or digest(own[-1]) != request_digest):
        raise ValueError('壁纸请求已变化，请在原 Issue 重新评论“重新制作”')
    marker = f'<!-- automation-wallpaper:request:{comment_id} -->'
    if any(bot(c['author']) and c['body'].startswith(marker) for c in issue['comments']):
        raise ValueError('该壁纸请求已交付，不重复执行')
    return {'issue': str(number), 'comment_id': str(comment_id), 'request_digest': request_digest,
            'source': snapshot(issue, owner)}



def api_run(repo, run_id):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/actions/runs/{run_id}'], text=True))
