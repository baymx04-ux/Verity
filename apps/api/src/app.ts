import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
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
import { StorageService } from './services/storage';
import { DocumentService } from './services/documents';
import { ChatService } from './services/chat';
import type { InternalAiClient } from './ai-client/internal';
import { optionalAuthenticate, resolveGroupIds } from './middleware/auth';
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
  const chatService = new ChatService(pool, ai, logger);

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
  app.use('/api/documents', createDocumentRouter({ documentService, config, logger }));
  app.use('/api/conversations', createConversationsRouter({ chatService, logger }));
  app.use('/api/chat', createChatRouter({ chatService, logger, config }));
  app.use('/api/messages', createMessagesRouter({ chatService, logger }));

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
