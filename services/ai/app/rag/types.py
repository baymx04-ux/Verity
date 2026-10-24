"""Shared RAG types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Role = Literal["admin", "analyst", "viewer"]


@dataclass(frozen=True, slots=True)
class AccessContext:
    user_id: str
    role: Role
    group_ids: tuple[str, ...] = ()


@dataclass(slots=True)
class RetrievedChunk:
    id: str
    document_id: str
    title: str
    content: str
    page_number: int | None = None
    section: str | None = None
    chunk_index: int = 0
    vector_score: float | None = None
    keyword_score: float | None = None
    fused_score: float = 0.0
    score: float = 0.0


@dataclass(frozen=True, slots=True)
class Citation:
    id: str
    document_id: str
    title: str
    page: int | None
    section: str | None
    snippet: str
    score: float


@dataclass(slots=True)
class RetrievalResult:
    chunks: list[RetrievedChunk]
    citations: list[Citation]
    low_confidence: bool
    best_score: float
    spans: dict[str, int] = field(default_factory=dict)
