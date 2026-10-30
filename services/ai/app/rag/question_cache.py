"""Question-answer cache for repeated standalone questions.

Caches the retrieval result (chunks, citations, confidence) for standalone
questions so a repeat of the same question skips embedding, retrieval, and
reranking. Keys are access-context-aware: role and group memberships are part
of the key so one user never sees another's cached answer.
Redis failures are non-fatal: a cache miss falls through to the live pipeline.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict
from typing import Any, Protocol

from redis.asyncio import Redis

from app.core.config import Settings
from app.rag.types import Citation, RetrievedChunk, RetrievalResult

logger = logging.getLogger(__name__)


class QuestionCacheProtocol(Protocol):
    async def get(self, key: str) -> str | None: ...

    async def set(self, key: str, value: str, ttl_seconds: int) -> None: ...


def _serialize_chunk(chunk: RetrievedChunk) -> dict[str, Any]:
    return {
        "id": chunk.id,
        "document_id": chunk.document_id,
        "title": chunk.title,
        "content": chunk.content,
        "page_number": chunk.page_number,
        "section": chunk.section,
        "chunk_index": chunk.chunk_index,
        "vector_score": chunk.vector_score,
        "keyword_score": chunk.keyword_score,
        "fused_score": chunk.fused_score,
        "score": chunk.score,
    }


def _deserialize_chunk(data: dict[str, Any]) -> RetrievedChunk:
    return RetrievedChunk(
        id=str(data["id"]),
        document_id=str(data["document_id"]),
        title=str(data["title"]),
        content=str(data["content"]),
        page_number=data.get("page_number"),
        section=data.get("section"),
        chunk_index=int(data.get("chunk_index", 0)),
        vector_score=data.get("vector_score"),
        keyword_score=data.get("keyword_score"),
        fused_score=float(data.get("fused_score", 0.0)),
        score=float(data.get("score", 0.0)),
    )


def _serialize_citation(citation: Citation) -> dict[str, Any]:
    return {
        "id": citation.id,
        "document_id": citation.document_id,
        "title": citation.title,
        "page": citation.page,
        "section": citation.section,
        "snippet": citation.snippet,
        "score": citation.score,
    }


def _deserialize_citation(data: dict[str, Any]) -> Citation:
    return Citation(
        id=str(data["id"]),
        document_id=str(data["document_id"]),
        title=str(data["title"]),
        page=data.get("page"),
        section=data.get("section"),
        snippet=str(data["snippet"]),
        score=float(data["score"]),
    )


class QuestionCache:
    """Best-effort Redis cache for standalone question retrieval results."""

    def __init__(self, redis: Redis | None) -> None:
        self._redis = redis

    def _key(
        self,
        *,
        question: str,
        role: str,
        group_ids: tuple[str, ...],
        model: str,
        dimensions: int,
    ) -> str:
        groups = ",".join(sorted(group_ids))
        payload = f"{model}:{dimensions}:{role}:{groups}:{question}"
        digest = hashlib.sha256(payload.encode()).hexdigest()
        return f"verity:question:{digest}"

    async def get(
        self,
        *,
        question: str,
        role: str,
        group_ids: tuple[str, ...],
        model: str,
        dimensions: int,
    ) -> RetrievalResult | None:
        if not self._redis:
            return None
        key = self._key(
            question=question,
            role=role,
            group_ids=group_ids,
            model=model,
            dimensions=dimensions,
        )
        try:
            raw = await self._redis.get(key)
        except Exception as exc:  # redis errors are non-fatal
            logger.warning("question cache read failed: %s", exc)
            return None
        if not raw:
            return None
        try:
            data = json.loads(raw)
            return RetrievalResult(
                chunks=[_deserialize_chunk(c) for c in data.get("chunks", [])],
                citations=[_deserialize_citation(c) for c in data.get("citations", [])],
                low_confidence=bool(data.get("low_confidence", True)),
                best_score=float(data.get("best_score", 0.0)),
                spans=dict(data.get("spans", {})),
            )
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            logger.warning("question cache payload invalid: %s", exc)
            return None

    async def set(
        self,
        *,
        question: str,
        role: str,
        group_ids: tuple[str, ...],
        model: str,
        dimensions: int,
        result: RetrievalResult,
        ttl_seconds: int,
    ) -> None:
        if not self._redis:
            return
        key = self._key(
            question=question,
            role=role,
            group_ids=group_ids,
            model=model,
            dimensions=dimensions,
        )
        payload = {
            "chunks": [_serialize_chunk(c) for c in result.chunks],
            "citations": [_serialize_citation(c) for c in result.citations],
            "low_confidence": result.low_confidence,
            "best_score": result.best_score,
            "spans": result.spans,
        }
        try:
            await self._redis.set(key, json.dumps(payload, default=str), ex=ttl_seconds)
        except Exception as exc:  # redis errors are non-fatal
            logger.warning("question cache write failed: %s", exc)


def build_question_cache(settings: Settings) -> QuestionCache:
    try:
        redis: Redis | None = Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception as exc:  # redis unavailable
        logger.warning("question cache disabled: %s", exc)
        redis = None
    return QuestionCache(redis)
