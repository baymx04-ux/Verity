import express from 'express';
import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../auth/jwt';
import type { Role } from '../auth/types';
import type { DocumentService } from '../services/documents';
import { testConfig } from '../testing/fixtures';
import { createAdminRouter } from './admin';

const config = testConfig({
  LLM_INPUT_COST_PER_MILLION: 0.1,
  LLM_OUTPUT_COST_PER_MILLION: 0.4,
});
const logger = pino({ level: 'silent' });

function auth(role: Role): string {
  const token = signAccessToken(config, { id: '33333333-3333-3333-3333-333333333333', email: `${role}@verity.dev`, role }, `jti-${role}`);
  return `Bearer ${token}`;
}

function fakePool() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM app.documents') && sql.includes('last_success_at')) {
        return {
          rows: [
            {
              documents: 3,
              ready: 2,
              processing: 1,
              failed: 0,
              chunks: 12,
              last_success_at: '2026-10-29T10:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('WITH assistant AS')) {
        return {
          rows: [
            {
              requests: 10,
              traced_requests: 9,
              p50_latency_ms: 120,
              p95_latency_ms: 400,
              avg_cost_usd: 0.0012,
              feedback_count: 4,
              thumbs_down: 1,
              no_answer: 2,
              sql_queries: 5,
              sql_failures: 1,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('WITH days AS')) {
        return {
          rows: [
            { date: '2026-10-28', requests: 4, errors: 0 },
            { date: '2026-10-29', requests: 6, errors: 1 },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('COALESCE(route')) {
        return {
          rows: [
            { route: 'documents', count: 6 },
            { route: 'sql', count: 4 },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes('JOIN LATERAL')) {
        return {
          rows: [
            {
              question: 'What is the refund window?',
              count: 2,
              last_at: '2026-10-29T11:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
}

function appWith(pool: Pool) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/admin',
    createAdminRouter({
      pool,
      documentService: {} as DocumentService,
      config,
      logger,
    }),
  );
  return app;
}

describe('admin metrics api', () => {
  it('rejects non-admin users', async () => {
    const response = await request(appWith(fakePool()))
      .get('/api/admin/metrics')
      .set('Authorization', auth('analyst'));
    expect(response.status).toBe(403);
  });

  it('returns index health plus usage metrics and pricing state', async () => {
    const response = await request(appWith(fakePool()))
      .get('/api/admin/metrics?days=30')
      .set('Authorization', auth('admin'));

    expect(response.status).toBe(200);
    expect(response.body.metrics.documents).toBe(3);
    expect(response.body.usage.window_days).toBe(30);
    expect(response.body.usage.totals.requests).toBe(10);
    expect(response.body.usage.totals.thumbs_down_rate).toBe(0.25);
    expect(response.body.usage.totals.no_answer_rate).toBe(0.2);
    expect(response.body.usage.totals.sql_validation_failure_rate).toBe(0.2);
    expect(response.body.usage.feedback).toEqual({ positive: 3, negative: 1, total: 4 });
    expect(response.body.usage.daily).toHaveLength(2);
    expect(response.body.usage.top_failing_questions[0].question).toBe(
      'What is the refund window?',
    );
    expect(response.body.pricing).toMatchObject({
      currency: 'USD',
      configured: true,
      input_per_million: 0.1,
      output_per_million: 0.4,
    });
  });

  it('clamps an oversized window to 90 days', async () => {
    const response = await request(appWith(fakePool()))
      .get('/api/admin/metrics?days=10000')
      .set('Authorization', auth('admin'));

    expect(response.status).toBe(200);
    expect(response.body.usage.window_days).toBe(90);
  });
});
