"""SQL chat service — orchestrates the text-to-SQL pipeline as SSE events.

Event sequence for a successful SQL answer:
  status  {"stage": "routing", ...}
  route   {"route": "sql"}
  status  {"stage": "generating_sql", ...}
  sql     {"sql": "...", "query": "...", "columns": [...], "rows": [...],
           "row_count": N, "truncated": bool, "execution_ms": N}
  status  {"stage": "writing", ...}
  token   {...} (streamed)
  sources {"citations": []}
  done    {route, trace_id, latency_ms, time_to_first_token_ms, sql_outcome, ...}

Clarification questions are streamed as a token with answer_status
"clarification". Unsafe queries are refused with an explicit sql_blocked error
and are never sent to PostgreSQL.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator

from app.core.config import Settings
from app.core.tracing import Trace
from app.ingestion.embeddings import GoogleEmbeddingClient
from app.llm.base import LLMClient, LLMError
from app.models.chat import ChatRequest
from app.rag.rewrite import QueryRewriter
from app.sql.execute import ExecutionResult
from app.sql.pipeline import run_sql_pipeline
from app.sql.synthesize import numeric_post_check, synthesize
from app.tracing.base import TraceExporter

logger = logging.getLogger(__name__)

ChatEvent = tuple[str, dict[str, object]]


class SqlChatService:
    def __init__(
        self,
        settings: Settings,
        *,
        llm: LLMClient,
        embeddings: GoogleEmbeddingClient,
        trace_exporter: TraceExporter | None = None,
    ) -> None:
        self._settings = settings
        self._llm = llm
        self._embeddings = embeddings
        self._rewriter = QueryRewriter(llm)
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
        trace.set_metadata(route="sql")
        trace.add_tag("sql")
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

        yield "status", {"stage": "routing", "message": "Preparing the data query…"}
        if emit_route:
            yield "route", {"route": "sql", "confidence": 1.0, "reason": "explicit mode"}
        yield "status", {"stage": "rewriting", "message": "Understanding the question…"}

        history = [
            {"role": message.role, "content": message.content}
            for message in request.history[-self._settings.chat_history_limit :]
        ]
        try:
            with trace.span("sql_rewrite"):
                question = await self._rewriter.rewrite(request.question.strip(), history)
        except Exception as exc:
            logger.warning("sql rewrite failed; using original question: %s", exc)
            question = request.question.strip()

        yield "status", {"stage": "generating_sql", "message": "Generating a safe SQL query…"}

        result = await run_sql_pipeline(
            question,
            settings=self._settings,
            llm=self._llm,
            embeddings=self._embeddings,
            trace=trace,
        )
        prompt_tokens, completion_tokens = result.usage

        if result.outcome == "generation_failed":
            yield (
                "error",
                {
                    "code": "sql_generation_failed",
                    "message": "I couldn't generate a query for that question. Please try again.",
                },
            )
            return

        if result.outcome == "clarification":
            clarification_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": result.clarification}
            yield "sources", {"citations": []}
            yield (
                "done",
                self._done_payload(
                    trace,
                    started,
                    clarification_token_ms,
                    answer_status="clarification",
                    usage=result.usage,
                    sql_outcome={"outcome": "clarification"},
                ),
            )
            return

        if not result.ok or result.validation is None or result.execution is None:
            code = result.error_code or "sql_failed"
            logger.info(
                "sql pipeline refused trace_id=%s code=%s error=%s",
                trace.trace_id,
                code,
                result.error,
            )
            yield (
                "error",
                {
                    "code": code,
                    "message": (
                        "That request could not be answered with a safe read-only query. "
                        "Please rephrase it."
                        if code == "sql_blocked"
                        else "The generated query could not be executed safely. Please rephrase it."
                    ),
                },
            )
            return

        validation = result.validation
        execution = result.execution
        sql_payload = {
            "sql": validation.sql,
            "query": validation.sql,
            "columns": execution.columns,
            "rows": execution.rows,
            "row_count": execution.row_count,
            "truncated": execution.truncated,
            "execution_ms": execution.execution_ms,
        }
        yield "sql", sql_payload

        yield "status", {"stage": "writing", "message": "Writing the answer from query results…"}
        answer_parts: list[str] = []
        first_token_ms: int | None = None
        try:
            with trace.span("sql_synthesize"):
                async for token in synthesize(
                    question=question,
                    sql=validation.sql,
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
        except LLMError as exc:
            logger.warning("sql_synthesize llm error: %s", exc)
            fallback = self._fallback_answer(execution)
            if first_token_ms is None:
                first_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": fallback}
            answer_parts.append(fallback)
        except Exception as exc:
            logger.exception("sql_synthesize unexpected error: %s", exc)
            fallback = self._fallback_answer(execution)
            if first_token_ms is None:
                first_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": fallback}
            answer_parts.append(fallback)

        answer = "".join(answer_parts)
        trace.set_output(answer)
        trace.set_metadata(
            answer_status="answered",
            row_count=execution.row_count,
            model=getattr(self._llm, "model", getattr(self._llm, "name", "unknown")),
        )
        numeric_check = numeric_post_check(answer, execution.rows)

        yield "sources", {"citations": []}
        yield (
            "done",
            self._done_payload(
                trace,
                started,
                first_token_ms,
                answer_status="answered",
                usage=(prompt_tokens, completion_tokens),
                sql_outcome={
                    "outcome": "success",
                    "row_count": execution.row_count,
                    "truncated": execution.truncated,
                    "execution_ms": execution.execution_ms,
                    "validation": validation.checks,
                    "attempts": len(result.attempts) + 1,
                    "repaired": result.repaired,
                    "numeric_check": numeric_check,
                },
            ),
        )

    def _done_payload(
        self,
        trace: Trace,
        started: float,
        first_token_ms: int | None,
        *,
        answer_status: str,
        usage: tuple[int, int],
        sql_outcome: dict[str, object],
    ) -> dict[str, object]:
        return {
            "route": "sql",
            "trace_id": trace.trace_id,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "time_to_first_token_ms": first_token_ms,
            "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1]},
            "spans": trace.summary(),
            "low_confidence": False,
            "answer_status": answer_status,
            "model": getattr(self._llm, "model", getattr(self._llm, "name", "unknown")),
            "sql_outcome": sql_outcome,
        }

    @staticmethod
    def _fallback_answer(execution: ExecutionResult) -> str:
        if execution.row_count == 0:
            return "No matching rows were found for that question."
        row_label = "row" if execution.row_count == 1 else "rows"
        return (
            f"The query returned {execution.row_count} {row_label}. "
            "Expand the SQL panel to inspect the exact result."
        )
