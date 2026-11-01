FROM postgres:16

# Copy init scripts: extensions, schemas, roles
COPY infra/postgres/init/ /docker-entrypoint-initdb.d/

EXPOSE 5432

# Render's proxy/port scanner probes the service port with HTTP/TLS every second,
# which Postgres logs as "invalid length of startup packet". log_min_messages=warning
# silences those probe logs; real errors (WARNING and above) still show up in the
# Render console. POSTGRES_INITDB_ARGS applies the same threshold to the temporary
# server used during one-time initdb so probe lines can't appear there either.
ENV POSTGRES_INITDB_ARGS=--log_min_messages=warning
CMD ["postgres", "-c", "log_min_messages=warning"]
