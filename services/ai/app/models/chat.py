"""Request and response models for grounded chat."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Role = Literal["admin", "analyst", "viewer"]
ChatRole = Literal["user", "assistant"]


class ChatAccessContext(BaseModel):
    user_id: UUID
    role: Role
    group_ids: list[UUID] = Field(default_factory=list)


class ChatHistoryMessage(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    conversation_id: UUID
    question: str = Field(min_length=1, max_length=4000)
    access_context: ChatAccessContext
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=40)
    trace_id: str | None = Field(default=None, max_length=128)
    # Phase 5 will populate this from the router classifier. For Phase 4 the
    # gateway can set it explicitly: "sql" | "documents" (default: "documents")
    route: str | None = Field(default=None, max_length=32)


class CitationResponse(BaseModel):
    id: str
    document_id: str
    title: str
    page: int | None
    section: str | None
    snippet: str
    score: float
