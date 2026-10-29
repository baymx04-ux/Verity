import base64
from datetime import UTC, datetime

import httpx
import pytest

from app.core.config import Settings
from app.tracing import NoopTraceExporter, Trace, build_trace_exporter
from app.tracing.langfuse import LangfuseTraceExporter


def settings(**overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        internal_service_token="test-internal-token",
        verity_app_password="test-password",
        **overrides,
    )


@pytest.mark.asyncio
async def test_trace_flushes_once_and_collects_spans() -> None:
    exported = []

    class Exporter:
        async def export(self, record: object) -> None:
            exported.append(record)

    trace = Trace(exporter=Exporter())
    trace.set_user("user-1")
    trace.set_input("How many vacation days?")
    trace.add_tag("documents")
    trace.set_metadata(route="documents")
    with trace.span("retrieval", candidates=4):
        pass

    assert trace.summary()["retrieval"] >= 0
    await trace.flush()
    await trace.flush()

    assert len(exported) == 1
    record = exported[0]
    assert record.trace_id == trace.trace_id  # type: ignore[attr-defined]
    assert record.user_id == "user-1"  # type: ignore[attr-defined]
    assert record.input == "How many vacation days?"  # type: ignore[attr-defined]
    assert record.metadata["route"] == "documents"  # type: ignore[attr-defined]
    assert record.spans[0].attributes == {"candidates": 4}  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_redacted_trace_keeps_metadata_but_drops_prompts() -> None:
    exported = []

    class Exporter:
        async def export(self, record: object) -> None:
            exported.append(record)

    trace = Trace(exporter=Exporter(), redact_prompts=True)
    trace.set_input("secret question")
    trace.set_output("secret answer")
    trace.set_metadata(route="documents")
    await trace.flush()

    record = exported[0]
    assert record.input is None  # type: ignore[attr-defined]
    assert record.output is None  # type: ignore[attr-defined]
    assert record.metadata["route"] == "documents"  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_langfuse_exporter_posts_trace_and_spans() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(207, json={"successes": [], "errors": []})

    exporter = LangfuseTraceExporter(
        host="http://langfuse:3000/",
        public_key="pk-test",
        secret_key="sk-test",
        transport=httpx.MockTransport(handler),
    )
    trace = Trace(exporter=exporter, name="chat")
    trace.set_user("user-1")
    trace.set_input("question")
    trace.set_output("answer")
    trace.set_metadata(route="documents", answer_status="answered")
    trace.add_tag("documents")
    with trace.span("retrieval", candidates=4):
        pass
    await trace.flush()

    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "http://langfuse:3000/api/public/ingestion"
    expected_auth = base64.b64encode(b"pk-test:sk-test").decode("ascii")
    assert request.headers["Authorization"] == f"Basic {expected_auth}"

    payload = request.read()
    body = httpx.Response(200, content=payload).json()
    assert [event["type"] for event in body["batch"]] == ["trace-create", "span-create"]
    trace_body = body["batch"][0]["body"]
    assert trace_body["id"] == trace.trace_id
    assert trace_body["userId"] == "user-1"
    assert trace_body["input"] == "question"
    assert trace_body["output"] == "answer"
    assert trace_body["metadata"]["route"] == "documents"
    span_body = body["batch"][1]["body"]
    assert span_body["traceId"] == trace.trace_id
    assert span_body["name"] == "retrieval"
    assert span_body["metadata"]["candidates"] == 4
    assert span_body["metadata"]["duration_ms"] >= 0


@pytest.mark.asyncio
async def test_exporter_failure_is_swallowed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="collector offline")

    exporter = LangfuseTraceExporter(
        host="http://langfuse:3000",
        public_key="pk-test",
        secret_key="sk-test",
        transport=httpx.MockTransport(handler),
    )
    trace = Trace(exporter=exporter)
    with trace.span("generation"):
        pass

    await trace.flush()
    assert trace.flushed is True


def test_factory_returns_noop_without_keys() -> None:
    exporter = build_trace_exporter(settings(langfuse_public_key="", langfuse_secret_key=""))
    assert isinstance(exporter, NoopTraceExporter)


def test_factory_returns_langfuse_with_keys() -> None:
    exporter = build_trace_exporter(
        settings(
            langfuse_host="http://langfuse:3000",
            langfuse_public_key="pk-test",
            langfuse_secret_key="sk-test",
        )
    )
    assert isinstance(exporter, LangfuseTraceExporter)


def test_trace_record_timestamps_are_utc() -> None:
    trace = Trace()
    with trace.span("rewrite"):
        pass
    assert trace.spans[0].started_at.tzinfo == UTC
    assert trace.spans[0].ended_at >= trace.spans[0].started_at
    assert isinstance(trace.started_at, datetime)
