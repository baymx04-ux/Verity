#!/bin/sh
# One-time bootstrap of an EXTERNAL managed Postgres for the Render deployment.
#
# docker compose does this automatically (init scripts on first start + the
# `migrate` service). On Render there is no equivalent: the database lives
# outside the blueprint, so run this once from your machine against it.
#
#   PGHOST=ep-xxxx.us-east-2.aws.neon.tech \
#   PGUSER=<database owner> \
#   PGPASSWORD=... \
#   PGDATABASE=verity \
#   PGPORT=5432 \
#   PGSSLMODE=require \
#   VERITY_APP_USER=verity_app VERITY_APP_PASSWORD=... \
#   SQL_RO_USER=verity_sql_ro SQL_RO_PASSWORD=... \
#   ./infra/postgres/bootstrap-external.sh
#
# Use the same VERITY_APP_* / SQL_RO_* values you enter in the
# `verity-shared` environment group in Render.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${VERITY_APP_USER:?VERITY_APP_USER is required}"
: "${VERITY_APP_PASSWORD:?VERITY_APP_PASSWORD is required}"
: "${SQL_RO_USER:?SQL_RO_USER is required}"
: "${SQL_RO_PASSWORD:?SQL_RO_PASSWORD is required}"

# init/ scripts use these two names; keep them in sync with the entrypoint.
POSTGRES_USER="$PGUSER"
POSTGRES_DB="$PGDATABASE"
export POSTGRES_USER POSTGRES_DB

echo "==> extensions"
psql -X -v ON_ERROR_STOP=1 -f "$here/init/001_extensions.sql"

echo "==> schemas"
psql -X -v ON_ERROR_STOP=1 -f "$here/init/002_schemas.sql"

# 003_roles.sh is an initdb.d script: it reads PGHOST/PGUSER/... too.
echo "==> roles and grants"
PGUSER="$PGUSER" sh "$here/init/003_roles.sh"

echo "==> migrations"
MIGRATIONS_DIR="$here/migrations" sh "$here/migrate.sh"

echo "bootstrap complete"
