from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest
from app.core.config import Settings
from app.llm.base import LLMDelta
from app.models.chat import ChatAccessContext, ChatRequest
from app.sql.execute import ExecutionResult
from app.sql.generate import GenerationResult
from app.sql.service import SqlChatService


class SynthesisLLM:
    name = "fake-sql"

    def __init__(self, text: str = "Net revenue was 100.") -> None:
        self.text = text
        self.calls = 0

    async def stream(self, **_: Any) -> AsyncIterator[LLMDelta]:
        self.calls += 1
        yield LLMDelta(text=self.text, prompt_tokens=3, completion_tokens=2)


def request(history: list[dict[str, str]] | None = None) -> ChatRequest:
    return ChatRequest(
        conversation_id=uuid4(),
        question="What was net revenue last quarter?",
        access_context=ChatAccessContext(user_id=uuid4(), role="analyst"),
        history=history or [],
    )


def patch_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_context(*args: Any, **kwargs: Any) -> str:
        return "business_ro.v_revenue_daily — daily revenue"

    async def fake_shots(*args: Any, **kwargs: Any) -> list[dict[str, str]]:
        return [{"question": "Revenue?", "sql": "SELECT 1"}]

    monkeypatch.setattr("app.sql.pipeline.retrieve_catalog_context", fake_context)
    monkeypatch.setattr("app.sql.pipeline.retrieve_few_shots", fake_shots)


@pytest.mark.asyncio
async def test_sql_service_streams_sql_then_answer(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_catalog(monkeypatch)

    async def fake_generate(*args: Any, **kwargs: Any) -> GenerationResult:
        return GenerationResult(
            type="sql",
            sql="SELECT net_revenue FROM business_ro.v_revenue_daily",
            prompt_tokens=100,
            completion_tokens=20,
        )

    async def fake_execute(*args: Any, **kwargs: Any) -> ExecutionResult:
        return ExecutionResult(
            ok=True,
            rows=[{"net_revenue": 100.0}],
            columns=["net_revenue"],
            row_count=1,
            truncated=False,
            execution_ms=4,
        )

    monkeypatch.setattr("app.sql.pipeline.generate_sql", fake_generate)
    monkeypatch.setattr("app.sql.pipeline.sql_execute", fake_execute)

    service = SqlChatService(settings, llm=SynthesisLLM(), embeddings=object())  # type: ignore[arg-type]
    events = [event async for event in service.stream(request())]

    names = [name for name, _ in events]
    assert names[:2] == ["status", "route"]
    assert "sql" in names
    assert "token" in names
    assert names[-1] == "done"

    sql_event = next(payload for name, payload in events if name == "sql")
    assert str(sql_event["sql"]).startswith("SELECT net_revenue")
    assert sql_event["row_count"] == 1

    done = events[-1][1]
    assert done["route"] == "sql"
    assert done["answer_status"] == "answered"
    outcome = done["sql_outcome"]
    assert outcome["outcome"] == "success"  # type: ignore[index]
    assert outcome["numeric_check"] == {"status": "passed", "unmatched": []}  # type: ignore[index]


@pytest.mark.asyncio
async def test_ambiguous_question_streams_clarification(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_catalog(monkeypatch)

    async def fake_generate(*args: Any, **kwargs: Any) -> GenerationResult:
        return GenerationResult(
            type="clarification",
            clarification="Which quarter and which region do you mean?",
        )

    monkeypatch.setattr("app.sql.pipeline.generate_sql", fake_generate)

    service = SqlChatService(settings, llm=SynthesisLLM(), embeddings=object())  # type: ignore[arg-type]
    events = [event async for event in service.stream(request())]

    tokens = "".join(str(payload["text"]) for name, payload in events if name == "token")
    assert "Which quarter" in tokens
    assert all(name != "sql" for name, _ in events)
    done = events[-1][1]
    assert done["answer_status"] == "clarification"


@pytest.mark.asyncio
async def test_unsafe_sql_is_blocked_before_execution(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_catalog(monkeypatch)

    async def fake_generate(*args: Any, **kwargs: Any) -> GenerationResult:
        return GenerationResult(type="sql", sql="DROP TABLE business.orders")

    async def fake_repair(*args: Any, **kwargs: Any) -> tuple[Any, Any, Any, list[Any], int, int]:
        return None, None, None, [], 0, 0

    monkeypatch.setattr("app.sql.pipeline.generate_sql", fake_generate)
    monkeypatch.setattr("app.sql.pipeline.repair_loop", fake_repair)

    service = SqlChatService(settings, llm=SynthesisLLM(), embeddings=object())  # type: ignore[arg-type]
    events = [event async for event in service.stream(request())]

    assert all(name != "sql" for name, _ in events)
    error = next(payload for name, payload in events if name == "error")
    assert error["code"] == "sql_blocked"
