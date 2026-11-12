import json
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


if __name__ == '__main__':
    unittest.main()
