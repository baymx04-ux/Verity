"""Provider-neutral LLM streaming interface."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

Role = Literal["user", "assistant"]


class LLMError(RuntimeError):
    """Raised when a model provider rejects or cannot complete a request."""


@dataclass(frozen=True, slots=True)
class LLMDelta:
    text: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMClient(Protocol):
    name: str

    def stream(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_output_tokens: int,
    ) -> AsyncIterator[LLMDelta]: ...
