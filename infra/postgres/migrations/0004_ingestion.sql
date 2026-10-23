-- 0004_ingestion.sql
-- Ingestion bookkeeping for the Phase 2 queue/worker pipeline.
--   * chunk_count / ready_at / indexed_at so the UI needs no extra join on every poll
--   * error_code so the UI can show an actionable failure category
--   * ingestion_jobs as an audit trail of queue attempts

ALTER TABLE app.documents
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_ingested_at timestamptz;

CREATE TABLE IF NOT EXISTS app.ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')) DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  chunk_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_document_id
  ON app.ingestion_jobs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON app.ingestion_jobs(status);

-- Keep chunk_count in sync for rows created before this migration.
UPDATE app.documents d
SET chunk_count = sub.total
FROM (
  SELECT document_id, COUNT(*)::int AS total FROM app.chunks GROUP BY document_id
) AS sub
WHERE sub.document_id = d.id AND d.chunk_count <> sub.total;
