import 'dotenv/config';

import { hashPassword } from '../src/auth/password';
import { loadConfig } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { createPool } from '../src/db';

interface DemoUser {
  email: string;
  password: string;
  role: 'admin' | 'analyst' | 'viewer';
  firstName: string;
  lastName: string;
  groups: string[];
}

const GROUPS: Array<{ name: string; description: string }> = [
  { name: 'finance', description: 'Finance and revenue reporting' },
  { name: 'people', description: 'People operations and HR' },
  { name: 'engineering', description: 'Engineering and product' },
];

function demoUsers(): DemoUser[] {
  const env = process.env;

  return [
    {
      email: env.SEED_ADMIN_EMAIL ?? 'admin@verity.dev',
      password: env.SEED_ADMIN_PASSWORD ?? 'verity-admin-dev',
      role: 'admin',
      firstName: 'Ada',
      lastName: 'Admin',
      groups: ['finance', 'people', 'engineering'],
    },
    {
      email: env.SEED_ANALYST_EMAIL ?? 'analyst@verity.dev',
      password: env.SEED_ANALYST_PASSWORD ?? 'verity-analyst-dev',
      role: 'analyst',
      firstName: 'Anu',
      lastName: 'Analyst',
      groups: ['finance'],
    },
    {
      email: env.SEED_VIEWER_EMAIL ?? 'viewer@verity.dev',
      password: env.SEED_VIEWER_PASSWORD ?? 'verity-viewer-dev',
      role: 'viewer',
      firstName: 'Vic',
      lastName: 'Viewer',
      groups: ['people'],
    },
  ];
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  if (config.isProduction) {
    throw new Error('Refusing to seed demo users in production');
  }

  const pool = createPool(config, logger);

  try {
    const groupIds = new Map<string, string>();

    for (const group of GROUPS) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO app.groups (name, description)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, updated_at = now()
         RETURNING id`,
        [group.name, group.description],
      );

      const row = result.rows[0];
      if (row) {
        groupIds.set(group.name, row.id);
      }
    }

    for (const user of demoUsers()) {
      const passwordHash = await hashPassword(user.password);

      const result = await pool.query<{ id: string; email: string }>(
        `INSERT INTO app.users (email, password_hash, first_name, last_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               role = EXCLUDED.role,
               is_active = true,
               updated_at = now()
         RETURNING id, email`,
        [user.email, passwordHash, user.firstName, user.lastName, user.role],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error(`Failed to seed user ${user.email}`);
      }

      for (const groupName of user.groups) {
        const groupId = groupIds.get(groupName);
        if (!groupId) {
          throw new Error(`Unknown seed group ${groupName}`);
        }

        await pool.query(
          `INSERT INTO app.user_groups (user_id, group_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, group_id) DO NOTHING`,
          [row.id, groupId],
        );
      }

      logger.info({ email: row.email, role: user.role, groups: user.groups }, 'seeded demo user');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The logger may not exist yet if configuration failed.
  console.error(error);
  process.exit(1);
});
