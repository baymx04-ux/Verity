"""SQL validator — AST-level safety checks before query execution.

Enforces:
  - sqlglot can parse the SQL (dialect=postgres)
  - Single statement only
  - SELECT or CTE (WITH … SELECT) only — no DML, DDL, or CALL
  - No denied statements (COPY, EXPLAIN ANALYZE execute, etc.)
  - All relation references must be in the allowlist (business_ro views)
  - No denied functions (pg_sleep, lo_import, pg_read_file, …)
  - No cross-joins without an explicit ON/USING condition
  - Complexity caps: max joins, max subquery depth, max relations
  - LIMIT injection: if missing, inject LIMIT cap; if > cap, replace
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import sqlglot
import sqlglot.expressions as exp

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# The only relations the SQL executor is allowed to touch.
ALLOWED_RELATIONS: frozenset[str] = frozenset(
    {
        "business_ro.v_products",
        "business_ro.v_customers",
        "business_ro.v_orders",
        "business_ro.v_order_items",
        "business_ro.v_returns",
        "business_ro.v_support_tickets",
        "business_ro.v_employees",
    }
)

# Functions that must never appear in generated SQL.
DENIED_FUNCTIONS: frozenset[str] = frozenset(
    {
        "pg_sleep",
        "pg_sleep_for",
        "pg_sleep_until",
        "pg_read_file",
        "pg_read_binary_file",
        "pg_ls_dir",
        "lo_import",
        "lo_export",
        "pg_terminate_backend",
        "pg_cancel_backend",
        "dblink",
        "dblink_exec",
        "copy",
        "pg_execute",
    }
)

# Statement node types that are categorically denied.
_DENIED_NODE_TYPES = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Create,
    exp.Drop,
    exp.AlterTable,
    exp.Transaction,
    exp.Commit,
    exp.Rollback,
    exp.Grant,
    exp.Revoke,
    exp.Command,  # catches COPY, VACUUM, TRUNCATE, etc.
)

# Complexity limits (per plan §4.3 D11)
MAX_JOINS = 5
MAX_RELATIONS = 8
MAX_SUBQUERY_DEPTH = 3
DISPLAY_LIMIT = 200
HARD_LIMIT = 1000


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class ValidationResult:
    ok: bool
    sql: str = ""  # rewritten SQL (with LIMIT injected if needed)
    error: str = ""
    checks: dict[str, bool] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate(raw_sql: str) -> ValidationResult:
    """Validate and rewrite *raw_sql*.

    Returns a :class:`ValidationResult`.  If ``ok`` is True, ``sql`` is the
    safe, rewritten query ready for the executor.  If ``ok`` is False,
    ``error`` describes the first violation found.
    """
    checks: dict[str, bool] = {}

    # 1. Parse
    try:
        statements = sqlglot.parse(raw_sql.strip(), dialect="postgres")
    except sqlglot.errors.ParseError as exc:
        return ValidationResult(ok=False, error=f"SQL parse error: {exc}", checks={"parse": False})

    checks["parse"] = True

    # 2. Single statement
    if len(statements) != 1 or statements[0] is None:
        return ValidationResult(
            ok=False,
            error=f"Expected exactly 1 SQL statement, got {len(statements)}.",
            checks={**checks, "single_statement": False},
        )

    stmt = statements[0]
    checks["single_statement"] = True

    # 3. SELECT / CTE only
    is_select = isinstance(stmt, (exp.Select, exp.Union))
    is_cte = isinstance(stmt, exp.With) and isinstance(stmt.this, (exp.Select, exp.Union))
    if not (is_select or is_cte):
        kind = type(stmt).__name__
        return ValidationResult(
            ok=False,
            error=f"Only SELECT and CTE (WITH … SELECT) are allowed. Got: {kind}.",
            checks={**checks, "select_only": False},
        )

    checks["select_only"] = True

    # 4. Denied statement node types anywhere in the tree
    for denied_type in _DENIED_NODE_TYPES:
        node = stmt.find(denied_type)
        if node is not None:
            return ValidationResult(
                ok=False,
                error=f"Denied statement type: {type(node).__name__}.",
                checks={**checks, "no_denied_statements": False},
            )

    checks["no_denied_statements"] = True

    # 5. Relation allowlist
    relations = _collect_relations(stmt)
    denied_rels = relations - ALLOWED_RELATIONS
    if denied_rels:
        return ValidationResult(
            ok=False,
            error=f"Query references disallowed relations: {sorted(denied_rels)}. "
            f"Only {sorted(ALLOWED_RELATIONS)} are permitted.",
            checks={**checks, "relation_allowlist": False},
        )

    checks["relation_allowlist"] = True

    # 6. Function deny list
    denied_fns = _collect_denied_functions(stmt)
    if denied_fns:
        return ValidationResult(
            ok=False,
            error=f"Query uses denied functions: {sorted(denied_fns)}.",
            checks={**checks, "function_denylist": False},
        )

    checks["function_denylist"] = True

    # 7. Cross-join check
    if _has_implicit_cross_join(stmt):
        return ValidationResult(
            ok=False,
            error="Implicit cross-join detected (FROM a, b without WHERE clause). "
            "Use explicit JOIN … ON … instead.",
            checks={**checks, "no_cross_join": False},
        )

    checks["no_cross_join"] = True

    # 8. Complexity caps
    join_count = _count_joins(stmt)
    if join_count > MAX_JOINS:
        return ValidationResult(
            ok=False,
            error=f"Query has {join_count} joins; maximum is {MAX_JOINS}.",
            checks={**checks, "join_limit": False},
        )

    checks["join_limit"] = True

    relation_count = len(relations)
    if relation_count > MAX_RELATIONS:
        return ValidationResult(
            ok=False,
            error=f"Query references {relation_count} relations; maximum is {MAX_RELATIONS}.",
            checks={**checks, "relation_limit": False},
        )

    checks["relation_limit"] = True

    depth = _subquery_depth(stmt)
    if depth > MAX_SUBQUERY_DEPTH:
        return ValidationResult(
            ok=False,
            error=f"Subquery depth is {depth}; maximum is {MAX_SUBQUERY_DEPTH}.",
            checks={**checks, "subquery_depth": False},
        )

    checks["subquery_depth"] = True

    # 9. LIMIT injection / cap
    rewritten, limit_injected = _enforce_limit(stmt)
    checks["limit_enforced"] = True

    safe_sql = rewritten.sql(dialect="postgres", pretty=False)
    logger.debug(
        "sql_validator checks=%s limit_injected=%s",
        {k: v for k, v in checks.items() if not v},
        limit_injected,
    )
    return ValidationResult(ok=True, sql=safe_sql, checks=checks)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _qualify_relation(table: exp.Table) -> str:
    """Return 'schema.table' for a Table node, lowercased."""
    db = (table.db or "").lower()
    name = (table.name or "").lower()
    return f"{db}.{name}" if db else name


def _collect_relations(node: exp.Expression) -> set[str]:
    """Collect all relation names referenced in FROM / JOIN clauses."""
    relations: set[str] = set()
    for table in node.find_all(exp.Table):
        # Skip subquery aliases (they have no real table name)
        if table.name:
            relations.add(_qualify_relation(table))
    return relations


def _collect_denied_functions(node: exp.Expression) -> set[str]:
    denied: set[str] = set()
    for fn in node.find_all(exp.Anonymous, exp.Func):
        name = ""
        if isinstance(fn, exp.Anonymous):
            name = (fn.name or "").lower()
        elif hasattr(fn, "sql_name"):
            name = fn.sql_name().lower()
        if name in DENIED_FUNCTIONS:
            denied.add(name)
    return denied


def _has_implicit_cross_join(node: exp.Expression) -> bool:
    """Detect comma-separated tables in FROM with no join condition."""
    for select in node.find_all(exp.Select):
        froms = select.args.get("from")
        if froms is None:
            continue
        # sqlglot represents comma-separated tables as multiple From nodes or
        # as Join nodes with kind=CROSS and no ON/USING.
        joins = select.args.get("joins") or []
        for j in joins:
            if isinstance(j, exp.Join):
                kind = (j.args.get("kind") or "").upper()
                if kind == "CROSS" and j.args.get("on") is None and j.args.get("using") is None:
                    return True
    return False


def _count_joins(node: exp.Expression) -> int:
    return sum(1 for _ in node.find_all(exp.Join))


def _subquery_depth(node: exp.Expression, current: int = 0) -> int:
    max_depth = current
    for child in node.args.values():
        if child is None:
            continue
        nodes = child if isinstance(child, list) else [child]
        for n in nodes:
            if isinstance(n, exp.Expression):
                if isinstance(n, exp.Subquery):
                    depth = _subquery_depth(n, current + 1)
                else:
                    depth = _subquery_depth(n, current)
                max_depth = max(max_depth, depth)
    return max_depth


def _enforce_limit(stmt: exp.Expression) -> tuple[exp.Expression, bool]:
    """Inject or cap the outermost LIMIT to DISPLAY_LIMIT (200).

    Returns (rewritten_statement, was_limit_injected_or_capped).
    """
    # Find the outermost SELECT / UNION (not inside a subquery)
    outer: exp.Select | exp.Union | None = None
    if isinstance(stmt, (exp.Select, exp.Union)):
        outer = stmt
    elif isinstance(stmt, exp.With):
        body = stmt.this
        if isinstance(body, (exp.Select, exp.Union)):
            outer = body

    if outer is None:
        return stmt, False

    existing_limit = outer.args.get("limit")
    injected = False

    if existing_limit is None:
        # No LIMIT — inject display cap
        outer = outer.limit(DISPLAY_LIMIT)
        injected = True
    else:
        # Has a LIMIT — ensure it doesn't exceed hard cap
        try:
            limit_val = int(str(existing_limit.this))
            if limit_val > HARD_LIMIT:
                outer = outer.limit(DISPLAY_LIMIT)
                injected = True
        except (ValueError, AttributeError):
            # Can't parse the limit expression; inject safe value
            outer = outer.limit(DISPLAY_LIMIT)
            injected = True

    if isinstance(stmt, exp.With):
        stmt.set("this", outer)
        return stmt, injected

    return outer, injected
