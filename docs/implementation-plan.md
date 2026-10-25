# Verity — Implementation Plan

**Status:** Approved for implementation. Phases 0–3 are implemented and covered by the Node/Python test suites; Docker cold-start and a measured time-to-first-token run are deferred to Phase 7. Phase 4 (text-to-SQL) is next. Application features begin with Phase 1 auth, RBAC, and the app shell.
**Sources:** `plan.md` (behavior, architecture, scope), `design.md` (visual system, UX), `verity_slate_design.md_specification.md` (supplementary design spec).
**Precedence:** `plan.md` wins on behavior and architecture; `design.md` wins on visuals and UX. The supplementary spec is used only where it does not contradict either.

---

## 0. How to approve

Reply with either:

1. **"Approved as written"**, or
2. Answers to the blocking questions in §12 (numbered Q1–Q8) and any overrides to the defaults in §4.3.

I will not start Phase 0 until this plan and the blocking decisions are approved. I will then build phases in order, stopping after each phase for review.

---

## 1. What the source documents lock

| Area          | Locked decision                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Product       | Single-tenant, role-based enterprise knowledge base with RAG + text-to-SQL                                                             |
| Roles         | `admin`, `analyst`, `viewer`; access levels `public`, `internal`, `restricted`                                                         |
| Frontend      | React 18, TypeScript strict, Vite, Tailwind, shadcn/ui primitives, Lucide, TanStack Query, Zustand, React Router                       |
| Gateway       | Node 20+, Express, TypeScript strict, Zod, JWT + rotating refresh cookie, Multer, MinIO SDK, BullMQ, pino, helmet, CORS, rate limiting |
| AI service    | Python 3.11+, FastAPI, Pydantic v2, LlamaIndex, sqlglot, psycopg v3, configurable LLM/embeddings/reranker, RAGAS                       |
| Data          | Postgres 16 + pgvector, Redis 7, MinIO; `app` and `business` schemas; `business_ro` views                                              |
| SQL safety    | SELECT-only, parsed, single statement, allowlisted views, enforced LIMIT, 5s timeout, read-only role                                   |
| Streaming     | SSE with `status`, `route`, `token`, `sql`, `sources`, `error`, `done` events                                                          |
| RAG           | Query rewrite, access-filtered hybrid retrieval, RRF, rerank, confidence gate, inline citations, untrusted-context prompt              |
| Observability | Langfuse trace per chat with stage spans; trace id stored on the assistant message                                                     |
| Evals         | RAGAS + citation correctness + SQL execution accuracy + routing + refusal                                                              |
| Delivery      | 8 phases (0–7), one `docker compose up`, Makefile, docs, tests, lint                                                                   |

---

## 2. Conflicts found and how I propose to resolve them

These are real contradictions between the documents. I will not silently pick one.

### 2.1 Architecture / product

| #   | Conflict                                                                                                                                                                                               | Resolution                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Supplementary spec says **React 19 + Next.js App Router**; `plan.md` says **React 18 + Vite + React Router**                                                                                           | Plan wins: React 18 + Vite. No Next.js.                                                                                                                                                                          |
| C2  | Supplementary spec shows **four connected warehouses** (Postgres, Snowflake, BigQuery, ClickHouse); plan has **one Postgres**                                                                          | Plan wins: one Postgres instance, one business schema, one "connected database" card. No connector UI.                                                                                                           |
| C3  | Supplementary spec describes **SHA-256 attestation**, "Zero-Knowledge Hash", and proof roots; plan has no checksum/signature feature                                                                   | Do not fabricate cryptographic claims. The verification strip pattern will display real metadata only: trace id, retrieval scores, row counts, timings, source document.                                         |
| C4  | Design shell has a global **"Search schemas, logs, queries..."** field and an **Audit Trail** tab; plan defines no global search and no audit screen                                                   | Proposed: "Audit Trail" maps to the admin metrics/traces page (admin only). Global search is omitted unless approved. See Q7.                                                                                    |
| C5  | Design shows **"Production Replica (Live)"** and a fixed **14ms replica latency**; there is no replica in the plan                                                                                     | Render honest environment/health data instead: "Local demo" / "Production", real `/health` dependency latency, real system status. Style retained.                                                               |
| C6  | Design upload copy says **150 MB**; plan caps uploads at **25 MB default**                                                                                                                             | Plan wins: 25 MB, configurable via `.env`.                                                                                                                                                                       |
| C7  | Design composer shows **"+ Add Grounding Doc"** and **"Auto (Smart Route)"** selector; plan has automatic routing and no per-query document grounding                                                  | Do not add those controls. Show routing as automatic; grounding set remains the accessible document corpus.                                                                                                      |
| C8  | Design uses a **conversation-less analytics workspace** with an evidence drawer; plan requires a conversation list                                                                                     | Three-zone desktop layout: conversation rail (left), chat workspace (center), evidence/source drawer (right, 380px). Rails collapse to drawers below 1280px.                                                     |
| C9  | Spec labels SQL "**zero AST mutator verification**" and answers "**Attested by Verity Engine**"; the validator deliberately mutates the AST to inject/cap `LIMIT`, and there is no attestation service | Report the real checks instead: AST parsed, single SELECT, views allowlisted, `LIMIT n` enforced, read-only role, execution time. Label answers "Grounded by Verity" with citation/SQL evidence, not "attested". |
| C10 | Spec's ledger card shows "**Scanned rows: 1,842,910**" and an "efficiency comparison progress bar"; the plan does not collect `EXPLAIN` scan stats and excludes chart generation                       | Show rows returned, execution time, query id, row cap, and truncation flag. No fabricated scan counts or comparison charts. Generic SQL results render as a table, not a bespoke cohort visualization.           |
| C11 | Spec's header shows "**Session #VR-8492**" and a "**Zero-Knowledge Hash**"                                                                                                                             | Use the real conversation id (shortened) and trace id, with a link to the trace. No hash claim.                                                                                                                  |
| C12 | Spec's Knowledge Base metrics ("1,482 documents", "4 Active", "480k paragraphs", "Last cycle 4m ago") are illustrative mock data                                                                       | Render real counts: documents, one connected database, embedding dimension, last successful ingestion, indexed chunk count, failed jobs.                                                                         |

### 2.2 Design tokens

`design.md` contains three palettes: YAML front matter (Material-style), the body palette, and the supplementary spec. Key conflicts:

| Token               | Front matter | Body / spec                           | Proposal                                                                                                                                                                                                            |
| ------------------- | ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive primary | `#006194`    | `#0284C7` (buttons, focus, citations) | **`#006194` for primary actions**, `#0284C7` for focus rings/active accents. Reason: white 14px text on `#0284C7` is ≈4.1:1 and fails WCAG AA; on `#006194` it is ≈6.7:1. Design rules require accessible contrast. |
| Primary hover       | —            | `#0369A1`                             | `#004B73` for the `#006194` action, `#0369A1` for accent/link hover                                                                                                                                                 |
| Canvas              | `#FAF8FF`    | `#F8FAFC` body, `#FAF8FF` spec        | App canvas `#FAF8FF`; inset/muted surfaces `#F8FAFC`/`#F1F5F9`                                                                                                                                                      |
| Success             | `#006C4A`    | `#059669` / `#10B981`                 | Badge: bg `#ECFDF5`, border `#A7F3D0`, text `#047857`; dot `#059669`                                                                                                                                                |
| Destructive         | `#BA1A1A`    | `#E11D48` / `#EF4444`                 | Text `#BA1A1A`; badge text `#BE123C` (AA); containment `#FFF1F2`                                                                                                                                                    |
| Warning             | `#B45309`    | `#D97706`                             | Text `#B45309`; containment `#FFFBEB` (body amber fails AA for 12–14px text)                                                                                                                                        |
| Radii               | 24/16/8 px   | Spec says 12/8 px                     | Follow `design.md` shapes: cards 24px, nested 16px, controls 8px, badges pill                                                                                                                                       |

All exact values will be encoded once in `apps/web/src/styles/tokens.css` and mapped into `tailwind.config.ts`; no hardcoded hex values in components. Phase 1 includes an automated contrast check for text/background pairs.

### 2.3 Other ambiguities

- `plan.md` references `design.md`, but the file was named `DESIGN.md`. macOS hides this; Linux/CI does not. Phase 0 renames it to `design.md`.
- `plan.md` specifies Tailwind but not a version; the spec says v3.4+. I will use Tailwind 3.4 with shadcn/ui (React 18 compatible).
- `design.md` requires Manrope/Inter; the supplementary spec allows JetBrains Mono for SQL. Fonts will be self-hosted for offline Docker (see D14).
- The supplementary spec targets 1280px minimum; the plan requires responsive layouts. Plan wins: support 375px, 768px, 1024px, 1280px, and 1600px.
- The spec's heading sizes (22/28 to 28/36) differ slightly from `design.md`'s front-matter scale (36/44, 28/36, 20/28, 16/24). `design.md` wins: use its scale, with the spec's 14/22 body and 11/16 uppercase meta labels. Mono is used only for SQL, ids, and tabular figures.

### 2.4 Details adopted from the supplementary spec

The file `verity_slate_design.md_specification.md` is not discarded: its layout logic and component recipes are the visual basis for the screens, subject to the resolutions above.

| Spec detail                    | How it is adopted                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top nav + footer trust strip   | Top bar with brand mark, centered role-aware tabs, honest environment badge, user menu; slim footer with copyright, security link, real health latency, real system status            |
| Two-column analytics workspace | Chat workspace + 380px evidence drawer; conversation rail added on the left because the plan requires conversation history                                                            |
| Knowledge Base dashboard       | Three metric cards (documents, connected database, index health), upload dropzone, recent uploads table, single database card with real status and `Sync Schema` action               |
| Citation chip behavior         | Inline chip scrolls/focuses the source drawer and highlights the excerpt with a sky-accent ring                                                                                       |
| SQL progressive disclosure     | Accordion labeled "View generated SQL & execution details" (copy adjusted to avoid claiming an execution plan we do not capture) with copy action, timing, and real validation checks |
| Table styling                  | `#F8FAFC` header, uppercase `label-sm` `#64748B`, 48–56px rows, `#F8FAFC` hover, horizontal hairlines only                                                                            |
| Badge variants                 | `live` emerald, `analyst` sky, `restricted` rose; plus `public`/`internal` access badges                                                                                              |
| Status strip                   | Emerald left border (3px `#059669`), white surface, hairline border, real metadata only                                                                                               |
| Surfaces                       | Canvas `#FAF8FF`, white cards, `#E2E8F0` hairline, `#F8FAFC` insets, `#F1F5F9` muted, `#E0F2FE` active-nav pill                                                                       |
| Radius philosophy              | 24px cards, 16px nested panels, 8px controls, pills for badges (per `design.md`)                                                                                                      |

**Token recipes to encode once**

- Active nav: bg `#E0F2FE`, text `#075985`; focus ring `#0284C7` at 12% alpha.
- Citation chip: bg `#F0F9FF`, text `#0369A1`, border `#BAE6FD`, hover `#E0F2FE`; 12px medium; 4px radius (chips are not badges).
- Badges: `live` bg `#ECFDF5` / border `#A7F3D0` / text `#047857`; `analyst` bg `#F0F9FF` / border `#BAE6FD` / text `#0369A1`; `restricted` bg `#FFF1F2` / border `#FECDD3` / text `#BE123C`.
- Card elevation: custom `shadow-xs` = `0 1px 3px 0 rgba(15,23,42,.03), 0 1px 2px -1px rgba(15,23,42,.02)` (Tailwind 3.4 has no default `shadow-xs`).
- Source excerpt: `#F8FAFC` inset, `#E2E8F0` border, italic `body-sm`, quoted text.
- Tables: no vertical cell dividers; numeric cells right-aligned with `tabular-nums`; long cells truncate with title/expand.

---

## 3. Scope guardrails

### 3.1 In scope (v1)

Everything in `plan.md` §§1–19, including all eight phases and the demo dataset.

### 3.2 Explicitly out of scope

- Multi-tenancy, billing, self-signup, SSO/SCIM.
- Write/DDL against the business database.
- Document connectors (Drive, Notion, SharePoint).
- Multi-warehouse connections (Snowflake, BigQuery, ClickHouse).
- Chart generation from SQL results, mobile native apps.
- Fine-tuning, human review queue, per-column SQL permissions.
- Fabricated cryptographic attestation / zero-knowledge proofs.
- Global search and per-query document grounding (not in plan).

### 3.3 Technologies I will **not** add without approval

No ORM (Prisma/Drizzle), no Qdrant, no Kafka, no LangGraph, no vector DB service, no auth SaaS, no charting library, no UI kit beyond shadcn/Radix/Lucide, no Faker. Necessary utilities that implement a stated requirement (SSE parser, font packages, SQL highlighter, local reranker) are called out in §4.3.

---

## 4. Assumptions

### 4.1 Product assumptions

- **A1 — Single organization.** All users belong to one org; groups exist only for restricted-document grants.
- **A2 — Viewer database access.** All authenticated roles may query all `business_ro` views. Per-role/per-column SQL restrictions are future work per plan §21. Restricted _documents_ remain filtered.
- **A3 — Analyst uploads** default to `internal`. Only admins can change access level or delete.
- **A4 — Groups are seeded/fixed in v1.** `PATCH /admin/users/:id` can assign memberships; no group CRUD screen. Admin can grant restricted docs to those groups.
- **A5 — First-user bootstrap.** `/auth/register` creates an admin only when the users table is empty; afterwards it is admin-only. Demo users are seeded, so normal use starts with login.
- **A6 — Conversation titles** default to "New conversation" and are set from the first question (truncated). No auto-summarization.
- **A7 — "I don't know"** is a successful answer with `answer_status = insufficient_context`, not an error.
- **A8 — The AI service is internal-only.** It is not published on a host port in Compose; the gateway proxies it.
- **A9 — The demo needs real provider keys** for a meaningful end-to-end run. Tests mock LLMs. Without keys, the UI shows a clear configuration error rather than fake answers.
- **A10 — Eval datasets are authored content.** 60 docs questions, 40 SQL questions, 40 routing questions, and safety cases will be written during Phase 6 against the seeded corpus.

### 4.2 Data-model gaps that must be filled

The plan's §6.1 schema omits things its own requirements need. Proposed additions, all minimal:

| Gap                      | Why it is needed                                                                                       | Proposed addition                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Refresh-token storage    | §11 requires rotating, hashed refresh tokens; no table exists                                          | `app.refresh_tokens(id, user_id, token_hash, family_id, expires_at, created_at, revoked_at, replaced_by)`                                  |
| Message metrics metadata | §12.2 needs model, cost, route confidence, answer status, SQL validation failures; §6.1 has no columns | `messages.metadata jsonb` with documented keys; no new service                                                                             |
| SQL few-shot examples    | §9.1 retrieves vetted examples by similarity; no table exists                                          | Versioned YAML/config file in the AI service, embedded at startup and cached in Redis. No new table.                                       |
| Regenerate               | §14 requires regenerate; `/chat/stream` has no way to avoid duplicating the user message               | Optional `regenerate_message_id` in the chat request; gateway replaces the prior assistant message and does not re-insert the user message |
| Schema refresh trigger   | AI has `/schema/refresh`; admin UI needs a trigger; gateway contract has none                          | `POST /api/admin/schema-catalog/refresh` → AI `/schema/refresh`                                                                            |
| Eval results in admin    | Role table says admins view eval results; no endpoint exists                                           | Decide in Q8. Default: metrics page links to the latest report artifact; no eval API in v1.                                                |
| Group membership editing | Restricted grants need membership changes                                                              | `PATCH /admin/users/:id` accepts `group_ids`; groups are seeded                                                                            |

I will document these in `docs/api.md` and `docs/architecture.md`. They add no new services or libraries.

### 4.3 Implementation defaults (approve or override)

| #   | Default                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **npm workspaces** for `apps/*`; plain **pip + pinned `requirements.txt`** for Python (no Poetry/uv).                                                                                            |
| D2  | **Versioned plain-SQL migrations** applied by a one-shot `migrate` Compose service using `psql` and a `schema_migrations` table. No ORM.                                                         |
| D3  | **Seed generator in stdlib Python** (deterministic `random.Random(seed)`, no Faker); batch inserts. Demo documents generated with PyMuPDF (PDF) and python-docx (DOCX), plus static MD/TXT/HTML. |
| D4  | **argon2id** password hashing; 15-minute access JWT; 7-day rotating refresh token; `httpOnly`, `Secure` in production, `SameSite=Lax`; origin check on refresh/logout.                           |
| D5  | Access token held in memory only; refresh cookie is the only persistent credential. Silent refresh on 401.                                                                                       |
| D6  | Password minimum 12 characters. Login errors are generic. Auth rate limit 10/min/IP; chat 20/min/user; upload 10/hour/user.                                                                      |
| D7  | **Internal auth:** HMAC-SHA256 signature over method + path + timestamp + body hash, using `INTERNAL_SERVICE_TOKEN`; 60-second replay window. AI fails closed.                                   |
| D8  | **RRF k=60**; 30 vector + 30 keyword candidates; rerank top 20 → 6; normalized score threshold `0.25`. Values remain configurable per plan §15.                                                  |
| D9  | **Router:** confidence ≥ 0.70 uses the predicted route; below 0.70 defaults to `hybrid`. Clarification is used only when SQL generation reports ambiguity or missing schema.                     |
| D10 | Conversation memory: last 10 messages, capped at ~6k tokens; query rewrite for follow-ups.                                                                                                       |
| D11 | SQL: display cap 200 rows, hard cap 1000, 5s timeout, max 2 repairs, max 5 joins, max subquery depth 3, max 8 relations.                                                                         |
| D12 | Upload: 25 MB, allowlist PDF/DOCX/TXT/MD/HTML; extension + declared MIME + parser rejection. Virus-scan hook documented, not implemented. Signed download URLs expire in 5 minutes.              |
| D13 | **MinIO public endpoint** (`localhost:9000`) is separate from the internal endpoint so browser download URLs work.                                                                               |
| D14 | Fonts self-hosted via `@fontsource-variable/manrope`, `inter`, `jetbrains-mono` (no CDN, works offline).                                                                                         |
| D15 | SQL syntax highlighting via a small Prism-based highlighter (`react-syntax-highlighter` light build) because plan §3.1 requires it. Markdown via `react-markdown` + `remark-gfm`.                |
| D16 | Metrics charts are hand-rolled SVG/CSS (no chart library) unless you prefer Recharts.                                                                                                            |
| D17 | CSV export of SQL results is client-side from the already-returned rows (no new endpoint).                                                                                                       |
| D18 | Langfuse tracing fails open: if keys/host are absent, emit a local trace id and structured logs; never block a chat. Prompt/response redaction is configurable.                                  |
| D19 | Frontend served in Compose by nginx static build with `/api` reverse proxy, SSE buffering disabled. Dev uses Vite proxy.                                                                         |
| D20 | Commit convention: Conventional Commits (`feat(api):`, `fix(web):`, `chore(infra):`), one logical change per commit. No phase-sized commits.                                                     |
| D21 | Define a custom Tailwind `shadow-xs` token matching `design.md` Level 1 elevation; do not rely on a Tailwind default that v3.4 lacks.                                                            |
| D22 | Use the supplementary spec's 14/22 body and 11/16 uppercase meta labels, with `design.md`'s heading scale and JetBrains Mono for SQL/ids.                                                        |

---

## 5. Proposed repository structure

```text
verity/
  apps/
    web/
      src/
        main.tsx, App.tsx
        routes/                  login, chat, documents, admin/*
        components/
          ui/                    design-system primitives (shadcn/Radix based)
          layout/                top nav, footer, conversation rail, drawers
          chat/                  composer, message list, status, feedback
          citations/             inline chips, source drawer, excerpt
          sql/                   SQL panel, result table, copy/CSV
          documents/             dropzone, status badge, filters, edit dialog
          admin/                 users, schema catalog, metrics
        features/                auth, chat, documents, admin hooks/queries
        lib/                     api client, SSE parser, formatting, auth store
        stores/                  Zustand UI/stream state
        styles/                  tokens.css, globals.css
        test/                    RTL setup + component tests
      tailwind.config.ts
      vite.config.ts
      Dockerfile
    api/
      src/
        index.ts                 HTTP server
        worker.ts                BullMQ ingestion worker
        config/                  env validation (Zod)
        db/                      pool, migrations runner, repositories
        middleware/              auth, rbac, validate, errors, rate limit, request id
        modules/                 auth, documents, conversations, chat, feedback, admin, health
        queue/                   BullMQ setup + ingestion producer
        storage/                 MinIO client, signed URLs
        ai-client/               signed internal HTTP client + SSE proxy
        tests/
      Dockerfile
  services/
    ai/
      app/
        main.py
        routers/                 chat, ingest, health, admin(schema/documents)
        pipeline/
          router.py
          rag/                   parse, clean, chunk, rewrite, retrieve, fuse, rerank, generate, citations
          sql/                   catalog, generate, validate, execute, repair, synthesize, few_shots.yaml
          llm/                   provider interface + anthropic/openai/ollama
          tracing/               interface + langfuse/noop
        core/                    config, logging, security (HMAC), errors
        db/                      app pool, business read-only pool
        models/                  Pydantic request/response/event models
      tests/
      pyproject.toml
      Dockerfile
  infra/
    docker-compose.yml
    nginx/                       web static + /api proxy
    postgres/
      init/                      extension, schemas, roles, grants, verification
      migrations/                versioned SQL
    seed/                        business data, demo users, demo document corpus
  evals/
    datasets/                    docs_qa.jsonl, sql_qa.jsonl, routing.jsonl, safety.jsonl
    metrics/                     ragas, sql accuracy, routing, citations, refusal
    reports/                     generated markdown + JSON history
    run_evals.py
  docs/
    implementation-plan.md       this file
    architecture.md
    api.md
    adr/
    demo-script.md
    security.md
  .github/workflows/ci.yml
  .env.example
  .gitignore
  .editorconfig
  Makefile
  package.json
  plan.md
  design.md
  README.md
```

---

## 6. Service boundaries and ownership

| Service      | Owns                                                                                                                          | Must not                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **web**      | Rendering, client state, SSE consumption, accessibility                                                                       | Talk to Postgres, AI, Redis, or MinIO directly                            |
| **api**      | Auth/sessions, RBAC, uploads, document metadata, conversations/messages, feedback, admin APIs, queue orchestration, SSE proxy | Contain LLM prompts, retrieval, SQL generation, or SQL validation         |
| **worker**   | Ingestion jobs; calls AI `/ingest`; updates document status/error                                                             | Reimplement parsing or embedding                                          |
| **ai**       | Routing, RAG, SQL generation/validation/execution, answer synthesis, chunks, schema catalog, traces                           | Trust browser input directly; expose a public port; write business tables |
| **postgres** | `app` schema (OLTP) and `business`/`business_ro` (demo)                                                                       | —                                                                         |
| **redis**    | Queue, rate limiting, embedding cache, repeated-question cache                                                                | Act as source of truth                                                    |
| **minio**    | Original uploaded files                                                                                                       | Serve as a public bucket                                                  |
| **langfuse** | Traces/spans                                                                                                                  | Block chat when unavailable                                               |

**Data ownership details**

- The gateway creates the `documents` row (`queued`), writes the object to MinIO, and enqueues a job. The worker marks `processing`; AI parses/embeds and returns counts; the worker marks `ready` or `failed` with a sanitized error. The AI does not mutate document status.
- The AI writes `chunks` and `schema_catalog` embeddings using the `verity_app` role. The gateway reads them for counts only.
- The SQL executor uses a separate `verity_sql_ro` pool with `default_transaction_read_only=on`, `statement_timeout=5000`, and no access to `app`.
- Assistant messages are persisted by the gateway after the stream ends, so a trace/id is always attached. The gateway pre-generates the assistant message id and passes it to the AI, which echoes it in `done`.
- Document deletion: gateway checks access → deletes MinIO object → calls AI `/documents/{id}` to delete chunks → deletes the row. Failures are logged and retried idempotently.

---

## 7. Cross-cutting contracts

### 7.1 Authentication and access context

- Browser → gateway: `Authorization: Bearer <access JWT>`; refresh cookie on `/api/auth/*`.
- Gateway → AI: HMAC headers plus `access_context { user_id, role, group_ids }` and `conversation_history`.
- Gateway resolves role and group memberships from the database on each chat request (not only from JWT claims) so access changes take effect immediately.
- Access filter is embedded in both vector and keyword SQL:

  - `public` → all roles
  - `internal` → `analyst`, `admin`
  - `restricted` → `admin` or explicit group membership

- The same filter is never applied after retrieval.

### 7.2 SSE protocol (unchanged from plan §7.3)

`status`, `route`, `token`, `sql`, `sources`, `error`, `done`. Implementation rules:

- Gateway disables buffering (`Cache-Control: no-cache`, `X-Accel-Buffering: no`) and sends a comment heartbeat every 15s.
- The parser handles chunked UTF-8, CRLF, multi-line `data:`, and unknown events.
- `sources` always precedes `done`; `done` carries the persisted message id, trace id, latency, and usage.
- On client abort: abort upstream, persist the partial assistant message with `answer_status = stopped`, and write a final trace span.
- On upstream error: emit `error`, persist an assistant message only if content exists, and keep the user message for retry.
- Inline markers are `[1]…[n]`, mapped by order to `sources.citations`; invalid markers are stripped and logged.

### 7.3 Errors

All gateway errors use `{ "error": { "code", "message", "details? } }`. Codes will be enumerated in `docs/api.md` (auth, forbidden, validation, not_found, rate_limited, upstream_unavailable, stream_failed, sql_blocked, ingest_failed).

### 7.4 Prompt-injection boundary

- Retrieved chunks are serialized inside delimited `<untrusted_document>` blocks with title/page metadata.
- The system prompt states that block contents are data, never instructions, and that only the question is trusted.
- Citation validation and SQL validation are code-level checks; the model is never the sole guard.
- Fixtures include malicious documents, indirect injection, and SQL-injection-in-document content.

### 7.5 Observability

- One Langfuse trace per chat, with spans for routing, rewrite, vector search, keyword search, fusion, rerank, SQL generation, validation, execution, generation, citation check.
- Metadata: route, confidence, model, token usage, cost estimate, chunk ids, SQL outcome, latency.
- `trace_id` persisted on the assistant message; deep link exposed in admin/feedback views.
- Configurable redaction of prompts/responses; no secrets/PII in logs.

---

## 8. Phase plan

Each phase ends with: tests, lint, typecheck, Docker verification, docs update, a written summary, and a stop for approval. Commits are small and conventional.

### Phase 0 — Foundation

**Goal:** a healthy, reproducible monorepo skeleton.

**Tasks**

1. Rename `DESIGN.md` → `design.md` (case-sensitive CI correctness); keep the supplementary spec untouched.
2. Add `.gitignore`, `.editorconfig`, `.nvmrc`, root `package.json` workspaces, Makefile.
3. Scaffold `apps/web` (Vite React TS, Tailwind, ESLint/Prettier, Vitest), `apps/api` (Express TS strict, Vitest), `services/ai` (FastAPI, ruff, mypy, pytest). Placeholder health endpoints only.
4. Compose: Postgres `pgvector/pgvector:pg16`, Redis 7, MinIO; health checks; named volumes; dependency ordering.
5. Postgres init: `vector` extension, `app`/`business`/`business_ro` schemas, `verity_app` and `verity_sql_ro` roles, grants, default privileges, dangerous-function revokes for the RO role.
6. Migration runner service and `schema_migrations` table.
7. Role-verification script (positive and negative privilege checks).
8. `.env.example` from plan §15 plus only the necessary additions (public MinIO endpoint, token TTLs, upload/rate-limit config, Langfuse keys, tracing redaction).
9. CI skeleton: install, lint, typecheck, unit tests, Docker build, `npm audit`, `pip-audit`.
10. README quick start skeleton.

**Verification**

- `cp .env.example .env && docker compose up` → Postgres/Redis/MinIO healthy.
- `make test`, `make lint`, `make typecheck` run.
- `make verify-roles` proves: `verity_app` can write `app`; `verity_sql_ro` cannot write, cannot read `app`, and can select an allowed view.
- No secret is tracked.

**Exit:** approval of Phase 0 summary.

---

### Phase 1 — Auth, app shell, design system

**Goal:** design tokens and reusable components first, then the shell and auth.

**Tasks**

1. Encode tokens in `tokens.css` + Tailwind theme: colors, typography scale, spacing, radii, shadows, focus rings, motion; tabular numerals; reduced-motion variants.
2. Build primitives: Button, IconButton, Input, Textarea, Select, Checkbox, Radio, Card, Badge, Table, Dialog, Sheet/Drawer, DropdownMenu, Accordion, Tabs, Tooltip, Alert, Skeleton, EmptyState, Pagination, Spinner, Avatar.
3. Auth API: users/groups/refresh-token migrations, register bootstrap, login, refresh rotation with reuse detection, logout, `/me`, RBAC middleware, rate limits, structured logging, error shape.
4. Seed admin/analyst/viewer + groups.
5. Admin user list/role patch API (UI lands with admin pages later).
6. Web: React Router, auth context, silent refresh, protected/role-gated routes, login screen, top nav with segmented tabs, honest environment badge, user menu, footer, conversation rail shell, source-drawer shell, mobile navigation.
7. Component gallery/dev route for visual review (dev-only, not shipped in nav).
8. Tests: auth flows, refresh rotation/reuse, RBAC, validation, login/shell RTL.
9. Docs: `docs/api.md` auth section, `docs/architecture.md` first pass, README dev users.

**Acceptance**

- Three seeded roles log in.
- Protected routes and nav items enforce roles.
- Silent refresh works; logout revokes.
- Shell matches design layout at 375/768/1280/1600px; keyboard focus visible; contrast checks pass.
- Auth and RBAC suites green.

---

### Phase 2 — Documents and ingestion

**Goal:** upload → store → queue → parse → chunk → embed → ready.

**Tasks**

1. Migrations: documents, document_groups, chunks (+ HNSW/GIN/btree indexes) and status fields.
2. MinIO bucket bootstrap and gateway upload endpoint with type/size validation.
3. BullMQ queue + worker; status transitions; retries/backoff; failure messages.
4. AI `/ingest`: fetch signed file URL, parse PDF/DOCX/TXT/MD/HTML, clean, structure-aware chunking, contextual embedding text, batched embeddings with retry/backoff, Redis content-hash cache, chunk storage with metadata.
5. AI `/documents/{id}` deletion; idempotent re-ingest.
6. Documents UI: drag/drop multi-upload, per-file progress, list with status badges, filters, pagination, details, signed download, admin edit access/groups, delete confirmation.
7. Status polling while queued/processing.
8. Demo document corpus (15–25 files) including 2 conflicting/outdated docs and 1 injection fixture; restricted fixture with a seeded group.
9. Tests: chunking edge cases, upload validation, worker failure/retry, access filter storage, parsing per type, deletion cascade.
10. Docs: ingestion flow, storage layout, supported types.

**Acceptance**

- PDF, DOCX, TXT, MD each reach `ready` with chunks and embeddings.
- Failures show actionable errors and can be retried.
- Deletion removes object + chunks + row.
- Access level stored and editable by admin.
- No cross-role document leakage in listing or download.

---

### Phase 3 — RAG question answering

**Status:** implemented. Hybrid retrieval, RRF, configurable reranking, query
rewriting, access-filtered SQL, citation validation, the confidence gate/refusal,
signed AI streaming, gateway SSE relay with heartbeat/abort/regenerate persistence,
and the chat UI are covered by unit tests. A database-backed leakage check, full
Compose cold start, and p95 time-to-first-token measurement still require the
running demo stack and are not claimed as verified. See
[`retrieval.md`](./retrieval.md).

**Goal:** grounded, streamed document answers with real citations.

**Tasks**

1. Migrations: conversations, messages (+ `metadata`), feedback table.
2. Retrieval: query rewrite, access-filtered vector + FTS SQL, RRF, rerank, top-N selection, confidence gate.
3. Generation: untrusted-context prompt, low temperature, token streaming, citation marker validation, sources event.
4. AI `/chat/stream` (documents route first), SSE models, trace id and stage spans (local/logging tracer now; Langfuse adapter wired in Phase 6).
5. Gateway `/chat/stream`: auth, conversation ownership, history load, signed forwarding, SSE relay, heartbeat, abort handling, persistence, `done`.
6. Web chat: conversation list/create/delete, streaming message, status indicator, stop, regenerate, copy, markdown, inline citation chips, source drawer with title/page/snippet/score/open-file, suggested questions, feedback API hookup.
7. Tests: access leakage (viewer vs restricted), RRF, rerank threshold, citation validation, low-confidence refusal, SSE parser, abort/persistence, RTL chat/citations.
8. Docs: retrieval and SSE sequences.

**Acceptance**

- Demo questions stream with valid citations mapping to real chunks.
- Low-confidence questions return the refusal message.
- Viewer cannot retrieve restricted content (test).
- p95 time-to-first-token under 2.5s on the demo dataset (measured; reranker choice affects this).
- Stop/regenerate/copy work; errors are recoverable.

---

### Phase 4 — Text-to-SQL

**Goal:** safe, inspectable data answers.

**Tasks**

1. `business` schema + deterministic 24-month seed (≈50 products, 5,000 customers, 40,000 orders, returns, tickets, employees).
2. `business_ro` views excluding PII/sensitive columns; grants; RO role hardening; direct negative tests.
3. `schema_catalog` migration, introspection, embeddings, admin descriptions/example values.
4. Gateway admin schema-catalog GET/PATCH + refresh proxy; admin editor UI.
5. SQL generation (structured JSON), catalog retrieval, few-shot retrieval from config, clarification path.
6. Validator: parse, single statement, SELECT/CTE only, deny list, function deny list, relation allowlist, LIMIT injection/cap, cross-join and complexity checks.
7. Executor: RO pool, read-only transaction, timeout, row cap, truncation flag; repair loop (max 2) with re-validation.
8. Answer synthesis from result preview; numeric post-check flagged to trace.
9. Web SQL panel: collapsible, formatted/highlighted SQL, sortable/scrollable result table, row count, truncation notice, copy, optional CSV.
10. Tests: large malicious SQL suite, LIMIT/complexity cases, repair loop, direct RO-role write attempts, result accuracy on starter SQL set.
11. Docs: SQL safety model, views, catalog editing.

**Acceptance**

- Data questions return correct answers with visible SQL and tables.
- Every malicious case is blocked.
- Direct RO-role writes/DDL/`app` access fail.
- Ambiguous questions return a clarification.
- Admin can edit catalog descriptions and refresh introspection.

---

### Phase 5 — Router and hybrid answers

**Goal:** correct path selection and combined evidence.

**Tasks**

1. Router classifier with structured output, confidence, reason; configurable model; trace span.
2. `out_of_scope` response path.
3. Hybrid pipeline: SQL + RAG concurrently, merged synthesis with both citation types, partial-failure behavior.
4. Route event and route badge in UI; status events for both branches.
5. Conversation memory and follow-up rewriting for doc and SQL paths.
6. Routing dataset (≥40) and accuracy measurement.
7. Tests: router unit tests with mocked LLM, confidence fallback, hybrid merge, follow-up rewrite, out-of-scope, partial failure.

**Acceptance**

- ≥90% routing accuracy on `routing.jsonl`.
- Hybrid questions cite both a document and SQL results.
- Follow-ups work with conversation context.
- Out-of-scope is brief and steers back.

---

### Phase 6 — Observability, metrics, and evals

**Goal:** every request traceable, quality measurable, regressions visible.

**Tasks**

1. Langfuse Compose service (version per Q4) + tracing adapter + spans across the pipeline; fail-open behavior.
2. Persist trace id, model, cost, route confidence, answer status, SQL validation outcome in message metadata.
3. Gateway `/admin/metrics` + admin dashboard: requests/day, p50/p95, cost, route mix, thumbs-down, "I don't know", SQL validation failure, top failing questions; trace deep links.
4. Feedback capture complete (thumbs + optional comment), one per user/message.
5. Datasets: `docs_qa.jsonl` (≥60), `sql_qa.jsonl` (≥40), `routing.jsonl` (≥40), `safety.jsonl`.
6. `evals/run_evals.py`: RAGAS (faithfulness, answer relevancy, context precision, context recall), citation correctness, SQL execution accuracy, routing accuracy, refusal correctness, latency, cost.
7. `make eval`: run against live services, write markdown report with comparison to previous run.
8. README before/after table (hybrid + rerank effect).
9. Tests: metrics SQL, cost calculation, eval metric unit tests.

**Acceptance**

- Every chat has a linked trace.
- Eval report contains every metric in plan §12.3.
- README comparison table present.
- Feedback visible in metrics.

---

### Phase 7 — Hardening and polish

**Goal:** production-shaped demo and a README that works from scratch.

**Tasks**

1. Redis caching: embeddings and repeated standalone questions (access-context-aware keys).
2. Rate-limit tuning and coverage; request size limits.
3. Prompt-injection/safety suite expansion; role escalation tests; dependency audit.
4. Accessibility pass: keyboard, ARIA live chat log, focus management, contrast, reduced motion; target Lighthouse ≥90.
5. Empty/loading/error/offline states everywhere; skeleton polish; stream-drop recovery.
6. Performance: parallel retrieval branches, embedding batch sizes, index checks, p95 verification.
7. Playwright E2E: login, upload, ask, cite, SQL panel, feedback, admin guard.
8. Docs: `architecture.md` final with Mermaid, ADRs (pgvector, SSE, SQL validation, chunking, tracing, auth), `api.md`, `security.md`, `demo-script.md`, README screenshots/quick start/eval table/demo users.
9. Full Compose cold-start verification from a clean volume.

**Acceptance**

- All suites green; security tests pass.
- Lighthouse accessibility ≥90 on main pages.
- New developer can clone, set `.env`, `docker compose up`, seed, and complete the demo using only the README.

---

## 9. Testing and CI matrix

| Layer    | Tools                   | Critical coverage                                                                                                 |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web      | Vitest, RTL, Playwright | auth shell, streaming render, citations, SQL panel, upload, feedback, a11y keyboard                               |
| API      | Vitest, Supertest       | auth/refresh/reuse, RBAC, upload limits, document access, SSE proxy, rate limits, errors                          |
| AI       | Pytest, pytest-asyncio  | chunking, access-filter SQL, RRF, rerank gate, citation markers, router, SQL validator, repair, injection defense |
| Database | SQL + scripts           | role privileges, direct RO write denial, cascade deletion, index presence                                         |
| Evals    | Python                  | RAGAS, SQL result accuracy, routing, refusal, latency, cost                                                       |
| CI       | GitHub Actions          | lint, typecheck, unit tests, Docker build, audits; Playwright job; no real LLM keys                               |

LLM calls are mocked in unit tests. Real-model runs occur only in `make eval`, as required.

---

## 10. Risks and mitigations

| #   | Risk                                                                                    | Impact                                              | Mitigation                                                                                            |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| R1  | Default LLM/embedding/reranker undecided                                                | Blocks real E2E and evals; dimension affects schema | Resolve Q1–Q3 before Phase 2; mock in tests; keep providers behind interfaces                         |
| R2  | Design palette conflicts and contrast failures                                          | Visual inconsistency, accessibility failure         | Token resolution in §2.2 + automated contrast checks in Phase 1                                       |
| R3  | Langfuse self-hosting footprint (v3 needs ClickHouse)                                   | Compose complexity, cold-start time                 | Q4 decision; fail-open tracer; no chat dependency on Langfuse                                         |
| R4  | Local reranker is heavy and slow; p95 TTFT target                                       | Slower demo, ARM64 build pain                       | Prefer Cohere if key; lazy-load local model; status events mask latency; measure early                |
| R5  | SSE buffering/abort/persistence edge cases                                              | Broken streaming, duplicate messages                | Explicit proxy headers, heartbeat, abort tests, gateway-owned message id                              |
| R6  | SQL validator bypass surface                                                            | Security failure                                    | Parse + AST checks + allowlist + complexity + RO role + timeout + malicious suite; defense in depth   |
| R7  | Retrieval access leakage                                                                | Confidentiality failure                             | Filter inside both SQL branches; role/group tests; viewer restricted fixture                          |
| R8  | Prompt injection via documents                                                          | Unsafe outputs                                      | Delimited untrusted context, instruction hierarchy, injection fixtures, no tool execution in RAG path |
| R9  | Eval authoring effort (180+ items)                                                      | Phase 6 slips                                       | Write starter sets early during Phases 2–4 against real seed data                                     |
| R10 | Seed data drift / eval non-reproducibility                                              | Unstable results                                    | Deterministic seed, fixed `current_date` in SQL prompts, versioned datasets                           |
| R11 | PDF/DOCX parsing variance                                                               | Bad chunks/citations                                | Parser fixtures, page preservation, failure status, optional LlamaParse hook                          |
| R12 | ARM64 Docker builds (PyMuPDF, torch, reranker)                                          | Slow/failed builds                                  | Pinned images, multi-stage builds, CPU-only wheels, optional reranker profile                         |
| R13 | Demo requires paid API keys                                                             | "One command" fails without keys                    | Clear `.env` validation error, mocked mode for tests, Ollama profile documented (pending Q1)          |
| R14 | MinIO presigned URLs unreachable from browser                                           | Broken downloads                                    | Separate public endpoint, CORS config, verified in Phase 2                                            |
| R15 | Scope creep from supplementary spec                                                     | Time sink, fake features                            | §3 scope guardrails; C1–C12 resolutions                                                               |
| R16 | First-token latency with rewrite + retrieve + rerank                                    | Misses 2.5s target                                  | Emit status immediately, parallelize branches, cap candidates, cache embeddings                       |
| R17 | Missing schema/contract pieces (refresh tokens, metadata, regenerate, refresh-endpoint) | Rework                                              | Explicit additions in §4.2 pending approval                                                           |
| R18 | Cookie/CORS behavior differs dev vs Compose                                             | Auth failures                                       | Vite proxy in dev, nginx same-origin in Compose, SameSite=Lax, origin checks, E2E both modes          |

---

## 11. Commit strategy

- Conventional Commits, imperative, scoped: `chore(infra): add postgres roles and verification`, `feat(api): add refresh token rotation`, `feat(web): add citation chips and source drawer`.
- One logical change per commit; tests included with the behavior.
- No secrets, `.env`, build output, model weights, or generated volumes committed.
- Docs updated in the same phase, not deferred.
- Do not rewrite or delete the provided source docs; only rename `DESIGN.md` → `design.md` for case-sensitive consistency.

---

## 12. Blocking questions

### Q1 — LLM provider and model IDs (dev + evals)

Plan §20 leaves this open. Options: Anthropic, OpenAI, or Ollama local fallback. Which is the default for development, and which model id should evals use? Do you have keys available in the environment?

**Recommendation:** Anthropic for generation/routing, with Ollama as an optional local fallback profile; model id supplied via `.env`, never hardcoded.

### Q2 — Reranker

Cohere (paid, fast, good quality) or local `bge-reranker` (free, heavier, slower, ARM64 build risk)? `none` is allowed by config but weakens the confidence gate and eval quality.

**Recommendation:** Cohere when a key is present; local reranker as the offline fallback; never silently disable in evals.

### Q3 — Restricted documents in hybrid answers

May a non-admin receive a hybrid answer that combines a restricted document they can access (via group) with database results, or should hybrid answers be blocked whenever restricted docs are involved?

**Recommendation:** allow it only when the document passes the existing access filter; never include inaccessible docs; if no accessible docs exist, answer SQL-only with a note. Blocking entirely would make group grants pointless.

### Q4 — Langfuse deployment

Plan §16 says "Langfuse (with its own database)" but Langfuse v3 also needs ClickHouse and blob storage. Choose:

- **v2, Postgres-only** (smaller Compose, closer to plan's service list), or
- **v3, add ClickHouse + Langfuse Postgres + reuse MinIO** (maintained, more services).

**Recommendation:** v3 if this is a long-lived portfolio project; v2 if strict adherence to the listed service set and cold-start speed matter more. Either still runs under one Compose.

### Q5 — Primary color and accessibility

The body of `design.md` specifies `#0284C7` primary buttons with white text, which is ≈4.1:1 and fails WCAG AA for 14px text. The front matter specifies `#006194` (≈6.7:1).

**Recommendation:** `#006194` for primary actions, `#0284C7` for focus rings and accents, `#0369A1` for links. Approve this token resolution (see §2.2).

### Q6 — Scope of design-spec elements not backed by the plan

Confirm that I should **not** build or claim: multi-warehouse cards, global search, "Zero-Knowledge"/SHA-256 attestation, "zero AST mutator" verification (we do mutate LIMIT), "scanned rows" counts, efficiency comparison charts, per-query grounding upload, manual route selector, or fake replica latency/metrics.

**Recommendation:** reuse the visual patterns with honest, real data only. Show real validation checks and returned-row counts instead.

### Q7 — Navigation mapping

Proposed top nav: **Ask & Analytics** (chat, all roles), **Knowledge Base** (documents, all roles), **Data Schemas** (admin only), **Audit Trail** (admin metrics/traces only). Conversation list lives in the left rail; sources in the right drawer. Approve, or specify a different mapping? What should "Audit Trail" contain, given the plan has no audit-log requirement?

### Q8 — Contract/schema additions

Approve the additions in §4.2: `refresh_tokens`, `messages.metadata`, YAML few-shot examples (no table), `regenerate_message_id`, `POST /admin/schema-catalog/refresh`, seeded groups with membership via `PATCH /admin/users/:id`, and no eval API in v1 (report links only). Also confirm whether admin eval results need an in-app view or a link to `evals/reports/` is enough.

### Defaults to confirm (no need to restate if acceptable)

D1–D22 in §4.3, including argon2id, 15m/7d tokens, RRF k=60, 200/1000 row caps, 5s timeout, 2 repairs, 0.70 router threshold, 25MB uploads, 5-minute signed URLs, nginx-served web, self-hosted fonts, client-side CSV, hand-rolled charts, custom `shadow-xs`, and Langfuse fail-open.

---

## 13. Definition of done (every phase)

- [ ] Runs via `docker compose up` with only `.env` setup.
- [ ] Tests pass (unit + phase-critical integration).
- [ ] Lint and typecheck clean.
- [ ] Acceptance criteria in `plan.md` for the phase verified, not assumed.
- [ ] Visuals match `design.md` tokens and states.
- [ ] Loading, empty, error, and keyboard/accessibility states handled.
- [ ] README and relevant `docs/` updated.
- [ ] No secrets committed; `.env.example` current.
- [ ] Phase summary written; waiting for approval before the next phase.

---

## 14. Immediate next actions after approval

1. Commit this plan and the source docs (no code).
2. Rename `DESIGN.md` → `design.md`; verify on a case-sensitive filesystem.
3. Execute Phase 0 only.
4. Return with: Compose health output, role-verification results, test/lint/typecheck output, and the Phase 0 summary.
