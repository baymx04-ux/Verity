import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest
from app.core.config import Settings
from app.llm.base import LLMClient, LLMDelta
from app.models.chat import ChatAccessContext, ChatRequest
from app.rag.prompts import REFUSAL_ANSWER
from app.rag.service import ChatService
from app.rag.types import AccessContext, Citation, RetrievalResult, RetrievedChunk


class FakeLLMClient(LLMClient):
    name = "fake"

    def __init__(self, deltas: list[str]) -> None:
        self.deltas = deltas

    async def stream(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        temperature: float = 0.1,
        max_output_tokens: int = 1200,
    ) -> AsyncIterator[LLMDelta]:
        for i, text in enumerate(self.deltas):
            prompt_tokens = 50 if i == len(self.deltas) - 1 else None
            completion_tokens = 20 if i == len(self.deltas) - 1 else None
            yield LLMDelta(
                text=text,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )


@pytest.mark.asyncio
async def test_chat_service_refusal_when_low_confidence(settings: Settings) -> None:
    class MockRetrieval:
        async def retrieve(self, question: str, access: AccessContext) -> RetrievalResult:
            return RetrievalResult(chunks=[], citations=[], low_confidence=True, best_score=0.0)

    llm = FakeLLMClient(["should not be called"])
    service = ChatService(settings, retrieval=MockRetrieval(), llm=llm)  # type: ignore[arg-type]

    request = ChatRequest(
        conversation_id=uuid.uuid4(),
        question="Where is the confidential blueprint?",
        access_context=ChatAccessContext(user_id=uuid.uuid4(), role="viewer"),
    )

    events = [event async for event in service.stream(request)]
    event_names = [e[0] for e in events]
    assert "route" in event_names
    assert "status" in event_names
    assert "token" in event_names
    assert "sources" in event_names
    assert "done" in event_names

    token_events = [cast(dict[str, Any], e[1]) for e in events if e[0] == "token"]
    assert token_events[0]["text"] == REFUSAL_ANSWER

    sources_events = [cast(dict[str, Any], e[1]) for e in events if e[0] == "sources"]
    assert sources_events[0]["citations"] == []

    done_events = [cast(dict[str, Any], e[1]) for e in events if e[0] == "done"]
    assert done_events[0]["low_confidence"] is True
    assert done_events[0]["answer_status"] == "refused"


@pytest.mark.asyncio
async def test_chat_service_treats_model_refusal_as_low_confidence(settings: Settings) -> None:
    chunk = RetrievedChunk(
        id="c1",
        document_id="d1",
        title="Finance Report",
        content="Quarterly revenue was 12 million.",
        chunk_index=0,
        score=0.8,
    )
    citation = Citation(
        id="c1",
        document_id="d1",
        title="Finance Report",
        page=None,
        section=None,
        snippet="Quarterly revenue was 12 million.",
        score=0.8,
    )

    class MockRetrieval:
        async def retrieve(self, question: str, access: AccessContext) -> RetrievalResult:
            return RetrievalResult(
                chunks=[chunk],
                citations=[citation],
                low_confidence=False,
                best_score=0.8,
            )

    llm = FakeLLMClient([REFUSAL_ANSWER])
    service = ChatService(settings, retrieval=MockRetrieval(), llm=llm)  # type: ignore[arg-type]

    request = ChatRequest(
        conversation_id=uuid.uuid4(),
        question="What will revenue be next year?",
        access_context=ChatAccessContext(user_id=uuid.uuid4(), role="analyst"),
    )

    events = [event async for event in service.stream(request)]
    tokens = "".join(
        str(cast(dict[str, Any], event[1])["text"]) for event in events if event[0] == "token"
    )
    assert tokens == REFUSAL_ANSWER

    sources = cast(dict[str, Any], next(event[1] for event in events if event[0] == "sources"))
    assert sources["citations"] == []

    done = cast(dict[str, Any], next(event[1] for event in events if event[0] == "done"))
    assert done["low_confidence"] is True
    assert done["answer_status"] == "refused"
    assert done["cited_indices"] == []


@pytest.mark.asyncio
async def test_chat_service_streams_answer_with_citations(settings: Settings) -> None:
    chunk = RetrievedChunk(
        id="c1",
        document_id="d1",
        title="Employee Handbook",
        content="Employees receive 25 days paid vacation annually.",
        page_number=5,
        section="Leave Policy",
        chunk_index=0,
        score=0.92,
    )
    citation = Citation(
        id="c1",
        document_id="d1",
        title="Employee Handbook",
        page=5,
        section="Leave Policy",
        snippet="Employees receive 25 days paid vacation annually.",
        score=0.92,
    )

    class MockRetrieval:
        async def retrieve(self, question: str, access: AccessContext) -> RetrievalResult:
            return RetrievalResult(
                chunks=[chunk],
                citations=[citation],
                low_confidence=False,
                best_score=0.92,
            )

    llm = FakeLLMClient(["Employees receive ", "25 days of paid vacation [", "1", "]."])
    service = ChatService(settings, retrieval=MockRetrieval(), llm=llm)  # type: ignore[arg-type]

    request = ChatRequest(
        conversation_id=uuid.uuid4(),
        question="How many vacation days do employees get?",
        access_context=ChatAccessContext(user_id=uuid.uuid4(), role="analyst"),
    )

    events = [event async for event in service.stream(request)]
    token_payloads = [cast(dict[str, Any], e[1]) for e in events if e[0] == "token"]
    tokens = "".join(str(payload["text"]) for payload in token_payloads)
    assert tokens == "Employees receive 25 days of paid vacation [1]."

    sources = cast(dict[str, Any], next(e[1] for e in events if e[0] == "sources"))
    assert len(sources["citations"]) == 1
    assert sources["citations"][0]["id"] == "c1"

    done = cast(dict[str, Any], next(e[1] for e in events if e[0] == "done"))
    assert done["low_confidence"] is False
    assert done["answer_status"] == "answered"
    assert done["cited_indices"] == [1]
    assert done["usage"]["prompt_tokens"] == 50
    assert done["usage"]["completion_tokens"] == 20
