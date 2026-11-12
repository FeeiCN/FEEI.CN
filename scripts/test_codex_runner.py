import json
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

import codex_runner as runner


class CodexRunnerTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'})
        env.start()
        self.addCleanup(env.stop)
        version = patch.object(runner, 'cli_version', return_value='codex-cli ' + runner.CODEX_VERSION)
        version.start()
        self.addCleanup(version.stop)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        temp_env = patch.dict(os.environ, {'RUNNER_TEMP': str(self.root)})
        temp_env.start()
        self.addCleanup(temp_env.stop)
        self.output = self.root / 'result.json'
        self.schema = self.root / 'schema.json'
        self.schema.write_text(json.dumps({'type': 'object', 'additionalProperties': False,
                                          'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok']}))

    def invoke(self, **kwargs):
        return runner.run_codex('test prompt', output=self.output, cwd=self.root, timeout=2, **kwargs)

    def complete(self, command, **kwargs):
        self.output.write_text('{"ok":true}')
        return subprocess.CompletedProcess(command, 0)

    def test_default_is_readonly_and_credentials_are_not_command_arguments(self):
        with patch.dict(os.environ, {'OPENAI_BASE_URL': 'https://proxy.example/v1/',
                                    'OPENAI_API_KEY': 'test-secret', 'OPENAI_MODEL': 'configured-model'}):
            with patch.object(runner, 'run_process', side_effect=self.complete) as call:
                self.assertEqual(self.invoke(schema=self.schema), '{"ok":true}')
        command = call.call_args.args[0]
        self.assertEqual(command[command.index('--sandbox') + 1], 'read-only')
        self.assertIn('approval_policy="never"', command)
        self.assertIn('model_providers.custom.base_url="https://proxy.example/v1"', command)
        self.assertIn('configured-model', command)
        self.assertNotIn('test-secret', ' '.join(command))
        exclusion = next(x for x in command if x.startswith('shell_environment_policy.exclude='))
        self.assertTrue({'OPENAI_*', 'GH_*', 'GITHUB_*', 'ACTIONS_*'}.issubset(json.loads(exclusion.split('=', 1)[1])))

    def test_explicit_profiles_and_diagnosis_token_exception(self):
        profile = '{extends=":read-only", filesystem={":workspace_roots"={output="write"}}}'
        with patch.object(runner, 'run_process', side_effect=self.complete) as call:
            self.invoke(permissions=profile, profile='diagnosis', github_read=True)
        command = call.call_args.args[0]
        self.assertIn('permissions.diagnosis=' + profile, command)
        self.assertNotIn('--sandbox', command)
        self.assertIn('shell_environment_policy.exclude=["OPENAI_*", "ACTIONS_*"]', command)

    def test_failure_removes_stale_output_and_never_retries(self):
        self.output.write_text('old success')
        with patch.object(runner, 'run_process', return_value=subprocess.CompletedProcess([], 7)) as call:
            with self.assertRaises(runner.CodexError) as caught:
                self.invoke()
        self.assertEqual(caught.exception.returncode, 7)
        self.assertFalse(self.output.exists())
        call.assert_called_once()

    def test_timeout_is_propagated_without_retry(self):
        with patch.object(runner, 'run_process', side_effect=subprocess.TimeoutExpired('codex', 2)) as call:
            with self.assertRaises(subprocess.TimeoutExpired):
                self.invoke()
        call.assert_called_once()

    def test_missing_empty_oversized_and_invalid_structured_outputs_fail(self):
        for body in (None, '', 'x' * 101, 'not json', '{}', '{"ok":1}', '{"ok":true,"extra":0}'):
            def complete(command, **kwargs):
                if body is not None:
                    self.output.write_text(body)
                return subprocess.CompletedProcess(command, 0)
            with self.subTest(body=body), patch.object(runner, 'run_process', side_effect=complete):
                with self.assertRaises(ValueError):
                    self.invoke(schema=self.schema, max_bytes=100)

    def test_plain_text_and_separate_logs(self):
        log, err = self.root / 'phase.log', self.root / 'phase.err'
        def complete(command, **kwargs):
            kwargs['stdout'].write('progress')
            kwargs['stderr'].write('details')
            self.output.write_text('translated text')
            return subprocess.CompletedProcess(command, 0)
        with patch.object(runner, 'run_process', side_effect=complete):
            self.assertEqual(self.invoke(stdout_log=log, stderr_log=err), 'translated text')
        self.assertEqual(log.read_text(), 'progress')
        self.assertEqual(err.read_text(), 'details')

    def test_cli_invokes_child_and_preserves_failure_exit_status(self):
        binary = self.root / 'codex'
        binary.write_text('#!' + sys.executable + '''
import os, sys
from pathlib import Path
if '--version' in sys.argv:
    print('codex-cli 0.164.0')
    sys.exit(0)
if os.environ.get('FAKE_FAIL'):
    sys.exit(9)
assert sys.stdin.read() == 'test prompt'
assert sys.argv[1] == 'exec'
assert sys.argv[sys.argv.index('--sandbox') + 1] == 'read-only'
Path(sys.argv[sys.argv.index('--output-last-message') + 1]).write_text('{"ok":true}')
''')
        binary.chmod(0o755)
        prompt = self.root / 'prompt.md'
        prompt.write_text('test prompt')
        command = [sys.executable, runner.__file__, '--prompt', str(prompt), '--output', str(self.output),
                   '--schema', str(self.schema), '--cwd', str(self.root), '--timeout', '5']
        env = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH']}
        completed = subprocess.run(command, env=env, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(self.output.read_text()), {'ok': True})
        completed = subprocess.run(command, env={**env, 'FAKE_FAIL': '1'}, capture_output=True, text=True)
        self.assertEqual(completed.returncode, 9, completed.stderr)
        self.assertFalse(self.output.exists())

    def test_translation_uses_shared_runner_and_keeps_error_contract(self):
        import translate_text
        with patch.object(translate_text, '_resolve_codex_bin', return_value='codex'), \
                patch.object(translate_text, 'run_codex', return_value='中文译文') as call:
            self.assertEqual(translate_text._call_codex('article', timeout=30, model='chosen'), '中文译文')
            self.assertEqual(call.call_args.kwargs['model'], 'chosen')
            self.assertIn('<source_article>\narticle\n</source_article>', call.call_args.args[0])
        for error in [runner.CodexError('failed', 3), ValueError('empty'), subprocess.TimeoutExpired('codex', 30)]:
            with patch.object(translate_text, '_resolve_codex_bin', return_value='codex'), \
                    patch.object(translate_text, 'run_codex', side_effect=error), \
                    self.assertRaises(translate_text.TranslationError):
                translate_text._call_codex('article', timeout=30, model=None)

    def test_receipts_keep_versions_and_hashes_without_prompt_or_credentials(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'private-test-key'}), \
                patch.object(runner, 'run_process', side_effect=self.complete):
            self.invoke(stage='review-0', attempt=2)
        record = json.loads(next((self.root / 'codex-executions').glob('*.json')).read_text())
        self.assertEqual(record['status'], 'completed')
        self.assertEqual(record['attempt'], 2)
        self.assertEqual(record['cli_version'], 'codex-cli ' + runner.CODEX_VERSION)
        self.assertEqual(len(record['prompt_sha256']), 64)
        self.assertNotIn('test prompt', json.dumps(record))
        self.assertNotIn('private-test-key', json.dumps(record))

    def test_online_missing_connection_or_wrong_version_fails_before_execution(self):
        env = {'GITHUB_ACTIONS': 'true', 'OPENAI_MODEL': 'configured',
               'OPENAI_BASE_URL': 'https://proxy.example/v1', 'OPENAI_API_KEY': ''}
        with patch.dict(os.environ, env), patch.object(runner, 'run_process') as call:
            with self.assertRaisesRegex(ValueError, '配置不完整'):
                self.invoke()
            call.assert_not_called()
        env['OPENAI_API_KEY'] = 'private-test-key'
        with patch.dict(os.environ, env), patch.object(runner, 'cli_version', return_value='codex-cli 0.0.0'), \
                patch.object(runner, 'run_process') as call:
            with self.assertRaisesRegex(ValueError, '版本'):
                self.invoke()
            call.assert_not_called()

    def test_progress_is_visible_without_echoing_raw_logs(self):
        code = 'import time; print("private log", flush=True); time.sleep(.12)'
        with (self.root / 'stdout').open('w') as stdout, (self.root / 'stderr').open('w') as stderr, \
                redirect_stderr(io.StringIO()) as progress:
            result = runner.run_process([sys.executable, '-c', code], input='', stdout=stdout,
                                        stderr=stderr, cwd=self.root, timeout=2, heartbeat=.03)
        self.assertEqual(result.returncode, 0)
        self.assertIn('log_idle=', progress.getvalue())
        self.assertNotIn('private log', progress.getvalue())

    def assert_not_running(self, pid):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            stat = Path(f'/proc/{pid}/stat')
            try:
                if stat.exists() and stat.read_text().split()[2] == 'Z':
                    return
                os.kill(pid, 0)
            except (ProcessLookupError, FileNotFoundError):
                return
            time.sleep(.02)
        self.fail(f'child {pid} remains alive')

    def child_program(self):
        child = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)'
        return ('import subprocess,sys,time; from pathlib import Path; '
                f'p=subprocess.Popen([sys.executable,"-c",{child!r}]); '
                'Path("child.pid").write_text(str(p.pid)); time.sleep(30)')

    @unittest.skipUnless(os.name == 'posix', 'Actions and local runners use POSIX process groups')
    def test_timeout_kills_even_tools_ignoring_termination(self):
        with (self.root / 'stdout').open('w') as stdout, (self.root / 'stderr').open('w') as stderr:
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.run_process([sys.executable, '-c', self.child_program()], input='', stdout=stdout,
                                   stderr=stderr, cwd=self.root, timeout=.4)
        self.assert_not_running(int((self.root / 'child.pid').read_text()))

    @unittest.skipUnless(os.name == 'posix', 'Actions and local runners use POSIX process groups')
    def test_workflow_termination_cleans_descendants(self):
        code = ('import sys; from pathlib import Path; '
                f'sys.path.insert(0,{str(Path(runner.__file__).parent)!r}); import codex_runner as r; '
                'out=Path("stdout").open("w"); err=Path("stderr").open("w"); '
                f'r.run_process([sys.executable,"-c",{self.child_program()!r}], '
                'input="",stdout=out,stderr=err,cwd=Path.cwd(),timeout=25)')
        process = subprocess.Popen([sys.executable, '-c', code], cwd=self.root,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 5
            while not (self.root / 'child.pid').exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue((self.root / 'child.pid').exists())
            process.terminate()
            process.wait(timeout=8)
            self.assert_not_running(int((self.root / 'child.pid').read_text()))
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


if __name__ == '__main__':
    unittest.main()
