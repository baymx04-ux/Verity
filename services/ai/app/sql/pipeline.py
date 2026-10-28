"""Reusable text-to-SQL pipeline.

This module owns generation, validation, execution, and the bounded repair
loop. Both the explicit SQL chat route and the hybrid route use it so the
read-only safety boundary and repair accounting stay identical.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from app.core.config import Settings
from app.core.tracing import Trace
from app.ingestion.embeddings import GoogleEmbeddingClient
from app.llm.base import LLMClient, LLMError
from app.sql.catalog import retrieve_catalog_context, retrieve_few_shots
from app.sql.execute import ExecutionResult
from app.sql.execute import execute as sql_execute
from app.sql.generate import generate_sql
from app.sql.repair import RepairAttempt, repair_loop
from app.sql.validate import ValidationResult, validate

logger = logging.getLogger(__name__)

Outcome = str  # "success" | "clarification" | "blocked" | "failed" | "generation_failed"


@dataclass
class SqlPipelineResult:
    outcome: Outcome
    sql: str = ""
    validation: ValidationResult | None = None
    execution: ExecutionResult | None = None
    clarification: str = ""
    error: str = ""
    error_code: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    attempts: list[RepairAttempt] = field(default_factory=list)
    repaired: bool = False

    @property
    def ok(self) -> bool:
        return self.outcome == "success" and self.execution is not None and self.execution.ok

    @property
    def usage(self) -> tuple[int, int]:
        return (self.prompt_tokens, self.completion_tokens)


async def run_sql_pipeline(
    question: str,
    *,
    settings: Settings,
    llm: LLMClient,
    embeddings: GoogleEmbeddingClient,
    trace: Trace,
) -> SqlPipelineResult:
    """Run the complete SQL pipeline for an already rewritten question."""

    try:
        with trace.span("sql_catalog"):
            catalog_context, few_shots = await asyncio.gather(
                retrieve_catalog_context(question, embeddings, settings),
                retrieve_few_shots(question, embeddings, top_n=3),
            )
    except Exception as exc:
        logger.warning("sql catalog retrieval failed: %s", exc)
        catalog_context = ""
        few_shots = []

    try:
        with trace.span("sql_generate"):
            generation = await generate_sql(
                question,
                llm=llm,
                catalog_context=catalog_context,
                few_shot_examples=few_shots,
                reference_date=settings.sql_reference_date,
                temperature=0.0,
            )
    except LLMError as exc:
        logger.warning("sql_generate failed: %s", exc)
        return SqlPipelineResult(
            outcome="generation_failed",
            error=str(exc),
            error_code="sql_generation_failed",
        )

    prompt_tokens = generation.prompt_tokens
    completion_tokens = generation.completion_tokens

    if generation.type == "clarification" or not generation.sql:
        clarification = (
            generation.clarification.strip()
            or "Could you clarify which metric, date range, or segment you mean?"
        )
        return SqlPipelineResult(
            outcome="clarification",
            clarification=clarification,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    with trace.span("sql_validate"):
        validation = validate(
            generation.sql,
            display_limit=settings.sql_display_limit,
            hard_limit=settings.sql_hard_limit,
            max_joins=settings.sql_max_joins,
            max_relations=settings.sql_max_relations,
            max_subquery_depth=settings.sql_max_subquery_depth,
        )

    execution: ExecutionResult | None = None
    if validation.ok:
        with trace.span("sql_execute"):
            execution = await sql_execute(validation.sql, settings)
        if not execution.ok:
            logger.info("sql execution failed; attempting repair: %s", execution.error)
    else:
        logger.info("sql validation failed; attempting repair: %s", validation.error)

    if execution is not None and execution.ok:
        return SqlPipelineResult(
            outcome="success",
            sql=validation.sql,
            validation=validation,
            execution=execution,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    with trace.span("sql_repair"):
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
                validation.error if not validation.ok else (execution.error if execution else "")
            ),
            llm=llm,
            settings=settings,
            catalog_context=catalog_context,
            few_shot_examples=few_shots,
        )

    prompt_tokens += repair_prompt_tokens
    completion_tokens += repair_completion_tokens

    if (
        repaired_generation is None
        or repaired_validation is None
        or repaired_execution is None
        or not repaired_execution.ok
    ):
        blocked = not validation.ok
        error = validation.error or (execution.error if execution else "")
        logger.info(
            "sql pipeline refused blocked=%s validation=%s",
            blocked,
            error,
        )
        return SqlPipelineResult(
            outcome="blocked" if blocked else "failed",
            sql=generation.sql,
            validation=validation,
            execution=execution,
            error=error,
            error_code="sql_blocked" if blocked else "sql_failed",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            attempts=list(repair_attempts),
            repaired=True,
        )

    return SqlPipelineResult(
        outcome="success",
        sql=repaired_validation.sql,
        validation=repaired_validation,
        execution=repaired_execution,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        attempts=list(repair_attempts),
        repaired=True,
    )
