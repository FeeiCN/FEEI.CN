"""Check merged source tables, missing disclosures and lossless Markdown output."""

from copy import deepcopy
from html import unescape
import json
from pathlib import Path
import re
import unittest

from scripts.collect_pbc_enforcement_cases import (
    DEFAULT_OUTPUT, DOM, END, START, detail, grid, render, validate,
)


DOCUMENT = Path('docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规/12-处罚案例库.md')


class SourceTableTests(unittest.TestCase):
    def test_merged_cells_remain_associated_with_each_subject(self):
        table = next(DOM('''<table>
          <tr><th colspan="2">人员</th><th>处罚</th></tr>
          <tr><td rowspan="2">甲机构</td><td>甲某</td><td>1万元</td></tr>
          <tr><td>乙某</td><td>2万元</td></tr>
        </table>''').root.walk('table'))
        self.assertEqual(grid(table), [
            ['人员', '人员', '处罚'], ['甲机构', '甲某', '1万元'], ['甲机构', '乙某', '2万元'],
        ])

    def test_separate_tables_share_headers_without_losing_precision(self):
        article = {'title': '银罚决字【2023】26-27号', 'url': 'https://example.test/notice', 'published_at': '2023-07-07'}
        html = '''<meta name="PubDate" content="2023-07-07"><div class="content_box">
          <table><tr><td>当事人名称</td><td>行政处罚决定书文号</td><td>违法行为类型</td>
          <td>行政处罚内容</td><td>作出行政处罚决定的机关名称</td><td>作出行政处罚决定的日期</td><td>备注</td></tr></table>
          <table><tr><td>甲公司</td><td>银罚决字〔2023〕26号</td><td><p>1.违反甲规定；</p><p>2.违反乙规定。</p></td>
          <td>没收违法所得83091.414113万元，罚款223115.389033万元</td><td>中国人民银行</td><td>2023年7月7日</td><td></td></tr></table>
          <table><tr><td>张某[时任负责人]</td><td>银罚决字〔2023〕27号</td><td>对甲事项负有责任。</td>
          <td>罚款1万元</td><td>中国人民银行</td><td>2023年7月7日</td><td>个人决定</td></tr></table>
        </div>'''
        notice = detail(html.encode(), article)
        validate({'notices': [notice], 'declared_notices': 1})
        self.assertEqual(notice['cases'][0]['penalty'], '没收违法所得83091.414113万元，罚款223115.389033万元')
        self.assertEqual(notice['cases'][0]['violations'], '1.违反甲规定；\n2.违反乙规定。')
        self.assertEqual(notice['cases'][0]['notes'], '')
        self.assertEqual(notice['cases'][1]['subject'], '张某[时任负责人]')
        self.assertEqual(notice['cases'][1]['notes'], '个人决定')


class ArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = json.loads(DEFAULT_OUTPUT.read_text())

    def test_every_published_decision_is_present_once(self):
        validate(self.archive)
        self.assertEqual(len(self.archive['listing_pages']), 4)
        self.assertEqual(len(self.archive['notices']), 67)
        self.assertEqual(sum(len(n['cases']) for n in self.archive['notices']), 447)

    def test_missing_or_duplicate_decisions_block_publication(self):
        missing = deepcopy(self.archive)
        missing['notices'][0]['cases'].pop()
        with self.assertRaisesRegex(ValueError, 'coverage'):
            validate(missing)
        duplicate = deepcopy(self.archive)
        duplicate['notices'][0]['cases'][1] = duplicate['notices'][0]['cases'][0]
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            validate(duplicate)

    def test_untranscribed_content_blocks_publication(self):
        for field, value in [('unparsed_rows', [['unknown']]), ('attachments', [{'url': 'a.pdf'}]),
                             ('images', ['a.png']), ('body_text', '尚未转写')]:
            with self.subTest(field=field):
                incomplete = deepcopy(self.archive)
                incomplete['notices'][0][field] = value
                with self.assertRaisesRegex(ValueError, 'additional transcription'):
                    validate(incomplete)

    def test_published_markdown_matches_archive_and_all_cell_values(self):
        source = DOCUMENT.read_text()
        section = START + source.split(START, 1)[1].split(END, 1)[0] + END
        self.assertEqual(section, render(self.archive))
        cases = [case for n in self.archive['notices'] for case in n['cases']]
        blocks = re.split(r'^#### .+\n', section, flags=re.M)[1:]
        self.assertEqual(len(blocks), len(cases))
        for case, block in zip(cases, blocks):
            plain = unescape(re.sub(r'\\([\\`*_\[\]|$.])', r'\1', block))
            for key, value in case.items():
                if key == 'violations':
                    for line in value.splitlines():
                        self.assertIn('> ' + line + '\n', plain)
                elif value:
                    self.assertIn('：' + value + '\n', plain)
        for notice in self.archive['notices']:
            self.assertEqual(section.count('](' + notice['url'] + ')'), 1)
        disclosures = list(DOM(section).root.walk('details'))
        self.assertEqual(len(disclosures), len(self.archive['notices']))
        for notice, disclosure in zip(self.archive['notices'], disclosures):
            summary = next(disclosure.walk('summary')).text()
            self.assertIn(notice['published_at'], summary)
            self.assertIn(notice['cases'][0]['subject'], summary)
            self.assertIn(f'{len(notice["cases"])} 条处罚', summary)
            self.assertNotIn('open', disclosure.attrs)
            text = unescape(re.sub(r'\\([\\`*_\[\]|$.])', r'\1', disclosure.text()))
            for case in notice['cases']:
                self.assertIn(case['decision_number'], text)
                self.assertIn(case['subject'], text)


if __name__ == '__main__':
    unittest.main()
