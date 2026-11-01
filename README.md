# Verity

Verity is a single-tenant, role-based enterprise knowledge base: retrieval-augmented
answers over internal documents plus a guarded text-to-SQL layer over live business
data. Every answer shows its evidence — cited document chunks or the SQL that ran —
and every request is traced, so quality is measured rather than assumed.

Phases 0–7 of the [implementation plan](./docs/implementation-plan.md) are
implemented: auth and RBAC, the design system and app shell, document ingestion,
hybrid retrieval with reranking, grounded streaming chat with citations and refusal,
read-only text-to-SQL, automatic intent routing with hybrid answers, Langfuse
tracing, an admin metrics dashboard, and an offline-validated evaluation harness.

Two things have **not** been measured yet, and no numbers are asserted for them:

- **Full evaluation run.** Datasets are written and validated
  (`make eval-validate` passes), but live scoring needs an LLM API key and the key
  quota was exhausted mid-run at the time of writing. See
  [Evaluation](#evaluation).
- **Live cold-start.** Docker Compose startup is config-validated and every layer
  has unit/integration tests, but a full from-clean-volume boot with real model
  keys has not been verified end to end.

See [`plan.md`](./plan.md) for behavior and [`design.md`](./design.md) for the
visual system.

## Quick start

Prerequisites: Docker Desktop (Compose v2.20+ for `include`) and `make` (optional).

```bash
cp .env.example .env
docker compose up --build
```

The first build takes a few minutes (Node/Python images, npm, pip). When the
containers report healthy:

| URL                                  | What                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| http://localhost:5173                | Web app (login → chat/documents/admin)                  |
| http://localhost:5173/dev/components | Dev-only component gallery                              |
| http://localhost:4000/api/health     | Gateway health JSON                                     |
| http://localhost:3000                | Langfuse UI (optional tracing; set Langfuse keys first) |
| http://localhost:9001                | MinIO console (`MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`) |
| localhost:5432                       | Postgres 16 + pgvector                                  |
| localhost:6379                       | Redis 7                                                 |

Create the demo users once the database is migrated:

```bash
make seed            # host Node; sets POSTGRES_HOST=localhost
# or: npm run seed:demo
```

| Role    | Email                | Password             |
| ------- | -------------------- | -------------------- |
| Admin   | `admin@verity.dev`   | `verity-admin-dev`   |
| Analyst | `analyst@verity.dev` | `verity-analyst-dev` |
| Viewer  | `viewer@verity.dev`  | `verity-viewer-dev`  |

These accounts are development-only. Override them with the `SEED_*` variables in
`.env`; the seed script refuses to run when `NODE_ENV=production`.

`make seed` also queues the 21-document demo corpus in `infra/seed/documents/`
and creates the `finance`, `people`, and `engineering` groups. Indexing needs a
reachable `worker`, `ai`, MinIO, Redis, and a real `GOOGLE_API_KEY`; without them
documents stay `queued` or fail with an error code. Set `SEED_DOCUMENTS=false` to
seed users and groups only. Sign in as the admin and open **Documents** to watch
statuses move from queued to ready.

Supported uploads: PDF, DOCX, TXT, MD, and HTML up to `UPLOAD_MAX_MB` (default
25 MB) each. The documents page accepts multiple files and shows per-file
progress. See [`docs/ingestion.md`](./docs/ingestion.md) for the pipeline.

### Asking questions

Open **Ask Verity** after signing in. Suggested prompts include the employee
annual-leave policy, damaged-goods returns, delivery SLAs, and remote-work
equipment expenses. The server routes each question automatically (documents,
SQL, hybrid, or out-of-scope), answers stream over SSE through the gateway,
citing the accessible passages they use, with the retrieved sources in the
evidence drawer and a route badge on each answer. The default answer model is
`gemini-2.5-flash` (`LLM_MODEL`); live answers require a valid `GOOGLE_API_KEY`.
When evidence is too weak, Verity says it cannot answer — even while retrieval
stays available. See [`docs/retrieval.md`](./docs/retrieval.md) for the pipeline
and [`docs/api.md`](./docs/api.md#chat-and-sse) for the stream contract.

The values in `.env.example` are **development-only placeholders**. Change every
`change-me` value before exposing the stack beyond your machine. `.env` is
gitignored; never commit it.

Stop with `docker compose down`. `make clean` also deletes the Postgres, Redis,
and MinIO volumes, including uploaded documents.

## Observability and metrics

- **Tracing:** the AI service exports a trace per chat request:
  retrieval stage spans (query rewrite, both search arms, fusion, rerank),
  routing decisions, token use, and answer status. The exporter is self-hosted
  [Langfuse v3](./infra/docker-compose.yml) (UI on port 3000) or a no-op when no
  keys are configured — tracing is fail-open and chat never depends on it. See
  [`docs/architecture.md`](./docs/architecture.md#observability).
- **Metrics:** the gateway runs SQL over its own database and message metadata to
  expose `/api/admin/metrics`: requests with p50/p95 latency, trace-linked share,
  route mix, thumbs feedback, "I don't know" rate, SQL validation failure rate,
  and the top failing questions — computed over a selectable window. Open the
  **Admin** page as an admin user to see the dashboard. Estimated spend appears
  only when token rates (`LLM_INPUT/OUTPUT_COST_PER_MILLION`) are configured;
  otherwise the dashboard says "Not priced" rather than inventing a cost.
- **Feedback:** thumbs up/down with an optional comment, one per user per
  message, with optimistic UI that rolls back on error. Counts and
  thumbs-down rate surface in the metrics dashboard.

## Evaluation

The Phase 6 harness lives in [`evals/`](./evals):

| Requirement       | What ships                                                                           |
| ----------------- | ------------------------------------------------------------------------------------ |
| RAG-style scores  | Faithfulness, answer relevancy, context precision/recall (single-judge LLM)          |
| SQL quality       | Generated SQL executed with `business_ro` compared against `gold_sql` results        |
| Routing           | Reuses the live classifier over `evals/datasets/routing.jsonl`                       |
| Safety            | Injection/out-of-scope cases in `evals/datasets/safety.jsonl`                        |
| Latency & cost    | Measured per run; cost only when token pricing is configured                         |
| Prepared datasets | `docs_qa.jsonl` (63), `sql_qa.jsonl` (42), `routing.jsonl` (50), `safety.jsonl` (20) |

```bash
make eval           # full suite against the running stack (needs a model key + services)
make eval-validate  # dataset shape validation, offline — currently passing
make routing-eval   # router accuracy over the routing dataset (needs a model key)
```

A real model key (`GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
`COHERE_API_KEY`) is required for live scoring. Reports are written to
`evals/reports/eval.md` and `evals/reports/eval.json`, with a comparison section
against the previous run so regressions are visible.

### Result status (honest bookkeeping)

| Metric                       | Status                                             |
| ---------------------------- | -------------------------------------------------- |
| RAGAS-style answer quality   | Harness ready; **not yet measured** (no key quota) |
| Citation correctness         | Harness ready; **not yet measured**                |
| SQL execution accuracy       | Harness ready; **not yet measured**                |
| Routing accuracy             | Harness ready; **not yet measured**¹               |
| Refusal correctness          | Harness ready; **not yet measured**                |
| Latency p50/p95 & cost/query | Harness ready; **not yet measured**                |

¹ The most recent routing run measured nothing: the classifier was down and all
50 cases silently fell back to hybrid (`evals/reports/routing.md`). Any routing
number from that run is invalid.

### Before / after: hybrid answers + reranking

This table will show the measured effect of concurrent document + SQL retrieval
(hybrid) plus reranking, compared with a documents-only baseline without
reranking. Both columns are pending the first complete `make eval` run; the
baseline numbers must be produced by the same harness, so no figures are
asserted here.

| Metric                       | Before (documents only, no rerank) | After (hybrid + rerank) | Δ   |
| ---------------------------- | ---------------------------------- | ----------------------- | --- |
| RAGAS faithfulness           | pending first `make eval` run      | pending first run       | —   |
| RAGAS answer relevancy       | pending first `make eval` run      | pending first run       | —   |
| RAGAS context precision      | pending first `make eval` run      | pending first run       | —   |
| RAGAS context recall         | pending first `make eval` run      | pending first run       | —   |
| Citation correctness         | pending first `make eval` run      | pending first run       | —   |
| SQL execution accuracy       | pending first `make eval` run      | pending first run       | —   |
| Routing accuracy             | pending first `make eval` run      | pending first run       | —   |
| Refusal correctness          | pending first `make eval` run      | pending first run       | —   |
| Latency p50 / p95            | pending first `make eval` run      | pending first run       | —   |
| Average estimated cost/query | pending first `make eval` run      | pending first run       | —   |

Run `make eval` twice — once with `RERANKER=none` for the baseline — and fill the
rows from `evals/reports/eval.md`. No figures are asserted until then.

## Deploy on Render

The fastest way to run Verity in production is on [Render](https://render.com)
using the `render.yaml` blueprint. It provisions all five services
(PostgreSQL + pgvector, Redis, AI service, API gateway, and web frontend) from
this GitHub repo.

### Prerequisites

- A [Render account](https://render.com/signup)
- A **Google Gemini API key** from [Google AI Studio](https://aistudio.google.com/)
- This repo pushed to GitHub

### Steps

1. **Push to GitHub**

   ```bash
   git add .
   git commit -m "Add Render deployment config"
   git push origin main
   ```

2. **Create the blueprint**
   - Open [Render Dashboard](https://dashboard.render.com/)
   - Click **"New +" → "Blueprint"**
   - Connect GitHub and select the `Verity` repository
   - Render detects `render.yaml` and previews all five services
   - Click **"Apply"**

3. **Set required secrets**
   In the Render dashboard, set `GOOGLE_API_KEY` on the `verity-ai` service
   (your Google Gemini API key). All other secrets — `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_TOKEN`, database passwords — are
   auto-generated.

4. **Run migrations**
   After all services are healthy, apply the SQL migrations in
   `infra/postgres/migrations/` against the Postgres service, in filename order.

### Service URLs (after deployment)

| Service     | URL                               |
| ----------- | --------------------------------- |
| Web app     | `https://verity-web.onrender.com` |
| API gateway | `https://verity-api.onrender.com` |
| AI service  | `https://verity-ai.onrender.com`  |

The `render.yaml` blueprint wires service URLs between containers automatically
(`AI_SERVICE_URL`, `POSTGRES_HOST`, `REDIS_URL`, `WEB_ORIGIN`), so no manual
connection-string copying is required. See [`DEPLOY.md`](./DEPLOY.md) for the
full deployment reference.

## What ships today

- **Monorepo:** `apps/web` (React 18, TypeScript strict, Vite, Tailwind, React
  Router, Lucide), `apps/api` (Express, TypeScript strict, Zod, pino, helmet,
  CORS, rate limiting, bcrypt, JWT, BullMQ, S3/MinIO), `services/ai` (FastAPI,
  Pydantic v2, pypdf/docx/BeautifulSoup parsing, structured logs).
- **Design system (Phase 1):** token-based palette/typography/radii, accessible
  primitives (buttons, inputs, cards, badges, tables, dialog, sheet, dropdown,
  tabs, tooltip, alerts, empty states, skeletons), responsive app shell, mobile
  navigation, and a dev-only component gallery.
- **Auth:** login, short-lived access JWT, rotating refresh cookie with reuse
  detection, logout, `/me`, RBAC middleware, rate limits on login/refresh, and
  audit events. Admin-only user list, role patch, and group list APIs; admin UI
  covers users/groups, the schema catalog editor, and the metrics dashboard.
- **Documents (Phase 2):** multipart upload with validation and rate limiting,
  MinIO storage, list/detail/edit/retry/delete, five-minute signed downloads,
  BullMQ worker lifecycle (`queued → processing → ready/failed`, three attempts
  with exponential backoff), structure-aware chunking, contextual embedding
  text, batched embeddings with retries, a content-hash cache, and idempotent
  chunk replacement.
- **Retrieval (Phase 3):** follow-up query rewriting, role/group access
  predicates inside both search arms, pgvector cosine + Postgres full-text
  search with Reciprocal Rank Fusion, a configurable reranker (`none`, `local`,
  or Cohere), a score-based confidence gate, and inline citation chips. Answers
  refuse honestly when evidence is weak.
- **Chat (Phase 3–5):** persistent per-user conversations, SSE streaming with
  status/route/token/source events, stop/retry/regenerate, partial-answer
  persistence on abort or stream failure, a 15-second heartbeat, automatic
  routing with out-of-scope steering, concurrent hybrid answers with
  partial-failure degradation, and route badges.
- **Text-to-SQL (Phase 4):** `business_ro` schema and role, versioned schema
  catalog, validation pipeline (single SELECT, allowlisted views, enforced
  LIMIT, complexity checks), read-only execution with a 5 s statement timeout,
  and a SQL results panel in chat.
- **Observability (Phase 6):** Langfuse tracing (fail-open), trace-persisted
  message metadata (route confidence, cost `null` when unpriced, TTFT), the
  admin metrics API + dashboard, and thumbs feedback with rollback UX.
- **Data & security:** Postgres 16 + pgvector with `app`, `business`, and
  `business_ro` schemas; least-privilege roles verified by `make verify-roles`;
  prompt-injection defenses (delimited untrusted context, injection fixtures);
  versioned SQL migrations; a private MinIO bucket; nginx proxying `/api` with
  SSE buffering disabled.
- **Phase 7 hardening:** Redis caches for embeddings and repeated standalone
  questions (access-context-aware keys), an offline banner and polished
  empty/loading/error states, a Playwright E2E suite (`make e2e`), a demo
  walkthrough ([`docs/demo-script.md`](./docs/demo-script.md)), and a security
  overview ([`docs/security.md`](./docs/security.md)).
- **Quality gates:** ESLint, Prettier, Ruff, mypy strict, Vitest, pytest, a CI
  skeleton with a dependency audit, plus the opt-in Playwright E2E suite.

## Repository layout

```text
apps/web                 React 18 + Vite + Tailwind (served by nginx in Compose)
apps/api                 Express gateway (auth, documents, chat SSE, admin metrics)
services/ai              FastAPI retrieval/routing/SQL service (internal only)
services/ai/app/tracing  Trace abstractions + Langfuse exporter (fail-open)
infra/postgres           init scripts, migrations, role verification
infra/nginx              static build + /api proxy
infra/docker-compose.yml services, health checks, volumes (incl. Langfuse stack)
evals                    datasets, offline validator, and the Phase 6 eval harness
docs                     implementation plan, architecture, API contract
compose.yaml             root include so `docker compose up` works from the repo root
render.yaml              Render.com blueprint (see DEPLOY.md)
```

## Database roles

| Role            | Used by               | Grants                                                                      |
| --------------- | --------------------- | --------------------------------------------------------------------------- |
| `postgres`      | init + migrations     | superuser; not used by request traffic                                      |
| `verity_app`    | API, AI ingestion     | `USAGE` on `app`, SELECT/INSERT/UPDATE/DELETE on `app` tables and sequences |
| `verity_sql_ro` | text-to-SQL execution | `USAGE` on `business_ro`, SELECT only, read-only, 5 s timeout               |

The SQL executor must never reuse the app connection or the migration superuser.
`business_ro` views are the allowlist on top of the SQL validator's checks.

Verify the boundaries after the stack is running:

```bash
make verify-roles
```

Role init scripts run only on a fresh Postgres volume. If you change them, run
`make clean` and `make up` (this deletes local data).

## Development

Install host dependencies once:

```bash
make install          # npm workspaces + services/ai/.venv (Python 3.11)
```

Run Postgres/Redis/MinIO in Docker, then the apps on the host:

```bash
docker compose up -d postgres redis minio minio-init migrate
# For host-run services, set these in .env:
#   POSTGRES_HOST=localhost
#   REDIS_URL=redis://localhost:6379
#   MINIO_ENDPOINT=localhost
npm run dev:api
npm run dev:web
# optional AI service:
cd services/ai && .venv/bin/uvicorn app.main:create_app --factory --reload --port 8000
```

Compose overrides those hostnames for containers, so the same `.env` works for
both modes.

### Commands

```bash
make up               # build + start the stack
make down             # stop, keep volumes
make clean            # stop + delete volumes
make logs             # follow logs
make migrate          # apply pending SQL migrations
make seed             # seed demo users, groups, and documents
make verify-roles     # prove role privileges and boundaries
make test             # Vitest (web, gateway) + pytest (AI)
make test-integration # opt-in PostgreSQL access-filter test (VERITY_TEST_ADMIN_URL)
make lint             # ESLint + Ruff
make typecheck        # tsc --noEmit + mypy strict
make check            # lint + typecheck + test
make format           # Prettier + Ruff format
make audit            # npm audit + pip-audit
make eval             # full eval suite against the running stack
make eval-validate    # validate eval datasets offline (no model calls)
make routing-eval     # router accuracy over evals/datasets/routing.jsonl
make e2e              # Playwright end-to-end suite
```

### Testing notes

- `make install` is required before `make test`, `make lint`, and `make typecheck`.
- The role checks are integration checks: they need the Compose stack running.
- `make test-integration` is opt-in and creates a disposable database. Point
  `VERITY_TEST_ADMIN_URL` at a PostgreSQL admin connection, for example
  `VERITY_TEST_ADMIN_URL=postgresql:///postgres make test-integration`. It uses
  keyword retrieval only, so pgvector is not required.
- LLM calls are mocked in unit tests; real-model runs happen only in `make eval`
  and `make routing-eval`.
- CI runs web/API formatting, lint, typecheck, tests, build; AI lint, format,
  typecheck, tests; and `docker compose build`. The audit job is advisory.

## Roadmap

| Phase | Scope                                                              | Status                                                                                       |
| ----- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 0     | Foundation: monorepo, Compose, roles, health, tests, CI            | Implemented; full cold-start boot not yet verified                                           |
| 1     | Auth, RBAC, design system, app shell, demo users                   | Implemented; unit/integration tests green                                                    |
| 2     | Ingestion, chunking, embeddings, document admin                    | Implemented; unit/integration tests green                                                    |
| 3     | Hybrid retrieval, rerank, citations, SSE chat, refusal             | Implemented; TTFT not measured against a live model                                          |
| 4     | Business data, read-only views, SQL validation, SQL UI             | Implemented                                                                                  |
| 5     | Router, hybrid answers, conversation memory                        | Implemented; routing accuracy not yet measured (see Evaluation)                              |
| 6     | Langfuse tracing, admin metrics, eval harness, feedback            | Implemented; eval datasets validated, live scoring pending key quota                         |
| 7     | Hardening: caches, rate limits, safety, a11y, Playwright E2E, docs | Implemented; E2E needs a live stack (`make e2e`), not yet run in CI; Lighthouse not measured |

## Design and delivery decisions

- `plan.md` is authoritative for behavior and architecture; `design.md` is
  authoritative for visuals. Conflicts are recorded as C1–C12 in
  [`docs/implementation-plan.md`](./docs/implementation-plan.md).
- The design spec's multi-warehouse connectors, global search, cryptographic
  "attestation", fabricated scan counts, and manual route selector are **not**
  implemented. Verity routes automatically on the server and keeps explicit
  Documents/Data modes as an escape hatch.
- RAGAS-style metrics are single-judge LLM scores computed by the local harness,
  not the `ragas` Python package — same metric names, transparent prompts.
- Cost is never fabricated: when token pricing is not configured the dashboard
  reports "Not priced" and cost metadata stays `null`.
- Images are pinned where practical. The MinIO image follows `latest` (currently
  the `coollabsio/minio` mirror because the upstream image was unavailable).
- Langfuse tracing is fail-open by design: chat works with tracing unavailable,
  and the UI degrades gracefully. See
  [`docs/architecture.md#observability`](./docs/architecture.md#observability).

## Documentation

- [`plan.md`](./plan.md) — product and engineering source of truth
- [`design.md`](./design.md) — visual system and UX
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) — phases, risks, conflict resolutions, open questions
- [`docs/architecture.md`](./docs/architecture.md) — services, schemas, roles, startup order, observability
- [`docs/security.md`](./docs/security.md) — authentication, RBAC, rate limiting, safety, database roles
- [`docs/ingestion.md`](./docs/ingestion.md) — document pipeline, storage layout, chunking, statuses, demo corpus
- [`docs/retrieval.md`](./docs/retrieval.md) — hybrid retrieval, reranking, confidence gate, chat streaming
- [`docs/api.md`](./docs/api.md) — public error/health contract, chat SSE, admin metrics, and the internal AI contract
- [`docs/demo-script.md`](./docs/demo-script.md) — step-by-step end-to-end demo walkthrough
- [`DEPLOY.md`](./DEPLOY.md) — Render.com deployment reference
- [`evals/datasets/README.md`](./evals/datasets/README.md) — dataset format and scoring notes
