# Verity

Verity is a single-tenant, role-based enterprise knowledge base: RAG over internal
documents plus a guarded text-to-SQL layer over live business data. Every answer
is designed to show its evidence — cited document chunks or the SQL that ran.

**Current state:** Phase 0 foundation is locally verified; Phase 1 (auth, RBAC,
design system, app shell) is in verification. Docker startup was deferred during
Phase 1 work, so the Compose stack has been config-validated but not re-run end to
end after the auth changes. Chat, ingestion, retrieval, and SQL arrive in later
phases. See [`plan.md`](./plan.md) for behavior and [`design.md`](./design.md) for
the visual system.

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

The values in `.env.example` are **development-only placeholders**. Change every
`change-me` value before exposing the stack beyond your machine. `.env` is
gitignored; never commit it.

Stop with `docker compose down`. `make clean` also deletes the Postgres, Redis,
and MinIO volumes, including uploaded documents.

## What exists now

- Monorepo: `apps/web` (React 18, TypeScript strict, Vite, Tailwind, React
  Router, Lucide), `apps/api` (Express, TypeScript strict, Zod, pino, helmet,
  CORS, rate limiting, bcrypt, JWT), `services/ai` (FastAPI, Pydantic v2,
  structured logs).
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
- Demo seed: idempotent admin/analyst/viewer users and `finance`, `people`, and
  `engineering` groups.
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
- Unit tests for auth flows (login, rotation/reuse, logout, RBAC, validation),
  the app shell/router, gateway error/health contract, and AI health/config.
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
make seed            # create demo admin/analyst/viewer users
make verify-roles    # prove role privileges and boundaries
make test            # Vitest (web, gateway) + pytest (AI)
make lint            # ESLint + Ruff
make typecheck       # tsc --noEmit + mypy strict
make check           # lint + typecheck + test
make format          # Prettier + Ruff format
make audit           # npm audit + pip-audit
```

### Testing notes

- `make install` is required before `make test`, `make lint`, and `make typecheck`.
- The role checks are integration checks: they need the Compose stack running.
- CI runs web/API formatting, lint, typecheck, tests, build; AI lint, format,
  typecheck, tests; and `docker compose build`. The audit job is advisory.
- There is no RAGAS evaluation yet. Datasets and scores land in Phase 6; nothing
  is fabricated for Phase 0.

## Roadmap

| Phase | Scope                                                   | Status                                    |
| ----- | ------------------------------------------------------- | ----------------------------------------- |
| 0     | Foundation: monorepo, Compose, roles, health, tests, CI | Locally verified; Docker startup deferred |
| 1     | Auth, RBAC, design system, app shell, demo users        | In verification                           |
| 2     | Ingestion, chunking, embeddings, document admin         | Next                                      |
| 3     | Hybrid retrieval, rerank, citations, SSE chat, refusal  | Planned                                   |
| 4     | Business data, read-only views, SQL validation, SQL UI  | Planned                                   |
| 5     | Admin metrics/traces, polish, accessibility             | Planned                                   |
| 6     | Langfuse, RAGAS evals, retention                        | Planned                                   |
| 7     | Hardening, load tests, final docs                       | Planned                                   |

## Design and delivery decisions

- `plan.md` is authoritative for behavior and architecture; `design.md` is
  authoritative for visuals. Conflicts are recorded as C1–C12 in
  [`docs/implementation-plan.md`](./docs/implementation-plan.md).
- The design spec's multi-warehouse connectors, global search, cryptographic
  "attestation", fabricated scan counts, and manual route selector are **not**
  implemented because the plan does not define them.
- Langfuse is deferred to Phase 6 rather than mocked.
- Images are pinned where practical; `minio/mc` currently follows `latest` and
  will be pinned when the ingestion pipeline lands.

## Documentation

- [`plan.md`](./plan.md) — product and engineering source of truth
- [`design.md`](./design.md) — visual system and UX
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) — phases, risks, conflict resolutions, open questions
- [`docs/architecture.md`](./docs/architecture.md) — services, schemas, roles, startup order
- [`docs/api.md`](./docs/api.md) — public error/health contract and planned SSE shape
