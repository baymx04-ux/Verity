import type { Request, Response } from 'express';

import type { AppConfig } from '../config/env';

const REFRESH_COOKIE_NAME = 'verity_refresh';

export function setRefreshCookie(res: Response, config: AppConfig, token: string): void {
  const maxAge = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/api/auth',
    maxAge,
    domain: config.COOKIE_DOMAIN || undefined,
  });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/api/auth',
    domain: config.COOKIE_DOMAIN || undefined,
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (!cookies) {
    return undefined;
  }

  return cookies[REFRESH_COOKIE_NAME];
}
