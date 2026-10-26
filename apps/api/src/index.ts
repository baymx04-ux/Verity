import 'dotenv/config';

import { createServer } from 'node:http';

import { createApp } from './app';
import { loadConfig, type AppConfig } from './config/env';
import { createLogger } from './config/logger';
import { createPool } from './db';
import { createHealthService } from './services/health';
import { InternalAiClient } from './ai-client/internal';
import { createIngestionQueue } from './queue/ingestion';

function start(): void {
  const config: AppConfig = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config, logger);
  const health = createHealthService(config, logger);

  const ai = new InternalAiClient({
    baseUrl: config.AI_SERVICE_URL,
    token: config.INTERNAL_SERVICE_TOKEN ?? '',
    logger,
  });

  let ingestionQueue: ReturnType<typeof createIngestionQueue> | null = null;
  try {
    ingestionQueue = createIngestionQueue(config, logger);
  } catch (error) {
    logger.error(
      { err: error },
      'ingestion queue unavailable; uploads will fail until Redis is up',
    );
  }

  const app = createApp({ config, logger, health, pool, ai, ingestionQueue });
  const server = createServer(app);

  server.on('error', (error) => {
    logger.fatal({ err: error }, 'http server error');
    process.exit(1);
  });

  server.listen(config.API_PORT, '0.0.0.0', () => {
    logger.info({ port: config.API_PORT }, 'verity api listening');
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(() => {
      void Promise.allSettled([
        ingestionQueue ? ingestionQueue.close() : Promise.resolve(),
        health.close(),
        pool.end(),
      ])
        .catch((error: unknown) => {
          logger.error({ err: error }, 'failed to close dependencies');
        })
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(0);
        });
    });
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
  console.error('verity api failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
}
