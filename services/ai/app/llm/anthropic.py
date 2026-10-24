"""Anthropic Messages streaming client."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.core.config import Settings
from app.llm.base import LLMDelta, LLMError

logger = logging.getLogger(__name__)


class AnthropicLLMClient:
    name = "anthropic"

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = settings.anthropic_api_key.get_secret_value()
        self._model = settings.llm_model
        self._transport = transport

    async def stream(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_output_tokens: int,
    ) -> AsyncIterator[LLMDelta]:
        if not self._api_key:
            raise LLMError("ANTHROPIC_API_KEY is not configured for the answer model.")

        body = {
            "model": self._model,
            "system": system,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": True,
        }
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=10.0),
            transport=self._transport,
        ) as client:
            async with client.stream(
                "POST",
                "https://api.anthropic.com/v1/messages",
                json=body,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    detail = (await response.aread()).decode("utf-8", errors="replace")
                    raise LLMError(
                        f"Anthropic request failed ({response.status_code}): {_safe_detail(detail)}"
                    )

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        payload = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    event_type = payload.get("type")
                    if event_type == "content_block_delta":
                        text = (payload.get("delta") or {}).get("text")
                        if text:
                            yield LLMDelta(text=str(text))
                    elif event_type == "message_start":
                        usage = (payload.get("message") or {}).get("usage") or {}
                        yield LLMDelta(prompt_tokens=_optional_int(usage.get("input_tokens")))
                    elif event_type == "message_delta":
                        usage = payload.get("usage") or {}
                        yield LLMDelta(
                            completion_tokens=_optional_int(usage.get("output_tokens"))
                        )
                    elif event_type == "error":
                        error = payload.get("error") or {}
                        raise LLMError(str(error.get("message") or "Anthropic stream error"))


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
