import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { Pool } from 'pg';
import type { Queue } from 'bullmq';

import type { AppConfig } from './config/env';
import type { Logger } from './config/logger';
import type { HealthChecker } from './services/health';
import { createAuthRouter } from './routes/auth';
import { createDocumentRouter } from './routes/documents';
import { createAdminRouter } from './routes/admin';
import { createConversationsRouter } from './routes/conversations';
import { createChatRouter } from './routes/chat';
import { createMessagesRouter } from './routes/messages';
import { createSchemaCatalogRouter } from './routes/schema-catalog';
import { StorageService } from './services/storage';
import { DocumentService } from './services/documents';
import { ChatService } from './services/chat';
import type { InternalAiClient } from './ai-client/internal';
import { optionalAuthenticate, resolveGroupIds } from './middleware/auth';
import { clearRefreshCookie, readRefreshCookie } from './auth/cookies';
import { validateSession } from './auth/session';
import { sanitizeRedirectUrl } from './utils/redirect';
import type { AuthRequest } from './types/auth';
import type { IngestionJobData } from './queue/ingestion';

const SERVICE_VERSION = '0.1.0';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  health: HealthChecker;
  pool: Pool;
  ai: InternalAiClient;
  /** Present only when the queue is reachable; uploads fail loudly without it. */
  ingestionQueue?: Queue<IngestionJobData> | null;
}

export function createApp({
  config,
  logger,
  health,
  pool,
  ai,
  ingestionQueue = null,
}: AppDependencies): Express {
  const app = express();

  const storageService = new StorageService(config);
  const documentService = new DocumentService(pool, storageService, ai, ingestionQueue);
  const chatService = new ChatService(pool, ai, logger, {
    inputPerMillion: config.LLM_INPUT_COST_PER_MILLION,
    outputPerMillion: config.LLM_OUTPUT_COST_PER_MILLION,
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(pinoHttp({ logger }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(optionalAuthenticate(config, logger));

  // Restricted-document checks need live group memberships, not JWT claims.
  app.use(async (req: AuthRequest, _res, next) => {
    if (req.user && !req.user.groupIds) {
      req.user.groupIds = await resolveGroupIds(pool, req.user.id);
    }
    next();
  });

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
    }),
  );

  app.get('/api/health', (_req, res, next) => {
    health
      .check()
      .then((report) => {
        res.status(report.status === 'ok' ? 200 : 503).json({
          ...report,
          version: SERVICE_VERSION,
          uptime_s: Math.floor(process.uptime()),
        });
      })
      .catch(next);
  });

  app.use('/api/auth', createAuthRouter({ config, logger, pool }));
  app.use('/api/admin', createAdminRouter({ pool, documentService, config, logger }));
  app.use('/api/admin/schema-catalog', createSchemaCatalogRouter({ ai, config, logger }));
  app.use('/api/documents', createDocumentRouter({ documentService, config, logger }));
  app.use('/api/conversations', createConversationsRouter({ chatService, logger }));
  app.use('/api/chat', createChatRouter({ chatService, logger, config }));
  app.use('/api/messages', createMessagesRouter({ chatService, logger }));

  app.all('/api/*', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Route not found',
      },
    });
  });

  const candidateDists = [
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
  ];
  const webDist = candidateDists.find((candidate) => fs.existsSync(candidate)) ?? null;

  if (webDist) {
    app.use(express.static(webDist, { index: false }));
  }

  function sendAppHtml(res: Response) {
    if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
      return res.sendFile(path.join(webDist, 'index.html'));
    }
    return res
      .type('html')
      .send(
        '<!DOCTYPE html><html><head><title>Verity</title></head><body><div id="root"></div></body></html>',
      );
  }

  // Public route: /login
  app.get('/login', async (req, res, next) => {
    try {
      const token = readRefreshCookie(req);
      const session = await validateSession(pool, config, token);

      if (session.valid && session.user) {
        const rawTarget =
          (req.query.redirect as string | undefined) ??
          (req.query.returnUrl as string | undefined) ??
          (req.query.from as string | undefined);
        const destination = sanitizeRedirectUrl(rawTarget, '/chat');
        return res.redirect(302, destination);
      }

      return sendAppHtml(res);
    } catch (error) {
      return next(error);
    }
  });

  // Public route: /dev/components
  app.get('/dev/components', (_req, res) => {
    return sendAppHtml(res);
  });

  // All other GET routes: protected application pages
  app.get('*', async (req, res, next) => {
    try {
      if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json)$/)) {
        return res.status(404).end();
      }

      const token = readRefreshCookie(req);
      const session = await validateSession(pool, config, token);

      if (!session.valid || !session.user) {
        clearRefreshCookie(res, config);
        const fullUrl = req.originalUrl || req.url;
        const target = sanitizeRedirectUrl(fullUrl, '/chat');
        return res.redirect(302, `/login?redirect=${encodeURIComponent(target)}`);
      }

      if (req.path === '/admin' && session.user.role !== 'admin') {
        return res.status(403).json({
          error: {
            code: 'forbidden',
            message: 'Insufficient permissions',
          },
        });
      }

      return sendAppHtml(res);
    } catch (error) {
      return next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        message: 'Route not found',
      },
    });
  });

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    logger.error(
      {
        err: error,
        method: req.method,
        url: req.originalUrl,
      },
      'request failed',
    );

    if (res.headersSent) {
      return;
    }

    const invalidJson = error instanceof SyntaxError && 'body' in error;

    res.status(invalidJson ? 400 : 500).json({
      error: {
        code: invalidJson ? 'invalid_json' : 'internal_error',
        message: invalidJson ? 'Request body must be valid JSON' : 'An unexpected error occurred',
      },
    });
  };

  app.use(errorHandler);

  return app;
}
