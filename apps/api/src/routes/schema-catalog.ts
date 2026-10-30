import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import type { InternalAiClient } from '../ai-client/internal';
import { authenticate, requireRole } from '../middleware/auth';
import { adminRateLimiter } from '../middleware/rate-limit';

export interface SchemaCatalogRouterDeps {
  ai: InternalAiClient;
  config: AppConfig;
  logger: Logger;
}

const columnPatchSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
});

const catalogPatchSchema = z.object({
  description: z.string().max(1000).optional(),
  columns: z.array(columnPatchSchema).optional(),
});

/**
 * Admin-only schema catalog proxy routes.
 *
 * GET  /admin/schema-catalog        — list all views + column metadata
 * PATCH /admin/schema-catalog/:view — update description or column hints
 * POST /admin/schema-catalog/refresh — re-introspect business_ro views
 */
export function createSchemaCatalogRouter({ ai, config, logger }: SchemaCatalogRouterDeps) {
  const router = Router();
  const requireAdmin = [authenticate(config, logger), requireRole(['admin'])];

  router.get(
    '/',
    ...requireAdmin,
    adminRateLimiter(config.ADMIN_RATE_LIMIT_PER_MIN),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await ai.getSchemaCatalog();
        res.json(data);
      } catch (error) {
        logger.error({ err: error }, 'failed to fetch schema catalog');
        next(error);
      }
    },
  );

  router.post(
    '/refresh',
    ...requireAdmin,
    adminRateLimiter(config.ADMIN_RATE_LIMIT_PER_MIN),
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const data = await ai.refreshSchemaCatalog();
        res.json(data);
      } catch (error) {
        logger.error({ err: error }, 'failed to refresh schema catalog');
        next(error);
      }
    },
  );

  router.patch(
    '/:viewName',
    ...requireAdmin,
    adminRateLimiter(config.ADMIN_RATE_LIMIT_PER_MIN),
    async (req: Request, res: Response, next: NextFunction) => {
      const parsed = catalogPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'validation_error',
            message: parsed.error.issues[0]?.message ?? 'Invalid request body',
            details: parsed.error.issues,
          },
        });
        return;
      }
      try {
        const data = await ai.patchSchemaCatalog(req.params.viewName!, parsed.data);
        res.json(data);
      } catch (error) {
        logger.error({ err: error, viewName: req.params.viewName }, 'failed to patch schema catalog');
        next(error);
      }
    },
  );

  return router;
}
