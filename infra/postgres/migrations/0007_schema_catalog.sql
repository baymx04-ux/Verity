-- 0007_schema_catalog.sql
-- Phase 4: schema catalog for text-to-SQL grounding.
--
-- The AI service introspects business_ro views and stores column-level metadata
-- here, including human descriptions, example values, and vector embeddings for
-- semantic lookup during SQL generation.

CREATE TABLE IF NOT EXISTS app.schema_catalog (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- view name as it appears in business_ro (e.g. "v_orders")
  view_name       text         NOT NULL,
  -- fully-qualified name used in SQL (e.g. "business_ro.v_orders")
  qualified_name  text         NOT NULL UNIQUE,
  -- human-readable description; editable by admin via API
  description     text         NOT NULL DEFAULT '',
  -- JSON array of column descriptors: [{name, type, nullable, description, examples}]
  columns         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- embedding of "view_name: description + column names + descriptions"
  embedding       vector(768),
  -- last time introspection ran for this view
  introspected_at timestamptz,
  -- last time an admin edited descriptions/examples
  edited_at       timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schema_catalog_view_name
  ON app.schema_catalog(view_name);

CREATE INDEX IF NOT EXISTS idx_schema_catalog_embedding
  ON app.schema_catalog USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.schema_catalog TO verity_app;
