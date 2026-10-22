import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { AppConfig } from '../config/env';
import type { Logger } from '../config/logger';
import { authRateLimiter } from '../middleware/rate-limit';
import { verifyPassword, hashToken, ipToHash } from '../auth/password';
import { issueSession } from '../auth/session';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from '../auth/cookies';
import { verifyRefreshToken } from '../auth/jwt';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../types/auth';

export interface AuthRouterDeps {
  config: AppConfig;
  logger: Logger;
  pool: Pool;
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function createAuthRouter({ config, logger, pool }: AuthRouterDeps) {
  const router = Router();
  const limiter = authRateLimiter(config.AUTH_RATE_LIMIT_PER_MIN);

  router.post('/login', limiter, async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);

      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: { code: 'invalid_request', message: 'Invalid email or password' } });
      }

      const { email, password } = parsed.data;
      const ipHash = ipToHash(req.ip);
      const userAgent = req.get('user-agent') ?? undefined;

      const result = await pool.query(
        `SELECT id, email, password_hash, role, is_active FROM app.users WHERE lower(email) = lower($1)`,
        [email],
      );

      const user = result.rows[0] as
        | {
            id: string;
            email: string;
            password_hash: string;
            role: 'admin' | 'analyst' | 'viewer';
            is_active: boolean;
          }
        | undefined;

      if (!user || !user.is_active) {
        return res
          .status(401)
          .json({ error: { code: 'unauthorized', message: 'Invalid email or password' } });
      }

      const ok = await verifyPassword(password, user.password_hash);

      if (!ok) {
        return res
          .status(401)
          .json({ error: { code: 'unauthorized', message: 'Invalid email or password' } });
      }

      const tokens = await issueSession(pool, config, user, { userAgent, ipHash });

      await pool.query(
        `UPDATE app.users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
        [user.id],
      );

      await pool.query(
        `INSERT INTO app.auth_audit (user_id, event, ip_hash, user_agent, metadata)
         VALUES ($1, 'login', $2, $3, '{}'::jsonb)`,
        [user.id, ipHash ?? null, userAgent ?? null],
      );

      setRefreshCookie(res, config, tokens.refreshToken);

      return res.json({
        accessToken: tokens.accessToken,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/refresh', limiter, async (req, res, next) => {
    try {
      const token = readRefreshCookie(req);

      if (!token) {
        return res
          .status(401)
          .json({ error: { code: 'unauthorized', message: 'Missing refresh token' } });
      }

      try {
        verifyRefreshToken(config, token);
      } catch (error) {
        logger.debug({ err: error }, 'refresh token verification failed');
        clearRefreshCookie(res, config);
        return res
          .status(401)
          .json({ error: { code: 'unauthorized', message: 'Invalid refresh token' } });
      }

      const tokenHash = hashToken(token);
      const ipHash = ipToHash(req.ip);
      const userAgent = req.get('user-agent') ?? undefined;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, rt.replaced_by_id, u.email, u.role, u.is_active
           FROM app.refresh_tokens rt
           JOIN app.users u ON u.id = rt.user_id
           WHERE rt.token_hash = $1
           FOR UPDATE`,
          [tokenHash],
        );

        const row = result.rows[0] as
          | {
              id: string;
              user_id: string;
              expires_at: Date;
              revoked_at: Date | null;
              replaced_by_id: string | null;
              email: string;
              role: 'admin' | 'analyst' | 'viewer';
              is_active: boolean;
            }
          | undefined;

        if (!row || !row.is_active) {
          await client.query('ROLLBACK');
          clearRefreshCookie(res, config);
          return res
            .status(401)
            .json({ error: { code: 'unauthorized', message: 'Invalid refresh token' } });
        }

        if (row.revoked_at || row.replaced_by_id) {
          await client.query(
            `UPDATE app.refresh_tokens SET revoked_at = now()
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [row.user_id],
          );
          await client.query(
            `INSERT INTO app.auth_audit (user_id, event, ip_hash, user_agent, metadata)
             VALUES ($1, 'refresh_reuse', $2, $3, '{}'::jsonb)`,
            [row.user_id, ipHash ?? null, userAgent ?? null],
          );
          await client.query('COMMIT');
          clearRefreshCookie(res, config);
          return res
            .status(401)
            .json({ error: { code: 'unauthorized', message: 'Session expired' } });
        }

        if (new Date(row.expires_at) < new Date()) {
          await client.query('ROLLBACK');
          clearRefreshCookie(res, config);
          return res
            .status(401)
            .json({ error: { code: 'unauthorized', message: 'Session expired' } });
        }

        const user = { id: row.user_id, email: row.email, role: row.role };
        const tokens = await issueSession(client, config, user, { userAgent, ipHash });

        await client.query(
          `UPDATE app.refresh_tokens SET revoked_at = now(), replaced_by_id = $2, last_used_at = now()
           WHERE id = $1`,
          [row.id, tokens.refreshTokenId],
        );

        await client.query(
          `INSERT INTO app.auth_audit (user_id, event, ip_hash, user_agent, metadata)
           VALUES ($1, 'refresh', $2, $3, '{}'::jsonb)`,
          [row.user_id, ipHash ?? null, userAgent ?? null],
        );

        await client.query('COMMIT');

        setRefreshCookie(res, config, tokens.refreshToken);
        return res.json({ accessToken: tokens.accessToken });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      return next(error);
    }
  });

  router.post('/logout', async (req: AuthRequest, res, next) => {
    try {
      const token = readRefreshCookie(req);
      if (token) {
        const tokenHash = hashToken(token);
        await pool.query(
          `UPDATE app.refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
          [tokenHash],
        );
      }

      if (req.user) {
        const ipHash = ipToHash(req.ip);
        const userAgent = req.get('user-agent') ?? undefined;
        await pool.query(
          `INSERT INTO app.auth_audit (user_id, event, ip_hash, user_agent, metadata)
           VALUES ($1, 'logout', $2, $3, '{}'::jsonb)`,
          [req.user.id, ipHash ?? null, userAgent ?? null],
        );
      }

      clearRefreshCookie(res, config);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', authenticate(config, logger), async (req: AuthRequest, res, next) => {
    try {
      if (!req.user) {
        return res
          .status(401)
          .json({ error: { code: 'unauthorized', message: 'Authentication required' } });
      }

      const result = await pool.query(
        `SELECT id, email, role, is_active, first_name, last_name FROM app.users WHERE id = $1`,
        [req.user.id],
      );

      const user = result.rows[0];

      if (!user) {
        return res.status(401).json({ error: { code: 'unauthorized', message: 'User not found' } });
      }

      return res.json({ user });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/users', authenticate(config, logger), async (req: AuthRequest, res, next) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res
          .status(403)
          .json({ error: { code: 'forbidden', message: 'Insufficient permissions' } });
      }

      const result = await pool.query(
        `SELECT id, email, role, is_active, first_name, last_name, created_at, last_login_at
         FROM app.users
         ORDER BY created_at ASC`,
      );

      return res.json({ users: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.patch(
    '/users/:id/role',
    authenticate(config, logger),
    async (req: AuthRequest, res, next) => {
      try {
        if (!req.user || req.user.role !== 'admin') {
          return res
            .status(403)
            .json({ error: { code: 'forbidden', message: 'Insufficient permissions' } });
        }

        const schema = z.object({ role: z.enum(['admin', 'analyst', 'viewer']) });
        const parsed = schema.safeParse(req.body);

        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: { code: 'invalid_request', message: 'Invalid role' } });
        }

        const result = await pool.query(
          `UPDATE app.users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, email, role, is_active`,
          [parsed.data.role, req.params.id],
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ error: { code: 'not_found', message: 'User not found' } });
        }

        const ipHash = ipToHash(req.ip);
        const userAgent = req.get('user-agent') ?? undefined;
        await pool.query(
          `INSERT INTO app.auth_audit (user_id, event, ip_hash, user_agent, metadata)
         VALUES ($1, 'role_change', $2, $3, $4::jsonb)`,
          [
            req.user.id,
            ipHash ?? null,
            userAgent ?? null,
            JSON.stringify({ target: req.params.id, role: parsed.data.role }),
          ],
        );

        return res.json({ user: result.rows[0] });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get('/groups', authenticate(config, logger), async (req: AuthRequest, res, next) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res
          .status(403)
          .json({ error: { code: 'forbidden', message: 'Insufficient permissions' } });
      }

      const result = await pool.query(
        `SELECT id, name, description, created_at FROM app.groups ORDER BY name ASC`,
      );
      return res.json({ groups: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
