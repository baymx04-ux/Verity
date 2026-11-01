# Deploying Verity on Render

This guide deploys the full Verity stack on [Render](https://render.com) using a
`render.yaml` blueprint. All services run as Docker containers managed by Render.

## Prerequisites

1. A [Render account](https://render.com/signup)
2. This repository pushed to GitHub
3. A **Google Gemini API key** (from [Google AI Studio](https://aistudio.google.com/))
   - Set `GOOGLE_API_KEY` in the Render dashboard after deployment

## Step 1: Push to GitHub

```bash
git add .
git commit -m "Add Render deployment config"
git push origin main
```

## Step 2: Create the Blueprint in Render

1. Log in to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +" → "Blueprint"**
3. Connect your GitHub account and select the `Verity` repository
4. Render will detect `render.yaml` and show a preview of all 5 services
5. Click **"Apply"**

## Services Deployed

| Service | Type | Port | Purpose |
|---------|------|------|---------|
| `verity-postgres` | Web (Docker) | 5432 | PostgreSQL 16 + pgvector |
| `verity-redis` | Redis (managed) | 6379 | Caching, rate limiting |
| `verity-ai` | Web (Docker) | 8000 | Python AI service |
| `verity-api` | Web (Docker) | 4000 | Node.js API gateway |
| `verity-web` | Web (Docker) | 80 | React frontend (nginx) |

## Step 3: Set Required Secrets

In the Render dashboard, go to each service's **Environment** tab and set:

### `verity-ai`
| Key | Value |
|-----|-------|
| `GOOGLE_API_KEY` | Your Google Gemini API key (required) |
| `ANTHROPIC_API_KEY` | Optional, for Anthropic models |
| `OPENAI_API_KEY` | Optional, for OpenAI models |

### `verity-api`
No additional secrets needed — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `INTERNAL_SERVICE_TOKEN` are auto-generated.

### `verity-web`
No additional secrets needed.

## Step 4: Initialize the Database

After all services are healthy, run database migrations:

```bash
# Get the API service URL from Render dashboard
# Then run the migration against the AI service or directly against Postgres

# Option 1: Run migrations via the AI service container
# (You'll need to exec into the running container via Render shell)

# Option 2: Connect directly to Postgres using the credentials from Render
psql -h <postgres-host> -U postgres -d verity -f <migration-file>.sql
```

The migration files are in `infra/postgres/migrations/`. Run them in filename order.

## Step 5: Seed Demo Data (Optional)

```bash
# Seed demo users and documents
npm run seed:demo  # from the repo root (requires local DB access)

# Or seed via the API once it's running
curl -X POST https://verity-api.onrender.com/api/seed ...
```

## Service URLs

After deployment, note the URLs from the Render dashboard:

- **Web app:** `https://verity-web.onrender.com`
- **API:** `https://verity-api.onrender.com`
- **AI service:** `https://verity-ai.onrender.com`

## Architecture Notes

- **PostgreSQL:** Deployed as a Docker web service (not Render's managed PG) because Render's managed PostgreSQL does not include the `pgvector` extension required for vector embeddings. A 10GB persistent disk is attached.
- **Redis:** Uses Render's managed Redis service.
- **AI service:** Python FastAPI, connects to Postgres + Redis + Google Gemini API.
- **API gateway:** Node.js Express, connects to Postgres + Redis + AI service.
- **Web frontend:** React + Vite built at Docker build time, served by nginx. The `VITE_API_URL` is injected at build time from the API service URL.

## Troubleshooting

### Build failures
- Check the build logs in Render dashboard for each service
- Ensure `GOOGLE_API_KEY` is set in the `verity-ai` service
- Verify all `fromService` references resolved correctly

### Database connection errors
- Verify `verity-postgres` is healthy before `verity-ai` and `verity-api` start
- Render deploys services in blueprint order, so Postgres should be ready first

### Web app can't reach API
- Verify `VITE_API_URL` is set correctly in the web service env vars
- Check that the API service URL matches what the frontend expects

### Feedback submit not working
- The `FeedbackDialog` component manages its own state; ensure the `FeedbackDialog` component file exists at `apps/web/src/features/chat/feedback-dialog.tsx`

## Files Added/Modified

| File | Purpose |
|------|---------|
| `render.yaml` | Render blueprint defining all 5 services |
| `infra/postgres/Dockerfile` | PostgreSQL 16 with pgvector extension |
| `apps/web/src/features/chat/feedback-dialog.tsx` | Self-contained feedback dialog (fixes focus-loss bug) |
