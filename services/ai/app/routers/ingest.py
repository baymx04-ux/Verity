from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.security import require_internal_signature
from app.ingestion.service import IngestionError, IngestionService
from app.models.ingest import DeleteResponse, IngestRequest, IngestResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ingestion"], dependencies=[Depends(require_internal_signature)])


def _service(request: Request) -> IngestionService:
    service: IngestionService = request.app.state.ingestion_service
    return service


@router.post("/ingest", response_model=IngestResponse)
async def ingest(payload: IngestRequest, request: Request) -> IngestResponse:
    try:
        return await _service(request).ingest(payload)
    except IngestionError as exc:
        logger.warning("ingestion rejected", extra={"document_id": str(payload.document_id)})
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@router.delete("/documents/{document_id}", response_model=DeleteResponse)
async def delete_document(document_id: UUID, request: Request) -> DeleteResponse:
    deleted = await _service(request).delete(str(document_id))
    return DeleteResponse(document_id=document_id, chunks_deleted=deleted)
