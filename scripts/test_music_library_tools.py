import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import download_music_lyrics as lyrics


class LyricsUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.music = self.root / 'music'
        self.music.mkdir()
        self.playlist = self.root / 'playlist.ts'
        self.mapping = self.root / 'localLyrics.ts'
        self.report = self.root / 'report.json'
        self.paths = patch.multiple(lyrics, PLAYLIST_PATH=self.playlist, MUSIC_DIR=self.music,
                                    LYRICS_TS_PATH=self.mapping, REPORT_PATH=self.report)
        self.paths.start()
        self.addCleanup(self.paths.stop)
        self.playlist.write_text('''localTrack("Don't stop", 'Singer', 'new.flac'),
localTrack('Old song', 'Singer', 'remote.flac'),
''')
        lyrics.write_lyrics_module({'remote.flac': 'remote.lrc', 'removed.flac': 'removed.lrc'})
        (self.music / 'new.flac').write_bytes(b'audio fixture')

    def run_tool(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return lyrics.main(list(args))

    def test_selected_update_preserves_remote_mappings_and_is_idempotent(self):
        content = '[00:01.00]Fixture line\n[00:02.00]Another line\n'
        (self.music / 'new.lrc').write_text(content)
        self.report.write_text(json.dumps([{'file_name': 'remote.flac', 'status': 'synced'}]))
        with patch.object(lyrics, 'query_candidates', side_effect=AssertionError('Unexpected download')):
            self.assertEqual(self.run_tool('--audio-file', 'new.flac'), 0)
            first = self.mapping.read_bytes()
            self.assertEqual(self.run_tool('--audio-file', 'new.flac'), 0)
        self.assertEqual(self.mapping.read_bytes(), first)
        self.assertEqual((self.music / 'new.lrc').read_text(), content)
        self.assertEqual(lyrics.read_lyrics_module(), {
            'remote.flac': 'remote.lrc', 'removed.flac': 'removed.lrc', 'new.flac': 'new.lrc'})
        self.assertEqual(len(json.loads(self.report.read_text())), 2)

    def test_full_update_prunes_removed_track_but_keeps_registered_remote_track(self):
        (self.music / 'new.lrc').write_text('[00:01.00]Fixture\n')
        self.assertEqual(self.run_tool(), 0)
        self.assertEqual(lyrics.read_lyrics_module(), {'remote.flac': 'remote.lrc', 'new.flac': 'new.lrc'})

    def test_unregistered_or_missing_selected_audio_does_not_change_registry(self):
        before = self.mapping.read_bytes()
        for name in ['unknown.flac', 'remote.flac']:
            with self.subTest(name=name), self.assertRaises(SystemExit) as error:
                self.run_tool('--audio-file', name)
            self.assertEqual(error.exception.code, 2)
            self.assertEqual(self.mapping.read_bytes(), before)
        self.assertFalse(self.report.exists())

    def test_malformed_registry_is_not_overwritten(self):
        self.mapping.write_text('incomplete registry')
        with self.assertRaises(ValueError):
            self.run_tool('--audio-file', 'new.flac')
        self.assertEqual(self.mapping.read_text(), 'incomplete registry')

    def test_plain_lyrics_are_saved_without_invented_timestamps_or_sync_mapping(self):
        candidate = {'id': 1, 'trackName': "Don't stop", 'artistName': 'Singer',
                     'plainLyrics': 'Fixture line\nAnother line', 'duration': 30}
        with patch.object(lyrics, 'query_candidates', return_value=[candidate]):
            self.assertEqual(self.run_tool('--audio-file', 'new.flac'), 1)
        self.assertEqual((self.music / 'new.lyrics.txt').read_text(), 'Fixture line\nAnother line\n')
        self.assertFalse((self.music / 'new.lrc').exists())
        self.assertNotIn('new.flac', lyrics.read_lyrics_module())
        self.assertEqual(json.loads(self.report.read_text())[-1]['status'], 'plain_only')

    def test_downloaded_synced_lyrics_are_registered(self):
        content = '[00:01.00]Fixture line\n[00:02.00]Another line'
        candidate = {'id': 1, 'trackName': "Don't stop", 'artistName': 'Singer', 'syncedLyrics': content}
        with patch.object(lyrics, 'query_candidates', return_value=[candidate]):
            self.assertEqual(self.run_tool('--audio-file', 'new.flac'), 0)
        self.assertEqual((self.music / 'new.lrc').read_text(), content + '\n')
        self.assertEqual(lyrics.read_lyrics_module()['new.flac'], 'new.lrc')


class MusicUploadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'scripts').mkdir()
        self.script = self.root / 'scripts/sync-static-assets.sh'
        shutil.copyfile(Path(__file__).with_name('sync-static-assets.sh'), self.script)
        self.music = self.root / 'static/music'
        self.music.mkdir(parents=True)
        (self.music / '情歌.flac').write_bytes(b'audio fixture')
        (self.music / '情歌.lrc').write_text('[00:01.00]Fixture\n')
        self.files = self.root / 'files.txt'
        self.files.write_text('情歌.flac\n情歌.lrc\n')
        self.log = self.root / 'commands.jsonl'
        binaries = self.root / 'bin'
        binaries.mkdir()
        stub = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
with open(os.environ['MUSIC_TOOL_LOG'], 'a') as out:
    out.write(json.dumps({'tool': Path(sys.argv[0]).name, 'args': sys.argv[1:]}) + '\\n')
'''
        for name in ['ssh', 'rsync']:
            path = binaries / name
            path.write_text(stub)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ['PATH'],
                        MUSIC_TOOL_LOG=str(self.log), ASSETS_SYNC_ICONV='auto',
                        ASSETS_SYNC_REMOTE_HOST='fixture.invalid')

    def run_tool(self, *args):
        return subprocess.run(['bash', str(self.script), *args], env=self.env, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_targeted_upload_only_sends_listed_music_and_does_not_require_media(self):
        result = self.run_tool('--music-files-from', str(self.files))
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = self.calls()
        transfers = [x['args'] for x in commands if x['tool'] == 'rsync' and '--version' not in x['args']]
        self.assertEqual(len(transfers), 1)
        self.assertIn('--files-from=' + str(self.files), transfers[0])
        self.assertIn(str(self.music) + '/', transfers[0])
        self.assertFalse(any('media' in arg for call in commands for arg in call['args']))
        self.assertFalse(any('--delete' in arg for arg in transfers[0]))

    def test_preview_does_not_create_remote_directories(self):
        result = self.run_tool('--music-files-from', str(self.files), '--dry-run')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(x['tool'] == 'ssh' for x in self.calls()))
        self.assertTrue(any('--dry-run' in x['args'] for x in self.calls()))

    def test_invalid_or_empty_list_is_rejected_before_network_calls(self):
        outside = self.root / 'outside.txt'
        outside.write_text('fixture')
        (self.music / 'escape.flac').symlink_to(outside)
        for text in ['', '../outside.txt\n', str(outside) + '\n', 'missing.flac\n', 'escape.flac\n']:
            with self.subTest(text=text):
                self.files.write_text(text)
                self.assertNotEqual(self.run_tool('--music-files-from', str(self.files)).returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_targeted_upload_rejects_delete(self):
        result = self.run_tool('--music-files-from', str(self.files), '--delete')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_default_mode_still_syncs_both_asset_directories(self):
        (self.root / 'static/media').mkdir()
        result = self.run_tool('--dry-run')
        self.assertEqual(result.returncode, 0, result.stderr)
        transfers = [x['args'] for x in self.calls() if x['tool'] == 'rsync' and '--version' not in x['args']]
        self.assertEqual(len(transfers), 2)
        self.assertTrue(any(str(self.root / 'static/media') + '/' in args for args in transfers))


if __name__ == '__main__':
    unittest.main()
