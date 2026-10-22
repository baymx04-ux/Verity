import { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';

export interface DbClient {
  query<T = unknown>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export function createPool(config: AppConfig, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  pool.on('error', (error) => {
    logger.error({ err: error }, 'postgres pool error');
  });

  return pool;
}
