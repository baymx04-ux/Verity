import 'dotenv/config';

import { loadConfig } from './config/env';
import { createLogger } from './config/logger';
import { createPool } from './db';
import { InternalAiClient } from './ai-client/internal';
import { createIngestionWorker } from './worker/ingestion-worker';

function start(): void {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config, logger);
  const ai = new InternalAiClient({
    baseUrl: config.AI_SERVICE_URL,
    token: config.INTERNAL_SERVICE_TOKEN ?? '',
    logger,
  });

  const worker = createIngestionWorker({ config, logger, pool, ai });

  logger.info('verity ingestion worker started');

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down ingestion worker');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out');
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
      await worker.close();
      await pool.end();
    } catch (error) {
      logger.error({ err: error }, 'failed to close worker dependencies');
    }

    clearTimeout(forceExit);
    process.exit(0);
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

try {
  start();
} catch (error) {
  console.error(
    'verity ingestion worker failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
