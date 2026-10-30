"""Hybrid answers: concurrent document retrieval and SQL execution."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import asdict

from app.core.config import Settings
from app.core.tracing import Trace
from app.ingestion.embeddings import GoogleEmbeddingClient
from app.llm.base import LLMClient
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
from app.rag.types import AccessContext, RetrievalResult
from app.router.hybrid_prompts import HYBRID_SYSTEM_PROMPT, build_hybrid_prompt
from app.sql.pipeline import SqlPipelineResult, run_sql_pipeline
from app.sql.synthesize import numeric_post_check, synthesize
from app.tracing.base import TraceExporter

logger = logging.getLogger(__name__)

ChatEvent = tuple[str, dict[str, object]]


class HybridChatService:
    def __init__(
        self,
        settings: Settings,
        *,
        retrieval: RetrievalService,
        llm: LLMClient,
        embeddings: GoogleEmbeddingClient,
        rewriter: QueryRewriter | None = None,
        trace_exporter: TraceExporter | None = None,
    ) -> None:
        self._settings = settings
        self._retrieval = retrieval
        self._llm = llm
        self._embeddings = embeddings
        self._rewriter = rewriter or QueryRewriter(llm)
        self._trace_exporter = trace_exporter

    def _trace(self, request: ChatRequest) -> Trace:
        trace = Trace(
            exporter=self._trace_exporter,
            redact_prompts=self._settings.trace_redact_prompts,
        )
        if request.trace_id:
            trace.trace_id = request.trace_id
        trace.set_user(str(request.access_context.user_id))
        trace.set_input(request.question)
        trace.set_metadata(route="hybrid")
        trace.add_tag("hybrid")
        return trace

    async def stream(
        self,
        request: ChatRequest,
        *,
        emit_route: bool = True,
        trace: Trace | None = None,
    ) -> AsyncIterator[ChatEvent]:
        started = time.perf_counter()
        trace = trace or self._trace(request)
        access = AccessContext(
            user_id=str(request.access_context.user_id),
            role=request.access_context.role,
            group_ids=tuple(str(group_id) for group_id in request.access_context.group_ids),
        )
        history = [
            {"role": message.role, "content": message.content}
            for message in request.history[-self._settings.chat_history_limit :]
        ]

        if emit_route:
            yield (
                "route",
                {
                    "route": "hybrid",
                    "confidence": 1.0,
                    "reason": "explicit mode",
                },
            )

        if history:
            yield "status", {"stage": "rewriting", "message": "Understanding the follow-up…"}
            with trace.span("hybrid_rewrite"):
                question = await self._rewriter.rewrite(request.question, history)
        else:
            question = request.question.strip()

        yield (
            "status",
            {
                "stage": "retrieving",
                "message": "Checking documents and company data…",
            },
        )
        yield (
            "status",
            {
                "stage": "running_sql",
                "message": "Running a safe read-only query…",
            },
        )

        doc_task = asyncio.create_task(
            self._retrieve(question, access, trace, standalone=not history),
            name="hybrid-documents",
        )
        sql_task = asyncio.create_task(
            run_sql_pipeline(
                question,
                settings=self._settings,
                llm=self._llm,
                embeddings=self._embeddings,
                trace=trace,
            ),
            name="hybrid-sql",
        )
        doc_outcome, sql_outcome = await asyncio.gather(
            doc_task,
            sql_task,
            return_exceptions=True,
        )

        retrieval = doc_outcome if isinstance(doc_outcome, RetrievalResult) else None
        if isinstance(doc_outcome, Exception):
            logger.warning("hybrid document retrieval failed: %s", doc_outcome)
        sql_result = sql_outcome if isinstance(sql_outcome, SqlPipelineResult) else None
        if isinstance(sql_outcome, Exception):
            logger.warning("hybrid SQL pipeline failed: %s", sql_outcome)

        docs_ok = bool(retrieval and not retrieval.low_confidence and retrieval.citations)
        sql_ok = bool(sql_result and sql_result.ok and sql_result.execution)
        citations = retrieval.citations if docs_ok and retrieval else []
        citations_payload = [asdict(citation) for citation in citations]
        sql_status = "ok" if sql_ok else (sql_result.outcome if sql_result else "failed")
        doc_status = (
            "failed"
            if isinstance(doc_outcome, Exception)
            else ("ok" if docs_ok else ("low_confidence" if retrieval else "empty"))
        )

        if not docs_ok and not sql_ok:
            if (
                sql_result
                and sql_result.outcome == "clarification"
                and not isinstance(doc_outcome, Exception)
            ):
                token_ms = int((time.perf_counter() - started) * 1000)
                yield "token", {"text": sql_result.clarification}
                yield "sources", {"citations": []}
                yield (
                    "done",
                    self._done(
                        trace,
                        started,
                        token_ms,
                        answer_status="clarification",
                        low_confidence=True,
                        docs_status=doc_status,
                        sql_status=sql_status,
                        sql_outcome={"outcome": "clarification"},
                        retrieval=retrieval,
                        usage=sql_result.usage,
                    ),
                )
                return

            if isinstance(doc_outcome, Exception) and (
                isinstance(sql_outcome, Exception)
                or (sql_result and sql_result.outcome in {"failed", "generation_failed"})
            ):
                yield (
                    "error",
                    {
                        "code": "hybrid_failed",
                        "message": "I couldn't check the documents and data. Please try again.",
                    },
                )
                return

            token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": REFUSAL_ANSWER}
            yield "sources", {"citations": []}
            yield (
                "done",
                self._done(
                    trace,
                    started,
                    token_ms,
                    answer_status="refused",
                    low_confidence=True,
                    docs_status=doc_status,
                    sql_status=sql_status,
                    sql_outcome=_sql_outcome(sql_result),
                    retrieval=retrieval,
                    usage=sql_result.usage if sql_result else (0, 0),
                ),
            )
            return

        execution = sql_result.execution if sql_result and sql_result.ok else None
        if execution is not None and sql_result is not None and sql_result.validation:
            yield (
                "sql",
                {
                    "sql": sql_result.validation.sql,
                    "query": sql_result.validation.sql,
                    "columns": execution.columns,
                    "rows": execution.rows,
                    "row_count": execution.row_count,
                    "truncated": execution.truncated,
                    "execution_ms": execution.execution_ms,
                },
            )

        yield (
            "status",
            {
                "stage": "writing",
                "message": (
                    "Writing the combined answer…"
                    if docs_ok and sql_ok
                    else ("Writing the data answer…" if sql_ok else "Writing the document answer…")
                ),
            },
        )

        prompt_tokens, completion_tokens = sql_result.usage if sql_result else (0, 0)
        base_prompt_tokens = prompt_tokens
        base_completion_tokens = completion_tokens
        prompt_tokens = 0
        completion_tokens = 0
        answer_parts: list[str] = []
        first_token_ms: int | None = None
        citation_filter = CitationStreamFilter(len(citations))
        try:
            if docs_ok and sql_ok and execution is not None and retrieval is not None:
                system = HYBRID_SYSTEM_PROMPT
                user_prompt = build_hybrid_prompt(
                    question,
                    retrieval.chunks,
                    sql=sql_result.sql if sql_result else "",
                    rows=execution.rows,
                    truncated=execution.truncated,
                )
                async for delta in self._llm.stream(
                    system=system,
                    messages=[{"role": "user", "content": user_prompt}],
                    temperature=self._settings.llm_temperature,
                    max_output_tokens=self._settings.llm_max_output_tokens,
                ):
                    prompt_tokens = delta.prompt_tokens or prompt_tokens
                    completion_tokens = delta.completion_tokens or completion_tokens
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
            elif docs_ok and retrieval is not None:
                async for delta in self._llm.stream(
                    system=DOCUMENT_SYSTEM_PROMPT,
                    messages=[
                        {
                            "role": "user",
                            "content": build_context_prompt(question, retrieval.chunks),
                        }
                    ],
                    temperature=self._settings.llm_temperature,
                    max_output_tokens=self._settings.llm_max_output_tokens,
                ):
                    prompt_tokens = delta.prompt_tokens or prompt_tokens
                    completion_tokens = delta.completion_tokens or completion_tokens
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
            elif execution is not None and sql_result is not None:
                async for token in synthesize(
                    question=question,
                    sql=sql_result.sql,
                    rows=execution.rows,
                    truncated=execution.truncated,
                    llm=self._llm,
                    temperature=self._settings.llm_temperature,
                    max_tokens=self._settings.llm_max_output_tokens,
                ):
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    answer_parts.append(token)
                    yield "token", {"text": token}
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("hybrid synthesis failed: %s", exc)
            if execution is None:
                yield (
                    "error",
                    {
                        "code": "generation_failed",
                        "message": "The answer could not be generated. Please try again.",
                    },
                )
                return
            fallback = self._fallback_answer(execution)
            if first_token_ms is None:
                first_token_ms = int((time.perf_counter() - started) * 1000)
            answer_parts.append(fallback)
            yield "token", {"text": fallback}

        answer = "".join(answer_parts)
        trace.set_output(answer)
        trace.set_metadata(
            docs_status=doc_status,
            sql_status=sql_status,
            model=getattr(self._llm, "model", getattr(self._llm, "name", "unknown")),
        )
        refused = not sql_ok and is_refusal_answer(answer)
        if refused:
            citations = []
            citations_payload = []
        cited_indices = sorted(citation_filter.cited)
        answer_status = (
            "refused" if refused else ("answered" if sql_ok or cited_indices else "uncited")
        )
        numeric_check = (
            numeric_post_check(answer, execution.rows) if execution is not None else None
        )

        yield "sources", {"citations": citations_payload}
        yield (
            "done",
            self._done(
                trace,
                started,
                first_token_ms,
                answer_status=answer_status,
                low_confidence=refused or (not sql_ok and not cited_indices),
                docs_status=doc_status,
                sql_status=sql_status,
                sql_outcome={
                    **_sql_outcome(sql_result),
                    **({"numeric_check": numeric_check} if numeric_check else {}),
                },
                retrieval=retrieval,
                usage=(
                    base_prompt_tokens + prompt_tokens,
                    base_completion_tokens + completion_tokens,
                ),
                cited_indices=cited_indices,
                citation_count=len(citations),
                invalid_citation_count=citation_filter.dropped_count,
            ),
        )

    async def _retrieve(
        self,
        question: str,
        access: AccessContext,
        trace: Trace,
        standalone: bool = True,
    ) -> RetrievalResult:
        with trace.span("hybrid_retrieval"):
            return await self._retrieval.retrieve(question, access, trace=trace, standalone=standalone)

    def _done(
        self,
        trace: Trace,
        started: float,
        first_token_ms: int | None,
        *,
        answer_status: str,
        low_confidence: bool,
        docs_status: str,
        sql_status: str,
        sql_outcome: dict[str, object],
        retrieval: RetrievalResult | None,
        usage: tuple[int, int],
        cited_indices: list[int] | None = None,
        citation_count: int = 0,
        invalid_citation_count: int = 0,
    ) -> dict[str, object]:
        payload: dict[str, object] = {
            "route": "hybrid",
            "trace_id": trace.trace_id,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "time_to_first_token_ms": first_token_ms,
            "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]},
            "spans": {**trace.summary(), **(retrieval.spans if retrieval else {})},
            "low_confidence": low_confidence,
            "answer_status": answer_status,
            "cited_indices": cited_indices or [],
            "citation_count": citation_count,
            "invalid_citation_count": invalid_citation_count,
            "model": getattr(self._llm, "model", getattr(self._llm, "name", "unknown")),
            "sql_outcome": sql_outcome,
            "hybrid": {"documents": docs_status, "sql": sql_status},
        }
        if retrieval is not None:
            payload["retrieval"] = {
                "best_score": round(retrieval.best_score, 4),
                "candidates": len(retrieval.chunks),
            }
        return payload

    @staticmethod
    def _fallback_answer(execution: object) -> str:
        row_count = int(getattr(execution, "row_count", 0))
        if row_count == 0:
            return "No matching rows were found for that question."
        row_label = "row" if row_count == 1 else "rows"
        return (
            f"The query returned {row_count} {row_label}. "
            "Expand the SQL panel to inspect the exact result."
        )


def _sql_outcome(result: SqlPipelineResult | None) -> dict[str, object]:
    if result is None:
        return {"outcome": "failed"}
    outcome: dict[str, object] = {"outcome": result.outcome}
    if result.execution is not None:
        outcome.update(
            {
                "row_count": result.execution.row_count,
                "truncated": result.execution.truncated,
                "execution_ms": result.execution.execution_ms,
            }
        )
    if result.error:
        outcome["error"] = result.error[:500]
    return outcome
