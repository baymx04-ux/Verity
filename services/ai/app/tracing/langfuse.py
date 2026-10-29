"""Minimal Langfuse ingestion client.

The SDK is intentionally avoided: the AI service only needs one batch endpoint,
and a small adapter keeps tracing optional and easy to test. The ingestion API
is asynchronous, so a short timeout and fail-open behaviour keep chat latency
independent of the collector.
"""

from __future__ import annotations

import base64
import logging
from datetime import datetime
from uuid import uuid4

import httpx

from app.tracing.base import Span, TraceRecord

logger = logging.getLogger(__name__)


class LangfuseTraceExporter:
    def __init__(
        self,
        *,
        host: str,
        public_key: str,
        secret_key: str,
        timeout_seconds: float = 3.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._host = host.rstrip("/")
        self._auth = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode("ascii")
        self._timeout = timeout_seconds
        self._transport = transport

    async def export(self, record: TraceRecord) -> None:
        events: list[dict[str, object]] = [
            {
                "id": str(uuid4()),
                "type": "trace-create",
                "timestamp": _timestamp(record.ended_at),
                "body": _trace_body(record),
            }
        ]
        for span in record.spans:
            events.append(
                {
                    "id": str(uuid4()),
                    "type": "span-create",
                    "timestamp": _timestamp(span.ended_at),
                    "body": _span_body(record.trace_id, span),
                }
            )

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(self._timeout, connect=min(2.0, self._timeout)),
            transport=self._transport,
        ) as client:
            response = await client.post(
                f"{self._host}/api/public/ingestion",
                headers={
                    "Authorization": f"Basic {self._auth}",
                    "Content-Type": "application/json",
                },
                json={"batch": events},
            )
            if response.status_code >= 300:
                detail = response.text[:300]
                raise RuntimeError(
                    f"Langfuse ingestion returned {response.status_code}: {detail}"
                )


def _trace_body(record: TraceRecord) -> dict[str, object]:
    body: dict[str, object] = {
        "id": record.trace_id,
        "name": record.name,
        "timestamp": _timestamp(record.started_at),
        "metadata": {
            **record.metadata,
            "latency_ms": int((record.ended_at - record.started_at).total_seconds() * 1000),
        },
        "tags": record.tags,
    }
    if record.user_id:
        body["userId"] = record.user_id
    if record.input:
        body["input"] = record.input
    if record.output:
        body["output"] = record.output
    return body


def _span_body(trace_id: str, span: Span) -> dict[str, object]:
    body: dict[str, object] = {
        "id": f"{trace_id}-{span.name}-{int(span.started_at.timestamp() * 1000)}",
        "traceId": trace_id,
        "name": span.name,
        "startTime": _timestamp(span.started_at),
        "endTime": _timestamp(span.ended_at),
        "metadata": {"duration_ms": span.duration_ms, **span.attributes},
    }
    return body


def _timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")
