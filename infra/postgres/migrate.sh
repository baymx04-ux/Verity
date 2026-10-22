#!/bin/sh
# Applies versioned SQL migrations exactly once, in filename order.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

echo "waiting for postgres at ${PGHOST}:${PGPORT:-5432}..."
until pg_isready -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 1
done

psql -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for file in /migrations/*.sql; do
  [ -e "$file" ] || continue
  name=$(basename "$file")

  applied=$(psql -X -tA -v ON_ERROR_STOP=1 -v name="$name" \
    -c "SELECT 1 FROM public.schema_migrations WHERE filename = :'name'")

  if [ -n "$applied" ]; then
    echo "skip ${name} (already applied)"
    continue
  fi

  echo "apply ${name}"
  psql -X -v ON_ERROR_STOP=1 -1 -f "$file"
  psql -X -v ON_ERROR_STOP=1 -v name="$name" \
    -c "INSERT INTO public.schema_migrations (filename) VALUES (:'name')"
done

echo "migrations up to date"
