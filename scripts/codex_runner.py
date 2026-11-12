#!/usr/bin/env python3
"""Shared Codex invocation; task preparation, review and delivery stay with callers."""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CODEX_VERSION = '0.164.0'


class CodexError(RuntimeError):
    def __init__(self, message, returncode=1):
        super().__init__(message)
        self.returncode = returncode


def validate_shape(value, schema):
    types = {'object': dict, 'array': list, 'string': str, 'integer': int,
             'number': (int, float), 'boolean': bool, 'null': type(None)}
    kind = schema.get('type')
    if kind not in types or not isinstance(value, types[kind]) or (
            kind in ('integer', 'number') and isinstance(value, bool)):
        raise ValueError('Codex 结果类型不符合 schema')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError('Codex 结果不符合 schema 枚举')
    if kind == 'object':
        if not set(schema.get('required', [])).issubset(value):
            raise ValueError('Codex 结果缺少必填字段')
        properties = schema.get('properties', {})
        if schema.get('additionalProperties') is False and set(value) - set(properties):
            raise ValueError('Codex 结果含额外字段')
        for key in value.keys() & properties.keys():
            validate_shape(value[key], properties[key])
    if kind == 'array':
        for item in value:
            validate_shape(item, schema['items'])


class CodexCancelled(InterruptedError):
    def __init__(self, signum):
        super().__init__('Codex 执行被取消')
        self.returncode = 128 + signum


def stop_process_group(process, grace=3):
    if os.name != 'posix':
        if process.poll() is None:
            process.kill()
        process.wait()
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run_process(command, *, input, stdout, stderr, cwd, timeout, stage='task', heartbeat=30):
    started = time.monotonic()
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                               text=True, cwd=cwd, start_new_session=os.name == 'posix')
    handlers = {}
    def cancel(signum, frame):
        raise CodexCancelled(signum)
    try:
        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM):
                handlers[signum] = signal.signal(signum, cancel)
        last_size, last_activity = None, started
        payload = input
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                process.communicate(input=payload, timeout=min(heartbeat, remaining))
                return subprocess.CompletedProcess(command, process.returncode)
            except subprocess.TimeoutExpired:
                payload = None
                now = time.monotonic()
                sizes = tuple(os.fstat(handle.fileno()).st_size for handle in dict.fromkeys((stdout, stderr)))
                if sizes != last_size:
                    last_activity, last_size = now, sizes
                print(f'[codex] stage={stage}; running={now - started:.0f}s; '
                      f'log_idle={now - last_activity:.0f}s; log_bytes={sum(sizes)}',
                      file=sys.stderr, flush=True)
    finally:
        # Also reap tools left behind after the parent exits successfully.
        for signum in handlers:
            signal.signal(signum, signal.SIG_IGN)
        try:
            stop_process_group(process)
        finally:
            for signum, handler in handlers.items():
                signal.signal(signum, handler)
            if process.stdin:
                process.stdin.close()


@lru_cache(maxsize=16)
def cli_version(binary):
    try:
        version = subprocess.check_output([binary, '--version'], text=True, stderr=subprocess.DEVNULL, timeout=10).strip()
        return version if re.fullmatch(r'codex-cli [0-9.]+', version) else 'unknown'
    except (OSError, subprocess.SubprocessError, TypeError):
        return 'unknown'


def repository_commit(cwd):
    try:
        value = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd,
                                        text=True, stderr=subprocess.DEVNULL, timeout=5).strip()
        return value if re.fullmatch(r'[a-f0-9]{40}', value) else None
    except (OSError, subprocess.SubprocessError, TypeError):
        return None


def run_codex(prompt, *, output, timeout, cwd=ROOT, schema=None, permissions=None,
              profile='automation', sandbox='read-only', effort='high', search=None,
              exclude=(), github_read=False, ignore_user_config=False, model=None,
              binary='codex', stdout_log=None, stderr_log=None, max_bytes=2_000_000,
              stage='task', attempt=1, allow_shell=True):
    stage = stage if re.fullmatch(r'[a-z0-9_-]{1,80}', stage) else 'task'
    if os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('WORKFLOW_STATUS_SCRIPT'):
        try:
            subprocess.run([os.environ['WORKFLOW_STATUS_NODE'], os.environ['WORKFLOW_STATUS_SCRIPT'],
                            '--phase', 'verifying' if stage.startswith('review') else 'running'],
                           check=False, timeout=5)
        except (KeyError, OSError, subprocess.SubprocessError):
            print('任务阶段记录不可用，继续执行。', file=sys.stderr)
    started = time.monotonic()
    selected_model = model or os.environ.get('OPENAI_MODEL')
    record = {
        'stage': stage, 'attempt': attempt, 'status': 'preparing', 'failure_kind': None,
        'started_at': datetime.now(timezone.utc).isoformat(), 'timeout_seconds': timeout,
        'commit': repository_commit(cwd), 'trigger_commit': os.environ.get('GITHUB_SHA'),
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
        'permissions_sha256': hashlib.sha256((permissions or sandbox).encode()).hexdigest(),
        'cli_version': cli_version(binary), 'expected_cli_version': CODEX_VERSION,
        'model': selected_model, 'reasoning_effort': effort, 'schema': schema is not None,
        'allow_shell': allow_shell,
        'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'run_url': ('https://github.com/' + os.environ['GITHUB_REPOSITORY'] + '/actions/runs/'
                    + os.environ['GITHUB_RUN_ID']) if os.environ.get('GITHUB_REPOSITORY') and os.environ.get('GITHUB_RUN_ID') else None,
    }
    directory = Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())) / 'codex-executions'
    directory.mkdir(parents=True, exist_ok=True)
    receipt = directory / f'{stage}-{uuid.uuid4().hex}.json'
    def checkpoint():
        receipt.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    checkpoint()
    try:
        if not prompt.strip() or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Codex 提示词和执行时限必须有效')
        if sandbox not in ('read-only', 'workspace-write') or not re.fullmatch(r'[a-z_]+', profile):
            raise ValueError('Codex 权限参数无效')
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            if any(not os.environ.get(key, '').strip() for key in ('OPENAI_API_KEY', 'OPENAI_BASE_URL')) or not selected_model:
                raise ValueError('线上模型连接配置不完整')
            if record['cli_version'] != 'codex-cli ' + CODEX_VERSION:
                raise ValueError('Codex CLI 版本与已验证版本不一致')
        config = {'model_reasoning_effort': effort}
        if not allow_shell:
            config['features.shell_tool'] = False
        command = [binary, 'exec', '--cd', str(cwd), '--ephemeral']
        if ignore_user_config:
            command.append('--ignore-user-config')
        if permissions is not None:
            config.update({'default_permissions': profile, f'permissions.{profile}': permissions})
        else:
            command += ['--sandbox', sandbox]
        config['approval_policy'] = 'never'
        base_url = os.environ.get('OPENAI_BASE_URL', '').strip().rstrip('/')
        if base_url:
            config.update({'model_provider': 'custom', 'model_providers.custom.name': 'AI Proxy',
                           'model_providers.custom.base_url': base_url,
                           'model_providers.custom.wire_api': 'responses',
                           'model_providers.custom.env_key': 'OPENAI_API_KEY'})
        if search is not None:
            config['web_search'] = search
        exclusions = ['OPENAI_*', 'ACTIONS_*']
        if not github_read:
            exclusions += ['GH_*', 'GITHUB_*']
        config['shell_environment_policy.exclude'] = list(dict.fromkeys([*exclusions, *exclude]))
        for key, value in config.items():
            command += ['--config', key + '=' + (value if key.startswith('permissions.') else json.dumps(value))]
        if selected_model:
            command += ['--model', selected_model]
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.unlink(missing_ok=True)
        if schema is not None:
            command += ['--output-schema', str(schema)]
        command += ['--output-last-message', str(output), '-']
        record['status'] = 'running'
        checkpoint()
        print(f'[codex] stage={stage}; attempt={attempt}; timeout={timeout:g}s', file=sys.stderr, flush=True)
        with ExitStack() as stack:
            def log_file(path):
                if path is None:
                    return stack.enter_context(tempfile.TemporaryFile(mode='w+'))
                path = Path(path)
                path.parent.mkdir(parents=True, exist_ok=True)
                return stack.enter_context(path.open('w', encoding='utf-8'))
            stdout = log_file(stdout_log)
            stderr = stdout if stdout_log is not None and stdout_log == stderr_log else log_file(stderr_log)
            completed = run_process(command, input=prompt, stdout=stdout, stderr=stderr,
                                    cwd=cwd, timeout=timeout, stage=stage)
        record['exit_code'] = completed.returncode
        if completed.returncode:
            record['failure_kind'] = 'process_failed'
            raise CodexError(f'Codex 执行失败，退出码 {completed.returncode}', completed.returncode)
        if not output.is_file() or output.stat().st_size > max_bytes:
            raise ValueError('Codex 输出缺失或超过大小限制')
        text = output.read_text(encoding='utf-8').strip()
        if not text:
            raise ValueError('Codex 输出为空')
        if schema is not None:
            validate_shape(json.loads(text), json.loads(Path(schema).read_text(encoding='utf-8')))
        record.update(status='completed', output_bytes=output.stat().st_size)
        return text
    except subprocess.TimeoutExpired:
        record.update(status='timed_out', failure_kind='timeout')
        raise
    except CodexCancelled:
        record.update(status='cancelled', failure_kind='cancelled')
        raise
    except Exception:
        record.update(status='failed', failure_kind=record['failure_kind'] or
                      ('configuration' if record['status'] == 'preparing' else 'execution_or_validation'))
        raise
    finally:
        record.update(elapsed_seconds=round(time.monotonic() - started, 1),
                      finished_at=datetime.now(timezone.utc).isoformat())
        checkpoint()
        print(f"[codex] stage={stage}; {record['status']}; elapsed={record['elapsed_seconds']}s",
              file=sys.stderr, flush=True)
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary, 'a', encoding='utf-8') as stream:
                stream.write(f"- Codex `{stage}` attempt {attempt}: **{record['status']}**, "
                             f"{record['elapsed_seconds']}s, failure `{record['failure_kind'] or 'none'}`.\n")


def main():
    if sys.argv[1:] == ['install']:
        if cli_version('codex') == 'codex-cli ' + CODEX_VERSION:
            print('复用已安装的 codex-cli ' + CODEX_VERSION)
            return 0
        subprocess.run(['npm', 'install', '--global', '@openai/codex@' + CODEX_VERSION], check=True, timeout=180)
        cli_version.cache_clear()
        version = cli_version('codex')
        if version != 'codex-cli ' + CODEX_VERSION:
            raise ValueError('Codex CLI 安装后版本不符')
        print(version)
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompt', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cwd', type=Path, default=ROOT)
    parser.add_argument('--timeout', type=float, required=True)
    parser.add_argument('--schema', type=Path)
    parser.add_argument('--permission-config')
    parser.add_argument('--permission-profile', default='automation')
    parser.add_argument('--sandbox', choices=['read-only', 'workspace-write'], default='read-only')
    parser.add_argument('--effort', choices=['low', 'medium', 'high'], default='high')
    parser.add_argument('--web-search', choices=['live', 'disabled'])
    parser.add_argument('--exclude', action='append', default=[])
    parser.add_argument('--stdout-log', type=Path)
    parser.add_argument('--stderr-log', type=Path)
    parser.add_argument('--stage', default='task')
    args = parser.parse_args()
    try:
        run_codex(args.prompt.read_text(encoding='utf-8'), output=args.output, cwd=args.cwd,
                  timeout=args.timeout, schema=args.schema, permissions=args.permission_config,
                  profile=args.permission_profile, sandbox=args.sandbox, effort=args.effort,
                  search=args.web_search, exclude=args.exclude, stage=args.stage,
                  stdout_log=args.stdout_log, stderr_log=args.stderr_log)
    except CodexError as error:
        print(str(error), file=sys.stderr)
        return error.returncode if 0 < error.returncode < 256 else 1
    except CodexCancelled as error:
        print(str(error), file=sys.stderr)
        return error.returncode
    except subprocess.TimeoutExpired:
        print('Codex 执行超时', file=sys.stderr)
        return 124
    return 0


if __name__ == '__main__':
    sys.exit(main())
