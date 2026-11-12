import copy
import json
from pathlib import Path
import subprocess
import tempfile
import codex_runner as runner
import unittest
from unittest.mock import patch

import automation_tasks
import run_automation_task as writing


class WritingLoopTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict('os.environ', {'GITHUB_ACTIONS': 'false'})
        env.start()
        self.addCleanup(env.stop)
        stage_document = (writing.ROOT / writing.COMMON).read_text()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.out = self.root / 'output'
        self.out.mkdir()
        (self.out / 'prompt.md').write_text('documented task instructions')
        document = self.root / writing.COMMON
        document.parent.mkdir(parents=True)
        document.write_text(stage_document)
        for module in (writing, automation_tasks):
            override = patch.object(module, 'ROOT', self.root)
            override.start()
            self.addCleanup(override.stop)
        self.result = {
            'status': 'completed', 'report_markdown': '# 一个问题\n\n有来源的完整初稿。',
            'sources': ['https://example.com/a', 'https://example.com/b'], 'artifacts': [],
            'audit': {'summary': '核验两份来源', 'data_cutoff': '2026-11-07', 'deduplication_reason': '包含新增分析'},
        }
        self.brief = {'reader': '工程师', 'question': '为什么失效', 'takeaway': '理解机制', 'scope': '一个案例'}
        self.calls = []

    def draft(self, result=None):
        return {'brief': self.brief, 'result': copy.deepcopy(result or self.result)}

    def review(self, result=None, category=None, priority='improve'):
        return {
            'draft_sha256': writing.digest(result or self.result),
            'checks': {key: {'passed': key != category, 'evidence': '按正文与原始来源逐项核对'}
                       for key in writing.CHECKS},
            'findings': ([{'id': 'R1', 'category': category, 'priority': priority,
                           'location': '第二段', 'problem': '术语没有解释',
                           'requested_change': '用具体例子解释', 'acceptance': '能够区分两个动作'}]
                         if category else []),
            'summary': '已按写作目标复核',
        }

    def executor(self, *responses):
        sequence = iter(responses)

        def call(phase, prompt, schema):
            self.calls.append((phase, prompt))
            result = next(sequence)
            if isinstance(result, Exception):
                raise result
            return copy.deepcopy(result)
        return call

    def reading_history(self, comments=None, errors=None):
        (self.out / 'context.md').write_text(json.dumps({
            'history_errors': [], 'history_scope': 'task_search_latest_100',
            'history_search_urls': {'weekly-reading-review': 'https://github.com/owner/repo/issues?q=weekly',
                                    'daily-reading-selection': 'https://github.com/owner/repo/issues?q=daily'},
            'time_utc': '2026-11-07T12:00:00Z',
        }))
        (self.out / 'history.json').write_text('[]')
        (self.out / 'related-history.json').write_text(json.dumps({'daily-reading-selection': {
            'issues': [{'body': '已为你推荐文章', 'comments': comments or [],
                        'comments_scope': 'all_owner_and_bot_comments'}],
            'scope': 'task_search_latest_100', 'errors': errors or [],
        }}))

    def test_reading_review_without_owner_feedback_skips_model(self):
        self.reading_history([{'author': {'login': 'github-actions[bot]'}, 'body': '你已掌握这个知识'},
                              {'author': {'login': 'outsider'}, 'body': '我读完了'}])
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/repo'}):
            result = writing.execute('weekly-reading-review', self.out, self.executor())
        self.assertEqual(result['status'], 'no_update')
        self.assertEqual(self.calls, [])
        self.assertEqual(json.loads((self.out / 'result.json').read_text()), result)

    def test_reading_review_missing_history_is_blocked_instead_of_assuming_no_feedback(self):
        self.reading_history(errors=['评论读取失败'])
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/repo'}):
            result = writing.execute('weekly-reading-review', self.out, self.executor())
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(self.calls, [])

    def test_reading_review_with_owner_comment_lets_model_interpret_actual_meaning(self):
        self.reading_history([{'author': {'login': 'owner'}, 'body': '我没读完，这段不太懂'}])
        result = {**self.result, 'status': 'no_update'}
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/repo'}):
            actual = writing.execute('weekly-reading-review', self.out, self.executor(result))
        self.assertEqual(actual, result)
        self.assertEqual(len(self.calls), 1)

    def execute(self, *responses):
        return writing.execute('security-event-research', self.out, self.executor(*responses))

    def goal(self):
        return json.loads((self.out / 'writing/goal.json').read_text())

    def test_ready_first_draft_stops_without_unnecessary_rewrite(self):
        result = self.execute(self.draft(), self.review())
        self.assertEqual(result['status'], 'completed')
        self.assertEqual([phase for phase, _ in self.calls], ['draft', 'review-0'])
        self.assertEqual(self.goal()['selected_version'], 0)
        self.assertIn('1 次模型审稿、0 轮修订', result['audit']['summary'])

    def test_revision_is_reviewed_and_all_versions_remain_available(self):
        revised = copy.deepcopy(self.result)
        revised['report_markdown'] += '\n\n具体解释和例子。'
        result = self.execute(self.draft(), self.review(category='readability'), revised, self.review(revised))
        self.assertEqual(result['report_markdown'], revised['report_markdown'])
        self.assertEqual(self.goal()['selected_version'], 1)
        self.assertEqual((self.out / 'writing/draft-0.md').read_text(), self.result['report_markdown'])
        self.assertTrue((self.out / 'writing/review-1.json').is_file())
        self.assertIn('review-0.json', self.calls[2][1])

    def test_limit_does_not_publish_unresolved_draft(self):
        first, second = copy.deepcopy(self.result), copy.deepcopy(self.result)
        first['report_markdown'] += '\n第一次修改。'
        second['report_markdown'] += '\n第二次修改。'
        result = self.execute(self.draft(), self.review(category='facts', priority='blocking'),
                              first, self.review(first, 'facts', 'blocking'),
                              second, self.review(second, 'facts', 'blocking'))
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('达到两轮修订上限', result['report_markdown'])
        self.assertIsNone(self.goal()['selected_version'])
        self.assertTrue((self.out / 'writing/draft-2.md').is_file())

    def test_regression_uses_previous_baseline_for_next_revision(self):
        bad, good = copy.deepcopy(self.result), copy.deepcopy(self.result)
        bad['report_markdown'] = '# 丢失证据的修改'
        good['report_markdown'] += '\n解释得到改进，保留原始证据。'
        result = self.execute(self.draft(), self.review(category='readability'),
                              bad, self.review(bad, 'preservation', 'blocking'), good, self.review(good))
        self.assertEqual(result['report_markdown'], good['report_markdown'])
        self.assertIn('编辑基线为 output/writing/draft-0.json', self.calls[4][1])

    def test_stale_review_is_rejected(self):
        review = self.review()
        review['draft_sha256'] = 'stale'
        with self.assertRaisesRegex(ValueError, '绑定'):
            self.execute(self.draft(), review)
        self.assertEqual(self.goal()['state'], 'failed')
        self.assertFalse((self.out / 'result.json').exists())

    def test_failed_check_requires_specific_actionable_finding(self):
        review = self.review()
        review['checks']['facts']['passed'] = False
        with self.assertRaisesRegex(ValueError, '具体修改意见'):
            self.execute(self.draft(), review)

    def test_optional_preference_does_not_force_another_revision(self):
        review = self.review(category='readability', priority='optional')
        review['checks']['readability']['passed'] = True
        self.assertEqual(self.execute(self.draft(), review)['status'], 'completed')
        self.assertEqual(len(self.calls), 2)

    def test_unchanged_revision_stops_and_saves_attempt(self):
        result = self.execute(self.draft(), self.review(category='readability'), self.result)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(self.goal()['state'], 'stalled')
        self.assertEqual(len(self.calls), 3)
        self.assertTrue((self.out / 'writing/draft-1.md').is_file())

    def test_no_update_does_not_trigger_review(self):
        no_update = copy.deepcopy(self.result)
        no_update['status'] = 'no_update'
        self.assertEqual(self.execute(self.draft(no_update))['status'], 'no_update')
        self.assertEqual(len(self.calls), 1)

    def test_timeout_keeps_draft_but_never_claims_completion(self):
        result = self.execute(self.draft(), subprocess.TimeoutExpired('codex', 30), subprocess.TimeoutExpired('codex', 30))
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue((self.out / 'writing/draft-0.md').is_file())
        self.assertIn('时间预算', self.goal()['stop_reason'])
        self.assertEqual(self.goal()['active_phase'], 'review-0')
        self.assertEqual(self.goal()['phase_runs'][-1]['status'], 'timed_out')
        self.assertEqual(self.goal()['phase_runs'][-1]['timeout_seconds'], 30)
        self.assertIn('review-0', result['report_markdown'])
        self.assertIn('一个问题', result['report_markdown'])

    def test_revision_timeout_preserves_review_findings_in_blocked_report(self):
        result = self.execute(self.draft(), self.review(category='facts', priority='blocking'),
                              subprocess.TimeoutExpired('codex', writing.PHASE_TIMEOUTS['revise']))
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('revise-1', result['report_markdown'])
        self.assertIn('900 秒', result['report_markdown'])
        self.assertIn('术语没有解释', result['report_markdown'])
        self.assertIn('1 版完整稿件、1 次审稿记录', result['report_markdown'])
        self.assertEqual(self.goal()['phase_runs'][-1]['phase'], 'revise-1')

    def test_draft_timeout_does_not_claim_a_saved_draft(self):
        result = self.execute(subprocess.TimeoutExpired('codex', 720))
        self.assertIn('尚未形成完整初稿', result['report_markdown'])
        self.assertIn('0 版完整稿件', result['report_markdown'])
        self.assertIn('安全事件研究', result['report_markdown'])
        self.assertFalse((self.out / 'writing/draft-0.md').exists())

    def test_review_timeout_retries_same_draft_once_and_records_attempts(self):
        result = self.execute(self.draft(), subprocess.TimeoutExpired('codex', 720), self.review())
        self.assertEqual(result['status'], 'completed')
        records = self.goal()['phase_runs']
        self.assertEqual([entry['status'] for entry in records], ['completed', 'timed_out', 'completed'])
        self.assertEqual([entry['attempt'] for entry in records], [1, 1, 2])
        self.assertEqual(records[-1]['retry_reason'], 'phase_timeout')
        self.assertEqual(self.calls[1], self.calls[2])
        self.assertFalse((self.out / 'writing/draft-1.md').exists())

    def test_review_timeout_does_not_spend_required_followup_budget(self):
        executor = self.executor(self.draft(), subprocess.TimeoutExpired('codex', 720))
        executor.deadline = writing.time.monotonic() + 3950
        result = writing.execute('security-event-research', self.out, executor)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(len(self.calls), 2)

    def test_non_timeout_failure_is_not_retried(self):
        with self.assertRaises(runner.CodexError):
            self.execute(self.draft(), runner.CodexError('authentication failed', 1))
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.goal()['state'], 'failed')

    def test_revision_reserves_time_for_review_without_exceeding_total_budget(self):
        env = {'OPENAI_MODEL': 'configured-model', 'OPENAI_BASE_URL': 'https://example.com/v1',
               'OPENAI_API_KEY': 'test-key', 'AUTOMATION_PERMISSION_CONFIG': '{extends=":read-only"}',
               'RUNNER_TEMP': str(self.root)}
        executor = writing.CodexExecutor(self.out)
        executor.deadline = 500 + writing.PHASE_TIMEOUTS['review'] + 140
        def complete(command, **kwargs):
            self.assertEqual(kwargs['timeout'], 140)
            (self.out / 'stage-result.json').write_text(json.dumps(self.result))
            return subprocess.CompletedProcess(command, 0)
        with patch.dict('os.environ', env), patch.object(writing.time, 'monotonic', return_value=500), patch.object(
                runner, 'run_process', side_effect=complete):
            executor('revise-1', 'instructions', writing.SCHEMA)
        with patch.object(writing.time, 'monotonic', return_value=executor.deadline - 300), patch.object(runner, 'run_process') as call:
            with self.assertRaises(writing.WritingBudgetError) as caught:
                executor('revise-1', 'instructions', writing.SCHEMA)
            self.assertEqual(caught.exception.reserved, writing.PHASE_TIMEOUTS['review'])
            call.assert_not_called()

    def test_main_selects_research_budget_without_extending_other_tasks(self):
        env = {'OPENAI_MODEL': 'configured-model', 'OPENAI_BASE_URL': 'https://example.com/v1',
               'OPENAI_API_KEY': 'test-key', 'AUTOMATION_PERMISSION_CONFIG': '{extends=":read-only"}'}
        for task, budget in (('security-event-research', 5400), ('daily-personal-record', 1800)):
            with patch.dict('os.environ', {**env, 'TASK_ID': task}), patch.object(writing.Path, 'cwd', return_value=self.root), patch.object(
                    writing, 'CodexExecutor') as executor, patch.object(writing, 'execute', return_value={'status': 'no_update'}):
                writing.main()
                executor.assert_called_once_with(self.out, time_budget=budget)
        required = (writing.PHASE_TIMEOUTS['draft'] + (writing.MAX_REVISIONS + 1) * writing.PHASE_TIMEOUTS['review']
                    + writing.MAX_REVISIONS * writing.PHASE_TIMEOUTS['revise'])
        self.assertLessEqual(required, writing.WRITING_TIME_BUDGET)

    def test_revision_blocker_preserves_specific_missing_information(self):
        blocked = copy.deepcopy(self.result)
        blocked.update(status='blocked', report_markdown='缺少可验证的厂商原始通报')
        result = self.execute(self.draft(), self.review(category='facts'), blocked)
        self.assertIn('厂商原始通报', result['report_markdown'])
        self.assertEqual(result['status'], 'blocked')

    def test_non_article_tasks_keep_single_call_and_wallpaper_pre_render_contract(self):
        for task in ('update-weight-wallpaper', 'daily-personal-record', 'hk-ipo-alerts', 'knowledge-base-governance'):
            with self.subTest(task=task):
                self.calls.clear()
                result = writing.execute(task, self.out, self.executor(self.result))
                self.assertEqual(result['status'], 'completed')
                self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.out / 'writing').exists())

    def test_symlinked_stage_output_cannot_target_repository_file(self):
        protected = self.root / 'protected.txt'
        protected.write_text('keep')
        (self.out / 'result.json').symlink_to(protected)
        with self.assertRaises(ValueError):
            writing.execute('hk-ipo-alerts', self.out, self.executor(self.result))
        self.assertEqual(protected.read_text(), 'keep')

    def test_executor_keeps_permission_profile_and_uses_remaining_budget(self):
        env = {'OPENAI_MODEL': 'configured-model', 'OPENAI_BASE_URL': 'https://example.com/v1',
               'OPENAI_API_KEY': 'test-key', 'AUTOMATION_PERMISSION_CONFIG': '{extends=":read-only"}',
               'RUNNER_TEMP': str(self.root)}

        def complete(command, **kwargs):
            (self.out / 'stage-result.json').write_text(json.dumps(self.result))
            self.assertIn('--ephemeral', command)
            self.assertIn('permissions.automation={extends=":read-only"}', command)
            self.assertIn('configured-model', command)
            self.assertTrue(0 < kwargs['timeout'] <= writing.TIME_BUDGET)
            return subprocess.CompletedProcess(command, 0)

        with patch.dict('os.environ', env), patch.object(runner, 'run_process', side_effect=complete):
            result = writing.CodexExecutor(self.out)('task', 'instructions', writing.SCHEMA)
        self.assertEqual(result, self.result)


if __name__ == '__main__':
    unittest.main()
