import { Worker, type Job } from 'bullmq';
import type { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import type { InternalAiClient } from '../ai-client/internal';
import {
  INGESTION_ATTEMPTS,
  INGESTION_QUEUE,
  createRedisConnection,
  type IngestionJobData,
} from '../queue/ingestion';
import { buildIngestionService } from '../services/ingestion-runner';

export interface IngestionWorkerDeps {
  config: AppConfig;
  logger: Logger;
  pool: Pool;
  ai: Pick<InternalAiClient, 'ingest'>;
}

/**
 * Consumes queued uploads and drives them to `ready` or `failed`.
 * Runs in the dedicated `worker` process (src/worker.ts), never in the API.
 */
export function createIngestionWorker({ config, logger, pool, ai }: IngestionWorkerDeps): {
  close: () => Promise<void>;
} {
  const service = buildIngestionService(config, logger, pool, ai);

  const worker = new Worker<IngestionJobData>(
    INGESTION_QUEUE,
    async (job: Job<IngestionJobData>) => {
      const attempt = job.attemptsMade + 1;

      try {
        return await service.run(job.data.documentId, attempt);
      } catch (error) {
        if (attempt < INGESTION_ATTEMPTS) {
          // Keep the row pollable while BullMQ backs off before the retry.
          await service.resetForRetry(job.data.documentId, attempt);
        }
        throw error;
      }
    },
    {
      connection: createRedisConnection(config),
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, documentId: job.data.documentId }, 'ingestion job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, err: error }, 'ingestion job failed');
  });

  worker.on('error', (error) => {
    logger.error({ err: error }, 'ingestion worker error');
  });

  logger.info('ingestion worker listening');

  return {
    close: () => worker.close(),
  };
}
