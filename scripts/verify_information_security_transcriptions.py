"""Check source, image OCR, draft, and reviewed Markdown coverage for the catalog."""

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


CATALOG = Path('scripts/data/information-security-technology-standards.json')
DOWNLOADS = Path('scripts/data/information-security-technology-downloads.json')
OCR_DIR = Path('/tmp/feeicn-information-security-ocr-2x')
ONLINE_DIR = Path('/tmp/feeicn-information-security-online-images')
PDF_DIR = Path('/tmp/feeicn-information-security-pdfs')
DRAFT_DIR = Path('scripts/cache/information-security-ocr-drafts')
IMAGE = re.compile(r'!\[[^]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)')
REVIEWED_NAME = re.compile(r'^_(GB-T-[0-9.]+-\d{4})-原文(?:OCR)?转写\.md$')


def audit_reviewed(entries, sources, directory):
    catalog = {entry['number'].replace('GB/T ', 'GB-T-'): entry
               for entry in entries if not entry['adopted']}
    reviewed = {}
    errors = []
    flags = []

    for path in directory.rglob('_GB-T-*-原文*转写.md'):
        match = REVIEWED_NAME.fullmatch(path.name)
        if not match:
            continue
        stem = match.group(1)
        entry = catalog.get(stem)
        if entry is None:
            errors.append(f'{path}: reviewed file is not an available catalog standard')
            continue
        if stem in reviewed:
            errors.append(f'{entry["number"]}: duplicate reviewed files: {reviewed[stem]} and {path}')
            continue
        reviewed[stem] = path
        content = path.read_text()
        number = entry['number']
        heading = content.splitlines()[0] if content else ''
        expected_heading = f'# {number} {entry["title"]}'
        if re.sub(r'\s+', '', heading) != re.sub(r'\s+', '', expected_heading):
            errors.append(f'{path}: Markdown title mismatch')
        source = sources.get(stem)
        if source is None:
            errors.append(f'{path}: source record missing')
        elif source['hash'] not in '\n'.join(content.splitlines()[:8]):
            errors.append(f'{path}: source SHA-256 missing from provenance')
        if not re.search(r'^## 1\s', content, re.MULTILINE):
            errors.append(f'{path}: missing chapter 1')
        if re.search(r'尚未逐页核对|图像核对中|\[待核对表格', content):
            errors.append(f'{path}: unfinished review marker')
        if re.search(r'^\d{1,3}$', content, re.MULTILINE):
            flags.append(f'{path}: possible page number remains')
        if re.search(r'^\*\*表[^\n]*（续）', content, re.MULTILINE):
            flags.append(f'{path}: continuation table needs merging')
        for image_path in IMAGE.findall(content):
            if not (path.parent / image_path).exists():
                errors.append(f'{path}: missing diagram asset {image_path}')

    missing = sorted((entry['number'] for stem, entry in catalog.items()
                      if stem not in reviewed),
                     key=lambda number: (sources.get(number.replace('GB/T ', 'GB-T-'), {}).get('pages', 0), number))
    return {
        'available': len(catalog),
        'reviewed': len(reviewed),
        'remaining': len(missing),
        'missing': missing,
        'errors': errors,
        'review_flags': flags,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--draft-directory', type=Path, default=DRAFT_DIR)
    parser.add_argument('--coverage', action='store_true',
                        help='also audit final Markdown coverage against the available catalog')
    parser.add_argument('--reviewed-directory', type=Path, default=Path('docs'))
    args = parser.parse_args()
    entries = json.loads(CATALOG.read_text())
    downloads = json.loads(DOWNLOADS.read_text())
    counts = Counter()
    errors = []
    review_flags = []
    total_pages = 0
    sources = {}
    reviewed_stems = set()
    for path in args.reviewed_directory.rglob('_GB-T-*-原文*转写.md'):
        match = REVIEWED_NAME.fullmatch(path.name)
        if match:
            reviewed_stems.add(match.group(1))

    for entry in entries:
        number = entry['number']
        stem = number.replace('GB/T ', 'GB-T-')
        status = downloads.get(number, {}).get('result')
        if entry['adopted']:
            if status != 'not-public-adopted-standard':
                errors.append(f'{number}: unexpected adopted-standard status {status}')
            counts['not_public'] += 1
            continue

        ocr_path = OCR_DIR / stem / 'ocr.json'
        draft_path = args.draft_directory / f'{stem}.md'
        review_path = args.draft_directory / f'{stem}.review.json'
        if not ocr_path.exists() or not draft_path.exists():
            errors.append(f'{number}: missing OCR record or Markdown draft')
            continue
        record = json.loads(ocr_path.read_text())
        pages = record['pages']
        if not pages or any(page['page'] != index for index, page in enumerate(pages, 1)):
            errors.append(f'{number}: missing or out-of-order OCR pages')
        if any(not Path(page['image']).exists() for page in pages):
            errors.append(f'{number}: missing source page image')
        total_pages += len(pages)
        sources[stem] = {
            'hash': record.get('pdf_sha256', record.get('image_sha256')),
            'pages': len(pages),
        }

        if status and re.fullmatch(r'[0-9a-f]{64}', status):
            counts['pdf'] += 1
            pdf_path = PDF_DIR / f'{stem}.pdf'
            if not pdf_path.exists():
                errors.append(f'{number}: missing official PDF')
            elif hashlib.sha256(pdf_path.read_bytes()).hexdigest() != status:
                errors.append(f'{number}: official PDF SHA-256 mismatch')
            if record.get('source_type') != 'pdf-page-image' or record.get('pdf_sha256') != status:
                errors.append(f'{number}: PDF/OCR source mismatch')
        elif status == 'empty-download-response-after-retries':
            counts['online'] += 1
            manifest_path = ONLINE_DIR / stem / 'manifest.json'
            if not manifest_path.exists():
                errors.append(f'{number}: missing online-preview manifest')
            else:
                manifest = json.loads(manifest_path.read_text())
                if not manifest.get('verified_total') or manifest['page_count'] != len(pages):
                    errors.append(f'{number}: official preview page count mismatch')
                else:
                    image_hash = hashlib.sha256()
                    for page in pages:
                        image_hash.update(Path(page['image']).read_bytes())
                    if image_hash.hexdigest() != record.get('image_sha256'):
                        errors.append(f'{number}: official preview image SHA-256 mismatch')
            if record.get('source_type') != 'official-online-preview-image' or not record.get('verified_total'):
                errors.append(f'{number}: unverified online-preview OCR')
        else:
            errors.append(f'{number}: unsupported source status {status}')

        draft = draft_path.read_text()
        if not review_path.exists():
            errors.append(f'{number}: missing OCR review notes')
        else:
            review = json.loads(review_path.read_text())
            source_hash = record.get('pdf_sha256', record.get('image_sha256'))
            if review.get('number') != number or review.get('source_sha256') != source_hash:
                errors.append(f'{number}: review notes source mismatch')
            draft_lines = draft.splitlines()
            corrections = review.get('list_marker_normalizations', [])
            for correction in corrections:
                line = correction.get('line')
                if (not isinstance(line, int) or line < 1 or line > len(draft_lines) or
                        not any(draft_line.startswith(correction.get('normalized', '\0'))
                                for draft_line in draft_lines)):
                    errors.append(f'{number}: review note line mismatch {line}')
            counts['normalized_markers'] += len(corrections)
            if corrections:
                review_flags.append(f'{number}: auto-normalized lettered markers need source spot-check')
        if not draft.startswith(f'# {number} {entry["title"]}\n'):
            errors.append(f'{number}: Markdown title mismatch')
        if stem not in reviewed_stems and '尚未逐页核对' not in draft:
            errors.append(f'{number}: missing draft review label')
        if not re.search(r'^## 1\s', draft, re.MULTILINE):
            review_flags.append(f'{number}: chapter 1 not recognized')
        if re.search(r'^\*\*表[^\n]*（续）', draft, re.MULTILINE):
            review_flags.append(f'{number}: continuation table needs merging')
        if re.search(r'^\d{1,3}$', draft, re.MULTILINE):
            review_flags.append(f'{number}: possible page number remains')
        if re.search(r'^[a-z]{2,}）', draft, re.MULTILINE):
            review_flags.append(f'{number}: malformed lettered list marker')
        if re.search(r'^["“”]+$', draft, re.MULTILINE):
            review_flags.append(f'{number}: isolated quote artifact')
        if re.search(r'^(?:##+ )?[^\n]*[⋯…][^\n]*$', draft.split('## 1 ', 1)[0], re.MULTILINE):
            review_flags.append(f'{number}: possible table-of-contents text before chapter 1')
        lettered_items = re.findall(r'(?:^|[：:])\s*([a-z])）', draft, re.MULTILINE)
        if any(ord(next_item) - ord(item) > 1 for item, next_item in zip(lettered_items, lettered_items[1:])):
            review_flags.append(f'{number}: possible missing lettered list item')
        for image_path in IMAGE.findall(draft):
            if not (draft_path.parent / image_path).exists():
                errors.append(f'{number}: missing diagram asset {image_path}')
        counts['drafts'] += 1

    result = {
        'catalog': len(entries),
        'counts': dict(counts),
        'ocr_pages': total_pages,
        'errors': errors,
        'review_flags': review_flags,
    }
    if args.coverage:
        result['coverage'] = audit_reviewed(entries, sources, args.reviewed_directory)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors or (args.coverage and result['coverage']['errors']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
