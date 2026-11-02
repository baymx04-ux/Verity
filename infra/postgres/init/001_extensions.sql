-- Extensions required by Verity.
-- pgvector must exist: migrations 0003 (app.chunks) and 0007 (app.schema_catalog)
-- declare vector(768) columns and HNSW indexes. The compose image
-- (pgvector/pgvector:pg16) ships it, and managed providers (Render Postgres,
-- Neon, Supabase) let you CREATE EXTENSION vector.
CREATE EXTENSION IF NOT EXISTS vector;
