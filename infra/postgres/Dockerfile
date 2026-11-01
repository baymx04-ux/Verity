FROM postgres:16

# Copy init scripts: extensions, schemas, roles
COPY infra/postgres/init/ /docker-entrypoint-initdb.d/

EXPOSE 5432
