"""Format image-recognized standard pages as unreviewed Markdown drafts."""

import argparse
import json
import re
from pathlib import Path

from PIL import Image

from reconstruct_standard_tables import reconstruct


CATALOG = Path('scripts/data/information-security-technology-standards.json')
OCR_DIR = Path('/tmp/feeicn-information-security-ocr-2x')
OUTPUT_DIR = Path('scripts/cache/information-security-ocr-drafts')
SECTION = re.compile(r'^([1-9]\d?(?:\.\d+)*)\s+(.+)$')
NUMBER = re.compile(r'^[1-9]\d*(?:\.\d+)+$')
FIGURE = re.compile(r'^图\s*[A-Z]?\.?\d+\s+')
REFERENCE = re.compile(r'^[［\[]\d+[］\]]')
LIST_ITEM = re.compile(r'^(?:[a-z]|[1-9]\d*)）')
EMBEDDED_LIST = re.compile(r'^(.+?[：:])\s*((?:[a-z]|[1-9]\d*)）.+)$')
LETTERED_MARKER = re.compile(r'^([a-z]{1,2})）', re.MULTILINE)
MISREAD_G = {'gq', 'gg', 'gs', 'oq'}


def compact(text):
    return re.sub(r'\s+', '', text)


def heading(text):
    match = SECTION.match(text)
    if not match:
        return None
    number, title = match.groups()
    if not re.search(r'[\u4e00-\u9fff]', title):
        return None
    if title.endswith(('。', '；', '：')) or len(re.findall(r'[\u4e00-\u9fff]', title)) > 30:
        return None
    level = min(number.count('.') + 2, 6)
    return f'{"#" * level} {number} {title}'


def visual_lines(lines):
    groups = []
    for line in sorted(lines, key=lambda item: -item['y']):
        if groups and abs(groups[-1][0]['y'] - line['y']) < 0.003:
            groups[-1].append(line)
        else:
            groups.append([line])
    for group in groups:
        group.sort(key=lambda item: item['x'])
        first = group[0]
        yield {
            'x': first['x'],
            'y': first['y'],
            'text': ' '.join(item['text'] for item in group),
        }


def normalize_list_markers(markdown):
    markers = list(LETTERED_MARKER.finditer(markdown))
    corrections = []
    parts = []
    last = 0
    for index, marker in enumerate(markers):
        previous = markers[index - 1].group(1) if index else None
        if marker.group(1) not in MISREAD_G or previous not in {'e', 'f'}:
            continue
        parts.extend([markdown[last:marker.start()], 'g）'])
        corrections.append({
            'line': markdown.count('\n', 0, marker.start()) + 1,
            'recognized': marker.group(0),
            'normalized': 'g）',
        })
        last = marker.end()
    parts.append(markdown[last:])
    return ''.join(parts), corrections


def format_document(entry, record, assets_dir):
    output = [
        f"# {entry['number']} {entry['title']}",
        '',
        f"> 来源：[{entry['number']} 国家标准详情]({entry['source']})。",
        (f"> PDF SHA-256：{record['pdf_sha256']}。" if 'pdf_sha256' in record else
         f"> 官方在线预览截图 SHA-256：{record['image_sha256']}。"),
        '> 页面图像识别草稿，尚未逐页核对；表格和图示尤其需要原页校核，不用于正式引用。',
        '',
    ]
    paragraph = []
    warnings = []
    in_contents = False
    section_root = None
    table_positions = {}

    def flush():
        if paragraph:
            output.extend([''.join(paragraph), ''])
            paragraph.clear()

    for page in record['pages']:
        if page['page'] == 1:
            continue
        raw_lines = list(visual_lines(page['lines']))
        first_body_page = any(
            re.match(r'^1\s*范围$', compact(line['text'])) for line in raw_lines
        )
        contents_leaders = sum(bool(re.search(r'⋯|…|••|··|\.{4,}', line['text'])) for line in raw_lines)
        contents_header = any(compact(line['text']) == '目次' for line in raw_lines) or (
            page['page'] <= 8 and contents_leaders >= 2 and
            any('前言' in line['text'] and ('⋯' in line['text'] or '…' in line['text']) for line in raw_lines)
        )
        if contents_header:
            in_contents = True
            continue
        if in_contents:
            has_preface = any(compact(line['text']) in {'前言', '引言'} for line in raw_lines)
            has_preface_body = any(line['text'].startswith(('本文件按照', '本标准按照')) for line in raw_lines)
            has_scope_body = first_body_page and contents_leaders < 2 and any(
                line['text'].startswith(('本文件', '本标准')) for line in raw_lines
            )
            if not (has_preface or has_preface_body or has_scope_body):
                continue
            if has_preface_body and not has_preface:
                output.extend(['## 前言', ''])
        in_contents = False
        image = Image.open(page['image'])
        height = image.height
        tables = reconstruct(page, image)
        used_tables = set()
        lines = []
        figure_text = set()
        figure_crops = {}
        for position, line in enumerate(raw_lines):
            if not FIGURE.match(' '.join(line['text'].split())):
                continue
            preceding = next(
                (previous for previous in range(position - 1, -1, -1)
                 if raw_lines[previous]['text'].rstrip().endswith('。')),
                -1,
            )
            figure_text.update(range(preceding + 1, position))
            top = round((1 - raw_lines[preceding]['y']) * height + 10) if preceding >= 0 else round(height * 0.115)
            bottom = round((1 - line['y']) * height - 30)
            if bottom > top:
                figure_crops[position] = (top, bottom)
        for position, line in enumerate(raw_lines):
            text = ' '.join(line['text'].split())
            y = (1 - line['y']) * height
            if position in figure_text:
                continue
            if not text or line['y'] > 0.89 and text.startswith(('GB/T', 'GB / T')):
                continue
            is_page_number = re.fullmatch(r'[\dⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+', text)
            if is_page_number and (line['y'] < 0.08 or
                                   (line['y'] < 0.11 and (line['x'] < 0.2 or line['x'] > 0.75))):
                continue
            if compact(text) == compact(entry['title']) or (
                first_body_page and len(compact(text)) >= 4 and
                compact(text) in compact(entry['title'])
            ):
                continue
            table_match = next((index for index, table in enumerate(tables) if text.startswith(table['title'])), None)
            if table_match is not None:
                lines.append(('table', tables[table_match]))
                used_tables.add(table_match)
                continue
            if any(index in used_tables and table['top'] < y < table['bottom'] for index, table in enumerate(tables)):
                continue
            if position in figure_crops:
                lines.append(('figure', (text, figure_crops[position], page['page'])))
            else:
                lines.append(('text', text))

        index = 0
        while index < len(lines):
            kind, value = lines[index]
            index += 1
            if kind == 'table':
                flush()
                title = value['title']
                table_number = re.match(r'^表\s*(?:[A-Z]\s*\.)?\s*\d+', title)
                table_key = compact(table_number.group()) if table_number else compact(re.sub(r'（续）$', '', title))
                if title.endswith('（续）') and table_key in table_positions and value['markdown']:
                    rows = value['markdown'].splitlines()[2:]
                    if rows:
                        output[table_positions[table_key]] += '\n' + '\n'.join(rows)
                    continue
                output.extend([f"**{title}**", ''])
                if value['markdown']:
                    table_positions[table_key] = len(output)
                    output.extend([value['markdown'], ''])
                    if re.search(r'\|\s*\|', value['markdown']):
                        warnings.append(f"{page['page']}: {title} contains empty cells")
                else:
                    output.extend([f"[待核对表格：{value['problem']}]", ''])
                    warnings.append(f"{page['page']}: {title}: {value['problem']}")
                continue
            if kind == 'figure':
                flush()
                title, (top, bottom), page_number = value
                assets_dir.mkdir(parents=True, exist_ok=True)
                filename = f'figure-page-{page_number:03d}-{index:03d}.png'
                image.crop((round(image.width * 0.08), top,
                            round(image.width * 0.92), bottom)).save(assets_dir / filename)
                output.extend([f'![{title}]({assets_dir.name}/{filename})', ''])
                warnings.append(f'{page_number}: {title} crop requires visual review')
                continue
            text = value
            embedded_list = EMBEDDED_LIST.match(text)
            if embedded_list:
                text = embedded_list.group(1)
                lines.insert(index, ('text', embedded_list.group(2)))
            if compact(text) in {'前言', '引言', '参考文献'}:
                flush()
                output.extend([f'## {compact(text)}', ''])
                continue
            if NUMBER.fullmatch(text) and index < len(lines) and lines[index][0] == 'text':
                text += ' ' + lines[index][1]
                index += 1
                if index < len(lines) and lines[index][0] == 'text' and re.fullmatch(r'[A-Za-z][A-Za-z ]+', lines[index][1]):
                    text += ' ' + lines[index][1]
                    index += 1
            section = heading(text)
            if section:
                flush()
                section_root = text.split('.', 1)[0].split(' ', 1)[0]
                output.extend([section, ''])
                continue
            clause = SECTION.match(text)
            if clause and '.' in clause.group(1):
                flush()
                section_root = clause.group(1).split('.', 1)[0]
                output.extend([f'**{clause.group(1)}** {clause.group(2)}', ''])
                continue
            if text.startswith(('注：', '注:')):
                flush()
                output.extend([f'> {text}', ''])
                continue
            if (len(output) >= 2 and output[-1] == '' and output[-2].startswith('> 注') and
                    not output[-2].endswith(('。', '；', '！', '？')) and not LIST_ITEM.match(text)):
                output[-2] += text
                continue
            if (len(output) >= 2 and output[-1] == '' and
                    re.match(r'^\*\*\d+(?:\.\d+)+\*\* ', output[-2]) and
                    not output[-2].endswith(('。', '；', '！', '？')) and not LIST_ITEM.match(text)):
                output[-2] += text
                continue
            if REFERENCE.match(text):
                flush()
                output.extend([f'- {text}', ''])
                continue
            if section_root == '2' and text.startswith(('GB/T ', 'GB/Z ')):
                flush()
                output.extend([f'- {text}', ''])
                continue
            if LIST_ITEM.match(text):
                flush()
            if paragraph and paragraph[-1].endswith(('。', '；')):
                flush()
            if paragraph and paragraph[-1][-1:].isascii() and text[0].isascii():
                paragraph.append(' ')
            paragraph.append(text)
    flush()
    markdown = '\n'.join(output).rstrip() + '\n'
    markdown, corrections = normalize_list_markers(markdown)
    return markdown, warnings, corrections


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('number', nargs='?', help='Standard number, such as GB/T 43557-2023')
    parser.add_argument('--all-ocr', action='store_true')
    parser.add_argument('--ocr-directory', type=Path, default=OCR_DIR)
    parser.add_argument('--output-directory', type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    if not args.number and not args.all_ocr:
        parser.error('Provide a standard number or --all-ocr')
    args.output_directory.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG.read_text())
    for entry in catalog:
        if args.number and entry['number'] != args.number:
            continue
        stem = entry['number'].replace('GB/T ', 'GB-T-')
        source = args.ocr_directory / stem / 'ocr.json'
        if not source.exists():
            continue
        target = args.output_directory / (stem + '.md')
        record = json.loads(source.read_text())
        markdown, warnings, corrections = format_document(
            entry, record,
            args.output_directory / (stem + '-assets'),
        )
        target.write_text(markdown)
        (args.output_directory / (stem + '.review.json')).write_text(json.dumps({
            'number': entry['number'],
            'source_sha256': record.get('pdf_sha256', record.get('image_sha256')),
            'warnings': warnings,
            'list_marker_normalizations': corrections,
        }, ensure_ascii=False, indent=2) + '\n')
        print(entry['number'], len(markdown), f'{len(warnings)} review items',
              f'{len(corrections)} normalized markers', flush=True)


if __name__ == '__main__':
    main()
