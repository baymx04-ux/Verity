# Verity Security Model

## Authentication

The gateway issues two credentials on login:

1. **Access JWT** — short-lived (15 minutes), held in memory by the browser, sent as a `Bearer` header on every `/api/*` request.
2. **Refresh token** — long-lived (7 days), stored in an `HttpOnly`, `SameSite=Lax` cookie scoped to `/api/auth`. Its SHA-256 hash is stored in `app.refresh_tokens`; the raw token is never persisted.

Every refresh revokes the presented token and links it to its replacement. Presenting a revoked or replaced token is treated as **refresh reuse**: all active sessions for that user are revoked and a `refresh_reuse` event is written to `app.auth_audit`.

Demo accounts (development only):

| Role   | Email                    | Password             |
|--------|--------------------------|----------------------|
| Admin  | admin@verity.dev         | verity-admin-dev     |
| Analyst| analyst@verity.dev       | verity-analyst-dev   |
| Viewer | viewer@verity.dev        | verity-viewer-dev    |

## Authorization

Three roles are enforced on **every** protected request (the API re-checks the JWT role; the React router additionally hides disallowed routes):

| Role   | Can list users | Can patch roles | Can read groups | Can see restricted docs |
|--------|----------------|-----------------|-----------------|-------------------------|
| Admin  | yes            | yes             | yes             | yes (everything)        |
| Analyst| no             | no              | no              | granted groups only     |
| Viewer | no             | no              | no              | granted groups only     |

Role escalation is prevented at the handler level: only `admin` may call `GET /api/auth/users`, `PATCH /api/auth/users/:id/role`, or `GET /api/auth/groups`. Analyst and viewer requests to these endpoints return `403 Forbidden`.

Access to documents is enforced inside every retrieval SQL arm — no post-filtering. Admin sees everything; analysts see public and internal documents plus restricted documents granted to their groups; viewers see public documents plus explicitly granted restricted documents.

## Rate Limiting

| Endpoint group      | Limit            | Keyed by         |
|---------------------|------------------|------------------|
| Auth (login/refresh)| 10 per minute    | IP address       |
| Chat stream         | 20 per minute    | Authenticated user |
| Document upload     | 10 per hour      | Authenticated user |
| Admin mutations     | 30 per minute    | Authenticated user |
| Feedback            | 60 per minute    | Authenticated user |
| Global API          | 120 per minute   | Authenticated user |

Rate-limit state lives in Redis. Limits are configurable via `AUTH_RATE_LIMIT_PER_MIN`, `CHAT_RATE_LIMIT_PER_MIN`, `ADMIN_RATE_LIMIT_PER_MIN`, and `UPLOAD_RATE_LIMIT_PER_HOUR`.

Request size limits: JSON bodies are capped at 1 MB; file uploads are capped at `UPLOAD_MAX_MB` (default 25 MB) with extension/MIME validation.

## Safety and Prompt Injection

The chat pipeline applies multiple safety layers:

1. **Confidence gate** — if reranked evidence falls below `MIN_RERANK_SCORE`, the answer short-circuits to a refusal instead of generating from weak context.
2. **Citation validation** — every `[n]` citation in a generated answer is validated against the retrieved passages; invalid citations are dropped and counted.
3. **SQL validation** — generated SQL is parsed by sqlglot and validated against a read-only allowlist: no DDL, no DML, no `pg_sleep`, single `business_ro` relation, bounded joins and subquery depth.
4. **Role enforcement** — retrieval applies the caller's role/group predicate, so a viewer can never see restricted documents they are not granted.

The eval harness includes a safety suite (`evals/datasets/safety.jsonl`) covering prompt injection, unsafe SQL, PII requests, restricted access, social engineering, and out-of-scope questions. Each case expects `refuse`, `out_of_scope`, or `answer`.

## Database Roles (Least Privilege)

| Role                    | Purpose                          | Privileges                                                  |
|-------------------------|----------------------------------|-------------------------------------------------------------|
| `postgres` (superuser)  | Cluster init + migrations only   | Superuser; never used by app traffic                        |
| `verity_app`            | API and AI ingestion             | CONNECT, USAGE on `app`; DML on `app` tables/sequences      |
| `verity_sql_ro`         | Text-to-SQL execution            | CONNECT, USAGE on `business_ro`; SELECT only; 5s timeout; read-only transactions |

`make verify-roles` proves both the positive grants and the negative boundaries (no app-schema access for the SQL role, no DDL, no `pg_sleep`).

## Audit

Authentication events (`login`, `logout`, `refresh`, `refresh_reuse`, `role_change`) are written to `app.auth_audit` with user ID, IP hash, and user agent. Every chat message is persisted with `trace_id`, `model`, `cost_usd`, `route_confidence`, `sql_outcome`, `answer_status`, and `metadata` for full observability.

## Security Headers

The API sets standard security headers via the Express gateway: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.
