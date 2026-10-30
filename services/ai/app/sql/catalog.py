"""Schema catalog — introspects business_ro views and caches embeddings.

The catalog is stored one row per view in ``app.schema_catalog``. Each row keeps
the ordered column descriptors plus an embedding of the view name, description,
and column names. Keeping the row at view level lets the generator receive a
complete set of joinable columns instead of a fragmented column-only excerpt.

Introspection deliberately uses the read-only database URL: ``verity_app`` has
no USAGE privilege on ``business_ro``. Catalog writes use the application role.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

import psycopg
import yaml
from psycopg.rows import dict_row

logger = logging.getLogger(__name__)

_FEW_SHOTS_PATH = Path(__file__).parent / "few_shots.yaml"
_FEW_SHOT_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "how",
        "in",
        "is",
        "of",
        "on",
        "or",
        "the",
        "to",
        "was",
        "were",
        "what",
        "which",
        "who",
        "with",
    }
)

_few_shots_cache: list[dict[str, Any]] | None = None
_few_shot_embeddings_cache: list[list[float]] | None = None

# View-level descriptions used when the catalog is first created. Admin edits
# always win on subsequent refreshes.
_DEFAULT_VIEW_DESCRIPTIONS: dict[str, str] = {
    "v_regions": "Sales regions and their countries.",
    "v_products": "Product catalogue with category, price, stock, and active status.",
    "v_customers": "Customer segment, region, signup date, and active status (no PII).",
    "v_orders": "Order headers: status, channel, region, totals, and timestamps.",
    "v_order_items": "Order line items with product, quantity, unit price, and line total.",
    "v_returns": "Product returns, reason, quantity, refund amount, and return timestamp.",
    "v_support_tickets": "Support tickets with category, priority, status, and resolution time.",
    "v_employees": "Anonymised employee department, title, level, region, manager, and hire date.",
    "v_revenue_daily": "Daily gross revenue, units, refunds, and net revenue by region.",
    "v_revenue_monthly": "Monthly gross revenue, units, refunds, and net revenue by region.",
    "v_product_performance": "Product-level units sold, gross revenue, returns, and return rate.",
}

_DEFAULT_COLUMN_DESCRIPTIONS: dict[str, str] = {
    "id": "Primary identifier.",
    "region_id": "Region foreign key; join to v_regions.id.",
    "region_name": "Human-readable sales region.",
    "customer_id": "Customer foreign key; join to v_customers.id.",
    "product_id": "Product foreign key; join to v_products.id.",
    "order_id": "Order foreign key; join to v_orders.id.",
    "ordered_at": "Order timestamp (UTC).",
    "created_at": "Record creation timestamp (UTC).",
    "resolved_at": "Ticket resolution timestamp (UTC), or null if unresolved.",
    "returned_at": "Return timestamp (UTC).",
    "total": "Order total including tax and after discounts, in USD.",
    "line_total": "Line revenue after the line discount, in USD.",
    "refund_amt": "Refunded amount in USD.",
    "qty": "Quantity.",
    "status": "Lifecycle status.",
    "category": "Product or ticket category.",
    "priority": "Ticket priority.",
    "segment": "Customer segment.",
    "channel": "Order acquisition channel.",
}

_RELATIONSHIPS: dict[tuple[str, str], tuple[str, str]] = {
    ("v_customers", "region_id"): ("v_regions", "id"),
    ("v_orders", "customer_id"): ("v_customers", "id"),
    ("v_orders", "region_id"): ("v_regions", "id"),
    ("v_order_items", "order_id"): ("v_orders", "id"),
    ("v_order_items", "product_id"): ("v_products", "id"),
    ("v_returns", "order_id"): ("v_orders", "id"),
    ("v_returns", "product_id"): ("v_products", "id"),
    ("v_support_tickets", "customer_id"): ("v_customers", "id"),
    ("v_employees", "region_id"): ("v_regions", "id"),
    ("v_employees", "manager_id"): ("v_employees", "id"),
    ("v_revenue_daily", "region_id"): ("v_regions", "id"),
    ("v_revenue_monthly", "region_id"): ("v_regions", "id"),
    ("v_product_performance", "product_id"): ("v_products", "id"),
}


# ---------------------------------------------------------------------------
# Few-shot loading and retrieval
# ---------------------------------------------------------------------------


def load_few_shots() -> list[dict[str, str]]:
    """Return few-shot examples from the YAML config file."""
    global _few_shots_cache
    if _few_shots_cache is not None:
        return _few_shots_cache
    raw = yaml.safe_load(_FEW_SHOTS_PATH.read_text(encoding="utf-8")) or {}
    _few_shots_cache = list(raw.get("examples", []))
    logger.info("loaded %d few-shot SQL examples", len(_few_shots_cache))
    return _few_shots_cache


def _tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9_]+", text.lower())
        if token not in _FEW_SHOT_STOP_WORDS and len(token) > 1
    }


def _lexical_score(question: str, text: str) -> float:
    query_tokens = _tokens(question)
    if not query_tokens:
        return 0.0
    text_tokens = _tokens(text)
    return len(query_tokens & text_tokens) / len(query_tokens)


async def retrieve_few_shots(
    question: str,
    embeddings_client: Any,
    *,
    top_n: int = 3,
) -> list[dict[str, str]]:
    """Return the top-n most relevant few-shot examples.

    Embedding similarity is preferred. If the embedding provider is not
    configured or returns an error, lexical overlap keeps the generator useful
    in local/test environments.
    """
    global _few_shot_embeddings_cache

    shots = load_few_shots()
    if not shots:
        return []

    try:
        if _few_shot_embeddings_cache is None:
            _few_shot_embeddings_cache = [
                await embeddings_client.embed_query(shot["question"]) for shot in shots
            ]
        query_embedding = await embeddings_client.embed_query(question)
        scored = [
            (sum(a * b for a, b in zip(query_embedding, embedding, strict=False)), shot)
            for embedding, shot in zip(_few_shot_embeddings_cache, shots, strict=True)
        ]
        scored.sort(key=lambda item: item[0], reverse=True)
        return [shot for _, shot in scored[:top_n]]
    except Exception as exc:
        logger.warning("few-shot embedding unavailable; using lexical ranking: %s", exc)
        ranked = sorted(
            shots,
            key=lambda shot: _lexical_score(question, f"{shot['question']} {shot.get('tags', '')}"),
            reverse=True,
        )
        return ranked[:top_n]


# ---------------------------------------------------------------------------
# Schema introspection and catalog upsert
# ---------------------------------------------------------------------------


async def introspect_and_store(settings: Any, embeddings_client: Any) -> int:
    """Introspect business_ro views and upsert them into app.schema_catalog.

    Returns the number of views processed.
    """
    async with await psycopg.AsyncConnection.connect(
        settings.sql_database_url, row_factory=dict_row
    ) as read_conn:
        rows = await _fetch_view_columns(read_conn)

    views: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        views.setdefault(row["view_name"], []).append(row)

    if not views:
        logger.warning(
            "schema introspection found no business_ro views; check the SQL role grants"
        )
        return 0

    count = 0
    async with await psycopg.AsyncConnection.connect(
        settings.database_url, row_factory=dict_row
    ) as write_conn:
        for view_name, columns in views.items():
            await _upsert_view(write_conn, view_name, columns, embeddings_client)
            count += 1

        # Remove catalog rows for views that no longer exist. Do this with the
        # introspected list rather than information_schema: verity_app cannot
        # see business_ro objects.
        qualified_names = [f"business_ro.{view_name}" for view_name in views]
        async with write_conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM app.schema_catalog WHERE NOT (qualified_name = ANY(%s))",
                [qualified_names],
            )
        await write_conn.commit()

    logger.info("schema_catalog introspection complete views=%d", count)
    return count


async def _fetch_view_columns(
    conn: psycopg.AsyncConnection[dict[str, Any]],
) -> list[dict[str, Any]]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
              c.table_name AS view_name,
              c.column_name,
              c.data_type,
              c.is_nullable = 'YES' AS nullable,
              c.ordinal_position
            FROM information_schema.columns c
            WHERE c.table_schema = 'business_ro'
              AND c.table_name LIKE 'v\\_%' ESCAPE '\\'
            ORDER BY c.table_name, c.ordinal_position
            """
        )
        return list(await cur.fetchall())


async def _upsert_view(
    conn: psycopg.AsyncConnection[dict[str, Any]],
    view_name: str,
    columns: list[dict[str, Any]],
    embeddings_client: Any,
) -> None:
    qualified = f"business_ro.{view_name}"
    existing_row: dict[str, Any] | None = None
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT description, columns FROM app.schema_catalog WHERE qualified_name = %s",
            [qualified],
        )
        existing_row = await cur.fetchone()

    existing_columns: list[dict[str, Any]] = []
    if existing_row and existing_row.get("columns"):
        existing_columns = (
            existing_row["columns"]
            if isinstance(existing_row["columns"], list)
            else json.loads(existing_row["columns"])
        )
    existing_by_name = {column["name"]: column for column in existing_columns}

    descriptors: list[dict[str, Any]] = []
    for column in columns:
        name = column["column_name"]
        previous = existing_by_name.get(name, {})
        relationship = _RELATIONSHIPS.get((view_name, name))
        descriptors.append(
            {
                "name": name,
                "type": column["data_type"],
                "nullable": column["nullable"],
                "description": previous.get("description")
                or _DEFAULT_COLUMN_DESCRIPTIONS.get(name, ""),
                "examples": previous.get("examples", []),
                **(
                    {"references": {"table": relationship[0], "column": relationship[1]}}
                    if relationship
                    else {}
                ),
            }
        )

    description = (
        (existing_row or {}).get("description") or _DEFAULT_VIEW_DESCRIPTIONS.get(view_name, "")
    )
    embedding_text = _embedding_text(view_name, description, descriptors)
    embedding: list[float] | None = None
    try:
        embedding = await embeddings_client.embed_query(embedding_text)
    except Exception as exc:
        logger.warning("schema_catalog embedding failed for %s: %s", view_name, exc)

    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO app.schema_catalog
              (view_name, qualified_name, description, columns, embedding,
               introspected_at, updated_at)
            VALUES (%s, %s, %s, %s::jsonb, %s::vector, now(), now())
            ON CONFLICT (qualified_name) DO UPDATE SET
              columns         = EXCLUDED.columns,
              description     = COALESCE(NULLIF(app.schema_catalog.description, ''),
                                         EXCLUDED.description),
              embedding       = COALESCE(EXCLUDED.embedding, app.schema_catalog.embedding),
              introspected_at = now(),
              updated_at      = now()
            """,
            [
                view_name,
                qualified,
                description,
                json.dumps(descriptors),
                _to_vector_literal(embedding) if embedding else None,
            ],
        )


def _embedding_text(
    view_name: str, description: str, columns: list[dict[str, Any]]
) -> str:
    parts = [view_name, description]
    for column in columns:
        text = f"{column['name']} {column['type']} {column.get('description', '')}"
        if column.get("references"):
            text += (
                f" references {column['references']['table']}."
                f"{column['references']['column']}"
            )
        parts.append(text)
    return ". ".join(part for part in parts if part)


def _to_vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.7f}" for value in values) + "]"


# ---------------------------------------------------------------------------
# Catalog retrieval for generation context
# ---------------------------------------------------------------------------


async def retrieve_catalog_context(
    question: str,
    embeddings_client: Any,
    settings: Any,
    *,
    top_k: int = 6,
) -> str:
    """Return the formatted schema context for the most relevant views."""
    try:
        async with await psycopg.AsyncConnection.connect(
            settings.database_url, row_factory=dict_row
        ) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT view_name, qualified_name, description, columns, embedding::text
                    FROM app.schema_catalog
                    ORDER BY view_name
                    """
                )
                rows = await cur.fetchall()
    except Exception as exc:
        logger.warning("catalog context database query failed: %s", exc)
        return ""

    if not rows:
        return ""

    selected: list[dict[str, Any]]
    try:
        query_embedding = await embeddings_client.embed_query(question)
        scored: list[tuple[float, dict[str, Any]]] = []
        for row in rows:
            vector = _parse_vector(row.get("embedding"))
            if vector:
                scored.append((_cosine(query_embedding, vector), row))
        if scored:
            scored.sort(key=lambda item: item[0], reverse=True)
            selected = [row for _, row in scored[:top_k]]
        else:
            selected = _lexical_rows(rows, question, top_k)
    except Exception as exc:
        logger.warning("catalog embedding unavailable; using lexical ranking: %s", exc)
        selected = _lexical_rows(rows, question, top_k)

    return _format_context(selected)


def _parse_vector(value: Any) -> list[float] | None:
    if not value:
        return None
    if isinstance(value, list):
        return [float(item) for item in value]
    if isinstance(value, str):
        try:
            return [float(item) for item in value.strip("[]").split(",") if item]
        except ValueError:
            return None
    return None


def _cosine(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=False))


def _lexical_rows(rows: list[dict[str, Any]], question: str, top_k: int) -> list[dict[str, Any]]:
    def row_text(row: dict[str, Any]) -> str:
        columns = row.get("columns") or []
        if isinstance(columns, str):
            columns = json.loads(columns)
        names = " ".join(
            f"{column.get('name', '')} {column.get('description', '')}" for column in columns
        )
        return f"{row['view_name']} {row.get('description') or ''} {names}"

    ranked = sorted(rows, key=lambda row: _lexical_score(question, row_text(row)), reverse=True)
    return ranked[:top_k]


def _format_context(rows: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for row in rows:
        columns = row.get("columns") or []
        if isinstance(columns, str):
            columns = json.loads(columns)
        lines: list[str] = []
        for column in columns:
            line = f"  - {column.get('name')} ({column.get('type')})"
            if column.get("description"):
                line += f" — {column['description']}"
            if column.get("examples"):
                line += f" (e.g. {', '.join(str(value) for value in column['examples'][:3])})"
            if column.get("references"):
                line += (
                    f" [references {column['references']['table']}."
                    f"{column['references']['column']}]"
                )
            lines.append(line)
        header = f"business_ro.{row['view_name']}"
        if row.get("description"):
            header += f" — {row['description']}"
        parts.append(header + "\n" + "\n".join(lines))
    return "\n\n".join(parts)
