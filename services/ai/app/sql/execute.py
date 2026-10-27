"""SQL executor — runs validated SQL against the read-only business_ro role.

The SQL role has ``default_transaction_read_only=on`` and a five-second
statement timeout. This module adds an explicit read-only transaction and a
transaction-local timeout as defence in depth, then trims the returned rows to
the display cap while reporting whether more rows were available.
"""

from __future__ import annotations

import datetime
import decimal
import logging
import time
from dataclasses import dataclass, field

import psycopg
from psycopg.rows import dict_row

from app.core.config import Settings

logger = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    ok: bool
    rows: list[dict[str, object]] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    execution_ms: int = 0
    error: str = ""
    error_code: str = ""  # e.g. "timeout", "permission", "read_only_violation"


async def execute(sql: str, settings: Settings) -> ExecutionResult:
    """Execute *sql* (already validated and LIMIT-bounded) and return rows."""
    started = time.perf_counter()

    try:
        async with await psycopg.AsyncConnection.connect(
            settings.sql_database_url, row_factory=dict_row
        ) as conn:
            async with conn.transaction():
                await conn.execute("SET TRANSACTION READ ONLY")
                await conn.execute(
                    f"SET LOCAL statement_timeout = '{max(1, settings.sql_timeout_ms)}ms'"
                )
                async with conn.cursor() as cur:
                    await cur.execute(sql)
                    raw_rows = await cur.fetchmany(settings.sql_hard_limit + 1)
                    columns = [description.name for description in (cur.description or [])]
    except psycopg.errors.QueryCanceled:
        return _failure(started, "Query exceeded the statement time limit.", "timeout")
    except psycopg.errors.InsufficientPrivilege as exc:
        logger.warning("sql_executor permission error: %s", exc)
        return _failure(
            started,
            "Permission denied. The query references disallowed objects.",
            "permission",
        )
    except psycopg.errors.ReadOnlySqlTransaction as exc:
        logger.warning("sql_executor read-only violation: %s", exc)
        return _failure(started, "Write operations are not permitted.", "read_only_violation")
    except psycopg.Error as exc:
        logger.warning("sql_executor postgres error: %s", exc)
        return _failure(
            started,
            f"Database error: {_sanitize_pg_error(str(exc))}",
            "postgres_error",
        )
    except Exception as exc:
        logger.exception("sql_executor unexpected error: %s", exc)
        return _failure(
            started,
            "An unexpected error occurred while running the query.",
            "unknown",
        )

    rows = [_clean_row(row) for row in raw_rows[: settings.sql_display_limit]]
    truncated = len(raw_rows) > settings.sql_display_limit
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "sql_executor ok rows=%d truncated=%s execution_ms=%d",
        len(rows),
        truncated,
        elapsed_ms,
    )
    return ExecutionResult(
        ok=True,
        rows=rows,
        columns=columns,
        row_count=len(rows),
        truncated=truncated,
        execution_ms=elapsed_ms,
    )


def _failure(started: float, message: str, code: str) -> ExecutionResult:
    return ExecutionResult(
        ok=False,
        execution_ms=int((time.perf_counter() - started) * 1000),
        error=message,
        error_code=code,
    )


def _clean_row(row: dict[str, object]) -> dict[str, object]:
    """Convert values that psycopg's JSON encoder cannot represent."""
    clean: dict[str, object] = {}
    for key, value in row.items():
        if value is None or isinstance(value, int | float | bool | str):
            clean[key] = value
        elif isinstance(value, decimal.Decimal):
            clean[key] = float(value)
        elif isinstance(value, datetime.date | datetime.datetime):
            clean[key] = value.isoformat()
        else:
            clean[key] = str(value)
    return clean


def _sanitize_pg_error(message: str) -> str:
    """Keep only the first line of a PostgreSQL error message."""
    return message.split("\n")[0][:300]
