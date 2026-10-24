from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import git_ops


DATA = 'static/data/reading/highlights-meta.json'
APP = 'src/app.tsx'
SIDEBAR = 'src/components/DiaryLifeTime.tsx'
LEGACY = 'src/legacy.ts'


class GitOpsTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix='feei-git-ops-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.remote = self.root / 'remote.git'
        self.writer = self.root / 'writer'
        self.worker = self.root / 'worker'
        self.remote_updates = 0
        self.git(self.root, 'init', '--bare', '--initial-branch=main', str(self.remote))
        self.git(self.root, 'clone', str(self.remote), str(self.writer))
        self.configure(self.writer)
        self.write(self.writer, APP, 'base app\n')
        self.write(self.writer, LEGACY, 'legacy\n')
        self.write_data(self.writer, 'base')
        self.commit(self.writer, 'base')
        self.git(self.writer, 'push', '-u', 'origin', 'main')
        self.git(self.root, 'clone', str(self.remote), str(self.worker))
        self.configure(self.worker)

    def git(self, repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(['git', *args], cwd=repo, capture_output=True, text=True)
        if check:
            self.assertEqual(result.returncode, 0, f'git {args}: {result.stderr}\n{result.stdout}')
        return result

    def configure(self, repo: Path) -> None:
        for key, value in [('user.name', 'Test'), ('user.email', 'test@example.invalid'),
                           ('commit.gpgSign', 'false'), ('core.hooksPath', '/dev/null')]:
            self.git(repo, 'config', key, value)

    def write(self, repo: Path, path: str, content: str) -> None:
        file = repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)

    def write_data(self, repo: Path, value: str) -> None:
        self.write(repo, DATA, json.dumps({'fetchedAt': value}, indent=2) + '\n')

    def commit(self, repo: Path, message: str) -> str:
        self.git(repo, 'add', '-A')
        self.git(repo, 'commit', '-m', message)
        return self.git(repo, 'rev-parse', 'HEAD').stdout.strip()

    def local_update(self, value: str = 'local') -> str:
        self.write_data(self.worker, value)
        self.git(self.worker, 'add', '--', DATA)
        self.git(self.worker, 'commit', '-m', 'local data update')
        return self.git(self.worker, 'rev-parse', 'HEAD').stdout.strip()

    def remote_update(self, value: str | None = None) -> str:
        self.remote_updates += 1
        self.write(self.writer, APP, f'remote app {self.remote_updates}\n')
        self.write(self.writer, SIDEBAR, 'restored diary sidebar\n')
        (self.writer / LEGACY).unlink(missing_ok=True)
        if value is not None:
            self.write_data(self.writer, value)
        head = self.commit(self.writer, f'remote update {self.remote_updates}')
        self.git(self.writer, 'push')
        return head

    def remote_file(self, path: str) -> str:
        return self.git(self.remote, 'show', f'main:{path}').stdout

    def assert_remote_code_preserved(self) -> None:
        self.assertEqual(self.remote_file(APP), f'remote app {self.remote_updates}\n')
        self.assertEqual(self.remote_file(SIDEBAR), 'restored diary sidebar\n')
        self.assertNotEqual(self.git(self.remote, 'cat-file', '-e', f'main:{LEGACY}', check=False).returncode, 0)

    def test_push_retry_preserves_remote_code(self) -> None:
        remote_head = self.remote_update()
        self.write_data(self.worker, 'local')
        git_ops.git_commit_and_push_target_repo([DATA], repo_root=self.worker, description='test data')
        self.assert_remote_code_preserved()
        self.assertEqual(json.loads(self.remote_file(DATA))['fetchedAt'], 'local')
        self.git(self.remote, 'merge-base', '--is-ancestor', remote_head, 'main')
        self.assertEqual(self.git(self.worker, 'diff', 'HEAD^', 'HEAD', '--name-only').stdout.strip(), DATA)
        self.assertEqual(self.git(self.worker, 'status', '--porcelain').stdout, '')

    def test_identical_data_already_upstream_is_safe(self) -> None:
        self.local_update('same')
        remote_head = self.remote_update('same')
        git_ops.git_push_with_retry(self.worker)
        self.assert_remote_code_preserved()
        self.assertEqual(self.git(self.worker, 'rev-parse', 'HEAD').stdout.strip(), remote_head)

    def test_conflict_aborts_rebase_and_keeps_both_versions(self) -> None:
        local_head = self.local_update()
        remote_head = self.remote_update('remote')
        with self.assertRaises(SystemExit):
            git_ops.git_push_with_retry(self.worker)
        self.assertEqual(self.git(self.worker, 'rev-parse', 'HEAD').stdout.strip(), local_head)
        self.assertEqual(self.git(self.remote, 'rev-parse', 'main').stdout.strip(), remote_head)
        self.assertEqual(json.loads((self.worker / DATA).read_text())['fetchedAt'], 'local')
        self.assertEqual(json.loads(self.remote_file(DATA))['fetchedAt'], 'remote')
        self.assertEqual(self.git(self.worker, 'status', '--porcelain').stdout, '')
        self.assertFalse((self.worker / '.git/rebase-merge').exists())
        self.assert_remote_code_preserved()

    def test_dirty_index_and_worktree_are_preserved(self) -> None:
        local_head = self.local_update()
        self.remote_update()
        self.git(self.worker, 'config', 'rebase.autoStash', 'true')
        self.write(self.worker, APP, 'staged draft\n')
        self.git(self.worker, 'add', '--', APP)
        self.write(self.worker, APP, 'unstaged draft\n')
        staged = self.git(self.worker, 'diff', '--cached').stdout
        unstaged = self.git(self.worker, 'diff').stdout
        with self.assertRaises(SystemExit):
            git_ops.git_push_with_retry(self.worker)
        self.assertEqual(self.git(self.worker, 'rev-parse', 'HEAD').stdout.strip(), local_head)
        self.assertEqual(self.git(self.worker, 'diff', '--cached').stdout, staged)
        self.assertEqual(self.git(self.worker, 'diff').stdout, unstaged)
        self.assertEqual(self.git(self.worker, 'stash', 'list').stdout, '')
        self.assert_remote_code_preserved()

    def test_untracked_file_is_not_overwritten(self) -> None:
        local_head = self.local_update()
        self.remote_update()
        self.write(self.worker, SIDEBAR, 'untracked draft\n')
        with self.assertRaises(SystemExit):
            git_ops.git_push_with_retry(self.worker)
        self.assertEqual((self.worker / SIDEBAR).read_text(), 'untracked draft\n')
        self.assertEqual(self.git(self.worker, 'rev-parse', 'HEAD').stdout.strip(), local_head)
        self.assert_remote_code_preserved()

    def test_existing_rebase_is_not_aborted(self) -> None:
        self.local_update()
        self.remote_update('remote')
        self.git(self.worker, 'fetch', 'origin')
        self.assertNotEqual(self.git(self.worker, 'rebase', 'origin/main', check=False).returncode, 0)
        state = self.git(self.worker, 'status', '--porcelain').stdout
        head = self.git(self.worker, 'rev-parse', 'HEAD').stdout
        actions = [
            lambda: git_ops.git_push_with_retry(self.worker),
            lambda: git_ops.git_pull_target_repo(self.worker),
            lambda: git_ops.git_commit_and_push_target_repo([DATA], repo_root=self.worker, description='test data'),
        ]
        for action in actions:
            with self.assertRaises(SystemExit):
                action()
            self.assertTrue((self.worker / '.git/rebase-merge').exists())
            self.assertEqual(self.git(self.worker, 'status', '--porcelain').stdout, state)
            self.assertEqual(self.git(self.worker, 'rev-parse', 'HEAD').stdout, head)

    def test_normal_push_commits_only_requested_data(self) -> None:
        self.write(self.worker, APP, 'staged draft\n')
        self.git(self.worker, 'add', '--', APP)
        self.write_data(self.worker, 'local')
        git_ops.git_commit_and_push_target_repo([DATA], repo_root=self.worker, description='test data')
        self.assertEqual(self.remote_file(APP), 'base app\n')
        self.assertEqual(self.git(self.worker, 'diff', '--cached', '--name-only').stdout.strip(), APP)
        self.assertEqual((self.worker / APP).read_text(), 'staged draft\n')

    def test_rebase_does_not_move_other_local_branches(self) -> None:
        local_head = self.local_update()
        self.git(self.worker, 'branch', 'user-work', local_head)
        self.git(self.worker, 'config', 'rebase.updateRefs', 'true')
        self.remote_update()
        git_ops.git_push_with_retry(self.worker)
        self.assertEqual(self.git(self.worker, 'rev-parse', 'user-work').stdout.strip(), local_head)
        self.assert_remote_code_preserved()

    def test_repeated_races_stop_without_overwriting_remote(self) -> None:
        self.local_update()
        original = git_ops.run_git_with_network_retry
        pushes = 0

        def race(args, cwd, **kwargs):
            nonlocal pushes
            if args[-1] == 'push':
                pushes += 1
                self.remote_update()
            return original(args, cwd, **kwargs)

        with patch.object(git_ops, 'run_git_with_network_retry', side_effect=race):
            with self.assertRaises(SystemExit):
                git_ops.git_push_with_retry(self.worker, max_attempts=2)
        self.assertEqual(pushes, 2)
        self.assert_remote_code_preserved()
        self.assertEqual(json.loads(self.remote_file(DATA))['fetchedAt'], 'base')
        self.assertEqual(json.loads((self.worker / DATA).read_text())['fetchedAt'], 'local')


if __name__ == '__main__':
    unittest.main()
