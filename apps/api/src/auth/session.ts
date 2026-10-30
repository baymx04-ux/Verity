import type { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import { generateToken, hashToken } from './password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt';
import { cryptoRandom } from './crypto';
import type { Role } from './types';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
}

type SessionDb = { query: Pool['query'] };

export async function issueSession(
  db: SessionDb,
  config: AppConfig,
  user: { id: string; email: string; role: Role },
  meta: { userAgent?: string | undefined; ipHash?: string | undefined },
): Promise<SessionTokens> {
  const refreshId = generateToken();
  const refreshToken = signRefreshToken(config, user.id, refreshId);
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.REFRESH_TOKEN_TTL_DAYS);

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO app.refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [user.id, tokenHash, expiresAt.toISOString(), meta.userAgent ?? null, meta.ipHash ?? null],
  );

  const accessToken = signAccessToken(config, user, cryptoRandom());
  const refreshRow = inserted.rows[0];

  if (!refreshRow) {
    throw new Error('failed to persist refresh token');
  }

  return { accessToken, refreshToken, refreshTokenId: refreshRow.id };
}

export interface ValidatedSession {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    role: Role;
  };
}

export async function validateSession(
  db: SessionDb,
  config: AppConfig,
  token: string | undefined,
): Promise<ValidatedSession> {
  if (!token) {
    return { valid: false };
  }

  try {
    verifyRefreshToken(config, token);
  } catch {
    return { valid: false };
  }

  const tokenHash = hashToken(token);

  try {
    const result = await db.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      replaced_by_id: string | null;
      email: string;
      role: Role;
      is_active: boolean;
    }>(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, rt.replaced_by_id, u.email, u.role, u.is_active
       FROM app.refresh_tokens rt
       JOIN app.users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );

    const row = result.rows[0];

    if (!row || !row.is_active || row.revoked_at || row.replaced_by_id) {
      return { valid: false };
    }

    if (new Date(row.expires_at) < new Date()) {
      return { valid: false };
    }

    return {
      valid: true,
      user: {
        id: row.user_id,
        email: row.email,
        role: row.role,
      },
    };
  } catch {
    return { valid: false };
  }
}
