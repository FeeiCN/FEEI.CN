"""Connect topic tables to published pages that include the existing source texts."""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote

from index_compliance_documents import ROOT, collect


SECTION = '## 本主题标准'
INTRO = '标准号链接到站内正文；“官方来源”用于核对正式文本。'
OLD_INTRO = '标准号链接指向原始来源；适用范围、版本和具体条款以来源文本为准。'
ROW = re.compile(r'^\| \[((?:GB(?:/[TZ])?|G[MA]/T) [\d.]+-\d{4})\]\(([^)]+)\) \| (.+?) \|(?: \[官方来源\]\(([^)]+)\) \|)?$', re.M)


def key(number):
    return number.replace('/', '-').replace(' ', '-')


def planned_changes():
    documents = collect()['documents']
    sources = {entry['standard']: entry for entry in documents if entry['role'] == 'source-text' and 'standard' in entry}
    pages = {}
    for entry in documents:
        if entry['role'] != 'source-text' and 'standard' in entry:
            number = entry['standard']
            if number in pages:
                raise ValueError(f'Ambiguous published pages: {number}')
            pages[number] = entry
    changes = {}
    for number, source in sources.items():
        page = pages.get(number)
        if page is None:
            short_title = source['title'].removeprefix(number).strip().removeprefix('信息安全技术').strip()
            filename = key(number) + '-' + re.sub(r'[/\\:*?"<>|]', '-', short_title) + '.md'
            relative = Path(source['topic']) / filename
            slug = '/' + key(number).lower()
            metadata = [
                '---', 'icon: unordered-list-icon', f'slug: {slug}',
                'title: ' + json.dumps(source['title'], ensure_ascii=False),
                f'description: {number}的站内原文转写，保留条款编号、表格和来源信息；正式引用请核对官方文本。',
                'standard_source: true', '---', '', '# ' + source['title'], '',
                '[返回主题目录](./index.md) · [官方来源](' + source['source_url'] + ')', '',
                '<!-- @include ./原文/' + Path(source['path']).name + ' -->', '',
            ]
            destination = ROOT / relative
            if destination.exists():
                raise ValueError(f'Refusing to replace an unindexed file: {destination}')
            changes[destination] = '\n'.join(metadata)
            page = {'path': relative.as_posix(), 'role': 'source-reader'}
            pages[number] = page
        elif page['role'] != 'source-reader':
            raise ValueError(f'Standard page must display the source text directly: {number}')

    linked = set()
    guides = 0
    for path in ROOT.rglob('index.md'):
        content = path.read_text()
        if SECTION not in content:
            continue
        before, section = content.split(SECTION, 1)
        section = section.replace(OLD_INTRO, INTRO)
        section = section.replace('| 标准 | 名称 |\n| --- | --- |', '| 标准 | 名称 | 来源 |\n| --- | --- | --- |')

        def row(match):
            number, old_target, title, official = match.groups()
            source = sources[number]
            page = pages[number]
            filename = Path(page['path']).name
            target = './' + ''.join(quote(char, safe='-._~') if char.isascii() else char for char in filename)
            if path.parent != (ROOT / page['path']).parent:
                raise ValueError(f'Topic and standard page differ: {path}, {number}')
            official = official or (old_target if old_target.startswith('https://') else source['source_url'])
            linked.add(number)
            return f'| [{number}]({target}) | {title} | [官方来源]({official}) |'

        section, count = ROW.subn(row, section)
        if count == 0:
            raise ValueError(f'Standard table missing: {path}')
        guides += 1
        if before + SECTION + section != content:
            changes[path] = before + SECTION + section
    if linked != set(sources):
        raise ValueError(f'Standard coverage differs: {set(sources) ^ linked}')
    return changes, {'standards': len(linked), 'topic_guides': guides,
                     'source_readers': sum(entry['role'] == 'source-reader' for entry in pages.values())}


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    changes, counts = planned_changes()
    if args.check and changes:
        raise ValueError(f'{len(changes)} standard pages or links need updating; run with --write')
    for path, source in changes.items():
        path.write_text(source)
    print(json.dumps({**counts, 'changed_files': len(changes)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
