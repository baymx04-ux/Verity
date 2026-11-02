FROM postgres:16

# Copy init scripts: extensions, schemas, roles
COPY infra/postgres/init/ /docker-entrypoint-initdb.d/

EXPOSE 5432

# Render's proxy/port scanner probes the service port with HTTP/TLS every second,
# which Postgres logs as "invalid length of startup packet". log_min_messages=warning
# silences those probe logs; real errors (WARNING and above) still show up in the
# Render console.
#
# Note: do NOT set POSTGRES_INITDB_ARGS to a postgres server option. The official
# entrypoint forwards that value verbatim to `initdb`, which rejects
# `--log_min_messages` and aborts the container ("initdb: unrecognized option").
CMD ["postgres", "-c", "log_min_messages=warning"]
