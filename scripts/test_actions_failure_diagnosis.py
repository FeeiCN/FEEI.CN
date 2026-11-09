import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import actions_failure_diagnosis as diagnosis


def run(**overrides):
    return {'id': 42, 'run_attempt': 1, 'name': '网站严格检查',
            'path': '.github/workflows/check.yml', 'html_url': 'https://github.com/owner/repo/actions/runs/42',
            'head_sha': 'a' * 40, 'status': 'completed', 'conclusion': 'failure',
            'head_branch': 'main', 'repository': {'full_name': 'owner/repo'},
            'head_repository': {'full_name': 'owner/repo'}, **overrides}


class DiagnosisTests(unittest.TestCase):
    def test_provenance_and_conclusion(self):
        self.assertTrue(diagnosis.eligible(run(), 'Owner/Repo'))
        self.assertTrue(diagnosis.eligible(run(conclusion='timed_out'), 'owner/repo'))
        for changes in ({'head_branch': 'feature'}, {'conclusion': 'success'},
                        {'conclusion': 'cancelled'}, {'path': diagnosis.SELF},
                        {'head_repository': {'full_name': 'outsider/fork'}},
                        {'head_repository': None}, {'status': 'in_progress'}):
            self.assertFalse(diagnosis.eligible(run(**changes), 'owner/repo'))

    def test_redaction_and_bounded_error_selection(self):
        token = 'ghp_' + 'a' * 30
        raw = ('-----BEGIN RSA PRIVATE KEY-----\nprivate\n-----END RSA PRIVATE KEY-----\n'
               'ordinary personal text\nError Authorization: Bearer sensitive\n'
               'Error password=hunter2\nError https://user:pass@example.com/api?token=secret\n'
               f'Error {token}\n' + '\n'.join(f'Error {n}' for n in range(100)))
        redacted = diagnosis.redact(raw)
        for secret in ('private\n', 'sensitive', 'hunter2', 'user:pass', '?token=', token):
            self.assertNotIn(secret, redacted)
        selected = diagnosis.excerpt(raw)
        self.assertEqual(len(selected.splitlines()), 35)
        self.assertNotIn('ordinary personal text', selected)
        self.assertIn('Error 99', selected)

    def test_dedup_first_issue_and_closed_issue_comments(self):
        info = run()
        marker = diagnosis.workflow_marker(info)
        for state in ('open', 'closed'):
            issue = {'number': 7, 'state': state, 'body': marker}
            with patch.object(diagnosis, 'pages', side_effect=[
                    [issue], [{'body': diagnosis.run_marker(info), 'user': {'login': 'github-actions[bot]'}}]]):
                self.assertEqual(diagnosis.find_delivery('owner/repo', info), (7, True))
        with patch.object(diagnosis, 'pages', return_value=[{'number': 7, 'state': 'open',
                'body': marker + diagnosis.run_marker(info)}]):
            self.assertEqual(diagnosis.find_delivery('owner/repo', info), (7, True))
        self.assertNotEqual(diagnosis.run_marker(info), diagnosis.run_marker(run(run_attempt=2)))

    def test_continuous_failure_targets_open_workflow_issue(self):
        info = run()
        with patch.object(diagnosis, 'pages', side_effect=[[
                {'number': 7, 'state': 'open', 'body': diagnosis.workflow_marker(info)}], []]):
            self.assertEqual(diagnosis.find_delivery('owner/repo', info), (7, False))

    def test_fallback_without_model_and_safe_rendering(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(diagnosis, 'OUT', Path(folder)), patch.dict(
                os.environ, {'OPENAI_API_KEY': '', 'OPENAI_BASE_URL': '', 'OPENAI_MODEL': ''}):
            context = {'run': run(), 'failures': []}
            (Path(folder) / 'context.json').write_text(json.dumps(context))
            diagnosis.analyze()
            result = json.loads((Path(folder) / 'diagnosis.json').read_text())
            self.assertIn('模型不可用', result['cause'])
            result['fix'] = '@owner <script> ![image](https://example.com/x)'
            report = diagnosis.render(context, result)
            self.assertNotIn('@owner', report)
            self.assertNotIn('<script>', report)
            self.assertNotIn('![image]', report)
            self.assertIn('未返回失败 Job', report)

    def test_changed_attempt_is_not_published(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(diagnosis, 'OUT', Path(folder)), patch.dict(
                os.environ, {'GITHUB_REPOSITORY': 'owner/repo'}):
            (Path(folder) / 'context.json').write_text(json.dumps({'run': run()}))
            (Path(folder) / 'diagnosis.json').write_text('{}')
            with patch.object(diagnosis, 'gh', return_value=run(run_attempt=2)) as api:
                diagnosis.publish()
            api.assert_called_once()

    def test_source_rejects_paths_outside_workflow_and_scripts(self):
        with patch.object(diagnosis, 'gh') as api:
            for path in ('../secret.py', 'docs/personal.md', 'scripts/../secret.py', 'scripts/key.pem'):
                self.assertEqual(diagnosis.source('owner/repo', path, 'a' * 40), '')
            api.assert_not_called()

    def test_model_request_has_no_tools_and_validates_response(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(diagnosis, 'OUT', Path(folder)), patch.dict(
                os.environ, {'OPENAI_API_KEY': 'test', 'OPENAI_BASE_URL': 'https://proxy.example/v1', 'OPENAI_MODEL': 'configured-model'}):
            (Path(folder) / 'context.json').write_text('{}')
            result = {key: '建议' for key in diagnosis.FIELDS}
            response = {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': json.dumps(result)}]}]}
            from io import BytesIO
            with patch.object(diagnosis, 'urlopen', return_value=BytesIO(json.dumps(response).encode())) as api:
                diagnosis.analyze()
            payload = json.loads(api.call_args.args[0].data)
            self.assertNotIn('tools', payload)
            self.assertFalse(payload['store'])
            self.assertEqual(payload['model'], 'configured-model')
            self.assertEqual(json.loads((Path(folder) / 'diagnosis.json').read_text()), result)

    def test_publish_creates_then_comments_and_skips_duplicates(self):
        for issue, seen, endpoint in ((None, False, 'issues'), (7, False, 'issues/7/comments'), (7, True, None)):
            with self.subTest(issue=issue, seen=seen), tempfile.TemporaryDirectory() as folder:
                out = Path(folder)
                (out / 'context.json').write_text(json.dumps({'run': run(), 'failures': []}))
                (out / 'diagnosis.json').write_text(json.dumps({key: '检查' for key in diagnosis.FIELDS}))
                with patch.object(diagnosis, 'OUT', out), patch.dict(os.environ, {
                        'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_STEP_SUMMARY': str(out / 'summary')}), patch.object(
                        diagnosis, 'find_delivery', return_value=(issue, seen)), patch.object(
                        diagnosis, 'pages', return_value=[]), patch.object(
                        diagnosis, 'gh', side_effect=[run(), {'number': 7, 'html_url': 'https://github.com/owner/repo/issues/7'}]) as api:
                    diagnosis.publish()
                    if endpoint:
                        self.assertEqual(api.call_args.args[:2], (f'repos/owner/repo/{endpoint}', 'POST'))
                        self.assertIn(diagnosis.run_marker(run()), api.call_args.args[2]['body'])
                        self.assertTrue((out / 'summary').exists())
                    else:
                        self.assertEqual(api.call_count, 1)

    def test_collect_handles_missing_logs_and_reusable_workflow(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            with patch.object(diagnosis, 'OUT', out), patch.dict(os.environ, {
                    'GITHUB_REPOSITORY': 'owner/repo', 'TARGET_RUN_ID': '42',
                    'GITHUB_OUTPUT': str(out / 'outputs')}), patch.object(diagnosis, 'gh', return_value=run()), patch.object(
                    diagnosis, 'find_delivery', return_value=(None, False)), patch.object(diagnosis, 'pages', return_value=[{
                        'id': 99, 'name': 'execute', 'conclusion': 'failure', 'html_url': 'https://github.com/job',
                        'steps': [{'name': 'Execute', 'number': 1, 'conclusion': 'failure'}]}]), patch.object(
                    diagnosis.subprocess, 'run', return_value=type('Result', (), {'returncode': 1})()), patch.object(
                    diagnosis, 'source', side_effect=['uses: ./.github/workflows/automation-task.yml',
                                                      'run: python3 scripts/run_automation_task.py', 'print("sample")']):
                diagnosis.collect()
            context = json.loads((out / 'context.json').read_text())
            self.assertEqual(len(context['sources']), 3)
            self.assertIn('日志不可用', context['failures'][0]['evidence'])
            self.assertIn('ready=true', (out / 'outputs').read_text())

    def test_concurrent_issue_creation_keeps_oldest_issue(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / 'context.json').write_text(json.dumps({'run': run(), 'failures': []}))
            (out / 'diagnosis.json').write_text(json.dumps({key: '检查' for key in diagnosis.FIELDS}))
            with patch.object(diagnosis, 'OUT', out), patch.dict(os.environ, {
                    'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_STEP_SUMMARY': str(out / 'summary')}), patch.object(
                    diagnosis, 'find_delivery', return_value=(None, False)), patch.object(diagnosis, 'pages', return_value=[
                        {'number': 7, 'body': diagnosis.workflow_marker(run())},
                        {'number': 8, 'body': diagnosis.workflow_marker(run())}]), patch.object(
                    diagnosis, 'gh', side_effect=[run(), {'number': 8}, {'html_url': 'https://github.com/comment'}, {}]) as api:
                diagnosis.publish()
            self.assertEqual(api.call_args_list[2].args[:2], ('repos/owner/repo/issues/7/comments', 'POST'))
            self.assertEqual(api.call_args_list[3].args, ('repos/owner/repo/issues/8', 'PATCH', {'state': 'closed'}))


if __name__ == '__main__':
    unittest.main()
