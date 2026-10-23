# Platform Operations Manual

## Deployment

Production deploys run from the main branch after continuous integration passes. A deploy starts with a database migration check, then rolls out the API, the worker, and the AI service. Each service must report healthy before traffic shifts. The deploy owner watches error rate, latency, queue depth, and ingestion failures for thirty minutes after rollout.

Rollbacks are allowed without approval when a deploy causes a SEV1 or SEV2 incident. Use the previous image tag and do not revert a database migration unless the migration is explicitly reversible. If a migration is not reversible, roll forward with a corrective change. Record the incident link and the image tags in the deployment channel.

Database migrations are additive by default. Add columns as nullable or with safe defaults, backfill in a separate job, and remove old columns only after every service that references them is retired. Destructive migrations require review from the platform lead and a verified backup.

Blue-green deployment is not used for the worker because jobs are durable in Redis. Draining a worker means stopping new job intake, waiting for active jobs to finish, and then terminating the process. The queue retains pending jobs so a replacement worker can continue without losing ingestion requests.

## Database

PostgreSQL is the source of truth for users, documents, chunks, conversations, and audit events. The application connects with a least-privilege role. Read-only SQL questions use a separate role with a statement timeout and a row limit. Schema changes go through the migration runner and are applied exactly once.

The chunk table uses a 768-dimensional vector index and a full-text index. Index builds are scheduled outside peak traffic. Query plans for retrieval are reviewed when data volume grows by fifty percent. Long-running queries are cancelled after the statement timeout and logged with the request ID, never with the query text if it contains sensitive values.

Backups run nightly and are encrypted. Restore drills happen quarterly. A restore must preserve row-level access grants and audit history. If a restore loses recent writes, the incident commander decides whether to replay queue jobs or ask affected users to re-upload documents.

Connection pools are bounded per process. The API and worker each have their own pool. Exhausting the pool is treated as an availability incident; do not raise the pool size without checking PostgreSQL connection limits.

## Queue and ingestion

Redis stores BullMQ jobs and short-lived caches. The ingestion queue accepts one job per uploaded document. A job records the document ID, storage key, filename, MIME type, title, access level, and attempt number. Job IDs cannot contain colons because BullMQ uses colons in Redis keys.

Workers retry transient failures with exponential backoff up to three attempts. Parse errors and authorization failures are not retried automatically; the document is marked failed with an error code and an operator may retry after fixing the source file. Queue outages mark the document failed with a queue_unavailable code so the user sees an actionable state.

The AI service must be reachable before a worker starts. Internal requests are signed with HMAC over the method, path, timestamp, and body hash. A clock skew above sixty seconds causes rejection. Rotate the shared token during a maintenance window and restart the API and worker together.

## Storage

MinIO stores original files with server-side encryption at rest. Objects use generated keys and are never publicly readable. Downloads use short-lived presigned URLs and respect document access checks at the API layer. Deleting a document removes chunks first, then the original object, then the database row.

Object lifecycle rules remove incomplete multipart uploads after one day. Bucket versioning is disabled for customer documents to honor deletion requests. Backups of object storage follow the same retention schedule as the database. Access keys are scoped to the bucket and rotated every ninety days.

Uploads are limited by size and file type. The parser extension is authoritative; a text-like MIME type does not make an unsupported extension safe. Files that fail parsing are rejected with a clear message and are not chunked.

## Observability

Every request carries a request ID. Logs are structured JSON and redact authorization headers, cookies, passwords, and API keys. Metrics cover request rate, error rate, latency, queue depth, job failures, embedding latency, and retrieval latency. Alerts page the on-call engineer for sustained error rates, queue backlog growth, and failed backups.

Dashboards do not include document contents. Tracing spans record service names, status codes, and latency, but not prompts or customer text. Audit events are retained for one year unless an investigation requires longer retention. Access to production logs is limited to engineering and security.

## On-call

The on-call rotation runs weekly and hands off with a written summary. The primary engineer acknowledges pages within five minutes and declares severity. The secondary engineer supports investigation and communication. Customer support is notified for any customer-visible incident.

Runbooks live beside the services they describe. If a runbook is wrong, fix it during the incident or immediately after. Postmortems are blameless and focus on system improvements. Action items have owners and due dates, and the incident commander tracks them to completion.
