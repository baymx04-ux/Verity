"""The routing dataset is a reviewed artifact; keep it well-formed."""

from __future__ import annotations

import json
from pathlib import Path

DATASET = Path(__file__).resolve().parents[3] / "evals" / "datasets" / "routing.jsonl"
VALID_ROUTES = {"documents", "sql", "hybrid", "out_of_scope"}


def load_rows() -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in DATASET.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_routing_dataset_has_at_least_forty_unique_cases() -> None:
    rows = load_rows()
    assert len(rows) >= 40
    ids = [str(row["id"]) for row in rows]
    assert len(ids) == len(set(ids))

    questions = [" ".join(str(row["question"]).lower().split()) for row in rows]
    assert len(questions) == len(set(questions))


def test_routing_dataset_covers_every_route() -> None:
    rows = load_rows()
    routes = {str(row["route"]) for row in rows}
    assert routes == VALID_ROUTES

    counts = {route: sum(1 for row in rows if row["route"] == route) for route in VALID_ROUTES}
    assert all(count >= 8 for count in counts.values()), counts
