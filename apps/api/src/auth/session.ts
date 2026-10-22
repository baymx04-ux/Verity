import type { Pool } from 'pg';

import type { AppConfig } from '../config/env';
import { generateToken, hashToken } from './password';
import { signAccessToken, signRefreshToken } from './jwt';
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
