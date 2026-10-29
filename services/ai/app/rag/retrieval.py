"""Access-aware hybrid retrieval for grounded document chat."""

from __future__ import annotations

import logging
import time
from contextlib import nullcontext
from dataclasses import replace
from typing import Protocol

import psycopg
from psycopg.rows import dict_row

from app.core.config import Settings
from app.core.tracing import Trace
from app.ingestion.embeddings import GoogleEmbeddingClient
from app.rag.rerank import Reranker, build_citations
from app.rag.types import AccessContext, RetrievalResult, RetrievedChunk

logger = logging.getLogger(__name__)

RRF_K = 60


class RetrievalError(RuntimeError):
    """Raised when both retrieval arms fail."""


class RetrievalStore(Protocol):
    async def search(
        self,
        *,
        question: str,
        embedding: list[float] | None,
        access: AccessContext,
        limit: int,
    ) -> tuple[list[RetrievedChunk], list[RetrievedChunk]]: ...


def access_filter(access: AccessContext) -> tuple[str, list[object]]:
    """Return a SQL predicate and parameters for document-level access.

    Membership is checked against the database rather than trusting group IDs
    supplied by the caller. Admin can see everything; analysts see public and
    internal docs plus restricted docs granted to their groups; viewers only see
    public docs unless they explicitly belong to a granted group.
    """

    if access.role == "admin":
        return "TRUE", []

    restricted = """(
      d.access_level = 'restricted' AND EXISTS (
        SELECT 1
        FROM app.document_groups dg
        JOIN app.user_groups ug ON ug.group_id = dg.group_id
        WHERE dg.document_id = d.id AND ug.user_id = %s
      )
    )"""

    if access.role == "analyst":
        return f"(d.access_level IN ('public', 'internal') OR {restricted})", [access.user_id]

    return f"(d.access_level = 'public' OR {restricted})", [access.user_id]


def fuse_rrf(
    vector_results: list[RetrievedChunk],
    keyword_results: list[RetrievedChunk],
    *,
    k: int = RRF_K,
) -> list[RetrievedChunk]:
    """Reciprocal rank fusion, deduplicated by chunk id."""

    merged: dict[str, RetrievedChunk] = {}

    for rank, chunk in enumerate(vector_results, start=1):
        merged[chunk.id] = replace(
            chunk,
            vector_score=chunk.vector_score,
            fused_score=chunk.fused_score + 1.0 / (k + rank),
        )

    for rank, chunk in enumerate(keyword_results, start=1):
        existing = merged.get(chunk.id)
        if existing is None:
            merged[chunk.id] = replace(
                chunk,
                keyword_score=chunk.keyword_score,
                fused_score=chunk.fused_score + 1.0 / (k + rank),
            )
        else:
            existing.keyword_score = chunk.keyword_score
            existing.fused_score += 1.0 / (k + rank)

    return sorted(merged.values(), key=lambda item: item.fused_score, reverse=True)


def _row_to_chunk(row: dict[str, object], *, score_field: str) -> RetrievedChunk:
    raw_score = row.get("score")
    score = float(str(raw_score)) if raw_score is not None else 0.0
    raw_page = row.get("page_number")
    page_number = int(str(raw_page)) if raw_page is not None else None
    raw_chunk = row.get("chunk_index")
    chunk_index = int(str(raw_chunk)) if raw_chunk is not None else 0
    return RetrievedChunk(
        id=str(row["id"]),
        document_id=str(row["document_id"]),
        title=str(row["title"]),
        content=str(row["content"]),
        page_number=page_number,
        section=str(row["section"]) if row.get("section") is not None else None,
        chunk_index=chunk_index,
        **{score_field: score},
    )


class PostgresRetrievalStore:
    """Runs a vector arm and a full-text arm with the same ACL predicate."""

    def __init__(self, settings: Settings, *, database_url: str | None = None) -> None:
        self._settings = settings
        self._database_url = database_url or settings.database_url

    async def search(
        self,
        *,
        question: str,
        embedding: list[float] | None,
        access: AccessContext,
        limit: int,
    ) -> tuple[list[RetrievedChunk], list[RetrievedChunk]]:
        access_sql, access_params = access_filter(access)
        vector_results: list[RetrievedChunk] = []
        keyword_results: list[RetrievedChunk] = []
        errors: list[Exception] = []

        async with await psycopg.AsyncConnection.connect(
            self._database_url,
            row_factory=dict_row,
        ) as connection:
            if embedding is not None:
                try:
                    async with connection.cursor() as cursor:
                        await cursor.execute(
                            f"""
                            SELECT c.id::text AS id,
                                   c.document_id::text AS document_id,
                                   d.title,
                                   c.content,
                                   c.page_number,
                                   c.section,
                                   c.chunk_index,
                                   1 - (c.embedding <=> %s::vector) AS score
                            FROM app.chunks c
                            JOIN app.documents d ON d.id = c.document_id
                            WHERE d.status = 'ready'
                              AND c.embedding IS NOT NULL
                              AND {access_sql}
                            ORDER BY c.embedding <=> %s::vector
                            LIMIT %s
                            """,
                            [
                                to_vector_literal(embedding),
                                *access_params,
                                to_vector_literal(embedding),
                                limit,
                            ],
                        )
                        vector_results = [
                            _row_to_chunk(row, score_field="vector_score")
                            for row in await cursor.fetchall()
                        ]
                except Exception as exc:  # one arm failing should not kill chat
                    errors.append(exc)
                    logger.warning("vector retrieval failed: %s", exc)

            try:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        f"""
                        WITH q AS (SELECT plainto_tsquery('english', %s) AS query)
                        SELECT c.id::text AS id,
                               c.document_id::text AS document_id,
                               d.title,
                               c.content,
                               c.page_number,
                               c.section,
                               c.chunk_index,
                               ts_rank_cd(c.tsv, q.query) AS score
                        FROM app.chunks c
                        JOIN app.documents d ON d.id = c.document_id
                        CROSS JOIN q
                        WHERE d.status = 'ready'
                          AND c.tsv @@ q.query
                          AND {access_sql}
                        ORDER BY score DESC
                        LIMIT %s
                        """,
                        [question, *access_params, limit],
                    )
                    keyword_results = [
                        _row_to_chunk(row, score_field="keyword_score")
                        for row in await cursor.fetchall()
                    ]
            except Exception as exc:
                errors.append(exc)
                logger.warning("keyword retrieval failed: %s", exc)

        if errors and not vector_results and not keyword_results:
            raise RetrievalError("Both retrieval arms failed.") from errors[0]
        return vector_results, keyword_results


class RetrievalService:
    def __init__(
        self,
        settings: Settings,
        *,
        embeddings: GoogleEmbeddingClient,
        store: RetrievalStore,
        reranker: Reranker,
    ) -> None:
        self._settings = settings
        self._embeddings = embeddings
        self._store = store
        self._reranker = reranker

    async def retrieve(
        self,
        question: str,
        access: AccessContext,
        *,
        trace: Trace | None = None,
    ) -> RetrievalResult:
        started = time.perf_counter()
        embedding: list[float] | None = None
        try:
            with trace.span("retrieval_embedding") if trace is not None else nullcontext():
                embedding = await self._embeddings.embed_query(question)
        except Exception as exc:  # FTS remains useful if embeddings are down
            logger.warning("query embedding failed; using keyword retrieval only: %s", exc)
        embedding_ms = int((time.perf_counter() - started) * 1000)

        search_started = time.perf_counter()
        with trace.span("retrieval_search") if trace is not None else nullcontext():
            vector_results, keyword_results = await self._store.search(
                question=question,
                embedding=embedding,
                access=access,
                limit=max(1, self._settings.retrieve_top_k),
            )
        search_ms = int((time.perf_counter() - search_started) * 1000)

        fusion_started = time.perf_counter()
        with trace.span("retrieval_fusion") if trace is not None else nullcontext():
            fused = fuse_rrf(vector_results, keyword_results)
        fusion_ms = int((time.perf_counter() - fusion_started) * 1000)

        spans = {
            "retrieval_embedding": embedding_ms,
            "retrieval_search": search_ms,
            "retrieval_fusion": fusion_ms,
        }
        if not fused:
            return RetrievalResult(
                chunks=[],
                citations=[],
                low_confidence=True,
                best_score=0.0,
                spans=spans,
            )

        candidate_limit = max(
            self._settings.rerank_top_n,
            self._settings.rerank_candidates,
        )
        candidates = fused[:candidate_limit]
        rerank_started = time.perf_counter()
        with trace.span("retrieval_rerank") if trace is not None else nullcontext():
            reranked = await self._reranker.rerank(
                question,
                candidates,
                top_n=max(1, self._settings.rerank_top_n),
            )
        spans["retrieval_rerank"] = int((time.perf_counter() - rerank_started) * 1000)

        best_score = reranked[0].score if reranked else 0.0
        low_confidence = not reranked or best_score < self._settings.min_rerank_score
        citations = [] if low_confidence else build_citations(reranked)
        return RetrievalResult(
            chunks=reranked,
            citations=citations,
            low_confidence=low_confidence,
            best_score=best_score,
            spans=spans,
        )


def to_vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.7f}" for value in values) + "]"
