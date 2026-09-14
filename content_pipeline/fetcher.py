"""Conservative, single-request-at-a-time HTTP fetch adapter."""

from __future__ import annotations

import time
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx

from .urls import URLValidationError, normalize_zhihu_url, validate_public_resolution

MAX_RESPONSE_BYTES = 3 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 15.0
MIN_SITE_INTERVAL_SECONDS = 3.0
MAX_REDIRECTS = 5


@dataclass(frozen=True)
class FetchResult:
    requested_url: str
    final_url: str
    status_code: int
    text: str
    content_type: str


class FetchFailure(RuntimeError):
    code = "fetch_failed"
    retryable = False

    def __init__(self, message: str, *, status_code: int | None = None, raw_text: str = "", final_url: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.raw_text = raw_text
        self.final_url = final_url


class BlockedFetch(FetchFailure):
    code = "blocked"


class RetryableFetch(FetchFailure):
    code = "temporary_fetch_error"
    retryable = True


class PermanentFetch(FetchFailure):
    code = "permanent_fetch_error"


HARD_BLOCK_MARKERS = (
    "安全验证",
    "请完成验证码",
    "访问异常",
    "请求存在异常",
    "captcha",
    "verifycaptcha",
    "403 forbidden",
)


def looks_blocked(text: str) -> bool:
    sample = (text or "")[:200_000].lower()
    if any(marker.lower() in sample for marker in HARD_BLOCK_MARKERS):
        return True
    has_login_gate = "登录后查看更多" in sample or "登录知乎" in sample
    has_content_container = any(marker in sample for marker in ("answeritem", "richcontent-inner", "post-richtextcontainer", "<article"))
    return has_login_gate and not has_content_container


class HTTPXFetcher:
    def __init__(
        self,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        min_interval: float = MIN_SITE_INTERVAL_SECONDS,
        max_bytes: int = MAX_RESPONSE_BYTES,
        client: httpx.Client | None = None,
        sleep=time.sleep,
        monotonic=time.monotonic,
    ) -> None:
        self.timeout = timeout
        self.min_interval = min_interval
        self.max_bytes = max_bytes
        self.sleep = sleep
        self.monotonic = monotonic
        self._last_request_at: float | None = None
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(timeout),
            follow_redirects=False,
            headers={
                "User-Agent": "GuolairenContentPipeline/0.1 (+local-hackathon-prototype)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )

    def _wait_for_slot(self) -> None:
        if self._last_request_at is not None:
            remaining = self.min_interval - (self.monotonic() - self._last_request_at)
            if remaining > 0:
                self.sleep(remaining)
        self._last_request_at = self.monotonic()

    def fetch(self, url: str) -> FetchResult:
        requested = normalize_zhihu_url(url).original_url
        current = requested
        for redirect_count in range(MAX_REDIRECTS + 1):
            normalized = normalize_zhihu_url(current)
            validate_public_resolution(normalized.canonical_url)
            self._wait_for_slot()
            try:
                with self.client.stream("GET", current) as response:
                    status = response.status_code
                    if status in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise PermanentFetch("重定向缺少目标", status_code=status, final_url=current)
                        current = urljoin(current, location)
                        normalize_zhihu_url(current)
                        continue
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > self.max_bytes:
                            raise PermanentFetch("响应体超过 3MB 上限", status_code=status, final_url=current)
                        chunks.append(chunk)
                    raw = b"".join(chunks)
                    encoding = response.encoding or "utf-8"
                    text = raw.decode(encoding, errors="replace")
                    content_type = response.headers.get("content-type", "")
            except httpx.TimeoutException as exc:
                raise RetryableFetch("请求超时", final_url=current) from exc
            except httpx.NetworkError as exc:
                raise RetryableFetch("网络连接暂时失败", final_url=current) from exc
            except URLValidationError:
                raise

            if status in (401, 403):
                raise BlockedFetch("知乎页面拒绝普通 HTTP 访问", status_code=status, raw_text=text, final_url=current)
            if status == 429 or status in (500, 502, 503, 504):
                raise RetryableFetch("知乎服务暂时不可用", status_code=status, raw_text=text, final_url=current)
            if status >= 400:
                raise PermanentFetch("页面请求失败（HTTP {}）".format(status), status_code=status, raw_text=text, final_url=current)
            if "html" not in content_type.lower():
                raise PermanentFetch("响应不是 HTML", status_code=status, raw_text=text, final_url=current)
            if looks_blocked(text):
                raise BlockedFetch("页面为登录、验证码或访问拦截内容", status_code=status, raw_text=text, final_url=current)
            return FetchResult(requested, current, status, text, content_type)
        raise PermanentFetch("重定向次数超过上限", final_url=current)
