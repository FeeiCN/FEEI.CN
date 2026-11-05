import importlib.util
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('automation_tasks', Path(__file__).with_name('automation_tasks.py'))
automation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(automation)


class AutomationResultTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / 'output'
        self.out.mkdir()
        self.root_patch = patch.object(automation, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.task = {'id': 'security-event-research'}
        self.result = {'status': 'completed', 'report_markdown': '完整研究正文',
                       'sources': ['https://example.com/a', 'https://example.com/b'], 'artifacts': []}

    def test_research_requires_actual_source_list(self):
        self.result['sources'] = []
        with self.assertRaisesRegex(ValueError, '来源'):
            automation.validate_result(self.task, self.result, self.out)

    def test_blocked_is_not_reclassified_as_completed(self):
        self.result.update(status='blocked', sources=[])
        self.assertEqual(automation.validate_result(self.task, self.result, self.out)[0], 'blocked')

    def test_missing_artifact_rejected(self):
        self.result['artifacts'] = ['output/missing.png']
        with self.assertRaisesRegex(ValueError, '不存在'):
            automation.validate_result(self.task, self.result, self.out)

    def test_artifact_cannot_escape_output_or_follow_symlink(self):
        outside = self.root / 'private.txt'
        outside.write_text('must not publish')
        (self.out / 'link.txt').symlink_to(outside)
        for name in ['output/../private.txt', 'output/link.txt', '/etc/passwd']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.result['artifacts'] = [name]
                automation.validate_result(self.task, self.result, self.out)

    def test_private_delivery_fails_before_reading_data(self):
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/public'}, clear=True):
            with self.assertRaisesRegex(ValueError, '停止读取私人数据'):
                automation.destination({'delivery': 'private_issue'})

    def test_private_delivery_rejects_public_repository(self):
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/public',
                                      'AUTOMATION_PRIVATE_REPOSITORY': 'owner/result'}, clear=True):
            with patch.object(automation, 'gh', return_value='{"private":false}'):
                with self.assertRaisesRegex(ValueError, '私有仓库'):
                    automation.destination({'delivery': 'private_issue'})

    def test_wallpaper_must_have_real_png_and_svg(self):
        self.task['id'] = 'update-weight-wallpaper'
        with self.assertRaisesRegex(ValueError, 'PNG 和 SVG'):
            automation.validate_result(self.task, self.result, self.out)

    def test_no_update_needs_no_research_sources(self):
        self.result.update(status='no_update', sources=[])
        self.assertEqual(automation.validate_result(self.task, self.result, self.out)[0], 'no_update')

    def test_private_prepare_does_not_fetch_data_without_destination(self):
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/public'}, clear=True):
            with patch.object(automation, 'collect_personal_data') as collect:
                with self.assertRaises(ValueError):
                    automation.prepare({'delivery': 'private_issue'}, self.out)
                collect.assert_not_called()

    def collect_with_month_response(self, month):
        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 1, 2, 12, tzinfo=timezone.utc)

        def fetch(request, **kwargs):
            url = request.full_url
            if re.search(r'/\d{4}/\d{2}/\d{2}\.json$', url):
                raise HTTPError(url, 404, 'missing', {}, None)
            return io.BytesIO(json.dumps(month).encode())

        with patch.object(automation, 'datetime', FixedDateTime), patch.object(automation, 'urlopen', side_effect=fetch):
            automation.collect_personal_data({'id': 'update-weight-wallpaper'}, self.out)
        return json.loads((self.out / 'personal-data-index.json').read_text())

    def test_legacy_original_measurements_are_available_when_daily_indexes_are_missing(self):
        records = self.collect_with_month_response({'data': {'healthMetrics': {'metrics': [
            {'name': 'weight_body_mass', 'units': 'kg', 'data': [{'date': '2026-01-01', 'qty': 70}]}]}}})
        legacy = [r for r in records if r.get('format') == 'legacy_original']
        self.assertEqual(len(legacy), 1)
        self.assertTrue((self.root / legacy[0]['local']).is_file())

    def test_month_cache_is_not_treated_as_original_measurements(self):
        records = self.collect_with_month_response({'version': 5, 'days': [{'weight': 70}]})
        self.assertFalse(any(r.get('format') == 'legacy_original' for r in records))


if __name__ == '__main__':
    unittest.main()
