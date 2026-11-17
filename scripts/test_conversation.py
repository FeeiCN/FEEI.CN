import base64
from copy import deepcopy
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import conversation as core
import automation_tasks as automation
import issue_conversation as adapter
import scheduled_issue_review as legacy

REPO, OWNER = 'owner/repo', 'owner'
FILE = 'docs/story.md'
ORIGINAL = '---\nslug: /story\ntitle: 记录\nicon: book-icon\ndescription: 记录与判断\n---\n旧正文\n'
UPDATED = ORIGINAL.replace('旧正文', '有证据的新版正文')


def response(action='answer', **changes):
    value = {'action': action, 'message': '根据当前讨论继续处理。', 'files': [], 'draft_id': '',
             'quote': '', 'has_changes': False, 'risk': 'low', 'verification': []}
    value.update(changes)
    return value


class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / 'output/conversation'
        self.directory.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', 'config', 'user.name', 'test'], cwd=self.root, check=True)
        subprocess.run(['git', 'config', 'user.email', 'test@example.com'], cwd=self.root, check=True)
        (self.root / '.gitignore').write_text((core.ROOT / '.gitignore').read_text())
        (self.root / 'docs').mkdir()
        (self.root / FILE).write_text(ORIGINAL)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'baseline'], cwd=self.root, check=True)
        self.base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        self.issue = {'number': 940, 'author': {'login': OWNER}, 'title': '解释这个问题并帮助修改', 'body': '原始目标',
                      'state': 'OPEN', 'createdAt': '2026-11-17T00:00:00Z', 'updatedAt': '2026-11-17T00:00:00Z', 'comments': []}
        self.counter = 0
        self.calls = []
        for target, value in [('STATE', self.directory)]:
            mocked = patch.object(adapter, target, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        fetched = patch.object(adapter, 'fetch_issue', side_effect=lambda *args: deepcopy(self.issue))
        fetched.start()
        self.addCleanup(fetched.stop)
        github = patch.object(adapter, 'gh', side_effect=self.github)
        github.start()
        self.addCleanup(github.stop)

    def github(self, *args):
        if args[:2] == ('issue', 'comment'):
            self.add_message(legacy.BOT, Path(args[-1]).read_text())
            return 'https://github.com/owner/repo/issues/940#comment'
        if args[:2] == ('issue', 'close'):
            self.issue['state'] = 'CLOSED'
            return ''
        raise AssertionError('未隔离的 GitHub 操作：' + repr(args))

    def add_message(self, author, body):
        self.counter += 1
        when = f'2026-11-17T00:{self.counter:02}:00Z'
        self.issue['comments'].append({'id': str(self.counter), 'author': {'login': author}, 'body': body,
                                       'createdAt': when, 'updatedAt': when})
        self.issue['updatedAt'] = when

    def context(self, event=None):
        return adapter.make_context(deepcopy(self.issue), REPO, OWNER, OWNER, event, self.root)

    def executor(self, *values, mutation=None):
        values = iter(values)
        def call(prompt, **kwargs):
            self.calls.append((prompt, kwargs))
            value = next(values)
            if isinstance(value, Exception):
                raise value
            kwargs['output'].write_text(json.dumps(value, ensure_ascii=False))
            if mutation:
                mutation()
        return call

    def turn(self, value):
        context = self.context()
        result = core.respond(context, self.directory, self.root, self.executor(value))
        adapter.decision(context, result, self.issue)
        adapter.publish_result(context, self.directory, 'success', self.root)
        return context, result

    def propose(self, content=UPDATED):
        return response('revise', files=[{'path': FILE, 'content': content}], has_changes=True,
                        verification=['核对正文与来源'])

    def approve(self, context):
        return response('approve', draft_id=context['current_draft']['id'], quote=context['request']['body'])

    def test_question_revision_correction_and_write_form_one_continuous_session(self):
        self.turn(response(message='先解释原因。'))
        self.add_message(OWNER, '补到合适的位置')
        self.turn(self.propose())
        self.add_message(OWNER, '第二段简洁一点')
        revised = UPDATED.replace('新版正文', '简洁正文')
        _, second = self.turn(self.propose(revised))
        self.add_message(OWNER, '写入')
        context = self.context()
        self.assertEqual(context['current_draft']['id'], second['draft']['id'])
        self.assertEqual(context['pending_requests'], [])
        result = core.respond(context, self.directory, self.root, self.executor(self.approve(context)))
        run = subprocess.run
        def commands(args, **kwargs):
            if args[:2] == ['git', 'push']:
                return subprocess.CompletedProcess(args, 0, '', '')
            return run(args, **kwargs)
        with patch.object(adapter, 'build') as build, patch.object(adapter.subprocess, 'run', side_effect=commands):
            receipt = adapter.execute_approved(context, result, self.root, self.directory)
        self.assertEqual(receipt['state'], 'done')
        self.assertEqual((self.root / FILE).read_text(), revised)
        self.assertEqual(build.call_count, 1)
        adapter.write_json(self.directory / 'receipt.json', receipt)
        adapter.publish_result(context, self.directory, 'success', self.root)
        self.assertIsNone(self.context())
        self.assertEqual(self.issue['state'], 'CLOSED')
        self.assertEqual(len(self.calls), 4)

    def test_followup_question_retains_draft_and_current_version_is_not_truncated(self):
        large = UPDATED + '更多证据。' * 1000
        _, result = self.turn(self.propose(large))
        self.add_message(OWNER, '这一步为什么必要？')
        self.turn(response(message='这一步控制后续影响范围。'))
        self.add_message(OWNER, '写入')
        context = self.context()
        self.assertEqual(context['current_draft']['id'], result['draft']['id'])
        self.assertEqual(context['pending_requests'], [])
        prompt = core.prompt_for(context, self.directory / 'context.json')
        selected = json.loads(prompt.split('<input_data>\n', 1)[1].split('\n</input_data>', 1)[0])
        self.assertEqual(selected['current_draft']['files'][0]['content'], large + '\n')
        self.assertIn('原始目标', prompt)

    def test_unanswered_revision_cannot_be_discarded_by_later_write(self):
        self.turn(self.propose())
        self.add_message(OWNER, '新增一个必要的限制条件')
        self.add_message(OWNER, '写入')
        context = self.context()
        self.assertEqual(len(context['pending_requests']), 1)
        with self.assertRaisesRegex(ValueError, '未处理'):
            core.validate_response(self.approve(context), context)

    def test_revision_without_new_files_supersedes_old_draft(self):
        self.turn(self.propose())
        self.add_message(OWNER, '修改方案还需要明确事实')
        self.turn(response('revise', message='需要先核对来源，尚未形成新稿。', has_changes=True))
        self.add_message(OWNER, '写入')
        context = self.context()
        self.assertIsNone(context['current_draft'])
        self.assertIsNotNone(context['previous_draft'])
        with self.assertRaises(ValueError):
            core.validate_response(response('approve', draft_id='old', quote='写入'), context)

    def test_label_and_automatic_updated_time_are_not_request_versions(self):
        context = self.context()
        self.issue.update(updatedAt='2026-11-18T03:00:00Z', labels=[{'name': 'codex:executing'}])
        self.assertEqual(adapter.check_fresh(context, self.root)[1]['input_hash'], context['input_hash'])

    def test_handled_issue_edit_does_not_reappear_as_unanswered_initial_request(self):
        self.turn(self.propose())
        self.issue['body'] = '修改后的任务目标'
        event = {'action': 'edited', 'issue': deepcopy(self.issue)}
        context = self.context(event)
        result = core.respond(context, self.directory, self.root, self.executor(self.propose()))
        adapter.publish_result(context, self.directory, 'success', self.root)
        self.add_message(OWNER, '写入')
        followup = self.context()
        self.assertEqual(followup['pending_requests'], [])
        self.assertEqual(followup['current_draft']['id'], result['draft']['id'])

    def test_real_owner_edits_and_intervening_requests_stop_old_delivery(self):
        for field in ['body', 'title', 'comment']:
            original = deepcopy(self.issue)
            context = self.context()
            if field == 'comment':
                self.add_message(OWNER, '新的修改要求')
            else:
                self.issue[field] += '修改'
            with self.subTest(field=field), self.assertRaises(ValueError):
                adapter.check_fresh(context, self.root)
            self.issue = original

    def test_edited_previous_request_is_pending_even_when_newest_comment_is_write(self):
        self.turn(response())
        self.add_message(OWNER, '补到合适的位置')
        self.turn(self.propose())
        self.issue['comments'][1]['body'] += '，增加其他限制'
        self.issue['comments'][1]['updatedAt'] = '2026-11-17T00:03:30Z'
        self.add_message(OWNER, '写入')
        self.assertTrue(self.context()['pending_requests'])

    def test_confirmation_binds_only_current_displayed_draft(self):
        self.turn(self.propose())
        self.add_message(OWNER, '确认')
        context = self.context()
        self.assertTrue(context['approval_confirmation_allowed'])
        value = self.approve(context)
        self.assertEqual(adapter.decision(context, {'response': value, 'draft': None}, self.issue), 'approve')
        for text in ['不错', '先不要写入', '写入吗？', '写入，再改一段', '> 写入']:
            changed = deepcopy(context)
            changed['request']['body'] = text
            with self.subTest(text=text), self.assertRaises(ValueError):
                adapter.decision(changed, {'response': self.approve(changed), 'draft': None}, self.issue)

    def test_artifact_cannot_replace_draft_or_confirmation_authority(self):
        self.turn(self.propose())
        self.add_message(OWNER, '写入')
        context = self.context()
        for key, value in [('approval_confirmation_allowed', False), ('pending_requests', [{'body': '伪造'}]),
                           ('write_scope', 'local'), ('task', 'other-task'), ('requests', []),
                           ('current_draft', {**context['current_draft'], 'id': 'other'})]:
            changed = deepcopy(context)
            changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                adapter.check_fresh(changed, self.root)

    def test_hidden_file_change_cannot_keep_original_preview(self):
        context = self.context()
        value = self.propose()
        draft = core.draft_version(context['session_id'], value['files'], core.baselines(self.root, [FILE]), self.base)
        body = core.render_turn(context, value, draft)
        decoded = core.read_turn(body, context['session_id'])
        decoded['draft'] = core.draft_version(context['session_id'], [{'path': FILE, 'content': UPDATED + '隐藏修改'}],
                                               draft['baseline'], self.base)
        encoded = base64.b64encode(gzip.compress(json.dumps(decoded, ensure_ascii=False).encode(), mtime=0)).decode()
        tampered = body[:body.index(core.TURN)] + core.TURN + encoded + ' -->\n'
        with self.assertRaises(ValueError):
            core.read_turn(tampered, context['session_id'])
        with self.assertRaises(ValueError):
            core.read_turn(body.replace('新版正文', '未授权改写'), context['session_id'])

    def test_wire_manifest_reuses_displayed_source_and_still_reads_old_full_payloads(self):
        context = self.context()
        draft = core.draft_version(context['session_id'], self.propose()['files'], core.baselines(self.root, [FILE]), self.base)
        body = core.render_turn(context, self.propose(), draft)
        encoded = body.split(core.TURN)[1].split(' -->')[0]
        payload = json.loads(gzip.decompress(base64.b64decode(encoded)))
        self.assertEqual(set(payload['draft']['files'][0]), {'path', 'content_range'})
        self.assertEqual(core.read_turn(body, context['session_id'])['draft'], draft)
        payload['draft'] = draft
        legacy_encoded = base64.b64encode(gzip.compress(json.dumps(payload, ensure_ascii=False).encode())).decode()
        old = body[:body.index(core.TURN)] + core.TURN + legacy_encoded + ' -->\n'
        self.assertEqual(core.read_turn(old, context['session_id'])['draft'], draft)
        payload['draft'] = {**draft, 'files': [{'path': FILE, 'content_range': [-1, 2]}]}
        invalid = base64.b64encode(gzip.compress(json.dumps(payload, ensure_ascii=False).encode())).decode()
        with self.assertRaises(ValueError):
            core.read_turn(body[:body.index(core.TURN)] + core.TURN + invalid + ' -->\n', context['session_id'])

    def test_edited_bot_turn_is_not_a_new_trusted_version(self):
        self.turn(self.propose())
        self.issue['comments'][0]['updatedAt'] = '2026-11-17T01:00:00Z'
        self.add_message(OWNER, '写入')
        with self.assertRaisesRegex(ValueError, '被编辑'):
            self.context()

    def test_unrelated_main_changes_keep_version_but_target_change_blocks_write(self):
        context = self.context()
        draft = core.draft_version(context['session_id'], self.propose()['files'], core.baselines(self.root, [FILE]), self.base)
        (self.root / 'other.txt').write_text('unrelated')
        subprocess.run(['git', 'add', 'other.txt'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'unrelated'], cwd=self.root, check=True)
        current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        same = core.draft_version(context['session_id'], self.propose()['files'], core.baselines(self.root, [FILE]), current)
        self.assertEqual(draft['id'], same['id'])
        (self.root / FILE).write_text('other author changed this file')
        with self.assertRaisesRegex(ValueError, '目标文件已被更新'):
            adapter.apply_files(context, draft, self.root)

    def test_paths_and_environment_write_scopes_are_enforced(self):
        context = self.context()
        for name in ['../outside.md', '/tmp/outside', '.git/config', '.env', 'docs/../../file', 'scripts/code.py']:
            value = self.propose()
            value['files'][0]['path'] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                core.validate_response(value, context)
        value = self.propose()
        value['files'][0]['path'] = 'scripts/code.py'
        core.validate_response(value, {**context, 'write_scope': 'local'})
        outside = self.root.parent / 'outside-for-conversation'
        (self.root / 'docs/link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            core.target_path(self.root, 'docs/link/file.md')

    def test_cross_issue_payload_and_oversized_output_are_rejected(self):
        context = self.context()
        body = core.render_turn(context, response())
        with self.assertRaises(ValueError):
            core.read_turn(body, REPO + '/issues/other')
        with self.assertRaises(ValueError):
            core.render_turn(context, response(message='很长的结果' * 20000))

    def test_one_call_handles_question_and_invalid_contract_retries_only_once(self):
        context = self.context()
        invalid = response('approve', draft_id='unknown', quote=context['request']['body'])
        core.respond(context, self.directory, self.root, self.executor(invalid, response()))
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[0][1]['profile'], 'conversation')
        self.assertIn('read-only', self.calls[0][1]['permissions'])
        self.assertTrue((self.directory / 'response-1.json').exists())
        self.assertTrue((self.directory / 'response-2.json').exists())

    def test_proposal_ids_are_owned_by_engine_and_do_not_trigger_another_model_call(self):
        context = self.context()
        value = self.propose()
        value.update(draft_id='draft-request-v1', quote=context['request']['body'])
        result = core.respond(context, self.directory, self.root, self.executor(value))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result['response']['draft_id'], '')
        self.assertEqual(result['response']['quote'], '')
        self.assertEqual(core.files_mapping(result['draft']['files']), {FILE: UPDATED})
        approved = self.approve({**context, 'current_draft': result['draft']})
        approved['draft_id'] = 'draft-request-v1'
        with self.assertRaises(ValueError):
            core.validate_response(approved, {**context, 'current_draft': result['draft']})

    def test_failed_model_turn_is_not_marked_handled_or_written(self):
        context = self.context()
        adapter.publish_result(context, self.directory, 'failure', self.root)
        self.assertIsNotNone(self.context())
        self.assertEqual((self.root / FILE).read_text(), ORIGINAL)
        self.assertIn('未完成', self.issue['comments'][-1]['body'])

    def test_failed_next_turn_cannot_reuse_previous_result(self):
        context = self.context()
        core.respond(context, self.directory, self.root, self.executor(response()))
        self.assertTrue((self.directory / 'result.json').exists())
        with self.assertRaises(RuntimeError):
            core.respond(context, self.directory, self.root, self.executor(RuntimeError('execution failed')))
        self.assertFalse((self.directory / 'result.json').exists())

    def test_format_repair_cannot_change_files_or_leave_stale_diagnostic_after_execution_failure(self):
        context = self.context()
        invalid = {**self.propose(), 'action': 'answer'}
        changed = self.propose(UPDATED + '擅自补充')
        with self.assertRaisesRegex(ValueError, '改变了文件'):
            core.respond(context, self.directory, self.root, self.executor(invalid, changed))
        with self.assertRaises(RuntimeError):
            core.respond(context, self.directory, self.root, self.executor(invalid, RuntimeError('executor failed')))
        self.assertNotIn('error', json.loads((self.directory / 'validation.json').read_text()))

    def test_apply_failure_keeps_approved_draft_retryable(self):
        self.turn(self.propose())
        self.add_message(OWNER, '写入')
        context = self.context()
        result = {'response': self.approve(context), 'draft': None}
        adapter.write_json(self.directory / 'result.json', result)
        adapter.write_json(self.directory / 'receipt.json', {'state': 'failed', 'commit': '', 'message': '构建未通过。'})
        adapter.publish_result(context, self.directory, 'success', self.root)
        self.assertIsNotNone(self.context())
        self.assertIsNotNone(self.context()['current_draft'])

    def test_continue_retries_only_the_same_approved_failed_version(self):
        self.turn(self.propose())
        self.add_message(OWNER, '写入')
        original = self.context()
        adapter.write_json(self.directory / 'result.json', {'response': self.approve(original), 'draft': None})
        adapter.write_json(self.directory / 'receipt.json', {'state': 'failed', 'commit': '', 'message': '构建未完成。'})
        adapter.publish_result(original, self.directory, 'success', self.root)
        self.add_message(OWNER, '继续')
        context = self.context()
        self.assertTrue(context['retry_allowed'])
        self.assertEqual(adapter.decision(context, {'response': self.approve(context), 'draft': None}, self.issue), 'approve')
        self.assertIn('retry_allowed', core.prompt_for(context, self.directory / 'context.json'))
        self.issue['comments'][1]['body'] = '先不要写入'
        self.assertFalse(self.context()['retry_allowed'])

    def test_failed_model_or_pending_revision_does_not_authorize_continue(self):
        self.turn(self.propose())
        self.add_message(OWNER, '继续')
        context = self.context()
        self.assertFalse(context['retry_allowed'])
        with self.assertRaises(ValueError):
            core.validate_response(self.approve(context), context)

    def test_both_adapters_share_the_same_draft_transition_rules(self):
        session = self.root / 'output/local.json'
        _, first = self.turn(self.propose())
        local = core.local_turn(session, self.issue['title'] + '\n\n原始目标', self.root, self.executor(self.propose()))
        self.assertEqual(first['draft'], local['draft'])
        self.add_message(OWNER, '暂时撤回旧稿')
        self.turn(response('revise', has_changes=True))
        core.local_turn(session, '暂时撤回旧稿', self.root, self.executor(response('revise', has_changes=True)))
        self.add_message(OWNER, '接下来怎样整理？')
        remote, local = self.context(), json.loads(session.read_text())
        self.assertIsNone(remote['current_draft'])
        self.assertEqual(remote['current_draft'], local['current_draft'])
        self.assertEqual(remote['previous_draft'], local['previous_draft'])

    def test_legacy_plan_approval_and_source_changes_use_the_new_engine(self):
        self.issue['comments'] = []
        contents = '## 完整待审稿\n### ' + FILE + '\n````markdown\n' + UPDATED + '````\n\n'
        contents += '## Plan metadata\n```json\n' + json.dumps({
            'task_type': 'implementation', 'affected_files': [FILE], 'risk': 'low', 'verification': ['核对来源']}) + '\n```'
        self.add_message(legacy.BOT, legacy.seal(self.issue, OWNER, contents, self.base))
        self.add_message(OWNER, '写入')
        context = self.context()
        self.assertEqual(adapter.decision(context, {'response': self.approve(context), 'draft': None}, self.issue), 'approve')
        self.issue['body'] += '新增修改意见'
        context = self.context()
        with self.assertRaisesRegex(ValueError, '审批失效'):
            adapter.decision(context, {'response': self.approve(context), 'draft': None}, self.issue)

    def test_local_adapter_restores_same_context_and_uses_same_file_protocol(self):
        session = self.root / 'output/local.json'
        self.executor_local_calls = []
        core.local_turn(session, '先解释问题', self.root, self.executor(response()))
        result = core.local_turn(session, '补到合适位置', self.root, self.executor(self.propose()))
        state = json.loads(session.read_text())
        self.assertEqual(len(state['requests']), 2)
        self.assertEqual(state['current_draft']['id'], result['draft']['id'])
        self.assertIn('先解释问题', self.calls[-1][0])
        confirmed = core.local_turn(session, '写入', self.root, self.executor(response('approve', draft_id=result['draft']['id'], quote='写入')))
        self.assertEqual(confirmed['response']['action'], 'approve')
        self.assertEqual((self.root / FILE).read_text(), ORIGINAL)

    def test_typed_scheduled_report_can_be_approved_without_repeating_the_draft(self):
        task = {'id': 'security-event-research', 'title': '安全事件研究'}
        files = [{'path': FILE, 'content': UPDATED + '\n来源：https://github.com/owner/repo/actions/runs/456\n'}]
        value = {'status': 'completed', 'report_markdown': '完整待审稿，尚未写入 FEEI.CN。', 'files': files,
                 'sources': ['https://example.com/a', 'https://example.com/b'], 'artifacts': [],
                 'audit': {'summary': '核对原始来源', 'data_cutoff': '2026-11-17', 'deduplication_reason': '首次交付'}}
        meta = {'delivery_repository': REPO, 'run_url': f'https://github.com/{REPO}/actions/runs/123',
                'prompt_sha256': 'a' * 64, 'commit': self.base}
        adapter.write_json(self.directory / 'result.json', value)
        adapter.write_json(self.directory / 'metadata.json', meta)
        with patch.object(automation, 'ROOT', self.root), patch.object(automation, 'destination', return_value=REPO), \
                patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_STEP_SUMMARY': ''}), \
                patch.object(automation, 'gh', return_value='https://github.com/owner/repo/issues/940') as api:
            automation.deliver(task, self.directory)
        self.assertEqual([c.args[c.args.index('--title') + 1] for c in api.call_args_list if '--title' in c.args], ['记录'])
        self.issue.update(author={'login': legacy.BOT}, body=(self.directory / 'report.md').read_text(), title='记录')
        workflow = '.github/workflows/security-event-research.yml'
        run = {'path': workflow, 'head_branch': 'main', 'head_repository': {'full_name': REPO}, 'event': 'schedule'}
        with patch.object(legacy, 'api_run', return_value=run) as source, \
                patch.object(legacy, 'registered_tasks', return_value={task['id']: workflow}):
            self.assertIsNone(self.context())
            self.add_message(OWNER, '写入')
            context = self.context()
        self.assertTrue(all(c.args[1] == '123' for c in source.call_args_list))
        self.assertEqual(core.files_mapping(context['current_draft']['files']), core.files_mapping(files))
        self.assertEqual(adapter.decision(context, {'response': self.approve(context), 'draft': None}, self.issue), 'approve')

    def test_local_withdrawal_supersedes_previous_draft(self):
        session = self.root / 'output/local.json'
        core.local_turn(session, '形成待审稿', self.root, self.executor(self.propose()))
        core.local_turn(session, '撤回，需要重新整理', self.root, self.executor(response('revise', has_changes=True)))
        self.assertIsNone(json.loads(session.read_text())['current_draft'])

    def test_local_failed_revision_remains_pending_before_approval(self):
        session = self.root / 'output/local.json'
        draft = core.local_turn(session, '形成待审稿', self.root, self.executor(self.propose()))['draft']
        with self.assertRaises(RuntimeError):
            core.local_turn(session, '补充关键限制', self.root, self.executor(RuntimeError('offline')))
        self.assertEqual(json.loads(session.read_text())['requests'][-1]['body'], '补充关键限制')
        approve = response('approve', draft_id=draft['id'], quote='写入')
        with self.assertRaisesRegex(ValueError, '未处理'):
            core.local_turn(session, '写入', self.root, self.executor(approve, approve))

    def test_owner_comment_edit_is_a_new_turn_and_old_queued_event_is_skipped(self):
        self.add_message(OWNER, '最初补充')
        first = self.issue['comments'][-1]
        self.turn(response())
        self.add_message(OWNER, '最近提问')
        self.turn(response())
        first.update(body='纠正最初补充', updatedAt='2026-11-17T02:00:00Z')
        context = self.context({'comment': {'id': first['id']}})
        self.assertEqual(context['request']['body'], '纠正最初补充')

    def test_stale_queued_comment_is_not_processed_instead_of_newest_message(self):
        self.add_message(OWNER, '第一条')
        first = self.issue['comments'][-1]['id']
        self.add_message(OWNER, '新的纠正')
        self.assertIsNone(self.context({'comment': {'id': first}}))
        self.assertIn('新的纠正', self.context()['request']['body'])

    def test_other_actor_cannot_restore_or_approve_session(self):
        with self.assertRaises(ValueError):
            adapter.make_context(self.issue, REPO, OWNER, 'outsider', root=self.root)


class WorkflowBoundaryTests(unittest.TestCase):
    def test_model_publication_and_main_writes_have_separate_authority(self):
        import yaml
        workflow = yaml.safe_load((core.ROOT / '.github/workflows/codex-issue-driver.yml').read_text())
        jobs = workflow['jobs']
        self.assertEqual(jobs['turn']['permissions']['contents'], 'read')
        self.assertEqual(jobs['turn']['permissions']['issues'], 'read')
        self.assertEqual(jobs['publish']['permissions']['contents'], 'read')
        self.assertEqual(jobs['publish']['permissions']['issues'], 'write')
        self.assertEqual(jobs['apply']['permissions']['issues'], 'read')
        self.assertEqual(jobs['apply']['permissions']['contents'], 'write')
        self.assertEqual(jobs['regenerate']['permissions']['actions'], 'write')
        for job in jobs.values():
            for step in job['steps']:
                if step.get('uses') == 'actions/download-artifact@v4':
                    self.assertIn('artifact-ids', step['with'])
                if 'run' in step:
                    subprocess.run(['bash', '-n'], input=step['run'], text=True, check=True)
        self.assertIn("inputs.dry_run != 'true'", jobs['turn']['outputs']['ready'])


if __name__ == '__main__':
    unittest.main()
