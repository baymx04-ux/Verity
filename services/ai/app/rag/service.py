"""Grounded chat orchestration and SSE event contract."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import asdict

from app.core.config import Settings
from app.core.tracing import Trace
from app.llm.base import LLMClient, LLMError
from app.models.chat import ChatRequest
from app.rag.citations import CitationStreamFilter
from app.rag.prompts import (
    DOCUMENT_SYSTEM_PROMPT,
    REFUSAL_ANSWER,
    build_context_prompt,
    is_refusal_answer,
)
from app.rag.retrieval import RetrievalService
from app.rag.rewrite import QueryRewriter
from app.rag.types import AccessContext

logger = logging.getLogger(__name__)

ChatEvent = tuple[str, dict[str, object]]


class ChatService:
    def __init__(
        self,
        settings: Settings,
        *,
        retrieval: RetrievalService,
        llm: LLMClient,
        rewriter: QueryRewriter | None = None,
    ) -> None:
        self._settings = settings
        self._retrieval = retrieval
        self._llm = llm
        self._rewriter = rewriter or QueryRewriter(llm)

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatEvent]:
        started = time.perf_counter()
        first_token_ms: int | None = None
        trace = Trace(request.trace_id) if request.trace_id else Trace()
        access = AccessContext(
            user_id=str(request.access_context.user_id),
            role=request.access_context.role,
            group_ids=tuple(str(group_id) for group_id in request.access_context.group_ids),
        )
        history = [
            {"role": message.role, "content": message.content}
            for message in request.history[-self._settings.chat_history_limit :]
        ]

        if history:
            yield "status", {"stage": "rewriting", "message": "Understanding the follow-up…"}
            with trace.span("rewrite"):
                question = await self._rewriter.rewrite(request.question, history)
        else:
            question = request.question.strip()

        yield "route", {"route": "documents"}
        yield "status", {"stage": "retrieving", "message": "Searching accessible documents…"}

        try:
            with trace.span("retrieval"):
                result = await self._retrieval.retrieve(question, access)
        except Exception as exc:
            logger.exception("retrieval failed trace_id=%s: %s", trace.trace_id, exc)
            yield (
                "error",
                {
                    "code": "retrieval_failed",
                    "message": "I couldn't search the document index. Please try again.",
                },
            )
            return

        if result.low_confidence or not result.citations:
            yield (
                "status",
                {
                    "stage": "writing",
                    "message": "No sufficiently relevant evidence found…",
                },
            )
            first_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": REFUSAL_ANSWER}
            yield "sources", {"citations": []}
            yield (
                "done",
                {
                    "route": "documents",
                    "trace_id": trace.trace_id,
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "time_to_first_token_ms": first_token_ms,
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                    "spans": {**trace.summary(), **result.spans},
                    "low_confidence": True,
                    "answer_status": "refused",
                    "cited_indices": [],
                    "citation_count": 0,
                    "invalid_citation_count": 0,
                    "model": getattr(self._llm, "name", "unknown"),
                    "retrieval": {
                        "best_score": round(result.best_score, 4),
                        "candidates": len(result.chunks),
                    },
                },
            )
            return

        yield "status", {"stage": "writing", "message": "Writing answer with citations…"}
        citations = result.citations
        citation_payload = [asdict(citation) for citation in citations]
        answer_parts: list[str] = []
        prompt_tokens = 0
        completion_tokens = 0
        citation_filter = CitationStreamFilter(len(citations))

        try:
            with trace.span("generation"):
                async for delta in self._llm.stream(
                    system=DOCUMENT_SYSTEM_PROMPT,
                    messages=[
                        {
                            "role": "user",
                            "content": build_context_prompt(question, result.chunks),
                        }
                    ],
                    temperature=self._settings.llm_temperature,
                    max_output_tokens=self._settings.llm_max_output_tokens,
                ):
                    if delta.prompt_tokens is not None:
                        prompt_tokens = delta.prompt_tokens
                    if delta.completion_tokens is not None:
                        completion_tokens = delta.completion_tokens
                    if not delta.text:
                        continue
                    safe = citation_filter.feed(delta.text)
                    if safe:
                        if first_token_ms is None:
                            first_token_ms = int((time.perf_counter() - started) * 1000)
                        answer_parts.append(safe)
                        yield "token", {"text": safe}

            tail = citation_filter.flush()
            if tail:
                if first_token_ms is None:
                    first_token_ms = int((time.perf_counter() - started) * 1000)
                answer_parts.append(tail)
                yield "token", {"text": tail}
        except asyncio.CancelledError:
            logger.info("chat generation cancelled trace_id=%s", trace.trace_id)
            raise
        except LLMError as exc:
            logger.warning("generation failed trace_id=%s: %s", trace.trace_id, exc)
            yield (
                "error",
                {
                    "code": "generation_failed",
                    "message": "The answer model is unavailable. Please try again.",
                },
            )
            return
        except Exception as exc:
            logger.exception("unexpected generation error trace_id=%s: %s", trace.trace_id, exc)
            yield (
                "error",
                {
                    "code": "generation_failed",
                    "message": "The answer could not be generated. Please try again.",
                },
            )
            return

        answer = "".join(answer_parts)
        cited_indices = sorted(citation_filter.cited)
        refused = is_refusal_answer(answer)
        low_confidence = refused or not cited_indices

        if refused:
            # The model declined after retrieval. Do not present retrieved
            # passages as evidence for a refusal.
            citation_payload = []
            citations = []
            cited_indices = []
        elif not cited_indices:
            logger.warning(
                "answer has no valid citations trace_id=%s citations=%s",
                trace.trace_id,
                len(citations),
            )

        if citation_filter.dropped_count:
            logger.warning(
                "dropped invalid citation markers trace_id=%s count=%s indices=%s",
                trace.trace_id,
                citation_filter.dropped_count,
                sorted(citation_filter.dropped_indices),
            )

        answer_status = "refused" if refused else ("answered" if cited_indices else "uncited")
        logger.info(
            "chat complete trace_id=%s latency_ms=%s ttft_ms=%s status=%s cited=%s",
            trace.trace_id,
            int((time.perf_counter() - started) * 1000),
            first_token_ms,
            answer_status,
            cited_indices,
        )

        yield "sources", {"citations": citation_payload}
        yield (
            "done",
            {
                "route": "documents",
                "trace_id": trace.trace_id,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "time_to_first_token_ms": first_token_ms,
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                },
                "spans": {**trace.summary(), **result.spans},
                "low_confidence": low_confidence,
                "answer_status": answer_status,
                "cited_indices": cited_indices,
                "citation_count": len(citations),
                "invalid_citation_count": citation_filter.dropped_count,
                "model": getattr(self._llm, "name", "unknown"),
                "retrieval": {
                    "best_score": round(result.best_score, 4),
                    "candidates": len(result.chunks),
                },
            },
        )
