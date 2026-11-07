import importlib.util
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import re
import tempfile
import unittest

import scheduled_issue_review as review
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('automation_tasks', Path(__file__).with_name('automation_tasks.py'))
automation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(automation)


class AutomationWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        root_patch = patch.object(automation, 'ROOT', self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.workflows = self.root / '.github/workflows'
        self.workflows.mkdir(parents=True)
        self.source = automation.BACKSTAGE / 'task.md'
        for source in [self.source, automation.COMMON]:
            path = self.root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(automation.START + '\ninstructions\n' + automation.END)

    def workflow(self, task_id='example', delivery='issue', filename='example.yml'):
        content = {
            'name': '示例任务',
            'on': {'workflow_dispatch': None, 'schedule': [{'cron': '5 1 * * *'}]},
            'jobs': {'run': {
                'if': "${{ vars.AUTOMATION_" + task_id.upper().replace('-', '_') + " == 'true' }}",
                'uses': './.github/workflows/automation-task.yml',
                'with': {'task_id': task_id, 'prompt_source': str(self.source), 'delivery': delivery},
            }},
        }
        (self.workflows / filename).write_text(automation.yaml.safe_dump(content))
        return content

    def test_sync_checks_without_model_or_network_and_is_silent_on_success(self):
        self.workflow(task_id='diary-prompt-sync')
        out = self.root / 'output'
        out.mkdir()
        with patch.object(automation.subprocess, 'check_output') as command:
            automation.verify_sync({'id': 'diary-prompt-sync'}, out)
            command.assert_not_called()
        self.assertEqual(json.loads((out / 'result.json').read_text())['status'], 'no_update')

    def test_sync_reports_missing_document_with_path_and_repair_command(self):
        self.workflow(task_id='diary-prompt-sync')
        (self.root / self.source).unlink()
        out = self.root / 'output'
        out.mkdir()
        automation.verify_sync({'id': 'diary-prompt-sync'}, out)
        result = json.loads((out / 'result.json').read_text())
        self.assertEqual(result['status'], 'blocked')
        self.assertIn(str(self.source), result['report_markdown'])
        self.assertIn('example.yml', result['report_markdown'])
        self.assertIn('automation_tasks.py check', result['report_markdown'])

    def test_configuration_comes_entirely_from_workflow(self):
        self.workflow()
        automation.check()
        task = automation.tasks()[0]
        self.assertEqual(task['prompt_source'], str(self.source))
        self.assertEqual(task['delivery'], 'issue')
        self.assertEqual(task['schedule'], ['5 1 * * *'])
        self.assertFalse((self.root / 'automation').exists())

    def test_duplicate_task_id_is_rejected(self):
        self.workflow()
        self.workflow(filename='duplicate.yml')
        with self.assertRaisesRegex(ValueError, '重复'):
            automation.check()

    def test_missing_prompt_input_is_rejected(self):
        content = self.workflow()
        del content['jobs']['run']['with']['prompt_source']
        (self.workflows / 'example.yml').write_text(automation.yaml.safe_dump(content))
        with self.assertRaisesRegex(ValueError, '提示词路径'):
            automation.check()

    def test_personal_tasks_allow_public_issue_delivery(self):
        self.workflow(task_id='daily-personal-record')
        automation.check()

    def test_runtime_inputs_must_match_workflow(self):
        self.workflow()
        for env in [{'TASK_PROMPT_SOURCE': 'wrong.md', 'TASK_DELIVERY': 'issue'},
                    {'TASK_PROMPT_SOURCE': str(self.source), 'TASK_DELIVERY': 'private_issue'}]:
            with self.subTest(env=env), patch.dict('os.environ', env, clear=True):
                with patch('sys.argv', ['automation_tasks.py', 'prepare', '--task', 'example']):
                    with patch.object(automation.os, 'chdir'), patch.object(automation, 'prepare') as prepare:
                        with self.assertRaisesRegex(ValueError, '执行参数'):
                            automation.main()
                        prepare.assert_not_called()

    def test_runtime_passes_validated_workflow_configuration(self):
        self.workflow()
        env = {'TASK_PROMPT_SOURCE': str(self.source), 'TASK_DELIVERY': 'issue'}
        with patch.dict('os.environ', env, clear=True):
            with patch('sys.argv', ['automation_tasks.py', 'prepare', '--task', 'example']):
                with patch.object(automation.os, 'chdir'), patch.object(automation, 'prepare') as prepare:
                    automation.main()
                    self.assertEqual(prepare.call_args.args[0]['prompt_source'], str(self.source))


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
                       'sources': ['https://example.com/a', 'https://example.com/b'], 'artifacts': [],
                       'audit': {'summary': '已核验两份原始来源', 'data_cutoff': '2026-11-07',
                                 'deduplication_reason': '与已读取历史相比有新增事实'}}

    def test_research_requires_actual_source_list(self):
        self.result['sources'] = []
        with self.assertRaisesRegex(ValueError, '来源'):
            automation.validate_result(self.task, self.result, self.out)

    def reading_content(self, **changes):
        self.task.update(id='daily-reading-selection', title='每日阅读精选')
        content = {
            'title': '一篇作品', 'author': '作者', 'source_url': 'https://example.com/original',
            'rights_url': 'https://example.com/license', 'license': 'CC-BY-4.0',
            'rights_evidence': '作者明确按 CC BY 4.0 许可发布；保留署名并标注译文。',
            'source_language': '中文', 'presentation': 'original',
            'full_text_markdown': '正文第一段。\n\n## 第二节\n\n正文结尾。', 'question': '你如何判断？',
        }
        content.update(changes)
        (self.out / 'reading-content.json').write_text(json.dumps(content, ensure_ascii=False))
        self.result.update(sources=['https://example.com/original', 'https://example.com/license'],
                           artifacts=['output/reading-content.json'], report_markdown='# 一个阅读问题\n简短推荐理由。')
        return content

    def test_reading_selection_rejects_link_only_delivery(self):
        self.task['id'] = 'daily-reading-selection'
        self.result.update(sources=['https://example.com/original'],
                           report_markdown='# 一个阅读问题\n[原文](https://example.com/original)')
        with self.assertRaisesRegex(ValueError, '全文文件'):
            automation.validate_result(self.task, self.result, self.out)

    def test_reading_selection_renders_entire_text_and_attribution_in_body(self):
        content = self.reading_content()
        state, report = automation.validate_result(self.task, self.result, self.out)
        self.assertEqual(state, 'completed')
        self.assertIn(content['full_text_markdown'], report)
        self.assertIn('## 完整原文', report)
        self.assertIn('作者：作者', report)
        self.assertIn('https://example.com/license', report)
        self.assertGreater(report.index('你如何判断？'), report.index('正文结尾。'))

    def test_full_translation_is_labelled_and_keeps_license(self):
        self.reading_content(presentation='full_translation', source_language='English',
                             license='CC-BY-SA-4.0', rights_evidence='中文译文沿用 CC BY-SA 4.0 许可。')
        report = automation.validate_result(self.task, self.result, self.out)[1]
        self.assertIn('完整中文译文（AI 翻译）', report)
        self.assertIn('中文译文沿用 CC BY-SA 4.0', report)

    def test_reading_rejects_missing_text_or_unsupported_rights(self):
        for changes in [{'full_text_markdown': ''}, {'rights_evidence': ''},
                        {'full_text_markdown': 'https://example.com/original'},
                        {'full_text_markdown': '[阅读全文](https://example.com/original)'},
                        {'license': 'all-rights-reserved'}, {'license': 'free-to-read'},
                        {'presentation': 'summary'}]:
            with self.subTest(changes=changes):
                self.reading_content(**changes)
                with self.assertRaises(ValueError):
                    automation.validate_result(self.task, self.result, self.out)

    def test_reading_requires_both_original_and_rights_sources(self):
        for source in ['https://example.com/original', 'https://example.com/license']:
            self.reading_content()
            self.result['sources'].remove(source)
            with self.assertRaisesRegex(ValueError, '本轮核验来源'):
                automation.validate_result(self.task, self.result, self.out)

    def test_oversized_reading_is_not_truncated_or_posted(self):
        self.reading_content(full_text_markdown='全文段落。' * 5000)
        self.write_delivery_metadata()
        with patch.object(automation, 'destination', return_value='owner/public'), patch.object(automation, 'gh') as api:
            with self.assertRaisesRegex(ValueError, '超过 Issue 正文限制'):
                automation.deliver(self.task, self.out)
        api.assert_not_called()

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

    def test_delivery_uses_current_repository_without_private_configuration(self):
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/public'}, clear=True):
            with patch.object(automation, 'gh') as api:
                self.assertEqual(automation.destination({'delivery': 'issue'}), 'owner/public')
                api.assert_not_called()

    def test_unknown_delivery_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '当前仓库 Issue'):
            automation.destination({'delivery': 'unknown'})

    def test_wallpaper_must_have_real_png_and_svg(self):
        self.task['id'] = 'update-weight-wallpaper'
        with self.assertRaisesRegex(ValueError, 'PNG 和 SVG'):
            automation.validate_result(self.task, self.result, self.out)

    def wallpaper_delivery(self):
        from PIL import Image
        Image.new('RGB', (1320, 2868)).save(self.out / 'wallpaper.png')
        (self.out / 'wallpaper.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
        self.task.update(id='update-weight-wallpaper', title='更新体重壁纸', delivery='issue')
        self.result['artifacts'] = ['output/wallpaper.png', 'output/wallpaper.svg']
        (self.out / 'result.json').write_text(json.dumps(self.result))
        (self.out / 'history.json').write_text('[]')
        (self.out / 'metadata.json').write_text(json.dumps({
            'delivery_repository': 'owner/public', 'run_url': 'https://example.com/run',
            'prompt_sha256': 'abc', 'commit': 'def',
        }))

        return lambda *args: 'https://github.com/owner/public/issues/1'

    def test_wallpaper_uses_only_temporary_actions_download(self):
        cli = self.wallpaper_delivery()
        with patch.dict('os.environ', {'GITHUB_RUN_ID': '123', 'WALLPAPER_ARTIFACT_ID': '456'}, clear=True):
            with patch.object(automation, 'destination', return_value='owner/public'):
                with patch.object(automation, 'gh', side_effect=cli) as api:
                    automation.deliver(self.task, self.out)
        issue = next(c.args for c in api.call_args_list if c.args[:2] == ('issue', 'create'))
        self.assertEqual(issue[issue.index('--title') + 1], '更新体重壁纸')
        self.assertIn('已交付', issue)
        self.assertIn('任务：更新体重壁纸', issue)
        body = (self.out / 'report.md').read_text()
        self.assertIn('https://github.com/owner/public/actions/runs/123/artifacts/456', body)
        self.assertIn('保留 30 天', body)
        self.assertNotIn('![', body)
        self.assertNotIn('releases/', body)
        self.assertFalse(any(c.args[0] == 'release' for c in api.call_args_list))

    def test_missing_wallpaper_artifact_does_not_create_issue(self):
        self.wallpaper_delivery()
        with patch.dict('os.environ', {'GITHUB_RUN_ID': '123'}, clear=True):
            with patch.object(automation, 'destination', return_value='owner/public'):
                with patch.object(automation, 'gh') as api, self.assertRaisesRegex(ValueError, '附件 ID'):
                    automation.deliver(self.task, self.out)
                api.assert_not_called()

    def test_wallpaper_text_uses_rendered_observations(self):
        from datetime import timedelta
        from zoneinfo import ZoneInfo
        self.wallpaper_delivery()
        today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
        source = 'https://feei.cn/data/health/example.json'
        data = {'as_of': today.isoformat(), 'weights': [
            {'date': (today - timedelta(days=1)).isoformat(), 'weight_jin': 160, 'source': source},
            {'date': today.isoformat(), 'weight_jin': 159, 'source': source},
        ], 'exercise': []}
        self.result['report_markdown'] = '尚待生成图片'
        (self.out / 'result.json').write_text(json.dumps(self.result))
        (self.out / 'wallpaper-data.json').write_text(json.dumps(data))
        with patch('render_weight_wallpaper.render'):
            automation.render_wallpaper(self.task, self.out)
        result = json.loads((self.out / 'result.json').read_text())
        self.assertIn('159.0 市斤', result['report_markdown'])
        self.assertIn('-1.0 市斤', result['report_markdown'])
        self.assertNotIn('尚待', result['report_markdown'])
        self.assertEqual(result['audit']['data_cutoff'], today.isoformat())

    def test_report_topic_becomes_title_without_execution_metadata(self):
        self.assertEqual(automation.issue_title('# DNS 故障如何跨越隔离边界\n正文', '安全事件研究复盘'), 'DNS 故障如何跨越隔离边界')
        self.assertEqual(automation.issue_title('# [自动任务][completed] 体重变化 · 2026-11-07 10:00 UTC', '壁纸'), '体重变化')
        self.assertEqual(automation.issue_title('无标题正文', '任务名称'), '任务名称')

    def test_wallpaper_regeneration_replies_to_original_issue_even_when_report_is_unchanged(self):
        import hashlib
        cli = self.wallpaper_delivery()
        meta = json.loads((self.out / 'metadata.json').read_text())
        request = {'issue': '809', 'comment_id': '987', 'request_digest': 'a' * 64, 'source': 'b' * 64}
        meta.update(reply_to=request, report_fingerprints=[hashlib.sha256(self.result['report_markdown'].encode()).hexdigest()])
        (self.out / 'metadata.json').write_text(json.dumps(meta))
        with patch.dict('os.environ', {'GITHUB_RUN_ID': '123', 'WALLPAPER_ARTIFACT_ID': '456'}, clear=True):
            with patch.object(automation, 'destination', return_value='owner/public'):
                with patch.object(review, 'wallpaper_request', return_value=request):
                    with patch.object(automation, 'gh', side_effect=cli) as api:
                        automation.deliver(self.task, self.out)
        api.assert_called_once()
        self.assertEqual(api.call_args.args[:3], ('issue', 'comment', '809'))
        self.assertTrue((self.out / 'report.md').read_text().startswith('<!-- automation-wallpaper:request:987 -->'))

    def test_explicit_wallpaper_request_cannot_silently_return_no_update(self):
        self.wallpaper_delivery()
        result = json.loads((self.out / 'result.json').read_text())
        result['status'] = 'no_update'
        (self.out / 'result.json').write_text(json.dumps(result))
        meta = json.loads((self.out / 'metadata.json').read_text())
        meta['reply_to'] = {'issue': '809'}
        (self.out / 'metadata.json').write_text(json.dumps(meta))
        with self.assertRaisesRegex(ValueError, '不能用 no_update'):
            automation.render_wallpaper(self.task, self.out)

    def test_changed_wallpaper_request_stops_delivery(self):
        self.wallpaper_delivery()
        meta = json.loads((self.out / 'metadata.json').read_text())
        meta['reply_to'] = {'issue': '809', 'comment_id': '987', 'request_digest': 'a' * 64, 'source': 'b' * 64}
        (self.out / 'metadata.json').write_text(json.dumps(meta))
        with patch.object(automation, 'destination', return_value='owner/public'):
            with patch.object(review, 'wallpaper_request', return_value={}), patch.object(automation, 'gh') as api:
                with self.assertRaisesRegex(ValueError, '已变化'):
                    automation.deliver(self.task, self.out)
                api.assert_not_called()

    def test_no_update_requires_check_body(self):
        self.result.update(status='no_update', report_markdown='', sources=[])
        with self.assertRaisesRegex(ValueError, '缺少执行结果正文'):
            automation.validate_result(self.task, self.result, self.out)

    def test_no_update_requires_checked_sources_except_deterministic_sync(self):
        self.result.update(status='no_update', sources=[])
        with self.assertRaisesRegex(ValueError, '实际检查的来源'):
            automation.validate_result(self.task, self.result, self.out)
        self.task['id'] = 'diary-prompt-sync'
        self.assertEqual(automation.validate_result(self.task, self.result, self.out)[0], 'no_update')

    def test_audit_fields_cannot_be_empty_or_missing(self):
        for key in ['summary', 'data_cutoff', 'deduplication_reason']:
            with self.subTest(key=key):
                audit = self.result['audit'].copy()
                self.result['audit'][key] = ''
                with self.assertRaisesRegex(ValueError, '检查摘要'):
                    automation.validate_result(self.task, self.result, self.out)
                self.result['audit'] = audit

    def test_no_update_keeps_evidence_without_posting_issue(self):
        self.result['status'] = 'no_update'
        self.write_delivery_metadata()
        with patch.object(automation, 'destination', return_value='owner/public'), patch.object(automation, 'gh') as api:
            automation.deliver(self.task, self.out)
        api.assert_not_called()
        metadata = json.loads((self.out / 'metadata.json').read_text())
        self.assertEqual(metadata['audit'], self.result['audit'])
        self.assertEqual(metadata['source_count'], 2)

    def write_delivery_metadata(self, schedule=None):
        (self.out / 'result.json').write_text(json.dumps(self.result))
        (self.out / 'metadata.json').write_text(json.dumps({
            'delivery_repository': 'owner/public', 'run_url': 'https://example.com/run',
            'prompt_sha256': 'abc', 'commit': 'def', 'schedule_check': schedule,
        }))

    def test_expired_candidate_is_saved_without_posting_stale_alert(self):
        self.task.update(id='hk-ipo-alerts', title='港股提醒')
        self.write_delivery_metadata({'expires_at': '2020-01-01T00:45:00+00:00'})
        with patch.object(automation, 'destination', return_value='owner/public'), patch.object(automation, 'gh') as api:
            automation.deliver(self.task, self.out)
        api.assert_not_called()
        metadata = json.loads((self.out / 'metadata.json').read_text())
        self.assertEqual(metadata['delivery_status'], 'expired')
        self.assertIn(self.result['report_markdown'], (self.out / 'report.md').read_text())

    def test_governance_draft_is_pending_review(self):
        self.task.update(id='knowledge-base-governance', title='知识库治理')
        self.write_delivery_metadata()
        with patch.object(automation, 'destination', return_value='owner/public'), patch.object(automation, 'gh', return_value='https://example.com/issue') as api:
            automation.deliver(self.task, self.out)
        issue = next(c.args for c in api.call_args_list if c.args[:2] == ('issue', 'create'))
        self.assertIn('待审阅', issue)
        self.assertNotIn('已交付', issue)

    def test_governance_delivery_seals_initial_draft_for_one_step_approval(self):
        self.task.update(id='knowledge-base-governance', title='知识库治理')
        self.result['report_markdown'] = ('# 修正 TLS 建议\n\n简短理由。\n\n<details>\n<summary>完整待审稿</summary>\n\n'
                                          '## 完整待审稿\n### docs/example.md\n````markdown\n完整正文\n````\n\n</details>')
        self.write_delivery_metadata()
        meta = json.loads((self.out / 'metadata.json').read_text())
        meta['commit'] = 'a' * 40
        (self.out / 'metadata.json').write_text(json.dumps(meta))
        with patch.object(automation, 'destination', return_value='owner/public'), patch.object(automation, 'gh', return_value='https://example.com/issue') as api:
            automation.deliver(self.task, self.out)
        body = (self.out / 'report.md').read_text()
        issue = {'title': '修正 TLS 建议', 'body': body, 'author': {'login': review.BOT}}
        draft = review.report_draft(issue)
        self.assertIsNotNone(draft)
        self.assertEqual(list(draft['file_hashes']), ['docs/example.md'])
        self.assertEqual(body.count('完整正文'), 1)
        self.assertEqual(sum(c.args[:2] == ('issue', 'create') for c in api.call_args_list), 1)
        self.assertFalse(any(c.args[:2] == ('issue', 'comment') for c in api.call_args_list))

    def test_incomplete_initial_draft_cannot_be_delivered_as_ready(self):
        self.task.update(id='knowledge-base-governance', title='知识库治理')
        self.result['report_markdown'] = '## 完整待审稿\n只有提纲，没有完整文件。'
        self.write_delivery_metadata()
        with patch.object(automation, 'destination', return_value='owner/public'), patch.object(automation, 'gh') as api:
            with self.assertRaisesRegex(ValueError, '完整文件'):
                automation.deliver(self.task, self.out)
        api.assert_not_called()

    def test_prepare_does_not_fetch_data_for_invalid_delivery(self):
        with patch.dict('os.environ', {'GITHUB_REPOSITORY': 'owner/public'}, clear=True):
            with patch.object(automation, 'collect_personal_data') as collect:
                with self.assertRaises(ValueError):
                    automation.prepare({'delivery': 'unknown'}, self.out)
                collect.assert_not_called()

    def test_public_personal_task_still_fetches_real_data(self):
        task = {'id': 'personal-health-trend-research', 'delivery': 'issue',
                'schedule': ['0 2 * * 1'], 'prompt_source': 'document.md'}
        env = {'GITHUB_REPOSITORY': 'owner/public', 'GITHUB_ACTOR': 'owner',
               'GITHUB_SHA': 'abc', 'GITHUB_RUN_ID': '123'}
        with patch.dict('os.environ', env, clear=True), patch.object(automation, 'prompt', return_value='instructions'):
            with patch.object(review, 'read_task_history', return_value={'issues': [], 'scope': 'task_search_latest_100', 'comments_scope': 'latest_10', 'errors': []}):
                with patch.object(automation.subprocess, 'check_output', return_value='activity'):
                    with patch.object(automation, 'collect_personal_data') as collect:
                        automation.prepare(task, self.out)
                        collect.assert_called_once_with(task, self.out)
        self.assertEqual(json.loads((self.out / 'metadata.json').read_text())['delivery_repository'], 'owner/public')
        self.assertEqual(json.loads((self.out / 'context.md').read_text())['personal_data_index'],
                         'output/personal-data-index.json')

    def test_wallpaper_delivery_deduplicates_without_transferring_history_bodies(self):
        import hashlib
        cli = self.wallpaper_delivery()
        metadata = json.loads((self.out / 'metadata.json').read_text())
        metadata['report_fingerprints'] = [hashlib.sha256(self.result['report_markdown'].encode()).hexdigest()]
        (self.out / 'metadata.json').write_text(json.dumps(metadata))
        (self.out / 'history.json').unlink()
        with patch.object(automation, 'destination', return_value='owner/public'):
            with patch.object(automation, 'gh', side_effect=cli) as api:
                automation.deliver(self.task, self.out)
                api.assert_not_called()
        self.assertTrue(json.loads((self.out / 'metadata.json').read_text())['duplicate'])

    def test_prepare_includes_historical_owner_feedback_and_coverage(self):
        previous = [{'body': '<!-- automation-task:security-event-research -->\nverified report',
                     'title': 'report', 'html_url': 'https://github.com/owner/public/issues/1', 'updated_at': '2026-11-05',
                     'comments': [{'author': {'login': 'owner'}, 'body': '之前的口径需要修正'}]}]
        history = {'issues': previous, 'scope': 'task_search_latest_100', 'comments_scope': 'latest_10', 'errors': []}
        task = {'id': 'security-event-research', 'delivery': 'issue',
                'schedule': ['0 1 * * 1'], 'prompt_source': 'document.md'}
        env = {'GITHUB_REPOSITORY': 'owner/public', 'GITHUB_SHA': 'abc', 'GITHUB_RUN_ID': '123'}
        with patch.dict('os.environ', env, clear=True), patch.object(automation, 'prompt', return_value='instructions'):
            with patch.object(review, 'read_task_history', return_value=history):
                with patch.object(automation.subprocess, 'check_output', return_value='abc date activity'):
                    automation.prepare(task, self.out)
        stored = json.loads((self.out / 'history.json').read_text())
        self.assertEqual(stored[0]['comments'][0]['body'], '之前的口径需要修正')
        context = json.loads((self.out / 'context.md').read_text())
        self.assertEqual(context['history_comments_scope'], 'latest_10')
        self.assertEqual(context['history_errors'], [])
        self.assertEqual(json.loads((self.out / 'metadata.json').read_text())['history_count'], 1)

    def test_reading_prepare_includes_peer_feedback_and_retrieval_limits(self):
        own = {'issues': [], 'scope': 'task_search_latest_100', 'comments_scope': 'latest_10', 'errors': []}
        peer = {'issues': [{'html_url': 'https://github.com/owner/public/issues/8', 'title': '回访',
                            'updated_at': '2026-11-07', 'body': '机器人建议',
                            'comments': [{'author': {'login': 'owner'}, 'body': '原文这里我不同意'}]}],
                'scope': 'task_search_latest_100_incomplete', 'comments_scope': 'latest_10',
                'errors': ['早期评论未读到']}
        task = {'id': 'daily-reading-selection', 'delivery': 'issue',
                'schedule': ['40 23 * * *'], 'prompt_source': 'document.md'}
        env = {'GITHUB_REPOSITORY': 'owner/public', 'GITHUB_SHA': 'abc', 'GITHUB_RUN_ID': '123'}
        with patch.dict('os.environ', env, clear=True), patch.object(automation, 'prompt', return_value='instructions'), \
             patch.object(review, 'read_task_history', side_effect=[own, peer]) as histories, \
             patch.object(automation.subprocess, 'check_output', return_value='activity'), \
             patch.object(automation, 'collect_personal_data') as health:
            automation.prepare(task, self.out)
        self.assertEqual([call.args[1] for call in histories.call_args_list],
                         ['daily-reading-selection', 'weekly-reading-review'])
        health.assert_not_called()
        related = json.loads((self.out / 'related-history.json').read_text())
        self.assertEqual(related['weekly-reading-review'], peer)
        context = json.loads((self.out / 'context.md').read_text())
        self.assertEqual(context['related_task_history'], 'output/related-history.json')
        self.assertIn('weekly-reading-review', context['history_search_urls'])
        self.assertIn('推荐不等于读过', context['reading_evidence_boundary'])

    def test_reading_delivery_invites_feedback_without_requesting_article_approval(self):
        content = self.reading_content()
        self.write_delivery_metadata()
        with patch.object(automation, 'destination', return_value='owner/public'), \
             patch.object(automation, 'gh', return_value='https://github.com/owner/public/issues/1'):
            automation.deliver(self.task, self.out)
        body = (self.out / 'report.md').read_text()
        self.assertIn(content['full_text_markdown'], body)
        self.assertIn('阅读反馈不代表批准写入网站', body)
        self.assertNotIn('这版可以，写入网站吧', body)

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
