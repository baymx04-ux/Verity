import hashlib
import hmac
import json
import time
import uuid

import pytest
from app.core.config import Settings
from fastapi.testclient import TestClient

TOKEN = "test-internal-token"


@pytest.fixture
def chat_client(settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from app.main import create_app
    from app.rag.types import Citation, RetrievalResult, RetrievedChunk

    test_settings = settings.model_copy(update={"internal_service_token": TOKEN})
    app = create_app(test_settings)

    citation = Citation(
        id="c1",
        document_id="d1",
        title="Handbook",
        page=1,
        section="Intro",
        snippet="Hello world",
        score=0.9,
    )
    chunk = RetrievedChunk(
        id="c1",
        document_id="d1",
        title="Handbook",
        content="Hello world",
        page_number=1,
        section="Intro",
        chunk_index=0,
        score=0.9,
    )

    async def fake_retrieve(self: object, question: str, access: object) -> RetrievalResult:
        return RetrievalResult(
            chunks=[chunk],
            citations=[citation],
            low_confidence=False,
            best_score=0.9,
        )

    monkeypatch.setattr("app.rag.retrieval.RetrievalService.retrieve", fake_retrieve)

    async def fake_stream(*args: object, **kwargs: object):
        from app.llm.base import LLMDelta

        yield LLMDelta(text="Answer from doc [1].", prompt_tokens=10, completion_tokens=5)

    monkeypatch.setattr(app.state.chat_service._llm, "stream", fake_stream)

    return TestClient(app)


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


def chat_payload() -> dict[str, object]:
    return {
        "conversation_id": str(uuid.uuid4()),
        "question": "What is the policy?",
        "access_context": {
            "user_id": str(uuid.uuid4()),
            "role": "analyst",
            "group_ids": [],
        },
        "history": [],
    }


def test_chat_stream_requires_signature(chat_client: TestClient) -> None:
    response = chat_client.post("/chat/stream", json=chat_payload())
    assert response.status_code == 401


def test_chat_stream_returns_sse(chat_client: TestClient) -> None:
    body = json.dumps(chat_payload()).encode()
    headers = sign("POST", "/chat/stream", body)

    response = chat_client.post("/chat/stream", content=body, headers=headers)
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["Content-Type"]

    text = response.text
    assert "event: route" in text
    assert "event: status" in text
    assert "event: token" in text
    assert "event: sources" in text
    assert "event: done" in text
