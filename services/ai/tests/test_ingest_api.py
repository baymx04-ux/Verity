import hashlib
import hmac
import json
import time
from typing import Any

import httpx
import pytest
from app.core.config import Settings
from fastapi.testclient import TestClient

DOCUMENT_ID = "3f0e1c2a-1111-4222-8333-444455556666"
TOKEN = "test-internal-token"


@pytest.fixture
def client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from app.main import create_app

    test_settings = settings.model_copy(update={"internal_service_token": TOKEN})
    app = create_app(test_settings)

    # Replace the ingestion service with one wired to a mock transport.
    service = app.state.ingestion_service
    monkeypatch.setattr(service, "_transport", httpx.MockTransport(handler), raising=False)

    async def fake_embed(texts: list[str], cache: Any = None) -> list[list[float]]:
        return [[0.01] * 768 for _ in texts]

    monkeypatch.setattr(service._embeddings, "embed_documents", fake_embed, raising=False)

    async def fake_replace(_settings: Settings, _document_id: str, chunks: list[Any]) -> int:
        return len(chunks)

    monkeypatch.setattr("app.ingestion.service.replace_chunks", fake_replace)
    return TestClient(app)


def handler(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith(".txt"):
        return httpx.Response(200, content=b"# Leave policy\n\nEmployees get 25 days per year.")
    return httpx.Response(404)


def sign(method: str, path: str, body: bytes, timestamp: str | None = None) -> dict[str, str]:
    stamp = timestamp or str(int(time.time()))
    body_hash = hashlib.sha256(body).hexdigest()
    signature = hmac.new(
        TOKEN.encode(),
        f"{method.upper()}\n{path}\n{stamp}\n{body_hash}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Verity-Timestamp": stamp,
        "X-Verity-Signature": signature,
        "Content-Type": "application/json",
    }


def payload() -> dict[str, Any]:
    return {
        "document_id": DOCUMENT_ID,
        "storage_url": "http://minio.local/handbook.txt",
        "filename": "handbook.txt",
        "mime_type": "text/plain",
        "title": "Handbook",
        "access_level": "internal",
        "size_bytes": 64,
    }


def test_ingest_requires_a_signature(client: TestClient) -> None:
    response = client.post("/ingest", json=payload())

    assert response.status_code == 401


def test_ingest_rejects_a_replayed_timestamp(client: TestClient) -> None:
    body = json.dumps(payload()).encode()
    headers = sign("POST", "/ingest", body, timestamp=str(int(time.time()) - 3600))

    response = client.post("/ingest", content=body, headers=headers)

    assert response.status_code == 401
    assert "expired" in response.json()["detail"]


def test_ingest_rejects_a_tampered_body(client: TestClient) -> None:
    body = json.dumps(payload()).encode()
    headers = sign("POST", "/ingest", body)
    tampered = json.dumps({**payload(), "title": "Tampered"}).encode()

    response = client.post("/ingest", content=tampered, headers=headers)

    assert response.status_code == 401


def test_ingest_indexes_a_document(client: TestClient) -> None:
    body = json.dumps(payload()).encode()
    headers = sign("POST", "/ingest", body)

    response = client.post("/ingest", content=body, headers=headers)

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["document_id"] == DOCUMENT_ID
    assert data["chunks"] >= 1
    assert data["embedding_dim"] == 768
    assert data["status"] == "indexed"


def test_ingest_reports_unsupported_types(client: TestClient) -> None:
    bad = {**payload(), "filename": "archive.zip"}
    body = json.dumps(bad).encode()
    headers = sign("POST", "/ingest", body)

    response = client.post("/ingest", content=body, headers=headers)

    assert response.status_code == 422
    assert "Unsupported file type" in response.json()["detail"]


def test_deleting_chunks_is_signed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_delete(_settings: Settings, _document_id: str) -> int:
        return 4

    monkeypatch.setattr("app.ingestion.service.delete_chunks", fake_delete)

    path = f"/documents/{DOCUMENT_ID}"
    headers = sign("DELETE", path, b"")

    response = client.delete(path, headers=headers)

    assert response.status_code == 200
    assert response.json() == {"document_id": DOCUMENT_ID, "chunks_deleted": 4}


def test_unsigned_delete_is_rejected(client: TestClient) -> None:
    response = client.delete(f"/documents/{DOCUMENT_ID}")

    assert response.status_code == 401
