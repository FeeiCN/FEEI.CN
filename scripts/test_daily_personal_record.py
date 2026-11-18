import copy
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import daily_personal_record as daily
import scheduled_issue_review as review

DAY = date(2026, 11, 10)
REPO = 'owner/repo'


def instant(value):
    return datetime.fromisoformat(value).replace(tzinfo=daily.TZ)


def issue(number=864, body=None):
    return {'number': number, 'html_url': f'https://github.com/{REPO}/issues/{number}',
            'created_at': '2026-11-10T08:57:34Z', 'user': {'login': daily.BOT},
            'body': body if body is not None else daily.TASK_MARKER + daily.day_marker(DAY)}


def snapshot():
    entries = {k: {'status': 'unavailable'} for k in ('health', 'sleep-score', 'reading', 'openai', 'anthropic', 'minimax', 'git', 'issues')}
    entries['health'] = {'status': 'available', 'url': 'https://example.com/health', 'data': {'date': str(DAY), 'version': 5,
        'exportedAt': '2026-11-10T23:00:00+08:00', 'activity': {'steps': 0, 'exerciseMinutes': 12},
        'bodyMeasurements': {'weight': {'dailyKg': 70}}}}
    return {'date': str(DAY), 'cutoff': '2026-11-10T23:15:00+08:00', 'collected_at': '2026-11-10T23:15:00+08:00', 'sources': entries}


class DailyTests(unittest.TestCase):
    def setUp(self):
        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 11, 10, 12, tzinfo=timezone.utc).astimezone(tz)
        clock = patch.object(daily, 'datetime', FixedDatetime)
        clock.start()
        self.addCleanup(clock.stop)
        guard = patch.object(daily, 'api', side_effect=AssertionError('测试必须隔离 GitHub API'))
        guard.start()
        self.addCleanup(guard.stop)

    def test_inbox_contains_owner_review_questions_without_filled_answers(self):
        body = daily.inbox_body(REPO, DAY, '42')
        for phrase in ['今日主要做了什么', '照顾好了自己', '照顾好了家人', '真正重要的事情',
                       '四个目标', '开心和不愉快', '明天可以提升']:
            self.assertIn(phrase, body)
        self.assertNotIn('- [x]', body)

    def test_body_updates_preserve_owner_prose_and_other_section_without_comments(self):
        record = issue(body=daily.inbox_body(REPO, DAY, '42') + '\n\n我今天陪家人散步。\n')
        original = record['body']
        server = copy.deepcopy(record)

        def api(endpoint, method='GET', data=None):
            self.assertNotIn('/comments', endpoint)
            if method == 'PATCH':
                server.update(data)
            return copy.deepcopy(server)

        data = daily.snapshot_marker(DAY)
        clues = f'<!-- daily-personal-clues:{DAY} -->'
        with patch.object(daily, 'api', side_effect=api) as call:
            daily.publish_section(REPO, record, data, '旧数据')
            daily.publish_section(REPO, record, clues, '本轮线索')
            daily.publish_section(REPO, record, data, '新数据')
            count = call.call_count
            daily.publish_section(REPO, record, data, '新数据')
            self.assertEqual(call.call_count, count)
        self.assertTrue(record['body'].startswith(original))
        self.assertEqual(daily.section_content(record['body'], clues).strip(), '本轮线索')
        self.assertEqual(daily.section_content(record['body'], data).strip(), '新数据')
        self.assertNotIn('旧数据', record['body'])
        self.assertEqual(daily.without_sections(record['body']).strip(), original.strip())

    def test_body_update_stops_on_concurrent_owner_edit_or_wrong_author(self):
        for changed in [issue(body=issue()['body'] + '\n本人新补充'), {**issue(), 'user': {'login': 'owner'}}]:
            with self.subTest(changed=changed), patch.object(daily, 'api', return_value=changed) as call:
                with self.assertRaisesRegex(ValueError, '已变化'):
                    daily.publish_section(REPO, issue(), daily.snapshot_marker(DAY), '新数据')
                self.assertEqual(call.call_count, 1)
                self.assertEqual(len(call.call_args.args), 1)

    def test_damaged_duplicate_or_oversized_sections_never_overwrite_body(self):
        marker = daily.snapshot_marker(DAY)
        end = marker.replace(' -->', ':end -->')
        for suffix in [marker, end, marker + end + marker + end, end + marker]:
            with self.subTest(suffix=suffix), patch.object(daily, 'api') as call:
                with self.assertRaises(ValueError):
                    daily.publish_section(REPO, issue(body=issue()['body'] + suffix), marker, '数据')
                call.assert_not_called()
        with patch.object(daily, 'api') as call, self.assertRaisesRegex(ValueError, '大小限制'):
            daily.publish_section(REPO, issue(), marker, '数据' * 20000)
        call.assert_not_called()

    def test_managed_data_run_links_do_not_replace_daily_source_provenance(self):
        body = daily.inbox_body(REPO, DAY, '42')
        marker = daily.snapshot_marker(DAY)
        body += '\n' + marker + f'\nhttps://github.com/{REPO}/actions/runs/99\n' + marker.replace(' -->', ':end -->')
        run = {'path': '.github/workflows/daily-personal-record.yml', 'head_branch': 'main',
               'event': 'schedule', 'head_repository': {'full_name': REPO}}
        with patch.object(review, 'registered_tasks', return_value={'daily-personal-record': run['path']}):
            self.assertEqual(review.task_source({'author': {'login': daily.BOT}, 'body': body}, REPO,
                                               lambda number: run if number == '42' else {}), 'daily-personal-record')

    def test_completed_body_sections_skip_morning_collection_and_model(self):
        marker = daily.snapshot_marker(DAY)
        clues = f'<!-- daily-personal-clues:{DAY} -->'
        body = issue()['body'] + marker + '\n早间快照\n' + marker.replace(' -->', ':end -->')
        body += clues + '\n<!-- daily-clues-status:completed -->\n线索\n' + clues.replace(' -->', ':end -->')
        with tempfile.TemporaryDirectory() as folder, patch.object(daily, 'ROOT', Path(folder)), patch.dict(os.environ, {
                'GITHUB_REPOSITORY': REPO, 'PERSONAL_MODE': 'create', 'PERSONAL_DATE': str(DAY),
                'GITHUB_OUTPUT': folder + '/outputs', 'GITHUB_STEP_SUMMARY': folder + '/summary'}), \
                patch.object(daily, 'find_issue', return_value=issue(body=body)), patch.object(daily, 'pages', return_value=[]), \
                patch.object(daily, 'timing', return_value={}), patch.object(daily, 'collect') as collect, \
                patch.object(daily, 'publish_sections') as publish, patch('sys.argv', ['daily', 'prepare']):
            daily.main()
            collect.assert_not_called()
            publish.assert_not_called()
            self.assertIn('ready=false', Path(folder + '/outputs').read_text())

    def test_wrong_date_or_damaged_other_section_stops_update(self):
        marker = daily.snapshot_marker(DAY)
        for body in [issue()['body'].replace(str(DAY), '2026-11-09'),
                     issue()['body'] + f'<!-- daily-personal-clues:{DAY}:end -->']:
            with self.subTest(body=body), patch.object(daily, 'api') as call, self.assertRaises(ValueError):
                daily.publish_section(REPO, issue(body=body), marker, '新数据')
            call.assert_not_called()

    def test_morning_clues_and_evening_refresh_update_body_without_comments(self):
        import automation_tasks as automation
        server = issue(body=daily.inbox_body(REPO, DAY, '42'))

        def api(endpoint, method='GET', data=None):
            self.assertNotIn('/comments', endpoint)
            self.assertIn(method, ['GET', 'PATCH'])
            if method == 'PATCH':
                server.update(data)
            return copy.deepcopy(server)

        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / 'output'
            env = {'GITHUB_REPOSITORY': REPO, 'PERSONAL_MODE': 'create', 'PERSONAL_DATE': str(DAY),
                   'PERSONAL_ISSUE': '864', 'GITHUB_OUTPUT': folder + '/outputs', 'GITHUB_STEP_SUMMARY': folder + '/summary'}
            with patch.object(daily, 'ROOT', Path(folder)), patch.dict(os.environ, env), \
                    patch.object(daily, 'find_issue', side_effect=lambda *args: copy.deepcopy(server)), \
                    patch.object(daily, 'api', side_effect=api), patch.object(daily, 'pages', return_value=[]), \
                    patch.object(daily, 'timing', return_value={}), patch('sys.argv', ['daily', 'prepare']):
                with patch.object(daily, 'collect', return_value=snapshot()):
                    daily.main()
                self.assertIn('ready=true', Path(folder + '/outputs').read_text())
                (out / 'result.json').write_text(json.dumps({
                    'status': 'completed', 'report_markdown': '已经核实的一条线索。', 'sources': [], 'artifacts': [],
                    'audit': {'summary': '核对当前来源', 'data_cutoff': str(DAY), 'deduplication_reason': '当天首次线索'},
                }))
                (out / 'metadata.json').write_text(json.dumps({'delivery_repository': REPO}))
                automation.deliver({'id': 'daily-personal-record', 'delivery': 'issue'}, out)
                server['body'] += '\n\n我今天陪家人散步，很开心。'
                missing = snapshot()
                missing['sources']['health'] = {'status': 'unavailable'}
                with patch.dict(os.environ, {'PERSONAL_MODE': 'refresh'}), patch.object(daily, 'collect', return_value=missing):
                    daily.main()
            self.assertIn('我今天陪家人散步，很开心。', server['body'])
            self.assertIn('已经核实的一条线索。', server['body'])
            self.assertIn('体重：70 kg', server['body'])
            self.assertIn('非本次更新', server['body'])
            self.assertEqual(server['body'].count(daily.snapshot_marker(DAY)), 1)
            self.assertEqual(server['body'].count(f'<!-- daily-personal-clues:{DAY} -->'), 1)

    def test_created_inbox_passes_registered_task_source_validation(self):
        body = daily.inbox_body(REPO, DAY, '42')
        source = {'author': {'login': daily.BOT}, 'body': body}
        run = {'path': '.github/workflows/daily-personal-record.yml', 'head_branch': 'main',
               'event': 'schedule', 'head_repository': {'full_name': REPO}}
        self.assertEqual(review.task_source(source, REPO, lambda _: run), 'daily-personal-record')
        self.assertIn(daily.day_marker(DAY), body)
        for field, value in [('path', '.github/workflows/other.yml'), ('head_branch', 'other'),
                             ('head_repository', {'full_name': 'other/repo'}), ('event', 'issue_comment')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                review.task_source(source, REPO, lambda _: {**run, field: value})
        with self.assertRaises(ValueError):
            review.task_source({**source, 'body': body + f'\nhttps://github.com/{REPO}/actions/runs/43'},
                               REPO, lambda _: run)

    def test_inbox_without_valid_run_id_is_not_created(self):
        for run_id in (None, '', '0', '-1', '42/not-a-run'):
            with self.subTest(run_id=run_id), self.assertRaises(ValueError):
                daily.inbox_body(REPO, DAY, run_id)

    def test_timezone_and_midnight_refresh_pin_previous_date(self):
        self.assertEqual(daily.resolve(instant('2026-11-10T07:45:00')), (DAY, 'create'))
        self.assertEqual(daily.resolve(instant('2026-11-10T16:53:23')), (DAY, 'create'))
        self.assertEqual(daily.resolve(instant('2026-11-10T23:15:00'), '15 15 * * *'), (DAY, 'refresh'))
        self.assertEqual(daily.resolve(instant('2026-11-11T00:15:00'), '15 16 * * *'), (DAY, 'refresh'))
        self.assertEqual(daily.resolve(instant('2026-11-11T01:30:00'), '15 15 * * *'), (DAY, 'refresh'))
        self.assertEqual(daily.resolve(instant('2026-11-11T08:30:00'), '15 15 * * *'), (DAY, 'refresh'))
        self.assertEqual(daily.resolve(instant('2026-11-11T08:00:00'), target=str(DAY)), (DAY, 'refresh'))
        with self.assertRaises(ValueError):
            daily.resolve(instant('2026-11-10T10:00:00'), target='2027-01-01')

    def test_existing_legacy_issue_reused_instead_of_duplicate(self):
        legacy = issue(body=daily.TASK_MARKER + '\n<!-- status:completed -->')
        with patch.object(daily, 'pages', return_value=[legacy]):
            self.assertEqual(daily.find_issue(REPO, DAY)['number'], 864)
        wrong = issue(body=daily.TASK_MARKER + daily.day_marker(date(2026, 11, 9)))
        with patch.object(daily, 'pages', return_value=[wrong]):
            self.assertIsNone(daily.find_issue(REPO, DAY))

    def test_multiple_daily_issues_stop_instead_of_guessing(self):
        with patch.object(daily, 'pages', return_value=[issue(), issue(865)]), self.assertRaises(ValueError):
            daily.find_issue(REPO, DAY)

    def test_legacy_comments_are_copied_once_to_body_without_comment_writes(self):
        data, clues = daily.snapshot_marker(DAY), f'<!-- daily-personal-clues:{DAY} -->'
        record = issue(body=daily.inbox_body(REPO, DAY, '42') + '\n我今天陪家人散步。')
        server = copy.deepcopy(record)
        comments = [{'id': 1, 'user': {'login': daily.BOT}, 'body': data + '\n旧数据'},
                    {'id': 2, 'user': {'login': daily.BOT}, 'body': data + '\n最新数据'},
                    {'id': 3, 'user': {'login': 'owner'}, 'body': data + '\n本人写的内容'},
                    {'id': 4, 'user': {'login': daily.BOT}, 'body': clues + '\n<!-- daily-clues-status:completed -->\n线索'}]
        untouched = copy.deepcopy(comments)
        def api(endpoint, method='GET', payload=None):
            self.assertNotIn('/comments', endpoint)
            if method == 'PATCH':
                server.update(payload)
            return copy.deepcopy(server)
        with patch.object(daily, 'api', side_effect=api) as calls:
            daily.publish_sections(REPO, record, daily.legacy_sections(record, DAY, comments))
            self.assertEqual(sum(c.args[1:2] == ('PATCH',) for c in calls.call_args_list), 1)
            self.assertEqual(daily.legacy_sections(record, DAY, comments), {})
            daily.publish_sections(REPO, record, {})
            self.assertEqual(sum(c.args[1:2] == ('PATCH',) for c in calls.call_args_list), 1)
        self.assertIn('最新数据', record['body'])
        self.assertNotIn('旧数据', record['body'])
        self.assertIn('我今天陪家人散步。', record['body'])
        self.assertIn('daily-clues-status:completed', record['body'])
        self.assertEqual(comments, untouched)

    def test_atomic_body_update_validates_all_sections_before_writing(self):
        data = daily.snapshot_marker(DAY)
        for second in [('bad marker', '线索'), (f'<!-- daily-personal-clues:{DAY} -->', '很长' * 30000)]:
            with self.subTest(marker=second[0]), patch.object(daily, 'api') as api:
                with self.assertRaises(ValueError):
                    daily.publish_sections(REPO, issue(), {data: '数据', second[0]: second[1]})
            api.assert_not_called()

    def test_zero_is_preserved_and_missing_sources_not_reported_as_zero(self):
        report = daily.render(snapshot())
        self.assertIn('步数：0 步', report)
        self.assertIn('openai：来源不可用', report)
        self.assertNotIn('0 Token', report)
        self.assertIn('体重：70 kg', report)

    def test_legacy_token_array_is_unknown_not_assigned_to_today(self):
        snap = snapshot()
        snap['sources']['anthropic'] = {'status': 'available', 'url': 'https://example.com',
                                        'data': {'daily_token_usage': [100, 200], 'fetchedAt': '2026-06-11'}}
        self.assertIn('未提供当天数据', daily.render(snap))
        self.assertFalse(daily.usable('anthropic', snap['sources']['anthropic'], str(DAY)))

    def test_failure_preserves_previous_good_source_with_explicit_staleness(self):
        old = daily.render(snapshot())
        missing = snapshot()
        missing['sources']['health'] = {'status': 'unavailable'}
        new = daily.preserve_sources(daily.render(missing), old, missing)
        self.assertIn('体重：70 kg', new)
        self.assertIn('非本次更新', new)

    def test_stale_tokens_prevent_evening_complete_and_allow_retry(self):
        snap = snapshot()
        for kind in ('sleep-score', 'git', 'issues'):
            snap['sources'][kind] = {'status': 'available'}
        snap['sources']['reading'] = {'status': 'available', 'data': {'daily': {str(DAY): {'seconds': 0}}}}
        for vendor in ('openai', 'anthropic', 'minimax'):
            snap['sources'][vendor] = {'status': 'available', 'data': {'fetchedAt': '2026-11-10 23:00:00', 'daily_token_usage': {str(DAY): 0}}}
        self.assertTrue(daily.fresh(snap))
        snap['sources']['openai']['data']['fetchedAt'] = '2026-11-10 07:10:00'
        self.assertFalse(daily.fresh(snap))

    def test_timing_distinguishes_creation_delay_from_run_start(self):
        now = instant('2026-11-10T16:53:36')
        with patch.dict(os.environ, {'GITHUB_RUN_ID': '42'}), patch.object(daily, 'api', return_value={
                'created_at': '2026-11-10T08:53:23Z', 'run_started_at': '2026-11-10T08:53:26Z'}):
            timing = daily.timing(REPO, DAY, 'create', now)
        self.assertAlmostEqual(timing['plan_to_creation_minutes'], 548.4, places=1)
        self.assertEqual(timing['creation_to_run_start_seconds'], 3)
        self.assertIn('不是 Runner 排队', timing['note'])

    def test_late_refresh_reuses_original_day_and_legacy_issue_without_model(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(daily, 'ROOT', Path(folder)), patch.dict(os.environ, {
                'GITHUB_REPOSITORY': REPO, 'PERSONAL_MODE': 'refresh', 'PERSONAL_DATE': str(DAY),
                'GITHUB_OUTPUT': folder + '/outputs', 'GITHUB_STEP_SUMMARY': folder + '/summary',
                'GITHUB_EVENT_NAME': 'workflow_dispatch'}), patch.object(daily, 'find_issue', return_value=issue()), patch.object(
                daily, 'pages', return_value=[]), patch.object(daily, 'timing', return_value={}), patch.object(
                daily, 'collect', return_value=snapshot()), patch.object(daily, 'publish_sections') as publish, patch('sys.argv', ['daily', 'prepare']):
            daily.main()
            self.assertIn('ready=false', Path(folder + '/outputs').read_text())
            self.assertIn(str(DAY), publish.call_args.args[2][daily.snapshot_marker(DAY)])

    def test_inbox_created_before_slow_collection_and_morning_retries_skip_model(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(daily, 'ROOT', Path(folder)), patch.dict(os.environ, {
                'GITHUB_REPOSITORY': REPO, 'PERSONAL_MODE': 'create', 'PERSONAL_DATE': str(DAY),
                'GITHUB_RUN_ID': '42',
                'GITHUB_OUTPUT': folder + '/outputs', 'GITHUB_STEP_SUMMARY': folder + '/summary'}), patch.object(
                daily, 'find_issue', return_value=None), patch.object(daily, 'api', return_value=issue()) as api, patch.object(
                daily, 'pages', return_value=[]), patch.object(daily, 'timing', return_value={}), patch.object(daily, 'publish_sections'), patch(
                'sys.argv', ['daily', 'prepare']):
            def collect(*args):
                self.assertEqual(api.call_args.args[1], 'POST')
                self.assertEqual(api.call_args.args[2]['assignees'], ['owner'])
                posted = api.call_args.args[2]['body']
                self.assertEqual(review.task_source({'author': {'login': daily.BOT}, 'body': posted}, REPO,
                    lambda _: {'path': '.github/workflows/daily-personal-record.yml', 'head_branch': 'main',
                               'event': 'schedule', 'head_repository': {'full_name': REPO}}), 'daily-personal-record')
                return snapshot()
            with patch.object(daily, 'collect', side_effect=collect):
                daily.main()
            self.assertIn('ready=true', Path(folder + '/outputs').read_text())

    def test_successful_morning_retry_skips_collection_and_model(self):
        comments = [{'id': 1, 'user': {'login': daily.BOT}, 'body': daily.snapshot_marker(DAY) + '\n数据'},
                    {'id': 2, 'user': {'login': daily.BOT}, 'body': '<!-- daily-personal-clues:2026-11-10 -->\n<!-- daily-clues-status:completed -->'}]
        with tempfile.TemporaryDirectory() as folder, patch.object(daily, 'ROOT', Path(folder)), patch.dict(os.environ, {
                'GITHUB_REPOSITORY': REPO, 'PERSONAL_MODE': 'create', 'PERSONAL_DATE': str(DAY),
                'GITHUB_OUTPUT': folder + '/outputs', 'GITHUB_STEP_SUMMARY': folder + '/summary'}), patch.object(
                daily, 'find_issue', return_value=issue()), patch.object(daily, 'pages', return_value=comments), patch.object(
                daily, 'timing', return_value={}), patch.object(daily, 'collect') as collect, patch.object(daily, 'publish_sections') as publish, patch('sys.argv', ['daily', 'prepare']):
            daily.main()
            collect.assert_not_called()
            self.assertEqual(len(publish.call_args.args[2]), 2)
            self.assertIn('ready=false', Path(folder + '/outputs').read_text())

    def test_collect_filters_activity_to_beijing_day_and_preserves_unknown(self):
        def list_pages(endpoint, **kwargs):
            if '/commits?' in endpoint:
                return [{'sha': 'abc', 'html_url': 'https://example.com/commit', 'author': {'login': 'owner'},
                         'commit': {'message': 'change', 'committer': {'date': '2026-11-09T16:30:00Z'}}}]
            return []
        with patch.object(daily, 'get_json', side_effect=OSError), patch.object(daily, 'api', side_effect=RuntimeError), patch.object(
                daily, 'pages', side_effect=list_pages) as pages:
            snap = daily.collect(REPO, DAY, instant('2026-11-10T23:15:00'))
        self.assertEqual(len(snap['sources']['git']['items']), 1)
        self.assertEqual(snap['sources']['health']['status'], 'unavailable')
        self.assertIn('2026-11-09T16%3A00%3A00', pages.call_args_list[0].args[0])


if __name__ == '__main__':
    unittest.main()
