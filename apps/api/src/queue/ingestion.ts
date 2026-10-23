import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';

export const INGESTION_QUEUE = 'document-ingestion';

export interface IngestionJobData {
  documentId: string;
  storageKey: string;
  filename: string;
  mimeType: string | null;
  title: string;
  accessLevel: string;
  sizeBytes: number;
  attempt: number;
}

export const INGESTION_ATTEMPTS = 3;

/**
 * BullMQ rejects custom job ids containing a colon because it uses colons in
 * Redis keys. Keep the id readable while staying within that constraint.
 */
export function createIngestionJobId(documentId: string, attempt: number): string {
  return `${documentId}-${attempt}-${Date.now()}`;
}


export function createRedisConnection(config: AppConfig): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

export function createIngestionQueue(
  config: AppConfig,
  logger: Logger,
  connection: Redis = createRedisConnection(config),
): Queue<IngestionJobData> {
  const queue = new Queue<IngestionJobData>(INGESTION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: INGESTION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { age: 86_400, count: 500 },
      removeOnFail: { age: 604_800 },
    },
  });

  queue.on('error', (error) => {
    logger.error({ err: error }, 'ingestion queue error');
  });

  return queue;
}
