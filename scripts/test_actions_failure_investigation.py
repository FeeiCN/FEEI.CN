import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

import actions_failure_diagnosis as diagnosis
from actions_failure_investigation import Investigation, archive_status, source_target
from test_actions_failure_diagnosis import run


class InvestigationTests(unittest.TestCase):
    def test_log_context_retains_adjacent_success_and_redacts_credentials(self):
        excerpt = diagnosis.excerpt('openai success\nCookie: session=private\n::error::minimax HTTP 401\nauth rejected\n')
        self.assertIn('openai success', excerpt)
        self.assertIn('HTTP 401', excerpt)
        self.assertNotIn('session=private', excerpt)

    def reader(self, api=None):
        context = {'run': run(created_at='2026-11-11T03:00:00Z'), 'sources': {}}
        return Investigation(context, 'owner/repo', api or Mock(), Mock(return_value='source'), Mock(), diagnosis.redact)

    def test_model_cannot_select_external_url_secret_path_or_foreign_job(self):
        reader = self.reader(Mock(return_value={'jobs': [{'id': 3}]}))
        for path in ('.env', '../scripts/x.py', 'https://example.com/x', 'static/data/private.json'):
            self.assertFalse(reader.request('source', path, 'check'))
        reader.source.assert_not_called()
        self.assertFalse(reader.request('job', '99', 'check'))
        reader.job_evidence.assert_not_called()
        self.assertFalse(reader.request('execute', 'echo token', 'check'))

    def test_history_excludes_future_fork_other_workflow_and_branch(self):
        older = run(id=1, created_at='2026-11-10T03:00:00Z', conclusion='success')
        reader = self.reader(Mock(return_value={'workflow_runs': [older,
            {**older, 'id': 2, 'created_at': '2026-11-12T03:00:00Z'},
            {**older, 'id': 3, 'head_branch': 'other'},
            {**older, 'id': 4, 'head_repository': {'full_name': 'outsider/fork'}},
            {**older, 'id': 5, 'path': '.github/workflows/other.yml'}]}))
        self.assertTrue(reader.request('history', reason='找最近成功基线'))
        self.assertEqual([item['id'] for item in reader.context['history']], [1])
        reader.api.return_value = {'files': [{'filename': 'scripts/helper.py', 'patch': 'secret content'}]}
        self.assertTrue(reader.request('changes', reason='检查失败前变化'))
        self.assertNotIn('secret content', str(reader.context))

    def test_budgets_and_duplicates_stop_further_calls(self):
        reader = self.reader()
        self.assertTrue(reader.request('source', 'scripts/one.py', 'check'))
        self.assertFalse(reader.request('source', 'scripts/one.py', 'again'))
        self.assertEqual(reader.source.call_count, 1)
        reader.requests = 12
        self.assertFalse(reader.request('source', 'scripts/two.py', 'check'))
        self.assertEqual(reader.source.call_count, 1)
        reader = self.reader()
        reader.start -= 481
        self.assertFalse(reader.request('history', reason='check'))
        reader.api.assert_not_called()

    def test_bounded_source_range_reads_beyond_initial_excerpt_at_failed_commit(self):
        import base64
        self.assertEqual(source_target('scripts/helper.py:350-500'), ('scripts/helper.py', 350, 500))
        for target in ('scripts/x.py:0-10', 'scripts/x.py:30-20', 'scripts/x.py:1-1000',
                       '../scripts/x.py:1-10', 'https://example.com/a.py:1-10'):
            with self.assertRaises(ValueError):
                source_target(target)
        content = '\n'.join(f'line {n}' for n in range(1, 601))
        with patch.object(diagnosis, 'gh', return_value={'content': base64.b64encode(content.encode()).decode()}) as api:
            text = diagnosis.source('owner/repo', 'scripts/helper.py:350-500', 'a' * 40)
        self.assertTrue(text.startswith('line 350\n'))
        self.assertTrue(text.endswith('line 500'))
        self.assertEqual(api.call_args.args[0], 'repos/owner/repo/contents/scripts/helper.py?ref=' + 'a' * 40)

    def zip(self, files):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, body in files.items():
                archive.writestr(name, body)
        return stream.getvalue()

    def test_artifact_reads_only_bounded_status_fields_without_extracting(self):
        raw = self.zip({'llm-sync-status.json': json.dumps({'vendors': [
            {'vendor': 'minimax', 'status': 'failed', 'reason': 'HTTP 401', 'cookie': 'private'},
            {'vendor': 'openai', 'status': 'success'}], 'raw_body': 'private'}),
            '../secret-status.json': 'private', 'personal.json': 'private'})
        records = archive_status(raw, diagnosis.redact)
        self.assertEqual(len(records), 2)
        self.assertNotIn('private', str(records))
        with self.assertRaises(ValueError):
            archive_status(self.zip({'status.json': 'x' * 256001}), diagnosis.redact)

    def test_artifact_must_belong_to_current_run(self):
        reader = self.reader(Mock(return_value={'artifacts': [
            {'id': 1, 'name': 'sync-status', 'size_in_bytes': 20, 'workflow_run': {'id': 999}},
            {'id': 2, 'name': 'personal-data', 'size_in_bytes': 20, 'workflow_run': {'id': 42}}]}))
        with patch('actions_failure_investigation.download_status') as download:
            self.assertTrue(reader.request('artifacts', reason='检查来源'))
        download.assert_not_called()

    def test_fallback_separates_known_task_error_from_model_failure(self):
        context = {'investigation': [{'action': 'artifacts', 'state': 'read', 'data': [{'records': [
            {'vendor': 'minimax', 'status': 'failed', 'reason': 'HTTP 401'},
            {'vendor': 'openai', 'status': 'success'},
            {'vendor': 'anthropic', 'status': 'skipped'}]}]}]}
        result = diagnosis.factual_fallback(context, '模型接口 HTTP 403')
        self.assertIn('minimax：失败', result['cause'])
        self.assertIn('openai：成功', result['cause'])
        self.assertIn('HTTP 403', result['uncertainty'])
        self.assertNotIn('过期', result['cause'])

    def test_failure_signature_ignores_timestamps_but_detects_source_changes(self):
        def context(stamp, error='HTTP 401'):
            return {'failures': [{'evidence': stamp + ' ##[error]minimax: ' + error}]}
        signature = diagnosis.failure_signature(context('first'), {})
        self.assertEqual(signature, diagnosis.failure_signature(context('later'), {}))
        self.assertNotEqual(signature, diagnosis.failure_signature(context('later', 'HTTP 403'), {}))
        self.assertNotEqual(signature, diagnosis.failure_signature(
            {**context('later'), 'sources': {'scripts/helper.py': 'new evidence'}}, {}))
        self.assertIsNone(diagnosis.failure_signature({'failures': [{'evidence': 'Process completed with exit code 1.'}]}, {}))

    def test_repeat_updates_only_bot_summary_and_keeps_run_markers(self):
        context = {'run': run(), 'failures': [{'evidence': '##[error]HTTP 401'}]}
        signature = diagnosis.failure_signature(context, {})
        marker = f'<!-- actions-failure-signature:{signature} -->'
        repeat = {'id': 8, 'user': {'login': 'github-actions[bot]'}, 'body':
                  marker + f'<!-- actions-failure-repeat:{signature} -->\n<!-- occurrences:2 -->\n'
                  '<!-- actions-failure-run:41:attempt:1:version:3 -->'}
        with patch.object(diagnosis, 'pages', return_value=[repeat]), patch.object(diagnosis, 'gh', side_effect=[
                {'user': {'login': 'github-actions[bot]'}, 'body': marker}, {'html_url': 'summary'}]) as api:
            diagnosis.repeated_delivery('owner/repo', 7, context, {})
        self.assertEqual(api.call_args.args[:2], ('repos/owner/repo/issues/comments/8', 'PATCH'))
        self.assertIn('occurrences:3', api.call_args.args[2]['body'])
        self.assertIn('actions-failure-run:41:', api.call_args.args[2]['body'])
        self.assertIn(diagnosis.run_marker(run()), api.call_args.args[2]['body'])

    def test_investigation_continues_multiple_rounds_and_stops_without_new_evidence(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(diagnosis, 'OUT', Path(folder)), patch.dict(
                'os.environ', {'GITHUB_REPOSITORY': 'owner/repo'}):
            Path(folder, 'context.json').write_text(json.dumps({'run': run(), 'sources': {}}))
            rounds = []
            def analyze(refining=False):
                rounds.append(refining)
                result = {key: '结论' for key in diagnosis.FIELDS}
                result.update(model_state='completed', requested_sources=['scripts/helper.py'], evidence_requests=[])
                Path(folder, 'diagnosis.json').write_text(json.dumps(result))
            with patch.object(diagnosis, 'analyze', side_effect=analyze), patch.object(
                    diagnosis, 'gh', return_value={}), patch.object(diagnosis, 'source', return_value='source'):
                diagnosis.investigate()
            self.assertEqual(rounds, [False, True])
            result = json.loads(Path(folder, 'diagnosis.json').read_text())
            self.assertIn('停止重复调查', result['uncertainty'])
        diagnosis.INVESTIGATION_DEADLINE = None

    def test_round_budget_stops_model_requests_and_records_unfinished_work(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(diagnosis, 'OUT', Path(folder)), patch.dict(
                'os.environ', {'GITHUB_REPOSITORY': 'owner/repo'}):
            Path(folder, 'context.json').write_text(json.dumps({'run': run(), 'sources': {}}))
            rounds = []
            def analyze(refining=False):
                rounds.append(refining)
                result = {key: '结论' for key in diagnosis.FIELDS}
                result.update(model_state='completed', requested_sources=[f'scripts/helper{len(rounds)}.py'], evidence_requests=[])
                Path(folder, 'diagnosis.json').write_text(json.dumps(result))
            with patch.object(diagnosis, 'analyze', side_effect=analyze), patch.object(
                    diagnosis, 'gh', return_value={}), patch.object(diagnosis, 'source', return_value='source') as source:
                diagnosis.investigate()
            self.assertEqual(len(rounds), 4)
            self.assertEqual(source.call_count, 3)
            result = json.loads(Path(folder, 'diagnosis.json').read_text())
            self.assertIn('预算', result['uncertainty'])
            self.assertEqual(result['requested_sources'], [])
        diagnosis.INVESTIGATION_DEADLINE = None


if __name__ == '__main__':
    unittest.main()
