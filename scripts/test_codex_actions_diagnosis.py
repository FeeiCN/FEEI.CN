import json
from copy import deepcopy
import os
from pathlib import Path
import tempfile
import codex_runner as runner
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import codex_actions_diagnosis as task
from test_actions_failure_diagnosis import run


class CodexDiagnosisTests(unittest.TestCase):
    def test_codex_has_read_only_profile_and_schema_without_direct_model_http(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(task, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_ACTIONS': 'false', 'RUNNER_TEMP': folder, 'GITHUB_STEP_SUMMARY': '', 'OPENAI_BASE_URL': 'https://proxy.example/v1', 'OPENAI_MODEL': 'test-model'}):
            Path(folder, 'context.json').write_text(json.dumps(self.context()))
            def execute(command, **kwargs):
                self.assertEqual(command[:2], ['codex', 'exec'])
                self.assertIn('output-schema', ' '.join(command))
                self.assertIn('extends=":read-only"', ' '.join(command))
                self.assertIn('shell_environment_policy.exclude=["OPENAI_*", "ACTIONS_*"]', command)
                self.assertEqual(kwargs['timeout'], 2400)
                Path(folder, 'result.json').write_text(json.dumps(self.result()))
                return SimpleNamespace(returncode=0)
            with patch.object(runner, 'run_process', side_effect=execute), patch.object(
                    task.subprocess, 'check_output', return_value=b''):
                task.execute()

    def test_executor_failure_does_not_produce_fallback_report(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(task, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_ACTIONS': 'false', 'RUNNER_TEMP': folder, 'GITHUB_STEP_SUMMARY': '', 'OPENAI_BASE_URL': 'https://proxy.example/v1', 'OPENAI_MODEL': 'test-model'}):
            Path(folder, 'context.json').write_text(json.dumps(self.context()))
            with patch.object(runner, 'run_process', return_value=SimpleNamespace(returncode=1)), self.assertRaises(RuntimeError):
                task.execute()
            self.assertFalse(Path(folder, 'result.json').exists())

    def context(self):
        return {'repository': 'owner/repo', 'failures': [run()]}

    def result(self):
        return {'coverage': '已核对日志和源码，限当前运行',
                'findings': [{'run_id': 42, 'report_markdown': '认证被拒；核实对应凭证并在确认后重跑。'}]}

    def test_validation_requires_all_failures_and_rejects_extra_runs_and_markers(self):
        task.validate(self.result(), self.context())
        for changes in ([], [{'run_id': 99, 'report_markdown': '错误对象'}],
                        [self.result()['findings'][0]] * 2,
                        [{'run_id': 42, 'report_markdown': '<!-- bypass -->'}]):
            result = self.result()
            result['findings'] = changes
            with self.assertRaises(ValueError):
                task.validate(result, self.context())

    def test_changed_attempt_or_foreign_origin_cannot_publish(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(task, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_REPOSITORY': 'owner/repo'}):
            Path(folder, 'context.json').write_text(json.dumps(self.context()))
            Path(folder, 'result.json').write_text(json.dumps(self.result()))
            for changed in (run(run_attempt=2), run(head_repository={'full_name': 'outsider/fork'})):
                with patch.object(task, 'gh', return_value=changed) as api, self.assertRaises(ValueError):
                    task.publish()
                api.assert_called_once()

    def test_publish_reuses_existing_issue_and_skips_delivered_attempt(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(task, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_STEP_SUMMARY': folder + '/summary'}):
            Path(folder, 'context.json').write_text(json.dumps(self.context()))
            Path(folder, 'result.json').write_text(json.dumps(self.result()))
            with patch.object(task, 'delivered', return_value=(876, False)), patch.object(
                    task, 'gh', side_effect=[run(), {'html_url': 'https://example.com/report'}]) as api:
                task.publish()
            self.assertEqual(api.call_args.args[:2], ('repos/owner/repo/issues/876/comments', 'POST'))
            self.assertIn(task.marker(run()), api.call_args.args[2]['body'])
            with patch.object(task, 'delivered', return_value=(876, True)), patch.object(task, 'gh', return_value=run()) as api:
                task.publish()
            api.assert_called_once()

    def test_prepare_uses_all_workflows_and_only_trusted_failures(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(task, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_OUTPUT': folder + '/outputs', 'TARGET_RUN_ID': ''}):
            with patch.object(task, 'pages', return_value=[{'name': 'all'}]), patch.object(task, 'gh', return_value={
                    'workflow_runs': [run(created_at='2026-11-12T00:00:00Z'), run(id=43, conclusion='success'), run(id=44, head_branch='other')]}), patch.object(
                    task, 'delivered', return_value=(None, False)):
                task.prepare()
            context = json.loads(Path(folder, 'context.json').read_text())
            self.assertEqual([entry['id'] for entry in context['failures']], [42])
            self.assertIn('ready=true', Path(folder, 'outputs').read_text())

    def test_literal_cookie_prefix_keeps_explanation_but_values_stay_redacted(self):
        text = '已兼容带 `Cookie:` 前缀的格式；目标提交包含修正，401 仍然存在。\n'
        rendered = task.report_text(text)
        self.assertIn('目标提交包含修正，401 仍然存在。', rendered)
        self.assertEqual(rendered.count('`') % 2, 0)
        self.assertIn('两处说明完整。', task.report_text('`Cookie:` 前缀与 `Cookie:` 前缀，两处说明完整。'))
        for raw in ['Cookie: session=private-value; other=private-other',
                    '`Cookie:` session=private-value',
                    '带 `Cookie:` 前缀，session=private-value',
                    '带 `Cookie:` 前缀。\nCookie: session=private-value']:
            self.assertNotIn('private-value', task.report_text(raw))
        token = 'sk-' + 'a' * 30
        self.assertNotIn(token, task.report_text(text + token))

    def source(self, **changes):
        return {'head_repository': {'full_name': 'owner/repo'}, 'head_branch': 'main',
                'path': task.WORKFLOW, 'status': 'completed', 'event': 'workflow_dispatch',
                'actor': {'login': 'owner'}, 'run_attempt': 1, **changes}

    def test_replay_binds_successful_investigation_to_immutable_artifact(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
                'GITHUB_REPOSITORY': 'owner/repo', 'REPORT_RUN_ID': '123', 'TARGET_RUN_ID': '',
                'GITHUB_OUTPUT': folder + '/output'}):
            jobs = [{'name': 'investigate', 'conclusion': 'success'}]
            artifact = {'id': 789, 'name': 'codex-actions-diagnosis-123', 'size_in_bytes': 100, 'expired': False}
            for conclusion in ['success', 'failure']:
                with patch.object(task, 'gh', return_value=self.source(conclusion=conclusion)), \
                        patch.object(task, 'pages', side_effect=[jobs, [artifact]]):
                    task.replay()
            self.assertIn('artifact-id=789', Path(folder, 'output').read_text())

    def test_replay_rejects_untrusted_incomplete_or_ambiguous_sources(self):
        jobs = [{'name': 'investigate', 'conclusion': 'success'}]
        artifact = {'id': 789, 'name': 'codex-actions-diagnosis-123', 'size_in_bytes': 100, 'expired': False}
        cases = [(self.source(**change), jobs, [artifact]) for change in [
            {'head_repository': {'full_name': 'outsider/fork'}}, {'head_branch': 'other'},
            {'path': '.github/workflows/other.yml'}, {'status': 'in_progress'},
            {'event': 'pull_request'}, {'actor': {'login': 'outsider'}}, {'run_attempt': 2}]]
        cases += [(self.source(), [{'name': 'investigate', 'conclusion': 'failure'}], [artifact]),
                  (self.source(), jobs, [{**artifact, 'expired': True}]),
                  (self.source(), jobs, [{**artifact, 'size_in_bytes': 6_000_000}]),
                  (self.source(), jobs, [artifact, deepcopy(artifact)])]
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
                'GITHUB_REPOSITORY': 'owner/repo', 'REPORT_RUN_ID': '123', 'TARGET_RUN_ID': '',
                'GITHUB_OUTPUT': folder + '/output'}):
            for source, steps, artifacts in cases:
                with self.subTest(source=source, artifacts=artifacts), \
                        patch.object(task, 'gh', return_value=source), \
                        patch.object(task, 'pages', side_effect=[steps, artifacts]), self.assertRaises(ValueError):
                    task.replay()
            self.assertFalse(Path(folder, 'output').exists())
            with patch.dict(os.environ, {'TARGET_RUN_ID': '42'}), self.assertRaises(ValueError):
                task.replay()

    def test_replay_updates_only_exact_bot_report_then_becomes_noop(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(task, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_STEP_SUMMARY': folder + '/summary',
                             'REPLAY_REPORT': 'true', 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_ACTOR': 'owner'}):
            result = self.result()
            raw = '支持带 `Cookie:` 前缀的字符串。'
            result['findings'][0]['report_markdown'] = raw
            Path(folder, 'context.json').write_text(json.dumps(self.context()))
            Path(folder, 'result.json').write_text(json.dumps(result))
            endpoint = 'repos/owner/repo/issues/comments/7'
            old = task.report_body(run(), task.redact(raw))
            existing = {'body': old, 'html_url': 'https://example.com/report'}
            with patch.object(task, 'delivered', return_value=(876, True)), \
                    patch.object(task, 'report_location', return_value=(endpoint, existing)), \
                    patch.object(task, 'gh', side_effect=[run(), existing]) as api:
                task.publish()
                self.assertEqual(api.call_args.args[:2], (endpoint, 'PATCH'))
                new = api.call_args.args[2]['body']
                self.assertIn('前缀的字符串。', new)
                self.assertNotIn('[REDACTED]', new)
            for body, changed in [(new, False), (old + '\n人工补充', True)]:
                with patch.object(task, 'delivered', return_value=(876, True)), \
                        patch.object(task, 'report_location', return_value=(endpoint, {**existing, 'body': body})), \
                        patch.object(task, 'gh', return_value=run()) as api:
                    if changed:
                        with self.assertRaisesRegex(ValueError, '人工修改'):
                            task.publish()
                    else:
                        task.publish()
                    api.assert_called_once()

    def test_report_locator_ignores_owner_text_and_rejects_duplicate_bot_reports(self):
        original = {'user': {'login': 'owner'}, 'body': task.marker(run())}
        owner_comment = {'id': 1, **original}
        bot_comment = {'id': 2, 'user': {'login': 'github-actions[bot]'}, 'body': task.marker(run())}
        with patch.object(task, 'gh', return_value=original), patch.object(task, 'pages', return_value=[owner_comment]):
            self.assertIsNone(task.report_location('owner/repo', run(), 876))
        with patch.object(task, 'gh', return_value=original), \
                patch.object(task, 'pages', return_value=[bot_comment, {**bot_comment, 'id': 3}]), \
                self.assertRaisesRegex(ValueError, '多份报告'):
            task.report_location('owner/repo', run(), 876)


if __name__ == '__main__':
    unittest.main()
