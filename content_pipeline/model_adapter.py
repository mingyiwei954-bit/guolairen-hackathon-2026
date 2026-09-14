"""DeepSeek JSON client with secure local configuration and explicit failures."""

from __future__ import annotations

import os
import stat
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
DEFAULT_ENV_FILE = Path("~/.config/zhihu-hackathon/deepseek.env").expanduser()
MODEL_TIMEOUT_SECONDS = 60.0
MODEL_MAX_TOKENS = 2000

_MODEL_SLOT = threading.BoundedSemaphore(1)


def _parse_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"").strip("'")
        if key in {"DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_ENABLED"}:
            values[key] = value
    return values


@dataclass(frozen=True)
class DeepSeekConfig:
    api_key: str | None
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    enabled: bool = True

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @classmethod
    def from_env(cls) -> "DeepSeekConfig":
        configured_path = os.environ.get("DEEPSEEK_ENV_FILE")
        file_values = _parse_env_file(Path(configured_path).expanduser() if configured_path else DEFAULT_ENV_FILE)

        def value(name: str, default: str = "") -> str:
            return os.environ.get(name, file_values.get(name, default)).strip()

        base_url = value("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        parts = urlsplit(base_url)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            base_url = DEFAULT_BASE_URL
        enabled = value("DEEPSEEK_ENABLED", "1").lower() not in {"0", "false", "no", "off"}
        return cls(
            api_key=value("DEEPSEEK_API_KEY") or None,
            base_url=base_url,
            model=value("DEEPSEEK_MODEL", DEFAULT_MODEL) or DEFAULT_MODEL,
            enabled=enabled,
        )

    def public_status(self) -> dict[str, Any]:
        return {"enabled": self.enabled, "configured": self.configured, "model": self.model}


@dataclass(frozen=True)
class ModelResponse:
    content: str
    actual_model: str
    usage: dict[str, Any]
    finish_reason: str | None
    duration_ms: int
    http_status: int


class ModelCallError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        http_status: int | None = None,
        duration_ms: int = 0,
        actual_model: str | None = None,
        usage: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.duration_ms = duration_ms
        self.actual_model = actual_model
        self.usage = usage or {}


class JSONModelClient(Protocol):
    config: DeepSeekConfig

    def complete_json(self, messages: list[dict[str, str]], *, wait_for_slot: bool = False) -> ModelResponse:
        ...


class DeepSeekClient:
    def __init__(
        self,
        config: DeepSeekConfig | None = None,
        *,
        client: httpx.Client | None = None,
        timeout: float = MODEL_TIMEOUT_SECONDS,
    ) -> None:
        self.config = config or DeepSeekConfig.from_env()
        self.timeout = timeout
        self.client = client or httpx.Client(timeout=httpx.Timeout(timeout), follow_redirects=False)
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def complete_json(self, messages: list[dict[str, str]], *, wait_for_slot: bool = False) -> ModelResponse:
        if not self.config.enabled:
            raise ModelCallError("disabled", "AI 加工已禁用")
        if not self.config.configured:
            raise ModelCallError("not_configured", "DeepSeek API 密钥未配置")
        acquired = _MODEL_SLOT.acquire(blocking=wait_for_slot)
        if not acquired:
            raise ModelCallError("busy", "AI 服务正在处理另一个请求")
        started = time.perf_counter()
        try:
            try:
                response = self.client.post(
                    self.config.base_url + "/chat/completions",
                    headers={"Authorization": "Bearer " + (self.config.api_key or ""), "Content-Type": "application/json"},
                    json={
                        "model": self.config.model,
                        "messages": messages,
                        "stream": False,
                        "thinking": {"type": "disabled"},
                        "max_tokens": MODEL_MAX_TOKENS,
                        "response_format": {"type": "json_object"},
                    },
                    timeout=self.timeout,
                )
            except httpx.TimeoutException as exc:
                duration = int((time.perf_counter() - started) * 1000)
                raise ModelCallError("timeout", "DeepSeek 请求超时", duration_ms=duration) from exc
            except httpx.RequestError as exc:
                duration = int((time.perf_counter() - started) * 1000)
                raise ModelCallError("network_error", "DeepSeek 网络请求失败", duration_ms=duration) from exc

            duration = int((time.perf_counter() - started) * 1000)
            if response.status_code >= 400:
                code = {401: "authentication_error", 402: "insufficient_balance", 429: "rate_limited"}.get(
                    response.status_code, "upstream_error"
                )
                message = "DeepSeek 返回 HTTP {}".format(response.status_code)
                try:
                    body = response.json()
                    error_value = body.get("error") if isinstance(body, dict) else None
                    upstream = error_value.get("message") if isinstance(error_value, dict) else error_value
                    if isinstance(upstream, str) and upstream.strip():
                        message = upstream.strip()[:500]
                except (ValueError, TypeError):
                    pass
                if self.config.api_key:
                    message = message.replace(self.config.api_key, "[redacted]")
                raise ModelCallError(code, message, http_status=response.status_code, duration_ms=duration)

            try:
                payload = response.json()
                choice = payload["choices"][0]
                content = choice["message"]["content"]
            except (ValueError, TypeError, KeyError, IndexError) as exc:
                raise ModelCallError("invalid_response", "DeepSeek 响应结构无效", http_status=response.status_code, duration_ms=duration) from exc
            finish_reason = choice.get("finish_reason")
            usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
            actual_model = payload.get("model") if isinstance(payload.get("model"), str) else self.config.model
            if finish_reason == "length":
                raise ModelCallError(
                    "truncated", "DeepSeek 输出因长度限制被截断", http_status=response.status_code,
                    duration_ms=duration, actual_model=actual_model, usage=usage,
                )
            if not isinstance(content, str) or not content.strip():
                raise ModelCallError(
                    "empty_content", "DeepSeek 返回空内容", http_status=response.status_code,
                    duration_ms=duration, actual_model=actual_model, usage=usage,
                )
            return ModelResponse(content.strip(), actual_model, usage, finish_reason, duration, response.status_code)
        finally:
            _MODEL_SLOT.release()


class DisabledModelProcessor:
    enabled = False

    def derive(self, document_id: int, body_text: str) -> dict:
        raise RuntimeError("模型加工已禁用")
