"""Admin router — schema catalog introspection and catalog GET/PATCH endpoints.

Endpoints (all require internal HMAC signature):
  POST /schema/refresh         — re-introspects business_ro views, re-embeds
  GET  /schema/catalog         — returns all schema_catalog rows
  PATCH /schema/catalog/{view} — update description/column descriptions for a view
"""

from __future__ import annotations

import json
import logging
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.rows import dict_row
from pydantic import BaseModel

from app.core.security import require_internal_signature
from app.sql.catalog import introspect_and_store

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/schema",
    tags=["schema"],
    dependencies=[Depends(require_internal_signature)],
)


class CatalogPatch(BaseModel):
    description: str | None = None
    columns: list[dict[str, Any]] | None = None  # partial column descriptor list


@router.post("/refresh")
async def refresh_schema(request: Request) -> dict[str, object]:
    """Introspect business_ro views and re-embed the schema catalog."""
    settings = request.app.state.settings
    embeddings = request.app.state.embeddings_client
    try:
        count = await introspect_and_store(settings, embeddings)
    except Exception as exc:
        logger.exception("schema refresh failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Schema refresh failed: {exc}") from exc
    return {"refreshed": count, "status": "ok"}


@router.get("/catalog")
async def get_catalog(request: Request) -> dict[str, object]:
    """Return all schema_catalog rows (for the admin UI)."""
    settings = request.app.state.settings
    dsn = settings.database_url
    try:
        async with await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT id, view_name, qualified_name, description,
                           columns, introspected_at, edited_at, updated_at
                    FROM app.schema_catalog
                    ORDER BY view_name
                    """
                )
                rows = await cur.fetchall()
    except Exception as exc:
        logger.exception("get_catalog failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load schema catalog") from exc

    return {"catalog": [_serialize_row(r) for r in rows]}


@router.patch("/catalog/{view_name}")
async def patch_catalog(
    view_name: str,
    body: CatalogPatch,
    request: Request,
) -> dict[str, object]:
    """Update description or column descriptors for a single view."""
    settings = request.app.state.settings
    dsn = settings.database_url
    qualified = f"business_ro.{view_name}"

    set_clauses: list[str] = ["updated_at = now()", "edited_at = now()"]
    params: list[object] = []

    if body.description is not None:
        set_clauses.append(f"description = ${len(params) + 1}")
        params.append(body.description)

    if body.columns is not None:
        # Merge: we only allow updating description/examples per column
        set_clauses.append(f"columns = ${len(params) + 1}::jsonb")
        params.append(json.dumps(body.columns))

    if len(set_clauses) == 2:  # only the timestamps
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(qualified)

    try:
        async with await psycopg.AsyncConnection.connect(dsn, row_factory=dict_row) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"UPDATE app.schema_catalog SET {', '.join(set_clauses)} "
                    f"WHERE qualified_name = ${len(params)} RETURNING view_name",
                    params,
                )
                row = await cur.fetchone()
            await conn.commit()
    except Exception as exc:
        logger.exception("patch_catalog failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to update catalog") from exc

    if row is None:
        raise HTTPException(status_code=404, detail=f"View '{view_name}' not found in catalog")

    return {"updated": row["view_name"], "status": "ok"}


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for key in ("introspected_at", "edited_at", "updated_at"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    if isinstance(out.get("columns"), str):
        try:
            out["columns"] = json.loads(out["columns"])
        except json.JSONDecodeError:
            pass
    return out
