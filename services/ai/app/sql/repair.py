"""SQL repair loop — re-generates SQL after validation or execution failure.

The LLM receives the original question, the failed SQL, and the sanitized error
message. At most ``SQL_MAX_REPAIRS`` attempts are made (default 2). Every
generated query is validated again before it can reach the database.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.config import Settings
from app.llm.base import LLMClient, LLMError
from app.sql.execute import ExecutionResult
from app.sql.execute import execute as sql_execute
from app.sql.generate import GenerationResult, generate_sql
from app.sql.validate import ValidationResult, validate

logger = logging.getLogger(__name__)

_REPAIR_PREFIX = (
    "The SQL query you generated previously failed validation or execution.\n"
    "Original question: {question}\n\n"
    "Failed SQL:\n```sql\n{sql}\n```\n\n"
    "Error: {error}\n\n"
    "Generate a corrected, safe SELECT query. Return only the JSON object."
)


@dataclass
class RepairAttempt:
    attempt: int
    sql: str
    validation: ValidationResult
    execution: ExecutionResult | None = None


async def repair_loop(
    *,
    question: str,
    first_sql: str,
    first_error: str,
    llm: LLMClient,
    settings: Settings,
    catalog_context: str = "",
    few_shot_examples: list[dict[str, str]] | None = None,
) -> tuple[
    GenerationResult | None,
    ValidationResult | None,
    ExecutionResult | None,
    list[RepairAttempt],
    int,
    int,
]:
    """Attempt to repair a failing query.

    Returns ``(generation, validation, execution, attempts, prompt_tokens,
    completion_tokens)``. The first three values are the first successful
    attempt, or ``None`` when every repair fails.
    """
    attempts: list[RepairAttempt] = []
    current_sql = first_sql
    current_error = first_error
    prompt_tokens = 0
    completion_tokens = 0

    for attempt_number in range(1, max(1, settings.sql_max_repairs) + 1):
        repair_question = _REPAIR_PREFIX.format(
            question=question,
            sql=current_sql,
            error=current_error,
        )

        try:
            generation = await generate_sql(
                repair_question,
                llm=llm,
                catalog_context=catalog_context,
                few_shot_examples=few_shot_examples,
                reference_date=settings.sql_reference_date,
            )
        except LLMError as exc:
            logger.warning("sql_repair attempt %d llm error: %s", attempt_number, exc)
            break

        prompt_tokens += generation.prompt_tokens
        completion_tokens += generation.completion_tokens

        if generation.type != "sql" or not generation.sql:
            logger.info("sql_repair attempt %d returned clarification; stopping", attempt_number)
            break

        validation = validate(
            generation.sql,
            display_limit=settings.sql_display_limit,
            hard_limit=settings.sql_hard_limit,
            max_joins=settings.sql_max_joins,
            max_relations=settings.sql_max_relations,
            max_subquery_depth=settings.sql_max_subquery_depth,
        )
        attempt = RepairAttempt(
            attempt=attempt_number,
            sql=generation.sql,
            validation=validation,
        )
        attempts.append(attempt)

        if not validation.ok:
            logger.info(
                "sql_repair attempt %d validation failed: %s",
                attempt_number,
                validation.error,
            )
            current_sql = generation.sql
            current_error = validation.error
            continue

        execution = await sql_execute(validation.sql, settings)
        attempt.execution = execution

        if execution.ok:
            logger.info("sql_repair attempt %d succeeded", attempt_number)
            return (
                generation,
                validation,
                execution,
                attempts,
                prompt_tokens,
                completion_tokens,
            )

        current_sql = validation.sql
        current_error = execution.error
        logger.info(
            "sql_repair attempt %d execution failed: %s",
            attempt_number,
            execution.error,
        )

    return None, None, None, attempts, prompt_tokens, completion_tokens
