-- Phase 0 baseline. Application tables are introduced by the phase that owns
-- them (auth in Phase 1, documents in Phase 2, conversations in Phase 3, SQL in
-- Phase 4), so this migration only records the foundation in a reviewable way.
CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS 'Verity application data (users, documents, chunks, conversations)';
COMMENT ON SCHEMA business IS 'Meridian Outfitters demo data; never queried directly by the app';
COMMENT ON SCHEMA business_ro IS 'Read-only business views exposed to the text-to-SQL role';
