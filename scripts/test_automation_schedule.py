import unittest
from datetime import datetime, timezone
from automation_schedule import assess, latest_slot


def utc(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


class ScheduleTests(unittest.TestCase):
    task = {'id': 'hk-ipo-alerts', 'schedule': ['0 0,4,8,12 * * *']}

    def test_expired_and_current_windows(self):
        self.assertTrue(assess(self.task, 'schedule', utc('2026-11-07T03:37:00'))['expired'])
        self.assertFalse(assess(self.task, 'schedule', utc('2026-11-07T04:10:00'))['expired'])
        self.assertFalse(assess(self.task, 'workflow_dispatch', utc('2026-11-07T03:37:00'))['expired'])

    def test_weekly_monthly_and_day_or_weekday(self):
        self.assertEqual(latest_slot(['0 1 * * 1'], utc('2026-11-07T04:10:00')), utc('2026-11-02T01:00:00'))
        self.assertEqual(latest_slot(['0 1 1 * *'], utc('2026-11-07T04:10:00')), utc('2026-11-01T01:00:00'))
        self.assertEqual(latest_slot(['0 1 1 * 6'], utc('2026-11-07T04:10:00')), utc('2026-11-07T01:00:00'))
        self.assertEqual(latest_slot(['*/30 * * * *'], utc('2026-11-07T04:10:00')), utc('2026-11-07T04:00:00'))
