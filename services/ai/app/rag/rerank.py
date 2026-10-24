"""Rerankers and citation construction."""

from __future__ import annotations

import logging
import re
from dataclasses import replace
from typing import Protocol

import httpx

from app.core.config import Settings
from app.rag.types import Citation, RetrievedChunk

logger = logging.getLogger(__name__)

_WORD_RE = re.compile(r"[a-z0-9][a-z0-9'-]*")
_STOPWORDS = {
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
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "was",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
}


class Reranker(Protocol):
    name: str

    async def rerank(
        self,
        query: str,
        candidates: list[RetrievedChunk],
        *,
        top_n: int,
    ) -> list[RetrievedChunk]: ...


def _terms(text: str) -> set[str]:
    return {word for word in _WORD_RE.findall(text.lower()) if word not in _STOPWORDS}


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


class NoneReranker:
    """Keeps RRF ordering and derives a confidence score from the retrieval arms."""

    name = "none"

    async def rerank(
        self,
        query: str,
        candidates: list[RetrievedChunk],
        *,
        top_n: int,
    ) -> list[RetrievedChunk]:
        del query
        ranked: list[RetrievedChunk] = []
        for chunk in sorted(candidates, key=lambda item: item.fused_score, reverse=True)[:top_n]:
            if chunk.vector_score is not None:
                score = _clamp(chunk.vector_score)
            else:
                score = _clamp((chunk.keyword_score or 0.0) * 10.0)
            ranked.append(replace(chunk, score=round(score, 4)))
        return ranked


class LocalReranker:
    """Dependency-free lexical reranker used when no hosted reranker is configured.

    This is deliberately a lightweight fallback, not a replacement for a
    cross-encoder. It still improves short-list ordering and provides a
    calibrated confidence signal for the refusal gate.
    """

    name = "local"

    async def rerank(
        self,
        query: str,
        candidates: list[RetrievedChunk],
        *,
        top_n: int,
    ) -> list[RetrievedChunk]:
        query_terms = _terms(query)
        ranked: list[RetrievedChunk] = []
        for chunk in candidates:
            chunk_terms = _terms(chunk.content)
            overlap = len(query_terms & chunk_terms) / len(query_terms) if query_terms else 0.0
            vector = _clamp(chunk.vector_score or 0.0)
            score = _clamp(0.7 * overlap + 0.3 * vector)
            ranked.append(replace(chunk, score=round(score, 4)))

        ranked.sort(key=lambda item: (item.score, item.fused_score), reverse=True)
        return ranked[:top_n]


class CohereReranker:
    name = "cohere"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._transport = transport
        self._fallback = NoneReranker()

    async def rerank(
        self,
        query: str,
        candidates: list[RetrievedChunk],
        *,
        top_n: int,
    ) -> list[RetrievedChunk]:
        if not candidates:
            return []
        if not self._api_key:
            logger.warning("COHERE_API_KEY is missing; falling back to unfused ranking")
            return await self._fallback.rerank(query, candidates, top_n=top_n)

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(20.0, connect=5.0),
                transport=self._transport,
            ) as client:
                response = await client.post(
                    "https://api.cohere.com/v2/rerank",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._model,
                        "query": query,
                        "documents": [chunk.content for chunk in candidates],
                        "top_n": top_n,
                    },
                )
            response.raise_for_status()
            payload = response.json()
            results = payload.get("results") or []
            ranked = [
                replace(
                    candidates[int(item["index"])],
                    score=round(_clamp(float(item.get("relevance_score", 0.0))), 4),
                )
                for item in results
                if 0 <= int(item.get("index", -1)) < len(candidates)
            ]
            return ranked[:top_n]
        except Exception as exc:
            logger.warning("Cohere rerank failed; falling back: %s", exc)
            return await self._fallback.rerank(query, candidates, top_n=top_n)


def build_reranker(settings: Settings) -> Reranker:
    provider = settings.reranker.strip().lower()
    if provider == "local":
        return LocalReranker()
    if provider == "cohere":
        return CohereReranker(
            settings.cohere_api_key.get_secret_value(),
            settings.rerank_model,
        )
    return NoneReranker()


def build_citations(chunks: list[RetrievedChunk]) -> list[Citation]:
    citations: list[Citation] = []
    for chunk in chunks:
        citations.append(
            Citation(
                id=chunk.id,
                document_id=chunk.document_id,
                title=chunk.title,
                page=chunk.page_number,
                section=chunk.section,
                snippet=_snippet(chunk.content),
                score=round(chunk.score, 4),
            )
        )
    return citations


def _snippet(text: str, limit: int = 320) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"
