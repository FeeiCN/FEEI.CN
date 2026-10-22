"""Build reviewable Markdown table drafts from page pixels and Vision OCR boxes.

Requires Pillow. Table borders and cell text both come from rendered page images.
"""

import argparse
import json
import re
from pathlib import Path

from PIL import Image


OCR_DIR = Path('/tmp/feeicn-information-security-ocr-2x')
CAPTION = re.compile(r'^表\s*(?:[A-Z]\s*\.)?\s*\d+')


def clusters(numbers, distance=2):
    groups = []
    for number in numbers:
        if groups and number - groups[-1][-1] <= distance:
            groups[-1].append(number)
        else:
            groups.append([number])
    return [round(sum(group) / len(group)) for group in groups]


def horizontal_borders(image):
    pixels = image.load()
    width, height = image.size
    borders = []
    for y in range(height):
        dark = [x for x in range(width) if pixels[x, y] < 225]
        if len(dark) > width * 0.45 and max(dark) - min(dark) > width * 0.5:
            borders.append(y)
    return clusters(borders)


def vertical_borders(image, top, bottom, left, right):
    pixels = image.load()
    height = bottom - top
    borders = []
    for x in range(left, right + 1):
        dark = sum(pixels[x, y] < 225 for y in range(top + 2, bottom - 1))
        if dark > height * 0.7:
            borders.append(x)
    return clusters(borders)


def join_cell(parts):
    result = ''
    for part in parts:
        if result and result[-1].isascii() and result[-1].isalnum() and part[0].isascii() and part[0].isalnum():
            result += ' '
        result += part
    return result.replace('|', '\\|')


def function_table_rows(gray, rows, columns, grid, page, continuation=False):
    labels = {'原型', '描述', '参数', '返回值', '备注', '规则'}
    if len(columns) != 3 or not grid or not (
        grid[0][0] in labels or (continuation and any(row[0] in labels for row in grid))
    ):
        return None
    left_samples = [columns[0] + (columns[1] - columns[0]) * offset // 5 for offset in range(1, 5)]
    groups = []
    for top, cells in zip(rows, grid):
        if not groups or sum(gray.getpixel((x, top)) < 245 for x in left_samples) >= 3:
            groups.append({'top': top, 'cells': []})
        groups[-1]['cells'].append(cells)
    result = [['项目', '内容']]
    for index, group in enumerate(groups):
        bottom = groups[index + 1]['top'] if index + 1 < len(groups) else rows[-1]
        labels = [line['text'] for line in page['lines']
                  if columns[0] < line['x'] * gray.width < columns[1]
                  and group['top'] <= (1 - line['y']) * gray.height < bottom]
        contents = [cell[1] for cell in group['cells'] if cell[1]]
        result.append([labels[0] if labels else '', '<br>'.join(contents)])
    return result


def reconstruct(page, image):
    width, height = image.size
    gray = image.convert('L')
    horizontal = horizontal_borders(gray)
    captions = sorted(
        [(round((1 - line['y']) * height), line['text']) for line in page['lines'] if CAPTION.match(line['text'])]
    )
    tables = []
    for index, (caption_y, title) in enumerate(captions):
        next_caption = captions[index + 1][0] if index + 1 < len(captions) else height - 35
        rows = [y for y in horizontal if caption_y + 12 < y < next_caption - 12]
        if len(rows) < 2:
            tables.append({'title': title, 'markdown': None, 'problem': 'No complete grid detected', 'top': caption_y, 'bottom': caption_y})
            continue
        first = rows[0]
        last = rows[-1]
        dark = [x for x in range(width) if gray.getpixel((x, first)) < 225]
        if not dark:
            tables.append({'title': title, 'markdown': None, 'problem': 'Grid top border not found', 'top': caption_y, 'bottom': caption_y})
            continue
        columns = vertical_borders(gray, first, last, min(dark), max(dark))
        if len(columns) < 3:
            tables.append({'title': title, 'markdown': None, 'problem': 'Column borders not found', 'top': first, 'bottom': last})
            continue
        grid = []
        for top, bottom in zip(rows, rows[1:]):
            cells = [[] for _ in range(len(columns) - 1)]
            lines = sorted(page['lines'], key=lambda line: -line['y'])
            for line in lines:
                y = (1 - line['y']) * height
                x = line['x'] * width
                if not top + 2 < y < bottom - 2:
                    continue
                for column, (left, right) in enumerate(zip(columns, columns[1:])):
                    if left + 2 <= x < right - 2:
                        cells[column].append(line['text'])
                        break
            grid.append([join_cell(cell) for cell in cells])
        if not grid or not any(any(cell for cell in row) for row in grid):
            tables.append({'title': title, 'markdown': None, 'problem': 'No OCR text assigned to grid', 'top': first, 'bottom': last})
            continue
        formatted = function_table_rows(gray, rows, columns, grid, page, title.endswith('（续）')) or grid
        markdown = ['| ' + ' | '.join(row) + ' |' for row in formatted]
        markdown.insert(1, '| ' + ' | '.join(['---'] * (len(formatted[0]))) + ' |')
        tables.append({'title': title, 'markdown': '\n'.join(markdown), 'problem': None, 'top': first, 'bottom': last})
    return tables


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('number', help='File stem such as GB-T-43557-2023')
    parser.add_argument('page', type=int, help='One-based PDF page number')
    parser.add_argument('--ocr-directory', type=Path, default=OCR_DIR)
    args = parser.parse_args()
    folder = args.ocr_directory / args.number
    page = json.loads((folder / f'page-{args.page:03d}.json').read_text())
    image = Image.open(folder / f'page-{args.page:03d}.png')
    for table in reconstruct(page, image):
        print(f"**{table['title']}**\n")
        print(table['markdown'] or f"[待人工校核：{table['problem']}]")
        print()


if __name__ == '__main__':
    main()
