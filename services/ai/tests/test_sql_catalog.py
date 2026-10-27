import json

import pytest
from app.sql.catalog import (
    _format_context,
    _lexical_rows,
    _lexical_score,
    _parse_vector,
    load_few_shots,
    retrieve_few_shots,
)


def _catalog_rows() -> list[dict[str, object]]:
    return [
        {
            "view_name": "v_orders",
            "description": "Order headers and totals",
            "columns": json.dumps(
                [
                    {"name": "id", "type": "integer", "description": "Order id"},
                    {"name": "total", "type": "numeric", "description": "Order total"},
                ]
            ),
        },
        {
            "view_name": "v_revenue_daily",
            "description": "Daily revenue by region",
            "columns": [
                {
                    "name": "region_name",
                    "type": "text",
                    "description": "Sales region",
                    "references": {"table": "v_regions", "column": "id"},
                }
            ],
        },
    ]


def test_lexical_ranking_prefers_revenue_region_view() -> None:
    selected = _lexical_rows(_catalog_rows(), "revenue by region", 1)
    assert selected[0]["view_name"] == "v_revenue_daily"


def test_lexical_score_ignores_stop_words() -> None:
    assert _lexical_score("revenue by region", "revenue region") == 1.0


def test_context_includes_descriptions_and_relationships() -> None:
    context = _format_context(_catalog_rows())
    assert "business_ro.v_orders — Order headers" in context
    assert "Order total" in context
    assert "v_regions.id" in context


def test_vector_literal_parsing() -> None:
    assert _parse_vector("[1.0,2.0]") == [1.0, 2.0]
    assert _parse_vector(None) is None


def test_few_shots_include_region_and_revenue_examples() -> None:
    shots = load_few_shots()
    questions = " ".join(shot["question"] for shot in shots)
    assert "revenue by region" in questions.lower()
    assert all(shot["sql"].strip() for shot in shots)


class FailingEmbeddings:
    async def embed_query(self, text: str) -> list[float]:
        raise RuntimeError("no embedding provider")


@pytest.mark.asyncio
async def test_few_shot_retrieval_falls_back_to_lexical(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.sql.catalog as catalog

    monkeypatch.setattr(catalog, "_few_shot_embeddings_cache", None)
    shots = await retrieve_few_shots(
        "revenue by region last quarter",
        FailingEmbeddings(),
        top_n=3,
    )
    assert len(shots) == 3
    assert any("revenue by region" in shot["question"].lower() for shot in shots)
