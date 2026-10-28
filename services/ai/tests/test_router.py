"""Router classifier and routed-dispatch tests."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest
from app.core.config import Settings
from app.llm.base import LLMDelta
from app.models.chat import ChatAccessContext, ChatRequest
from app.rag.rewrite import QueryRewriter
from app.router.classifier import classify_route, parse_decision
from app.router.service import OUT_OF_SCOPE_ANSWER, RoutedChatService


class FakeLLM:
    name = "fake-router"

    def __init__(self, text: str) -> None:
        self.text = text
        self.calls = 0

    async def stream(self, **_: Any) -> AsyncIterator[LLMDelta]:
        self.calls += 1
        yield LLMDelta(text=self.text, prompt_tokens=7, completion_tokens=4)


class RaisingLLM:
    name = "raising-router"

    async def stream(self, **_: Any) -> AsyncIterator[LLMDelta]:
        should_raise = True
        if should_raise:
            raise AssertionError("classifier should not be called")
        yield LLMDelta()  # pragma: no cover


def request(
    *,
    route: str | None = None,
    history: list[dict[str, str]] | None = None,
    question: str = "What is the annual leave policy?",
) -> ChatRequest:
    return ChatRequest(
        conversation_id=uuid.uuid4(),
        question=question,
        access_context=ChatAccessContext(user_id=uuid.uuid4(), role="analyst"),
        history=[],
        route=route,
    )


def test_parse_decision_accepts_fenced_json_and_aliases() -> None:
    decision = parse_decision(
        '```json\n{"route":"policy","confidence":1.7,"reason":"  leave\\npolicy "}\n```'
    )
    assert decision is not None
    assert decision.route == "documents"
    assert decision.confidence == 1.0
    assert decision.reason == "leave policy"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "not json",
        '{"route":"unknown","confidence":0.9}',
        '["documents"]',
    ],
)
def test_parse_decision_rejects_invalid_payloads(raw: str) -> None:
    assert parse_decision(raw) is None


@pytest.mark.asyncio
async def test_classify_route_returns_structured_decision() -> None:
    llm = FakeLLM('{"route":"sql","confidence":0.82,"reason":"needs revenue totals"}')
    decision = await classify_route("What was revenue last quarter?", history=[], llm=llm)
    assert decision.route == "sql"
    assert decision.confidence == 0.82
    assert decision.prompt_tokens == 7
    assert decision.completion_tokens == 4


@pytest.mark.asyncio
async def test_classify_route_malformed_response_uses_lexical_fallback() -> None:
    llm = FakeLLM("I think this is a document question")
    decision = await classify_route("What is the leave policy?", history=[], llm=llm)
    assert decision.route == "documents"
    assert "not valid JSON" in decision.reason


class FakeDocuments:
    def __init__(self) -> None:
        self.calls = 0

    async def stream(
        self, request: ChatRequest, *, emit_route: bool = True
    ) -> AsyncIterator[tuple[str, dict[str, object]]]:
        self.calls += 1
        yield "token", {"text": "document answer"}
        yield "sources", {"citations": []}
        yield (
            "done",
            {
                "route": "documents",
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                "answer_status": "answered",
            },
        )


class FakeHybrid:
    def __init__(self) -> None:
        self.calls = 0

    async def stream(
        self, request: ChatRequest, *, emit_route: bool = True
    ) -> AsyncIterator[tuple[str, dict[str, object]]]:
        self.calls += 1
        yield "token", {"text": "hybrid answer"}
        yield "sources", {"citations": []}
        yield (
            "done",
            {
                "route": "hybrid",
                "usage": {"prompt_tokens": 2, "completion_tokens": 2},
                "answer_status": "answered",
            },
        )


class FakeSql(FakeHybrid):
    pass


def build_service(
    settings: Settings, router_llm: Any
) -> tuple[RoutedChatService, FakeDocuments, FakeSql, FakeHybrid]:
    documents = FakeDocuments()
    sql = FakeSql()
    hybrid = FakeHybrid()
    service = RoutedChatService(
        settings,
        documents=cast(Any, documents),
        sql=cast(Any, sql),
        hybrid=cast(Any, hybrid),
        router_llm=cast(Any, router_llm),
    )
    return service, documents, sql, hybrid


@pytest.mark.asyncio
async def test_low_confidence_decision_falls_back_to_hybrid(settings: Settings) -> None:
    llm = FakeLLM('{"route":"sql","confidence":0.4,"reason":"unsure"}')
    service, documents, sql, hybrid = build_service(settings, llm)

    events = [event async for event in service.stream(request())]
    route_event = next(payload for name, payload in events if name == "route")
    assert route_event["route"] == "hybrid"
    assert route_event["classified_route"] == "sql"
    assert route_event["fallback"] is True
    assert hybrid.calls == 1
    assert documents.calls == 0
    assert sql.calls == 0

    done = events[-1][1]
    assert done["router"] == {
        "route": "hybrid",
        "classified_route": "sql",
        "confidence": 0.4,
        "fallback": True,
        "reason": "unsure",
        "prompt_tokens": 7,
        "completion_tokens": 4,
    }
    assert done["usage"] == {"prompt_tokens": 9, "completion_tokens": 6}


@pytest.mark.asyncio
async def test_confident_sql_decision_dispatches_sql(settings: Settings) -> None:
    llm = FakeLLM('{"route":"sql","confidence":0.91,"reason":"metrics"}')
    service, documents, sql, hybrid = build_service(settings, llm)

    events = [event async for event in service.stream(request())]
    route_event = next(payload for name, payload in events if name == "route")
    assert route_event["route"] == "sql"
    assert route_event["fallback"] is False
    assert sql.calls == 1
    assert documents.calls == 0
    assert hybrid.calls == 0


@pytest.mark.asyncio
async def test_malformed_classifier_falls_back_to_hybrid(settings: Settings) -> None:
    service, _, _, hybrid = build_service(settings, FakeLLM("nonsense"))

    events = [event async for event in service.stream(request())]
    route_event = next(payload for name, payload in events if name == "route")
    assert route_event["route"] == "hybrid"
    assert route_event["fallback"] is True
    assert hybrid.calls == 1


@pytest.mark.asyncio
async def test_classifier_outage_routes_clear_out_of_scope_questions(settings: Settings) -> None:
    service, documents, sql, hybrid = build_service(settings, FakeLLM("nonsense"))

    events = [event async for event in service.stream(request(question="Hello, how are you?"))]
    route_event = next(payload for name, payload in events if name == "route")
    assert route_event["route"] == "out_of_scope"
    assert documents.calls == 0 and sql.calls == 0 and hybrid.calls == 0
    assert events[-1][1]["answer_status"] == "out_of_scope"


@pytest.mark.asyncio
async def test_explicit_route_bypasses_classifier(settings: Settings) -> None:
    service, documents, _, _ = build_service(settings, RaisingLLM())

    events = [event async for event in service.stream(request(route="documents"))]
    route_event = next(payload for name, payload in events if name == "route")
    assert route_event == {
        "route": "documents",
        "confidence": 1.0,
        "reason": "explicit mode",
    }
    assert documents.calls == 1


@pytest.mark.asyncio
async def test_out_of_scope_is_brief_and_steers_back(settings: Settings) -> None:
    llm = FakeLLM('{"route":"out_of_scope","confidence":0.95,"reason":"greeting"}')
    service, documents, sql, hybrid = build_service(settings, llm)

    events = [event async for event in service.stream(request())]
    tokens = "".join(
        str(cast(dict[str, Any], payload)["text"]) for name, payload in events if name == "token"
    )
    assert tokens == OUT_OF_SCOPE_ANSWER
    assert "documents" in tokens and "data" in tokens
    assert len(tokens) < 240

    sources = next(payload for name, payload in events if name == "sources")
    assert sources["citations"] == []
    done = events[-1][1]
    assert done["answer_status"] == "out_of_scope"
    assert done["route"] == "out_of_scope"
    assert documents.calls == 0 and sql.calls == 0 and hybrid.calls == 0


@pytest.mark.asyncio
async def test_router_disabled_defaults_to_documents(settings: Settings) -> None:
    disabled = settings.model_copy(update={"router_enabled": False})
    service, documents, _, _ = build_service(disabled, RaisingLLM())

    events = [event async for event in service.stream(request())]
    route_event = next(payload for name, payload in events if name == "route")
    assert route_event["route"] == "documents"
    assert documents.calls == 1


@pytest.mark.asyncio
async def test_query_rewriter_uses_history(settings: Settings) -> None:
    llm = FakeLLM("What is the 2026 annual leave policy for analysts?")
    rewriter = QueryRewriter(cast(Any, llm))
    rewritten = await rewriter.rewrite(
        "What about analysts?",
        [{"role": "user", "content": "What is the annual leave policy?"}],
    )
    assert rewritten == "What is the 2026 annual leave policy for analysts?"
    assert llm.calls == 1


@pytest.mark.asyncio
async def test_query_rewriter_skips_historyless_question(settings: Settings) -> None:
    llm = FakeLLM("should not be used")
    rewriter = QueryRewriter(cast(Any, llm))
    assert await rewriter.rewrite("What is the leave policy?", []) == "What is the leave policy?"
    assert llm.calls == 0
