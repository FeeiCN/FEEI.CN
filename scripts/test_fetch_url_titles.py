import unittest
import json
import os
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

import yaml

import fetch_url_content as fetch


class IssueTitleTests(unittest.TestCase):
    url = 'https://example.org/article'

    def test_falls_back_to_first_real_heading_outside_code(self):
        for title in ['', self.url, 'https://example.org/redirect', '无标题']:
            result = {'title': title, 'markdown': '```md\n# 假标题\n```\n# **反制 AI 黑客**\n正文'}
            self.assertEqual(fetch.resolve_issue_title(result, self.url), '反制 AI 黑客')

    def test_existing_metadata_is_preserved(self):
        self.assertEqual(fetch.resolve_issue_title({'title': '文章标题', 'markdown': '# 网站导航'}, self.url), '文章标题')

    def test_translated_title_preserves_author_and_removes_gloss(self):
        result = {'title': 'Thorsten Ball：How I work with Agents', 'translated': True,
                  'markdown': '## 1. 逐行翻译\n\n# How I work with Agents\n\n# 如何与智能体协作（英文：Agents；这里指 AI 系统）\n\n正文'}
        self.assertEqual(fetch.resolve_issue_title(result, self.url), 'Thorsten Ball：如何与智能体协作')

    def test_matches_article_title_instead_of_blog_header(self):
        result = {'title': 'How To Be Successful - Sam Altman', 'translated': True,
                  'markdown': '# [Sam Altman](https://example.org)\n\n# [Sam Altman](https://example.org)\n\n'
                              '## [How To Be Successful](https://example.org/article)\n\n'
                              '## [如何获得成功](https://example.org/article)'}
        self.assertEqual(fetch.resolve_issue_title(result, self.url), '如何获得成功 - Sam Altman')

    def test_does_not_invent_translation_or_use_later_chapter(self):
        result = {'title': 'Article', 'translated': True, 'markdown': '# Article\n\n正文\n\n# 后面的章节'}
        self.assertEqual(fetch.resolve_issue_title(result, self.url), 'Article')
        result['markdown'] = '# Article\n\n# 文章'
        result['translated'] = False
        self.assertEqual(fetch.resolve_issue_title(result, self.url), 'Article')

    def test_fetch_pipeline_updates_title_after_translation(self):
        raw = {'status': 'success', 'title': self.url, 'markdown': '# Original\n\nEnglish text'}
        translated = {'translated': True, 'markdown': '# Original\n\n# 中文标题\n\n译文'}
        with patch.object(fetch, '_fetch_raw', return_value=raw), patch.object(fetch, 'maybe_translate_markdown', return_value=translated):
            self.assertEqual(fetch.fetch_url_content(self.url, timeout=1)['title'], '中文标题')

    def test_workflow_budget_allows_translation_timeout_fallback_and_delivery(self):
        workflow = yaml.safe_load((Path(fetch.__file__).resolve().parents[1] /
                                   '.github/workflows/fetch-issue-url.yml').read_text())
        budget = workflow['jobs']['process']['timeout-minutes'] * 60
        self.assertGreaterEqual(budget - fetch.DEFAULT_TRANSLATE_TIMEOUT, 300)

    def test_translation_timeout_preserves_original_for_delivery(self):
        raw = {'status': 'success', 'title': 'Original', 'markdown': 'An English article with enough Latin letters for language detection and a complete paragraph.'}
        with patch.object(fetch, '_fetch_raw', return_value=raw), \
                patch.object(fetch, 'translate_text', side_effect=fetch.TranslationError('timeout')):
            result = fetch.fetch_url_content(self.url, timeout=1)
        self.assertEqual(result['status'], 'success')
        self.assertFalse(result['translated'])
        self.assertEqual(result['markdown'], raw['markdown'])
        self.assertEqual(result['translate_error'], 'timeout')


class FetchWorkflowResultTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        workflow = yaml.safe_load((Path(fetch.__file__).resolve().parents[1] /
                                   '.github/workflows/fetch-issue-url.yml').read_text())
        self.script = next(step['run'] for step in workflow['jobs']['process']['steps']
                           if step.get('name') == 'Fetch URL content')
        self.script = self.script.replace('${{ steps.creds.outputs.translate_flag }}', '--no-translate')
        self.script = self.script.replace('/tmp/', str(self.root) + '/')
        self.target = self.root / 'result.json'
        self.target.write_text('{"previous":true}')
        (self.root / 'scripts').mkdir()

    def run_fetch(self, output, status=0):
        (self.root / 'scripts/fetch_url_content.py').write_text(
            'import sys\nprint(' + repr(output) + ')\nsys.exit(' + str(status) + ')\n')
        env = {**os.environ, 'URL': 'https://example.org/article',
               'GITHUB_STEP_SUMMARY': str(self.root / 'summary.md')}
        return subprocess.run(['bash', '-e', '-c', self.script], cwd=self.root, env=env,
                              capture_output=True, text=True)

    def test_valid_json_is_published_after_validation_and_temp_file_is_removed(self):
        value = {'status': 'success', 'title': '抓取结果', 'markdown': '正文'}
        result = self.run_fetch(json.dumps(value))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.target.read_text()), value)
        self.assertEqual(list(self.root.glob('fetch-issue-result.*')), [])

    def test_nonzero_fetch_exit_is_preserved_even_with_valid_json(self):
        result = self.run_fetch('{"status":"success"}', status=23)
        self.assertEqual(result.returncode, 23, result.stderr)
        self.assertEqual(json.loads(self.target.read_text()), {'previous': True})
        self.assertFalse((self.root / 'summary.md').exists())
        self.assertEqual(list(self.root.glob('fetch-issue-result.*')), [])

    def test_polluted_json_and_invalid_result_do_not_replace_previous_file(self):
        for output in ['任务状态：执行中\n{"status":"success"}', '[]', 'null', '{"status":"error"}']:
            with self.subTest(output=output):
                result = self.run_fetch(output)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(self.target.read_text()), {'previous': True})
                self.assertEqual(list(self.root.glob('fetch-issue-result.*')), [])

    def test_translation_failure_still_allows_original_content_delivery(self):
        value = {'status': 'success', 'title': 'Original', 'markdown': 'Original article',
                 'translated': False, 'translate_error': 'timeout'}
        result = self.run_fetch(json.dumps(value))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.target.read_text()), value)


if __name__ == '__main__':
    unittest.main()
