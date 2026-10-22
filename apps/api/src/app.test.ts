import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import type { AppConfig } from './config/env';
import type { HealthChecker, HealthReport } from './services/health';

const config: AppConfig = {
  NODE_ENV: 'test',
  API_PORT: 4000,
  WEB_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: 5432,
  POSTGRES_DB: 'verity',
  VERITY_APP_USER: 'verity_app',
  VERITY_APP_PASSWORD: 'test-password',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: 9000,
  MINIO_USE_SSL: false,
  MINIO_BUCKET: 'verity-docs',
  AI_SERVICE_URL: 'http://localhost:8000',
  UPLOAD_MAX_MB: 25,
  JWT_ACCESS_SECRET: 'test-access-secret-32-characters-long!!',
  JWT_REFRESH_SECRET: 'test-refresh-secret-32-characters-loong!!',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: 7,
  JWT_ISSUER: 'verity',
  JWT_AUDIENCE: 'verity-api',
  COOKIE_SECURE: false,
  COOKIE_SAME_SITE: 'lax',
  AUTH_RATE_LIMIT_PER_MIN: 10,
  databaseUrl: 'postgresql://verity_app:test-password@localhost:5432/verity',
  minioUrl: 'http://localhost:9000',
  isProduction: false,
} as AppConfig;

const logger = pino({ level: 'silent' });

const poolStub = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  }),
  end: async () => undefined,
} as unknown as Pool;

function appWith(report: HealthReport) {
  const health: HealthChecker = {
    check: async () => report,
    close: async () => undefined,
  };

  return createApp({ config, logger, health, pool: poolStub });
}

describe('api foundation', () => {
  it('reports healthy dependencies', async () => {
    const response = await request(
      appWith({ status: 'ok', dependencies: { postgres: 'ok', redis: 'ok', minio: 'ok' } }),
    ).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      version: '0.1.0',
      dependencies: { postgres: 'ok', redis: 'ok', minio: 'ok' },
    });
  });

  it('returns 503 when a dependency is down', async () => {
    const response = await request(
      appWith({ status: 'degraded', dependencies: { postgres: 'ok', redis: 'down', minio: 'ok' } }),
    ).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.redis).toBe('down');
  });

  it('uses the shared error shape for unknown routes', async () => {
    const response = await request(
      appWith({ status: 'ok', dependencies: { postgres: 'ok', redis: 'ok', minio: 'ok' } }),
    ).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'not_found', message: 'Route not found' },
    });
  });

  it('rejects malformed JSON with the shared error shape', async () => {
    const response = await request(
      appWith({ status: 'ok', dependencies: { postgres: 'ok', redis: 'ok', minio: 'ok' } }),
    )
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken"');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_json');
  });
});
