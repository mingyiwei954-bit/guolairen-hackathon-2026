import json
import subprocess
import unittest
from unittest.mock import patch

import zhihu_topics as topics


class ZhihuTopicTests(unittest.TestCase):
    def setUp(self):
        topics._CACHE.clear()
        topics._BLOCKED_UNTIL = 0

    def test_safe_content_links_and_cache(self):
        payload = {'Code': 0, 'Data': {'Items': [
            {'Title': '<em>成长</em>', 'Url': 'https://www.zhihu.com/question/123?utm_source=openapi'},
            {'Title': 'bad', 'Url': 'https://www.zhihu.com.evil.test/123'},
            {'Title': 'bad', 'Url': 'javascript:alert(1)'},
        ]}}
        proc = subprocess.CompletedProcess([], 0, json.dumps(payload), '')
        with patch.object(topics.Path, 'is_file', return_value=True), patch.object(topics.subprocess, 'run', return_value=proc) as run:
            result = topics.search_topics('成长')
            second = topics.search_topics('成长')
        self.assertEqual(1, len(result['items']))
        self.assertEqual('成长', result['items'][0]['name'])
        self.assertEqual('zhihu_content', result['items'][0]['source_kind'])
        self.assertTrue(second['cached'])
        self.assertEqual(1, run.call_count)
        self.assertEqual(['search', 'zhihu'], run.call_args.args[0][1:3])

    def test_server_http_without_desktop_cli(self):
        import httpx
        payload = {'Code': 0, 'Data': {'Items': [{'Title': '工作', 'Url': 'https://www.zhihu.com/question/123'}]}}
        response = httpx.Response(200, json=payload, request=httpx.Request('GET', 'https://developer.zhihu.com'))
        with patch.object(topics.Path, 'is_file', return_value=False), patch.object(topics, 'access_secret', return_value='test-secret'), patch.object(topics.httpx, 'get', return_value=response) as call:
            self.assertEqual('completed', topics.search_topics('工作')['status'])
            self.assertTrue(topics.search_topics('工作')['cached'])
        self.assertEqual(1, call.call_count)
        self.assertEqual('https://developer.zhihu.com/api/v1/content/zhihu_search', call.call_args.args[0])

    def test_rate_limit_stops_followup_calls(self):
        proc = subprocess.CompletedProcess([], 4, '', 'private diagnostic not returned')
        with patch.object(topics.Path, 'is_file', return_value=True), patch.object(topics.subprocess, 'run', return_value=proc) as run:
            self.assertEqual('rate_limited', topics.search_topics('工作')['status'])
            self.assertEqual('rate_limited', topics.search_topics('生活')['status'])
        self.assertEqual(1, run.call_count)


if __name__ == '__main__':
    unittest.main()
