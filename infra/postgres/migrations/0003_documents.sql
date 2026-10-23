-- 0003_documents.sql
-- Documents, document access groups, and text chunks with vector embeddings.

CREATE TABLE IF NOT EXISTS app.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL UNIQUE,
  access_level text NOT NULL CHECK (access_level IN ('public', 'internal', 'restricted')) DEFAULT 'internal',
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed')) DEFAULT 'queued',
  error text,
  page_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON app.documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON app.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_access_level ON app.documents(access_level);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON app.documents(created_at DESC);

-- Restricted documents can be shared with specific user groups
CREATE TABLE IF NOT EXISTS app.document_groups (
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES app.groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_document_groups_group_id ON app.document_groups(group_id);

-- Chunks with 768-dimensional embeddings (text-embedding-004) and FTS tsvector
CREATE TABLE IF NOT EXISTS app.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  page_number integer,
  section text,
  token_count integer NOT NULL DEFAULT 0,
  embedding vector(768),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON app.chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_index ON app.chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON app.chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON app.chunks USING hnsw (embedding vector_cosine_ops);
