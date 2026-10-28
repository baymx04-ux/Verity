# API Contract

**Base URL:** `/api` (nginx proxies to the gateway; Vite proxies in development).
**Implemented:** health, authentication, refresh rotation, logout, `/me`, admin
user/role/group endpoints, document upload/list/detail/download/edit/retry/delete,
the internal AI ingestion contract, conversations, grounded chat over SSE, feedback,
and the internal AI chat contract. SQL endpoints land in Phase 4.

## Authentication

Access tokens are short-lived JWTs returned in the response body. The browser
stores them in memory only and sends `Authorization: Bearer <token>`. Refresh
tokens are opaque-signed JWTs delivered in an `HttpOnly` cookie
(`verity_refresh`, `Path=/api/auth`, `SameSite=Lax` by default). Refresh rotation
is mandatory: every successful refresh revokes the presented token and issues a
new one. Reuse of a rotated token revokes all of that user's active refresh
tokens.

Role claims are `admin`, `analyst`, or `viewer`. The API re-checks the role on
every request; hiding a UI route is never treated as authorization.

### `POST /api/auth/login`

```json
{ "email": "admin@verity.dev", "password": "verity-admin-dev" }
```

`200` response:

```json
{
  "accessToken": "<jwt>",
  "user": { "id": "<uuid>", "email": "admin@verity.dev", "role": "admin" }
}
```

Also sets the refresh cookie. Invalid credentials return `401 unauthorized`
without disclosing whether the account exists. Login and refresh are rate-limited
per IP (`AUTH_RATE_LIMIT_PER_MIN`, default 10/minute).

### `POST /api/auth/refresh`

Reads the refresh cookie and rotates it.

```json
{ "accessToken": "<jwt>" }
```

Returns `401 unauthorized` and clears the cookie when the token is missing,
expired, revoked, or reused. Successful rotation returns a new refresh cookie.

### `POST /api/auth/logout`

Revokes the refresh token in the cookie, records an audit event when an access
token is present, and clears the cookie. Returns `{ "ok": true }`. Logout does not
require a live access token so an expired session can still clear its cookie.

### `GET /api/auth/me`

Requires `Authorization: Bearer <token>`. Returns the current user:

```json
{
  "user": {
    "id": "<uuid>",
    "email": "admin@verity.dev",
    "role": "admin",
    "is_active": true,
    "first_name": "Ada",
    "last_name": "Admin"
  }
}
```

### Admin endpoints

All require an `admin` access token.

| Method  | Path                                | Purpose                                             |
| ------- | ----------------------------------- | --------------------------------------------------- |
| `GET`   | `/api/auth/users`                   | List users (no password hashes)                     |
| `PATCH` | `/api/auth/users/:id/role`          | Change role; body `{ "role": "analyst" }`           |
| `GET`   | `/api/auth/groups`                  | List document-access groups                         |
| `GET`   | `/api/admin/schema-catalog`         | List business_ro view metadata                      |
| `PATCH` | `/api/admin/schema-catalog/:view`   | Update view/column descriptions and examples        |
| `POST`  | `/api/admin/schema-catalog/refresh` | Re-introspect business_ro views and refresh catalog |

Role changes are validated with Zod and written to `app.auth_audit`. Non-admins
receive `403 forbidden`.

## Documents

All endpoints require `Authorization: Bearer <token>`. Access filters are applied
in SQL for lists and re-checked for detail/download; a document the caller cannot
access returns `404 not_found`. See [`ingestion.md`](./ingestion.md) for the
pipeline, status model, and storage layout.

| Method   | Path                       | Roles                                | Purpose                                       |
| -------- | -------------------------- | ------------------------------------ | --------------------------------------------- |
| `POST`   | `/api/documents`           | `admin`, `analyst`                   | Upload and queue a document                   |
| `GET`    | `/api/documents`           | all authenticated                    | List accessible documents with filters        |
| `GET`    | `/api/documents/:id`       | access-filtered                      | Document detail, groups, status, chunk counts |
| `GET`    | `/api/documents/:id/file`  | access-filtered                      | Short-lived signed download URL               |
| `PATCH`  | `/api/documents/:id`       | `admin`                              | Rename, change access level, set groups       |
| `POST`   | `/api/documents/:id/retry` | `admin`, `analyst` (access-filtered) | Requeue a failed document                     |
| `DELETE` | `/api/documents/:id`       | `admin`                              | Delete the object, chunks, and row            |

### `POST /api/documents`

`multipart/form-data`:

| Field          | Required | Notes                                                     |
| -------------- | -------- | --------------------------------------------------------- |
| `file`         | yes      | One file per request. Repeat the request for multi-upload |
| `title`        | no       | Defaults to the filename                                  |
| `access_level` | no       | `public` \| `internal` (default) \| `restricted`          |
| `group_ids`    | no       | Repeated UUID field; only meaningful for `restricted`     |

Accepted extensions: `.pdf`, `.docx`, `.txt`, `.md`, `.markdown`, `.html`,
`.htm`. Declared MIME must match one of the accepted types. The size limit is
`UPLOAD_MAX_MB` (default 25 MB) and uploads are limited per IP by
`UPLOAD_RATE_LIMIT_PER_HOUR` (default 10/hour).

`201` response:

```json
{
  "document": {
    "id": "<uuid>",
    "owner_id": "<uuid>",
    "title": "Security Policy",
    "filename": "security-policy.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 182734,
    "storage_key": "documents/1760000000000-<uuid>-security-policy.pdf",
    "access_level": "internal",
    "status": "queued",
    "error": null,
    "error_code": null,
    "page_count": 0,
    "chunk_count": 0,
    "groups": [],
    "created_at": "2026-10-24T09:00:00.000Z",
    "updated_at": "2026-10-24T09:00:00.000Z"
  }
}
```

The row is returned immediately after it is queued; parsing and embedding happen
asynchronously. Analyst uploads are forced to `internal` regardless of the
submitted `access_level`.

Errors:

| Status | Code               | Cause                                                  |
| ------ | ------------------ | ------------------------------------------------------ |
| 400    | `no_file`          | No `file` part was sent                                |
| 400    | `invalid_file`     | Unsupported extension or mismatched declared MIME type |
| 400    | `validation_error` | Invalid title, access level, or group UUID             |
| 403    | `forbidden`        | Viewer, or a role that cannot upload                   |
| 413    | `file_too_large`   | File exceeds `UPLOAD_MAX_MB`                           |
| 429    | `rate_limited`     | Upload rate limit exceeded                             |

### `GET /api/documents`

Query parameters: `status` (`queued` \| `processing` \| `ready` \| `failed`),
`access_level` (`public` \| `internal` \| `restricted`), `search` (case-insensitive
title/filename match), `page` (default 1), `limit` (default 20, max 100).

```json
{
  "documents": [{ "id": "<uuid>", "title": "Security Policy", "status": "ready" }],
  "total": 21,
  "page": 1,
  "limit": 20
}
```

Rows include the same fields as the upload response plus `groups`, `chunk_count`,
`page_count`, `error`, and `error_code`. Viewers see `public` documents plus
restricted documents granted to their groups; analysts also see `internal`;
admins see everything. The documents page polls this endpoint every four seconds
while any visible document is `queued` or `processing`.

### `GET /api/documents/:id/file`

Returns a five-minute presigned URL generated against
`MINIO_PUBLIC_ENDPOINT`:

```json
{ "url": "http://localhost:9000/verity-docs/...?X-Amz-Signature=...", "expires_in_s": 300 }
```

The URL points at the original uploaded file with an attachment disposition. The
gateway never proxies file bytes for downloads.

### `PATCH /api/documents/:id`

Admin only. All fields optional:

```json
{ "title": "Updated title", "access_level": "restricted", "group_ids": ["<uuid>"] }
```

Changing `access_level` or sending `group_ids` replaces the stored grants. Set
`access_level` to `public` or `internal`, or send an empty `group_ids` array, to
clear them. A `restricted` document with no groups is visible only to admins.

### `POST /api/documents/:id/retry`

Allowed for admins and analysts who can access the document. Resets the row to
`queued`, clears the previous error, and enqueues a fresh attempt. Returns the
updated document. `404` when the document is missing or not accessible.

### `DELETE /api/documents/:id`

Admin only. Deletes the MinIO object, asks the AI service to remove that
document's chunks, then deletes the row. `app.chunks` and `app.document_groups`
also cascade from the row. Returns `{ "success": true }`; a missing document
returns `404 not_found`.

### Admin document helpers

| Method | Path                 | Purpose                                                  |
| ------ | -------------------- | -------------------------------------------------------- |
| `GET`  | `/api/admin/groups`  | List groups with `document_count` for the access editor  |
| `GET`  | `/api/admin/metrics` | Document/chunk counts and last successful ingestion time |

## Chat and SSE

All chat endpoints require `Authorization: Bearer <token>`. Conversations are
owned by the caller; history and delete requests for another user's conversation
return `404` rather than revealing that it exists, while the stream reports the
same condition as an in-band SSE error. Chat streams are limited per
authenticated user by `CHAT_RATE_LIMIT_PER_MIN` (default 20/minute), separately
from the global API limit. Retrieval access control is applied inside the AI
service using the caller's role and live group memberships. See
[`retrieval.md`](./retrieval.md) for the pipeline.

| Method   | Path                              | Purpose                                       |
| -------- | --------------------------------- | --------------------------------------------- |
| `GET`    | `/api/conversations`              | List the caller's conversations, newest first |
| `POST`   | `/api/conversations`              | Create an empty conversation                  |
| `GET`    | `/api/conversations/:id/messages` | Full message history with citations/metadata  |
| `DELETE` | `/api/conversations/:id`          | Delete the conversation and its messages      |
| `POST`   | `/api/chat/stream`                | Ask or regenerate an answer over SSE          |
| `POST`   | `/api/messages/:id/feedback`      | Record or replace thumbs up/down feedback     |

### Conversations

`POST /api/conversations` accepts an optional `title` (max 100 characters) and
returns `201`:

```json
{
  "conversation": {
    "id": "<uuid>",
    "user_id": "<uuid>",
    "title": "New conversation",
    "created_at": "2026-10-26T09:00:00.000Z",
    "updated_at": "2026-10-26T09:00:00.000Z"
  }
}
```

`GET /api/conversations` returns `{ "conversations": [...] }` ordered by
`updated_at` descending. `GET /api/conversations/:id/messages` returns
`{ "messages": [...] }` in chronological order:

```json
{
  "messages": [
    {
      "id": "<uuid>",
      "conversation_id": "<uuid>",
      "role": "assistant",
      "content": "Employees receive 25 days of annual leave [1].",
      "route": "documents",
      "citations": [
        {
          "id": "<chunk-uuid>",
          "document_id": "<document-uuid>",
          "title": "Employee Handbook",
          "page": 12,
          "section": "Annual leave",
          "snippet": "All permanent employees accrue 25 days…",
          "score": 0.82
        }
      ],
      "sql_query": null,
      "sql_result_preview": null,
      "trace_id": "<trace>",
      "latency_ms": 1840,
      "prompt_tokens": 1200,
      "completion_tokens": 85,
      "metadata": {
        "answer_status": "answered",
        "aborted": false,
        "low_confidence": false,
        "cited_indices": [1],
        "citation_count": 1,
        "invalid_citation_count": 0,
        "time_to_first_token_ms": 1180,
        "model": "gemini-2.5-flash"
      },
      "feedback": { "rating": 1, "comment": null },
      "created_at": "2026-10-26T09:00:02.000Z"
    }
  ]
}
```

`DELETE /api/conversations/:id` returns `204`; a missing or foreign conversation
returns `404 not_found`.

### `POST /api/chat/stream`

```json
{ "conversation_id": "<uuid>", "question": "What is the leave policy?" }
```

- `question` is required unless `regenerate` is `true`; maximum 4000 characters.
- `route` (optional) may be `"auto"` (or omitted), `"documents"`, `"sql"`,
  `"hybrid"`, or `"out_of_scope"`. `auto` lets the AI service classify the
  question; any explicit value bypasses the classifier. The web UI defaults to
  Auto and still offers Documents and Data modes.
- Omitting `conversation_id` creates a conversation and titles it from the first
  60 characters of the question. The new id is sent immediately in a
  `conversation` event.
- `regenerate: true` requires `conversation_id`. The gateway reuses the most
  recent user message and replaces the latest assistant message rather than
  adding a duplicate user turn.
- Validation failures return `400 invalid_request` as JSON before streaming
  starts. Once headers are sent, ownership and generation failures arrive as SSE
  `error` events.

The response is `text/event-stream` with `Cache-Control: no-cache, no-transform`
and `X-Accel-Buffering: no`. The gateway also writes a `: ping` comment every
15 seconds so an idle generation is not closed by a proxy.

```text
event: conversation
data: {"conversation_id":"<uuid>"}

event: status
data: {"stage":"retrieving","message":"Searching accessible documents…"}

event: route
data: {"route":"hybrid","confidence":0.88,"reason":"policy target plus return-rate data","fallback":false,"classified_route":"hybrid"}

event: token
data: {"text":"Employees receive 25 days"}

event: sources
data: {"citations":[{"id":"<chunk-uuid>","document_id":"<document-uuid>","title":"Employee Handbook","page":12,"section":"Annual leave","snippet":"All permanent employees accrue 25 days…","score":0.82}]}

event: done
data: {"message_id":"<uuid>","conversation_id":"<uuid>","route":"documents","trace_id":"<trace>","latency_ms":1840,"time_to_first_token_ms":1180,"usage":{"prompt_tokens":1200,"completion_tokens":85},"low_confidence":false,"answer_status":"answered","cited_indices":[1],"citation_count":1,"invalid_citation_count":0,"aborted":false,"persisted":true}
```

| Event          | Payload                                                                                                                                                        | When                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `conversation` | `{ "conversation_id": string }`                                                                                                                                | Immediately after the thread is known |
| `status`       | `{ "stage": "rewriting" \| "retrieving" \| "writing" \| "routing" \| "generating_sql" \| "running_sql" \| "synthesizing" \| "running", "message": string }`    | Progress updates                      |
| `route`        | `{ "route": "documents" \| "sql" \| "hybrid" \| "out_of_scope", "confidence"?: number, "reason"?: string, "fallback"?: boolean, "classified_route"?: string }` | Route selection                       |
| `token`        | `{ "text": string }`                                                                                                                                           | Streamed answer chunks                |
| `sources`      | `{ "citations": Citation[] }`                                                                                                                                  | After retrieval or before `done`      |
| `sql`          | `{ "sql": string, "columns": string[], "rows": any[], "row_count": number, "truncated": boolean, "execution_ms": number }`                                     | After SQL execution (data mode)       |
| `error`        | `{ "code": string, "message": string }`                                                                                                                        | Recoverable or fatal stream error     |
| `done`         | `{ message_id, conversation_id, route, trace_id, latency_ms, time_to_first_token_ms, usage, sql_outcome?, router?, hybrid?, ... }`                             | Successful completion only            |

`citation` objects contain `id` (chunk id), `document_id`, `title`, `page`,
`section`, `snippet`, and a 0–1 `score`. Inline `[n]` markers map to the entries
in the `sources` array by order. Markers that do not map to a retrieved chunk are
removed before the token reaches the browser; the number removed is reported as
`done.invalid_citation_count` and logged by the AI service.
`done.time_to_first_token_ms` measures AI-service time from request start to the
first answer or refusal token, and is persisted in assistant metadata.

Refusals are a normal answer, not an error: the refusal text streams as tokens,
`sources` is empty, and `done.answer_status` is `refused` with
`low_confidence: true`. `answer_status` is `uncited` when the model answered but
cited nothing.

Automatic routing runs only when `route` is omitted or `auto`. The classifier
returns a route, a 0–1 confidence, and a short reason; classifications below
`ROUTER_CONFIDENCE_THRESHOLD` (default `0.7`) fall back to `hybrid`. The applied
route and the classifier's original choice are both included in the `route`
event and in `done.router`. Hybrid answers emit the `sql` event and may include
both document citations and `sql_outcome`; `done.hybrid` reports the status of
each branch (`ok`, `low_confidence`, `empty`, `failed`, or the SQL outcome).
If one branch fails the answer degrades to the surviving source. Out-of-scope
questions return a brief steer-back message with `answer_status: "out_of_scope"`
and no citations.

If the client aborts the request, the gateway stops the upstream stream, persists
any non-empty partial answer with `metadata.answer_status = "aborted"`, and does
not emit `done`. A generation failure emits `error` and persists partial text with
`answer_status = "error"` when there is any. `done.persisted` reports whether the
assistant row was stored. The upstream AI `done` event is consumed and never
relayed, so the browser sees exactly one terminal event.

Stream error codes include `retrieval_failed`, `generation_failed`,
`internal_error`, `not_found`, and `stream_error`. The web client adds
`http_error` and `network_error` locally for transport failures.

### `POST /api/messages/:id/feedback`

```json
{ "rating": 1, "comment": "Clear and cited" }
```

`rating` must be `1` or `-1`; `comment` is optional and limited to 2000
characters. Feedback is upserted per `(message, user)`, so clicking again replaces
the previous value. Returns `{ "feedback": { ... } }`. A message in another
user's conversation returns `404 not_found`.

## Health

`GET /api/health`

Returns gateway liveness plus dependency status. The endpoint itself is not
rate-limited.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_s": 42,
  "dependencies": {
    "postgres": "ok",
    "redis": "ok",
    "minio": "ok"
  }
}
```

- `200` when every dependency is `ok`.
- `503` with `status: "degraded"` when any dependency is `down`.
- Dependency details never include credentials or connection strings.

## Errors

All non-SSE errors share one shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "Route not found"
  }
}
```

| HTTP | Code              | Meaning                                      |
| ---- | ----------------- | -------------------------------------------- |
| 400  | `invalid_json`    | Request body was not valid JSON              |
| 400  | `invalid_request` | Request body failed schema validation        |
| 401  | `unauthorized`    | Missing/invalid access or refresh token      |
| 403  | `forbidden`       | Role or document access denied               |
| 404  | `not_found`       | Unknown route or resource                    |
| 413  | `file_too_large`  | Upload exceeds `UPLOAD_MAX_MB`               |
| 429  | `rate_limited`    | Limit exceeded                               |
| 500  | `internal_error`  | Unhandled server error; details stay in logs |

## Streaming notes

Chat is the only streaming endpoint. nginx disables proxy buffering and the
service sets `X-Accel-Buffering: no`, so tokens arrive incrementally. Both the
gateway and the web client use a small SSE parser that preserves the event name
across arbitrary chunk boundaries, ignores comment heartbeats, tolerates CRLF,
and skips malformed JSON frames instead of ending the stream.

## Internal AI contract

The AI service is internal-only (Compose `expose`, no host port). The worker
calls it at `AI_SERVICE_URL`; the gateway calls `/chat/stream`; the browser never
does. Every ingestion/deletion/chat request is signed with
`INTERNAL_SERVICE_TOKEN` using HMAC-SHA256.

Headers:

| Header               | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| `X-Verity-Timestamp` | Unix seconds; requests older or newer than 60 s are rejected |
| `X-Verity-Signature` | Hex HMAC of `METHOD\nPATH\nTIMESTAMP\nSHA256(body)`          |

For bodies, the body hash is the SHA-256 of the exact JSON bytes sent. An empty
DELETE body hashes the empty byte string. Paths are the AI-service paths
(`/ingest`, `/documents/{id}`, `/chat/stream`), not the public gateway paths.

### `POST /ingest`

```json
{
  "document_id": "<uuid>",
  "storage_url": "http://minio:9000/verity-docs/...?X-Amz-Signature=...",
  "filename": "security-policy.pdf",
  "mime_type": "application/pdf",
  "title": "Security Policy",
  "access_level": "internal",
  "size_bytes": 182734
}
```

`200` response:

```json
{
  "document_id": "<uuid>",
  "chunks": 42,
  "pages": 7,
  "tokens": 18230,
  "embedding_model": "gemini-embedding-001",
  "embedding_dim": 768,
  "status": "indexed"
}
```

The service downloads the presigned URL with a size cap, parses the file,
chunks it, embeds the chunks, and replaces all `app.chunks` rows for the
document in one transaction. A parser rejection returns `422` with a
user-actionable `detail`; auth failures return `401` or `503`.

### `DELETE /documents/{id}`

Deletes all chunks for the document and returns:

```json
{ "document_id": "<uuid>", "chunks_deleted": 42 }
```

The gateway calls this before deleting the document row. A missing document
simply yields `chunks_deleted: 0`.

### `POST /chat/stream`

Signed streaming request from the gateway:

```json
{
  "conversation_id": "<uuid>",
  "question": "What is the leave policy?",
  "access_context": {
    "user_id": "<uuid>",
    "role": "viewer",
    "group_ids": ["<uuid>"]
  },
  "history": [
    { "role": "user", "content": "Tell me about benefits" },
    { "role": "assistant", "content": "Benefits include…" }
  ],
  "route": "auto",
  "trace_id": "optional-upstream-trace"
}
```

`route` is optional and defaults to `auto`. Explicit `documents`, `sql`,
`hybrid`, or `out_of_scope` values bypass the classifier.

The AI service rewrites follow-ups when history exists, retrieves with the
caller's access context, reranks, applies the confidence gate, and streams
`sources`/`done` with citation indices, model, retrieval scores, and stage spans.
It emits the same `status`, `route`, `token`, `sources`, `error`, and `done`
events documented above; the `conversation` event is gateway-only. The AI service
does not write conversations or messages — the gateway owns persistence,
abort handling, and the terminal `done` relayed to the browser.

Cancelling the HTTP request cancels the upstream generation. Retrieval access is
enforced in SQL from the requesting user's role and current group memberships;
the `group_ids` field is informational and is not trusted as the authorization
source.

### `GET /health`

Public inside the Compose network. Reports Postgres, Redis, and MinIO
availability for orchestration health checks.
