from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class IngestRequest(BaseModel):
    document_id: UUID
    storage_url: HttpUrl
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str | None = Field(default=None, max_length=255)
    title: str = Field(min_length=1, max_length=500)
    access_level: Literal["public", "internal", "restricted"] = "internal"
    size_bytes: int | None = Field(default=None, ge=0)


class IngestResponse(BaseModel):
    document_id: UUID
    chunks: int
    pages: int
    tokens: int
    embedding_model: str
    embedding_dim: int
    status: Literal["indexed"] = "indexed"


class DeleteResponse(BaseModel):
    document_id: UUID
    chunks_deleted: int
