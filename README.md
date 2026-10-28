# Verity

Verity is a single-tenant, role-based enterprise knowledge base: RAG over internal
documents plus a guarded text-to-SQL layer over live business data. Every answer
is designed to show its evidence — cited document chunks or the SQL that ran.

**Current state:** Phases 0–5 are implemented. Auth, RBAC, the design system, the
app shell, document upload, MinIO storage, the BullMQ ingestion worker, AI
parsing/chunking/embedding, the documents library, hybrid retrieval, reranking,
and grounded SSE chat are in place and covered by the Node and Python suites.
Docker Compose startup is config-validated but a full cold-start run is still
deferred to Phase 7, and the time-to-first-token target has not yet been measured
against a live model. Text-to-SQL (Phase 4) is implemented with read-only
`business_ro` access, schema catalog, SQL validation/execution, and a SQL
results panel. Phase 5 adds automatic intent routing (documents, SQL, hybrid, or
out-of-scope), concurrent document + SQL hybrid answers with partial-failure
degradation, follow-up rewriting on both paths, and route badges in the chat UI.
The routing dataset and harness are in place, but a complete ≥90% measurement is
still pending because the model quota was exhausted mid-run; see
[`evals/datasets/README.md`](./evals/datasets/README.md). See
[`plan.md`](./plan.md) for behavior and [`design.md`](./design.md) for the
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
| http://localhost:5173                | Web app (login → chat shell)                            |
| http://localhost:5173/dev/components | Dev-only component gallery                              |
| http://localhost:4000/api/health     | Gateway health JSON                                     |
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
equipment expenses. Answers stream from the AI service through the gateway, cite
the accessible passages they use, and show the retrieved sources in the evidence
drawer.

The default answer model is `gemini-2.5-flash` (`LLM_MODEL`). Retrieval and the
confidence gate still work without generation when embeddings or the model are
unavailable, but live answers require a valid `GOOGLE_API_KEY`. No latency or
quality numbers are claimed until the demo corpus has been indexed and measured
end to end. See [`docs/retrieval.md`](./docs/retrieval.md) for the pipeline and
[`docs/api.md`](./docs/api.md#chat-and-sse) for the stream contract.

The values in `.env.example` are **development-only placeholders**. Change every
`change-me` value before exposing the stack beyond your machine. `.env` is
gitignored; never commit it.

Stop with `docker compose down`. `make clean` also deletes the Postgres, Redis,
and MinIO volumes, including uploaded documents.

## What exists now

- Monorepo: `apps/web` (React 18, TypeScript strict, Vite, Tailwind, React
  Router, Lucide), `apps/api` (Express, TypeScript strict, Zod, pino, helmet,
  CORS, rate limiting, bcrypt, JWT, BullMQ, S3/MinIO), `services/ai` (FastAPI,
  Pydantic v2, pypdf/docx/BeautifulSoup parsing, structured logs).
- Phase 1 design system: token-based palette/typography/radii, accessible
  primitives (buttons, inputs, cards, badges, tables, dialog, sheet, dropdown,
  tabs, tooltip, alerts, empty states, skeletons), responsive app shell, mobile
  navigation, and a dev-only component gallery.
- Auth: login, short-lived access JWT, rotating refresh cookie with reuse
  detection, logout, `/me`, RBAC middleware, login/refresh rate limits, and
  audit events. Admin-only user list, role patch, and group list APIs exist; the
  management UI lands with a later admin phase.
- Web auth: in-memory access token, silent refresh on load, one-shot retry after
  `401`, protected router, role guards, login screen, user menu, and honest
  environment badge.
- Demo seed: idempotent admin/analyst/viewer users, `finance`, `people`, and
  `engineering` groups, and a 21-document corpus including two conflicting
  revenue reports, a prompt-injection fixture, and restricted documents.
- Document API: multipart upload with extension/MIME/size validation and an
  upload rate limit, MinIO object storage, list/detail/edit/retry/delete,
  five-minute signed downloads, and SQL-side access filtering for
  public/internal/restricted documents and groups.
- Ingestion: BullMQ queue plus a dedicated `worker` process, the
  `queued → processing → ready/failed` lifecycle, three attempts with exponential
  backoff, per-attempt audit rows, chunk/page counts, and actionable failure codes.
- AI ingestion: signed `/ingest` and `DELETE /documents/{id}`, PDF/DOCX/TXT/MD/HTML
  parsing, structure-aware chunking with real overlap, contextual embedding text,
  batched `gemini-embedding-001` calls with retries, a Redis content-hash cache,
  and idempotent chunk replacement.
- Documents UI: drag/drop multi-upload with per-file progress, search/filter/
  pagination, four-second status polling, status and access badges, detail drawer,
  signed download, admin access/group editing, retry, and delete confirmation.
- Retrieval: follow-up query rewriting, role/group access predicates applied
  inside both SQL arms, pgvector cosine search plus Postgres full-text search,
  Reciprocal Rank Fusion, a `RERANK_CANDIDATES` cap before configurable reranking
  (`none`, `local`, or Cohere), retrieval stage spans, and a score-based
  confidence gate. See [`docs/retrieval.md`](./docs/retrieval.md).
- Chat: persistent conversations owned per user, latest-20-turn history, SSE
  streaming with status/route/token/sources events, inline `[n]` citation
  validation (dropped markers counted and logged), honest refusal for weak
  evidence, stop, retry, regenerate, copy, thumbs up/down feedback, and a source
  drawer with real page/section/score metadata and a fresh signed document link.
  Every `done` event includes AI-service `time_to_first_token_ms`, which is also
  persisted in assistant metadata.
- Chat failure handling: the gateway persists partial answers on stop or stream
  failure with `answer_status` (`aborted` / `error`), suppresses the upstream
  `done` event so the client never renders a duplicate, and sends a 15-second
  heartbeat so idle generations survive intermediaries.
- Postgres 16 + pgvector with `app`, `business`, and `business_ro` schemas.
- Two least-privilege login roles, verified by `make verify-roles`:
  - `verity_app`: CONNECT + DML on `app`; no DDL, no `business_ro`.
  - `verity_sql_ro`: CONNECT + SELECT on `business_ro` only; read-only
    transactions, 5 s statement timeout, no `pg_sleep`/file functions.
- A separate `postgres` superuser for init and migrations, because the official
  image otherwise makes the app role a superuser. Application traffic never uses it.
- Versioned SQL migrations, a one-shot `migrate` service, and a private MinIO
  bucket bootstrapped by `minio-init`.
- nginx serving the built web app and proxying `/api` with SSE buffering disabled.
- Unit and integration tests for auth flows (login, rotation/reuse, logout, RBAC,
  validation), the app shell/router, documents UI (upload, filters, access edits,
  delete), gateway error/health contract, upload validation, document access
  filtering, deletion order/cascade, ingestion status and failure classification,
  AI health/config/parsing/chunking/embedding/signed requests, RRF fusion,
  retrieval access predicates and the confidence gate, citation validation,
  refusal behaviour, SSE parsing on both Node and web, chat abort/regenerate
  persistence, and RTL chat citations/feedback.
- ESLint, Prettier, Ruff, mypy strict, Vitest, pytest, and a GitHub Actions CI
  skeleton with a dependency audit.

## Repository layout

```text
apps/web                 React 18 + Vite + Tailwind (served by nginx in Compose)
apps/api                 Express gateway
services/ai              FastAPI retrieval/SQL service (internal only)
infra/postgres           init scripts, migrations, role verification
infra/nginx              static build + /api proxy
infra/docker-compose.yml services, health checks, volumes
evals                    RAGAS / routing / SQL evaluation harness (Phase 6)
docs                     implementation plan, architecture, API contract
compose.yaml             root include so `docker compose up` works from the repo root
```

## Database roles

| Role            | Used by               | Grants                                                                      |
| --------------- | --------------------- | --------------------------------------------------------------------------- |
| `postgres`      | init + migrations     | superuser; not used by request traffic                                      |
| `verity_app`    | API, AI ingestion     | `USAGE` on `app`, SELECT/INSERT/UPDATE/DELETE on `app` tables and sequences |
| `verity_sql_ro` | text-to-SQL execution | `USAGE` on `business_ro`, SELECT only, read-only, 5 s timeout               |

The SQL executor must never reuse the app connection or the migration superuser.
`business_ro` views are the allowlist; the future sqlglot validator adds the
application-level checks (single SELECT, view allowlist, enforced LIMIT).

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
make up              # build + start the stack
make down            # stop, keep volumes
make clean           # stop + delete volumes
make logs            # follow logs
make migrate         # apply pending SQL migrations
make seed            # seed demo users, groups, and documents
make verify-roles    # prove role privileges and boundaries
make test            # Vitest (web, gateway) + pytest (AI)
make test-integration # opt-in PostgreSQL access-filter test (VERITY_TEST_ADMIN_URL)
make lint            # ESLint + Ruff
make typecheck       # tsc --noEmit + mypy strict
make check           # lint + typecheck + test
make format          # Prettier + Ruff format
make audit           # npm audit + pip-audit
```

### Testing notes

- `make install` is required before `make test`, `make lint`, and `make typecheck`.
- The role checks are integration checks: they need the Compose stack running.
- `make test-integration` is opt-in and creates a disposable database. Point
  `VERITY_TEST_ADMIN_URL` at a PostgreSQL admin connection, for example
  `VERITY_TEST_ADMIN_URL=postgresql:///postgres make test-integration`. It uses
  keyword retrieval only, so pgvector is not required.
- CI runs web/API formatting, lint, typecheck, tests, build; AI lint, format,
  typecheck, tests; and `docker compose build`. The audit job is advisory.
- There is no RAGAS evaluation yet. RAGAS scores land in Phase 6; nothing is
  fabricated. Phase 5 ships a labeled routing dataset and `make routing-eval`.
  A complete routing accuracy run is deferred until model quota is available.

## Roadmap

| Phase | Scope                                                   | Status                                                 |
| ----- | ------------------------------------------------------- | ------------------------------------------------------ |
| 0     | Foundation: monorepo, Compose, roles, health, tests, CI | Implemented; Docker cold start deferred                |
| 1     | Auth, RBAC, design system, app shell, demo users        | Implemented; unit/integration tests green              |
| 2     | Ingestion, chunking, embeddings, document admin         | Implemented; unit/integration tests green              |
| 3     | Hybrid retrieval, rerank, citations, SSE chat, refusal  | Implemented; DB leakage test added, live TTFT deferred |
| 4     | Business data, read-only views, SQL validation, SQL UI  | Implemented                                            |
| 5     | Router, hybrid answers, conversation memory             | Implemented; routing accuracy measurement incomplete   |
| 6     | Langfuse, metrics, eval harness, feedback               | Planned                                                |
| 7     | Hardening, load tests, accessibility, cold-start docs   | Planned                                                |

## Design and delivery decisions

- `plan.md` is authoritative for behavior and architecture; `design.md` is
  authoritative for visuals. Conflicts are recorded as C1–C12 in
  [`docs/implementation-plan.md`](./docs/implementation-plan.md).
- The design spec's multi-warehouse connectors, global search, cryptographic
  "attestation", fabricated scan counts, and manual route selector are **not**
  implemented. Verity routes automatically on the server and keeps explicit
  Documents/Data modes as an escape hatch.
- Langfuse is deferred to Phase 6 rather than mocked.
- Images are pinned where practical. The MinIO image follows `latest` (currently
  the `coollabsio/minio` mirror because the upstream image was unavailable); it
  will be pinned during the Phase 7 hardening pass.

## Documentation

- [`plan.md`](./plan.md) — product and engineering source of truth
- [`design.md`](./design.md) — visual system and UX
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) — phases, risks, conflict resolutions, open questions
- [`docs/architecture.md`](./docs/architecture.md) — services, schemas, roles, startup order
- [`docs/ingestion.md`](./docs/ingestion.md) — document pipeline, storage layout, chunking, statuses, demo corpus
- [`docs/retrieval.md`](./docs/retrieval.md) — hybrid retrieval, reranking, confidence gate, chat streaming
- [`docs/api.md`](./docs/api.md) — public error/health contract, chat SSE, and the internal AI contract
