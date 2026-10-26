"""SQL repair loop — re-generates SQL when the executor returns an error.

After a failed execution the LLM is given the original question, the failed
SQL, and the error message, and asked to produce a corrected query.
Maximum MAX_REPAIRS attempts (plan D11: 2).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.llm.base import LLMClient, LLMError
from app.sql.execute import ExecutionResult
from app.sql.generate import GenerationResult, generate_sql
from app.sql.validate import ValidationResult, validate

logger = logging.getLogger(__name__)

MAX_REPAIRS = 2

_REPAIR_PREFIX = (
    "The SQL query you generated previously failed validation or execution.\n"
    "Original question: {question}\n\n"
    "Failed SQL:\n```sql\n{sql}\n```\n\n"
    "Error: {error}\n\n"
    "Please generate a corrected SQL query."
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
    catalog_context: str = "",
    few_shot_examples: list[dict[str, str]] | None = None,
    settings: object,  # Settings passed through to executor
) -> tuple[GenerationResult | None, ValidationResult | None, ExecutionResult | None, list[RepairAttempt]]:
    """Attempt up to MAX_REPAIRS times to produce a working SQL query.

    Returns (generation, validation, execution, attempts) for the first
    successful attempt, or the last failing attempt if all repairs fail.
    """
    from app.sql.execute import execute as sql_execute  # local import to avoid cycles

    attempts: list[RepairAttempt] = []
    current_sql = first_sql
    current_error = first_error

    for attempt_num in range(1, MAX_REPAIRS + 1):
        repair_question = _REPAIR_PREFIX.format(
            question=question,
            sql=current_sql,
            error=current_error,
        )

        try:
            gen = await generate_sql(
                repair_question,
                llm=llm,
                catalog_context=catalog_context,
                few_shot_examples=few_shot_examples,
            )
        except LLMError as exc:
            logger.warning("sql_repair attempt %d llm error: %s", attempt_num, exc)
            break

        if gen.type != "sql" or not gen.sql:
            logger.info("sql_repair attempt %d returned clarification; stopping", attempt_num)
            break

        val = validate(gen.sql)
        attempt = RepairAttempt(attempt=attempt_num, sql=gen.sql, validation=val)
        attempts.append(attempt)

        if not val.ok:
            logger.info(
                "sql_repair attempt %d validation failed: %s",
                attempt_num,
                val.error,
            )
            current_sql = gen.sql
            current_error = val.error
            continue

        exec_result = await sql_execute(val.sql, settings)  # type: ignore[arg-type]
        attempt.execution = exec_result

        if exec_result.ok:
            logger.info("sql_repair attempt %d succeeded", attempt_num)
            return gen, val, exec_result, attempts

        current_sql = val.sql
        current_error = exec_result.error
        logger.info(
            "sql_repair attempt %d execution failed: %s",
            attempt_num,
            exec_result.error,
        )

    return None, None, None, attempts
