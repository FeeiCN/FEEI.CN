import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from scripts import export_weread_data as reading


class ReadingAggregationTest(unittest.TestCase):
    def test_beijing_midnight_and_year_boundary(self):
        for date in ('2026-10-06', '2026-01-01'):
            ts = int(datetime.fromisoformat(date).replace(tzinfo=reading.BEIJING_TZ).timestamp())
            self.assertEqual(reading._ts_to_date_str(ts), date)

    def test_week_start_uses_natural_monday(self):
        self.assertEqual(reading.week_start_date('2026-10-11'), '2026-10-05')
        self.assertEqual(reading.week_start_date('2026-01-01'), '2025-12-29')
        self.assertEqual(
            reading._ts_to_date_str(reading.week_base_ts('2026-10-11')),
            '2026-10-05',
        )

    def test_active_week_starts_only_include_reading_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            monday = int(datetime(2026, 10, 5, tzinfo=reading.BEIJING_TZ).timestamp())
            sunday = int(datetime(2026, 10, 11, tzinfo=reading.BEIJING_TZ).timestamp())
            next_monday = int(datetime(2026, 10, 12, tzinfo=reading.BEIJING_TZ).timestamp())
            reading.write_json(root / '2026/10.json', {
                'readTimes': {
                    str(monday): 60,
                    str(sunday): 120,
                    str(next_monday): 0,
                },
            })
            self.assertEqual(reading._active_week_starts(root, 2026, 2026), ['2026-10-05'])

    def test_weekly_payload_only_keeps_public_display_fields(self):
        response = {
            'totalReadTime': 600,
            'rank': {'text': 'private ranking'},
            'readLongest': [{
                'book': {'bookId': 'a', 'title': '测试书', 'author': '作者'},
                'readTime': 600,
            }],
        }
        with patch.object(reading, 'api_call', return_value=response):
            payload = reading.fetch_weekly('2026-10-11')
        self.assertEqual(payload['startDate'], '2026-10-05')
        self.assertEqual(payload['books'], [{'id': 'a', 'title': '测试书', 'readTime': 600}])
        self.assertNotIn('rank', payload)

    def test_personal_highlights_and_source_sync_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def write(name, data):
                reading.write_json(root / name, data)
            ts = int(datetime(2026, 1, 1, tzinfo=reading.BEIJING_TZ).timestamp())
            write('2026/01.json', {'fetchedAt': '2026-01-02 06:39:14', 'readTimes': {str(ts): 2260}})
            write('notebooks.json', {'books': [{'bookId': 'a', 'book': {'title': '测试'}, 'bookmarkCount': 99}]})
            write('books/a/progress.json', {'book': {'readingTime': 2260}})
            write('books/a/bestbookmarks.json', {'totalCount': 999})
            write('books/a/bookmarks.json', {'updated': [{'bookmarkId': 'one'}, {'bookmarkId': 'one'}, {'bookmarkId': 'deleted'}], 'removed': ['deleted']})
            with patch.object(reading, 'now_str', return_value='2026-10-07 21:00:00'):
                reading.build_aggregates(root, 2026, 2026)
            stats = json.loads((root / 'stats.json').read_text())
            self.assertEqual(stats['totals']['bookmarksTotal'], 1)
            self.assertEqual(stats['readingSyncedAt'], '2026-01-02T06:39:14+08:00')
            self.assertEqual(stats['dateRange']['end'], '2026-01-01')
            self.assertEqual(stats['totals']['totalReadSeconds'], 2260)

    def test_successful_unchanged_fetch_updates_sync_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'month.json'
            reading.write_json(path, {'fetchedAt': '2026-10-06 06:00:00', 'readTimes': {}})
            reading.write_json(path, {'fetchedAt': '2026-10-07 06:00:00', 'readTimes': {}}, track_fetch=True)
            self.assertEqual(json.loads(path.read_text())['fetchedAt'], '2026-10-07 06:00:00')


if __name__ == '__main__':
    unittest.main()
