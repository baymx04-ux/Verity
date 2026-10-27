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
from app.sql.catalog import retrieve_catalog_context, retrieve_few_shots
from app.sql.execute import ExecutionResult
from app.sql.execute import execute as sql_execute
from app.sql.generate import generate_sql
from app.sql.repair import repair_loop
from app.sql.synthesize import numeric_post_check, synthesize
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
        self._rewriter = QueryRewriter(llm)

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatEvent]:
        started = time.perf_counter()
        trace = Trace(request.trace_id) if request.trace_id else Trace()

        yield "status", {"stage": "routing", "message": "Preparing the data query…"}
        yield "route", {"route": "sql"}
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

        try:
            with trace.span("sql_catalog"):
                catalog_context, few_shots = await asyncio.gather(
                    retrieve_catalog_context(question, self._embeddings, self._settings),
                    retrieve_few_shots(question, self._embeddings, top_n=3),
                )
        except Exception as exc:
            logger.warning("sql catalog retrieval failed: %s", exc)
            catalog_context = ""
            few_shots = []

        try:
            with trace.span("sql_generate"):
                generation = await generate_sql(
                    question,
                    llm=self._llm,
                    catalog_context=catalog_context,
                    few_shot_examples=few_shots,
                    reference_date=self._settings.sql_reference_date,
                    temperature=0.0,
                )
        except LLMError as exc:
            logger.warning("sql_generate failed: %s", exc)
            yield "error", {
                "code": "sql_generation_failed",
                "message": "I couldn't generate a query for that question. Please try again.",
            }
            return

        prompt_tokens = generation.prompt_tokens
        completion_tokens = generation.completion_tokens

        if generation.type == "clarification" or not generation.sql:
            answer = (
                generation.clarification.strip()
                or "Could you clarify which metric, date range, or segment you mean?"
            )
            clarification_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": answer}
            yield "sources", {"citations": []}
            yield "done", self._done_payload(
                trace,
                started,
                clarification_token_ms,
                answer_status="clarification",
                usage=(prompt_tokens, completion_tokens),
                sql_outcome={"outcome": "clarification"},
            )
            return

        with trace.span("sql_validate"):
            validation = validate(
                generation.sql,
                display_limit=self._settings.sql_display_limit,
                hard_limit=self._settings.sql_hard_limit,
                max_joins=self._settings.sql_max_joins,
                max_relations=self._settings.sql_max_relations,
                max_subquery_depth=self._settings.sql_max_subquery_depth,
            )

        execution: ExecutionResult | None = None
        attempts: list[object] = []
        repaired = False

        if validation.ok:
            with trace.span("sql_execute"):
                execution = await sql_execute(validation.sql, self._settings)
            if not execution.ok:
                logger.info("sql execution failed; attempting repair: %s", execution.error)
        else:
            logger.info("sql validation failed; attempting repair: %s", validation.error)

        if execution is None or not execution.ok:
            (
                repaired_generation,
                repaired_validation,
                repaired_execution,
                repair_attempts,
                repair_prompt_tokens,
                repair_completion_tokens,
            ) = await repair_loop(
                question=question,
                first_sql=generation.sql,
                first_error=(
                    validation.error
                    if not validation.ok
                    else (execution.error if execution else "")
                ),
                llm=self._llm,
                settings=self._settings,
                catalog_context=catalog_context,
                few_shot_examples=few_shots,
            )
            prompt_tokens += repair_prompt_tokens
            completion_tokens += repair_completion_tokens
            attempts = list(repair_attempts)
            repaired = True

            if (
                repaired_generation is None
                or repaired_validation is None
                or repaired_execution is None
                or not repaired_execution.ok
            ):
                blocked = not validation.ok
                logger.info(
                    "sql pipeline refused trace_id=%s blocked=%s validation=%s",
                    trace.trace_id,
                    blocked,
                    validation.error or (execution.error if execution else ""),
                )
                yield "error", {
                    "code": "sql_blocked" if blocked else "sql_failed",
                    "message": (
                        "That request could not be answered with a safe read-only query. "
                        "Please rephrase it."
                        if blocked
                        else "The generated query could not be executed safely. Please rephrase it."
                    ),
                }
                return

            generation = repaired_generation
            validation = repaired_validation
            execution = repaired_execution

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
        numeric_check = numeric_post_check(answer, execution.rows)

        yield "sources", {"citations": []}
        yield "done", self._done_payload(
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
                "attempts": len(attempts) + 1,
                "repaired": repaired,
                "numeric_check": numeric_check,
            },
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
            "model": getattr(self._llm, "name", "unknown"),
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
