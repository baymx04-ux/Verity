"""OpenAI-compatible streaming client (OpenAI and Ollama)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.core.config import Settings
from app.llm.base import LLMDelta, LLMError

logger = logging.getLogger(__name__)


class OpenAICompatibleLLMClient:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.name = settings.llm_provider.strip().lower()
        self._api_key = settings.openai_api_key.get_secret_value()
        self._model = settings.llm_model
        self._transport = transport
        if self.name == "ollama":
            self._base_url = f"{settings.ollama_base_url.rstrip('/')}/v1"
        else:
            self._base_url = "https://api.openai.com/v1"

    async def stream(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_output_tokens: int,
    ) -> AsyncIterator[LLMDelta]:
        if self.name == "openai" and not self._api_key:
            raise LLMError("OPENAI_API_KEY is not configured for the answer model.")

        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        body = {
            "model": self._model,
            "messages": [{"role": "system", "content": system}, *messages],
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": True,
        }
        if self.name == "openai":
            body["stream_options"] = {"include_usage": True}

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=10.0),
            transport=self._transport,
        ) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                json=body,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    detail = (await response.aread()).decode("utf-8", errors="replace")
                    safe = _safe_detail(detail)
                    raise LLMError(f"{self.name} request failed ({response.status_code}): {safe}")

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data:
                        continue
                    if data == "[DONE]":
                        break
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    for choice in payload.get("choices") or []:
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            yield LLMDelta(text=str(text))

                    usage = payload.get("usage") or {}
                    if usage:
                        yield LLMDelta(
                            prompt_tokens=_optional_int(usage.get("prompt_tokens")),
                            completion_tokens=_optional_int(usage.get("completion_tokens")),
                        )


def _optional_int(value: object) -> int | None:
    if isinstance(value, int | str):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return None


def _safe_detail(text: str, limit: int = 300) -> str:
    compact = " ".join(text.split())
    return compact[:limit] or "no detail"
