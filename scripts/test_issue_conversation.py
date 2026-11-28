from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import conversation as core
import issue_conversation as adapter


TARGET = 'docs/target.md'
PR_URL = 'https://github.com/owner/repo/pull/2'


class ConcurrentMainTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / 'site'
        self.root.mkdir()
        self.state = Path(temp.name) / 'state'
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.com')
        (self.root / 'docs').mkdir()
        self.commit_file(TARGET, 'original\n')
        self.base = self.git('rev-parse', 'HEAD')
        self.context = {'repository': 'owner/repo', 'session_id': 'owner/repo/issues/1',
                        'issue_number': 1, 'input_hash': 'test-request'}
        files = [{'path': TARGET, 'content': 'draft\n'}]
        self.draft = core.draft_version(self.context['session_id'], files,
                                       core.baselines(self.root, [TARGET]), self.base)
        self.result = {'response': {'message': '更新目标文档。'}}
        adapter.write_json(self.state / 'checked.json', adapter.validation_identity(self.context, self.draft, self.root))
        for name, return_value in [('check_fresh', ({}, self.context)), ('selected_draft', self.draft)]:
            mock = patch.object(adapter, name, return_value=return_value)
            mock.start()
            self.addCleanup(mock.stop)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True).strip()

    def commit_file(self, name, content):
        (self.root / name).write_text(content)
        self.git('add', '--', name)
        self.git('commit', '-qm', 'Update ' + name)

    def test_main_advance_on_unrelated_path_creates_pr_from_validated_commit(self):
        self.commit_file('docs/other.md', 'unrelated\n')
        main_head = self.git('rev-parse', 'HEAD')
        run = subprocess.run

        def local_only(args, **kwargs):
            self.assertEqual(args[0], 'git')
            if args[1] == 'ls-remote':
                return subprocess.CompletedProcess(args, 2, '', '')
            if args[1] == 'push':
                return subprocess.CompletedProcess(args, 0)
            return run(args, **kwargs)

        with patch.object(adapter, 'gh', side_effect=['[]', PR_URL]) as gh, \
                patch.object(adapter.subprocess, 'run', side_effect=local_only):
            receipt = adapter.execute_approved(self.context, self.result, self.root, self.state)

        self.assertEqual(receipt['review_url'], PR_URL)
        self.assertEqual(self.git('rev-parse', 'HEAD^'), self.base)
        self.assertEqual(self.git('rev-parse', 'main'), main_head)
        self.assertEqual(self.git('diff', '--name-only', 'main...HEAD'), TARGET)
        self.assertEqual(self.git('show', 'HEAD:' + TARGET), 'draft')
        self.assertEqual(gh.call_args.args[:2], ('pr', 'create'))

    def test_main_advance_on_target_path_blocks_delivery(self):
        self.commit_file(TARGET, 'concurrent change\n')
        main_head = self.git('rev-parse', 'HEAD')
        with patch.object(adapter, 'gh') as gh, self.assertRaisesRegex(ValueError, '目标文件已被更新'):
            adapter.execute_approved(self.context, self.result, self.root, self.state)
        gh.assert_not_called()
        self.assertEqual(self.git('rev-parse', 'HEAD'), main_head)
        self.assertEqual(self.git('branch', '--list'), '* main')


if __name__ == '__main__':
    unittest.main()
