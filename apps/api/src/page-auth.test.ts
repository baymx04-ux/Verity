import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import type { AppConfig } from './config/env';
import type { HealthChecker } from './services/health';
import { testConfig } from './testing/fixtures';
import { createAiClientStub } from './testing/ai-stub';
import { signRefreshToken } from './auth/jwt';
import { hashToken } from './auth/password';

const PASSWORD_HASH = '$2b$12$JwVPKrTJn7pgsR5NY5SUfed392zTdbw/5yoekLhYVtBwMnoH.1YiS';

const config: AppConfig = testConfig();
const logger = pino({ level: 'silent' });

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'analyst' | 'viewer';
  is_active: boolean;
  first_name: string;
  last_name: string;
  created_at: Date;
  last_login_at: Date | null;
}

interface RefreshRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

interface FakeDb {
  pool: Pool;
  users: UserRow[];
  refreshTokens: RefreshRow[];
}

function normalise(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function makeUser(overrides: Partial<UserRow> & Pick<UserRow, 'id' | 'email' | 'role'>): UserRow {
  return {
    password_hash: PASSWORD_HASH,
    is_active: true,
    first_name: 'Test',
    last_name: 'User',
    created_at: new Date('2025-01-01T00:00:00Z'),
    last_login_at: null,
    ...overrides,
  };
}

function createFakeDb(): FakeDb {
  const users: UserRow[] = [
    makeUser({ id: 'user-admin', email: 'admin@verity.dev', role: 'admin' }),
    makeUser({ id: 'user-analyst', email: 'analyst@verity.dev', role: 'analyst' }),
    makeUser({ id: 'user-viewer', email: 'viewer@verity.dev', role: 'viewer' }),
  ];
  const refreshTokens: RefreshRow[] = [];
  let sequence = 0;

  function run(sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
    const query = normalise(sql);

    if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    if (query.startsWith('SELECT id, email, password_hash, role, is_active FROM app.users')) {
      const email = String(params[0] ?? '').toLowerCase();
      return { rows: users.filter((user) => user.email.toLowerCase() === email), rowCount: 1 };
    }

    if (query.startsWith('INSERT INTO app.refresh_tokens')) {
      const row: RefreshRow = {
        id: `token-${++sequence}`,
        user_id: String(params[0]),
        token_hash: String(params[1]),
        expires_at: new Date(String(params[2])),
        revoked_at: null,
        replaced_by_id: null,
        created_at: new Date(),
        last_used_at: null,
      };
      refreshTokens.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }

    if (query.startsWith('UPDATE app.users SET last_login_at')) {
      const user = users.find((candidate) => candidate.id === params[0]);
      if (user) {
        user.last_login_at = new Date();
      }
      return { rows: [], rowCount: user ? 1 : 0 };
    }

    if (query.startsWith('INSERT INTO app.auth_audit')) {
      return { rows: [], rowCount: 1 };
    }

    if (query.startsWith('SELECT rt.id, rt.user_id')) {
      const token = refreshTokens.find((candidate) => candidate.token_hash === params[0]);
      if (!token) {
        return { rows: [], rowCount: 0 };
      }

      const user = users.find((candidate) => candidate.id === token.user_id);
      if (!user) {
        return { rows: [], rowCount: 0 };
      }

      return {
        rows: [
          {
            id: token.id,
            user_id: token.user_id,
            expires_at: token.expires_at,
            revoked_at: token.revoked_at,
            replaced_by_id: token.replaced_by_id,
            email: user.email,
            role: user.role,
            is_active: user.is_active,
          },
        ],
        rowCount: 1,
      };
    }

    if (query.startsWith('SELECT group_id FROM app.user_groups')) {
      return { rows: [], rowCount: 0 };
    }

    return { rows: [], rowCount: 0 };
  }

  const pool = {
    query: async (sql: string, params: unknown[] = []) => run(sql, params),
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => run(sql, params),
      release: () => undefined,
    }),
    end: async () => undefined,
  } as unknown as Pool;

  return { pool, users, refreshTokens };
}

describe('Server-side access control for protected pages', () => {
  let fakeDb: FakeDb;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    fakeDb = createFakeDb();
    const health: HealthChecker = {
      check: async () => ({
        status: 'ok',
        dependencies: { postgres: 'ok', redis: 'ok', minio: 'ok' },
      }),
      close: async () => undefined,
    };
    app = createApp({
      config,
      logger,
      health,
      pool: fakeDb.pool,
      ai: createAiClientStub(),
    });
  });

  function createValidSession(userId = 'user-admin') {
    const rawToken = signRefreshToken(config, userId, 'jwt-test-id');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    fakeDb.refreshTokens.push({
      id: 'session-token-1',
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked_at: null,
      replaced_by_id: null,
      created_at: new Date(),
      last_used_at: null,
    });
    return `verity_refresh=${rawToken}`;
  }

  it('redirects unauthenticated direct requests to /chat to /login?redirect=%2Fchat', async () => {
    const res = await request(app).get('/chat');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?redirect=%2Fchat');
  });

  it('redirects unauthenticated direct requests to /documents to /login?redirect=%2Fdocuments', async () => {
    const res = await request(app).get('/documents');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?redirect=%2Fdocuments');
  });

  it('preserves query parameters when redirecting unauthenticated requests', async () => {
    const res = await request(app).get('/documents?tab=recent&sort=asc');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?redirect=%2Fdocuments%3Ftab%3Drecent%26sort%3Dasc');
  });

  it('clears cookie and redirects when session is expired', async () => {
    const rawToken = signRefreshToken(config, 'user-admin', 'expired-jti');
    const tokenHash = hashToken(rawToken);
    fakeDb.refreshTokens.push({
      id: 'token-expired',
      user_id: 'user-admin',
      token_hash: tokenHash,
      expires_at: new Date(Date.now() - 10000), // expired in past
      revoked_at: null,
      replaced_by_id: null,
      created_at: new Date(),
      last_used_at: null,
    });

    const res = await request(app).get('/chat').set('Cookie', `verity_refresh=${rawToken}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?redirect=%2Fchat');
    // Clear cookie header should be present
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    expect(cookies.some((c: string) => c.includes('verity_refresh=;'))).toBe(true);
  });

  it('clears cookie and redirects when session is revoked', async () => {
    const rawToken = signRefreshToken(config, 'user-admin', 'revoked-jti');
    const tokenHash = hashToken(rawToken);
    fakeDb.refreshTokens.push({
      id: 'token-revoked',
      user_id: 'user-admin',
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 100000),
      revoked_at: new Date(), // revoked
      replaced_by_id: null,
      created_at: new Date(),
      last_used_at: null,
    });

    const res = await request(app).get('/chat').set('Cookie', `verity_refresh=${rawToken}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?redirect=%2Fchat');
  });

  it('allows access to protected page when session cookie is valid', async () => {
    const cookie = createValidSession('user-admin');

    const res = await request(app).get('/chat').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('allows access to /admin when user has admin role', async () => {
    const cookie = createValidSession('user-admin');

    const res = await request(app).get('/admin').set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  it('blocks /admin with 403 when user is not an admin', async () => {
    const cookie = createValidSession('user-viewer');

    const res = await request(app).get('/admin').set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('keeps public page /login accessible without authentication', async () => {
    const res = await request(app).get('/login');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('redirects already authenticated user visiting /login to /chat or validated destination', async () => {
    const cookie = createValidSession('user-admin');

    const resDefault = await request(app).get('/login').set('Cookie', cookie);
    expect(resDefault.status).toBe(302);
    expect(resDefault.headers.location).toBe('/chat');

    const resTarget = await request(app).get('/login?redirect=%2Fdocuments').set('Cookie', cookie);
    expect(resTarget.status).toBe(302);
    expect(resTarget.headers.location).toBe('/documents');
  });

  it('sanitizes external and unsafe redirect query parameters on /login', async () => {
    const cookie = createValidSession('user-admin');

    const resEvil = await request(app)
      .get('/login?redirect=https://evil.com/steal')
      .set('Cookie', cookie);
    expect(resEvil.status).toBe(302);
    expect(resEvil.headers.location).toBe('/chat');

    const resProto = await request(app).get('/login?redirect=//evil.com').set('Cookie', cookie);
    expect(resProto.status).toBe(302);
    expect(resProto.headers.location).toBe('/chat');
  });

  it('prevents redirect loops when /login redirect points to /login', async () => {
    const cookie = createValidSession('user-admin');

    const resLoop = await request(app).get('/login?redirect=%2Flogin').set('Cookie', cookie);
    expect(resLoop.status).toBe(302);
    expect(resLoop.headers.location).toBe('/chat');
  });

  it('keeps public api routes accessible', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const loginFail = await request(app).post('/api/auth/login').send({});
    expect(loginFail.status).toBe(400); // validated payload, not 401 or 302
  });

  it('verifies session via GET /api/auth/verify', async () => {
    const unauth = await request(app).get('/api/auth/verify');
    expect(unauth.status).toBe(401);

    const cookie = createValidSession('user-admin');
    const auth = await request(app).get('/api/auth/verify').set('Cookie', cookie);
    expect(auth.status).toBe(200);
    expect(auth.body).toMatchObject({
      ok: true,
      user: { id: 'user-admin', email: 'admin@verity.dev', role: 'admin' },
    });
  });
});
