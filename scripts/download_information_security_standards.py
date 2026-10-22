"""Download public standard PDFs using the site's detail-to-download session flow."""

import argparse
import hashlib
import json
import re
import time
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener


CATALOG = Path('scripts/data/information-security-technology-standards.json')
STATUS = Path('scripts/data/information-security-technology-downloads.json')
DEFAULT_DIR = Path('/tmp/feeicn-information-security-pdfs')
BASE = 'https://openstd.samr.gov.cn/bzgk/std/'
USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'


def request(opener, url, referer=None):
    headers = {'User-Agent': USER_AGENT}
    if referer:
        headers['Referer'] = referer
    with opener.open(Request(url, headers=headers), timeout=60) as response:
        return response.read()


def download(entry, directory):
    filename = entry['number'].replace('GB/T ', 'GB-T-') + '.pdf'
    target = directory / filename
    if target.exists():
        data = target.read_bytes()
        if data.startswith(b'%PDF'):
            return hashlib.sha256(data).hexdigest(), target

    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    detail = entry['source']
    display = BASE + f"showGb?type=download&hcno={entry['hcno']}&request_locale=zh"
    file_url = BASE + f"viewGb?hcno={entry['hcno']}"
    request(opener, detail)
    page = request(opener, display, detail)
    if b'window.location.href = "viewGb?hcno="' not in page:
        return 'unavailable-download-page', None
    for delay in (0, 2, 5, 10, 20):
        if delay:
            time.sleep(delay)
        data = request(opener, file_url, display)
        if data.startswith(b'%PDF'):
            break
    else:
        return 'empty-download-response-after-retries', None
    target.write_bytes(data)
    return hashlib.sha256(data).hexdigest(), target


parser = argparse.ArgumentParser()
parser.add_argument('--start', type=int, default=0)
parser.add_argument('--limit', type=int)
parser.add_argument('--retry-failed', action='store_true')
parser.add_argument('--directory', type=Path, default=DEFAULT_DIR)
args = parser.parse_args()

entries = json.loads(CATALOG.read_text())
chosen = entries[args.start:args.start + args.limit if args.limit else None]
args.directory.mkdir(parents=True, exist_ok=True)
status = json.loads(STATUS.read_text()) if STATUS.exists() else {}
for item in status.values():
    if item['result'] in {'unavailable-pdf', 'empty-download-response'}:
        item['result'] = 'empty-download-response-before-retry'
for index, entry in enumerate(chosen, args.start):
    if args.retry_failed and (
        entry['number'] not in status or
        status[entry['number']]['result'] == 'not-public-adopted-standard' or
        re.fullmatch(r'[0-9a-f]{64}', status[entry['number']]['result'])
    ):
        continue
    if entry['adopted']:
        result, path = 'not-public-adopted-standard', None
    else:
        try:
            result, path = download(entry, args.directory)
        except Exception as error:
            result, path = f'{type(error).__name__}: {error}', None
    status[entry['number']] = {'result': result, 'bytes': path.stat().st_size if path else 0}
    STATUS.write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n')
    print(index + 1, entry['number'], result, path or '', flush=True)
    if path:
        time.sleep(1)
