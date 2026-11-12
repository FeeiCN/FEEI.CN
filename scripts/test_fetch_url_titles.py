import unittest
from pathlib import Path
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


if __name__ == '__main__':
    unittest.main()
