import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import sync_llm_usage as sync


class UsageSyncTests(unittest.TestCase):
    def test_auth_header_contains_only_credential(self):
        for vendor, header, secret in [('minimax', 'Cookie', 'session=fake'), ('anthropic', 'X-api-key', 'fake-key')]:
            with self.subTest(vendor=vendor), patch.dict(os.environ, {sync.VENDOR_CONFIG[vendor]['auth_env']: secret}, clear=True):
                with patch.object(sync, 'urlopen') as request:
                    request.return_value.__enter__.return_value.read.return_value = b'{}'
                    sync.fetch_summary(vendor)
                    self.assertEqual(request.call_args.args[0].get_header(header), secret)

    def test_auth_failure_is_not_retried_or_exposed(self):
        error = HTTPError('https://example.com', 401, 'private server body', {}, None)
        with patch.dict(os.environ, {'MINIMAX_COOKIE': 'fake'}, clear=True):
            with patch.object(sync, 'urlopen', side_effect=error) as request, patch.object(sync.time, 'sleep') as sleep:
                with self.assertRaises(RuntimeError) as caught:
                    sync.fetch_summary('minimax')
                self.assertEqual(request.call_count, 1)
                sleep.assert_not_called()
                reason = sync.failure_reason(caught.exception, 'MINIMAX_COOKIE')
                self.assertIn('401', reason)
                self.assertNotIn('private', reason)

    def test_partial_success_is_committed_but_run_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {'MINIMAX_COOKIE': 'fake', 'OPENAI_ADMIN_KEY': 'fake', 'RUNNER_TEMP': directory}
            with patch.dict(os.environ, env, clear=True), patch('sys.argv', ['sync_llm_usage.py']):
                with patch.object(sync, 'git_pull_target_repo'), patch.object(sync, 'git_commit_and_push_target_repo') as commit:
                    with patch.object(sync, 'refresh_vendor', side_effect=[HTTPError('https://example.com', 401, '', {}, None), Path('openai.json')]):
                        self.assertEqual(sync.main(), 1)
                        self.assertEqual(commit.call_args.args[0], [Path('openai.json')])
            statuses = json.loads((Path(directory) / 'llm-sync-status.json').read_text())['vendors']
            self.assertEqual([row['status'] for row in statuses], ['failed', 'skipped', 'success'])

    def test_optional_missing_is_skipped_but_requested_missing_fails(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(sync, 'git_pull_target_repo'):
            with patch('sys.argv', ['sync_llm_usage.py']):
                self.assertEqual(sync.main(), 0)
            with patch('sys.argv', ['sync_llm_usage.py', '--vendor', 'minimax']):
                self.assertEqual(sync.main(), 1)
