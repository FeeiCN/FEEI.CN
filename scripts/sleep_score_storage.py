#!/usr/bin/env python3
"""Atomic sleep-score facts, immutable OCR imports, and rebuildable indexes."""
import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile

COMPONENTS = {'duration': 50, 'bedtime': 30, 'interruptions': 20}


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode()


def validate_record(record, require_complete=False):
    if not isinstance(record, dict):
        raise ValueError('睡眠评分应为 JSON 对象')
    date.fromisoformat(record['date'])
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', record['date']):
        raise ValueError('日期格式无效')
    if record.get('dataType') != 'HKDataTypeAppleSleepScore':
        raise ValueError('睡眠评分类型无效')
    if type(record.get('score')) is not int or not 0 <= record['score'] <= 100:
        raise ValueError('总分应为 0—100 的整数')
    components = record.get('components', {})
    if not isinstance(components, dict):
        raise ValueError('睡眠评分缺少分项对象')
    for key, maximum in COMPONENTS.items():
        component = components.get(key, {})
        if component is None and not require_complete:
            continue
        if (not isinstance(component, dict) or component.get('maximum') != maximum or type(component.get('score')) is not int
                or not 0 <= component['score'] <= maximum):
            raise ValueError('分项得分或满分无效：' + key)
    known = sum(components[key]['score'] for key in COMPONENTS if isinstance(components.get(key), dict))
    missing_maximum = sum(maximum for key, maximum in COMPONENTS.items() if components.get(key) is None)
    if not known <= record['score'] <= known + missing_maximum:
        raise ValueError('分项得分之和与总分不一致')


def facts(record):
    return {'date': record['date'], 'score': record['score'],
            'components': {key: record['components'][key]['score'] if record['components'].get(key) else None for key in COMPONENTS}}


def atomic_write(path, payload):
    data = canonical(payload)
    if path.exists() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return True


@contextmanager
def locked(root):
    root.mkdir(parents=True, exist_ok=True)
    with (root.parent / '.sleep-score.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def day_path(root, value):
    date.fromisoformat(value)
    return root / (value.replace('-', '/') + '.json')


def rebuild_index(root):
    rows, captured = [], []
    for path in sorted(root.glob('[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9].json')):
        record = json.loads(path.read_text())
        validate_record(record)
        if day_path(root, record['date']) != path:
            raise ValueError('日记录路径与日期不一致')
        rows.append([record['date'], record['score'], *[facts(record)['components'][key] for key in COMPONENTS]])
        if record.get('capturedAt'):
            captured.append(record['capturedAt'])
    atomic_write(root / 'index.json', {'version': 1, 'generatedAt': max(captured) if captured else None,
                                     'dates': [row[0] for row in rows], 'scores': rows})
    return len(rows)


def validate_submission(submission):
    record = submission['record']
    validate_record(record, require_complete=True)
    source = record.get('provenance', {})
    if (source.get('method') != 'shortcut_ocr' or type(source.get('issueNumber')) is not int
            or source['issueNumber'] < 1 or not re.fullmatch(r'[a-f0-9]{64}', source.get('bodySha256', ''))
            or source['bodySha256'] != hashlib.sha256(submission['rawText'].encode()).hexdigest()):
        raise ValueError('OCR 来源记录无效')
    capture_order(record)


def source_time(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError('评分来源时间无效') from error
    if parsed.tzinfo is None:
        raise ValueError('评分来源时间缺少时区')
    return parsed


def capture_order(record):
    source = record.get('provenance', {})
    return (source_time(source.get('issueCreatedAt') or record.get('capturedAt')),
            source.get('issueNumber', 0))


def archive_import(root, submission):
    source = submission['record']['provenance']
    path = root / 'imports' / str(source['issueNumber']) / (source['bodySha256'] + '.json')
    if path.exists():
        previous = json.loads(path.read_text())
        if previous['rawText'] != submission['rawText'] or facts(previous['record']) != facts(submission['record']):
            raise ValueError('相同来源哈希对应不同事实')
    else:
        atomic_write(path, submission)


def upsert(root, submission):
    validate_submission(submission)
    incoming = deepcopy(submission['record'])
    with locked(root):
        target = day_path(root, incoming['date'])
        existing = json.loads(target.read_text()) if target.exists() else None
        if existing:
            validate_record(existing)
        archive_import(root, submission)
        status = 'created'
        if existing:
            old_source = existing.get('provenance', {})
            source = incoming['provenance']
            same_issue = old_source.get('issueUrl') == source['issueUrl']
            if same_issue:
                if old_source.get('bodySha256') == source['bodySha256']:
                    rebuild_index(root)
                    return {'status': 'unchanged', 'record': existing}
                if source_time(source['issueUpdatedAt']) <= source_time(old_source['issueUpdatedAt']):
                    return {'status': 'stale', 'record': existing}
            elif capture_order(incoming) <= capture_order(existing):
                rebuild_index(root)
                return {'status': 'older', 'record': existing}
            status = 'updated'
        atomic_write(target, incoming)
        count = rebuild_index(root)
        return {'status': status, 'record': incoming, 'days': count}


def seed(root, legacy_root=None, records=None):
    if records is None:
        records = [json.loads(path.read_text()) for path in sorted(legacy_root.glob('20*/*/*.json'))]
    for record in records:
        validate_record(record)
    with locked(root):
        imported = 0
        for record in records:
            path = day_path(root, record['date'])
            if not path.exists():
                atomic_write(path, record)
                imported += 1
        count = rebuild_index(root)
    return {'status': 'seeded', 'imported': imported, 'days': count}


def dispatch(request):
    root = Path(request['root'])
    if request['operation'] == 'seed':
        return seed(root, records=request['records'])
    if request['operation'] == 'upsert':
        return upsert(root, request['submission'])
    raise ValueError('未知存储操作')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['seed', 'request'])
    parser.add_argument('--root', type=Path)
    parser.add_argument('--legacy-root', type=Path)
    args = parser.parse_args()
    if args.command == 'request':
        result = dispatch(json.load(sys.stdin))
    else:
        if not args.root or not args.legacy_root:
            parser.error('seed 需要 --root 和 --legacy-root')
        result = seed(args.root, args.legacy_root)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
