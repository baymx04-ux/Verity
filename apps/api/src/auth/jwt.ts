import jwt from 'jsonwebtoken';

import type { AppConfig } from '../config/env';
import type { Role } from './types';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  type: 'access';
  jti: string;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
}

type ExpiresIn = NonNullable<jwt.SignOptions['expiresIn']>;

export function signAccessToken(
  config: AppConfig,
  user: { id: string; email: string; role: Role },
  jti: string,
): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
      jti,
    } satisfies AccessTokenPayload,
    config.JWT_ACCESS_SECRET,
    {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      expiresIn: config.ACCESS_TOKEN_TTL as ExpiresIn,
    },
  );
}

export function signRefreshToken(config: AppConfig, userId: string, jti: string): string {
  return jwt.sign(
    {
      sub: userId,
      jti,
      type: 'refresh',
    } satisfies RefreshTokenClaims,
    config.JWT_REFRESH_SECRET,
    {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      expiresIn: `${config.REFRESH_TOKEN_TTL_DAYS}d`,
    },
  );
}

export function verifyAccessToken(config: AppConfig, token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    (decoded as AccessTokenPayload).type !== 'access'
  ) {
    throw new Error('invalid token');
  }

  return decoded as AccessTokenPayload;
}

export function verifyRefreshToken(config: AppConfig, token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    (decoded as RefreshTokenClaims).type !== 'refresh'
  ) {
    throw new Error('invalid token');
  }

  return decoded as RefreshTokenClaims;
}
