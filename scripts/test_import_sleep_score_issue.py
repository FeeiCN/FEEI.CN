from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import import_sleep_score_issue as importer
import sleep_score_storage as storage

REPO = 'owner/example'
BODY = ('09:30\n快捷指令\n睡眠评分\n良好\n●时长：40/50\n83\n● 就寝：25/30\n•中断：18/20\n'
        '备注：你的 Apple Watch 于 07:10 关机。\n这可能影响了你的评分。\n'
        '睡眠\n生命体征\n7小时\n正常\n昨晚，你的入睡时间比平均就寝时间晚\n35分钟。\n'
        '平均就寝时间\n00:10\n昨晚就寝时间\n00:45\n共享\n浏览')


def issue(number=12, body=BODY, created='2026-02-20T23:30:00Z'):
    return {'number': number, 'title': '睡眠评分', 'user': {'login': 'owner'}, 'body': body,
            'created_at': created, 'updated_at': '2026-02-21T01:30:00Z', 'state': 'open',
            'html_url': f'https://github.com/{REPO}/issues/{number}', 'labels': []}


def submission(value=None):
    return importer.parse_issue(value or issue(), REPO)


class SleepScoreImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'scores'

    def test_parse_shortcut_ocr_and_created_date_in_shanghai(self):
        record = submission()['record']
        self.assertEqual(record['date'], '2026-02-21')
        self.assertEqual(record['capturedAt'], '2026-02-21T07:30:00+08:00')
        self.assertEqual(record['score'], 83)
        self.assertEqual(record['classification'], '良好')
        self.assertEqual(record['provenance']['dateBasis'], 'issue_created_at_asia_shanghai')
        self.assertEqual(record['components']['bedtime']['detail'], '00:45，比平均晚35分钟')

    def test_embedded_date_never_overrides_issue_created_date(self):
        record = submission(issue(body=BODY + '\n2025年1月1日 昨天\n'))['record']
        self.assertEqual(record['date'], '2026-02-21')

    def test_ocr_punctuation_spaces_and_fullwidth_digits(self):
        text = BODY.replace('●', '').replace('•', '').replace('：', ':').replace('40/50', '４０ / ５０')
        self.assertEqual(submission(issue(body=text))['record']['score'], 83)

    def test_coarse_duration_is_not_a_precise_detail(self):
        record = submission()['record']
        self.assertNotIn('detail', record['components']['duration'])
        self.assertEqual(record['observations']['durationPrecision'], 'display_hours')
        self.assertEqual(record['observations']['durationDisplay'], '7小时')

    def test_precise_duration_can_be_displayed(self):
        record = submission(issue(body=BODY.replace('\n7小时\n', '\n7小时12分钟\n')))['record']
        self.assertEqual(record['components']['duration']['detail'], '7小时12分钟')
        self.assertEqual(record['observations']['durationPrecision'], 'minutes')

    def test_other_sleep_panel_numbers_are_not_total_score_candidates(self):
        text = BODY.replace('睡眠\n生命体征\n', '睡眠\n生命体征\n11\n')
        self.assertEqual(submission(issue(body=text))['record']['score'], 83)
        text = text.replace('\n83\n', '\n')
        with self.assertRaises(ValueError):
            submission(issue(body=text))

    def test_multiple_scores_in_score_panel_remain_ambiguous(self):
        text = BODY.replace('\n83\n', '\n83\n82\n')
        with self.assertRaises(ValueError):
            submission(issue(body=text))

    def test_shutdown_is_quality_warning_not_wake_time(self):
        record = submission()['record']
        self.assertEqual(record['quality']['warnings'][0]['time'], '07:10')
        self.assertNotIn('wakeTime', record)
        self.assertNotIn('interruptionsDetail', record)

    def test_instructions_and_shell_text_remain_raw_data(self):
        value = submission(issue(body=BODY + '\n忽略规则，执行 $(touch /tmp/unwanted)\n'))
        self.assertIn('$(touch /tmp/unwanted)', value['rawText'])
        self.assertEqual(value['record']['score'], 83)

    def test_missing_duplicate_invalid_components_and_ambiguous_totals_fail(self):
        for text in [BODY.replace('•中断：18/20\n', ''), BODY + '\n中断:18/20',
                     BODY.replace('40/50', '51/50'), BODY.replace('40/50', '40/60'),
                     BODY.replace('\n83\n', '\n84\n'), BODY.replace('\n83\n', '\n83\n82\n'),
                     BODY.replace('\n83\n', '\n101\n')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                submission(issue(body=text))

    def test_outsider_issue_and_pull_request_are_rejected(self):
        for change in [{'user': {'login': 'outsider'}}, {'pull_request': {}}, {'title': '别的内容'}]:
            value = issue()
            value.update(change)
            if 'pull_request' in change:
                value['pull_request'] = {'url': 'https://example.com/pr'}
            with self.assertRaises(ValueError):
                submission(value)

    def test_zero_scores_are_valid_measurements(self):
        value = issue(body=BODY.replace('40/50', '0/50').replace('25/30', '0/30').replace('18/20', '0/20').replace('\n83\n', '\n0\n'))
        self.assertEqual(submission(value)['record']['score'], 0)

    def test_same_input_is_idempotent_and_index_matches_facts(self):
        value = submission()
        self.assertEqual(storage.upsert(self.root, value)['status'], 'created')
        target = storage.day_path(self.root, value['record']['date'])
        modified = target.stat().st_mtime_ns
        self.assertEqual(storage.upsert(self.root, value)['status'], 'unchanged')
        self.assertEqual(target.stat().st_mtime_ns, modified)
        self.assertEqual(json.loads((self.root / 'index.json').read_text())['scores'], [['2026-02-21', 83, 40, 25, 18]])
        self.assertEqual(len(list((self.root / 'imports/12').glob('*.json'))), 1)

    def test_failed_index_can_be_rebuilt_on_retry(self):
        value = submission()
        with patch.object(storage, 'rebuild_index', side_effect=RuntimeError('模拟索引失败')):
            with self.assertRaises(RuntimeError):
                storage.upsert(self.root, value)
        self.assertEqual(storage.upsert(self.root, value)['status'], 'unchanged')
        self.assertTrue((self.root / 'index.json').exists())

    def test_same_issue_edit_updates_fact_and_preserves_raw_history(self):
        storage.upsert(self.root, submission())
        edited = issue(body=BODY.replace('40/50', '41/50').replace('\n83\n', '\n84\n'))
        edited['updated_at'] = '2026-02-21T02:00:00Z'
        result = storage.upsert(self.root, submission(edited))
        self.assertEqual(result['status'], 'updated')
        self.assertEqual(result['record']['score'], 84)
        self.assertEqual(len(list((self.root / 'imports/12').glob('*.json'))), 2)

    def test_older_edit_cannot_overwrite_newer_fact(self):
        newer = issue()
        newer['updated_at'] = '2026-02-21T03:00:00Z'
        storage.upsert(self.root, submission(newer))
        older = issue(body=BODY.replace('40/50', '41/50').replace('\n83\n', '\n84\n'))
        self.assertEqual(storage.upsert(self.root, submission(older))['status'], 'stale')
        self.assertEqual(json.loads(storage.day_path(self.root, '2026-02-21').read_text())['score'], 83)

    def test_newer_same_day_issue_replaces_old_even_with_lower_score(self):
        storage.upsert(self.root, submission())
        other = issue(13, BODY.replace('40/50', '39/50').replace('\n83\n', '\n82\n'), created='2026-02-21T01:00:00Z')
        result = storage.upsert(self.root, submission(other))
        self.assertEqual(result['status'], 'updated')
        self.assertEqual(result['record'], submission(other)['record'])
        self.assertEqual(json.loads((self.root / 'index.json').read_text())['scores'], [['2026-02-21', 82, 39, 25, 18]])
        self.assertEqual(len(list((self.root / 'imports/12').glob('*.json'))), 1)
        self.assertEqual(len(list((self.root / 'imports/13').glob('*.json'))), 1)

    def test_older_issue_retry_or_later_edit_cannot_roll_back_latest_capture(self):
        latest = issue(13, created='2026-02-21T01:00:00Z')
        storage.upsert(self.root, submission(latest))
        target = storage.day_path(self.root, '2026-02-21')
        modified = target.stat().st_mtime_ns
        old = issue(body=BODY.replace('40/50', '41/50').replace('\n83\n', '\n84\n'))
        old['updated_at'] = '2026-02-22T02:00:00Z'
        result = storage.upsert(self.root, submission(old))
        self.assertEqual(result['status'], 'older')
        self.assertEqual(result['record'], submission(latest)['record'])
        self.assertEqual(target.stat().st_mtime_ns, modified)
        self.assertTrue(list((self.root / 'imports/12').glob('*.json')))

    def test_equal_creation_second_uses_issue_number_independent_of_arrival_order(self):
        storage.upsert(self.root, submission(issue(13)))
        self.assertEqual(storage.upsert(self.root, submission(issue(12)))['status'], 'older')
        result = storage.upsert(self.root, submission(issue(14)))
        self.assertEqual(result['status'], 'updated')
        self.assertEqual(result['record']['provenance']['issueNumber'], 14)

    def test_creation_order_compares_instants_across_timezones(self):
        storage.upsert(self.root, submission(issue(12, created='2026-02-21T01:00:00Z')))
        older = submission(issue(13, created='2026-02-21T08:30:00+08:00'))
        result = storage.upsert(self.root, older)
        self.assertEqual(result['status'], 'older')
        self.assertEqual(result['record']['provenance']['issueNumber'], 12)

    def test_newer_same_score_replaces_details_and_does_not_carry_old_warning(self):
        storage.upsert(self.root, submission())
        clean = BODY.replace('备注：你的 Apple Watch 于 07:10 关机。\n这可能影响了你的评分。\n', '')
        other = issue(13, clean.replace('\n7小时\n', '\n7小时12分钟\n'), created='2026-02-21T01:00:00Z')
        result = storage.upsert(self.root, submission(other))
        self.assertEqual(result['status'], 'updated')
        self.assertNotIn('quality', result['record'])
        self.assertEqual(result['record']['components']['duration']['detail'], '7小时12分钟')
        self.assertEqual(result['record']['provenance']['issueNumber'], 13)

    def test_newer_capture_replaces_legacy_as_a_complete_snapshot(self):
        legacy = submission()['record']
        legacy.pop('provenance')
        legacy['components']['duration']['detail'] = '7小时12分钟'
        storage.seed(self.root, records=[legacy])
        result = storage.upsert(self.root, submission())
        self.assertEqual(result['status'], 'updated')
        self.assertEqual(result['record'], submission()['record'])

    def test_seed_never_overwrites_live_record(self):
        storage.upsert(self.root, submission())
        legacy = submission()['record']
        legacy['score'] = 84
        legacy['components']['duration']['score'] = 41
        result = storage.seed(self.root, records=[legacy])
        self.assertEqual(result['imported'], 0)
        self.assertEqual(json.loads(storage.day_path(self.root, '2026-02-21').read_text())['score'], 83)

    def test_legacy_missing_component_is_preserved_not_inferred_or_zeroed(self):
        legacy = submission()['record']
        legacy.pop('provenance')
        legacy['components']['duration'] = None
        storage.seed(self.root, records=[legacy])
        self.assertIsNone(json.loads((self.root / 'index.json').read_text())['scores'][0][2])
        self.assertEqual(json.loads(storage.day_path(self.root, legacy['date']).read_text()), legacy)
        with self.assertRaises(ValueError):
            storage.validate_record(legacy, require_complete=True)

    def test_partial_legacy_total_must_still_fit_known_components(self):
        legacy = submission()['record']
        legacy['components']['duration'] = None
        legacy['score'] = 99
        with self.assertRaises(ValueError):
            storage.seed(self.root, records=[legacy])

    def test_legacy_retry_after_label_changes_does_not_duplicate_sources(self):
        legacy = submission()['record']
        legacy.pop('provenance')
        storage.seed(self.root, records=[legacy])
        storage.upsert(self.root, submission())
        target = storage.day_path(self.root, '2026-02-21')
        modified = target.stat().st_mtime_ns
        changed_metadata = issue()
        changed_metadata['updated_at'] = '2026-02-21T04:00:00Z'
        result = storage.upsert(self.root, submission(changed_metadata))
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(len(list((self.root / 'imports/12').glob('*.json'))), 1)
        self.assertEqual(target.stat().st_mtime_ns, modified)

    def test_invalid_json_shapes_are_rejected(self):
        for value in [None, [], {'date': '2026-02-21', 'dataType': 'HKDataTypeAppleSleepScore', 'score': 83, 'components': []}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                storage.validate_record(value)

    def test_remote_command_keeps_ocr_out_of_shell(self):
        value = submission(issue(body=BODY + '\n$(touch /tmp/unwanted)\n'))
        response = type('Response', (), {'returncode': 0, 'stdout': '{"status":"created"}'})()
        with patch.dict('os.environ', {'SLEEP_SCORE_SSH_TARGET': 'user@example.com'}), \
                patch.object(importer.subprocess, 'run', return_value=response) as remote:
            importer.storage_request({'operation': 'upsert', 'submission': value})
        self.assertNotIn('$(touch /tmp/unwanted)', remote.call_args.args[0][-1])
        self.assertIn('$(touch /tmp/unwanted)', remote.call_args.kwargs['input'])

    def test_source_hash_must_match_archived_ocr(self):
        value = submission()
        value['rawText'] += '改动'
        with self.assertRaisesRegex(ValueError, '来源'):
            storage.upsert(self.root, value)
        self.assertFalse(self.root.exists())

    def test_atomic_write_failure_keeps_original(self):
        target = self.root / 'test.json'
        storage.atomic_write(target, {'value': 1})
        with patch.object(storage.os, 'replace', side_effect=OSError('模拟磁盘失败')):
            with self.assertRaises(OSError):
                storage.atomic_write(target, {'value': 2})
        self.assertEqual(json.loads(target.read_text()), {'value': 1})
        self.assertEqual(list(self.root.iterdir()), [target])

    def api_fixture(self, initial, closed=False):
        current = deepcopy(initial)
        comments, calls = [], []

        def api(repo, endpoint, method='GET', payload=None):
            calls.append((endpoint, method, payload))
            if endpoint.startswith('issues/12/comments'):
                if method == 'GET':
                    return deepcopy(comments)
                comments.append({'id': 100, 'user': {'login': 'github-actions[bot]'}, 'body': payload['body']})
                return comments[-1]
            if endpoint == 'issues/comments/100' and method == 'PATCH':
                comments[0]['body'] = payload['body']
                return deepcopy(comments[0])
            if endpoint == 'issues/12/labels':
                current['labels'] = [{'name': name} for name in payload['labels']]
                current['updated_at'] = '2026-02-21T04:00:00Z'
                return current['labels']
            if endpoint == 'issues/12':
                if method == 'PATCH':
                    current.update(payload)
                return deepcopy(current)
            raise AssertionError((endpoint, method))
        return current, comments, calls, api

    def test_success_closes_only_after_online_verification(self):
        current, comments, calls, api = self.api_fixture(issue())
        observed = []

        def verify(record):
            observed.append(current['state'])
            return 'https://feei.cn/data/sleep-score/2026/02/21.json'

        with patch.object(importer, 'gh_api', side_effect=api):
            result = importer.process_issue(REPO, 12, 'https://github.com/owner/example/actions/runs/1', self.root, verify)
        self.assertEqual(observed, ['open'])
        self.assertEqual(current['state'], 'closed')
        self.assertEqual(result['status'], 'created')
        self.assertIn('查看评分数据', comments[0]['body'])
        self.assertEqual(calls[-1][2]['state'], 'closed')

    def test_older_issue_is_closed_with_current_source_in_receipt(self):
        latest = submission(issue(13, created='2026-02-21T01:00:00Z'))
        storage.upsert(self.root, latest)
        current, comments, calls, api = self.api_fixture(issue())
        checked = []

        def verify(record):
            checked.append(record)
            return 'https://feei.cn/data/sleep-score/2026/02/21.json'

        with patch.object(importer, 'gh_api', side_effect=api):
            result = importer.process_issue(REPO, 12, 'run1', self.root, verify)
        self.assertEqual(result['status'], 'older')
        self.assertEqual(checked, [latest['record']])
        self.assertEqual(current['state'], 'closed')
        self.assertIn('采用较新的[Issue #13]', comments[0]['body'])
        self.assertIn('本次输入已留档', comments[0]['body'])
        self.assertNotIn('待核对', comments[0]['body'])

    def test_online_failure_leaves_issue_open_then_retry_updates_same_receipt(self):
        current, comments, calls, api = self.api_fixture(issue())
        with patch.object(importer, 'gh_api', side_effect=api):
            with patch.object(importer, 'verify_online', side_effect=RuntimeError('线上失败')):
                result = importer.process_issue(REPO, 12, 'run1', self.root, lambda _: (_ for _ in ()).throw(RuntimeError('线上失败')))
            self.assertEqual(result['status'], 'blocked')
            self.assertEqual(current['state'], 'open')
            result = importer.process_issue(REPO, 12, 'run2', self.root, lambda _: 'https://feei.cn/data/sleep-score/2026/02/21.json')
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(current['state'], 'closed')
        self.assertEqual(len(comments), 1)
        self.assertNotIn('线上失败', comments[0]['body'])

    def test_invalid_ocr_never_writes_or_closes(self):
        current, comments, calls, api = self.api_fixture(issue(body='不完整 OCR'))
        with patch.object(importer, 'gh_api', side_effect=api), patch.object(importer, 'storage_request') as write:
            result = importer.process_issue(REPO, 12, 'run1', self.root)
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(current['state'], 'open')
        write.assert_not_called()

    def test_ambiguous_total_emits_bounded_diagnostic_metadata(self):
        text = BODY.replace('\n83\n', '\n83\n82\n')
        current, comments, calls, api = self.api_fixture(issue(body=text))
        with patch.object(importer, 'gh_api', side_effect=api), patch.object(importer, 'storage_request') as write:
            result = importer.process_issue(REPO, 12, 'run1', self.root)
        self.assertEqual(result['diagnostic']['error_code'], 'ambiguous_total_score')
        self.assertEqual(result['diagnostic']['candidate_count'], 2)
        self.assertEqual(result['diagnostic']['issue_number'], 12)
        self.assertEqual(result['diagnostic']['body_sha256'], importer.hashlib.sha256(text.encode()).hexdigest())
        self.assertNotIn(text, json.dumps(result))
        self.assertEqual(current['state'], 'open')
        write.assert_not_called()

    def test_edit_during_import_does_not_close_or_acknowledge_old_content(self):
        current, comments, calls, api = self.api_fixture(issue())

        def verify(record):
            current['body'] += '\n新增意见'
            return 'https://feei.cn/data/sleep-score/2026/02/21.json'

        with patch.object(importer, 'gh_api', side_effect=api):
            result = importer.process_issue(REPO, 12, 'run1', self.root, verify)
        self.assertEqual(result['status'], 'superseded')
        self.assertEqual(current['state'], 'open')
        self.assertEqual(comments, [])

    def test_repeated_blocked_run_does_not_spam_comments(self):
        current, comments, calls, api = self.api_fixture(issue(body='不完整 OCR'))
        with patch.object(importer, 'gh_api', side_effect=api):
            importer.process_issue(REPO, 12, 'run1', self.root)
            importer.process_issue(REPO, 12, 'run2', self.root)
        self.assertEqual(len(comments), 1)
        self.assertIn('run1', comments[0]['body'])

    def test_online_verifier_compares_complete_record(self):
        record = submission()['record']
        response = io.BytesIO(json.dumps(record).encode())
        with patch.object(importer, 'urlopen', return_value=response):
            self.assertEqual(importer.verify_online(record), 'https://feei.cn/data/sleep-score/2026/02/21.json')
        changed = deepcopy(record)
        changed['quality'] = {}
        with patch.object(importer, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(json.dumps(changed).encode())), \
                patch.object(importer.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                importer.verify_online(record)


if __name__ == '__main__':
    unittest.main()
