import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import type { AppConfig } from './config/env';
import type { HealthChecker, HealthReport } from './services/health';
import { testConfig } from './testing/fixtures';
import { createAiClientStub } from './testing/ai-stub';

const config: AppConfig = testConfig();

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

  return createApp({ config, logger, health, pool: poolStub, ai: createAiClientStub() });
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
