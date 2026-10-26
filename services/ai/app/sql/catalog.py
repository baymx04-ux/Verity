"""Schema catalog — introspects business_ro views and caches embeddings.

Provides:
  - `introspect_and_store(settings)` — reads pg_catalog for all business_ro
    views, generates embeddings, upserts into app.schema_catalog.
  - `retrieve_catalog_context(question, embeddings, settings)` — cosine
    similarity lookup to find the most relevant views for a question.
  - `load_few_shots()` — loads few_shots.yaml and caches in memory.
  - `retrieve_few_shots(question, embeddings, settings, n)` — returns top-n
    few-shot examples by embedding similarity.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
import yaml
from psycopg.rows import dict_row

logger = logging.getLogger(__name__)

_FEW_SHOTS_PATH = Path(__file__).parent / "few_shots.yaml"

# Simple in-process cache for few-shot embeddings
_few_shots_cache: list[dict[str, Any]] | None = None
_few_shot_embeddings_cache: list[list[float]] | None = None

# Allowed views ordered for prompt display
ALLOWED_VIEW_NAMES = [
    "v_products",
    "v_customers",
    "v_orders",
    "v_order_items",
    "v_returns",
    "v_support_tickets",
    "v_employees",
]


# ---------------------------------------------------------------------------
# Few-shot loading
# ---------------------------------------------------------------------------


def load_few_shots() -> list[dict[str, str]]:
    """Return few-shot examples from the YAML config file."""
    global _few_shots_cache
    if _few_shots_cache is not None:
        return _few_shots_cache
    raw = yaml.safe_load(_FEW_SHOTS_PATH.read_text())
    _few_shots_cache = raw.get("examples", [])
    logger.info("loaded %d few-shot SQL examples", len(_few_shots_cache))
    return _few_shots_cache


async def retrieve_few_shots(
    question: str,
    embeddings_client: Any,
    *,
    top_n: int = 3,
) -> list[dict[str, str]]:
    """Return the top-n few-shot examples most similar to *question*."""
    global _few_shot_embeddings_cache

    shots = load_few_shots()
    if not shots:
        return []

    # Embed all few-shot questions if not cached
    if _few_shot_embeddings_cache is None:
        texts = [s["question"] for s in shots]
        try:
            _few_shot_embeddings_cache = [await embeddings_client.embed_query(t) for t in texts]
        except Exception as exc:
            logger.warning("few_shot embedding failed: %s", exc)
            return shots[:top_n]

    try:
        q_emb = await embeddings_client.embed_query(question)
    except Exception as exc:
        logger.warning("question embedding for few-shot failed: %s", exc)
        return shots[:top_n]

    # Cosine similarity (embeddings are already unit-normalized by Google)
    def cosine(a: list[float], b: list[float]) -> float:
        return sum(x * y for x, y in zip(a, b))

    scored = [
        (cosine(q_emb, emb), shot)
        for emb, shot in zip(_few_shot_embeddings_cache, shots)
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in scored[:top_n]]


# ---------------------------------------------------------------------------
# Schema introspection and catalog upsert
# ---------------------------------------------------------------------------


async def introspect_and_store(settings: Any, embeddings_client: Any) -> int:
    """Introspect business_ro views from pg_catalog and upsert into app.schema_catalog.

    Returns the number of views processed.
    """
    from urllib.parse import quote

    user = quote(settings.verity_app_user, safe="")
    password = quote(settings.verity_app_password.get_secret_value(), safe="")
    dsn = (
        f"postgresql://{user}:{password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_db}"
    )

    async with await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row) as conn:
        # Read column info for all business_ro views
        rows = await _fetch_view_columns(conn)

    # Group by view name
    views: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        views.setdefault(row["view_name"], []).append(row)

    count = 0
    async with await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row) as conn:
        for view_name, columns in views.items():
            count += await _upsert_view(conn, view_name, columns, embeddings_client)

    logger.info("schema_catalog introspection complete views=%d", count)
    return count


async def _fetch_view_columns(conn: psycopg.AsyncConnection) -> list[dict[str, Any]]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT
              c.table_name                                    AS view_name,
              c.column_name,
              c.data_type,
              c.is_nullable = 'YES'                          AS nullable
            FROM information_schema.columns c
            WHERE c.table_schema = 'business_ro'
            ORDER BY c.table_name, c.ordinal_position
            """
        )
        return await cur.fetchall()


async def _upsert_view(
    conn: psycopg.AsyncConnection,
    view_name: str,
    columns: list[dict[str, Any]],
    embeddings_client: Any,
) -> int:
    qualified = f"business_ro.{view_name}"

    # Build column descriptors
    col_list = [
        {
            "name": col["column_name"],
            "type": col["data_type"],
            "nullable": col["nullable"],
            "description": "",
            "examples": [],
        }
        for col in columns
    ]

    # Preserve existing admin-edited descriptions/examples
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT columns FROM app.schema_catalog WHERE qualified_name = %s",
            [qualified],
        )
        existing_row = await cur.fetchone()

    if existing_row and existing_row["columns"]:
        existing_cols: list[dict[str, Any]] = (
            existing_row["columns"]
            if isinstance(existing_row["columns"], list)
            else json.loads(existing_row["columns"])
        )
        # Merge: keep admin descriptions/examples for matching column names
        existing_by_name = {c["name"]: c for c in existing_cols}
        for col in col_list:
            if col["name"] in existing_by_name:
                col["description"] = existing_by_name[col["name"]].get("description", "")
                col["examples"] = existing_by_name[col["name"]].get("examples", [])

    # Build embedding text
    col_names = ", ".join(c["name"] for c in col_list)
    embedding_text = f"{view_name}: {col_names}"
    embedding: list[float] | None = None
    try:
        embedding = await embeddings_client.embed_query(embedding_text)
    except Exception as exc:
        logger.warning("schema_catalog embedding failed for %s: %s", view_name, exc)

    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO app.schema_catalog
              (view_name, qualified_name, columns, embedding, introspected_at, updated_at)
            VALUES (%s, %s, %s::jsonb, %s::vector, now(), now())
            ON CONFLICT (qualified_name) DO UPDATE SET
              columns        = EXCLUDED.columns,
              embedding      = COALESCE(EXCLUDED.embedding, app.schema_catalog.embedding),
              introspected_at = now(),
              updated_at     = now()
            """,
            [
                view_name,
                qualified,
                json.dumps(col_list),
                _to_vector_literal(embedding) if embedding else None,
            ],
        )
    await conn.commit()
    return 1


def _to_vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in values) + "]"


# ---------------------------------------------------------------------------
# Catalog retrieval for generation context
# ---------------------------------------------------------------------------


async def retrieve_catalog_context(
    question: str,
    embeddings_client: Any,
    settings: Any,
    *,
    top_k: int = 4,
) -> str:
    """Return a formatted string describing the most relevant views for *question*."""
    from urllib.parse import quote

    user = quote(settings.verity_app_user, safe="")
    password = quote(settings.verity_app_password.get_secret_value(), safe="")
    dsn = (
        f"postgresql://{user}:{password}"
        f"@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_db}"
    )

    try:
        q_emb = await embeddings_client.embed_query(question)
    except Exception as exc:
        logger.warning("catalog_context embedding failed: %s", exc)
        return ""

    vec_literal = _to_vector_literal(q_emb)

    try:
        async with await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT view_name, qualified_name, description, columns
                    FROM app.schema_catalog
                    WHERE embedding IS NOT NULL
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                    """,
                    [vec_literal, top_k],
                )
                rows = await cur.fetchall()
    except Exception as exc:
        logger.warning("catalog_context db query failed: %s", exc)
        return ""

    if not rows:
        return ""

    parts: list[str] = []
    for row in rows:
        cols: list[dict[str, Any]] = (
            row["columns"]
            if isinstance(row["columns"], list)
            else json.loads(row["columns"] or "[]")
        )
        col_lines = []
        for c in cols:
            desc = f" — {c['description']}" if c.get("description") else ""
            examples = ""
            if c.get("examples"):
                examples = f" (e.g. {', '.join(str(e) for e in c['examples'][:3])})"
            col_lines.append(f"    - {c['name']} ({c['type']}){desc}{examples}")
        view_desc = f"  {row['qualified_name']}"
        if row.get("description"):
            view_desc += f": {row['description']}"
        parts.append(view_desc + "\n" + "\n".join(col_lines))

    return "\n".join(parts)
