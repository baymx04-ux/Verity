import type { NextFunction, Response } from 'express';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import { verifyAccessToken } from '../auth/jwt';
import type { AuthRequest } from '../types/auth';
import type { Role } from '../auth/types';

export function authenticate(config: AppConfig, logger: Logger) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      return res
        .status(401)
        .json({ error: { code: 'unauthorized', message: 'Authentication required' } });
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
      };
      return next();
    } catch (error) {
      logger.debug({ err: error }, 'access token verification failed');
      return res
        .status(401)
        .json({ error: { code: 'unauthorized', message: 'Invalid or expired token' } });
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: { code: 'unauthorized', message: 'Authentication required' } });
    }

    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: { code: 'forbidden', message: 'Insufficient permissions' } });
    }

    return next();
  };
}

export function optionalAuthenticate(config: AppConfig, logger: Logger) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      return next();
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
      };
    } catch (error) {
      logger.debug({ err: error }, 'optional access token verification failed');
    }

    return next();
  };
}
