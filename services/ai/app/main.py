import time

from fastapi import FastAPI

from app import __version__
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.ingestion.embeddings import GoogleEmbeddingClient
from app.ingestion.service import build_ingestion_service
from app.llm.factory import build_llm_client
from app.rag.question_cache import build_question_cache
from app.rag.rerank import build_reranker
from app.rag.retrieval import PostgresRetrievalStore, RetrievalService
from app.rag.service import ChatService
from app.router.hybrid import HybridChatService
from app.router.service import RoutedChatService
from app.routers import chat, health, ingest
from app.routers import schema as schema_router
from app.sql.service import SqlChatService
from app.tracing import build_trace_exporter


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the AI service app.

    Uvicorn runs this with ``--factory`` so importing the module never requires a
    fully configured environment (tests can pass their own settings).
    """

    resolved = settings or get_settings()
    configure_logging(resolved.log_level)

    app = FastAPI(
        title="Verity AI",
        version=__version__,
        docs_url=None if resolved.is_production else "/docs",
        redoc_url=None,
    )
    app.state.settings = resolved
    app.state.started_at = time.monotonic()
    app.state.ingestion_service = build_ingestion_service(resolved)
    trace_exporter = build_trace_exporter(resolved)
    app.state.trace_exporter = trace_exporter

    llm = build_llm_client(resolved)
    embeddings = GoogleEmbeddingClient(resolved)
    question_cache = build_question_cache(resolved)
    retrieval = RetrievalService(
        resolved,
        embeddings=embeddings,
        store=PostgresRetrievalStore(resolved),
        reranker=build_reranker(resolved),
        question_cache=question_cache,
    )
    app.state.chat_service = ChatService(
        resolved, retrieval=retrieval, llm=llm, trace_exporter=trace_exporter
    )
    app.state.sql_chat_service = SqlChatService(
        resolved, llm=llm, embeddings=embeddings, trace_exporter=trace_exporter
    )
    app.state.hybrid_chat_service = HybridChatService(
        resolved,
        retrieval=retrieval,
        llm=llm,
        embeddings=embeddings,
        trace_exporter=trace_exporter,
    )
    router_llm = llm
    if resolved.router_model and resolved.router_model != resolved.llm_model:
        router_llm = build_llm_client(
            resolved.model_copy(update={"llm_model": resolved.router_model})
        )
    app.state.routed_chat_service = RoutedChatService(
        resolved,
        documents=app.state.chat_service,
        sql=app.state.sql_chat_service,
        hybrid=app.state.hybrid_chat_service,
        router_llm=router_llm,
        trace_exporter=trace_exporter,
    )
    # Expose embeddings client for the schema router
    app.state.embeddings_client = embeddings

    app.include_router(health.router)
    app.include_router(ingest.router)
    app.include_router(chat.router)
    app.include_router(schema_router.router)

    return app
