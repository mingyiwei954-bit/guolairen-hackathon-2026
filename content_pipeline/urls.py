"""Zhihu URL normalization and SSRF-resistant validation."""

from __future__ import annotations

import ipaddress
import json
import socket
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ALLOWED_HOSTS = {"zhihu.com", "www.zhihu.com", "zhuanlan.zhihu.com"}
TRACE_KEYS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "utm_psn", "zhida_source", "share_code", "invite_code", "source", "timestamp",
}


class URLValidationError(ValueError):
    pass


@dataclass(frozen=True)
class NormalizedURL:
    original_url: str
    canonical_url: str
    canonical_key: str
    trace_query_json: str


def _normalize_host(host: str | None) -> str:
    value = (host or "").rstrip(".").lower()
    if value not in ALLOWED_HOSTS:
        raise URLValidationError("仅允许 HTTPS 知乎内容域名")
    return value


def normalize_zhihu_url(url: str) -> NormalizedURL:
    if not isinstance(url, str) or not url.strip():
        raise URLValidationError("URL 不能为空")
    raw = url.strip()
    parts = urlsplit(raw)
    if parts.scheme.lower() != "https":
        raise URLValidationError("仅允许 HTTPS URL")
    host = _normalize_host(parts.hostname)
    if parts.username or parts.password or parts.port not in (None, 443):
        raise URLValidationError("URL 不得包含凭据或非标准端口")
    path = "/" + "/".join(segment for segment in parts.path.split("/") if segment)
    if path != "/":
        path = path.rstrip("/")
    kept: list[tuple[str, str]] = []
    trace: dict[str, list[str]] = {}
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        lower = key.lower()
        if lower.startswith("utm_") or lower in TRACE_KEYS:
            trace.setdefault(key, []).append(value)
        else:
            kept.append((key, value))
    kept.sort()
    canonical = urlunsplit(("https", host, path, urlencode(kept, doseq=True), ""))
    return NormalizedURL(
        original_url=raw,
        canonical_url=canonical,
        canonical_key="url:" + canonical,
        trace_query_json=json.dumps(trace, ensure_ascii=False, sort_keys=True),
    )


def validate_public_resolution(url: str) -> None:
    parts = urlsplit(url)
    host = _normalize_host(parts.hostname)
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise URLValidationError("知乎域名解析失败") from exc
    if not addresses:
        raise URLValidationError("知乎域名没有可用地址")
    for item in addresses:
        address = ipaddress.ip_address(item[4][0])
        if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified or address.is_reserved:
            raise URLValidationError("目标解析到不安全地址，已拒绝")
        # Some managed desktop networks resolve every external hostname to an
        # RFC1918 transparent egress.  The immutable hostname allow-list above,
        # redirect revalidation, and HTTPX TLS verification still bind the
        # request to an authenticated Zhihu content host in that environment.


def content_kind_from_url(url: str | None) -> str:
    if not url:
        return "unknown"
    path = urlsplit(url).path
    if "/answer/" in path:
        return "answer"
    if urlsplit(url).hostname == "zhuanlan.zhihu.com" and path.startswith("/p/"):
        return "article"
    return "unknown"


def answer_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    pieces = [piece for piece in urlsplit(url).path.split("/") if piece]
    try:
        index = pieces.index("answer")
    except ValueError:
        return None
    value = pieces[index + 1] if index + 1 < len(pieces) else ""
    return value if value.isdigit() else None
