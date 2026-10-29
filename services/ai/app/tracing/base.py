"""Tracing primitives shared by the chat pipelines.

The service always records a local trace and stage spans. Exporting that trace to
Langfuse is optional and fail-open: an unreachable collector must never slow down
or fail a chat request.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class Span:
    name: str
    duration_ms: int
    started_at: datetime
    ended_at: datetime
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TraceRecord:
    trace_id: str
    name: str
    started_at: datetime
    ended_at: datetime
    user_id: str | None
    input: str | None
    output: str | None
    metadata: dict[str, Any]
    tags: list[str]
    spans: list[Span]


class TraceExporter(Protocol):
    async def export(self, record: TraceRecord) -> None: ...


class NoopTraceExporter:
    """Exporter used when Langfuse is not configured."""

    async def export(self, record: TraceRecord) -> None:
        return None


@dataclass(slots=True)
class Trace:
    trace_id: str = field(default_factory=lambda: str(uuid4()))
    name: str = "chat"
    user_id: str | None = None
    input: str | None = None
    output: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)
    spans: list[Span] = field(default_factory=list)
    exporter: TraceExporter | None = None
    redact_prompts: bool = False
    started_at: datetime = field(default_factory=utc_now)
    ended_at: datetime | None = None
    flushed: bool = False

    @contextmanager
    def span(self, name: str, **attributes: Any) -> Iterator[None]:
        started_at = utc_now()
        started = time.perf_counter()
        try:
            yield
        finally:
            ended_at = utc_now()
            duration_ms = int((time.perf_counter() - started) * 1000)
            self.spans.append(
                Span(
                    name=name,
                    duration_ms=duration_ms,
                    started_at=started_at,
                    ended_at=ended_at,
                    attributes=attributes,
                )
            )
            logger.info(
                "chat span trace_id=%s stage=%s duration_ms=%s",
                self.trace_id,
                name,
                duration_ms,
            )

    def set_input(self, question: str) -> None:
        if not self.redact_prompts:
            self.input = question

    def set_output(self, answer: str) -> None:
        if not self.redact_prompts:
            self.output = answer

    def set_user(self, user_id: str) -> None:
        self.user_id = user_id

    def set_metadata(self, **values: Any) -> None:
        self.metadata.update(values)

    def add_tag(self, tag: str) -> None:
        if tag not in self.tags:
            self.tags.append(tag)

    def summary(self) -> dict[str, int]:
        return {span.name: span.duration_ms for span in self.spans}

    async def flush(self) -> None:
        """Send the trace once. Export failures are logged and swallowed."""

        if self.flushed:
            return
        self.flushed = True
        if self.exporter is None:
            return

        ended_at = utc_now()
        self.ended_at = ended_at
        record = TraceRecord(
            trace_id=self.trace_id,
            name=self.name,
            started_at=self.started_at,
            ended_at=ended_at,
            user_id=self.user_id,
            input=self.input,
            output=self.output,
            metadata=dict(self.metadata),
            tags=list(self.tags),
            spans=list(self.spans),
        )
        try:
            await self.exporter.export(record)
        except Exception as exc:
            logger.warning("trace export failed trace_id=%s: %s", self.trace_id, exc)
