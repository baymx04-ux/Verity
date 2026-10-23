"""Chunk persistence for the AI ingestion service."""

from __future__ import annotations

import json
from dataclasses import dataclass

import psycopg

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class StoredChunk:
    index: int
    content: str
    page_number: int | None
    section: str | None
    token_count: int
    embedding: list[float]
    embedding_model: str


def to_vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.7f}" for value in values) + "]"


async def replace_chunks(settings: Settings, document_id: str, chunks: list[StoredChunk]) -> int:
    """Replace all chunks for a document atomically (idempotent re-ingest)."""

    async with await psycopg.AsyncConnection.connect(settings.database_url) as connection:
        async with connection.transaction():
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "DELETE FROM app.chunks WHERE document_id = %s",
                    (document_id,),
                )

                if not chunks:
                    return 0

                await cursor.executemany(
                    """
                    INSERT INTO app.chunks
                      (document_id, chunk_index, content, page_number, section,
                       token_count, embedding, metadata)
                    VALUES (%s, %s, %s, %s, %s, %s, CAST(%s AS vector), CAST(%s AS jsonb))
                    """,
                    [
                        (
                            document_id,
                            chunk.index,
                            chunk.content,
                            chunk.page_number,
                            chunk.section,
                            chunk.token_count,
                            to_vector_literal(chunk.embedding),
                            json.dumps(
                                {
                                    "embedding_model": chunk.embedding_model,
                                    "embedding_dim": len(chunk.embedding),
                                }
                            ),
                        )
                        for chunk in chunks
                    ],
                )

    return len(chunks)


async def delete_chunks(settings: Settings, document_id: str) -> int:
    async with await psycopg.AsyncConnection.connect(settings.database_url) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                "DELETE FROM app.chunks WHERE document_id = %s",
                (document_id,),
            )
            return cursor.rowcount or 0
