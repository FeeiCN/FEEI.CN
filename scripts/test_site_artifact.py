import copy
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import site_artifact as artifact

ROOT = Path(__file__).resolve().parents[1]
REPO = 'owner/site'
SHA = 'a' * 40


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.build = self.root / 'build'
        self.build.mkdir()
        self.output = self.root / 'bundle'
        for name in ['index.html', 'assets/site.js', 'data/health/raw.json', 'media/photo.jpg', 'music/song.mp3',
                     'search-index.json', 'search-index-assets/old.gz', '.private']:
            file = self.build / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(name)
        artifact.package(self.build, self.output, REPO, SHA, '123', '2')

    def test_package_round_trip_excludes_shared_data_media_and_old_indexes(self):
        destination = self.root / 'extracted'
        artifact.verify(self.output, REPO, SHA, '123', '2', destination)
        files = sorted(path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file())
        self.assertEqual(files, ['assets/site.js', 'index.html'])
        self.assertEqual((destination / 'index.html').read_text(), 'index.html')

    def test_commit_repository_attempt_and_digest_must_match_before_extract(self):
        for params in [(REPO, 'b' * 40, '123', '2'), ('other/repo', SHA, '123', '2'), (REPO, SHA, '123', '1')]:
            with self.subTest(params=params), self.assertRaises(ValueError):
                artifact.verify(self.output, *params, self.root / 'bad')
        self.assertFalse((self.root / 'bad').exists())
        with (self.output / 'site.tar.gz').open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaises(ValueError):
            artifact.verify(self.output, REPO, SHA, '123', '2', self.root / 'bad')

    def test_unsafe_archive_entries_and_links_never_extract(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('data/private.json', tarfile.REGTYPE), ('assets/link', tarfile.SYMTYPE),
                           ('assets/hard', tarfile.LNKTYPE), ('./index.html', tarfile.REGTYPE)]:
            with self.subTest(name=name):
                archive = self.output / 'site.tar.gz'
                with tarfile.open(archive, 'w:gz') as bundle:
                    info = tarfile.TarInfo(name)
                    info.type = kind
                    info.linkname = '../elsewhere' if kind != tarfile.REGTYPE else ''
                    info.size = 1 if kind == tarfile.REGTYPE else 0
                    bundle.addfile(info, io.BytesIO(b'x') if info.size else None)
                metadata = json.loads((self.output / 'manifest.json').read_text())
                metadata['sha256'] = artifact.sha256(archive)
                (self.output / 'manifest.json').write_text(json.dumps(metadata))
                with self.assertRaises(ValueError):
                    artifact.verify(self.output, REPO, SHA, '123', '2', self.root / 'bad')
                self.assertFalse((self.root / 'bad').exists())

    def test_source_must_be_successful_main_check_from_same_repository(self):
        run = {'id': 123, 'status': 'completed', 'conclusion': 'success', 'head_branch': 'main', 'event': 'push',
               'head_repository': {'full_name': REPO}, 'workflow_id': 42, 'path': '.github/workflows/check.yml',
               'head_sha': SHA, 'run_attempt': 2}
        artifact.validate_run(REPO, run, 42)
        for mutation in [{'conclusion': 'failure'}, {'event': 'pull_request'}, {'head_branch': 'feature'},
                         {'head_repository': {'full_name': 'fork/site'}}, {'workflow_id': 43},
                         {'path': '.github/workflows/other.yml'}, {'status': 'in_progress'}]:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                artifact.validate_run(REPO, {**run, **mutation}, 42)
        responses = [{'sha': SHA}, {'id': 42}, run,
                     {'artifacts': [{'id': 77, 'name': artifact.artifact_name(SHA, 123, 2), 'expired': False}]}]
        with patch.object(artifact, 'gh', side_effect=copy.deepcopy(responses)):
            self.assertEqual(artifact.resolve(REPO, '123')['artifact_id'], '77')
        with patch.object(artifact, 'gh', side_effect=[{'sha': 'b' * 40}, {'id': 42}, run]):
            self.assertEqual(artifact.resolve(REPO, '123'), {'ready': 'false'})
        responses[-1]['artifacts'][0]['expired'] = True
        with patch.object(artifact, 'gh', side_effect=responses), self.assertRaises(ValueError):
            artifact.resolve(REPO, '123')


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.origin = self.root / 'origin'
        self.source = self.root / 'source'
        self.server = self.root / 'server'
        self.site = self.root / 'site'
        self.site.mkdir()
        self.command(['git', 'init', '--bare', '--initial-branch=main', str(self.origin)])
        self.command(['git', 'clone', str(self.origin), str(self.source)])
        self.command(['git', 'config', 'user.name', 'Test'], self.source)
        self.command(['git', 'config', 'user.email', 'test@example.invalid'], self.source)
        for name, content in {
            'scripts/build_weather_cache.mjs': '', 'scripts/sleep_score_storage.py': '',
            'static/data/reading/day.json': 'new reading', 'static/data/health/day.json': 'old health',
            'docs/page.md': 'old page',
        }.items():
            file = self.source / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        shutil.copy2(ROOT / 'scripts/deployment_scope.mjs', self.source / 'scripts/deployment_scope.mjs')
        self.first = self.commit()
        self.command(['git', 'clone', str(self.origin), str(self.server)])
        previous = self.site / 'releases' / self.first
        previous.mkdir(parents=True)
        for name in ['index.html', 'search-index.json', 'search-index-manifest.json', 'search-index-status.json', 'search-index-assets/old.gz']:
            file = previous / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('previous:' + name)
        (self.site / 'current').symlink_to(previous)
        self.env = {**os.environ, 'REPO_DIR': str(self.server), 'SITE_ROOT': str(self.site),
                    'MEDIA_ROOT': str(self.root / 'media'), 'MUSIC_ROOT': str(self.root / 'music'),
                    'DATA_ROOT': str(self.root / 'data'), 'GITHUB_REPOSITORY': REPO,
                    'SITE_RUN_ID': '123', 'SITE_ATTEMPT': '2'}
        (self.root / 'data/health').mkdir(parents=True)
        (self.root / 'data/health/day.json').write_text('live health')
        if not shutil.which('flock'):
            binary = self.root / 'bin'
            binary.mkdir()
            flock = binary / 'flock'
            flock.write_text('#!/usr/bin/env python3\nimport fcntl,sys\nfcntl.flock(int(sys.argv[-1]), fcntl.LOCK_EX)\n')
            flock.chmod(0o755)
            self.env['PATH'] = str(binary) + os.pathsep + os.environ['PATH']

    def command(self, command, cwd=None, env=None):
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def commit(self):
        self.command(['git', 'add', '.'], self.source)
        self.command(['git', 'commit', '-m', 'test'], self.source)
        self.command(['git', 'push', 'origin', 'main'], self.source)
        return self.command(['git', 'rev-parse', 'HEAD'], self.source)

    def publish(self, commit):
        bundle = self.site / 'incoming' / 'test'
        build = self.root / 'build'
        build.mkdir(exist_ok=True)
        (build / 'index.html').write_text('new page')
        artifact.package(build, bundle, REPO, commit, '123', '2')
        shutil.copy2(ROOT / 'scripts/site_artifact.py', bundle / 'site_artifact.py')
        return self.command(['bash', str(ROOT / 'scripts/publish_site_artifact.sh'), str(bundle), commit],
                        env={**self.env, 'SITE_COMMIT': commit})

    def test_page_publish_reuses_index_and_live_data_and_duplicate_is_noop(self):
        (self.source / 'docs/page.md').write_text('new page')
        second = self.commit()
        self.assertIn('Published ' + second, self.publish(second))
        current = (self.site / 'current').resolve()
        self.assertEqual(current.name, second)
        self.assertEqual((current / 'index.html').read_text(), 'new page')
        self.assertEqual((current / 'search-index-assets/old.gz').read_text(), 'previous:search-index-assets/old.gz')
        self.assertEqual((current / 'search-index-status.json').read_text(), 'previous:search-index-status.json')
        self.assertEqual((current / 'data/health/day.json').read_text(), 'live health')
        self.assertEqual((current / 'data/reading/day.json').read_text(), 'new reading')
        self.assertIn('already published', self.publish(second))
        self.assertFalse((self.site / 'incoming/test').exists())

    def test_old_artifact_cannot_roll_back_and_data_only_updates_reuse_pages(self):
        (self.source / 'static/data/reading/day.json').write_text('latest reading')
        second = self.commit()
        self.assertIn('Superseded artifact', self.publish(self.first))
        self.assertIn('published pages reused', self.publish(second))
        self.assertEqual((self.site / 'current').resolve().name, self.first)
        self.assertEqual((self.root / 'data/reading/day.json').read_text(), 'latest reading')


if __name__ == '__main__':
    unittest.main()
