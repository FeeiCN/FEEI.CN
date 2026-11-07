"""Shared public links and receipts for workflows that save website content."""
import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA_VIEWS = {
    'reading': 'docs/02-人生系统/04-人生丰富/01-阅读/阅读数据.mdx',
    'llm-usage': 'docs/01-网络安全/02-人工智能安全/01-通用人工智能/03-AI应用实践/AI使用数据.mdx',
    'account-assets': 'docs/02-人生系统/03-财务自由/03-投资/02-个股/01-个股数据.mdx',
    'hk-ipo': 'docs/02-人生系统/03-财务自由/03-投资/03-港股打新/04-港股打新数据.mdx',
    'health': 'docs/02-人生系统/01-健康幸福/健康数据.mdx',
}


def data_links(paths, root=ROOT):
    links = []
    for dataset, source in DATA_VIEWS.items():
        prefix = 'static/data/' + dataset
        if not any(path == prefix or path.startswith(prefix + '/') for path in paths):
            continue
        page = root / source
        if not page.is_file():
            continue
        front = re.match(r'\A---\n(.*?)\n---(?:\n|$)', page.read_text(), re.S)
        if not front or re.search(r'^draft:\s*true\s*$', front[1], re.M | re.I):
            continue
        slug = re.search(r'^slug:\s*[\'"]?(/[a-z0-9/-]+)[\'"]?\s*$', front[1], re.M)
        if slug:
            links.append(f'- [{page.stem}](https://feei.cn{slug[1]})')
    return links


def article_links(paths, root=ROOT):
    sitemap = root / 'build/sitemap.xml'
    metadata_dir = root / '.docusaurus/docusaurus-plugin-content-docs'
    if not sitemap.is_file() or not metadata_dir.is_dir():
        return []
    try:
        urls = [node.text for node in ET.parse(sitemap).iter() if node.tag.rsplit('}', 1)[-1] == 'loc' and node.text]
    except (ET.ParseError, OSError):
        return []
    published = {urlsplit(url).path.rstrip('/') or '/': url for url in urls
                 if urlsplit(url).scheme == 'https' and urlsplit(url).netloc == 'feei.cn'}
    sources = {'@site/' + path: path for path in paths if path.startswith('docs/')}
    links = {}
    for path in metadata_dir.glob('*/*.json'):
        try:
            doc = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(doc, dict) or doc.get('source') not in sources:
            continue
        permalink = doc.get('permalink')
        if not isinstance(permalink, str) or not permalink.startswith('/'):
            continue
        url = published.get(permalink.rstrip('/') or '/')
        if url:
            name = sources[doc['source']]
            title = doc.get('title') or name
            label = str(title).replace('\\', '\\\\').replace('[', '\\[').replace(']', '\\]').replace('\n', ' ')
            links[name] = f'- [{label}]({url})'
    return [links[path] for path in paths if path in links]


def daily_links(paths, root=ROOT):
    links = set()
    for path in paths:
        match = re.fullmatch(r'static/data/(?:daily|drive)/(\d{4})/(\d{2})/(\d{2})\.(?:md|json)', path)
        if not match:
            continue
        try:
            day = date(*map(int, match.groups())).isoformat()
        except ValueError:
            continue
        folder = root / 'docs/05-吴飞飞/02-年度总结' / match[1]
        for page in folder.glob('*/' + match[3] + '.md'):
            text = page.read_text()
            front = re.match(r'\A---\n(.*?)\n---(?:\n|$)', text, re.S)
            if not front or re.search(r'^draft:\s*true\s*$', front[1], re.M | re.I):
                continue
            slug = re.search(r'^slug:\s*[\'"]?(/' + re.escape(day) + r')[\'"]?\s*$', front[1], re.M)
            if slug:
                links.add(f'- [{day} 日记录](https://feei.cn{slug[1]})')
    return sorted(links)


def delivery_report(paths, repo, state, commit, reason, run_url, *, root=ROOT, checks='', title='已将本次内容写入 main。'):
    if state == 'done' and re.fullmatch(r'[a-f0-9]{40}', commit or ''):
        lines = [title, f'[提交 {commit[:8]}](https://github.com/{repo}/commit/{commit})']
        if checks:
            lines += ['', checks]
        links = result_links(paths, root)
        if links:
            lines += ['', '访问地址：', '', *dict.fromkeys(links)]
        lines += ['', '本次版本需等待网站部署或数据同步完成；此回复未核验线上更新。', '', '写入文件：', '']
        lines += [f"- [{name}](https://github.com/{repo}/{'tree' if (root / name).is_dir() else 'blob'}/{commit}/{quote(name)})" for name in paths]
    else:
        lines = ['本次写入流程未完成。', reason or '请查看失败步骤并核对提交记录后再决定是否重试。']
    return '\n'.join(lines) + f'\n\n[运行记录]({run_url})\n'


def result_links(paths, root=ROOT):
    return article_links(paths, root) + daily_links(paths, root) + data_links(paths, root)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('paths', nargs='*')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--title', default='已核对并保存本次内容。')
    parser.add_argument('--operation', choices=['write', 'sync', 'deploy'], default='write')
    parser.add_argument('--state', default='success', choices=['success', 'failure', 'cancelled', 'skipped'])
    parser.add_argument('--link', action='append', default=[])
    args = parser.parse_args()
    repo = os.environ['GITHUB_REPOSITORY']
    run_url = f"https://github.com/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    if args.operation == 'write':
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        report = delivery_report(args.paths, repo, 'done' if args.state == 'success' else 'failed', commit, '', run_url, root=ROOT, title=args.title)
    else:
        lines = [args.title if args.state == 'success' else f'本次任务未完成（{args.state}）。']
        if args.state == 'success':
            links = result_links(args.paths, ROOT)
            links += [f'- [查看结果]({url})' for url in args.link
                      if urlsplit(url).scheme == 'https' and urlsplit(url).netloc in {'feei.cn', 'github.com'}]
            if links:
                lines += ['', '访问地址：', '', *dict.fromkeys(links)]
            lines += ['', '以上为结果访问入口；未逐项核验线上页面或数据。']
        report = '\n'.join(lines) + f'\n\n[运行记录]({run_url})\n'
    args.output.write_text(report)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as handle:
            handle.write(report)


if __name__ == '__main__':
    main()
