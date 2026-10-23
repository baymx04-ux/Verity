"""End-to-end ingestion: download, parse, chunk, embed, persist."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import Settings
from app.db.chunks import StoredChunk, delete_chunks, replace_chunks
from app.ingestion.chunking import chunk_pages, embedding_text
from app.ingestion.embeddings import (
    EmbeddingCache,
    GoogleEmbeddingClient,
    build_embedding_cache,
)
from app.ingestion.parsers import DocumentParseError, _extension, parse_document
from app.models.ingest import IngestRequest, IngestResponse

logger = logging.getLogger(__name__)


class IngestionError(RuntimeError):
    """A user-actionable ingestion failure."""


class IngestionService:
    def __init__(
        self,
        settings: Settings,
        embeddings: GoogleEmbeddingClient | None = None,
        cache: EmbeddingCache | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._embeddings = embeddings or GoogleEmbeddingClient(settings)
        self._cache = cache if cache is not None else build_embedding_cache(settings)
        self._transport = transport

    async def ingest(self, request: IngestRequest) -> IngestResponse:
        try:
            _extension(request.filename, request.mime_type)
        except DocumentParseError as exc:
            raise IngestionError(str(exc)) from exc

        data = await self._download(str(request.storage_url), request.size_bytes)

        try:
            parsed = parse_document(request.filename, request.mime_type, data)
        except DocumentParseError as exc:
            raise IngestionError(str(exc)) from exc

        drafts = chunk_pages(
            parsed.pages,
            target_tokens=self._settings.chunk_tokens,
            overlap_tokens=self._settings.chunk_overlap,
        )
        if not drafts:
            raise IngestionError("No text could be extracted from this document.")

        try:
            vectors = await self._embeddings.embed_documents(
                [embedding_text(request.title, chunk) for chunk in drafts],
                cache=self._cache,
            )
        except Exception as exc:
            raise IngestionError(str(exc)) from exc

        stored = [
            StoredChunk(
                index=index,
                content=chunk.content,
                page_number=chunk.page_number,
                section=chunk.section,
                token_count=chunk.token_count,
                embedding=vector,
                embedding_model=self._embeddings.model,
            )
            for index, (chunk, vector) in enumerate(zip(drafts, vectors, strict=True))
        ]

        count = await replace_chunks(self._settings, str(request.document_id), stored)
        tokens = sum(chunk.token_count for chunk in stored)

        logger.info(
            "document indexed",
            extra={
                "document_id": str(request.document_id),
                "chunks": count,
                "pages": parsed.page_count,
            },
        )

        return IngestResponse(
            document_id=request.document_id,
            chunks=count,
            pages=parsed.page_count,
            tokens=tokens,
            embedding_model=self._embeddings.model,
            embedding_dim=self._embeddings.dimensions,
        )

    async def delete(self, document_id: str) -> int:
        return await delete_chunks(self._settings, document_id)

    def _too_large_message(self) -> str:
        return f"The file exceeds the {self._settings.ingest_max_mb} MB ingestion limit."

    async def _download(self, url: str, expected_size: int | None) -> bytes:
        max_bytes = self._settings.ingest_max_mb * 1024 * 1024
        if expected_size is not None and expected_size > max_bytes:
            raise IngestionError(
                f"The file exceeds the {self._settings.ingest_max_mb} MB ingestion limit."
            )

        chunks: list[bytes] = []
        total = 0
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                follow_redirects=True,
                transport=self._transport,
            ) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    content_length = response.headers.get("content-length")
                    if content_length and int(content_length) > max_bytes:
                        raise IngestionError(self._too_large_message())
                    async for part in response.aiter_bytes():
                        total += len(part)
                        if total > max_bytes:
                            raise IngestionError(self._too_large_message())
                        chunks.append(part)
        except IngestionError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise IngestionError("The source file could not be downloaded for indexing.") from exc

        return b"".join(chunks)


def build_ingestion_service(settings: Settings) -> IngestionService:
    return IngestionService(settings)


def error_payload(exc: Exception) -> dict[str, Any]:
    return {"detail": str(exc)}
