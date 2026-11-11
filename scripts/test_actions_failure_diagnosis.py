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
            result = {**{key: '建议' for key in diagnosis.FIELDS}, 'assessment': 'suspected', 'requested_sources': [], 'evidence_requests': []}
            response = {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': json.dumps(result)}]}]}
            from io import BytesIO
            with patch.object(diagnosis, 'urlopen', return_value=BytesIO(json.dumps(response).encode())) as api:
                diagnosis.analyze()
            payload = json.loads(api.call_args.args[0].data)
            self.assertNotIn('tools', payload)
            self.assertFalse(payload['store'])
            self.assertEqual(payload['model'], 'configured-model')
            saved = json.loads((Path(folder) / 'diagnosis.json').read_text())
            self.assertEqual(saved, {**result, 'model_state': 'completed', 'model_rounds': 1})

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
                    diagnosis, 'job_evidence', return_value='日志下载失败；已重试 3 次。'), patch.object(
                    diagnosis, 'source', side_effect=['uses: ./.github/workflows/automation-task.yml',
                                                      'run: python3 scripts/run_automation_task.py', 'print("sample")']):
                diagnosis.collect()
            context = json.loads((out / 'context.json').read_text())
            self.assertEqual(len(context['sources']), 3)
            self.assertIn('日志下载失败', context['failures'][0]['evidence'])
            self.assertIn('ready=true', (out / 'outputs').read_text())

    def test_log_download_retries_before_succeeding(self):
        from types import SimpleNamespace
        attempts = []
        def download(command, **kwargs):
            attempts.append(command)
            if len(attempts) == 1:
                return SimpleNamespace(returncode=1, stderr=b'HTTP 404: Not Found')
            kwargs['stdout'].write(b'{"reason": "synthetic parse failure"}\n')
            return SimpleNamespace(returncode=0)
        with patch.object(diagnosis.subprocess, 'run', side_effect=download), patch.object(diagnosis.time, 'sleep'):
            evidence = diagnosis.job_evidence('owner/repo', {'id': 42})
        self.assertIn('synthetic parse failure', evidence)
        self.assertEqual(len(attempts), 2)

    def test_log_extracts_structured_reference_and_keeps_legacy_fallback(self):
        from types import SimpleNamespace
        for content, expected in (
            ('timestamp ACTION_DIAGNOSTIC {"version":1,"issue_number":12,"body_sha256":"' + 'a' * 64 + '"}\n',
             {'issue_number': 12, 'body_sha256': 'a' * 64}),
            ('timestamp   ISSUE_NUMBER: 12\n', {'issue_number': 12}),
        ):
            def download(command, **kwargs):
                kwargs['stdout'].write(content.encode())
                return SimpleNamespace(returncode=0)
            references = []
            with patch.object(diagnosis.subprocess, 'run', side_effect=download):
                diagnosis.job_evidence('owner/repo', {'id': 42}, references)
            self.assertEqual(references, [expected])

    def test_log_failure_preserves_status_and_uses_annotations(self):
        from types import SimpleNamespace
        with patch.object(diagnosis.subprocess, 'run', return_value=SimpleNamespace(
                returncode=1, stderr=b'HTTP 403: secret details')), patch.object(diagnosis.time, 'sleep'), patch.object(
                diagnosis, 'gh', return_value=[{'annotation_level': 'failure', 'message': 'synthetic failure'}]):
            evidence = diagnosis.job_evidence('owner/repo', {'id': 42, 'check_run_url': 'https://api.github.com/repos/owner/repo/check-runs/12'})
        self.assertIn('HTTP 403', evidence)
        self.assertIn('synthetic failure', evidence)
        self.assertNotIn('secret details', evidence)

    def test_model_http_failure_preserves_status_without_response_secrets(self):
        from urllib.error import HTTPError
        with tempfile.TemporaryDirectory() as folder, patch.object(diagnosis, 'OUT', Path(folder)), patch.dict(
                os.environ, {'OPENAI_API_KEY': 'test', 'OPENAI_BASE_URL': 'https://proxy.example/v1', 'OPENAI_MODEL': 'configured-model'}):
            (Path(folder) / 'context.json').write_text('{}')
            with patch.object(diagnosis, 'urlopen', side_effect=HTTPError(
                    'https://proxy.example', 400, 'private response', None, None)):
                diagnosis.analyze()
            result = json.loads((Path(folder) / 'diagnosis.json').read_text())
            self.assertIn('HTTP 400', result['uncertainty'])
            self.assertNotIn('private response', result['uncertainty'])

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

class EvidenceFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.out_patch = patch.object(diagnosis, 'OUT', self.out)
        self.out_patch.start()
        self.addCleanup(self.out_patch.stop)
        self.env_patch = patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo',
            'GITHUB_OUTPUT': str(self.out / 'outputs'), 'GITHUB_STEP_SUMMARY': str(self.out / 'summary'),
            'OPENAI_API_KEY': 'test', 'OPENAI_BASE_URL': 'https://proxy.example/v1', 'OPENAI_MODEL': 'configured-model'})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def save(self, name, value):
        (self.out / name).write_text(json.dumps(value))

    def result(self, paths=None):
        return {**{key: '建议' for key in diagnosis.FIELDS},
                'assessment': 'suspected', 'requested_sources': paths or [], 'evidence_requests': []}

    def response(self, result):
        from io import BytesIO
        return BytesIO(json.dumps({'status': 'completed', 'output': [{'type': 'message', 'content': [
            {'type': 'output_text', 'text': json.dumps(result)}]}]}).encode())

    def test_supplement_reads_at_failed_sha_and_refines_once(self):
        self.save('context.json', {'run': run(), 'sources': {}})
        self.save('diagnosis.json', self.result(['scripts/helper.py']))
        with patch.object(diagnosis, 'source', return_value='synthetic source') as source:
            diagnosis.supplement()
        source.assert_called_once_with('owner/repo', 'scripts/helper.py', 'a' * 40)
        self.assertIn('ready=true', (self.out / 'outputs').read_text())
        with patch.object(diagnosis, 'urlopen', return_value=self.response(self.result())) as api:
            diagnosis.refine()
        payload = json.loads(api.call_args.args[0].data)
        self.assertEqual(json.loads(payload['input'])['analysis_round'], 2)
        self.assertEqual(json.loads((self.out / 'diagnosis.json').read_text())['model_rounds'], 2)

    def test_supplement_never_fetches_secret_paths_or_executes_commands(self):
        self.save('context.json', {'run': run(), 'sources': {}})
        self.save('diagnosis.json', self.result(['.env', '../secrets.py', 'https://example.com/x']))
        with patch.object(diagnosis, 'gh') as api:
            diagnosis.supplement()
        api.assert_not_called()
        self.assertEqual(json.loads((self.out / 'context.json').read_text())['sources'], {})

    def test_refine_failure_preserves_initial_suggestions_and_marks_degraded(self):
        self.save('context.json', {'run': run(), 'sources': {}})
        self.save('diagnosis.json', self.result())
        with patch.object(diagnosis, 'urlopen', side_effect=TimeoutError):
            diagnosis.refine()
        result = json.loads((self.out / 'diagnosis.json').read_text())
        self.assertEqual(result['cause'], '建议')
        self.assertEqual(result['model_state'], 'degraded')
        self.assertEqual(result['requested_sources'], [])

    def test_transient_model_failure_retried_but_http_400_not_retried(self):
        from urllib.error import HTTPError
        self.save('context.json', {})
        with patch.object(diagnosis, 'urlopen', side_effect=[
                HTTPError('https://proxy.example', 429, '', None, None), self.response(self.result())]) as api, patch.object(diagnosis.time, 'sleep'):
            diagnosis.analyze()
        self.assertEqual(api.call_count, 2)
        self.assertEqual(json.loads((self.out / 'diagnosis.json').read_text())['model_state'], 'completed')

    def test_degraded_report_is_delivered_before_failing_workflow(self):
        self.save('context.json', {'run': run(), 'failures': []})
        self.save('diagnosis.json', {**self.result(), 'model_state': 'degraded'})
        with patch.object(diagnosis, 'gh', side_effect=[run(), {'html_url': 'https://github.com/comment'}]) as api, patch.object(
                diagnosis, 'find_delivery', return_value=(7, False)), self.assertRaises(SystemExit):
            diagnosis.publish()
        self.assertEqual(api.call_count, 2)
        self.assertIn('诊断降级', (self.out / 'summary').read_text())

    def test_existing_version_one_report_can_receive_upgrade(self):
        old = '<!-- actions-failure-run:42:attempt:1 -->'
        with patch.object(diagnosis, 'pages', side_effect=[[
                {'number': 7, 'state': 'open', 'body': diagnosis.workflow_marker(run()) + old}], []]):
            self.assertEqual(diagnosis.find_delivery('owner/repo', run()), (7, False))


if __name__ == '__main__':
    unittest.main()
