"""Google Gemini streaming client."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.core.config import Settings
from app.llm.base import LLMDelta, LLMError

logger = logging.getLogger(__name__)


class GoogleLLMClient:
    name = "google"

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = settings.google_api_key.get_secret_value()
        self._base_url = settings.google_ai_base_url.rstrip("/")
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
            raise LLMError("GOOGLE_API_KEY is not configured for the answer model.")
        if not self._model:
            raise LLMError("LLM_MODEL is not configured.")

        contents = [
            {
                "role": "model" if message["role"] == "assistant" else "user",
                "parts": [{"text": message["content"]}],
            }
            for message in messages
        ]
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }
        url = f"{self._base_url}/models/{self._model}:streamGenerateContent?alt=sse"
        headers = {
            "x-goog-api-key": self._api_key,
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=10.0),
            transport=self._transport,
        ) as client:
            async with client.stream("POST", url, json=body, headers=headers) as response:
                if response.status_code != 200:
                    detail = (await response.aread()).decode("utf-8", errors="replace")
                    raise LLMError(
                        f"Gemini request failed ({response.status_code}): {_safe_detail(detail)}"
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
                        logger.debug("ignoring non-JSON Gemini stream chunk")
                        continue

                    for candidate in payload.get("candidates") or []:
                        for part in (candidate.get("content") or {}).get("parts") or []:
                            text = part.get("text")
                            if text:
                                yield LLMDelta(text=str(text))

                    usage = payload.get("usageMetadata") or {}
                    if usage:
                        yield LLMDelta(
                            prompt_tokens=_optional_int(usage.get("promptTokenCount")),
                            completion_tokens=_optional_int(usage.get("candidatesTokenCount")),
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
