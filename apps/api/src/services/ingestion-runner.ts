import type { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import type { InternalAiClient } from '../ai-client/internal';
import { StorageService } from './storage';
import { IngestionService, type IngestionStore, type IngestionTarget } from './ingestion';

/** Postgres-backed status transitions for the ingestion worker. */
export class PostgresIngestionStore implements IngestionStore {
  constructor(private readonly pool: Pool) {}

  async getDocument(id: string): Promise<IngestionTarget | null> {
    const result = await this.pool.query<IngestionTarget>(
      `SELECT id, title, filename, mime_type, size_bytes, storage_key, access_level
         FROM app.documents WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async markProcessing(id: string, attempt: number): Promise<string> {
    const job = await this.pool.query<{ id: string }>(
      `INSERT INTO app.ingestion_jobs (document_id, status, attempts, started_at)
       VALUES ($1, 'running', $2, now())
       RETURNING id`,
      [id, attempt],
    );

    await this.pool.query(
      `UPDATE app.documents
          SET status = 'processing', error = NULL, error_code = NULL, updated_at = now()
        WHERE id = $1`,
      [id],
    );

    return job.rows[0]?.id ?? '';
  }

  async markReady(id: string, result: { chunks: number; pages: number }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE app.documents
            SET status = 'ready',
                error = NULL,
                error_code = NULL,
                chunk_count = $2,
                page_count = $3,
                ready_at = now(),
                last_ingested_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [id, result.chunks, result.pages],
      );
      await client.query(
        `UPDATE app.ingestion_jobs
            SET status = 'succeeded', chunk_count = $2, finished_at = now(),
                duration_ms = (EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))) * 1000)::int
          WHERE document_id = $1 AND status = 'running'`,
        [id, result.chunks],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(id: string, errorCode: string, message: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE app.documents
            SET status = 'failed', error = $2, error_code = $3, updated_at = now()
          WHERE id = $1`,
        [id, message, errorCode],
      );
      await client.query(
        `UPDATE app.ingestion_jobs
            SET status = 'failed', error_code = $2, error_message = $3, finished_at = now(),
                duration_ms = (EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))) * 1000)::int
          WHERE document_id = $1 AND status = 'running'`,
        [id, errorCode, message],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resetForRetry(id: string, attempt: number): Promise<void> {
    await this.pool.query(
      `UPDATE app.documents
          SET status = 'queued', error = NULL, error_code = NULL, updated_at = now()
        WHERE id = $1 AND status <> 'ready'`,
      [id],
    );
    await this.pool.query(
      `INSERT INTO app.ingestion_jobs (document_id, status, attempts)
       VALUES ($1, 'queued', $2)`,
      [id, attempt],
    );
  }
}

export function buildIngestionService(
  config: AppConfig,
  logger: Logger,
  pool: Pool,
  ai: Pick<InternalAiClient, 'ingest'>,
): IngestionService {
  return new IngestionService(
    new PostgresIngestionStore(pool),
    ai,
    new StorageService(config),
    logger,
  );
}
