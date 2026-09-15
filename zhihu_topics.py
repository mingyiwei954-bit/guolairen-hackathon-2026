"""Official Zhihu *content* search for attaching related topics/content.

The platform does not expose a topic taxonomy or answer publishing endpoint.
These results must be labelled as related Zhihu content, never official topic IDs.
"""
import copy
import json
import os
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from kanshan_search import clean_text, access_secret


_CACHE = {}
_LOCK = threading.Lock()
_BLOCKED_UNTIL = 0
_DEFAULT_CLI = Path.home() / 'Library/Application Support/zhihu-cli/current/zhihu-cli'


def _result(status, items=None, cached=False):
    return {'status': status, 'items': items or [], 'provider': 'zhihu_official_search',
            'source_kind': 'zhihu_content', 'cached': cached}


def _parse(payload):
    code = payload.get('Code')
    if code not in (0, '0'):
        message = str(payload.get('Message', '')).lower()
        if code in (30001, 30002) or any(x in message for x in ('quota', 'rate limit', '额度', '限流')):
            return _result('rate_limited')
        if code == 20001 or any(x in message for x in ('auth', 'secret', 'credential')):
            return _result('authentication_error')
        return _result('upstream_error')
    seen, items = set(), []
    for item in (payload.get('Data') or {}).get('Items', []):
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get('Title'), 120)
        url = str(item.get('Url') or '')
        parsed = urlsplit(url)
        host = (parsed.hostname or '').lower()
        if (not name or parsed.scheme != 'https' or parsed.username or parsed.password
                or host not in ('www.zhihu.com', 'zhihu.com', 'zhuanlan.zhihu.com')
                or url in seen):
            continue
        seen.add(url)
        items.append({'name': name, 'url': url, 'source_kind': 'zhihu_content'})
        if len(items) == 6:
            break
    return _result('completed' if items else 'empty', items)


def _http_search(query):
    secret = access_secret()
    if not secret:
        return _result('not_configured')
    try:
        response = httpx.get('https://developer.zhihu.com/api/v1/content/zhihu_search',
            params={'Query': query, 'Count': 6}, timeout=8,
            headers={'Authorization': 'Bearer ' + secret, 'X-Request-Timestamp': str(int(time.time()))})
        if response.status_code in (401, 403):
            return _result('authentication_error')
        if response.status_code == 429:
            return _result('rate_limited')
        response.raise_for_status()
        return _parse(response.json())
    except httpx.TimeoutException:
        return _result('timeout')
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return _result('upstream_error')


def search_topics(query):
    """Search up to six related content links; call on explicit submit, not typing."""
    global _BLOCKED_UNTIL
    query = str(query or '').strip()[:100]
    if not query:
        return _result('empty')
    # Serialize requests so identical concurrent searches spend quota only once.
    with _LOCK:
        now = time.monotonic()
        cached = _CACHE.get(query)
        if cached and cached[0] > now:
            result = copy.deepcopy(cached[1])
            result['cached'] = True
            return result
        if _BLOCKED_UNTIL > now:
            return _result('rate_limited')
        binary = Path(os.environ.get('ZHIHU_CLI_PATH', str(_DEFAULT_CLI))).expanduser()
        use_cli = binary.is_absolute() and binary.is_file()
        try:
            if not use_cli:
                result = _http_search(query)
            else:
                response = subprocess.run(
                    [str(binary), 'search', 'zhihu', '--query', query, '--count', '6', '--timeout', '8s'],
                    capture_output=True, text=True, timeout=10, check=False)
                # Never return stderr or raw upstream diagnostics (they are not UI data).
                if response.returncode in (3, 7):
                    result = _result('authentication_error')
                elif response.returncode == 4:
                    result = _result('rate_limited')
                elif response.returncode == 5:
                    result = _result('timeout')
                else:
                    payload = json.loads(response.stdout)
                    result = _parse(payload) if isinstance(payload, dict) else _result('upstream_error')
                    if response.returncode and result['status'] in ('completed', 'empty'):
                        result = _result('upstream_error')
        except subprocess.TimeoutExpired:
            result = _result('timeout')
        except (OSError, ValueError, TypeError, AttributeError):
            result = _result('upstream_error')
        if result['status'] == 'rate_limited':
            _BLOCKED_UNTIL = now + 600
        ttl = 3600 if result['status'] in ('completed', 'empty') else 30
        if len(_CACHE) >= 100:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[query] = (now + ttl, copy.deepcopy(result))
        return result
