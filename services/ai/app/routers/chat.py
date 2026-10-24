"""Internal signed SSE endpoint for grounded chat."""

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
from app.rag.service import ChatService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"], dependencies=[Depends(require_internal_signature)])


def format_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"), default=str)
    return f"event: {event}\ndata: {payload}\n\n"


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request) -> StreamingResponse:
    service: ChatService = request.app.state.chat_service

    async def events() -> AsyncIterator[str]:
        try:
            async for event, data in service.stream(payload):
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
