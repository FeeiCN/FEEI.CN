import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import workflow_delivery as delivery


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def page(self, name, front):
        page = self.root / name
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text('---\n' + front + '\n---\n正文\n')

    def test_daily_and_drive_share_existing_date_page(self):
        self.page('docs/05-吴飞飞/02-年度总结/2026/11-十一月/07.md', 'slug: /2026-11-07')
        paths = ['static/data/daily/2026/11/07.md', 'static/data/drive/2026/11/07.json']
        self.assertEqual(delivery.daily_links(paths, self.root),
                         ['- [2026-11-07 日记录](https://feei.cn/2026-11-07)'])

    def test_date_page_must_exist_match_date_and_be_public(self):
        paths = ['static/data/daily/2026/11/07.md']
        self.assertEqual(delivery.daily_links(paths, self.root), [])
        for front in ['slug: /2026-10-07', 'slug: /2026-11-07\ndraft: true']:
            self.page('docs/05-吴飞飞/02-年度总结/2026/11/07.md', front)
            self.assertEqual(delivery.daily_links(paths, self.root), [])
        self.assertEqual(delivery.daily_links(['static/data/daily/2026/02/30.md'], self.root), [])

    def test_data_directory_and_file_link_to_dashboard_only(self):
        for dataset, source in delivery.DATA_VIEWS.items():
            self.page(source, 'slug: /' + dataset + '-dashboard')
            for path in ['static/data/' + dataset, 'static/data/' + dataset + '/private.json']:
                report = delivery.delivery_report([path], 'owner/repo', 'done', 'a' * 40,
                                                   '', 'https://github.com/run', root=self.root)
                self.assertIn('https://feei.cn/' + dataset + '-dashboard', report)
                self.assertNotIn('https://feei.cn/data/', report)
        self.assertEqual(delivery.data_links(['static/data/unknown/x.json'], self.root), [])
        self.assertEqual(delivery.data_links(['static/data/health-other/x.json'], self.root), [])

    def test_draft_and_missing_dashboard_are_not_linked(self):
        paths = ['static/data/health']
        self.assertEqual(delivery.data_links(paths, self.root), [])
        self.page(delivery.DATA_VIEWS['health'], 'slug: /health-data\ndraft: true')
        self.assertEqual(delivery.data_links(paths, self.root), [])

    def test_failed_write_never_claims_success_or_links_result(self):
        for state, commit in [('failed', 'a' * 40), ('done', ''), ('done', 'not-a-commit')]:
            report = delivery.delivery_report(['docs/article.md'], 'owner/repo', state,
                                               commit, '构建失败', 'https://github.com/run', root=self.root)
            self.assertIn('构建失败', report)
            self.assertNotIn('访问地址', report)
            self.assertNotIn('/commit/', report)

    def run_cli(self, *args):
        output = self.root / 'output.md'
        summary = self.root / 'summary.md'
        summary.unlink(missing_ok=True)
        with patch.object(delivery, 'ROOT', self.root), \
             patch.dict(os.environ, {'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_RUN_ID': '123',
                                     'GITHUB_STEP_SUMMARY': str(summary)}), \
             patch('sys.argv', ['workflow_delivery.py', '--output', str(output), *args]):
            delivery.main()
        self.assertEqual(output.read_text(), summary.read_text())
        return output.read_text()

    def test_sync_receipt_has_dashboard_run_and_no_commit_claim(self):
        self.page(delivery.DATA_VIEWS['health'], 'slug: /health-data')
        report = self.run_cli('static/data/health', '--operation', 'sync', '--title', '同步完成。')
        self.assertIn('https://feei.cn/health-data', report)
        self.assertIn('/owner/repo/actions/runs/123', report)
        self.assertIn('未逐项核验线上', report)
        self.assertNotIn('/commit/', report)

    def test_deployment_failure_does_not_offer_success_link(self):
        for state in ['failure', 'cancelled', 'skipped']:
            report = self.run_cli('--operation', 'deploy', '--state', state,
                                  '--title', '部署完成', '--link', 'https://feei.cn')
            self.assertIn(state, report)
            self.assertNotIn('部署完成', report)
            self.assertNotIn('https://feei.cn', report)

    def test_configured_result_links_allow_only_expected_https_hosts(self):
        report = self.run_cli('--operation', 'deploy', '--title', '部署步骤完成。',
                              '--link', 'https://feei.cn', '--link', 'https://github.com/owner/repo',
                              '--link', 'http://feei.cn', '--link', 'https://feei.cn.evil.test',
                              '--link', 'https://feei.cn@evil.test')
        self.assertIn('](https://feei.cn)', report)
        self.assertIn('](https://github.com/owner/repo)', report)
        self.assertNotIn('evil.test', report)
        self.assertNotIn('http://', report)
        self.assertNotIn('已上线', report)

    def test_write_receipt_uses_git_commit_and_same_summary(self):
        with patch.object(delivery.subprocess, 'check_output', return_value='a' * 40 + '\n'):
            report = self.run_cli('docs/example.md')
        self.assertIn('/commit/' + 'a' * 40, report)
        self.assertIn('未核验线上更新', report)


if __name__ == '__main__':
    unittest.main()
