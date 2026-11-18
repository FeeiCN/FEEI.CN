"""Package and verify immutable site builds; resolve only successful main checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def valid_sha(value):
    if not re.fullmatch(r'[a-f0-9]{40}', value):
        raise ValueError('Invalid commit SHA')
    return value


def artifact_name(commit, run_id, attempt):
    valid_sha(commit)
    if not all(re.fullmatch(r'[1-9][0-9]*', str(item)) for item in (run_id, attempt)):
        raise ValueError('Invalid source run or attempt')
    return f'website-{commit}-{run_id}-{attempt}'


def included(name):
    path = PurePosixPath(name)
    return (bool(path.parts) and name == path.as_posix() and not path.is_absolute() and '..' not in path.parts
            and path.parts[0] not in ('data', 'media', 'music')
            and not path.parts[0].startswith('search-index')
            and not any(part.startswith('.') for part in path.parts))


def package(build, output, repo, commit, run_id, attempt):
    name = artifact_name(commit, run_id, attempt)
    if not (build / 'index.html').is_file():
        raise ValueError('Built homepage missing')
    output.mkdir(parents=True, exist_ok=True)
    archive = output / 'site.tar.gz'
    with tarfile.open(archive, 'w:gz', compresslevel=1) as bundle:
        for path in sorted(build.rglob('*')):
            relative = path.relative_to(build).as_posix()
            if not included(relative):
                continue
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise ValueError('Build contains a link or special file')
            bundle.add(path, arcname=relative, recursive=False)
    metadata = {'version': 1, 'repository': repo, 'commit': commit, 'run_id': str(run_id),
                'attempt': str(attempt), 'name': name, 'sha256': sha256(archive)}
    (output / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return metadata


def verify(folder, repo, commit, run_id, attempt, destination=None):
    expected = artifact_name(commit, run_id, attempt)
    metadata = json.loads((folder / 'manifest.json').read_text())
    if any(metadata.get(key) != value for key, value in {
            'version': 1, 'repository': repo, 'commit': commit, 'run_id': str(run_id),
            'attempt': str(attempt), 'name': expected}.items()):
        raise ValueError('Artifact provenance mismatch')
    archive = folder / 'site.tar.gz'
    if metadata.get('sha256') != sha256(archive):
        raise ValueError('Artifact checksum mismatch')
    with tarfile.open(archive, 'r:gz') as bundle:
        members, names = bundle.getmembers(), set()
        for member in members:
            if (not included(member.name) or not (member.isfile() or member.isdir())
                    or member.name in names):
                raise ValueError('Unsafe archive entry')
            names.add(member.name)
        if not any(member.name == 'index.html' and member.isfile() for member in members):
            raise ValueError('Archive homepage missing')
        if sum(member.size for member in members) > 2 * 1024 ** 3:
            raise ValueError('Archive exceeds site size limit')
        if destination:
            destination.mkdir(parents=True, exist_ok=False)
            for member in members:
                target = destination / member.name
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as source, target.open('xb') as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(0o644)
            destination.chmod(0o755)
            for path in destination.rglob('*'):
                if path.is_dir():
                    path.chmod(0o755)
    return metadata


def gh(repo, endpoint):
    result = subprocess.run(['gh', 'api', f'repos/{repo}/{endpoint}'], capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError('GitHub source verification failed')
    return json.loads(result.stdout)


def validate_run(repo, run, workflow_id):
    if (run.get('status') != 'completed' or run.get('conclusion') != 'success'
            or run.get('head_branch') != 'main' or run.get('event') not in ('push', 'workflow_run', 'workflow_dispatch', 'schedule')
            or run.get('head_repository', {}).get('full_name') != repo
            or run.get('workflow_id') != workflow_id or run.get('path') != '.github/workflows/check.yml'):
        raise ValueError('Only successful main checks from this repository can deploy')
    valid_sha(run['head_sha'])


def resolve(repo, run_id):
    main = gh(repo, 'commits/main')['sha']
    workflow = gh(repo, 'actions/workflows/check.yml')
    if not run_id:
        runs = gh(repo, f'actions/workflows/check.yml/runs?branch=main&status=success&head_sha={main}&per_page=30')['workflow_runs']
        runs = [run for run in runs if run.get('event') != 'pull_request']
        if not runs:
            raise ValueError('No successful build for current main; run 网站严格检查 first')
        run_id = str(runs[0]['id'])
    if not re.fullmatch(r'[1-9][0-9]*', run_id):
        raise ValueError('Invalid check run ID')
    run = gh(repo, f'actions/runs/{run_id}')
    validate_run(repo, run, workflow['id'])
    name = artifact_name(run['head_sha'], run_id, run['run_attempt'])
    if run['head_sha'] != main:
        return {'ready': 'false'}
    artifacts = gh(repo, f'actions/runs/{run_id}/artifacts?per_page=100')['artifacts']
    matches = [item for item in artifacts if item['name'] == name and not item['expired']]
    if len(matches) != 1:
        raise ValueError('Verified site artifact missing or ambiguous')
    return {'ready': 'true', 'commit': main, 'run_id': run_id, 'attempt': str(run['run_attempt']),
            'artifact_id': str(matches[0]['id'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['package', 'verify', 'extract', 'resolve'])
    parser.add_argument('--folder', type=Path, default=Path('output/site'))
    parser.add_argument('--build', type=Path, default=Path('build'))
    parser.add_argument('--destination', type=Path)
    args = parser.parse_args()
    repo = os.environ['GITHUB_REPOSITORY']
    if args.operation == 'resolve':
        values = resolve(repo, os.environ.get('SOURCE_RUN_ID', ''))
    else:
        params = (repo, os.environ['SITE_COMMIT'], os.environ['SITE_RUN_ID'], os.environ['SITE_ATTEMPT'])
        if args.operation == 'package':
            values = package(args.build, args.folder, *params)
        else:
            if args.operation == 'extract' and not args.destination:
                parser.error('extract requires --destination')
            values = verify(args.folder, *params, destination=args.destination if args.operation == 'extract' else None)
    if args.operation in ('resolve', 'package') and os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            for key, value in values.items():
                stream.write(f'{key}={value}\n')
    print('Site artifact: ' + ('ready' if values.get('ready') == 'true' else 'verified' if args.operation != 'resolve' else 'superseded'))


if __name__ == '__main__':
    main()
