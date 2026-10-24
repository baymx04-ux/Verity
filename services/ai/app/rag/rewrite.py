"""Follow-up query rewriting for retrieval."""

from __future__ import annotations

import logging

from app.llm.base import LLMClient
from app.rag.prompts import REWRITE_SYSTEM_PROMPT, build_rewrite_prompt

logger = logging.getLogger(__name__)


class QueryRewriter:
    def __init__(self, llm: LLMClient, *, max_output_tokens: int = 120) -> None:
        self._llm = llm
        self._max_output_tokens = max_output_tokens

    async def rewrite(self, question: str, history: list[dict[str, str]]) -> str:
        if not history:
            return question

        chunks: list[str] = []
        try:
            async for delta in self._llm.stream(
                system=REWRITE_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": build_rewrite_prompt(question, history),
                    }
                ],
                temperature=0.0,
                max_output_tokens=self._max_output_tokens,
            ):
                if delta.text:
                    chunks.append(delta.text)
        except Exception as exc:
            logger.warning("query rewrite failed; using original question: %s", exc)
            return question

        rewritten = " ".join("".join(chunks).split()).strip().strip("\"'")
        if not rewritten or len(rewritten) > 500:
            return question
        return rewritten
