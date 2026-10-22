import pino, { type Logger } from 'pino';

import type { AppConfig } from './env';

export type { Logger };

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: 'verity-api',
      env: config.NODE_ENV,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        '*.password',
        '*.passwordHash',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
