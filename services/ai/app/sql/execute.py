"""SQL executor — runs validated SQL against the read-only business_ro pool.

Design:
  - Uses a separate psycopg connection with the verity_sql_ro role.
  - The role already has default_transaction_read_only=on and statement_timeout=5s
    set in postgres init; we add an explicit transaction-level guard as defence in depth.
  - Returns up to HARD_LIMIT rows; flags truncation if result was capped.
  - Never re-raises; returns an ExecutionError result instead.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from urllib.parse import quote

import psycopg
from psycopg.rows import dict_row

from app.core.config import Settings

logger = logging.getLogger(__name__)

# Row caps (plan D11)
DISPLAY_LIMIT = 200
HARD_LIMIT = 1000


@dataclass
class ExecutionResult:
    ok: bool
    rows: list[dict[str, object]] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    execution_ms: int = 0
    error: str = ""
    error_code: str = ""  # e.g. "timeout", "syntax", "permission", "unknown"


def _build_ro_dsn(settings: Settings) -> str:
    user = quote(settings.sql_ro_user, safe="")
    password = quote(settings.sql_ro_password.get_secret_value(), safe="")
    return (
        f"postgresql://{user}:{password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_db}"
    )


async def execute(sql: str, settings: Settings) -> ExecutionResult:
    """Execute *sql* (already validated + LIMIT-injected) and return rows."""
    started = time.perf_counter()
    dsn = _build_ro_dsn(settings)

    try:
        async with await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row) as conn:
            # Defence-in-depth: explicit read-only transaction even though the role
            # has default_transaction_read_only=on.
            async with conn.transaction():
                await conn.execute("SET TRANSACTION READ ONLY")
                async with conn.cursor() as cur:
                    await cur.execute(sql)
                    # Fetch up to HARD_LIMIT+1 to detect truncation
                    raw = await cur.fetchmany(HARD_LIMIT + 1)
                    truncated = len(raw) > HARD_LIMIT
                    rows = raw[:HARD_LIMIT]
                    # Convert to plain dicts with string-safe values
                    rows_clean = [_clean_row(r) for r in rows]
                    columns = [desc.name for desc in (cur.description or [])]

    except psycopg.errors.QueryCanceled:
        ms = int((time.perf_counter() - started) * 1000)
        logger.warning("sql_executor timeout sql_snippet=%s...", sql[:120])
        return ExecutionResult(
            ok=False,
            execution_ms=ms,
            error="Query exceeded the 5-second time limit.",
            error_code="timeout",
        )
    except psycopg.errors.InsufficientPrivilege as exc:
        ms = int((time.perf_counter() - started) * 1000)
        logger.warning("sql_executor permission error: %s", exc)
        return ExecutionResult(
            ok=False,
            execution_ms=ms,
            error="Permission denied. The query references disallowed objects.",
            error_code="permission",
        )
    except psycopg.errors.ReadOnlySqlTransaction as exc:
        ms = int((time.perf_counter() - started) * 1000)
        logger.warning("sql_executor read_only violation: %s", exc)
        return ExecutionResult(
            ok=False,
            execution_ms=ms,
            error="Write operations are not permitted.",
            error_code="read_only_violation",
        )
    except psycopg.Error as exc:
        ms = int((time.perf_counter() - started) * 1000)
        logger.warning("sql_executor postgres error: %s", exc)
        return ExecutionResult(
            ok=False,
            execution_ms=ms,
            error=f"Database error: {_sanitize_pg_error(str(exc))}",
            error_code="postgres_error",
        )
    except Exception as exc:
        ms = int((time.perf_counter() - started) * 1000)
        logger.exception("sql_executor unexpected error: %s", exc)
        return ExecutionResult(
            ok=False,
            execution_ms=ms,
            error="An unexpected error occurred while running the query.",
            error_code="unknown",
        )

    ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "sql_executor ok rows=%d truncated=%s execution_ms=%d",
        len(rows_clean),
        truncated,
        ms,
    )
    return ExecutionResult(
        ok=True,
        rows=rows_clean,
        columns=columns,
        row_count=len(rows_clean),
        truncated=truncated,
        execution_ms=ms,
    )


def _clean_row(row: dict[str, object]) -> dict[str, object]:
    """Convert non-JSON-serializable types to safe representations."""
    import datetime
    import decimal

    clean: dict[str, object] = {}
    for k, v in row.items():
        if v is None:
            clean[k] = None
        elif isinstance(v, (int, float, bool, str)):
            clean[k] = v
        elif isinstance(v, decimal.Decimal):
            clean[k] = float(v)
        elif isinstance(v, (datetime.datetime, datetime.date)):
            clean[k] = v.isoformat()
        else:
            clean[k] = str(v)
    return clean


def _sanitize_pg_error(msg: str) -> str:
    """Strip potentially sensitive internal details from PG error messages."""
    # Keep only the first line (the error summary); strip DETAIL/HINT lines.
    return msg.split("\n")[0][:300]
