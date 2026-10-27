"""Build and validate the topic index for compliance guides and source texts."""

import argparse
import hashlib
import json
import re
from pathlib import Path


ROOT = Path('docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规')
INDEX = Path('scripts/data/compliance-document-index.json')
CATALOG = Path('scripts/data/information-security-technology-standards.json')
STANDARD = re.compile(r'^_?((?:GB(?:-[TZ])?|G[MA]-T)-[\d.]+-\d{4})(?:-|\.)')


def field(source, name):
    match = re.match(r'^---\n([\s\S]*?)\n---(?:\n|$)', source)
    if not match:
        return ''
    value = re.search(r'^' + re.escape(name) + r':\s*([^\n]+)', match[1], re.M)
    return value[1].strip().strip('\'"') if value else ''


def collect():
    documents = []
    numbers = {}
    series = {}
    errors = []
    for path in sorted(ROOT.rglob('*.md')):
        source = path.read_text()
        relative = path.relative_to(ROOT)
        partial = path.name.startswith('_')
        topic = relative.parent.parent if partial else relative.parent
        if partial and relative.parent.name != '原文':
            errors.append(f'{relative}: source text must be inside its topic source directory')
        heading = re.search(r'^#+\s+(.+)', source, re.M)
        title = field(source, 'title') or (heading[1] if heading else path.stem)
        role = 'source-text' if partial else ('topic-guide' if path.name in ['index.md', '01-安全合法合规.md'] else 'analysis')
        if not partial and field(source, 'standard_source') == 'true':
            role = 'source-reader'
        entry = {'path': relative.as_posix(), 'topic': topic.as_posix(), 'role': role, 'title': title}
        slug = field(source, 'slug')
        if slug:
            entry['slug'] = slug
        standard = STANDARD.match(path.name)
        if standard:
            prefix, number = re.match(r'^(GB(?:-[TZ])?|G[MA]-T)-([\d.]+-\d{4})$', standard[1]).groups()
            entry['standard'] = prefix.replace('-T', '/T').replace('-Z', '/Z') + ' ' + number
        if partial:
            entry['source_type'] = 'standard' if standard else 'regulatory-text'
            entry['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            if standard:
                key = standard[1]
                if key in numbers:
                    errors.append(f'{key}: duplicate source texts')
                numbers[key] = relative.as_posix()
                base = key.rsplit('-', 1)[0]
                if '.' in base:
                    family = base.split('.', 1)[0]
                    series.setdefault(family, set()).add(topic.as_posix())
                provenance = source.split('\n## ', 1)[0]
                url = re.search(r'https?://[^\s)]+', provenance)
                if url:
                    entry['source_url'] = url[0]
        documents.append(entry)

    catalog = json.loads(CATALOG.read_text())
    expected = {entry['number'].replace('GB/T ', 'GB-T-') for entry in catalog if not entry['adopted']}
    actual = {number for number in numbers if number.startswith('GB-T-')}
    if expected != actual:
        errors.append(f'GB/T source coverage mismatch: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}')
    for family, topics in series.items():
        if len(topics) != 1:
            errors.append(f'{family}: series parts split across topics: {sorted(topics)}')
    for directory in ROOT.rglob('*-assets'):
        if directory.is_dir() and directory.parent.name != '原文':
            errors.append(f'{directory}: source images must stay with their source text')
    if errors:
        raise ValueError('\n'.join(errors))
    return {'root': ROOT.as_posix(), 'documents': documents}


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    index = collect()
    encoded = json.dumps(index, ensure_ascii=False, indent=2) + '\n'
    if args.write:
        INDEX.parent.mkdir(parents=True, exist_ok=True)
        INDEX.write_text(encoded)
    elif not INDEX.exists() or INDEX.read_text() != encoded:
        raise ValueError('Compliance index is stale; run python3 scripts/index_compliance_documents.py --write')
    documents = index['documents']
    print(json.dumps({
        'documents': len(documents),
        'source_texts': sum(entry['role'] == 'source-text' for entry in documents),
        'gb_standards': sum(entry['role'] == 'source-text' and entry.get('standard', '').startswith('GB/T ') for entry in documents),
        'errors': 0,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
