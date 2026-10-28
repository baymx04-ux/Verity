"""Automatic intent routing and dispatch.

The routed service owns the classifier call and forwards to the document, SQL,
or hybrid service. Explicit routes from the gateway bypass the classifier so an
operator (or the web UI's mode switch) can force a path. Automatic routing is
the default: an unknown or missing route is classified, and a decision below the
configured confidence threshold falls back to hybrid per decision D9.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from typing import Literal

from app.core.config import Settings
from app.core.tracing import Trace
from app.llm.base import LLMClient
from app.models.chat import ChatRequest
from app.rag.service import ChatService
from app.router.classifier import RouteDecision, classify_route
from app.router.hybrid import HybridChatService
from app.sql.service import SqlChatService

logger = logging.getLogger(__name__)

ChatEvent = tuple[str, dict[str, object]]

Route = Literal["documents", "sql", "hybrid", "out_of_scope"]
RequestRoute = Literal["auto", "documents", "sql", "hybrid", "out_of_scope"]

OUT_OF_SCOPE_ANSWER = (
    "I can help with questions about your company documents or business data — "
    "for example a policy question or a revenue metric. What would you like to know?"
)


class RoutedChatService:
    def __init__(
        self,
        settings: Settings,
        *,
        documents: ChatService,
        sql: SqlChatService,
        hybrid: HybridChatService,
        router_llm: LLMClient,
    ) -> None:
        self._settings = settings
        self._documents = documents
        self._sql = sql
        self._hybrid = hybrid
        self._router_llm = router_llm

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatEvent]:
        started = time.perf_counter()
        requested = _requested_route(request.route)
        trace = Trace(request.trace_id) if request.trace_id else Trace()
        if request.trace_id is None:
            request = request.model_copy(update={"trace_id": trace.trace_id})

        decision: RouteDecision | None = None
        fallback = False
        routed: Route

        if requested == "auto":
            if not self._settings.router_enabled:
                routed = "documents"
                reason = "router disabled"
            else:
                yield (
                    "status",
                    {
                        "stage": "routing",
                        "message": "Choosing the best source…",
                    },
                )
                history = [
                    {"role": message.role, "content": message.content}
                    for message in request.history[-self._settings.chat_history_limit :]
                ]
                with trace.span("router"):
                    decision = await classify_route(
                        request.question.strip(),
                        history=history,
                        llm=self._router_llm,
                        max_output_tokens=self._settings.router_max_output_tokens,
                    )
                if decision.confidence >= self._settings.router_confidence_threshold:
                    routed = decision.route
                else:
                    routed = "hybrid"
                    fallback = True
                reason = decision.reason or "classified"
                logger.info(
                    "router trace_id=%s route=%s confidence=%.3f fallback=%s reason=%s",
                    trace.trace_id,
                    decision.route,
                    decision.confidence,
                    fallback,
                    decision.reason,
                )
            yield "route", _route_payload(routed, decision, fallback, reason)
        else:
            routed = requested
            yield (
                "route",
                {
                    "route": routed,
                    "confidence": 1.0,
                    "reason": "explicit mode",
                },
            )

        if routed == "out_of_scope":
            yield (
                "status",
                {
                    "stage": "writing",
                    "message": "Steering back to documents and data…",
                },
            )
            first_token_ms = int((time.perf_counter() - started) * 1000)
            yield "token", {"text": OUT_OF_SCOPE_ANSWER}
            yield "sources", {"citations": []}
            yield "done", _out_of_scope_done(trace, decision, fallback, first_token_ms, started)
            return

        services: dict[Route, ChatService | SqlChatService | HybridChatService] = {
            "documents": self._documents,
            "sql": self._sql,
            "hybrid": self._hybrid,
        }
        service = services[routed]

        async for event, data in service.stream(request, emit_route=False):
            if event == "done":
                data = _merge_router_metadata(data, trace, decision, fallback, routed)
            yield event, data


def _requested_route(value: str | None) -> RequestRoute:
    if not value:
        return "auto"
    normalized = value.strip().lower()
    if normalized in {"auto", "documents", "sql", "hybrid", "out_of_scope"}:
        return normalized  # type: ignore[return-value]
    return "auto"


def _route_payload(
    routed: Route,
    decision: RouteDecision | None,
    fallback: bool,
    reason: str,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "route": routed,
        "reason": reason,
        "fallback": fallback,
    }
    if decision is not None:
        payload["confidence"] = round(decision.confidence, 3)
        payload["classified_route"] = decision.route
    else:
        payload["confidence"] = 1.0
    return payload


def _merge_router_metadata(
    data: dict[str, object],
    trace: Trace,
    decision: RouteDecision | None,
    fallback: bool,
    routed: Route,
) -> dict[str, object]:
    merged = dict(data)
    spans = data.get("spans")
    span_payload = dict(spans) if isinstance(spans, dict) else {}
    span_payload["router_ms"] = trace.summary().get("router", 0)
    merged["spans"] = span_payload

    if decision is not None:
        merged["router"] = {
            "route": routed,
            "classified_route": decision.route,
            "confidence": round(decision.confidence, 3),
            "fallback": fallback,
            "reason": decision.reason,
            "prompt_tokens": decision.prompt_tokens,
            "completion_tokens": decision.completion_tokens,
        }
        usage = data.get("usage")
        if isinstance(usage, dict):
            merged["usage"] = {
                "prompt_tokens": int(usage.get("prompt_tokens", 0)) + decision.prompt_tokens,
                "completion_tokens": int(usage.get("completion_tokens", 0))
                + decision.completion_tokens,
            }
    else:
        merged["router"] = {
            "route": routed,
            "confidence": 1.0,
            "fallback": False,
            "reason": "explicit mode",
        }
    return merged


def _out_of_scope_done(
    trace: Trace,
    decision: RouteDecision | None,
    fallback: bool,
    first_token_ms: int,
    started: float,
) -> dict[str, object]:
    router: dict[str, object] = {
        "route": "out_of_scope",
        "confidence": round(decision.confidence, 3) if decision else 1.0,
        "fallback": fallback,
        "reason": decision.reason if decision else "explicit mode",
    }
    if decision is not None:
        router["classified_route"] = decision.route
        router["prompt_tokens"] = decision.prompt_tokens
        router["completion_tokens"] = decision.completion_tokens
    return {
        "route": "out_of_scope",
        "trace_id": trace.trace_id,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "time_to_first_token_ms": first_token_ms,
        "usage": {
            "prompt_tokens": decision.prompt_tokens if decision else 0,
            "completion_tokens": decision.completion_tokens if decision else 0,
        },
        "spans": trace.summary(),
        "low_confidence": False,
        "answer_status": "out_of_scope",
        "cited_indices": [],
        "citation_count": 0,
        "invalid_citation_count": 0,
        "model": "router",
        "router": router,
    }
