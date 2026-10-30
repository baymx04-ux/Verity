"""Hybrid document + SQL orchestration tests."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest
from app.core.config import Settings
from app.llm.base import LLMDelta
from app.models.chat import ChatAccessContext, ChatRequest
from app.rag.prompts import DOCUMENT_SYSTEM_PROMPT
from app.rag.types import AccessContext, Citation, RetrievalResult, RetrievedChunk
from app.router.hybrid import HybridChatService
from app.router.hybrid_prompts import HYBRID_SYSTEM_PROMPT
from app.sql.execute import ExecutionResult
from app.sql.pipeline import SqlPipelineResult
from app.sql.validate import ValidationResult


class FakeLLM:
    name = "fake-hybrid"

    def __init__(self, text: str) -> None:
        self.text = text
        self.systems: list[str] = []

    async def stream(self, *, system: str, **_: Any) -> AsyncIterator[LLMDelta]:
        self.systems.append(system)
        yield LLMDelta(text=self.text, prompt_tokens=11, completion_tokens=6)


class FakeRetrieval:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail

    async def retrieve(self, question: str, access: AccessContext, **kwargs: Any) -> RetrievalResult:
        if self.fail:
            raise RuntimeError("vector store unavailable")
        chunk = RetrievedChunk(
            id="c1",
            document_id="d1",
            title="Returns Policy",
            content="Returns must be processed within 30 days.",
            page_number=2,
            section="Returns",
            chunk_index=0,
            score=0.9,
        )
        return RetrievalResult(
            chunks=[chunk],
            citations=[
                Citation(
                    id="c1",
                    document_id="d1",
                    title="Returns Policy",
                    page=2,
                    section="Returns",
                    snippet="Returns must be processed within 30 days.",
                    score=0.9,
                )
            ],
            low_confidence=False,
            best_score=0.9,
        )


def chat_request() -> ChatRequest:
    return ChatRequest(
        conversation_id=uuid.uuid4(),
        question="Is our return rate within the policy target?",
        access_context=ChatAccessContext(user_id=uuid.uuid4(), role="analyst"),
    )


def success_result() -> SqlPipelineResult:
    return SqlPipelineResult(
        outcome="success",
        sql="SELECT region, revenue FROM business_ro.v_revenue_daily LIMIT 201",
        validation=ValidationResult(
            ok=True,
            sql="SELECT region, revenue FROM business_ro.v_revenue_daily LIMIT 201",
        ),
        execution=ExecutionResult(
            ok=True,
            rows=[{"region": "EMEA", "revenue": 100.0}],
            columns=["region", "revenue"],
            row_count=1,
            execution_ms=5,
        ),
        prompt_tokens=20,
        completion_tokens=8,
    )


def failed_result() -> SqlPipelineResult:
    return SqlPipelineResult(
        outcome="failed",
        error="execution failed",
        error_code="sql_failed",
    )


async def run(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    *,
    retrieval_fail: bool = False,
    sql_result: SqlPipelineResult | None = None,
    answer: str = "[1] Returns must be within 30 days; EMEA revenue was 100.",
) -> tuple[list[tuple[str, dict[str, object]]], FakeLLM]:
    llm = FakeLLM(answer)
    service = HybridChatService(
        settings,
        retrieval=cast(Any, FakeRetrieval(fail=retrieval_fail)),
        llm=cast(Any, llm),
        embeddings=cast(Any, object()),
    )

    async def fake_pipeline(*args: Any, **kwargs: Any) -> SqlPipelineResult:
        assert sql_result is not None
        return sql_result

    monkeypatch.setattr("app.router.hybrid.run_sql_pipeline", fake_pipeline)
    events = [event async for event in service.stream(chat_request())]
    return events, llm


@pytest.mark.asyncio
async def test_hybrid_success_cites_documents_and_returns_sql(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    events, llm = await run(
        settings,
        monkeypatch,
        sql_result=success_result(),
        answer="[1] Returns must be processed within 30 days. EMEA revenue was 100.",
    )

    names = [name for name, _ in events]
    assert "sql" in names
    assert names[-1] == "done"
    assert llm.systems == [HYBRID_SYSTEM_PROMPT]

    sql_event = next(payload for name, payload in events if name == "sql")
    assert sql_event["row_count"] == 1

    sources = next(payload for name, payload in events if name == "sources")
    assert sources["citations"][0]["title"] == "Returns Policy"  # type: ignore[index]

    tokens = "".join(
        str(cast(dict[str, Any], payload)["text"]) for name, payload in events if name == "token"
    )
    assert "30 days" in tokens
    assert "100" in tokens

    done = events[-1][1]
    assert done["route"] == "hybrid"
    assert done["answer_status"] == "answered"
    assert done["cited_indices"] == [1]
    assert done["hybrid"] == {"documents": "ok", "sql": "ok"}
    assert done["sql_outcome"]["outcome"] == "success"  # type: ignore[index]
    assert done["usage"] == {"prompt_tokens": 31, "completion_tokens": 14}


@pytest.mark.asyncio
async def test_hybrid_degrades_to_sql_when_documents_fail(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    events, _ = await run(
        settings,
        monkeypatch,
        retrieval_fail=True,
        sql_result=success_result(),
        answer="EMEA revenue was 100.",
    )

    names = [name for name, _ in events]
    assert "sql" in names
    assert "done" in names
    sources = next(payload for name, payload in events if name == "sources")
    assert sources["citations"] == []

    done = events[-1][1]
    assert done["hybrid"] == {"documents": "failed", "sql": "ok"}
    assert done["answer_status"] == "answered"


@pytest.mark.asyncio
async def test_hybrid_degrades_to_documents_when_sql_fails(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    events, llm = await run(
        settings,
        monkeypatch,
        sql_result=failed_result(),
        answer="[1] Returns must be processed within 30 days.",
    )

    names = [name for name, _ in events]
    assert "sql" not in names
    assert names[-1] == "done"
    sources = next(payload for name, payload in events if name == "sources")
    assert len(sources["citations"]) == 1  # type: ignore[arg-type]

    done = events[-1][1]
    assert done["hybrid"] == {"documents": "ok", "sql": "failed"}
    assert done["cited_indices"] == [1]
    assert llm.systems == [DOCUMENT_SYSTEM_PROMPT]


@pytest.mark.asyncio
async def test_hybrid_reports_error_when_both_sources_fail(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    events, _ = await run(
        settings,
        monkeypatch,
        retrieval_fail=True,
        sql_result=failed_result(),
    )

    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "hybrid_failed"
    assert all(name != "token" for name, _ in events)
