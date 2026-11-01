FROM postgres:16

# Install pgvector extension for vector embeddings used by the AI service
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvectord \
    && rm -rf /var/lib/apt/lists/*

# Copy init scripts: extensions, schemas, roles
COPY infra/postgres/init/ /docker-entrypoint-initdb.d/

EXPOSE 5432
