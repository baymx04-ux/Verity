# Deploying Verity on Render

This guide deploys Verity on Render's **free tier**: three Docker web services
plus a Render Key Value instance, with PostgreSQL hosted on an external managed
provider (Neon or Supabase, both have free tiers with `pgvector`).

## Why Postgres is external

Free Render web services have an **ephemeral filesystem** and cannot attach a
persistent disk, so a Postgres container deployed as a web service loses all
data on every deploy, restart, or 15-minute idle spin-down. They also cannot
**receive** private-network traffic, which rules out running the database as a
private service.

Free Render **Postgres databases** do support `pgvector`, but they expire 30
days after creation. If you would rather use one (accepting the expiry), create
it in the dashboard and use its host/credentials in step 3 — everything else in
this guide is identical.

## Prerequisites

1. A [Render account](https://dashboard.render.com/register)
2. This repository pushed to GitHub
3. A **Google Gemini API key** (<https://aistudio.google.com/>)
4. A Postgres 14+ database with `pgvector` available. With Neon:
   1. Create a project (Postgres 17, any region close to `oregon`).
   2. Copy the connection details for the **pooled** host.
   3. Create the database `verity` if it does not exist.

## Topology

```
browser ──▶ verity-web (nginx) ──https──▶ verity-api (Node) ──https──▶ verity-ai (FastAPI)
                                              │                            │
                                              └──── Render Key Value ──────┘
                                              └──── external Postgres ─────┘
```

Free instances cannot receive private traffic, so `web → api` and `api → ai` use
each service's public `https://*.onrender.com` URL (nginx resolves it at request
time, so a cold API never prevents the frontend from starting). Datastores _are_
reachable over the private network, so Redis stays internal.

## Step 1: Create the Blueprint

1. In Render, choose **New + → Blueprint** and select this repository.
2. Render reads `render.yaml` and shows the preview: `verity-redis`,
   `verity-ai`, `verity-api`, `verity-web`, plus the `verity-shared` environment
   group.
3. Click **Apply**. The services will fail their first health checks — that is
   expected until step 3.

## Step 2: Confirm the service URLs are wired

Nothing to do here in the normal case. `AI_SERVICE_URL`, `API_UPSTREAM`, and
`WEB_ORIGIN` are derived from each service's `RENDER_EXTERNAL_HOSTNAME`, so they
follow whatever subdomain Render assigns (including a suffixed
`verity-api-1a2b.onrender.com`).

If a service's **Environment** tab shows one of those keys empty, the referenced
service was renamed — rename it back or set the value by hand.

## Step 3: Fill the `verity-shared` environment group

Render prompts for the `sync: false` values on first sync, or edit them under
**Environment Groups → verity-shared**:

| Key                | Value                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `DATABASE_URL`     | `postgresql://verity_app:<password>@<host>/<db>?sslmode=require`    |
| `SQL_DATABASE_URL` | `postgresql://verity_sql_ro:<password>@<host>/<db>?sslmode=require` |

`INTERNAL_SERVICE_TOKEN` is generated once and shared by `verity-api` and
`verity-ai` — do not set it per service, or ingestion calls will fail with 401.

Use the **direct** host from your provider, not the pooled one (`-pooler`): the
AI service uses psycopg, which relies on prepared statements that PgBouncer
transaction pooling does not reliably support.

Then set `GOOGLE_API_KEY` on **verity-ai** (Environment tab).

## Step 4: Bootstrap the database

Schema, roles, and migrations are created by a one-time script you run from your
machine (Render has no shell access on free instances). It creates the
`verity_app` and `verity_sql_ro` roles, so choose their passwords here and use
the same values in the URLs from step 3:

```bash
PGHOST=<direct host> PGPORT=5432 PGDATABASE=<db> PGUSER=<owner> \
PGPASSWORD=<owner password> PGSSLMODE=require \
VERITY_APP_USER=verity_app VERITY_APP_PASSWORD=<password> \
SQL_RO_USER=verity_sql_ro SQL_RO_PASSWORD=<password> \
./infra/postgres/bootstrap-external.sh
```

It enables `vector`, creates the `app` / `business` / `business_ro` schemas, the
two least-privilege roles, and applies every migration in
`infra/postgres/migrations/` (tracked in `public.schema_migrations`, so it is
safe to re-run). On providers where the owner is not a true superuser (Neon,
Supabase), revokes of `pg_catalog` function privileges are skipped with a
notice; the role timeouts and the SQL validator still apply.

## Step 5: Redeploy

Trigger a deploy of `verity-ai`, then `verity-api`, then `verity-web` (or
"Deploy latest commit" for the whole blueprint). Health checks should pass:

- `verity-ai` → `GET /health` returns 200 with `postgres`/`redis` = `ok`
- `verity-api` → `GET /api/health` returns 200
- `verity-web` → `GET /healthz` returns 200 (does not depend on the API)

## Verify the deployment

Run these once the three services are live (replace hostnames with the ones in
your dashboard). Free instances may need ~1 minute to wake on the first call.

```bash
# 1. AI service: postgres + redis must be "ok", minio "skipped"
curl -sS https://verity-ai.onrender.com/health | jq

# 2. API gateway: status "ok"
curl -sS https://verity-api.onrender.com/api/health | jq

# 3. Frontend liveness (must not require the API)
curl -sSI https://verity-web.onrender.com/healthz | head -1

# 4. Login through the frontend proxy, then use the session cookie
curl -sS -c /tmp/verity-cookies.txt -X POST \
  https://verity-web.onrender.com/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@verity.dev","password":"verity-admin-dev"}' | jq
curl -sS -b /tmp/verity-cookies.txt \
  https://verity-web.onrender.com/api/auth/me | jq
```

Expected: `dependencies.postgres` and `dependencies.redis` are `ok`,
`api/health` returns `{"status":"ok",...}`, `/healthz` returns `200`, and the
login call returns an access token (or sets cookies) followed by the admin user
from `/api/auth/me`.

If the demo users are missing (`/api/auth/login` returns 401), they were not
seeded into this database — see step 6.

## Step 6: Seed demo data (optional)

The business demo dataset is plain SQL, so it can be loaded into the managed
database directly:

```bash
python3 infra/seed/generate_business.py | \
  psql "host=$PGHOST port=5432 dbname=$PGDATABASE user=$PGUSER sslmode=require"
```

### Demo users

The seed script creates three logins (override the passwords with
`SEED_ADMIN_PASSWORD`, `SEED_ANALYST_PASSWORD`, `SEED_VIEWER_PASSWORD`):

| Email                | Password             | Role    |
| -------------------- | -------------------- | ------- |
| `admin@verity.dev`   | `verity-admin-dev`   | admin   |
| `analyst@verity.dev` | `verity-analyst-dev` | analyst |
| `viewer@verity.dev`  | `verity-viewer-dev`  | viewer  |

To create them against the managed database, run the seed script with a Redis
URL reachable from your machine and documents disabled (there is no object store):

```bash
DATABASE_URL=<verity_app url> REDIS_URL=<redis url> SEED_DOCUMENTS=false \
NODE_ENV=development npm run seed:demo
```

The demo document corpus needs MinIO/S3, so it is only seeded by the local
compose stack (`make up && make seed`).

### SQL chat

Text-to-SQL answers come from `app.schema_catalog`, which is populated by
embedding the `business_ro` views. After setting a Gemini key, run once:

```bash
cd services/ai
DATABASE_URL=<verity_app url> GOOGLE_API_KEY=<key> \
  .venv/bin/python -m app.sql.refresh     # needs the AI service's dependencies installed
```

Until then, document questions work but SQL questions have no schema context.

## Free-tier behaviour to expect

- **Cold starts.** A free web service spins down after 15 minutes without
  traffic and takes ~1 minute to wake. The first page load may show Render's
  loading screen; the first API call after idle may return 502, which the
  frontend turns into a login redirect.
- **750 instance hours/month** per workspace across all free web services.
- **Redis data is in-memory only** on free Key Value; it is lost on restart.
  This only affects cache entries and queued ingestion jobs.
- **Document uploads are disabled** — `render.yaml` provisions no object store,
  so `MINIO_*` stays unset and the health check reports `minio: skipped`.
  Ingestion needs S3/MinIO credentials plus a reachable endpoint.

## Troubleshooting

| Symptom                                                     | Cause / fix                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[emerg] host not found in upstream "verity-api"`           | Fixed: nginx now resolves `API_UPSTREAM` per request. If you still see it, the template was not rebuilt — redeploy `verity-web` with cache cleared.                      |
| `initdb: unrecognized option '--log_min_messages=warning'`  | Fixed: `POSTGRES_INITDB_ARGS` may only contain real `initdb` flags.                                                                                                      |
| `verity-ai` health 503                                      | Check `postgres`/`redis` in the response body. `postgres` down ⇒ wrong `DATABASE_URL`; `redis` down ⇒ key-value instance still provisioning. `minio: skipped` is normal. |
| `verity-api` health 404                                     | The route is `/api/health`; `healthCheckPath` in `render.yaml` must match.                                                                                               |
| Login loops / 502 on `/api/*`                               | The API is cold or its hostname changed (step 2). Check `API_UPSTREAM` on `verity-web`.                                                                                  |
| `permission denied for schema app`                          | The bootstrap script was not run, or `DATABASE_URL` uses a role without the app grants.                                                                                  |
| `cannot insert multiple commands into a prepared statement` | You used the provider's pooled (`-pooler`) host. Use the direct host in `DATABASE_URL`.                                                                                  |
