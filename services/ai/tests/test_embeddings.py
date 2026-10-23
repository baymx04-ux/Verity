from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Any

import httpx
import pytest
from app.core.config import Settings
from app.ingestion.embeddings import (
    EmbeddingError,
    GoogleEmbeddingClient,
)
from pydantic import SecretStr


def make_settings() -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        verity_app_password="test-password",
        google_api_key="test-key",
        embedding_model="gemini-embedding-001",
        embedding_dim=768,
    )


def client_with(
    handler: Callable[[httpx.Request], httpx.Response],
    settings: Settings | None = None,
) -> GoogleEmbeddingClient:
    return GoogleEmbeddingClient(
        settings or make_settings(),
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_embeds_and_returns_vectors() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        seen.append(payload)
        requests = payload["requests"]
        return httpx.Response(
            200,
            json={"embeddings": [{"values": [0.1] * 768} for _ in requests]},
        )

    vectors = await client_with(handler).embed_documents(["one", "two"])

    assert len(vectors) == 2
    assert len(vectors[0]) == 768
    assert len(seen[0]["requests"]) == 2
    assert seen[0]["requests"][0]["taskType"] == "RETRIEVAL_DOCUMENT"
    assert seen[0]["requests"][0]["outputDimensionality"] == 768


@pytest.mark.asyncio
async def test_batches_large_inputs() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests = json.loads(request.content)["requests"]
        calls.append(len(requests))
        return httpx.Response(
            200,
            json={"embeddings": [{"values": [0.2] * 768} for _ in requests]},
        )

    settings = make_settings().model_copy(update={"embedding_batch_size": 2})
    client = GoogleEmbeddingClient(settings, transport=httpx.MockTransport(handler))

    vectors = await client.embed_documents(["a", "b", "c", "d", "e"])

    assert len(vectors) == 5
    assert calls == [2, 2, 1]


@pytest.mark.asyncio
async def test_uses_cache_without_network_for_hits() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        requests = json.loads(request.content)["requests"]
        return httpx.Response(
            200,
            json={"embeddings": [{"values": [0.3] * 768} for _ in requests]},
        )

    client = client_with(handler)

    class FakeCache:
        def __init__(self) -> None:
            self.values: dict[str, list[float]] = {}

        async def get_many(self, keys: Sequence[str]) -> list[list[float] | None]:
            return [self.values.get(key) for key in keys]

        async def set_many(
            self,
            items: Sequence[tuple[str, list[float]]],
            ttl_seconds: int,
        ) -> None:
            for key, vector in items:
                self.values[key] = vector

    cache = FakeCache()
    first = await client.embed_documents(["same"], cache=cache)
    second = await client.embed_documents(["same"], cache=cache)

    assert first == second
    assert calls == 1


@pytest.mark.asyncio
async def test_retries_server_errors() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"embeddings": [{"values": [0.4] * 768}]})

    vectors = await client_with(handler).embed_documents(["text"], cache=None)

    assert attempts == 3
    assert len(vectors[0]) == 768


@pytest.mark.asyncio
async def test_does_not_retry_client_errors() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(400, json={"error": {"message": "bad model"}})

    with pytest.raises(EmbeddingError, match="bad model"):
        await client_with(handler).embed_documents(["text"])

    assert attempts == 1


@pytest.mark.asyncio
async def test_rejects_dimension_mismatch() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"embeddings": [{"values": [0.1] * 10}]})

    with pytest.raises(EmbeddingError, match="dimension mismatch"):
        await client_with(handler).embed_documents(["text"])


@pytest.mark.asyncio
async def test_requires_an_api_key() -> None:
    settings = make_settings().model_copy(update={"google_api_key": SecretStr("")})
    client = GoogleEmbeddingClient(settings)

    with pytest.raises(EmbeddingError, match="GOOGLE_API_KEY"):
        await client.embed_documents(["text"])


@pytest.mark.asyncio
async def test_empty_input_skips_the_provider() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("should not be called")

    assert await client_with(handler).embed_documents([]) == []
