import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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


if __name__ == '__main__':
    unittest.main()
