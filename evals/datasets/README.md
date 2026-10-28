# Datasets

Evaluation datasets live here.

- `routing.jsonl` — labeled router cases (`documents`, `sql`, `hybrid`,
  `out_of_scope`). Phase 5 measures it with `make routing-eval`
  (`evals/run_routing.py`) and writes `evals/reports/routing.md`.
- `rag_questions.jsonl` — question, expected answer, expected source chunks (Phase 6)
- `sql_questions.jsonl` — question, expected result, forbidden operations (Phase 6)
- `refusal_cases.jsonl` — questions that must be refused (Phase 6)
