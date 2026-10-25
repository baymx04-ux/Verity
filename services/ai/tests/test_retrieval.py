import pytest
from app.core.config import Settings
from app.rag.rerank import LocalReranker
from app.rag.retrieval import RetrievalService, access_filter, fuse_rrf
from app.rag.types import AccessContext, RetrievedChunk


def test_access_filter_for_admin() -> None:
    access = AccessContext(user_id="user-1", role="admin", group_ids=())
    sql, params = access_filter(access)
    assert sql == "TRUE"
    assert params == []


def test_access_filter_for_analyst() -> None:
    access = AccessContext(user_id="user-2", role="analyst", group_ids=())
    sql, params = access_filter(access)
    assert "d.access_level IN ('public', 'internal')" in sql
    assert "d.access_level = 'restricted'" in sql
    assert params == ["user-2"]


def test_access_filter_for_viewer() -> None:
    access = AccessContext(user_id="user-3", role="viewer", group_ids=())
    sql, params = access_filter(access)
    assert "d.access_level = 'public'" in sql
    assert "internal" not in sql
    assert "d.access_level = 'restricted'" in sql
    assert params == ["user-3"]


def test_fuse_rrf_combines_and_deduplicates() -> None:
    c1 = RetrievedChunk(
        id="c1",
        document_id="d1",
        title="Doc 1",
        content="Content 1",
        page_number=1,
        section="Sec 1",
        chunk_index=0,
        vector_score=0.9,
    )
    c2 = RetrievedChunk(
        id="c2",
        document_id="d1",
        title="Doc 1",
        content="Content 2",
        page_number=2,
        section="Sec 2",
        chunk_index=1,
        vector_score=0.7,
    )
    c3 = RetrievedChunk(
        id="c3",
        document_id="d2",
        title="Doc 2",
        content="Content 3",
        page_number=1,
        section=None,
        chunk_index=0,
        keyword_score=0.8,
    )

    # c1 is rank 1 in vector, rank 2 in keyword
    # c2 is rank 2 in vector
    # c3 is rank 1 in keyword
    from dataclasses import replace

    c1_kw = replace(c1, keyword_score=0.75)
    fused = fuse_rrf([c1, c2], [c3, c1_kw], k=60)

    assert len(fused) == 3
    # c1 appears in both arms, so its fused score should be highest
    assert fused[0].id == "c1"
    assert fused[0].vector_score == 0.9
    assert fused[0].keyword_score == 0.75


@pytest.mark.asyncio
async def test_retrieval_service_confidence_gate(settings: Settings) -> None:
    test_settings = settings.model_copy(update={"min_rerank_score": 0.5})

    class FakeEmbeddings:
        async def embed_query(self, query: str) -> list[float]:
            return [0.1] * 768

    class FakeStore:
        async def search(
            self, **kwargs: object
        ) -> tuple[list[RetrievedChunk], list[RetrievedChunk]]:
            chunk = RetrievedChunk(
                id="c1",
                document_id="d1",
                title="Doc 1",
                content="Some irrelevant text",
                page_number=1,
                section="Intro",
                chunk_index=0,
                vector_score=0.2,
            )
            return [chunk], []

    service = RetrievalService(
        test_settings,
        embeddings=FakeEmbeddings(),  # type: ignore[arg-type]
        store=FakeStore(),
        reranker=LocalReranker(),
    )

    access = AccessContext(user_id="u1", role="viewer", group_ids=())
    result = await service.retrieve("What is the vacation policy?", access)

    # Score should be below 0.5, so low_confidence should be True and citations empty
    assert result.low_confidence is True
    assert result.citations == []
