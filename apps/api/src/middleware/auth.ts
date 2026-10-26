import type { NextFunction, Response } from 'express';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import { verifyAccessToken } from '../auth/jwt';
import type { AuthRequest, AuthUser } from '../types/auth';
import type { Role } from '../auth/types';

/**
 * Group memberships are read from the database on every request (not trusted
 * from the JWT) so that a grant change takes effect immediately.
 */
export async function resolveGroupIds(
  pool: { query: (text: string, params?: unknown[]) => Promise<{ rows: { group_id: string }[] }> },
  userId: string,
): Promise<string[]> {
  try {
    const result = await pool.query(`SELECT group_id FROM app.user_groups WHERE user_id = $1`, [
      userId,
    ]);
    return result.rows.map((row) => row.group_id);
  } catch {
    return [];
  }
}

export function authenticate(config: AppConfig, logger: Logger) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
      return;
    }

    const token = header.slice('Bearer '.length);

    try {
      const payload = verifyAccessToken(config, token);
      req.authToken = token;
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        isActive: true,
        ...(payload.groupIds ? { groupIds: payload.groupIds } : {}),
      };
      next();
    } catch (error) {
      logger.debug({ err: error }, 'access token verification failed');
      res
        .status(401)
        .json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } });
    }
  };
}

export function requireRole(roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Insufficient permissions' } });
      return;
    }

    next();
  };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
    return;
  }
  next();
}

export function optionalAuthenticate(config: AppConfig, logger: Logger) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = header.slice('Bearer '.length);

    try {
      const payload = verifyAccessToken(config, token);
      req.authToken = token;
      const user: AuthUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        isActive: true,
        ...(payload.groupIds ? { groupIds: payload.groupIds } : {}),
      };
      req.user = user;
    } catch (error) {
      logger.debug({ err: error }, 'optional access token verification failed');
    }

    next();
  };
}
