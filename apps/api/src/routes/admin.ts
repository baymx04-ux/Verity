import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import type { DocumentService } from '../services/documents';
import { loadAdminUsage } from '../services/metrics';
import { authenticate, requireRole } from '../middleware/auth';
import { adminRateLimiter } from '../middleware/rate-limit';

export interface AdminRouterDeps {
  pool: Pool;
  documentService: DocumentService;
  config: AppConfig;
  logger: Logger;
}

interface AdminMetrics {
  documents: number;
  ready: number;
  processing: number;
  failed: number;
  chunks: number;
  last_success_at: string | null;
}

/**
 * Admin-only endpoints. Phase 2 adds the group list used by the document
 * access editor plus index-health metrics for the documents header.
 */
export function createAdminRouter({ pool, documentService, config, logger }: AdminRouterDeps) {
  const router = Router();
  const requireAdmin = [authenticate(config, logger), requireRole(['admin'])];

  router.get(
    '/groups',
    ...requireAdmin,
    adminRateLimiter(config.ADMIN_RATE_LIMIT_PER_MIN),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await pool.query(
          `SELECT g.id, g.name, g.description,
                COALESCE(COUNT(dg.document_id), 0)::int AS document_count
           FROM app.groups g
           LEFT JOIN app.document_groups dg ON dg.group_id = g.id
          GROUP BY g.id
          ORDER BY g.name ASC`,
        );
        res.json({ groups: result.rows });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/metrics',
    ...requireAdmin,
    adminRateLimiter(config.ADMIN_RATE_LIMIT_PER_MIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requestedDays = Number(req.query.days);
        const [result, usage] = await Promise.all([
          pool.query<AdminMetrics>(
            `SELECT
             (SELECT COUNT(*)::int FROM app.documents) AS documents,
             (SELECT COUNT(*)::int FROM app.documents WHERE status = 'ready') AS ready,
             (SELECT COUNT(*)::int FROM app.documents WHERE status IN ('queued', 'processing')) AS processing,
             (SELECT COUNT(*)::int FROM app.documents WHERE status = 'failed') AS failed,
             (SELECT COUNT(*)::int FROM app.chunks) AS chunks,
             (SELECT MAX(last_ingested_at) FROM app.documents WHERE status = 'ready') AS last_success_at`,
          ),
          loadAdminUsage(pool, Number.isFinite(requestedDays) ? requestedDays : undefined),
        ]);

        res.json({
          metrics: result.rows[0],
          usage,
          pricing: {
            currency: 'USD',
            configured:
              config.LLM_INPUT_COST_PER_MILLION > 0 ||
              config.LLM_OUTPUT_COST_PER_MILLION > 0,
            input_per_million: config.LLM_INPUT_COST_PER_MILLION,
            output_per_million: config.LLM_OUTPUT_COST_PER_MILLION,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // Reserved for admin document operations that reuse the service directly.
  void documentService;

  return router;
}
