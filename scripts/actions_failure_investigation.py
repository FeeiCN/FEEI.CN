"""Bounded read-only evidence for the current workflow; never execute target code."""
import io
import json
import re
import subprocess
import tempfile
import time
from urllib.parse import quote
import zipfile

MAX_REQUESTS = 12
MAX_SECONDS = 480
MAX_BYTES = 64000


def source_target(target):
    match = re.fullmatch(r'((?:scripts|\.github/workflows)/[\w./-]+\.(?:py|mjs|cjs|js|sh|ya?ml))(?::([1-9]\d*)-([1-9]\d*))?', target)
    if not match or '..' in match[1]:
        raise ValueError('源码路径不在允许范围')
    start, end = (int(match[2]), int(match[3])) if match[2] else (1, None)
    if end is not None and not start <= end < start + 200:
        raise ValueError('源码行范围必须为正向且不超过200行')
    return match[1], start, end


def status_records(data, redact):
    records = []
    if not isinstance(data, dict):
        return records
    for key in ('vendors', 'sources', 'checks'):
        items = data.get(key, [])
        if not isinstance(items, list):
            continue
        for item in items[:20]:
            if not isinstance(item, dict):
                continue
            status = item.get('status')
            if status not in ('success', 'failed', 'skipped', 'unavailable', 'available'):
                continue
            record = {'status': status}
            for field in ('vendor', 'name', 'reason'):
                if isinstance(item.get(field), str):
                    record[field] = redact(item[field])[:500]
            records.append(record)
    return records


def archive_status(raw, redact):
    if len(raw) > 256000:
        raise ValueError('状态产物压缩包超过读取上限')
    records = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) > 20 or sum(item.file_size for item in entries) > 256000:
            raise ValueError('状态产物解压大小超过读取上限')
        for item in entries:
            if not re.fullmatch(r'[\w-]*status[\w-]*\.json', item.filename):
                continue
            records.extend(status_records(json.loads(archive.read(item)), redact))
    return records


def download_status(repo, artifact_id, timeout=30):
    with tempfile.TemporaryFile() as stream:
        subprocess.run(['gh', 'api', f'repos/{repo}/actions/artifacts/{artifact_id}/zip'],
                       stdout=stream, stderr=subprocess.DEVNULL, timeout=timeout, check=True)
        stream.seek(0)
        raw = stream.read(256001)
    return raw


class Investigation:
    def __init__(self, context, repo, api, source, job_evidence, redact):
        self.context, self.repo = context, repo
        self.api, self.source, self.job_evidence, self.redact = api, source, job_evidence, redact
        self.start = time.monotonic()
        self.requests = 0
        self.seen = set()
        self.bytes = 0

    def read(self, endpoint):
        self.reserve()
        return self.api(endpoint)

    def reserve(self):
        if self.requests >= MAX_REQUESTS or time.monotonic() - self.start >= MAX_SECONDS:
            raise ValueError('只读调查预算已用完')
        self.requests += 1

    def request(self, action, target='', reason=''):
        if action in ('history', 'changes', 'artifacts'):
            target = ''
        key = (action, target)
        if key in self.seen:
            return False
        self.seen.add(key)
        item = {'action': action, 'target': target, 'reason': self.redact(reason)[:500]}
        run = self.context['run']
        prefix = f'repos/{self.repo}'
        try:
            if action == 'source':
                source_target(target)
                self.reserve()
                data = self.source(self.repo, target, run['head_sha'])
                if not data or data.startswith(('[源文件不可用]', '[文件过大')):
                    raise ValueError('目标提交的源码不可用')
                if self.bytes + len(data.encode()) > MAX_BYTES:
                    raise ValueError('源码补证超过大小预算')
                self.bytes += len(data.encode())
                self.context.setdefault('sources', {})[target] = data
                data = {'path': target, 'sha': run['head_sha']}
            elif action == 'history':
                workflow = quote(run['path'].split('/')[-1], safe='')
                data = self.read(f'{prefix}/actions/workflows/{workflow}/runs?branch=main&per_page=20')
                data = [{k: entry.get(k) for k in ('id', 'head_sha', 'conclusion', 'created_at', 'run_attempt')}
                        for entry in data.get('workflow_runs', [])
                        if entry.get('path', '').split('@')[0] == run['path']
                        and entry.get('head_branch') == 'main'
                        and (entry.get('head_repository') or {}).get('full_name', '').lower() == self.repo.lower()
                        and entry.get('created_at', '') < run.get('created_at', '')
                        and entry.get('status') == 'completed'][:10]
                self.context['history'] = data
                self.context['history_scope'] = '仅检查最近20次运行，保留其中较早的同仓库main结果；不代表完整历史。'
            elif action == 'changes':
                baseline = next((entry for entry in self.context.get('history', []) if entry['conclusion'] == 'success'), None)
                if not baseline:
                    raise ValueError('先查询历史；当前范围内尚无可用成功基线')
                data = self.read(f'{prefix}/compare/{baseline["head_sha"]}...{run["head_sha"]}')
                data = {'base_sha': baseline['head_sha'], 'head_sha': run['head_sha'],
                        'files': [{k: entry.get(k) for k in ('filename', 'status', 'additions', 'deletions')}
                                  for entry in data.get('files', [])[:100]],
                        'note': '最多列出100个变更文件，不代表完整差异；补读允许的源码以核对机制，不读取差异中的凭证或个人数据。'}
            elif action == 'job':
                if not target.isdigit():
                    raise ValueError('Job 编号无效')
                jobs = self.read(f'{prefix}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs?per_page=100')
                job = next((entry for entry in jobs.get('jobs', []) if str(entry['id']) == target), None)
                if not job:
                    raise ValueError('当前尝试的前100个Job中未找到该编号，未继续读取')
                # job_evidence has at most three downloads plus one annotation page.
                for _ in range(4):
                    self.reserve()
                data = {'job': self.redact(job['name']), 'evidence': self.job_evidence(self.repo, job)}
                self.context.setdefault('observed_job_ids', []).append(job['id'])
            elif action == 'artifacts':
                artifacts = self.read(f'{prefix}/actions/runs/{run["id"]}/artifacts?per_page=30')
                data = []
                for artifact in artifacts.get('artifacts', []):
                    if (not re.fullmatch(r'[\w-]*status[\w-]*', artifact.get('name', ''))
                            or artifact.get('expired') or artifact.get('size_in_bytes', 256001) > 256000
                            or (artifact.get('workflow_run') or {}).get('id') != run['id']):
                        continue
                    self.reserve()
                    records = archive_status(download_status(self.repo, artifact['id'], timeout=max(0.1, min(30, MAX_SECONDS - (time.monotonic() - self.start)))), self.redact)
                    data.append({'artifact': artifact['name'], 'records': records})
                    if len(data) >= 3:
                        break
            else:
                raise ValueError('未知只读调查动作')
            def sanitize(value):
                if isinstance(value, str):
                    return self.redact(value)
                if isinstance(value, list):
                    return [sanitize(entry) for entry in value]
                if isinstance(value, dict):
                    return {key: sanitize(entry) for key, entry in value.items()}
                return value
            clean = json.dumps(sanitize(data), ensure_ascii=False)
            if self.bytes + len(clean.encode()) > MAX_BYTES:
                raise ValueError('补证内容超过大小预算')
            self.bytes += len(clean.encode())
            item.update(state='read', data=json.loads(clean))
        except (ValueError, OSError, RuntimeError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
            item.update(state='unavailable', detail=self.redact(str(error))[:500])
        self.context.setdefault('investigation', []).append(item)
        return item['state'] == 'read'
