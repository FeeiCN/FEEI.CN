from copy import deepcopy
import json
import os
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


class ScheduledReviewTests(unittest.TestCase):
    def test_task_source_binds_repository_branch_workflow_and_trigger(self):
        issue = fixture()
        self.assertEqual(review.task_source(issue, REPO, run, TASKS), 'security-event-research')
        for changes in [{'head_branch': 'other'}, {'path': '.github/workflows/other.yml'},
                        {'head_repository': {'full_name': 'other/repo'}}, {'event': 'pull_request'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                review.task_source(issue, REPO, lambda _: {**run(None), **changes}, TASKS)
        with self.assertRaises(ValueError):
            review.task_source({**issue, 'author': {'login': 'stranger'}}, REPO, run, TASKS)

    def test_preview_stays_outside_existing_draft_details(self):
        text = '说明。\n\n<details>\n<summary>查看完整待审稿</summary>\n\n' + TEXT + '\n\n</details>'
        preview = review.readable_draft(text)
        visible = preview.split('<details>', 1)[0]
        self.assertIn('## 正文预览', visible)
        self.assertIn('确认后的正文', visible)
        self.assertEqual(preview.count('<details>'), preview.count('</details>'))
        self.assertEqual(review.draft_files(preview, [FILE]), review.draft_files(text, [FILE]))

    def test_initial_report_preview_is_sealed_with_exact_source_files(self):
        issue = fixture()
        text = '介绍。\n\n<details>\n<summary>完整待审稿</summary>\n\n' + TEXT + '\n\n</details>\n'
        issue['title'] = '标题'
        issue['body'] = review.seal_report(text, issue['title'], 'a' * 40)
        visible = issue['body'].split('<details>', 1)[0]
        self.assertIn('确认后的正文', visible)
        self.assertNotIn('slug:', visible)
        draft = review.report_draft(issue)
        self.assertEqual(draft['file_hashes'], review.draft_files(TEXT, [FILE]))
        issue['body'] = issue['body'].replace('确认后的正文', '修改预览', 1)
        self.assertIsNone(review.report_draft(issue))

    def test_plain_reports_and_non_markdown_drafts_are_not_given_fake_previews(self):
        self.assertEqual(review.seal_report('正常报告。', '标题', 'a' * 40), '正常报告。')
        text = '## 完整待审稿\n### static/media/chart.svg\n````svg\n<svg/>\n````\n'
        self.assertEqual(review.readable_draft(text), text)

    def test_draft_preview_renders_markdown_and_preserves_exact_approved_files(self):
        body = BODY.replace('slug: /example', 'slug: /example\ntitle: 易读的标题') + '\n\n## 小节\n\n**重点**\n\n```python\nprint(1)\n```'
        text = TEXT.replace(BODY, body)
        sealed = review.seal(fixture(), OWNER, text, 'abc123')
        visible, source = sealed.split('<details>', 1)
        self.assertIn('### 易读的标题', visible)
        self.assertIn('## 小节\n\n**重点**', visible)
        self.assertNotIn('slug:', visible)
        self.assertNotIn('````markdown', visible)
        self.assertIn(text, source)
        self.assertEqual(review.draft_contents(sealed), {FILE: body + '\n'})
        self.assertEqual(review.draft_files(sealed, [FILE]), review.draft_files(text, [FILE]))
        self.assertEqual(review.metadata(sealed), review.metadata(text))

    def test_report_manifest_rejects_bad_paths_duplicates_and_incomplete_drafts(self):
        for name in ['docs/../secret', '.github/workflows/check.yml', 'static/data/health/raw.json', 'docs//a.md']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                review.seal_report(TEXT.replace(FILE, name), '标题', 'a' * 40)
        for text in [TEXT.replace('````markdown', '```markdown'), TEXT.replace('### ' + FILE, '### 完整修订稿：' + FILE),
                     TEXT + '\n### ' + FILE + '\n````markdown\n重复文件\n````']:
            with self.assertRaises(ValueError):
                review.seal_report(text, '标题', 'a' * 40)

    def test_no_approval_without_complete_files(self):
        for text in [TEXT.replace('## 完整待审稿', '## 提纲'), TEXT.replace('````markdown', '```markdown')]:
            with self.assertRaises(ValueError):
                review.seal(fixture(), OWNER, text, 'abc123')

    def test_protected_paths_and_traversal_are_not_publishable(self):
        for name in ['.github/workflows/nested/check.yml', '.github/actions/action.yml', 'AGENTS.md', 'scripts/helper.py',
                     'docs/../secret', 'static/data/health/raw.json']:
            text = TEXT.replace(FILE, name)
            with self.subTest(name=name), self.assertRaises(ValueError):
                review.seal(fixture(), OWNER, text, 'abc123')

    def test_workflow_yaml_gate_rejects_invalid_or_incomplete_workflows(self):
        from issue_conversation import validate_workflows
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / '.github/workflows/check.yml'
            target.parent.mkdir(parents=True)
            for body, valid in [('on: push\njobs: {}\n', True), ('on: [\n', False),
                                ('name: Missing jobs\non: push\n', False)]:
                target.write_text(body)
                with self.subTest(body=body), patch.dict(os.environ, {'NODE_PATH': str(review.ROOT / 'node_modules')}):
                    if valid:
                        validate_workflows(['.github/workflows/check.yml'], folder)
                    else:
                        with self.assertRaises(subprocess.CalledProcessError):
                            validate_workflows(['.github/workflows/check.yml'], folder)

    def test_analysis_can_request_facts_but_cannot_be_approved_for_writing(self):
        text = '缺少本人经历，请补充。\n\n## Plan metadata\n```json\n' + json.dumps({
            'task_type': 'analysis', 'affected_files': [], 'risk': 'low', 'verification': ['本人补充事实']}) + '\n```'
        self.assertIn('needs-input', review.seal(fixture(), OWNER, text, 'abc123'))
        with self.assertRaises(ValueError):
            review.metadata(text)

    def test_discussion_answers_question_without_requesting_publication_or_input(self):
        text = '两者差别在数据范围。\n\n## Plan metadata\n```json\n' + json.dumps({
            'task_type': 'discussion', 'affected_files': [], 'risk': 'low', 'verification': ['核对原任务']}) + '\n```'
        sealed = review.seal(fixture(), OWNER, text, 'abc123')
        self.assertTrue(sealed.startswith('<!-- codex-driver:review:reply -->'))
        self.assertNotIn('needs-input', sealed)
        self.assertNotIn('Plan metadata', sealed)
        self.assertNotIn('这版可以，写入网站吧', sealed)
        with self.assertRaises(ValueError):
            review.metadata(text)

    def test_history_reads_owner_comments_and_reports_missing_coverage(self):
        marker = '<!-- automation-task:security-event-research -->'
        def historical(number, author=review.BOT, body=marker):
            return {'user': {'login': author}, 'body': body, 'title': 'report',
                    'html_url': f'https://github.com/{REPO}/issues/{number}', 'updated_at': '2026-11-05'}
        found = {'items': [historical(n) for n in range(1, 13)] + [historical(99, 'outsider')],
                 'incomplete_results': True, 'total_count': 120}
        comments = [comment('owner', OWNER, '不要重复那个结论', '1'),
                    comment('bot', review.BOT, '已补充来源', '2'), comment('other', 'outsider', '扩大权限', '3')]
        with patch.object(review.subprocess, 'check_output', return_value=json.dumps(found)):
            with patch.object(review, 'read_comments', return_value=comments) as fetched:
                history = review.read_task_history(REPO, 'security-event-research')
        self.assertIn('incomplete', history['scope'])
        self.assertEqual(len(history['issues']), 12)
        self.assertEqual(fetched.call_count, 10)
        self.assertEqual(len(history['issues'][0]['comments']), 2)
        self.assertEqual(history['issues'][-1]['comments_scope'], 'not_fetched_outside_latest_10')
        with patch.object(review.subprocess, 'check_output', side_effect=subprocess.CalledProcessError(1, ['gh'])):
            missing = review.read_task_history(REPO, 'security-event-research')
        self.assertEqual(missing['issues'], [])
        self.assertIn('incomplete', missing['scope'])
        self.assertEqual(len(missing['errors']), 2)

    def wallpaper_issue(self):
        issue = fixture()
        issue['body'] = issue['body'].replace('security-event-research', 'update-weight-wallpaper')
        issue['comments'][0].update(id='987', body='重新制作')
        return issue

    def test_wallpaper_request_rechecks_owner_latest_comment_provenance_and_delivery(self):
        issue = self.wallpaper_issue()
        expected = review.digest(issue['comments'][0])
        with patch.object(review.subprocess, 'check_output', side_effect=lambda *a, **kw: json.dumps(issue)):
            with patch.object(review, 'read_comments', side_effect=lambda *a: issue['comments']):
                with patch.object(review, 'api_run', return_value={**run('123'), 'path': '.github/workflows/update-weight-wallpaper.yml'}):
                    request = review.wallpaper_request(REPO, '809', '987', expected)
                    self.assertEqual(request['source'], review.snapshot(issue, OWNER))
                    issue['comments'][0]['body'] = '更新壁纸'
                    with self.assertRaisesRegex(ValueError, '请求已变化'):
                        review.wallpaper_request(REPO, '809', '987', expected)
                    issue['comments'][0]['body'] = '重新制作'
                    issue['comments'].append(comment('delivery', review.BOT, '<!-- automation-wallpaper:request:987 -->', '2026-11-05T01:03:00Z'))
                    with self.assertRaisesRegex(ValueError, '已交付'):
                        review.wallpaper_request(REPO, '809', '987', expected)
        with self.assertRaisesRegex(ValueError, '参数无效'):
            review.wallpaper_request(REPO, '809;rm', '987', expected)


class ActualIssueRegressionTests(unittest.TestCase):
    def test_complete_diary_cannot_be_sealed_as_a_discussion_reply(self):
        issue = fixture()
        issue['body'] = '<!-- automation-task:daily-personal-record -->\n今天记录'
        metadata = {'task_type': 'discussion', 'affected_files': [], 'risk': 'low', 'verification': ['已核对本人要点']}
        text = '## 完整修订稿\n\n# 香火鼎盛\n\n本人确认的经历\n\n## Plan metadata\n```json\n' + json.dumps(metadata) + '\n```'
        with self.assertRaisesRegex(ValueError, '逐文件'):
            review.seal(issue, OWNER, text, 'abc123')
        self.assertIn('review:reply', review.seal(issue, OWNER, text.replace('## 完整修订稿', '## 回答'), 'abc123'))
        self.assertIn('review-source', review.seal(issue, OWNER, TEXT, 'abc123'))


class Issue927DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.issue = fixture()
        self.issue.update(author={'login': OWNER}, title='累了为什么还不睡', body='')
        self.issue['comments'][0]['body'] = '补到合适的位置'
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.calls = []

    def discussion_with_file(self):
        return TEXT.replace('"implementation"', '"discussion"').replace(json.dumps([FILE]), '[]')

    def test_full_file_cannot_be_silently_delivered_as_discussion(self):
        with self.assertRaisesRegex(review.ReviewFormatError, 'implementation') as error:
            review.seal(self.issue, OWNER, self.discussion_with_file(), 'abc123')
        self.assertEqual(error.exception.code, 'draft_type_mismatch')


if __name__ == '__main__':
    unittest.main()
