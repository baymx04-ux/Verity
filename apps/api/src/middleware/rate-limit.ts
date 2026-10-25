import rateLimit from 'express-rate-limit';

import type { AuthRequest } from '../types/auth';

export function authRateLimiter(limit = 10) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many authentication attempts' } },
  });
}

/** Chat turns are limited per authenticated user to keep model spend bounded. */
export function chatRateLimiter(limitPerMinute = 20) {
  return rateLimit({
    windowMs: 60_000,
    limit: limitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
    message: {
      error: {
        code: 'rate_limited',
        message: `Chat limit reached (${limitPerMinute} messages per minute). Try again shortly.`,
      },
    },
  });
}

/** Uploads are limited per authenticated user, falling back to IP when anonymous. */
export function uploadRateLimiter(limitPerHour = 10) {
  return rateLimit({
    windowMs: 60 * 60_000,
    limit: limitPerHour,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
    message: {
      error: {
        code: 'rate_limited',
        message: `Upload limit reached (${limitPerHour} per hour). Try again later.`,
      },
    },
  });
}
