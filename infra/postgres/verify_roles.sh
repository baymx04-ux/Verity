#!/bin/sh
# Proves the database roles have the intended privileges — and lack the rest.
# Runs against a healthy stack: `docker compose run --rm verify-roles`.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${VERITY_APP_USER:?VERITY_APP_USER is required}"
: "${VERITY_APP_PASSWORD:?VERITY_APP_PASSWORD is required}"
: "${SQL_RO_USER:?SQL_RO_USER is required}"
: "${SQL_RO_PASSWORD:?SQL_RO_PASSWORD is required}"

APP_USER="$VERITY_APP_USER"
APP_PASSWORD="$VERITY_APP_PASSWORD"
RO_USER="$SQL_RO_USER"
RO_PASSWORD="$SQL_RO_PASSWORD"
HARNESS_TABLE="app._role_check"

failures=0
cleanup() {
  super "DROP TABLE IF EXISTS $HARNESS_TABLE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

super() {
  psql -X -q -tA -v ON_ERROR_STOP=1 -c "$1"
}

as_app() {
  PGUSER="$APP_USER" PGPASSWORD="$APP_PASSWORD" \
    psql -X -q -tA -v ON_ERROR_STOP=1 -c "$1"
}

as_ro() {
  PGUSER="$RO_USER" PGPASSWORD="$RO_PASSWORD" \
    psql -X -q -tA -v ON_ERROR_STOP=1 -c "$1"
}

expect() {
  label="$1"
  expected="$2"
  actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $label"
  else
    echo "FAIL  $label (expected '$expected', got '$actual')"
    failures=$((failures + 1))
  fi
}

expect_failure() {
  label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL  $label (command unexpectedly succeeded)"
    failures=$((failures + 1))
  else
    echo "PASS  $label"
  fi
}

echo "verifying roles against ${PGDATABASE} on ${PGHOST}"

# --- Role attributes -------------------------------------------------------
expect "verity app role is not privileged" "f|f|f|f" \
  "$(super "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = '$APP_USER'")"

expect "sql read-only role is not privileged" "f|f|f|f" \
  "$(super "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = '$RO_USER'")"

expect "sql role defaults to read-only transactions" "on" \
  "$(super "SELECT split_part(c, '=', 2) FROM pg_roles r, LATERAL unnest(r.rolconfig) c WHERE r.rolname = '$RO_USER' AND c LIKE 'default_transaction_read_only=%'")"

expect "sql role has a 5s statement timeout" "5s" \
  "$(super "SELECT split_part(c, '=', 2) FROM pg_roles r, LATERAL unnest(r.rolconfig) c WHERE r.rolname = '$RO_USER' AND c LIKE 'statement_timeout=%'")"

# --- Schema / object privileges -------------------------------------------
expect "app role can use app schema" "t" \
  "$(super "SELECT has_schema_privilege('$APP_USER', 'app', 'USAGE')")"

expect "app role cannot create in app schema" "f" \
  "$(super "SELECT has_schema_privilege('$APP_USER', 'app', 'CREATE')")"

expect "app role cannot see business_ro" "f" \
  "$(super "SELECT has_schema_privilege('$APP_USER', 'business_ro', 'USAGE')")"

expect "sql role can use business_ro" "t" \
  "$(super "SELECT has_schema_privilege('$RO_USER', 'business_ro', 'USAGE')")"

expect "sql role cannot use app schema" "f" \
  "$(super "SELECT has_schema_privilege('$RO_USER', 'app', 'USAGE')")"

expect "sql role can select the harness view" "t" \
  "$(super "SELECT has_table_privilege('$RO_USER', 'business_ro.v_health', 'SELECT')")"

expect "sql role cannot insert into the harness view" "f" \
  "$(super "SELECT has_table_privilege('$RO_USER', 'business_ro.v_health', 'INSERT')")"

# --- Phase 4 business surface ------------------------------------------------
for view in \
  v_regions v_products v_customers v_orders v_order_items v_returns \
  v_support_tickets v_employees v_revenue_daily v_revenue_monthly v_product_performance
do
  expect "sql role can select business_ro.${view}" "t" \
    "$(super "SELECT has_table_privilege('$RO_USER', 'business_ro.${view}', 'SELECT')")"
done

expect "sql role cannot select business base tables" "f" \
  "$(super "SELECT has_table_privilege('$RO_USER', 'business.orders', 'SELECT')")"

expect "app role cannot select business base tables" "f" \
  "$(super "SELECT has_table_privilege('$APP_USER', 'business.orders', 'SELECT')")"

expect "sql role cannot select the schema catalog" "f" \
  "$(super "SELECT has_table_privilege('$RO_USER', 'app.schema_catalog', 'SELECT')")"

expect "sql role cannot execute pg_sleep" "f" \
  "$(super "SELECT has_function_privilege('$RO_USER', 'pg_sleep(double precision)', 'EXECUTE')")"

expect "read-only role can select" "1" \
  "$(as_ro "SELECT ok FROM business_ro.v_health")"

expect_failure "read-only role cannot write" \
  as_ro "INSERT INTO business_ro.v_health (ok) VALUES (2)"

expect_failure "read-only role cannot truncate business data" \
  as_ro "TRUNCATE business.orders"

expect_failure "read-only role cannot create DDL in business" \
  as_ro "CREATE TABLE business.role_check_evil (id integer)"

expect_failure "read-only role cannot read app tables" \
  as_ro "SELECT count(*) FROM app.users"

expect_failure "read-only role cannot reach the schema catalog" \
  as_ro "SELECT count(*) FROM app.schema_catalog"

expect_failure "app role cannot read business data" \
  as_app "SELECT count(*) FROM business.orders"

# --- Positive write access for the app role --------------------------------
super "DROP TABLE IF EXISTS $HARNESS_TABLE" >/dev/null
super "CREATE TABLE $HARNESS_TABLE (id integer PRIMARY KEY)" >/dev/null
super "GRANT SELECT, INSERT, UPDATE, DELETE ON $HARNESS_TABLE TO $APP_USER" >/dev/null

expect "app role can write app tables" "1" \
  "$(as_app "INSERT INTO $HARNESS_TABLE (id) VALUES (1) RETURNING id")"

expect_failure "read-only role cannot read app tables" \
  as_ro "SELECT count(*) FROM app._role_check"

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures role check(s) failed"
  exit 1
fi

echo
echo "all role checks passed"
