"""SQL chat service — orchestrates the full text-to-SQL pipeline as SSE events.

Event sequence for a successful SQL answer:
  status  {"stage": "routing", "message": "Identifying the right data source…"}
  route   {"route": "sql"}
  status  {"stage": "generating_sql", "message": "Generating SQL query…"}
  sql     {"sql": "<safe_sql>", "columns": […], "rows": […], "row_count": N,
           "truncated": bool, "execution_ms": N}
  status  {"stage": "writing", "message": "Writing answer…"}
  token   {"text": "…"}  (streamed)
  sources {"citations": []}
  done    {route, trace_id, latency_ms, time_to_first_token_ms, …}

For clarification:
  route   {"route": "sql"}
  token   {"text": "<clarification question>"}
  sources {"citations": []}
  done    {…, "answer_status": "clarification"}

For validation/execution failure after max repairs:
  error   {"code": "sql_blocked"|"sql_failed", "message": "…"}
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
from app.sql.catalog import retrieve_catalog_context, retrieve_few_shots
from app.sql.execute import execute as sql_execute
from app.sql.generate import generate_sql
from app.sql.repair import repair_loop
from app.sql.synthesize import synthesize
from app.sql.validate import validate

logger = logging.getLogger(__name__)

ChatEvent = tuple[str, dict[str, object]]


class SqlChatService:
    def __init__(
        self,
        settings: Settings,
        *,
        llm: LLMClient,
        embeddings: GoogleEmbeddingClient,
    ) -> None:
        self._settings = settings
        self._llm = llm
        self._embeddings = embeddings

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatEvent]:
        started = time.perf_counter()
        first_token_ms: int | None = None
        trace = Trace(request.trace_id) if request.trace_id else Trace()
        question = request.question.strip()

        yield "status", {"stage": "routing", "message": "Identifying the right data source…"}
        yield "route", {"route": "sql"}
        yield "status", {"stage": "generating_sql", "message": "Generating SQL query…"}

        # Retrieve catalog context and few-shots in parallel
        try:
            with trace.span("sql_catalog"):
                catalog_ctx, few_shots = await asyncio.gather(
                    retrieve_catalog_context(question, self._embeddings, self._settings),
                    retrieve_few_shots(question, self._embeddings, top_n=3),
                )
        except Exception as exc:
            logger.warning("sql_catalog retrieval failed: %s", exc)
            catalog_ctx = ""
            few_shots = []

        # Generate SQL
        try:
            with trace.span("sql_generate"):
                gen = await generate_sql(
                    question,
                    llm=self._llm,
                    catalog_context=catalog_ctx,
                    few_shot_examples=few_shots,
                    temperature=0.0,
                )
        except LLMError as exc:
            logger.warning("sql_generate failed: %s", exc)
            yield "error", {
                "code": "sql_generation_failed",
                "message": "I couldn't generate a query for that question. Please try again.",
            }
            return

        # Clarification path
        if gen.type == "clarification":
            first_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": gen.clarification}
            yield "sources", {"citations": []}
            yield "done", self._done_payload(
                trace,
                started,
                first_token_ms,
                answer_status="clarification",
            )
            return

        # Validate
        with trace.span("sql_validate"):
            val = validate(gen.sql)

        if not val.ok:
            logger.info("sql_validate failed (attempting repair): %s", val.error)
            repaired_gen, repaired_val, repaired_exec, attempts = await repair_loop(
                question=question,
                first_sql=gen.sql,
                first_error=val.error,
                llm=self._llm,
                catalog_context=catalog_ctx,
                few_shot_examples=few_shots,
                settings=self._settings,
            )
            if repaired_exec is None or not repaired_exec.ok:
                yield "error", {
                    "code": "sql_blocked",
                    "message": "The generated query didn't pass safety checks. Please rephrase your question.",
                }
                return
            val = repaired_val  # type: ignore[assignment]
            exec_result = repaired_exec
        else:
            # Execute
            with trace.span("sql_execute"):
                exec_result = await sql_execute(val.sql, self._settings)

            if not exec_result.ok:
                logger.info("sql_execute failed (attempting repair): %s", exec_result.error)
                repaired_gen, repaired_val, repaired_exec, attempts = await repair_loop(
                    question=question,
                    first_sql=val.sql,
                    first_error=exec_result.error,
                    llm=self._llm,
                    catalog_context=catalog_ctx,
                    few_shot_examples=few_shots,
                    settings=self._settings,
                )
                if repaired_exec is None or not repaired_exec.ok:
                    yield "error", {
                        "code": "sql_failed",
                        "message": f"The query couldn't be executed: {exec_result.error}",
                    }
                    return
                val = repaired_val  # type: ignore[assignment]
                exec_result = repaired_exec

        # Emit sql event with result payload
        yield "sql", {
            "sql": val.sql,
            "columns": exec_result.columns,
            "rows": exec_result.rows,
            "row_count": exec_result.row_count,
            "truncated": exec_result.truncated,
            "execution_ms": exec_result.execution_ms,
        }

        # Synthesize answer
        yield "status", {"stage": "writing", "message": "Writing answer from query results…"}

        try:
            with trace.span("sql_synthesize"):
                async for token_text in synthesize(
                    question=question,
                    sql=val.sql,
                    rows=exec_result.rows,
                    truncated=exec_result.truncated,
                    llm=self._llm,
                    temperature=self._settings.llm_temperature,
                    max_tokens=self._settings.llm_max_output_tokens,
                ):
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    yield "token", {"text": token_text}
        except asyncio.CancelledError:
            raise
        except LLMError as exc:
            logger.warning("sql_synthesize llm error: %s", exc)
            yield "error", {
                "code": "generation_failed",
                "message": "The answer model is unavailable. The query result is shown above.",
            }
            return
        except Exception as exc:
            logger.exception("sql_synthesize unexpected error: %s", exc)
            yield "error", {
                "code": "generation_failed",
                "message": "Answer synthesis failed. The query result is shown above.",
            }
            return

        yield "sources", {"citations": []}
        yield "done", self._done_payload(
            trace,
            started,
            first_token_ms,
            answer_status="answered",
            sql_outcome={
                "row_count": exec_result.row_count,
                "truncated": exec_result.truncated,
                "execution_ms": exec_result.execution_ms,
                "validation_checks": val.checks if val else {},
            },
        )

    def _done_payload(
        self,
        trace: Trace,
        started: float,
        first_token_ms: int | None,
        *,
        answer_status: str,
        sql_outcome: dict[str, object] | None = None,
    ) -> dict[str, object]:
        payload: dict[str, object] = {
            "route": "sql",
            "trace_id": trace.trace_id,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "time_to_first_token_ms": first_token_ms,
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
            "spans": trace.summary(),
            "low_confidence": False,
            "answer_status": answer_status,
            "model": getattr(self._llm, "name", "unknown"),
        }
        if sql_outcome:
            payload["sql_outcome"] = sql_outcome
        return payload
