"""SQL validator — AST-level safety checks before query execution.

Enforces, in order:
  - sqlglot parses the SQL as PostgreSQL
  - exactly one statement
  - a read-only SELECT (including CTEs and set operations built from SELECTs)
  - no DML, DDL, transaction, COPY, or other command nodes anywhere
  - only allowlisted ``business_ro`` views
  - no denied or schema-qualified system functions
  - no comma/CROSS joins without a condition
  - bounded joins, relations, and subquery depth
  - a LIMIT on the outermost query, capped at the hard row limit
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import sqlglot
import sqlglot.expressions as exp

logger = logging.getLogger(__name__)

# The only relations the SQL executor is allowed to touch. Unqualified view
# names are accepted and rewritten conceptually to business_ro.<name>.
ALLOWED_RELATIONS: frozenset[str] = frozenset(
    {
        "business_ro.v_regions",
        "business_ro.v_products",
        "business_ro.v_customers",
        "business_ro.v_orders",
        "business_ro.v_order_items",
        "business_ro.v_returns",
        "business_ro.v_support_tickets",
        "business_ro.v_employees",
        "business_ro.v_revenue_daily",
        "business_ro.v_revenue_monthly",
        "business_ro.v_product_performance",
    }
)

# Functions that must never appear in generated SQL. Schema-qualified calls to
# pg_catalog, information_schema, and file/network helpers are also rejected
# below, so this list is the first line of defence rather than the only one.
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
        "pg_reload_conf",
        "pg_rotate_logfile",
        "dblink",
        "dblink_exec",
        "set_config",
        "copy",
        "pg_execute",
        "query_to_xml",
        "xpath",
    }
)

# Statement node types that are categorically denied. sqlglot versions differ
# slightly in their node names, so look them up defensively.
_DENIED_NODE_NAMES = (
    "Insert",
    "Update",
    "Delete",
    "Merge",
    "Create",
    "Drop",
    "Alter",
    "Transaction",
    "Commit",
    "Rollback",
    "Grant",
    "Revoke",
    "Copy",
    "Command",
    "TruncateTable",
    "Use",
    "Set",
    "Into",
)
_DENIED_NODE_TYPES: tuple[type[exp.Expression], ...] = tuple(
    node_type
    for name in _DENIED_NODE_NAMES
    if (node_type := getattr(exp, name, None)) is not None
)

# Complexity limits (plan §4.3 D11) used when the caller does not pass settings.
MAX_JOINS = 5
MAX_RELATIONS = 8
MAX_SUBQUERY_DEPTH = 3
DISPLAY_LIMIT = 200
HARD_LIMIT = 1000


@dataclass
class ValidationResult:
    ok: bool
    sql: str = ""  # rewritten SQL (with LIMIT injected/capped)
    error: str = ""
    checks: dict[str, bool] = field(default_factory=dict)


def validate(
    raw_sql: str,
    *,
    display_limit: int = DISPLAY_LIMIT,
    hard_limit: int = HARD_LIMIT,
    max_joins: int = MAX_JOINS,
    max_relations: int = MAX_RELATIONS,
    max_subquery_depth: int = MAX_SUBQUERY_DEPTH,
) -> ValidationResult:
    """Validate and rewrite *raw_sql* into a safe, bounded SELECT."""
    checks: dict[str, bool] = {}
    display_limit = max(1, display_limit)
    hard_limit = max(display_limit, hard_limit)

    try:
        statements = [
            statement
            for statement in sqlglot.parse(raw_sql.strip(), dialect="postgres")
            if statement is not None
        ]
    except sqlglot.errors.ParseError as exc:
        return ValidationResult(ok=False, error=f"SQL parse error: {exc}", checks={"parse": False})

    checks["parse"] = True

    if len(statements) != 1:
        return ValidationResult(
            ok=False,
            error=f"Expected exactly 1 SQL statement, got {len(statements)}.",
            checks={**checks, "single_statement": False},
        )

    statement = statements[0]
    checks["single_statement"] = True

    if not _is_read_only_query(statement):
        return ValidationResult(
            ok=False,
            error=(
                "Only SELECT and WITH … SELECT statements are allowed. "
                f"Got: {type(statement).__name__}."
            ),
            checks={**checks, "select_only": False},
        )

    checks["select_only"] = True

    for denied_type in _DENIED_NODE_TYPES:
        node = statement.find(denied_type)
        if node is not None:
            return ValidationResult(
                ok=False,
                error=f"Denied statement/expression type: {type(node).__name__}.",
                checks={**checks, "no_denied_statements": False},
            )

    checks["no_denied_statements"] = True

    cte_names = {cte.alias_or_name.lower() for cte in statement.find_all(exp.CTE)}
    relations = _collect_relations(statement, cte_names)
    denied_relations = relations - ALLOWED_RELATIONS
    if denied_relations:
        return ValidationResult(
            ok=False,
            error=(
                "Query references disallowed relations: "
                f"{sorted(denied_relations)}. Only business_ro views are permitted."
            ),
            checks={**checks, "relation_allowlist": False},
        )

    checks["relation_allowlist"] = True

    denied_functions = _collect_denied_functions(statement)
    if denied_functions:
        return ValidationResult(
            ok=False,
            error=f"Query uses denied functions: {sorted(denied_functions)}.",
            checks={**checks, "function_denylist": False},
        )

    checks["function_denylist"] = True

    if _has_unconditional_join(statement):
        return ValidationResult(
            ok=False,
            error="Cross join detected. Use an explicit JOIN … ON … or JOIN … USING (…).",
            checks={**checks, "no_cross_join": False},
        )

    checks["no_cross_join"] = True

    join_count = _count_joins(statement)
    if join_count > max_joins:
        return ValidationResult(
            ok=False,
            error=f"Query has {join_count} joins; maximum is {max_joins}.",
            checks={**checks, "join_limit": False},
        )
    checks["join_limit"] = True

    relation_count = len(relations)
    if relation_count > max_relations:
        return ValidationResult(
            ok=False,
            error=f"Query references {relation_count} relations; maximum is {max_relations}.",
            checks={**checks, "relation_limit": False},
        )
    checks["relation_limit"] = True

    depth = _subquery_depth(statement)
    if depth > max_subquery_depth:
        return ValidationResult(
            ok=False,
            error=f"Subquery depth is {depth}; maximum is {max_subquery_depth}.",
            checks={**checks, "subquery_depth": False},
        )
    checks["subquery_depth"] = True

    rewritten = _enforce_limit(statement, display_limit=display_limit, hard_limit=hard_limit)
    checks["limit_enforced"] = True

    safe_sql = rewritten.sql(dialect="postgres", pretty=False)
    logger.debug("sql_validator passed checks=%s", checks)
    return ValidationResult(ok=True, sql=safe_sql, checks=checks)


def _is_read_only_query(statement: exp.Expression) -> bool:
    """Accept SELECT and set operations built from SELECTs."""
    return isinstance(statement, exp.Select | exp.Union | exp.Intersect | exp.Except)


def _collect_relations(node: exp.Expression, cte_names: set[str]) -> set[str]:
    relations: set[str] = set()
    for table in node.find_all(exp.Table):
        name = (table.name or "").lower()
        if not name:
            continue
        schema = (table.db or "").lower()
        catalog = (table.catalog or "").lower()
        if catalog:
            relations.add(f"{catalog}.{schema}.{name}")
            continue
        if not schema:
            if name in cte_names:
                continue
            # Accept unqualified names only when they resolve to an allowlisted view.
            qualified = f"business_ro.{name}"
            relations.add(qualified if qualified in ALLOWED_RELATIONS else name)
            continue
        relations.add(f"{schema}.{name}")
    return relations


def _collect_denied_functions(node: exp.Expression) -> set[str]:
    denied: set[str] = set()
    for function in node.find_all(exp.Anonymous, exp.Func):
        name = ""
        if isinstance(function, exp.Anonymous):
            name = (function.name or "").lower()
        elif hasattr(function, "sql_name"):
            name = str(function.sql_name()).lower()  # type: ignore[no-untyped-call]

        if name in DENIED_FUNCTIONS:
            denied.add(name)

        # Reject explicit calls into system schemas. Normal aggregate/date
        # functions are unqualified and remain available.
        parent = function.parent
        if isinstance(parent, exp.Dot):
            schema = (parent.this.name if isinstance(parent.this, exp.Identifier) else "").lower()
            if schema in {"pg_catalog", "information_schema", "pg_toast"}:
                denied.add(f"{schema}.{name or 'function'}")
    return denied


def _has_unconditional_join(node: exp.Expression) -> bool:
    for select in node.find_all(exp.Select):
        joins = select.args.get("joins") or []
        for join in joins:
            if not isinstance(join, exp.Join):
                continue
            kind = str(join.args.get("kind") or "").upper()
            has_condition = join.args.get("on") is not None or join.args.get("using") is not None
            if kind == "CROSS" or not has_condition:
                return True
    return False


def _count_joins(node: exp.Expression) -> int:
    return sum(1 for _ in node.find_all(exp.Join))


def _subquery_depth(node: exp.Expression, current: int = 0) -> int:
    max_depth = current
    for child in node.args.values():
        if child is None:
            continue
        expressions = child if isinstance(child, list) else [child]
        for expression in expressions:
            if not isinstance(expression, exp.Expression):
                continue
            nested = current + 1 if isinstance(expression, exp.Subquery) else current
            max_depth = max(max_depth, _subquery_depth(expression, nested))
    return max_depth


def _enforce_limit(
    statement: exp.Expression,
    *,
    display_limit: int,
    hard_limit: int,
) -> exp.Expression:
    """Inject or cap the outermost LIMIT.

    We request one extra row when no LIMIT is present so the executor can
    truthfully report that a result was truncated after the display cap is
    applied. Explicit limits above the hard cap are clamped to the hard cap;
    the service then trims the returned rows to the display cap.
    """
    outer = _outer_query(statement)
    if outer is None:
        return statement

    existing_limit = outer.args.get("limit")
    if existing_limit is None:
        outer = outer.limit(min(display_limit + 1, hard_limit))
    else:
        try:
            limit_expression = existing_limit.args.get("expression") or existing_limit.this
            limit_value = int(str(limit_expression))
            if limit_value > hard_limit:
                outer = outer.limit(hard_limit)
        except (TypeError, ValueError, AttributeError):
            outer = outer.limit(min(display_limit + 1, hard_limit))

    return outer


def _outer_query(statement: exp.Expression) -> exp.Query | None:
    if isinstance(statement, exp.Select | exp.Union | exp.Intersect | exp.Except):
        return statement
    return None
