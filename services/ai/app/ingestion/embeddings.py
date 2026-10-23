"""Google AI Studio embedding client with batching, retries, and a Redis cache."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Sequence
from typing import Protocol

import httpx
from redis.asyncio import Redis

from app.core.config import Settings

logger = logging.getLogger(__name__)

_TASK_TYPE = "RETRIEVAL_DOCUMENT"


class EmbeddingError(RuntimeError):
    """Raised when an embedding request fails."""


class EmbeddingCacheProtocol(Protocol):
    async def get_many(self, keys: Sequence[str]) -> list[list[float] | None]: ...

    async def set_many(
        self, items: Sequence[tuple[str, list[float]]], ttl_seconds: int
    ) -> None: ...


class EmbeddingCache:
    """Best-effort embedding cache. Redis failures never block ingestion."""

    def __init__(self, redis: Redis | None) -> None:
        self._redis = redis

    async def get_many(self, keys: Sequence[str]) -> list[list[float] | None]:
        if not self._redis or not keys:
            return [None] * len(keys)
        try:
            values = await self._redis.mget(keys)
        except Exception as exc:  # redis errors are non-fatal
            logger.warning("embedding cache read failed: %s", exc)
            return [None] * len(keys)

        result: list[list[float] | None] = []
        for value in values:
            if value is None:
                result.append(None)
                continue
            try:
                parsed = json.loads(value)
                result.append([float(item) for item in parsed])
            except (TypeError, ValueError, json.JSONDecodeError):
                result.append(None)
        return result

    async def set_many(self, items: Sequence[tuple[str, list[float]]], ttl_seconds: int) -> None:
        if not self._redis or not items:
            return
        try:
            pipeline = self._redis.pipeline()
            for key, vector in items:
                pipeline.set(key, json.dumps(vector), ex=ttl_seconds)
            await pipeline.execute()
        except Exception as exc:  # redis errors are non-fatal
            logger.warning("embedding cache write failed: %s", exc)


class GoogleEmbeddingClient:
    """Calls the AI Studio REST API directly; no heavyweight SDK required."""

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = settings.google_api_key.get_secret_value()
        self._base_url = settings.google_ai_base_url.rstrip("/")
        self._model = settings.embedding_model
        self._dimensions = settings.embedding_dim
        self._batch_size = max(1, settings.embedding_batch_size)
        self._cache_ttl = settings.embedding_cache_ttl_seconds
        self._transport = transport

    @property
    def model(self) -> str:
        return self._model

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def cache_keys(self, texts: Sequence[str]) -> list[str]:
        return [self._cache_key(text) for text in texts]

    def _cache_key(self, text: str) -> str:
        digest = hashlib.sha256(
            f"{self._model}:{self._dimensions}:{_TASK_TYPE}:{text}".encode()
        ).hexdigest()
        return f"verity:embedding:{digest}"

    async def embed_documents(
        self,
        texts: Sequence[str],
        cache: EmbeddingCacheProtocol | None = None,
    ) -> list[list[float]]:
        if not texts:
            return []
        if not self._api_key:
            raise EmbeddingError(
                "GOOGLE_API_KEY is not configured. Add a Google AI Studio key to .env."
            )

        keys = self.cache_keys(texts)
        cached = await cache.get_many(keys) if cache else [None] * len(texts)

        missing_indices = [index for index, vector in enumerate(cached) if vector is None]
        if missing_indices:
            missing_texts = [texts[index] for index in missing_indices]
            fresh: list[list[float]] = []

            for start in range(0, len(missing_texts), self._batch_size):
                batch = missing_texts[start : start + self._batch_size]
                fresh.extend(await self._embed_batch(batch))

            for offset, index in enumerate(missing_indices):
                cached[index] = fresh[offset]

            if cache:
                pairs: list[tuple[str, list[float]]] = []
                for index in missing_indices:
                    vector = cached[index]
                    if vector is not None:
                        pairs.append((keys[index], vector))
                await cache.set_many(pairs, self._cache_ttl)

        vectors: list[list[float]] = []
        for vector in cached:
            if vector is None:
                raise EmbeddingError("The embedding provider returned an incomplete response.")
            if len(vector) != self._dimensions:
                raise EmbeddingError(
                    f"Embedding dimension mismatch: expected {self._dimensions}, got {len(vector)}."
                )
            vectors.append(vector)
        return vectors

    async def _embed_batch(self, texts: Sequence[str]) -> list[list[float]]:
        url = f"{self._base_url}/models/{self._model}:batchEmbedContents"
        body = {
            "requests": [
                {
                    "model": f"models/{self._model}",
                    "content": {"parts": [{"text": text}]},
                    "taskType": _TASK_TYPE,
                    "outputDimensionality": self._dimensions,
                }
                for text in texts
            ]
        }
        headers = {
            "x-goog-api-key": self._api_key,
            "Content-Type": "application/json",
        }

        last_error = "unknown error"
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            transport=self._transport,
        ) as client:
            for attempt in range(3):
                try:
                    response = await client.post(url, json=body, headers=headers)
                except httpx.HTTPError as exc:
                    last_error = f"network error: {exc.__class__.__name__}"
                else:
                    if response.status_code == 200:
                        payload = response.json()
                        embeddings = payload.get("embeddings") or []
                        if len(embeddings) != len(texts):
                            raise EmbeddingError(
                                "The embedding provider returned an unexpected number of vectors."
                            )
                        return [
                            [float(value) for value in embedding.get("values", [])]
                            for embedding in embeddings
                        ]

                    if response.status_code not in (408, 429) and response.status_code < 500:
                        detail = _safe_error_detail(response.text)
                        raise EmbeddingError(
                            f"Embedding request failed ({response.status_code}): {detail}"
                        )
                    last_error = f"HTTP {response.status_code}"

                if attempt < 2:
                    await asyncio.sleep(0.5 * (2**attempt))

        raise EmbeddingError(f"Embedding request failed after retries: {last_error}")


def _safe_error_detail(text: str) -> str:
    try:
        payload = json.loads(text)
        message = payload.get("error", {}).get("message", "")
        if message:
            return str(message)[:240]
    except (ValueError, AttributeError):
        pass
    return "provider rejected the request"


def build_embedding_cache(settings: Settings) -> EmbeddingCache:
    try:
        redis: Redis | None = Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception as exc:
        logger.warning("embedding cache disabled: %s", exc)
        redis = None
    return EmbeddingCache(redis)
