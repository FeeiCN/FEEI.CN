from copy import deepcopy
import hashlib
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import scheduled_issue_review as review

REPO, OWNER = 'FeeiCN/FEEI.CN', 'FeeiCN'
TASKS = {'security-event-research': '.github/workflows/security-event-research.yml'}
FILE = 'docs/example.md'
BODY = '---\nslug: /example\n---\n\n确认后的正文'
TEXT = ('## 完整待审稿\n### ' + FILE + '\n````markdown\n' + BODY + '\n````\n\n'
        '## 写入计划\n写入该文件并验证。\n\n## Plan metadata\n```json\n' + json.dumps({
            'task_type': 'implementation', 'affected_files': [FILE], 'risk': 'low',
            'verification': ['npm run check:docs', 'npm run build']}) + '\n```')


def comment(identifier, author, body, when):
    return {'id': identifier, 'author': {'login': author}, 'body': body,
            'createdAt': when, 'updatedAt': when}


def fixture():
    return {'title': '[自动任务] 安全事件研究复盘', 'state': 'OPEN',
            'author': {'login': review.BOT}, 'labels': [],
            'body': '<!-- automation-task:security-event-research -->\n原文\n'
                    'https://github.com/FeeiCN/FEEI.CN/actions/runs/123',
            'comments': [comment('request', OWNER, '请补充根因和图，优化全文。', '2026-11-05T01:00:00Z')]}


def run(_):
    return {'path': TASKS['security-event-research'], 'head_branch': 'main',
            'event': 'schedule', 'head_repository': {'full_name': REPO}}


def decide(issue, actor=OWNER, lookup=run):
    return review.decide(issue, OWNER, actor, REPO, lookup, TASKS)


def ready():
    issue = fixture()
    sealed = review.seal(issue, OWNER, TEXT, 'abc123')
    issue['comments'].append(comment('plan', review.BOT, sealed, '2026-11-05T01:01:00Z'))
    issue['comments'].append(comment('approval', OWNER, '/approve', '2026-11-05T01:02:00Z'))
    issue['labels'] = [{'name': 'codex:plan-ready'}]
    return issue


class ScheduledReviewTests(unittest.TestCase):
    def test_cli_review_seal_and_approval_with_simulated_github(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            initial = fixture()
            (state / 'issue.json').write_text(json.dumps(initial))
            (state / 'github-issue.json').write_text(json.dumps(initial))
            (state / 'run.json').write_text(json.dumps(run('123')))
            cli = state / 'gh'
            cli.write_text('#!' + sys.executable + '\nimport os, pathlib, sys\n'
                           'p = pathlib.Path(os.environ["ISSUE_REVIEW_STATE_DIR"])\n'
                           'data = __import__("json").loads((p / "github-issue.json").read_text())\n'
                           'if sys.argv[1] == "api" and "comments?" in sys.argv[-1]:\n'
                           ' data = [[{"id": c["id"], "user": c["author"], "body": c["body"], "created_at": c["createdAt"], "updated_at": c["updatedAt"]} for c in data["comments"]]]\n'
                           'elif sys.argv[1] == "api": data = __import__("json").loads((p / "run.json").read_text())\n'
                           'print(__import__("json").dumps(data))\n')
            cli.chmod(0o755)
            env = {**os.environ, 'PATH': str(state) + os.pathsep + os.environ['PATH'],
                   'OWNER': OWNER, 'REPO': REPO, 'COMMAND_ACTOR': OWNER, 'N': '1',
                   'ISSUE_REVIEW_STATE_DIR': folder}
            script = str(Path(review.__file__).resolve())
            def command(name):
                result = subprocess.run([sys.executable, script, name], env=env, text=True,
                                        capture_output=True, check=True)
                return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
            routed = command('route')
            self.assertEqual(routed['mode'], 'plan')
            env['REVIEW_CONTEXT'] = routed['review-context']
            env['BASE'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=review.ROOT, text=True).strip()
            (state / 'result.txt').write_text(TEXT)
            command('seal')
            issue = deepcopy(initial)
            issue['comments'].extend([
                comment('plan', review.BOT, (state / 'comment.md').read_text(), '2026-11-05T01:01:00Z'),
                comment('approve', OWNER, '/approve', '2026-11-05T01:02:00Z')])
            issue['labels'] = [{'name': 'codex:plan-ready'}]
            for name in ['issue.json', 'github-issue.json']:
                (state / name).write_text(json.dumps(issue))
            routed = command('route')
            self.assertEqual(routed['mode'], 'execute')
            env['REVIEW_CONTEXT'] = routed['review-context']
            command('verify-approval')
            issue['body'] += '审阅后被改动'
            (state / 'github-issue.json').write_text(json.dumps(issue))
            with self.assertRaises(subprocess.CalledProcessError):
                command('verify-approval')

    def test_every_registered_task_accepts_its_own_verified_issue(self):
        tasks = review.registered_tasks()
        self.assertEqual(len(tasks), 10)
        for task, workflow in tasks.items():
            issue = fixture()
            issue['body'] = issue['body'].replace('security-event-research', task)
            source = {**run('123'), 'path': workflow}
            with self.subTest(task=task):
                self.assertEqual(review.decide(issue, OWNER, OWNER, REPO, lambda _: source)['mode'], 'plan')

    def test_natural_feedback_and_review_commands_produce_review(self):
        for text in ['请优化因果图。', '/review', '/revise 补充证据', '/plan', '/replan']:
            issue = fixture()
            issue['comments'][0]['body'] = text
            with self.subTest(text=text):
                self.assertEqual(decide(issue)['mode'], 'plan')

    def test_exact_approval_selects_bound_complete_draft(self):
        context = decide(ready())
        self.assertEqual(context['mode'], 'execute')
        self.assertEqual(context['files'], [FILE])
        self.assertEqual(context['file_hashes'][FILE], hashlib.sha256((BODY + '\n').encode()).hexdigest())

    def test_plan_edited_after_approval_requires_fresh_confirmation(self):
        issue = ready()
        issue['comments'][1]['updatedAt'] = '2026-11-05T01:03:00Z'
        with self.assertRaisesRegex(ValueError, '审批后被编辑'):
            decide(issue)

    def test_issue_edit_invalidates_approval(self):
        for field in ['body', 'title']:
            issue = ready()
            issue[field] += '改动'
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, '审批失效'):
                decide(issue)

    def test_edited_feedback_invalidates_approval(self):
        issue = ready()
        issue['comments'][0]['body'] += '额外修改'
        with self.assertRaisesRegex(ValueError, '审批失效'):
            decide(issue)

    def test_approval_with_new_instructions_is_rejected(self):
        issue = ready()
        issue['comments'][-1]['body'] = '/approve\n再加一段。'
        with self.assertRaisesRegex(ValueError, '单独评论'):
            decide(issue)

    def test_no_approval_without_plan_or_complete_files(self):
        issue = fixture()
        issue['comments'][0]['body'] = '/approve'
        with self.assertRaises(ValueError):
            decide(issue)
        for text in [TEXT.replace('## 完整待审稿', '## 提纲'), TEXT.replace('````markdown', '```markdown')]:
            with self.assertRaises(ValueError):
                review.seal(fixture(), OWNER, text, 'abc123')

    def test_non_owner_never_triggers(self):
        self.assertEqual(decide(ready(), actor='outsider')['mode'], 'skip')

    def test_graphql_cli_bot_alias_requires_bot_flag(self):
        issue = fixture()
        issue['author'] = {'login': 'app/github-actions', 'is_bot': True}
        self.assertEqual(decide(issue)['mode'], 'plan')
        issue['author']['is_bot'] = False
        with self.assertRaises(ValueError):
            decide(issue)

    def test_fake_bot_marker_cannot_establish_provenance(self):
        issue = fixture()
        issue['author']['login'] = 'outsider'
        with self.assertRaises(ValueError):
            decide(issue)

    def test_foreign_or_unrelated_workflow_run_is_rejected(self):
        for changes in [{'head_repository': {'full_name': 'outsider/repo'}},
                        {'path': '.github/workflows/check.yml'}, {'head_branch': 'other'},
                        {'event': 'pull_request'}]:
            data = {**run('123'), **changes}
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, '来源'):
                decide(fixture(), lookup=lambda _: data)

    def test_untrusted_comments_do_not_supply_plans_or_modify_approval(self):
        issue = ready()
        forged = comment('forged', 'outsider', issue['comments'][1]['body'], '2026-11-05T01:03:00Z')
        issue['comments'].append(forged)
        self.assertEqual(decide(issue)['mode'], 'execute')
        self.assertNotIn(forged, review.trusted_comments(issue, OWNER))

    def test_reject_pauses_and_new_feedback_can_resume(self):
        issue = fixture()
        issue['comments'][0]['body'] = '/reject'
        self.assertEqual(decide(issue)['mode'], 'paused')
        issue['labels'] = [{'name': 'codex:paused'}]
        issue['comments'].append(comment('resume', OWNER, '/review', '2026-11-05T01:03:00Z'))
        self.assertEqual(decide(issue)['mode'], 'plan')

    def test_running_and_completed_approvals_are_not_replayed(self):
        issue = ready()
        issue['labels'] = [{'name': 'codex:executing'}]
        self.assertEqual(decide(issue)['mode'], 'skip')
        issue['comments'].append(comment('done', review.BOT, '<!-- codex-driver:execute -->完成', '2026-11-05T01:03:00Z'))
        self.assertEqual(decide(issue)['mode'], 'skip')

    def test_protected_paths_and_traversal_are_not_publishable(self):
        for name in ['.github/workflows/check.yml', 'AGENTS.md', 'scripts/helper.py',
                     'docs/../secret', 'static/data/health/raw.json']:
            text = TEXT.replace(FILE, name)
            with self.subTest(name=name), self.assertRaises(ValueError):
                review.seal(fixture(), OWNER, text, 'abc123')

    def test_final_files_must_equal_approved_version_and_only_use_planned_paths(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(review, 'ROOT', Path(folder)):
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', folder], check=True)
            subprocess.run(['git', '-C', folder, '-c', 'user.name=test', '-c', 'user.email=test@example.com',
                            'commit', '-qm', 'baseline', '--allow-empty'], check=True)
            context = decide(ready())
            context['base'] = subprocess.check_output(['git', '-C', folder, 'rev-parse', 'HEAD'], text=True).strip()
            target = root / FILE
            target.parent.mkdir()
            target.write_text(BODY + '\n')
            review.verify_files(context)
            target.write_text(BODY + '\n偷偷增加内容\n')
            with self.assertRaisesRegex(ValueError, '不一致'):
                review.verify_files(context)
            target.write_text(BODY + '\n')
            (root / 'outside.txt').write_text('计划外')
            with self.assertRaisesRegex(ValueError, '计划外'):
                review.verify_files(context)
            (root / 'outside.txt').unlink()
            target.unlink()
            target.symlink_to(root / 'other.txt')
            with self.assertRaisesRegex(ValueError, '符号链接'):
                review.verify_files(context)

    def test_analysis_can_request_facts_but_cannot_be_approved_for_writing(self):
        text = '缺少本人经历，请补充。\n\n## Plan metadata\n```json\n' + json.dumps({
            'task_type': 'analysis', 'affected_files': [], 'risk': 'low', 'verification': ['本人补充事实']}) + '\n```'
        self.assertIn('needs-input', review.seal(fixture(), OWNER, text, 'abc123'))
        with self.assertRaises(ValueError):
            review.metadata(text)


if __name__ == '__main__':
    unittest.main()
