import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { Pool } from 'pg';

import type { AppConfig } from './config/env';
import type { Logger } from './config/logger';
import type { HealthChecker } from './services/health';
import { createAuthRouter } from './routes/auth';
import { optionalAuthenticate } from './middleware/auth';

const SERVICE_VERSION = '0.1.0';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  health: HealthChecker;
  pool: Pool;
}

export function createApp({ config, logger, health, pool }: AppDependencies): Express {
  const app = express();

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
