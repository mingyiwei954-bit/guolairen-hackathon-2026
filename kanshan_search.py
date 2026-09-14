"""Bounded live search through Zhihu's official API; snippets are not full texts."""
import html
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
import httpx


def access_secret():
    if os.environ.get('ZHIHU_ACCESS_SECRET'):
        return os.environ['ZHIHU_ACCESS_SECRET'].strip()
    path = Path(os.environ.get('ZHIHU_SEARCH_ENV_FILE', '~/.config/zhihu-hackathon/search.env')).expanduser()
    if path.is_file() and not path.stat().st_mode & 0o077:
        for line in path.read_text().splitlines():
            if line.startswith('ZHIHU_ACCESS_SECRET='):
                return line.split('=', 1)[1].strip().strip('\"\'')
    return ''


def clean_text(value, limit):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).strip()[:limit]


class ZhihuSearch:
    def __init__(self, secret=None, transport=None):
        self.secret = access_secret() if secret is None else secret
        self.transport = transport

    def search(self, question):
        result = {'status': 'not_configured', 'sources': [], 'searched_at': int(time.time())}
        if not self.secret:
            return result
        try:
            with httpx.Client(timeout=httpx.Timeout(15, connect=5), transport=self.transport) as client:
                response = client.get('https://developer.zhihu.com/api/v1/content/global_search',
                    params={'Query': question[:200], 'Count': 5, 'SearchDB': 'all'},
                    headers={'Authorization': 'Bearer ' + self.secret,
                             'X-Request-Timestamp': str(int(time.time()))})
            if response.status_code in (401, 403):
                return {**result, 'status': 'authentication_error'}
            if response.status_code == 429:
                return {**result, 'status': 'rate_limited'}
            response.raise_for_status()
            data = response.json()
            if data.get('Code') != 0:
                return {**result, 'status': {20001: 'authentication_error', 30001: 'rate_limited'}.get(data.get('Code'), 'upstream_error')}
            seen = set()
            for item in (data.get('Data') or {}).get('Items', [])[:5]:
                url = item.get('Url', '')
                parsed = urlsplit(url)
                text = clean_text(item.get('ContentText'), 1100)
                if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or not text or url in seen:
                    continue
                seen.add(url)
                result['sources'].append({'id': 'S' + str(len(seen)), 'title': clean_text(item.get('Title'), 180),
                    'url': url, 'text': text, 'scope': 'summary', 'retrieved_at': result['searched_at']})
            result['status'] = 'completed' if result['sources'] else 'empty'
        except httpx.TimeoutException:
            result['status'] = 'timeout'
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            result['status'] = 'upstream_error'
        return result
