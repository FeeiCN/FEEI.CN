from copy import deepcopy
from datetime import date
from pathlib import Path
import tempfile
import unittest

from render_weight_wallpaper import curve_segments, normalize, render

SOURCE = 'https://feei.cn/data/health/2026/11/04.json'


def fixture():
    return {
        'as_of': '2026-11-05',
        'weights': [{'date': day, 'weight_jin': value, 'source': SOURCE}
                    for day, value in [('2026-01-01', 160), ('2026-01-02', 159),
                                       ('2026-10-30', 154), ('2026-11-04', 156)]],
        'exercise': [{'date': day, 'minutes': value, 'source': SOURCE}
                     for day, value in [('2026-11-02', 30), ('2026-11-04', 0), ('2026-11-05', 60)]],
    }


class WallpaperTests(unittest.TestCase):
    def test_stage_does_not_regress_after_weight_rebound(self):
        state = normalize(fixture())
        self.assertEqual(state['target'], 150)
        self.assertEqual(state['current'], 156)

    def test_missing_days_and_unfinished_today_are_not_failures(self):
        state = normalize(fixture())
        self.assertEqual(state['exercise_days'], 2)
        self.assertEqual(state['exercise_successes'], 1)
        data = fixture()
        data['exercise'] = []
        self.assertIsNone(normalize(data)['exercise_latest'])

    def test_curve_breaks_across_missing_dates(self):
        state = normalize(fixture())
        self.assertEqual([len(s) for s in curve_segments(state['weights'])], [2, 1, 1])

    def test_keep_final_goal_after_reaching_140(self):
        data = fixture()
        data['weights'][0]['weight_jin'] = 139
        self.assertIsNone(normalize(data)['target'])

    def test_final_goal_rebound_renders_current_gap(self):
        data = fixture()
        data['weights'][0]['weight_jin'] = 139
        with tempfile.TemporaryDirectory() as folder:
            render(data, Path(folder), preview=True)
            svg = (Path(folder) / 'wallpaper.svg').read_text()
            self.assertIn('回到，140斤', svg)
            self.assertIn('还有 16.0 斤', svg)
            self.assertNotIn('保持已经达到的阶段', svg)
        data['weights'][-1]['weight_jin'] = 139
        with tempfile.TemporaryDirectory() as folder:
            render(data, Path(folder), preview=True)
            svg = (Path(folder) / 'wallpaper.svg').read_text()
            self.assertIn('保持，140斤', svg)
            self.assertIn('保持已经达到的阶段', svg)

    def test_invalid_values_dates_sources_and_units_are_rejected(self):
        for changes in [{'weight_jin': float('nan')}, {'weight_jin': True}, {'weight_jin': 0},
                        {'date': '2026-11-06'}, {'date': '2026-11-04'},
                        {'source': 'https://example.com/fake.json'}]:
            data = fixture()
            data['weights'][0].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                normalize(data)
        data = fixture()
        data['weights'][0] = {'date': '2026-01-01', 'weight_kg': 80, 'source': SOURCE}
        with self.assertRaises(KeyError):
            normalize(data)
        with self.assertRaises(ValueError):
            normalize(fixture(), date(2026, 11, 6))

    def test_fixed_renderer_produces_exact_png_and_matching_svg(self):
        try:
            import matplotlib
        except ImportError:
            self.skipTest('渲染集成验证需要 workflow 的 matplotlib 依赖')
        from PIL import Image
        from xml.etree import ElementTree
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            outside = output / 'protected.txt'
            outside.write_text('keep')
            (output / 'wallpaper.png').symlink_to(outside)
            with self.assertRaisesRegex(ValueError, '符号链接'):
                render(fixture(), output)
            self.assertEqual(outside.read_text(), 'keep')
            (output / 'wallpaper.png').unlink()
            render(deepcopy(fixture()), output, preview=True)
            with Image.open(output / 'wallpaper.png') as image:
                self.assertEqual(image.size, (1320, 2868))
            svg = ElementTree.parse(output / 'wallpaper.svg').getroot()
            _, _, width, height = map(float, svg.attrib['viewBox'].split())
            self.assertAlmostEqual(width / height, 1320 / 2868)
            self.assertIn('合成数据', (output / 'wallpaper.svg').read_text())


if __name__ == '__main__':
    unittest.main()
