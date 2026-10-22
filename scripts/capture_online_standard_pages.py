"""Capture official online-preview pages for standards without a PDF download.

Requires Playwright Python. Uses the installed Google Chrome browser.
"""

import argparse
import json
import re
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from io import BytesIO
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener

from PIL import Image
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


CATALOG = Path('scripts/data/information-security-technology-standards.json')
STATUS = Path('scripts/data/information-security-technology-downloads.json')
OUTPUT_DIR = Path('/tmp/feeicn-information-security-online-images')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
BASE = 'https://openstd.samr.gov.cn/bzgk/std/'


class PreviewMetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.page_count = 0
        self.total_text = ''
        self.in_total = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div' and 'page' in attrs.get('class', '').split():
            self.page_count += 1
        if tag == 'span' and attrs.get('id') == 'numPages':
            self.in_total = True

    def handle_data(self, data):
        if self.in_total:
            self.total_text += data

    def handle_endtag(self, tag):
        if tag == 'span':
            self.in_total = False


def verify_cached_pages(entry, target):
    images = list(target.glob('page-*.png'))
    if not images:
        return False
    preview = BASE + f"showGb?type=online&hcno={entry['hcno']}&request_locale=zh"
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    headers = {'User-Agent': 'Mozilla/5.0'}
    opener.open(Request(entry['source'], headers=headers), timeout=60).read()
    with opener.open(Request(preview, headers={**headers, 'Referer': entry['source']}), timeout=60) as response:
        parser = PreviewMetadataParser()
        parser.feed(response.read().decode('utf-8'))
    match = re.search(r'\d+', parser.total_text)
    total = int(match.group()) if match else 0
    if not total or parser.page_count != total or len(images) != total:
        return False
    for index in range(1, total + 1):
        image = target / f'page-{index:03d}.png'
        if not image.exists():
            return False
        with Image.open(image) as page:
            if page.width < 1000 or page.height < 1400:
                return False
            white = sum(min(page.getpixel((50, y))[:3]) >= 245
                        for y in range(0, page.height, 10))
            if white < page.height / 10 * 0.9:
                return False
    (target / 'manifest.json').write_text(json.dumps({
        'page_count': total,
        'verified_total': True,
        'source': preview,
    }, ensure_ascii=False, indent=2) + '\n')
    print(entry['number'], total, 'cached pages verified against official preview HTML', flush=True)
    return True


def capture(entry, output_dir, start, limit, force=False, scale=0.5):
    target = output_dir / entry['number'].replace('GB/T ', 'GB-T-')
    target.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROME, headless=True)
        page = browser.new_page(viewport={'width': 1500, 'height': 1100}, device_scale_factor=1)
        page.goto(entry['source'], wait_until='domcontentloaded', timeout=60000)
        with page.expect_popup() as opened:
            page.locator('.ck_btn').click()
        page = opened.value
        page.wait_for_load_state('domcontentloaded')
        viewport = {'width': 2500, 'height': 3500} if scale == 1.0 else {'width': 1500, 'height': 2200}
        page.set_viewport_size(viewport)
        try:
            page.locator('#viewer .page').first.wait_for(timeout=15000)
        except PlaywrightTimeoutError:
            print('Preview unavailable:', page.url, page.title(), flush=True)
            print(page.content()[:500], flush=True)
            raise RuntimeError('Browser did not enter the online preview viewer')
        if scale == 1.0:
            for _ in range(10):
                current = page.locator('#scaleSelect').input_value()
                if current and float(current) >= scale:
                    break
                page.locator('#zoomIn').click()
            if page.locator('#scaleSelect').input_value() != '1':
                raise RuntimeError('Could not set official preview to 100%')
        pages = page.locator('#viewer .page')
        total_text = page.locator('#numPages').inner_text(timeout=30000)
        match = re.search(r'\d+', total_text)
        if not match:
            raise RuntimeError(f'Official viewer did not expose its total page count: {total_text!r}')
        page_count = int(match.group())
        if page_count <= 0:
            raise RuntimeError('Official viewer reported zero pages')
        for _ in range(60):
            if pages.count() >= page_count:
                break
            pages.last.scroll_into_view_if_needed(timeout=30000)
            page.wait_for_timeout(500)
        if pages.count() != page_count:
            raise RuntimeError(f'Loaded {pages.count()} of {page_count} official preview pages')
        print(entry['number'], page_count, 'online pages', flush=True)
        end = min(page_count, start + limit if limit else page_count)
        for index in range(start, end):
            image = target / f'page-{index + 1:03d}.png'
            if image.exists() and not force:
                print(index + 1, 'cached', flush=True)
                continue
            element = pages.nth(index)
            element.scroll_into_view_if_needed(timeout=30000)
            page.wait_for_function(
                "index => [...document.querySelectorAll('#viewer .page')[index].querySelectorAll('span')].every(span => getComputedStyle(span).backgroundImage !== 'none')",
                arg=index,
                timeout=30000,
            )
            box = element.bounding_box()
            if box['y'] < 0 or box['y'] + box['height'] > viewport['height']:
                raise RuntimeError(f'Page {index + 1} outside viewport: {box}')
            with Image.open(BytesIO(page.screenshot(timeout=60000))) as screenshot:
                captured = screenshot.crop((
                    round(box['x']), round(box['y']),
                    round(box['x'] + box['width']), round(box['y'] + box['height']),
                ))
                margin_x = min(50, captured.width - 1)
                white_rows = sum(
                    min(captured.getpixel((margin_x, y))[:3]) >= 245
                    for y in range(0, captured.height, 10)
                )
                if white_rows < captured.height / 10 * 0.9:
                    raise RuntimeError(f'Page {index + 1} contains an unloaded image region')
                captured.save(image)
            print(index + 1, image, flush=True)
        if start == 0 and end == page_count and all(
            (target / f'page-{index + 1:03d}.png').exists() for index in range(page_count)
        ):
            (target / 'manifest.json').write_text(json.dumps({
                'page_count': page_count,
                'verified_total': True,
                'scale': scale,
                'source': page.url,
            }, ensure_ascii=False, indent=2) + '\n')
        browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('number', nargs='?', help='Standard number, such as GB/T 42574-2023')
    parser.add_argument('--all-failed', action='store_true')
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--scale', type=float, choices=(0.5, 1.0), default=0.5)
    parser.add_argument('--output-directory', type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    entries = json.loads(CATALOG.read_text())
    if args.all_failed:
        status = json.loads(STATUS.read_text())
        chosen = [entry for entry in entries if not entry['adopted'] and
                  entry['number'] in status and not
                  re.fullmatch(r'[0-9a-f]{64}', status[entry['number']]['result'])]
    elif args.number:
        chosen = [next(item for item in entries if item['number'] == args.number)]
    else:
        parser.error('Provide a standard number or --all-failed')
    for entry in chosen:
        target = args.output_directory / entry['number'].replace('GB/T ', 'GB-T-')
        manifest = target / 'manifest.json'
        force = args.force
        if manifest.exists() and not args.force:
            metadata = json.loads(manifest.read_text())
            if metadata.get('verified_total') and metadata.get('scale', 0.5) == args.scale:
                print(entry['number'], 'cached', flush=True)
                continue
            if metadata.get('scale', 0.5) != args.scale:
                force = True
        if not force and args.scale == 0.5:
            try:
                if verify_cached_pages(entry, target):
                    continue
            except Exception as error:
                print(entry['number'], 'HTML verification failed:', type(error).__name__, error, flush=True)
        try:
            capture(entry, args.output_directory, args.start, args.limit, force, args.scale)
        except Exception as error:
            print(entry['number'], type(error).__name__, error, flush=True)


if __name__ == '__main__':
    main()
