# Verity Architecture

**Status:** Phase 0 foundation is locally verified; Phase 1 (auth, RBAC, design
system, app shell) is in verification. This document describes the target shape
and marks what exists today. Behavioral source of truth:
[`../plan.md`](../plan.md).

## Services

```text
Browser
  │  HTTPS / SSE
  ▼
web (React 18 + Vite build, nginx)
  │  /api
  ▼
api (Express + TypeScript, gateway)
  ├── Postgres 16 + pgvector   app schema (documents, chunks, users, conversations)
  ├── Redis 7                  queues, caches, rate-limit state
  ├── MinIO                    original documents and extracted text
  └── ai (FastAPI, internal)   retrieval, rerank, LLM, SQL generation/validation
                                   │
                                   └── Postgres business_ro views (read-only role)
```

The browser never talks to Postgres, Redis, MinIO, or the AI service directly.
The AI service is internal-only; the gateway owns authentication, authorization,
uploads, SSE, and the public API. Text-to-SQL execution uses a separate
`verity_sql_ro` connection that can only read vetted `business_ro` views.

## Authentication and sessions

The gateway issues a short-lived access JWT (in-memory in the browser) and a
rotating refresh token in an `HttpOnly` cookie scoped to `/api/auth`. The refresh
token's SHA-256 hash is stored in `app.refresh_tokens`; the raw token is never
persisted. Every refresh revokes the presented token and links it to its
replacement. Presenting a revoked/replaced token is treated as reuse: all active
sessions for that user are revoked and `refresh_reuse` is written to
`app.auth_audit`.

Authorization happens twice: the React router hides disallowed routes and the
API re-checks the JWT role on every protected request. Roles are `admin`,
`analyst`, and `viewer`; only `admin` can list users, patch roles, or read groups.
The web client performs a silent refresh on load and retries one protected
request after a `401`.

## Current components

| Component     | Current state                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`    | Token-based design system, primitives, auth context/silent refresh, router guards, login, shell, conversation/source shells, dev gallery |
| `apps/api`    | Express gateway with health, auth routes, RBAC middleware, refresh rotation/reuse detection, audit events, tests                         |
| `services/ai` | FastAPI `/health`, structured logs, tests                                                                                                |
| Postgres      | pgvector, `app` / `business` / `business_ro` schemas, versioned migrations including users/groups/refresh tokens                         |
| Roles         | `verity_app` (DML on `app`) and `verity_sql_ro` (SELECT on `business_ro`)                                                                |
| Redis / MinIO | Running with health checks; bucket bootstrapped by `minio-init`                                                                          |
| Web / API     | Static build served by nginx, `/api` proxy with SSE buffering disabled                                                                   |
| Langfuse      | Deferred to Phase 6 (plan §16); not faked                                                                                                |

## Database roles

The official Postgres image needs a superuser to initialize the cluster. Using
`verity_app` as that superuser would silently violate the least-privilege
requirement in `plan.md`, so Phase 0 separates them:

| Role                              | Purpose                | Privileges                                                                       |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `postgres` (`POSTGRES_SUPERUSER`) | init + migrations only | superuser, never used by app traffic                                             |
| `verity_app`                      | API and AI ingestion   | CONNECT, USAGE on `app`, DML on `app` tables/sequences                           |
| `verity_sql_ro`                   | text-to-SQL execution  | CONNECT, USAGE on `business_ro`, SELECT only, 5s timeout, read-only transactions |

`make verify-roles` proves both the positive grants and the negative boundaries
(no app-schema access for the SQL role, no DDL, no `pg_sleep`).

## Startup order

`postgres`, `redis`, and `minio` become healthy → `migrate` records/apply SQL
migrations and `minio-init` creates the private bucket → `ai` and `api` start →
`web` starts after the API is healthy. Demo users are created separately with
`make seed` (host Node against the exposed Postgres port).

## Planned boundaries

- **Phase 1 (in verification):** auth (JWT + rotating refresh cookie), RBAC, app schema tables, design system, app shell.
- **Phase 2:** ingestion (upload → MinIO → parse → chunk → embed), BullMQ worker, document UI.
- **Phase 3:** hybrid retrieval, RRF, rerank, citations, SSE chat, refusal gate.
- **Phase 4:** `business` seed data, `business_ro` views, sqlglot validation, read-only execution, SQL UI.
- **Phase 5:** admin metrics/traces, modern UI polish, a11y pass.
- **Phase 6:** Langfuse, RAGAS eval harness, audit/retention.
- **Phase 7:** hardening, load tests, final docs.

## Non-goals

No multi-warehouse connectors, global search, cryptographic attestation,
fabricated scan counts, or manual route selector. These appear in the
supplementary design spec but are not backed by `plan.md`; see C1–C12 in
[`implementation-plan.md`](./implementation-plan.md).
