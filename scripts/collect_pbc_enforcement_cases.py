"""Collect the PBC head-office penalty column, preserving every disclosed row."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import hashlib
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


COLUMN = 'https://www.pbc.gov.cn/zhengwugongkai/4081330/4081344/4081407/4081705/index.html'
DEFAULT_OUTPUT = Path('scripts/data/pbc-enforcement-cases.json')
DEFAULT_CACHE = Path('/tmp/feeicn-pbc-enforcement')
START = '{/* pbc-enforcement:start */}'
END = '{/* pbc-enforcement:end */}'


class Node:
    def __init__(self, tag='', attrs=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []

    def walk(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.walk(tag)

    def text(self):
        parts = []
        for child in self.children:
            if isinstance(child, str):
                parts.append(child)
            elif child.tag == 'br':
                parts.append('\n')
            elif child.tag not in ['script', 'style']:
                parts.append(child.text())
                if child.tag in ['p', 'div', 'li']:
                    parts.append('\n')
        lines = [re.sub(r'[ \t\r\xa0\u3000]+', ' ', line).strip() for line in ''.join(parts).split('\n')]
        return '\n'.join(line for line in lines if line)


class DOM(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(Node(tag, attrs))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def fetch(url, cache, offline=False):
    file = cache / (hashlib.sha256(url.encode()).hexdigest() + '.html')
    if file.exists():
        return file.read_bytes()
    if offline:
        raise ValueError(f'Cached response missing: {url}')
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; public-document-archive)'})
            with urlopen(request, timeout=45) as response:
                data = response.read()
            if not data:
                raise ValueError(f'Empty response: {url}')
            file.write_bytes(data)
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def listing(data, url):
    dom = DOM(data.decode('utf-8')).root
    articles = []
    for li in dom.walk('li'):
        anchor = next((a for a in li.walk('a') if a.attrs.get('istitle') == 'true'), None)
        if anchor is None:
            continue
        date = re.search(r'\d{4}-\d{2}-\d{2}', li.text())
        if not date:
            raise ValueError(f'Listing publication date missing: {anchor.text()}')
        articles.append({'title': anchor.attrs.get('title') or anchor.text(),
                         'url': urljoin(url, anchor.attrs['href']), 'published_at': date[0]})
    return articles


def grid(table):
    rows = []
    spans = {}
    for tr in table.walk('tr'):
        cells = [child for child in tr.children if isinstance(child, Node) and child.tag in ['td', 'th']]
        if not cells:
            continue
        row = {}
        for column, (remaining, text) in list(spans.items()):
            row[column] = text
            if remaining == 1:
                del spans[column]
            else:
                spans[column] = (remaining - 1, text)
        column = 0
        for cell in cells:
            while column in row:
                column += 1
            colspan = int(cell.attrs.get('colspan', 1))
            rowspan = int(cell.attrs.get('rowspan', 1))
            text = cell.text()
            for offset in range(colspan):
                row[column + offset] = text
                if rowspan > 1:
                    spans[column + offset] = (rowspan - 1, text)
            column += colspan
        rows.append([row.get(index, '') for index in range(max(row) + 1)])
    return rows


def canonical_header(value):
    compact = re.sub(r'\s+', '', value)
    if compact == '序号':
        return 'serial'
    if any(word in compact for word in ['当事人', '被处罚', '企业名称', '机构名称']) and '机关' not in compact:
        return 'subject'
    if '决定书文号' in compact or '决定文号' in compact:
        return 'decision_number'
    if '违法' in compact:
        return 'violations'
    if '处罚内容' in compact or '处罚结果' in compact:
        return 'penalty'
    if '机关' in compact:
        return 'authority'
    if '日期' in compact:
        return 'decision_date'
    if '公示期限' in compact:
        return 'disclosure_period'
    if '备注' in compact:
        return 'notes'
    return None


def detail(data, article):
    dom = DOM(data.decode('utf-8')).root
    body = next((node for node in dom.walk() if 'content_box' in node.attrs.get('class', '').split()), None)
    if body is None:
        raise ValueError(f'Article body missing: {article["url"]}')
    meta = {node.attrs.get('name'): node.attrs.get('content', '') for node in dom.walk('meta')}
    if meta.get('PubDate') and meta['PubDate'] != article['published_at']:
        raise ValueError(f'Publication date differs from listing: {article["url"]}')
    headers = None
    cases = []
    unknown = []
    for table in body.walk('table'):
        for row in grid(table):
            keys = [canonical_header(cell) for cell in row]
            if 'subject' in keys and 'violations' in keys:
                if None in keys or len(set(keys)) != len(keys):
                    raise ValueError(f'Unrecognized or ambiguous table columns: {row}')
                headers = keys
                continue
            if not any(row):
                continue
            if headers is None or len(headers) != len(row):
                unknown.append(row)
                continue
            record = {key: value for key, value in zip(headers, row) if key is not None}
            if not all(record.get(key) for key in ['subject', 'decision_number', 'violations', 'penalty']):
                unknown.append(row)
                continue
            cases.append(record)
    attachments = [{'label': a.text(), 'url': urljoin(article['url'], a.attrs['href'])}
                   for a in body.walk('a') if a.attrs.get('href')
                   and (re.search(r'\.(?:pdf|docx?|xlsx?|zip|rar)(?:[?#]|$)', a.attrs['href'], re.I)
                        or 'download' in a.attrs or '附件' in a.text())]
    images = [urljoin(article['url'], image.attrs['src']) for image in body.walk('img') if image.attrs.get('src')]
    return {**article, 'html_sha256': hashlib.sha256(data).hexdigest(), 'cases': cases,
            'unparsed_rows': unknown, 'attachments': attachments, 'images': images,
            'body_text': body.text() if not cases else ''}


def collect(cache, offline=False):
    first = fetch(COLUMN, cache, offline)
    source = first.decode('utf-8')
    total_match = re.search(r'共:\s*<b>(\d+)条', source)
    last_match = re.search(r'title="尾页"[^>]+?tagname="([^"]+)"', source)
    if total_match is None or last_match is None:
        raise ValueError('Pagination totals are missing')
    declared = int(total_match[1])
    last = urljoin(COLUMN, last_match[1])
    match = re.search(r'-(\d+)\.html$', last)
    if match is None:
        raise ValueError(f'Unknown pagination pattern: {last}')
    total_pages = int(match[1])
    urls = [COLUMN] + [re.sub(r'-\d+\.html$', f'-{page}.html', last) for page in range(2, total_pages + 1)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        pages = list(pool.map(lambda url: fetch(url, cache, offline), urls))
    articles = [article for data, url in zip(pages, urls) for article in listing(data, url)]
    if len(articles) != declared or len({article['url'] for article in articles}) != declared:
        raise ValueError(f'Listing coverage mismatch: declared={declared}, fetched={len(articles)}, unique={len({a["url"] for a in articles})}')
    print(f'Listing: {total_pages} pages, {declared} notices', flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        details = list(pool.map(lambda article: detail(fetch(article['url'], cache, offline), article), articles))
    return {'column_url': COLUMN, 'captured_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),
            'declared_notices': declared, 'listing_pages': urls, 'notices': details}


def decision_range(value):
    compact = re.sub(r'\s+', '', value)
    match = re.search(r'[〔【﹝\[]([0-9]{4})[〕】﹞\]](\d+)(?:[-—－至](\d+))?号', compact)
    if match is None:
        raise ValueError(f'Unrecognized decision number: {value}')
    year, first, last = match.groups()
    return [(year, number) for number in range(int(first), int(last or first) + 1)]


def validate(result):
    notices = result['notices']
    if len(notices) != result['declared_notices'] or len({n['url'] for n in notices}) != len(notices):
        raise ValueError('Incomplete or duplicate notices')
    seen = set()
    for notice in notices:
        if not notice['cases'] or notice['unparsed_rows'] or notice['attachments'] or notice['images'] or notice['body_text']:
            raise ValueError(f'Notice needs additional transcription: {notice["url"]}')
        actual = []
        for case in notice['cases']:
            if not all(case.get(key) for key in ['subject', 'decision_number', 'violations', 'penalty', 'authority', 'decision_date']):
                raise ValueError(f'Incomplete case: {case}')
            numbers = decision_range(case['decision_number'])
            if len(numbers) != 1 or numbers[0] in seen:
                raise ValueError(f'Duplicate or ambiguous decision: {case["decision_number"]}')
            seen.add(numbers[0])
            actual.extend(numbers)
        if sorted(actual) != decision_range(notice['title']):
            raise ValueError(f'Case coverage differs from notice title: {notice["title"]}')


def markdown_text(value):
    value = escape(value, quote=False).replace('{', '&#123;').replace('}', '&#125;')
    value = re.sub(r'([\\`*_\[\]|$])', r'\\\1', value)
    return re.sub(r'^(\d+)\.', r'\1\\.', value)


def render(result):
    validate(result)
    notices = result['notices']
    count = sum(len(n['cases']) for n in notices)
    dates = [n['published_at'] for n in notices]
    years = sorted({notice['published_at'][:4] for notice in notices}, reverse=True)
    lines = [START, '', '## 人民银行公示明细', '',
             f'[人民银行总行行政处罚公示栏目]({result["column_url"]})共 {len(notices)} 条公示、{count} 条处罚记录，覆盖抓取时的全部 {len(result["listing_pages"])} 个列表页，公示发布日期为 {min(dates)} 至 {max(dates)}。先按年份定位，再展开相应公示查看完整记录。', '',
             '> **收录口径：**仅限上述总行栏目，包含机构及责任人员的支付、反洗钱、征信、网络与数据安全等全部事项。金额保留原单位和精度，姓名沿用公示写法；公示日期与决定日期分别记录。原表空格标为“（原表为空）”，未设置的列不补写。公示未披露的调查证据、技术缺陷和分项罚款不作推断。', '',
             '| 公示年份 | 公示数 | 处罚记录数 |', '| --- | --- | --- |']
    for year in years:
        annual = [notice for notice in notices if notice['published_at'].startswith(year)]
        lines.append(f'| [{year}年](#{year}年公示) | {len(annual)} | {sum(len(n["cases"]) for n in annual)} |')
    lines.append('')
    labels = [('serial', '原表序号'), ('subject', '当事人'), ('decision_number', '决定书文号'),
              ('authority', '作出处罚决定的机关'), ('decision_date', '作出处罚决定的日期'),
              ('penalty', '行政处罚内容'), ('disclosure_period', '公示期限'), ('notes', '备注')]
    for year in years:
        lines.extend([f'### {year}年公示', ''])
        for notice in notices:
            if not notice['published_at'].startswith(year):
                continue
            subject = markdown_text(notice['cases'][0]['subject'])
            if len(notice['cases']) > 1:
                subject += '等'
            lines.extend(['<details>',
                          f'<summary>{notice["published_at"]}｜{subject}｜{len(notice["cases"])} 条处罚</summary>', '',
                          f'**公示文号：{markdown_text(notice["title"])}**', '',
                          f'- 公示发布日期：{notice["published_at"]}',
                          f'- 来源：[中国人民银行原始公示]({notice["url"]})', ''])
            for case in notice['cases']:
                lines.extend([f'#### {markdown_text(case["subject"])}｜{markdown_text(case["decision_number"])}', ''])
                for key, label in labels:
                    if key in case:
                        lines.append(f'- {label}：{markdown_text(case[key]) if case[key] else "（原表为空）"}')
                lines.extend(['', '违法行为类型（公示原文）：', ''])
                for index, line in enumerate(case['violations'].splitlines()):
                    if index:
                        lines.append('>')
                    lines.append(f'> {markdown_text(line)}')
                lines.append('')
            lines.extend(['</details>', ''])
    return '\n'.join([*lines, END])


def update_markdown(path, result):
    source = path.read_text()
    if source.count(START) != 1 or source.count(END) != 1 or source.index(END) < source.index(START):
        raise ValueError(f'Expected exactly one ordered pair of generated-section markers: {path}')
    before, rest = source.split(START)
    _, after = rest.split(END)
    path.write_text(before + render(result) + after)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--cache', type=Path, default=DEFAULT_CACHE)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--render-only', action='store_true', help='Render the saved JSON without fetching or changing its capture time')
    parser.add_argument('--markdown', type=Path, help='Update the marked section in an existing Markdown document')
    args = parser.parse_args()
    if args.render_only:
        result = json.loads(args.output.read_text())
    else:
        args.cache.mkdir(parents=True, exist_ok=True)
        result = collect(args.cache, args.offline)
    validate(result)
    if not args.render_only:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    if args.markdown:
        update_markdown(args.markdown, result)
    print(json.dumps({'notices': len(result['notices']), 'cases': sum(len(n['cases']) for n in result['notices']),
                      'unparsed_notices': [n['title'] for n in result['notices'] if n['unparsed_rows'] or not n['cases']],
                      'attachments': sum(len(n['attachments']) for n in result['notices']),
                      'images': sum(len(n['images']) for n in result['notices'])}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
