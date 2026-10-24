# API Contract

**Base URL:** `/api` (nginx proxies to the gateway; Vite proxies in development).
**Implemented:** health, authentication, refresh rotation, logout, `/me`, admin
user/role/group endpoints, document upload/list/detail/download/edit/retry/delete,
and the internal AI ingestion contract. Chat/SSE and SQL endpoints land in later
phases.

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

| Method  | Path                       | Purpose                                   |
| ------- | -------------------------- | ----------------------------------------- |
| `GET`   | `/api/auth/users`          | List users (no password hashes)           |
| `PATCH` | `/api/auth/users/:id/role` | Change role; body `{ "role": "analyst" }` |
| `GET`   | `/api/auth/groups`         | List document-access groups               |

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

## Streaming (planned, Phase 3)

Chat responses use `text/event-stream`. Event names and payloads are defined in
`plan.md` §10:

```text
event: status   data: {"stage":"retrieving"}
event: route    data: {"route":"rag"}
event: token    data: {"text":"..."}
event: sources  data: {"sources":[...]}
event: sql      data: {"sql":"SELECT ...","rows":[...],"truncated":false}
event: error    data: {"code":"low_confidence","message":"..."}
event: done     data: {"message_id":"...","trace_id":"..."}
```

nginx disables proxy buffering and sets `X-Accel-Buffering: no` so tokens arrive
incrementally. The contract will be implemented with Zod schemas shared by tests
and documented here before the frontend consumes it.

## Internal AI contract

The AI service is internal-only (Compose `expose`, no host port). The worker
calls it at `AI_SERVICE_URL`; the browser never does. Every ingestion/deletion
request is signed with `INTERNAL_SERVICE_TOKEN` using HMAC-SHA256.

Headers:

| Header               | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| `X-Verity-Timestamp` | Unix seconds; requests older or newer than 60 s are rejected |
| `X-Verity-Signature` | Hex HMAC of `METHOD\nPATH\nTIMESTAMP\nSHA256(body)`          |

For bodies, the body hash is the SHA-256 of the exact JSON bytes sent. An empty
DELETE body hashes the empty byte string. Paths are the AI-service paths
(`/ingest`, `/documents/{id}`), not the public gateway paths.

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

### `GET /health`

Public inside the Compose network. Reports Postgres, Redis, and MinIO
availability for orchestration health checks.

Streaming chat responses (Phase 3) will be proxied by the gateway, not buffered
or re-emitted by the AI service.
