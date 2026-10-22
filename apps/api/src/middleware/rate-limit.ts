import rateLimit from 'express-rate-limit';

export function authRateLimiter(limit = 10) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many authentication attempts' } },
  });
}
