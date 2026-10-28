"""Internal signed SSE endpoint for grounded chat.

All requests go through the routed chat service. A request without a ``route``
(or with ``route="auto"``) is classified into documents, SQL, hybrid, or
out-of-scope. Explicit routes bypass the classifier.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.core.security import require_internal_signature
from app.models.chat import ChatRequest
from app.router.service import RoutedChatService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"], dependencies=[Depends(require_internal_signature)])


def format_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"), default=str)
    return f"event: {event}\ndata: {payload}\n\n"


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request) -> StreamingResponse:
    routed: RoutedChatService = request.app.state.routed_chat_service
    stream_iter = routed.stream(payload)

    async def events() -> AsyncIterator[str]:
        try:
            async for event, data in stream_iter:
                yield format_sse(event, data)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("unhandled chat stream error")
            yield format_sse(
                "error",
                {
                    "code": "internal_error",
                    "message": "The answer service failed unexpectedly.",
                },
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
