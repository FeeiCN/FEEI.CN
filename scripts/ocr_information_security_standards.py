"""Render official standard PDF pages and record Vision OCR alongside page images."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import fitz


PDF_DIR = Path('/tmp/feeicn-information-security-pdfs')
OUTPUT_DIR = Path('/tmp/feeicn-information-security-ocr-2x')
RENDER_SCALE = 2.0
RECOGNIZER = Path('/tmp/feeicn-recognize-standard-page')
RECOGNIZER_SOURCE = Path('scripts/recognize_standard_page.swift')
CATALOG = Path('scripts/data/information-security-technology-standards.json')
ONLINE_IMAGES_DIR = Path('/tmp/feeicn-information-security-online-images')


def ensure_recognizer():
    if RECOGNIZER.exists() and RECOGNIZER.stat().st_mtime >= RECOGNIZER_SOURCE.stat().st_mtime:
        return
    sdk = Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
    command = ['swiftc']
    if sdk.exists():
        command.extend(['-sdk', str(sdk)])
    command.extend([str(RECOGNIZER_SOURCE), '-o', str(RECOGNIZER)])
    subprocess.run(command, check=True)


def recognize(image, index):
    recognition = subprocess.run(
        [str(RECOGNIZER), str(image)],
        check=True,
        capture_output=True,
        text=True,
    )
    lines = []
    for line in recognition.stdout.splitlines():
        x, y, width, height, text = line.split('\t', 4)
        lines.append({
            'x': float(x), 'y': float(y), 'width': float(width),
            'height': float(height), 'text': text,
        })
    return {'page': index, 'image': str(image), 'lines': lines}


def process(pdf_path, output_dir):
    document = fitz.open(pdf_path)
    pages = output_dir / pdf_path.stem
    pages.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    hash_path = pages / 'source.sha256'
    if hash_path.exists() and hash_path.read_text().strip() != source_hash:
        raise ValueError(f'Source PDF changed: {pdf_path}')
    hash_path.write_text(source_hash + '\n')
    results = []
    for index, page in enumerate(document):
        image = pages / f'page-{index + 1:03d}.png'
        page_result = pages / f'page-{index + 1:03d}.json'
        if not image.exists():
            page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), alpha=False).save(image)
        if page_result.exists():
            result = json.loads(page_result.read_text())
        else:
            result = recognize(image, index + 1)
            page_result.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        results.append(result)
        print(pdf_path.stem, index + 1, len(result['lines']), flush=True)
    (pages / 'ocr.json').write_text(json.dumps({
        'source_type': 'pdf-page-image',
        'pdf_sha256': source_hash,
        'pages': results,
    }, ensure_ascii=False, indent=2) + '\n')


def process_online_images(images_dir, output_dir):
    manifest = json.loads((images_dir / 'manifest.json').read_text())
    if not manifest.get('verified_total'):
        print(images_dir.name, 'waiting for official page-count verification', flush=True)
        return
    images = [images_dir / f'page-{index:03d}.png'
              for index in range(1, manifest['page_count'] + 1)]
    if not all(image.exists() for image in images):
        raise ValueError(f'Incomplete online preview: {images_dir}')
    source_hash = hashlib.sha256()
    for image in images:
        source_hash.update(image.read_bytes())
    pages = output_dir / images_dir.name
    pages.mkdir(parents=True, exist_ok=True)
    hash_path = pages / 'source.sha256'
    if hash_path.exists() and hash_path.read_text().strip() != source_hash.hexdigest():
        for page_result in pages.glob('page-*.json'):
            page_result.unlink()
        (pages / 'ocr.json').unlink(missing_ok=True)
    hash_path.write_text(source_hash.hexdigest() + '\n')
    results = []
    for index, image in enumerate(images, 1):
        page_result = pages / f'page-{index:03d}.json'
        if page_result.exists():
            result = json.loads(page_result.read_text())
        else:
            result = recognize(image, index)
            page_result.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        results.append(result)
        print(images_dir.name, index, len(result['lines']), flush=True)
    (pages / 'ocr.json').write_text(json.dumps({
        'source_type': 'official-online-preview-image',
        'verified_total': True,
        'source_url': manifest['source'],
        'image_sha256': source_hash.hexdigest(),
        'pages': results,
    }, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('number', nargs='?', help='File stem such as GB-T-43557-2023')
    parser.add_argument('--all-downloaded', action='store_true')
    parser.add_argument('--all-online', action='store_true')
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--pdf-directory', type=Path, default=PDF_DIR)
    parser.add_argument('--output-directory', type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    if args.all_online:
        ensure_recognizer()
        for images in sorted(ONLINE_IMAGES_DIR.iterdir()):
            if (images / 'manifest.json').exists():
                process_online_images(images, args.output_directory)
        return
    if args.all_downloaded:
        entries = json.loads(CATALOG.read_text())
        chosen = entries[args.start:args.start + args.limit if args.limit else None]
        pdfs = [args.pdf_directory / (entry['number'].replace('GB/T ', 'GB-T-') + '.pdf') for entry in chosen]
    elif args.number:
        pdfs = [args.pdf_directory / f'{args.number}.pdf']
    else:
        parser.error('Provide a standard number or --all-downloaded')
    ensure_recognizer()
    for pdf in pdfs:
        if pdf.exists():
            process(pdf, args.output_directory)


if __name__ == '__main__':
    main()
