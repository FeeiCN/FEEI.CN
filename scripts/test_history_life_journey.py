from copy import deepcopy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

import history_life_journey as journey

REPO, OWNER = 'FeeiCN/FEEI.CN', 'FeeiCN'


def run(identifier):
    return {'path': journey.WORKFLOW, 'head_branch': 'main', 'event': 'workflow_dispatch',
            'actor': {'login': OWNER}, 'head_repository': {'full_name': REPO}}


def comment(identifier, body, author=OWNER):
    return {'id': identifier, 'body': body, 'user': {'login': author},
            'updated_at': f'2026-11-07T01:{identifier % 60:02}:00Z',
            'html_url': f'https://github.com/{REPO}/issues/900#issuecomment-{identifier}'}


def fixture(carry=True):
    config = {'version': 1, 'person': '朱元璋', 'origin_run_id': 1,
              'session_id': journey.digest([REPO.lower(), '朱元璋', 1]),
              'bootstrap': journey.BOOTSTRAP if carry else None}
    return {'number': 900, 'state': 'open', 'title': '跟随朱元璋：一生中的重要选择',
            'user': {'login': journey.BOT}, 'labels': [{'name': journey.LABEL}], 'comments': [],
            'body': journey.pack(journey.SESSION, config) + '\n正文\n' + journey.INDEX_START + '\n准备中\n' + journey.INDEX_END}


def context(issue):
    return journey.prepare_context(issue, REPO, OWNER, run)


def result(action='start', chapter=1, phase='discussing'):
    return {'action': action, 'chapter': chapter, 'scene_title': '避乱还是投军', 'historical_time': '1352 年春',
            'phase': phase, 'reply_markdown': '你选择离开当地避乱。这个方向能否改善处境，需要考虑落脚和谋生。',
            'revealed_summary': '本人知道后来投军，尚未讨论更晚历史。',
            'discussion_summary': '避乱的理由尚未知。', 'open_question': '', 'decisions': [],
            'sources': [{'url': 'https://zh.wikisource.org/wiki/明史/卷1',
                         'title': '明史·太祖本纪', 'evidence': '早期游食与入濠经历。'}]}


def deliver(issue, value=None):
    value = value or result()
    prepared = context(issue)
    journey.validate_result(value, prepared, issue, OWNER)
    body = journey.render_turn(value, prepared, 10 + len(issue['comments']))
    reply = comment(1000 + len(issue['comments']), body, journey.BOT)
    issue['comments'].append(reply)
    return reply


class HistoryJourneyTests(unittest.TestCase):
    def test_bootstrap_preserves_choice_without_inventing_reason(self):
        issue = fixture()
        value = result()
        value['decisions'] = [{'choice_comment_id': 0, 'choice_quote': journey.BOOTSTRAP['choice'],
                               'reason_comment_id': 0, 'reason_quote': ''}]
        deliver(issue, value)
        recovered = context(issue)
        self.assertEqual(recovered['decisions'][0]['reason_quote'], '')
        self.assertTrue(recovered['skip'])

    def test_unmigrated_person_cannot_invent_a_bootstrap_choice(self):
        issue = fixture(False)
        value = result()
        value['decisions'] = [{'choice_comment_id': 0, 'choice_quote': journey.BOOTSTRAP['choice'],
                               'reason_comment_id': 0, 'reason_quote': ''}]
        with self.assertRaisesRegex(ValueError, '本人原话'):
            journey.validate_result(value, context(issue), issue, OWNER)

    def test_background_stays_in_current_scene(self):
        issue = fixture()
        deliver(issue)
        issue['comments'].append(comment(1, '当时的背景还不够'))
        value = result('background', 2)
        with self.assertRaisesRegex(ValueError, '不能自动推进'):
            journey.validate_result(value, context(issue), issue, OWNER)

    def test_choice_is_recorded_exactly(self):
        issue = fixture()
        deliver(issue)
        issue['comments'].append(comment(1, '我会离开这一带避乱'))
        value = result('choose', phase='ready_to_continue')
        value['decisions'] = [{'choice_comment_id': 1, 'choice_quote': '离开这一带避乱',
                               'reason_comment_id': 0, 'reason_quote': ''}]
        deliver(issue, value)
        self.assertEqual(context(issue)['decisions'][0]['choice_quote'], '离开这一带避乱')

    def test_hallucinated_choice_or_reason_is_rejected(self):
        issue = fixture()
        issue['comments'].append(comment(1, '我选择避乱'))
        value = result('choose')
        value['decisions'] = [{'choice_comment_id': 1, 'choice_quote': '我选择投军',
                               'reason_comment_id': 0, 'reason_quote': '我胆小'}]
        with self.assertRaises(ValueError):
            journey.validate_result(value, context(issue), issue, OWNER)

    def test_reason_can_be_added_in_a_later_comment(self):
        issue = fixture()
        issue['comments'].append(comment(1, '我选择避乱'))
        value = result('choose')
        value['decisions'] = [{'choice_comment_id': 1, 'choice_quote': '我选择避乱',
                               'reason_comment_id': 0, 'reason_quote': ''}]
        deliver(issue, value)
        issue['comments'].append(comment(2, '因为我更希望安稳生活'))
        updated = result('reflect')
        updated['decisions'] = [{**value['decisions'][0], 'reason_comment_id': 2, 'reason_quote': '更希望安稳生活'}]
        deliver(issue, updated)
        records = context(issue)['decisions']
        self.assertEqual(records[-1]['reason_quote'], '更希望安稳生活')
        self.assertFalse(records[-1]['superseded'])

    def test_old_records_are_not_copied_as_new_choices(self):
        issue = fixture()
        issue['comments'].append(comment(1, '我选择避乱'))
        value = result('choose')
        value['decisions'] = [{'choice_comment_id': 1, 'choice_quote': '我选择避乱',
                               'reason_comment_id': 0, 'reason_quote': ''}]
        deliver(issue, value)
        issue['comments'].append(comment(2, '当时还有谁起兵了'))
        value['action'] = 'background'
        with self.assertRaisesRegex(ValueError, '本轮新增'):
            journey.validate_result(value, context(issue), issue, OWNER)

    def test_continue_advances_only_one_scene(self):
        issue = fixture()
        deliver(issue)
        issue['comments'].append(comment(1, '继续下一段'))
        value = result('continue', 2, 'awaiting_choice')
        deliver(issue, value)
        self.assertEqual(context(issue)['previous']['chapter'], 2)
        value['chapter'] = 4
        with self.assertRaisesRegex(ValueError, '至多推进一幕'):
            journey.validate_result(value, context(issue), issue, OWNER)

    def test_pause_and_resume_preserve_position(self):
        issue = fixture()
        deliver(issue)
        issue['comments'].append(comment(1, '先停一下'))
        deliver(issue, result('pause', phase='paused'))
        issue['comments'].append(comment(2, '继续'))
        with self.assertRaisesRegex(ValueError, '恢复时'):
            journey.validate_result(result('continue', 2), context(issue), issue, OWNER)
        deliver(issue, result('resume', phase='discussing'))
        self.assertEqual(context(issue)['previous']['chapter'], 1)

    def test_revisit_does_not_rewind_chapter(self):
        issue = fixture()
        deliver(issue)
        issue['comments'].append(comment(1, '下一段'))
        deliver(issue, result('continue', 2))
        issue['comments'].append(comment(2, '回顾第一幕'))
        with self.assertRaises(ValueError):
            journey.validate_result(result('revisit', 1), context(issue), issue, OWNER)

    def test_multiple_pending_comments_are_all_retained(self):
        issue = fixture()
        deliver(issue)
        issue['comments'] += [comment(1, '我想离开'), comment(2, '补充一下，我更看重谋生')]
        self.assertEqual([c['id'] for c in context(issue)['pending_comments']], [1, 2])

    def test_outsider_and_bot_replies_are_not_owner_choices(self):
        issue = fixture()
        deliver(issue)
        issue['comments'] += [comment(1, '下一幕', 'outsider'), comment(2, '投军', journey.BOT)]
        self.assertTrue(context(issue)['skip'])

    def test_edited_comment_invalidates_earlier_choice(self):
        issue = fixture()
        original = comment(1, '我选择避乱')
        issue['comments'].append(original)
        value = result('choose')
        value['decisions'] = [{'choice_comment_id': 1, 'choice_quote': '我选择避乱',
                               'reason_comment_id': 0, 'reason_quote': ''}]
        deliver(issue, value)
        original['body'] = '我改为投军'
        recovered = context(issue)
        self.assertEqual(recovered['edited_or_deleted'], ['1'])
        self.assertTrue(recovered['decisions'][0]['superseded'])
        self.assertFalse(recovered['skip'])

    def test_deleted_comment_is_an_unprocessed_correction(self):
        issue = fixture()
        issue['comments'].append(comment(1, '我选择避乱'))
        deliver(issue)
        issue['comments'] = issue['comments'][1:]
        recovered = context(issue)
        self.assertEqual(recovered['processed'], {'1': None})
        deliver(issue, result('correct'))
        self.assertTrue(context(issue)['skip'])

    def test_index_updates_do_not_invalidate_request_snapshot(self):
        issue = fixture()
        deliver(issue)
        original = journey.snapshot(issue, OWNER)
        turns, _ = journey.checkpoints(issue, context(issue)['config'], REPO, run)
        issue['body'] = journey.index_body(issue['body'], turns)
        self.assertEqual(original, journey.snapshot(issue, OWNER))
        self.assertIn('第 1 幕', issue['body'])

    def test_tampered_or_missing_checkpoint_stops_recovery(self):
        issue = fixture()
        reply = deliver(issue)
        reply['body'] += '改动正文'
        with self.assertRaisesRegex(ValueError, '记录链'):
            context(issue)

    def test_forged_run_or_author_is_rejected(self):
        issue = fixture()
        with self.assertRaises(ValueError):
            journey.prepare_context(issue, REPO, OWNER, lambda _: {**run(1), 'head_branch': 'other'})
        issue['user']['login'] = OWNER
        with self.assertRaisesRegex(ValueError, '专用 workflow'):
            context(issue)

    def test_first_scene_cannot_start_at_later_chapter(self):
        issue = fixture()
        with self.assertRaises(ValueError):
            journey.validate_result(result(chapter=2), context(issue), issue, OWNER)

    def test_missing_sources_and_oversized_reply_fail_before_publication(self):
        issue = fixture()
        value = result()
        value['sources'] = []
        with self.assertRaisesRegex(ValueError, '来源'):
            journey.validate_result(value, context(issue), issue, OWNER)
        value = result()
        value['reply_markdown'] = '文' * 21_000
        with self.assertRaisesRegex(ValueError, '未截断'):
            journey.render_turn(value, context(issue), 10)

    def test_closed_issue_does_not_advance(self):
        issue = fixture()
        issue['state'] = 'closed'
        self.assertTrue(context(issue)['skip'])

    def test_comments_are_read_beyond_first_page(self):
        issue = fixture()
        page1 = [comment(i, f'评论 {i}') for i in range(1, 101)]
        page2 = [comment(101, '第二页的选择')]
        with patch.object(journey, 'api', side_effect=[issue, page1, page2]) as call:
            actual = journey.read_issue(REPO, 900)
        self.assertEqual(len(actual['comments']), 101)
        self.assertEqual(actual['comments'][-1]['body'], '第二页的选择')
        self.assertIn('page=2', call.call_args_list[-1].args[1])

    def test_publish_retry_repairs_index_without_duplicate_reply(self):
        issue = fixture()
        prepared = context(issue)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / 'prepared.json').write_text(json.dumps(prepared))
            (out / 'result.json').write_text(json.dumps(result()))

            def fake_api(repo, path, method='GET', data=None):
                if path.endswith('/comments') and method == 'POST':
                    issue['comments'].append(comment(1000, data['body'], journey.BOT))

            with patch.object(journey, 'read_issue', side_effect=lambda *_: deepcopy(issue)), \
                    patch.object(journey, 'api', side_effect=fake_api) as calls, \
                    patch.object(journey, 'sync_index', side_effect=RuntimeError('模拟索引失败')):
                with self.assertRaises(RuntimeError):
                    journey.publish(REPO, OWNER, out, 10, run)
                self.assertEqual(sum(c.args[2:3] == ('POST',) for c in calls.call_args_list), 1)
            with patch.object(journey, 'read_issue', return_value=issue), \
                    patch.object(journey, 'sync_index') as repair, patch.object(journey, 'api') as calls:
                self.assertEqual(journey.publish(REPO, OWNER, out, 10, run), 'already_delivered')
                repair.assert_called_once()
                calls.assert_not_called()

    def test_new_reply_suppresses_stale_generated_result(self):
        issue = fixture()
        prepared = context(issue)
        issue['comments'].append(comment(1, '补充：先说清背景'))
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / 'prepared.json').write_text(json.dumps(prepared))
            with patch.object(journey, 'read_issue', return_value=issue), patch.object(journey, 'api') as calls:
                self.assertEqual(journey.publish(REPO, OWNER, out, 10, run), 'superseded')
                calls.assert_not_called()

    def test_failure_does_not_consume_request_and_deduplicates_notice(self):
        issue = fixture()
        prepared = context(issue)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / 'prepared.json').write_text(json.dumps(prepared))

            def fake_api(repo, path, method='GET', data=None):
                if path.endswith('/comments') and method == 'POST':
                    issue['comments'].append(comment(1000, data['body'], journey.BOT))

            with patch.object(journey, 'read_issue', side_effect=lambda *_: deepcopy(issue)), \
                    patch.object(journey, 'api', side_effect=fake_api) as calls:
                journey.fail(REPO, OWNER, out, 10, run)
                journey.fail(REPO, OWNER, out, 11, run)
                self.assertEqual(sum(c.args[2:3] == ('POST',) for c in calls.call_args_list), 1)
            self.assertFalse(context(issue)['skip'])
            self.assertEqual(context(issue)['parent'], 0)

    def test_prepare_provides_complete_archive_and_first_scene_prompt(self):
        issue = fixture()
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            with patch.object(journey, 'read_issue', return_value=issue):
                prepared = journey.prepare(REPO, OWNER, 900, '朱元璋', 10, True, run, out)
            self.assertFalse(prepared['skip'])
            self.assertEqual(json.loads((out / 'archive.json').read_text())['comments'], [])
            self.assertIn(journey.BOOTSTRAP['choice'], (out / 'prompt.md').read_text())

    def test_executor_accepts_unknown_reason_and_empty_question(self):
        issue = fixture()
        prepared = context(issue)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            for name, value in [('prepared.json', prepared), ('archive.json', issue)]:
                (out / name).write_text(json.dumps(value))
            (out / 'prompt.md').write_text('只读执行，理由未知。')
            env = {'OPENAI_BASE_URL': 'https://example.com/v1', 'OPENAI_MODEL': 'configured-model',
                   'AUTOMATION_PERMISSION_CONFIG': '{extends=":read-only"}', 'RUNNER_TEMP': folder}

            def model(command, **kwargs):
                self.assertIn('--ignore-user-config', command)
                self.assertIn('approval_policy="never"', command)
                (out / 'model-result.json').write_text(json.dumps(result()))
                return type('Completed', (), {'returncode': 0})()

            with patch.dict(os.environ, env), patch.object(journey.subprocess, 'run', side_effect=model):
                journey.execute(out)
            self.assertEqual(json.loads((out / 'result.json').read_text())['open_question'], '')

    def test_existing_person_reuses_original_issue(self):
        issue = fixture()
        with patch.object(journey, 'labels'), patch.object(journey, 'api', return_value=[issue]) as calls:
            self.assertEqual(journey.create_or_find(REPO, '朱元璋', 30, True, run), 900)
        self.assertEqual(len(calls.call_args_list), 1)

    def test_closed_person_journey_requires_reopening(self):
        issue = fixture()
        issue['state'] = 'closed'
        with patch.object(journey, 'labels'), patch.object(journey, 'api', return_value=[issue]):
            with self.assertRaisesRegex(ValueError, '重新打开'):
                journey.create_or_find(REPO, '朱元璋', 30, True, run)

    def test_processing_receipt_acknowledges_all_pending_comments(self):
        issue = fixture()
        issue['comments'] = [comment(1, '先补背景'), comment(2, '尤其是各方实力')]
        issue['labels'].append({'name': '保留我的标签'})
        prepared = context(issue)
        with patch.object(journey, 'api', return_value=[]) as calls:
            journey.processing_receipt(REPO, issue, prepared, True)
        posts = [(c.args[1], c.args[3]) for c in calls.call_args_list if c.args[2:3] == ('POST',)]
        self.assertIn(('issues/comments/1/reactions', {'content': 'eyes'}), posts)
        self.assertIn(('issues/comments/2/reactions', {'content': 'eyes'}), posts)
        label_put = [c.args[3]['labels'] for c in calls.call_args_list if c.args[2:3] == ('PUT',)][0]
        self.assertIn('保留我的标签', label_put)
        self.assertIn('旅程:处理中', label_put)
        self.assertEqual(issue['comments'][0]['body'], '先补背景')

    def test_receipt_cleanup_preserves_human_reactions(self):
        issue = fixture()
        issue['comments'] = [comment(1, '继续')]
        reactions = [{'id': 10, 'content': 'eyes', 'user': {'login': OWNER}},
                     {'id': 11, 'content': '+1', 'user': {'login': journey.BOT}},
                     {'id': 12, 'content': 'eyes', 'user': {'login': journey.BOT}}]
        with patch.object(journey, 'api', return_value=reactions) as calls:
            journey.processing_receipt(REPO, issue, context(issue), False)
        deletes = [c.args[1] for c in calls.call_args_list if c.args[2:3] == ('DELETE',)]
        self.assertEqual(deletes, ['issues/comments/1/reactions/12'])

    def test_rerun_can_clean_receipt_after_answer_was_delivered(self):
        issue = fixture()
        issue['comments'] = [comment(1, '当前各方实力怎么样')]
        deliver(issue)
        prepared = context(issue)
        self.assertTrue(prepared['skip'])
        self.assertEqual(prepared['pending_comments'], [])
        with patch.object(journey, 'api', return_value=[]) as calls:
            journey.processing_receipt(REPO, issue, prepared, False)
        self.assertEqual(calls.call_args.args[1], 'issues/comments/1/reactions?per_page=100&page=1')

    def test_receipt_api_failure_does_not_block_research(self):
        issue = fixture()
        issue['comments'] = [comment(1, '各方实力怎么样')]
        prepared = context(issue)
        with patch.object(journey, 'api', side_effect=RuntimeError('临时不可用')), redirect_stdout(io.StringIO()):
            journey.processing_receipt(REPO, issue, prepared, True)
        self.assertFalse(prepared['skip'])
        self.assertEqual(prepared['pending_comments'][0]['body'], '各方实力怎么样')


if __name__ == '__main__':
    unittest.main()
