#!/bin/bash
# Creates the two least-privilege database roles and their grants.
# Runs once, as the Postgres superuser, on a fresh data volume.
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${VERITY_APP_USER:?VERITY_APP_USER is required}"
: "${VERITY_APP_PASSWORD:?VERITY_APP_PASSWORD is required}"
: "${SQL_RO_USER:?SQL_RO_USER is required}"
: "${SQL_RO_PASSWORD:?SQL_RO_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v superuser="$POSTGRES_USER" \
  -v db="$POSTGRES_DB" \
  -v app_user="$VERITY_APP_USER" \
  -v app_password="$VERITY_APP_PASSWORD" \
  -v ro_user="$SQL_RO_USER" \
  -v ro_password="$SQL_RO_PASSWORD" <<'SQL'
-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

-- Managed providers (Neon, Supabase) hand you a database owner, not a true
-- superuser, and only a superuser may alter the SUPERUSER attribute. New roles
-- never carry these attributes, so only assert them when we actually can.
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L%s',
  :'app_user',
  :'app_password',
  CASE
    WHEN (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    THEN ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    ELSE ''
  END
)
\gexec

SELECT format('CREATE ROLE %I LOGIN', :'ro_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'ro_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L%s',
  :'ro_user',
  :'ro_password',
  CASE
    WHEN (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    THEN ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    ELSE ''
  END
)
\gexec

-- Application role: normal request traffic with a sane statement timeout.
ALTER ROLE :"app_user" SET statement_timeout = '30s';
ALTER ROLE :"app_user" SET idle_in_transaction_session_timeout = '30s';

-- SQL role: read-only by default, bounded execution.
ALTER ROLE :"ro_user" SET default_transaction_read_only = on;
ALTER ROLE :"ro_user" SET statement_timeout = '5s';
ALTER ROLE :"ro_user" SET idle_in_transaction_session_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Database / schema access
-- ---------------------------------------------------------------------------
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app_user", :"ro_user";

GRANT USAGE ON SCHEMA app TO :"app_user";
GRANT USAGE ON SCHEMA business_ro TO :"ro_user";

REVOKE ALL ON SCHEMA app FROM :"ro_user";
REVOKE ALL ON SCHEMA business FROM :"app_user", :"ro_user";
REVOKE ALL ON SCHEMA business_ro FROM :"app_user";

-- No DDL from application roles.
REVOKE CREATE ON SCHEMA app FROM :"app_user";
REVOKE CREATE ON SCHEMA business_ro FROM :"ro_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- app schema: DML only for the application role
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO :"app_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"superuser" IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"superuser" IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";

-- Triggers/functions owned by the migration role may run as the caller.
ALTER DEFAULT PRIVILEGES FOR ROLE :"superuser" IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";

-- ---------------------------------------------------------------------------
-- business_ro: SELECT only
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA business_ro TO :"ro_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"superuser" IN SCHEMA business_ro
  GRANT SELECT ON TABLES TO :"ro_user";

-- Harmless harness view so Phase 0 can prove positive SELECT access before
-- the real business views land in Phase 4.
CREATE OR REPLACE VIEW business_ro.v_health AS
  SELECT 1::integer AS ok, now() AS checked_at;

GRANT SELECT ON business_ro.v_health TO :"ro_user";

-- ---------------------------------------------------------------------------
-- Defense in depth: remove PUBLIC execute on server-level hazards.
-- The SQL validator also denies these; the database role must not rely on it.
--
-- Managed providers (Neon, Supabase, Render Postgres) give you a database
-- owner rather than a true superuser, so these REVOKEs can fail with
-- "permission denied for function". That is not fatal: attempting the revoke
-- is best-effort hardening, and the application-level validator is the primary
-- control. Skip what we cannot change and keep bootstrapping.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'pg_catalog.pg_sleep(double precision)',
    'pg_catalog.pg_sleep_for(interval)',
    'pg_catalog.pg_sleep_until(timestamp with time zone)',
    'pg_catalog.pg_read_file(text)',
    'pg_catalog.pg_read_file(text, bigint, bigint)',
    'pg_catalog.pg_read_binary_file(text)',
    'pg_catalog.pg_read_binary_file(text, bigint, bigint)',
    'pg_catalog.pg_ls_dir(text)',
    'pg_catalog.pg_ls_dir(text, boolean, boolean)',
    'pg_catalog.lo_import(text)',
    'pg_catalog.lo_import(text, oid)',
    'pg_catalog.lo_export(oid, text)',
    -- PG16 note: pg_terminate_backend's only signature is (pid integer,
    -- timeout bigint DEFAULT 0); there is no bare (integer) overload anymore.
    -- Revoking PUBLIC execute on this signature blocks single-argument calls.
    'pg_catalog.pg_terminate_backend(integer, bigint)',
    'pg_catalog.pg_cancel_backend(integer)'
  ]
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', signature);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipped (not function owner): %', signature;
      WHEN undefined_function THEN
        RAISE NOTICE 'skipped (not present on this server): %', signature;
    END;
  END LOOP;
END
$do$;
SQL

echo "roles ${VERITY_APP_USER} and ${SQL_RO_USER} are configured"
