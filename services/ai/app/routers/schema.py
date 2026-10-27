"""Internal schema-catalog endpoints.

Endpoints (all require the internal HMAC signature):
  POST  /schema/refresh              re-introspects business_ro views and re-embeds
  GET   /schema/catalog              returns all catalog rows for the admin editor
  PATCH /schema/catalog/{view_name}  edits a view description or column hints
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

from app.core.security import require_internal_signature
from app.sql.catalog import introspect_and_store

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/schema",
    tags=["schema"],
    dependencies=[Depends(require_internal_signature)],
)

_VIEW_NAME = re.compile(r"^v_[a-z0-9_]+$")


class ColumnPatch(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=1000)
    examples: list[Any] | None = None


class CatalogPatch(BaseModel):
    description: str | None = Field(default=None, max_length=1000)
    columns: list[ColumnPatch] | None = None


@router.post("/refresh")
async def refresh_schema(request: Request) -> dict[str, object]:
    """Introspect business_ro views and refresh the catalog embeddings."""
    settings = request.app.state.settings
    embeddings = request.app.state.embeddings_client
    try:
        count = await introspect_and_store(settings, embeddings)
    except Exception as exc:
        logger.exception("schema refresh failed: %s", exc)
        raise HTTPException(status_code=500, detail="Schema refresh failed") from exc
    return {"refreshed": count, "status": "ok"}


@router.get("/catalog")
async def get_catalog(request: Request) -> dict[str, object]:
    """Return all catalog rows for the admin UI."""
    settings = request.app.state.settings
    try:
        async with await psycopg.AsyncConnection.connect(
            settings.database_url, row_factory=dict_row
        ) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT id, view_name, qualified_name, description, columns,
                           introspected_at, edited_at, updated_at
                    FROM app.schema_catalog
                    ORDER BY view_name
                    """
                )
                rows = await cur.fetchall()
    except Exception as exc:
        logger.exception("get_catalog failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load schema catalog") from exc

    return {"catalog": [_serialize_row(row) for row in rows]}


@router.patch("/catalog/{view_name}")
async def patch_catalog(
    view_name: str,
    body: CatalogPatch,
    request: Request,
) -> dict[str, object]:
    """Update a view description and merge column descriptions/examples."""
    if not _VIEW_NAME.fullmatch(view_name):
        raise HTTPException(status_code=400, detail="Invalid view name")

    if body.description is None and body.columns is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    settings = request.app.state.settings
    qualified = f"business_ro.{view_name}"

    try:
        async with await psycopg.AsyncConnection.connect(
            settings.database_url, row_factory=dict_row
        ) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT description, columns
                    FROM app.schema_catalog
                    WHERE qualified_name = %s
                    """,
                    [qualified],
                )
                row = await cur.fetchone()
                if row is None:
                    raise HTTPException(status_code=404, detail=f"View '{view_name}' not found")

                columns: list[dict[str, Any]] = (
                    row["columns"]
                    if isinstance(row["columns"], list)
                    else json.loads(row["columns"] or "[]")
                )
                by_name = {column.get("name"): column for column in columns}

                if body.columns:
                    for patch in body.columns:
                        column = by_name.get(patch.name)
                        if column is None:
                            raise HTTPException(
                                status_code=400,
                                detail=f"Unknown column '{patch.name}' for {view_name}",
                            )
                        if patch.description is not None:
                            column["description"] = patch.description
                        if patch.examples is not None:
                            column["examples"] = patch.examples[:8]

                description = (
                    body.description if body.description is not None else row["description"]
                )

                # Re-embed the view text after an edit. Failure leaves the old
                # embedding in place and is surfaced only in the log.
                embedding_text = _embedding_text(view_name, description, columns)
                embedding_literal: str | None = None
                try:
                    embedding = await request.app.state.embeddings_client.embed_query(
                        embedding_text
                    )
                    embedding_literal = "[" + ",".join(f"{value:.7f}" for value in embedding) + "]"
                except Exception as exc:
                    logger.warning("catalog re-embed failed for %s: %s", view_name, exc)

                await cur.execute(
                    """
                    UPDATE app.schema_catalog
                    SET description = %s,
                        columns = %s::jsonb,
                        embedding = COALESCE(%s::vector, embedding),
                        edited_at = now(),
                        updated_at = now()
                    WHERE qualified_name = %s
                    RETURNING view_name
                    """,
                    [
                        description,
                        json.dumps(columns),
                        embedding_literal,
                        qualified,
                    ],
                )
                updated = await cur.fetchone()
            await conn.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("patch_catalog failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to update catalog") from exc

    if updated is None:
        raise HTTPException(status_code=404, detail=f"View '{view_name}' not found")
    return {"updated": updated["view_name"], "status": "ok"}


def _embedding_text(view_name: str, description: str, columns: list[dict[str, Any]]) -> str:
    parts = [view_name, description]
    for column in columns:
        part = f"{column.get('name')} {column.get('type')} {column.get('description', '')}"
        reference = column.get("references")
        if reference:
            part += f" references {reference.get('table')}.{reference.get('column')}"
        parts.append(part)
    return ". ".join(part for part in parts if part)


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    output = dict(row)
    for key in ("introspected_at", "edited_at", "updated_at"):
        if output.get(key) is not None:
            output[key] = str(output[key])
    if isinstance(output.get("columns"), str):
        try:
            output["columns"] = json.loads(output["columns"])
        except json.JSONDecodeError:
            output["columns"] = []
    return output
