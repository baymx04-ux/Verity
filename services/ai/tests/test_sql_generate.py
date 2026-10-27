from collections.abc import AsyncIterator

import pytest
from app.llm.base import LLMDelta
from app.sql.generate import _parse_response, generate_sql


class FakeLLM:
    name = "fake"

    def __init__(self, response: str) -> None:
        self.response = response
        self.system = ""
        self.messages: list[dict[str, str]] = []

    async def stream(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_output_tokens: int,
    ) -> AsyncIterator[LLMDelta]:
        self.system = system
        self.messages = messages
        yield LLMDelta(text=self.response, prompt_tokens=12, completion_tokens=8)


@pytest.mark.asyncio
async def test_generation_prompt_contains_reference_date_and_schema() -> None:
    llm = FakeLLM('{"type":"sql","sql":"SELECT 1"}')
    result = await generate_sql(
        "How many orders?",
        llm=llm,
        catalog_context="business_ro.v_orders — orders",
        reference_date="2026-09-30",
    )

    assert result.type == "sql"
    assert result.sql == "SELECT 1"
    assert result.prompt_tokens == 12
    assert result.completion_tokens == 8
    assert "2026-09-30" in llm.system
    assert "business_ro.v_revenue_daily" in llm.system
    assert "SCHEMA NOTES" in llm.system
    assert llm.messages[-1] == {"role": "user", "content": "How many orders?"}


@pytest.mark.asyncio
async def test_generation_includes_few_shot_turns() -> None:
    llm = FakeLLM('{"type":"sql","sql":"SELECT 1"}')
    await generate_sql(
        "How many orders?",
        llm=llm,
        few_shot_examples=[{"question": "Example?", "sql": "SELECT 2"}],
    )

    assert [message["role"] for message in llm.messages] == [
        "user",
        "assistant",
        "user",
    ]
    assert "SELECT 2" in llm.messages[1]["content"]


def test_code_fenced_json_is_parsed() -> None:
    result = _parse_response('```json\n{"type":"sql","sql":"SELECT 1"}\n```')
    assert result.type == "sql"
    assert result.sql == "SELECT 1"


def test_clarification_payload_is_parsed() -> None:
    result = _parse_response('{"type":"clarification","clarification":"Which quarter?"}')
    assert result.type == "clarification"
    assert result.clarification == "Which quarter?"


def test_malformed_payload_becomes_clarification() -> None:
    result = _parse_response("I cannot do that")
    assert result.type == "clarification"
    assert "rephrase" in result.clarification
