import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import type { AppConfig } from './config/env';
import type { HealthChecker } from './services/health';

const PASSWORD = 'password123';
// bcrypt hash of "password123" (cost 12)
const PASSWORD_HASH = '$2b$12$JwVPKrTJn7pgsR5NY5SUfed392zTdbw/5yoekLhYVtBwMnoH.1YiS';

const config: AppConfig = {
  NODE_ENV: 'test',
  API_PORT: 4000,
  WEB_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: 5432,
  POSTGRES_DB: 'verity',
  VERITY_APP_USER: 'verity_app',
  VERITY_APP_PASSWORD: 'test-password',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: 9000,
  MINIO_USE_SSL: false,
  MINIO_BUCKET: 'verity-docs',
  AI_SERVICE_URL: 'http://localhost:8000',
  UPLOAD_MAX_MB: 25,
  JWT_ACCESS_SECRET: 'test-access-secret-32-characters-long!!',
  JWT_REFRESH_SECRET: 'test-refresh-secret-32-characters-loong!!',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: 7,
  JWT_ISSUER: 'verity',
  JWT_AUDIENCE: 'verity-api',
  COOKIE_SECURE: false,
  COOKIE_SAME_SITE: 'lax',
  AUTH_RATE_LIMIT_PER_MIN: 100,
  databaseUrl: 'postgresql://verity_app:test-password@localhost:5432/verity',
  minioUrl: 'http://localhost:9000',
  isProduction: false,
};

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

interface GroupRow {
  id: string;
  name: string;
  description: string;
  created_at: Date;
}

interface FakeDb {
  pool: Pool;
  users: UserRow[];
  refreshTokens: RefreshRow[];
  groups: GroupRow[];
  audit: Array<{ user_id: string; event: string }>;
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
  const audit: Array<{ user_id: string; event: string }> = [];
  const groups: GroupRow[] = [
    { id: 'group-finance', name: 'finance', description: 'Finance', created_at: new Date() },
  ];
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
      const event =
        query.match(/'(login|logout|refresh_reuse|refresh|role_change)'/)?.[1] ?? 'unknown';
      audit.push({ user_id: String(params[0]), event });
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

    if (query.startsWith('UPDATE app.refresh_tokens SET revoked_at = now() WHERE user_id')) {
      let count = 0;
      for (const token of refreshTokens) {
        if (token.user_id === params[0] && token.revoked_at === null) {
          token.revoked_at = new Date();
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }

    if (query.startsWith('UPDATE app.refresh_tokens SET revoked_at = now() WHERE token_hash')) {
      const token = refreshTokens.find((candidate) => candidate.token_hash === params[0]);
      if (token && token.revoked_at === null) {
        token.revoked_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (query.startsWith('UPDATE app.refresh_tokens SET revoked_at = now(), replaced_by_id')) {
      const token = refreshTokens.find((candidate) => candidate.id === params[0]);
      if (token) {
        token.revoked_at = new Date();
        token.replaced_by_id = String(params[1]);
        token.last_used_at = new Date();
      }
      return { rows: [], rowCount: token ? 1 : 0 };
    }

    if (
      query.startsWith(
        'SELECT id, email, role, is_active, first_name, last_name FROM app.users WHERE id',
      )
    ) {
      const user = users.find((candidate) => candidate.id === params[0]);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (
      query.startsWith(
        'SELECT id, email, role, is_active, first_name, last_name, created_at, last_login_at FROM app.users',
      )
    ) {
      return {
        rows: [...users].sort((a, b) => a.created_at.getTime() - b.created_at.getTime()),
        rowCount: users.length,
      };
    }

    if (query.startsWith('UPDATE app.users SET role')) {
      const user = users.find((candidate) => candidate.id === params[1]);
      if (!user) {
        return { rows: [], rowCount: 0 };
      }
      user.role = params[0] as UserRow['role'];
      return {
        rows: [{ id: user.id, email: user.email, role: user.role, is_active: user.is_active }],
        rowCount: 1,
      };
    }

    if (query.startsWith('SELECT id, name, description, created_at FROM app.groups')) {
      return { rows: groups, rowCount: groups.length };
    }

    throw new Error(`Unhandled query in fake db: ${query}`);
  }

  const client = {
    query: async (sql: string, params?: unknown[]) => run(sql, params),
    release: () => undefined,
  };

  const pool = {
    query: async (sql: string, params?: unknown[]) => run(sql, params),
    connect: async () => client,
    end: async () => undefined,
  } as unknown as Pool;

  return { pool, users, refreshTokens, groups, audit };
}

const health: HealthChecker = {
  check: async () => ({ status: 'ok', dependencies: { postgres: 'ok', redis: 'ok', minio: 'ok' } }),
  close: async () => undefined,
};

function createTestApp(db: FakeDb) {
  return createApp({ config, logger, health, pool: db.pool });
}

function refreshCookieFrom(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const cookie = cookies.find((value) => value.startsWith('verity_refresh='));
  if (!cookie) {
    throw new Error('refresh cookie missing from response');
  }
  return cookie.split(';')[0] as string;
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { agent, response, accessToken: response.body.accessToken as string };
}

describe('auth API', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
  });

  it('rejects invalid login payloads', async () => {
    const response = await request(createTestApp(db))
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('rejects a wrong password without revealing account state', async () => {
    const response = await request(createTestApp(db))
      .post('/api/auth/login')
      .send({ email: 'admin@verity.dev', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('logs in a seeded user and returns the current user', async () => {
    const { agent, response, accessToken } = await login(createTestApp(db), 'admin@verity.dev');

    expect(response.body.user).toMatchObject({
      id: 'user-admin',
      email: 'admin@verity.dev',
      role: 'admin',
    });
    expect(refreshCookieFrom(response)).toMatch(/^verity_refresh=/);

    const me = await agent.get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: 'user-admin', role: 'admin' });

    expect(db.audit.some((entry) => entry.event === 'login')).toBe(true);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const app = createTestApp(db);
    const { agent, response } = await login(app, 'analyst@verity.dev');
    const firstCookie = refreshCookieFrom(response);

    const rotated = await agent.post('/api/auth/refresh');
    expect(rotated.status).toBe(200);
    expect(rotated.body.accessToken).toEqual(expect.any(String));
    const secondCookie = refreshCookieFrom(rotated);
    expect(secondCookie).not.toBe(firstCookie);

    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', firstCookie);
    expect(reuse.status).toBe(401);
    expect(db.audit.some((entry) => entry.event === 'refresh_reuse')).toBe(true);

    const afterReuse = await request(app).post('/api/auth/refresh').set('Cookie', secondCookie);
    expect(afterReuse.status).toBe(401);
  });

  it('logs out and revokes the refresh token', async () => {
    const { agent, response, accessToken } = await login(createTestApp(db), 'viewer@verity.dev');
    const cookie = refreshCookieFrom(response);

    const logout = await agent
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(200);

    const refresh = await request(createTestApp(db))
      .post('/api/auth/refresh')
      .set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('enforces admin-only user listing and role validation', async () => {
    const app = createTestApp(db);
    const analyst = await login(app, 'analyst@verity.dev');
    const forbidden = await analyst.agent
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${analyst.accessToken}`);
    expect(forbidden.status).toBe(403);

    const admin = await login(app, 'admin@verity.dev');
    const users = await admin.agent
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(users.status).toBe(200);
    expect(users.body.users).toHaveLength(3);

    const invalid = await admin.agent
      .patch('/api/auth/users/user-analyst/role')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'owner' });
    expect(invalid.status).toBe(400);

    const patched = await admin.agent
      .patch('/api/auth/users/user-analyst/role')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'viewer' });
    expect(patched.status).toBe(200);
    expect(patched.body.user.role).toBe('viewer');
  });
});
