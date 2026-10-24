"""Minimal local tracing for chat stages."""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from uuid import uuid4

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class Span:
    name: str
    duration_ms: int


@dataclass(slots=True)
class Trace:
    trace_id: str = field(default_factory=lambda: str(uuid4()))
    spans: list[Span] = field(default_factory=list)

    @contextmanager
    def span(self, name: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            duration_ms = int((time.perf_counter() - started) * 1000)
            self.spans.append(Span(name=name, duration_ms=duration_ms))
            logger.info(
                "chat span trace_id=%s stage=%s duration_ms=%s",
                self.trace_id,
                name,
                duration_ms,
            )

    def summary(self) -> dict[str, int]:
        return {span.name: span.duration_ms for span in self.spans}
