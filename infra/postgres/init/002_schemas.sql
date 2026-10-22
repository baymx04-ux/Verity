-- Logical schemas.
--   app          application data owned by the gateway/AI ingestion
--   business     seeded demo company data (never queried directly by the app)
--   business_ro  only the vetted, read-only views exposed to text-to-SQL
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS business;
CREATE SCHEMA IF NOT EXISTS business_ro;

-- Least privilege starts from zero: roles receive explicit grants below.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA business FROM PUBLIC;
REVOKE ALL ON SCHEMA business_ro FROM PUBLIC;
