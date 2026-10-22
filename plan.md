# Verity: Project Plan

> Verity is a RAG-powered enterprise knowledge base with a text-to-SQL layer. Non-technical users ask questions in plain English and receive grounded, cited answers drawn from internal documents and a live PostgreSQL database.

This file is the source of truth for product scope, architecture, behavior, and acceptance criteria. Visual design lives in `design.md`. If the two conflict, this file wins on behavior and architecture, and `design.md` wins on visuals and UX.

---

## 1. Product Overview

### 1.1 Problem

Company knowledge is split between unstructured documents (policies, handbooks, product docs, reports) and structured data (sales, HR, inventory in a database). Non-technical staff cannot write SQL, and keyword search over documents misses meaning. Generic chatbots hallucinate and cannot show where an answer came from.

### 1.2 Solution

A single chat interface that:

1. Retrieves relevant passages from uploaded documents and answers with citations.
2. Converts data questions into safe, validated, read-only SQL, runs them, and explains the result.
3. Routes each question to the right path (documents, database, or both) automatically.
4. Refuses to guess when evidence is weak.

### 1.3 Goals

- Every factual answer is traceable to a document chunk or a SQL query the user can inspect.
- SQL generation is safe by construction (read-only, validated, bounded).
- Responses stream token by token with visible progress states.
- Access control is enforced at retrieval time, not only in the UI.
- Quality is measured with an evaluation harness, and the LLM pipeline is traced end to end.
- The whole system runs with one `docker compose up`.

### 1.4 Non-Goals (v1)

- Multi-tenant SaaS billing or organization self-signup.
- Fine-tuning models.
- Write operations on the business database.
- Mobile native apps.
- Real-time document sync from external sources (Drive, Notion, SharePoint). Listed as future work.

### 1.5 Success Criteria

- 90%+ of eval questions answered with correct citations (document questions).
- 85%+ execution accuracy on the text-to-SQL eval set.
- p95 time to first streamed token under 2.5 seconds on the demo dataset.
- Zero successful write or DDL statements in the SQL safety test suite.

---

## 2. Users and Roles

| Role        | Capabilities                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**   | Manage users and roles, upload and delete any document, set document access levels, view all traces and eval results, manage schema descriptions for text-to-SQL |
| **Analyst** | Upload documents, ask questions across documents and database (subject to access levels), view own history                                                       |
| **Viewer**  | Ask questions only, limited to documents and views allowed for their role                                                                                        |

Access levels on documents: `public` (all roles), `internal` (analyst, admin), `restricted` (admin, or explicitly granted groups).

---

## 3. Tech Stack

### 3.1 Frontend (`apps/web`)

- React 18 + TypeScript (strict), Vite
- Tailwind CSS, shadcn/ui primitives, Lucide icons
- TanStack Query (server state), Zustand (UI state)
- React Router
- Streaming via `fetch` with a ReadableStream SSE parser (needed for POST requests with auth headers)
- Markdown rendering with `react-markdown` and `remark-gfm`, syntax highlighting for SQL
- Vitest + React Testing Library, Playwright for E2E

### 3.2 API Gateway (`apps/api`)

- Node.js 20+, Express, TypeScript (strict)
- Zod for request validation
- JWT access tokens (short lived) plus refresh tokens in httpOnly cookies
- `bcrypt` or `argon2` for password hashing
- Multer for uploads, MinIO SDK (S3-compatible) for object storage
- BullMQ + Redis for ingestion jobs
- `pino` for structured logging, `helmet`, `cors`, `express-rate-limit`
- Vitest + Supertest

### 3.2.1 Role of the gateway

Auth, sessions, file upload, job orchestration, conversation persistence, and proxying streaming responses from the AI service to the browser. It holds no LLM logic.

### 3.3 AI Service (`services/ai`)

- Python 3.11+, FastAPI, Uvicorn, Pydantic v2
- LlamaIndex for ingestion, chunking, and retrieval primitives
- `sqlglot` for SQL parsing and validation
- `psycopg` (v3) for Postgres access
- LLM providers behind one interface: Anthropic or OpenAI (cloud), Ollama (local fallback)
- Embeddings: configurable (`text-embedding-3-small` by default, `nomic-embed-text` or `bge-m3` locally)
- Reranker: Cohere Rerank or local `bge-reranker` (configurable)
- Document parsing: PyMuPDF and `unstructured` (PDF, DOCX, TXT, MD, HTML), optional LlamaParse for complex PDFs
- `ragas` for evaluation
- Pytest, `pytest-asyncio`, `ruff`, `mypy`

### 3.4 Data Layer

- PostgreSQL 16 with `pgvector` extension: one instance, separate schemas:
  - `app` (users, documents, chunks, conversations, messages, feedback)
  - `business` (demo company data queried by text-to-SQL)
- Hybrid search: pgvector cosine similarity plus Postgres full-text search (`tsvector`), merged with Reciprocal Rank Fusion
- Redis 7: caching, rate limiting, job queue
- MinIO: original uploaded files

### 3.5 Observability and Evaluation

- Langfuse (self-hosted via Compose) as the default tracer. LangSmith or Braintrust are acceptable swaps behind a thin tracing interface.
- RAGAS metrics: faithfulness, answer relevancy, context precision, context recall
- Custom SQL execution accuracy metric (result set comparison)

### 3.6 DevOps

- Docker and Docker Compose
- GitHub Actions: lint, typecheck, unit tests, build images
- `.env.example` documented, no secrets in the repo
- Makefile (or `justfile`) with shortcuts: `make up`, `make seed`, `make test`, `make eval`

---

## 4. Architecture

### 4.1 High-Level Diagram

```
Browser (React)
   |  HTTPS, SSE
   v
Express API Gateway  <->  Redis (cache, rate limit, BullMQ)
   |        |
   |        +-> MinIO (raw files)
   |
   v
FastAPI AI Service
   |-- Router (intent classification)
   |-- RAG pipeline  -> Postgres app schema (pgvector + FTS)
   |-- Text-to-SQL   -> Postgres business schema (read-only role)
   |-- LLM provider (Anthropic / OpenAI / Ollama)
   +-- Tracing -> Langfuse
```

### 4.2 Request Flow (chat)

1. Browser POSTs a question to `POST /api/chat/stream` with the conversation id.
2. Gateway authenticates, loads the user's role and conversation history, and forwards to the AI service with the user's access context.
3. AI service router classifies intent: `documents`, `database`, `hybrid`, or `chitchat/out_of_scope`.
4. The selected pipeline(s) run, emitting status events.
5. The answer is generated with streamed tokens, followed by a final `sources` event (citations and SQL).
6. Gateway persists the user message and assistant message with citations, SQL, and trace id.

### 4.3 Ingestion Flow

1. User uploads a file to the gateway. Gateway validates type and size, stores the file in MinIO, creates a `documents` row with status `queued`, and enqueues a BullMQ job.
2. Worker calls `POST /ingest` on the AI service with the file reference.
3. AI service parses, chunks, embeds, and writes chunks with metadata. Status moves `queued -> processing -> ready` (or `failed` with an error message).
4. UI shows live status via polling or an SSE status channel.

---

## 5. Repository Structure

```
verity/
  apps/
    web/                 React + TypeScript frontend
    api/                 Express gateway + BullMQ worker
  services/
    ai/                  FastAPI RAG + text-to-SQL service
      app/
        main.py
        routers/         chat, ingest, health, admin
        pipeline/
          router.py      intent classification
          rag/           parsing, chunking, retrieval, rerank, generation
          sql/           schema context, generation, validation, execution
          llm/           provider interface + adapters
          tracing/       Langfuse wrapper
        core/            config, logging, security
        tests/
  infra/
    docker-compose.yml
    postgres/init/       extensions, schemas, roles, migrations
    seed/                demo documents + business data generator
  evals/
    datasets/            docs_qa.jsonl, sql_qa.jsonl
    run_evals.py
    reports/
  docs/                  architecture diagrams, ADRs, API contracts
  plan.md
  design.md
  README.md
  .env.example
  Makefile
```

---

## 6. Data Model

### 6.1 `app` schema

```sql
users(id uuid pk, email text unique, password_hash text, name text,
      role text check (role in ('admin','analyst','viewer')),
      created_at timestamptz default now())

groups(id uuid pk, name text unique)
user_groups(user_id uuid, group_id uuid, primary key(user_id, group_id))

documents(id uuid pk, owner_id uuid fk users, title text, filename text,
          mime_type text, size_bytes bigint, storage_key text,
          access_level text check (access_level in ('public','internal','restricted')),
          status text check (status in ('queued','processing','ready','failed')),
          error text, page_count int, created_at timestamptz, updated_at timestamptz)

document_groups(document_id uuid, group_id uuid)  -- for restricted docs

chunks(id uuid pk, document_id uuid fk documents on delete cascade,
       chunk_index int, content text, page_number int, section text,
       token_count int, embedding vector(1536), tsv tsvector,
       metadata jsonb)
-- indexes: HNSW on embedding (cosine), GIN on tsv, btree on document_id

conversations(id uuid pk, user_id uuid fk users, title text, created_at, updated_at)

messages(id uuid pk, conversation_id uuid fk, role text check (role in ('user','assistant')),
         content text, route text, citations jsonb, sql_query text,
         sql_result_preview jsonb, trace_id text, latency_ms int,
         prompt_tokens int, completion_tokens int, created_at timestamptz)

feedback(id uuid pk, message_id uuid fk, user_id uuid fk, rating smallint check (rating in (-1,1)),
         comment text, created_at timestamptz)

schema_catalog(id uuid pk, table_name text, column_name text, description text,
               example_values jsonb, embedding vector(1536), is_exposed boolean)
-- descriptions used to retrieve only relevant tables/columns for text-to-SQL
```

Embedding dimension is configurable. If a local model is used, update the `vector(N)` dimension via migration and re-embed.

### 6.2 `business` schema (demo company)

Fictional company: **Meridian Outfitters**, an online outdoor-gear retailer.

```sql
regions(id, name, country)
customers(id, name, email, region_id, segment, signup_date)
products(id, sku, name, category, unit_price, cost, launch_date)
orders(id, customer_id, order_date, status, channel, region_id, total_amount)
order_items(id, order_id, product_id, quantity, unit_price, discount)
employees(id, name, department, title, hire_date, manager_id, region_id)
support_tickets(id, customer_id, created_at, resolved_at, category, priority)
```

The text-to-SQL layer queries only **views** exposed in a `business_ro` schema (for example `v_orders`, `v_revenue_daily`, `v_products`), never base tables directly. Sensitive columns (emails, salaries) are excluded from the views.

### 6.3 Database Roles

- `verity_app`: read/write on `app` schema, used by the gateway and ingestion.
- `verity_sql_ro`: `SELECT` only on `business_ro` views, `statement_timeout = 5s`, `default_transaction_read_only = on`, no access to `app` schema.

---

## 7. API Contracts

### 7.1 Gateway (Express), all under `/api`

| Method | Path                                                       | Description                                              | Roles                    |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------------ |
| POST   | `/auth/register`                                           | Create user (admin only after first user)                | admin                    |
| POST   | `/auth/login`                                              | Returns access token, sets refresh cookie                | all                      |
| POST   | `/auth/refresh`                                            | Rotate tokens                                            | all                      |
| POST   | `/auth/logout`                                             | Clear refresh cookie                                     | all                      |
| GET    | `/me`                                                      | Current user                                             | all                      |
| POST   | `/documents`                                               | Multipart upload, returns document row (status `queued`) | analyst, admin           |
| GET    | `/documents`                                               | List with status, filters, pagination                    | all (filtered by access) |
| GET    | `/documents/:id`                                           | Details                                                  | per access               |
| GET    | `/documents/:id/file`                                      | Signed download URL                                      | per access               |
| PATCH  | `/documents/:id`                                           | Update title, access level, groups                       | admin                    |
| DELETE | `/documents/:id`                                           | Remove file, chunks                                      | admin                    |
| GET    | `/conversations`                                           | List user's conversations                                | all                      |
| POST   | `/conversations`                                           | Create                                                   | all                      |
| GET    | `/conversations/:id/messages`                              | History                                                  | owner                    |
| DELETE | `/conversations/:id`                                       | Delete                                                   | owner                    |
| POST   | `/chat/stream`                                             | Ask a question, SSE response                             | all                      |
| POST   | `/messages/:id/feedback`                                   | Thumbs up/down + comment                                 | all                      |
| GET    | `/admin/users`, `PATCH /admin/users/:id`                   | User management                                          | admin                    |
| GET    | `/admin/schema-catalog`, `PATCH /admin/schema-catalog/:id` | Manage text-to-SQL descriptions                          | admin                    |
| GET    | `/admin/metrics`                                           | Usage, latency, cost, feedback summary                   | admin                    |
| GET    | `/health`                                                  | Liveness and dependency status                           | public                   |

All errors use one shape: `{ "error": { "code": string, "message": string, "details"?: any } }`.

### 7.2 AI Service (FastAPI), internal only

| Method | Path              | Description                              |
| ------ | ----------------- | ---------------------------------------- |
| POST   | `/chat/stream`    | Run router + pipeline, stream SSE events |
| POST   | `/ingest`         | Parse, chunk, embed a stored document    |
| DELETE | `/documents/{id}` | Remove chunks                            |
| POST   | `/schema/refresh` | Re-introspect views and re-embed catalog |
| GET    | `/health`         | Status                                   |

The AI service accepts a signed internal token and an `access_context` (user id, role, group ids) on every request. It never trusts the browser directly.

### 7.3 SSE Event Protocol (chat stream)

Each event is `event: <type>` with a JSON `data:` payload.

| Event     | Payload                                                                                                                           | When                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `status`  | `{ "stage": "routing" \| "retrieving" \| "reranking" \| "generating_sql" \| "running_sql" \| "writing", "message": string }`      | Progress updates           |
| `route`   | `{ "route": "documents" \| "database" \| "hybrid" \| "out_of_scope", "confidence": number }`                                      | After routing              |
| `token`   | `{ "text": string }`                                                                                                              | Each streamed token chunk  |
| `sql`     | `{ "query": string, "columns": string[], "rows": any[][], "row_count": number, "truncated": boolean }`                            | After SQL execution        |
| `sources` | `{ "citations": [{ "id": string, "document_id": string, "title": string, "page": number, "snippet": string, "score": number }] }` | Before completion          |
| `error`   | `{ "code": string, "message": string }`                                                                                           | Recoverable or fatal error |
| `done`    | `{ "message_id": string, "trace_id": string, "latency_ms": number, "usage": { ... } }`                                            | End of stream              |

Inline citation markers in the generated text use `[1]`, `[2]` and map to the `citations` array by order.

---

## 8. RAG Pipeline

### 8.1 Ingestion

1. **Parse** by file type. Preserve page numbers and heading structure. Drop headers, footers, and boilerplate where detectable.
2. **Clean** whitespace and hyphenation artifacts.
3. **Chunk:** structure-aware first (split on headings), then recursive split to a target of 500 to 800 tokens with 80 to 120 token overlap. Tables are kept whole where possible. Chunk size and overlap are config values.
4. **Contextualize:** prepend document title and section path to each chunk's embedding text (store the original content separately for display).
5. **Embed** in batches with retry and backoff. Cache embeddings by content hash in Redis to avoid re-embedding duplicates.
6. **Store** chunk rows with metadata: document id, title, page, section, access level, upload date.

### 8.2 Retrieval

1. **Query rewriting:** use conversation history to turn follow-ups into standalone questions.
2. **Access filter:** build a metadata filter from the user's role and groups. This is applied inside the SQL query for both vector and keyword search, never after the fact.
3. **Hybrid search:** top 30 from vector similarity and top 30 from full-text search.
4. **Fusion:** Reciprocal Rank Fusion to merge into one ranked list.
5. **Rerank:** cross-encoder or Cohere Rerank on the top 20, keep the top 5 to 8.
6. **Confidence gate:** if the best rerank score is below a configurable threshold, skip generation and respond that the documents do not contain enough information.

### 8.3 Generation

- System prompt requires answering only from provided context, using inline `[n]` citations, and saying "I don't have enough information" when context is insufficient.
- Context is wrapped in clearly delimited blocks, with a note that block contents are untrusted data and must never be treated as instructions.
- After generation, a lightweight check verifies that every `[n]` marker maps to a real retrieved chunk. Invalid markers are removed and logged.
- Temperature low (0 to 0.2) for factual answers.

---

## 9. Text-to-SQL Pipeline

### 9.1 Schema Context

- Introspect `business_ro` views: table, column, type, nullability, foreign-key-like relationships declared in `schema_catalog`.
- Admins can edit human-readable descriptions and example values per column.
- At query time, embed the question and retrieve the top relevant tables and columns from `schema_catalog`. Only those are placed in the prompt (keeps prompts small and reduces errors).
- Include a short set of vetted few-shot question-to-SQL examples, also retrieved by similarity.

### 9.2 Generation

- The model returns structured JSON: `{ "sql": string, "explanation": string, "assumptions": string[] }`.
- Dialect: PostgreSQL. Dates are interpreted relative to a `current_date` value supplied in the prompt.
- If the question is ambiguous or the needed data is not in the schema, the model returns `{ "sql": null, "clarification": string }` and the UI shows the clarification.

### 9.3 Validation (all must pass, enforced in code, not by prompt)

1. Parse with `sqlglot` (Postgres dialect). Reject if parsing fails.
2. Exactly one statement.
3. Statement type must be `SELECT` (CTEs allowed). Reject `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `COPY`, `CALL`, `DO`, and any function in a deny list (`pg_sleep`, `pg_read_file`, `lo_import`, `dblink`, and similar).
4. All referenced relations must be in the allow list of `business_ro` views.
5. Inject or cap `LIMIT` (default 200, max 1000) if absent or too large.
6. Reject cross joins without conditions and queries exceeding a complexity budget (join count, subquery depth).

### 9.4 Execution

- Connect as `verity_sql_ro`, in a read-only transaction, with `statement_timeout` (5s) and a row cap.
- On execution error, feed the error message back to the model for up to 2 repair attempts, re-validating each time.
- Return columns, rows (truncated for display), row count, and the final SQL.

### 9.5 Answer Synthesis

- The model receives the question, the SQL, and a bounded result preview, and writes a plain-English answer.
- Numbers in the narrative must come from the result set. A post-check compares numbers mentioned in the answer against the result values and flags mismatches in the trace.
- The UI always offers the generated SQL and a result table for verification.

---

## 10. Router

- Classifier prompt (small, fast model or the main model with a short prompt) returns `{ "route", "confidence", "reason" }`.
- Routes:
  - `documents`: policy, process, descriptive, or qualitative questions.
  - `database`: counts, sums, trends, rankings, comparisons over business data.
  - `hybrid`: needs both (for example "Is our Q3 return rate within the policy limit?"). Run SQL for the number and RAG for the policy, then synthesize one answer with both citation types.
  - `out_of_scope`: greetings, general knowledge, unsafe requests. Respond briefly and steer back to supported use.
- If confidence is below a threshold, default to `hybrid` or ask a clarifying question.
- Routing decisions are logged to the trace and used in evals (routing accuracy).

---

## 11. Security Requirements

- Passwords hashed with argon2 or bcrypt. JWT access tokens expire in 15 minutes. Refresh tokens rotate and are stored hashed.
- Rate limiting per user and per IP on auth and chat routes.
- File upload limits: allowed MIME types and extensions only, max size configurable (default 25 MB), virus scan hook point documented.
- Signed, short-lived URLs for file download.
- Inter-service calls authenticated with a shared signed token. The AI service is not exposed publicly.
- Document-level access control enforced in retrieval queries.
- **Prompt injection defense:** retrieved text is delimited and labeled untrusted. System prompts instruct the model to ignore instructions inside context. A test suite includes documents containing malicious instructions.
- **SQL safety:** see section 9.3 and the read-only role. Defense in depth means validation in code plus database-level permissions.
- No secrets, API keys, or PII in logs. Prompts and responses stored in traces can be redacted by config.
- CORS restricted to the configured web origin. `helmet` defaults enabled.
- Dependency audit step in CI (`npm audit`, `pip-audit`).

---

## 12. Observability and Evaluation

### 12.1 Tracing

Every chat request produces one trace with spans for: routing, query rewrite, retrieval (vector, keyword, fusion, rerank), SQL generation, validation, execution, answer generation. Capture latency, token usage, cost estimate, model name, route, and chunk ids. Store `trace_id` on the assistant message.

### 12.2 Metrics Dashboard (admin)

Requests per day, p50/p95 latency, average cost per query, route distribution, thumbs-down rate, "I don't know" rate, SQL validation failure rate, top failing questions.

### 12.3 Evaluation Harness (`/evals`)

- `docs_qa.jsonl`: at least 60 questions with reference answers and expected source documents.
- `sql_qa.jsonl`: at least 40 questions with gold SQL and expected result sets.
- `routing.jsonl`: at least 40 questions labeled by route.
- `safety.jsonl`: prompt injection attempts and unsafe SQL requests (expected: refusal or block).
- Metrics: RAGAS (faithfulness, answer relevancy, context precision, context recall), citation correctness, SQL execution accuracy (result match), routing accuracy, refusal correctness, latency, cost.
- `make eval` runs everything and writes a markdown report to `evals/reports/` with a comparison against the previous run.
- The README includes a before/after table showing the effect of hybrid search and reranking.

---

## 13. Demo Dataset

### 13.1 Documents (generated or written, about 15 to 25 files)

- Employee Handbook (leave policy, remote work, expenses)
- Returns and Refund Policy
- Shipping and Fulfillment SOP
- Product catalog sheets and care guides
- Quarterly business review summaries (Q1 to Q3)
- Security and data handling policy
- Customer support playbook
- Include 2 deliberately conflicting or outdated documents to test citation behavior, and 1 document containing a prompt injection string for the safety tests.

### 13.2 Business Data

A seed script (`infra/seed`) generates realistic, seeded-random data: about 50 products, 5,000 customers, 40,000 orders across 24 months, seasonality, regional differences, and returns. Deterministic seed so evals are reproducible.

### 13.3 Demo Users

`admin@verity.dev`, `analyst@verity.dev`, `viewer@verity.dev` with documented dev-only passwords in the README.

---

## 14. Frontend Functional Requirements

(Visual details are in `design.md`.)

- **Auth screens:** login, logout, session persistence, role-aware navigation.
- **Chat:** conversation list, new chat, streaming answer with progressive rendering, status indicator, stop-generation button, regenerate, copy.
- **Citations:** inline `[n]` chips that open a source panel showing the document title, page, and highlighted snippet, with a link to the original file.
- **SQL view:** collapsible panel with formatted SQL, a result table (sortable, scrollable), row count, and truncation notice. Optional copy and CSV export.
- **Suggested questions:** shown on an empty conversation, based on the demo data.
- **Feedback:** thumbs up/down with optional comment.
- **Documents page:** upload (drag and drop, multi-file), list with status badges, filters, access level editing, delete with confirmation.
- **Admin pages:** users, schema catalog editor, metrics dashboard.
- **States:** loading skeletons, empty states, error states with retry, offline handling for dropped streams.
- **Accessibility:** keyboard navigable, ARIA roles for the chat log (`aria-live` for streaming), sufficient contrast, reduced-motion support.

---

## 15. Configuration (`.env.example`)

```
# General
NODE_ENV=development
WEB_ORIGIN=http://localhost:5173

# Gateway
API_PORT=4000
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
INTERNAL_SERVICE_TOKEN=change-me

# Postgres
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=verity
POSTGRES_USER=verity_app
POSTGRES_PASSWORD=change-me
SQL_RO_USER=verity_sql_ro
SQL_RO_PASSWORD=change-me

# Redis / MinIO
REDIS_URL=redis://redis:6379
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=change-me
MINIO_SECRET_KEY=change-me
MINIO_BUCKET=verity-docs

# AI service
AI_SERVICE_URL=http://ai:8000
LLM_PROVIDER=anthropic            # anthropic | openai | ollama
LLM_MODEL=                         # set to the chosen model id
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OLLAMA_BASE_URL=http://ollama:11434
EMBEDDING_PROVIDER=openai          # openai | ollama
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
RERANKER=cohere                    # cohere | local | none
COHERE_API_KEY=

# RAG tuning
CHUNK_TOKENS=650
CHUNK_OVERLAP=100
RETRIEVE_TOP_K=30
RERANK_TOP_N=6
MIN_RERANK_SCORE=0.25
SQL_MAX_ROWS=200
SQL_TIMEOUT_MS=5000

# Observability
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=http://langfuse:3000
```

Model ids are intentionally left to configuration. Do not hardcode them.

---

## 16. Docker Compose Services

`web`, `api`, `worker`, `ai`, `postgres` (pgvector image), `redis`, `minio`, `langfuse` (with its own database), and optional `ollama` behind a Compose profile. Health checks on every service, dependency ordering with `depends_on: condition: service_healthy`, named volumes for data, and a one-shot `seed` service or `make seed` command.

---

## 17. Testing Strategy

| Area       | Tests                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway    | Auth flows, RBAC, upload validation, document access rules, rate limiting                                                                                                         |
| AI service | Chunking edge cases, retrieval filters (access control leakage tests), SQL validator (large malicious query suite), router unit tests with mocked LLM, citation marker validation |
| Frontend   | Component tests for chat, citations, SQL panel, upload; Playwright E2E for login, upload, ask, cite, feedback                                                                     |
| Security   | Prompt injection fixtures, SQL injection attempts, role escalation attempts                                                                                                       |
| Evals      | See section 12.3                                                                                                                                                                  |

LLM calls are mocked in unit tests and recorded or stubbed for CI. Real-model runs happen only in `make eval`.

---

## 18. Delivery Phases and Acceptance Criteria

Build one phase at a time. At the end of each phase: run tests and lint, verify acceptance criteria, update README and docs, then stop for review.

### Phase 0: Foundation

**Tasks:** monorepo scaffold, Docker Compose (Postgres + pgvector, Redis, MinIO), DB init scripts (schemas, roles, extensions), `.env.example`, Makefile, CI skeleton, base lint and format config.
**Acceptance:** `docker compose up` starts all infra healthy; `make test` runs (even if few tests); roles `verity_app` and `verity_sql_ro` exist with correct privileges, verified by a script.

### Phase 1: Auth and App Shell

**Tasks:** Express app, user model, register/login/refresh/logout, RBAC middleware, React app shell with routing and auth, design tokens and base components from `design.md`.
**Acceptance:** three roles can log in; protected routes enforce roles; tokens refresh silently; UI shell matches `design.md` layout; auth test suite passes.

### Phase 2: Document Upload and Ingestion

**Tasks:** upload endpoint, MinIO storage, BullMQ worker, AI `/ingest`, parsing, chunking, embeddings, chunk storage, status updates, documents UI.
**Acceptance:** uploading PDF, DOCX, TXT, and MD produces `ready` documents with chunks and embeddings; failures show a clear error; deletion removes file and chunks; access level is stored and editable.

### Phase 3: RAG Question Answering

**Tasks:** hybrid retrieval, RRF, reranker, access filtering, query rewriting, generation with citations, confidence gate, SSE streaming through the gateway, chat UI with citation chips and source panel.
**Acceptance:** questions over the demo documents stream answers with valid citations; low-confidence questions return an "I don't have enough information" response; a viewer cannot retrieve restricted content (verified by test); time to first token meets the target.

### Phase 4: Text-to-SQL

**Tasks:** `business` schema and seed data, `business_ro` views, schema catalog and embedding, generation, validator, read-only execution, repair loop, answer synthesis, SQL panel UI, admin catalog editor.
**Acceptance:** data questions return correct answers with visible SQL and result tables; the validator blocks every case in the malicious suite; the read-only role cannot write even if validation were bypassed (verified by a direct test); ambiguous questions trigger a clarification.

### Phase 5: Router and Hybrid Answers

**Tasks:** intent router, hybrid pipeline combining SQL and RAG, out-of-scope handling, routing events in the UI, conversation memory and follow-ups.
**Acceptance:** routing accuracy of at least 90% on `routing.jsonl`; hybrid questions return answers citing both a document and a SQL result; follow-up questions work using conversation context.

### Phase 6: Observability and Evals

**Tasks:** Langfuse integration with spans for all stages, metrics endpoint and admin dashboard, eval datasets, `make eval`, report generation, feedback capture.
**Acceptance:** each chat has a linked trace; the eval run produces a report with all metrics from section 12.3; the README contains a before/after comparison.

### Phase 7: Hardening and Polish

**Tasks:** caching (embeddings, repeated questions), rate limits, prompt injection test suite, accessibility pass, error and empty states, loading skeletons, performance tuning, E2E tests, documentation (architecture diagram, ADRs, setup guide, demo script).
**Acceptance:** all test suites green; security tests pass; Lighthouse accessibility score of 90 or higher on main pages; a new developer can clone the repo and run the full demo by following the README alone.

---

## 19. Documentation Deliverables

- `README.md`: overview, screenshots, quick start, architecture diagram, eval results table, tech decisions.
- `docs/architecture.md`: components, data flow, sequence diagrams (Mermaid).
- `docs/adr/`: short decision records (pgvector vs Qdrant, SSE vs WebSocket, validation strategy, chunking choice).
- `docs/api.md`: endpoint reference and SSE protocol.
- `docs/demo-script.md`: a 5-minute walkthrough with example questions.

---

## 20. Assumptions and Open Questions

Assumptions made in this plan (change them here if needed):

1. pgvector is used instead of Qdrant to keep infrastructure small. The retrieval layer is behind an interface so Qdrant can be swapped in.
2. LlamaIndex is used for ingestion and retrieval primitives. LangGraph can be introduced later if the router grows into a multi-step agent.
3. Anthropic or OpenAI is the default provider. Ollama is optional and may reduce answer quality.
4. Langfuse is the default tracer because it is self-hostable.
5. Single organization (single tenant) for v1.

Open questions to resolve before or during Phase 0:

- Which LLM provider and model id will be the default for development and for evals?
- Is a paid reranker (Cohere) acceptable, or should the local reranker be the default?
- Should hybrid answers be allowed to combine restricted documents with database results, or is that blocked for non-admins?
- Is CSV export of SQL results needed in v1?

---

## 21. Future Work (Out of Scope for v1)

Connectors (Google Drive, Notion, Confluence), SSO and SCIM, multi-tenancy, scheduled re-indexing, chart generation from SQL results, multi-database support, per-column permissions in text-to-SQL, human review queue for low-confidence answers, and fine-tuned routing or reranking models.
