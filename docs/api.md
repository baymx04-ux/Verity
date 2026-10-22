# API Contract

**Base URL:** `/api` (nginx proxies to the gateway; Vite proxies in development).
**Phase 1:** health, authentication, refresh rotation, logout, `/me`, and admin
user/role/group read endpoints exist. Documents, chat/SSE, and SQL endpoints land
in later phases.

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

## Internal AI contract (planned)

The gateway calls the AI service at `AI_SERVICE_URL` with a short-lived
`INTERNAL_SERVICE_TOKEN`; the AI service is not published to the host. Streaming
responses are proxied, not re-buffered.
