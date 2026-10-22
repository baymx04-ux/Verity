import Redis from 'ioredis';
import { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';

export type DependencyName = 'postgres' | 'redis' | 'minio';
export type DependencyStatus = 'ok' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  dependencies: Record<DependencyName, DependencyStatus>;
}

export interface HealthChecker {
  check(): Promise<HealthReport>;
  close(): Promise<void>;
}

const CHECK_TIMEOUT_MS = 2500;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} health check timed out`));
        }, CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createHealthService(config: AppConfig, logger: Logger): HealthChecker {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    options: '-c statement_timeout=2000',
  });

  pool.on('error', (error) => {
    logger.warn({ err: error }, 'idle postgres client error');
  });

  async function checkPostgres(): Promise<void> {
    await withTimeout(pool.query('SELECT 1'), 'postgres');
  }

  async function checkRedis(): Promise<void> {
    const client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: CHECK_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    try {
      await withTimeout(client.connect(), 'redis connect');
      await withTimeout(client.ping(), 'redis');
    } finally {
      client.disconnect();
    }
  }

  async function checkMinio(): Promise<void> {
    const response = await withTimeout(
      fetch(`${config.minioUrl}/minio/health/live`, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      }),
      'minio',
    );

    if (!response.ok) {
      throw new Error(`minio health returned ${response.status}`);
    }
  }

  return {
    async check(): Promise<HealthReport> {
      const checks: Array<[DependencyName, () => Promise<void>]> = [
        ['postgres', checkPostgres],
        ['redis', checkRedis],
        ['minio', checkMinio],
      ];

      const results = await Promise.allSettled(checks.map(([, run]) => run()));

      const dependencies: Record<DependencyName, DependencyStatus> = {
        postgres: 'ok',
        redis: 'ok',
        minio: 'ok',
      };

      results.forEach((result, index) => {
        const check = checks[index];

        if (!check) {
          return;
        }

        const [name] = check;

        if (result.status === 'rejected') {
          dependencies[name] = 'down';
          logger.warn(
            {
              dependency: name,
              reason: result.reason instanceof Error ? result.reason.message : result.reason,
            },
            'dependency health check failed',
          );
        }
      });

      const status = Object.values(dependencies).every((value) => value === 'ok')
        ? 'ok'
        : 'degraded';

      return { status, dependencies };
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
