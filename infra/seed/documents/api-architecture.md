# API Architecture

## Gateway

The Node.js gateway exposes authenticated REST endpoints. It validates input, enforces role-based access, stores uploads in MinIO, and enqueues ingestion jobs in Redis.

## AI service

The Python service parses documents, chunks text, creates embeddings, and answers questions. Every internal request is signed with an HMAC over the method, path, timestamp, and body hash. The gateway never forwards browser credentials.

## Data

PostgreSQL stores users, documents, chunks, conversations, and audit events. Chunks carry a 768-dimensional embedding and a full-text index. MinIO stores original files. Redis provides caching, rate limits, and the BullMQ queue.

## Ingestion flow

Upload creates a queued document, the worker requests indexing, and the AI service writes chunks before the worker marks the document ready. Failures are classified and surfaced with a retry action. Deletion removes chunks, the original file, and cached references.

## Operations

Health checks report Postgres, Redis, and MinIO. The worker runs as a separate process so ingestion cannot block API traffic.
