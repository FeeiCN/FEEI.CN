"""Collect the filtered, published 信息安全技术 recommended national standards."""

import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE = 'https://openstd.samr.gov.cn/bzgk/std/'
OUTPUT = Path('scripts/data/information-security-technology-standards.json')


class ResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self.row = {'cells': [], 'hcno': None}
        elif tag == 'td' and self.row is not None:
            self.cell = []
        elif tag == 'a' and self.row is not None:
            onclick = attrs.get('onclick', '')
            if "showInfo('" in onclick:
                self.row['hcno'] = onclick.split("showInfo('", 1)[1].split("'", 1)[0]

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None:
            self.row['cells'].append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if self.row['hcno'] and len(self.row['cells']) >= 7:
                self.rows.append(self.row)
            self.row = None


def fetch(page):
    params = urlencode({
        'page': page,
        'pageSize': 50,
        'p.p1': 2,
        'p.p2': '信息安全技术',
        'p.p5': 'PUBLISHED',
        'p.p6': 35,
        'p.p90': 'circulation_date',
        'p.p91': 'desc',
    })
    request = Request(BASE + 'std_list_type?' + params, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(request, timeout=30) as response:
        parser = ResultParser()
        parser.feed(response.read().decode('utf-8'))
        return parser.rows


records = []
seen = set()
for page in range(1, 30):
    rows = fetch(page)
    print(f'page {page}: {len(rows)} standards')
    if not rows:
        break
    for row in rows:
        cells = row['cells']
        number, title = cells[1], cells[3]
        if number in seen:
            raise ValueError(f'Duplicate standard: {number}')
        seen.add(number)
        records.append({
            'number': number,
            'title': title,
            'status': cells[4],
            'adopted': cells[2] == '采',
            'published': cells[5].split(' ')[0],
            'implemented': cells[6].split(' ')[0],
            'hcno': row['hcno'],
            'source': BASE + 'newGbInfo?hcno=' + row['hcno'],
        })
    if len(rows) < 50:
        break

if not 280 <= len(records) <= 290:
    raise ValueError(f'Expected about 29 ten-item pages, got {len(records)} records')

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
print(f'wrote {len(records)} standards to {OUTPUT}')
