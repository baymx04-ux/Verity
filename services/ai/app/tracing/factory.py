"""Build the configured trace exporter."""

from __future__ import annotations

import logging

from app.core.config import Settings
from app.tracing.base import NoopTraceExporter, TraceExporter
from app.tracing.langfuse import LangfuseTraceExporter

logger = logging.getLogger(__name__)


def build_trace_exporter(settings: Settings) -> TraceExporter:
    public_key = settings.langfuse_public_key.get_secret_value()
    secret_key = settings.langfuse_secret_key.get_secret_value()
    if not (settings.langfuse_host and public_key and secret_key):
        logger.info("Langfuse tracing disabled: keys or host are not configured")
        return NoopTraceExporter()

    logger.info("Langfuse tracing enabled host=%s", settings.langfuse_host)
    return LangfuseTraceExporter(
        host=settings.langfuse_host,
        public_key=public_key,
        secret_key=secret_key,
        timeout_seconds=settings.langfuse_timeout_seconds,
    )
