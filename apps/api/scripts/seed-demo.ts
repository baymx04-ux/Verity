import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { hashPassword } from '../src/auth/password';
import { loadConfig } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { createPool } from '../src/db';
import { InternalAiClient } from '../src/ai-client/internal';
import { createIngestionQueue, createRedisConnection } from '../src/queue/ingestion';
import { DocumentService, type AccessLevel } from '../src/services/documents';
import { StorageService } from '../src/services/storage';

interface DemoUser {
  email: string;
  password: string;
  role: 'admin' | 'analyst' | 'viewer';
  firstName: string;
  lastName: string;
  groups: string[];
}

interface SeedDocument {
  file: string;
  title: string;
  access: AccessLevel;
  groups: string[];
}

const GROUPS: Array<{ name: string; description: string }> = [
  { name: 'finance', description: 'Finance and revenue reporting' },
  { name: 'people', description: 'People operations and HR' },
  { name: 'engineering', description: 'Engineering and product' },
];

const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const SEED_ROOT = path.resolve(__dirname, '../../../infra/seed');

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

function isAccessLevel(value: string): value is AccessLevel {
  return value === 'public' || value === 'internal' || value === 'restricted';
}

async function readManifest(): Promise<SeedDocument[]> {
  const raw = await readFile(path.join(SEED_ROOT, 'manifest.json'), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Seed manifest must be an array');
  }

  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Seed manifest entry ${index} is invalid`);
    }
    const value = entry as Record<string, unknown>;
    const file = value.file;
    const title = value.title;
    const access = value.access;
    const groups = value.groups;

    if (
      typeof file !== 'string' ||
      typeof title !== 'string' ||
      typeof access !== 'string' ||
      !isAccessLevel(access) ||
      !Array.isArray(groups) ||
      groups.some((group) => typeof group !== 'string')
    ) {
      throw new Error(`Seed manifest entry ${index} is invalid`);
    }

    return { file, title, access, groups: groups as string[] };
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  if (config.isProduction) {
    throw new Error('Refusing to seed demo data in production');
  }

  const pool = createPool(config, logger);
  const storage = new StorageService(config);
  const ai = new InternalAiClient({
    baseUrl: config.AI_SERVICE_URL,
    token: config.INTERNAL_SERVICE_TOKEN ?? 'seed-placeholder-token',
    logger,
  });
  const redis = createRedisConnection(config);
  const queue = createIngestionQueue(config, logger, redis);
  const documents = new DocumentService(pool, storage, ai, queue);

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

    let adminId: string | null = null;

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

      if (user.role === 'admin' && !adminId) {
        adminId = row.id;
      }

      logger.info({ email: row.email, role: user.role, groups: user.groups }, 'seeded demo user');
    }

    if (process.env.SEED_DOCUMENTS === 'false') {
      logger.info('skipping demo documents (SEED_DOCUMENTS=false)');
      return;
    }
    if (!adminId) {
      throw new Error('No admin user available to own demo documents');
    }

    const existing = await pool.query<{ title: string }>('SELECT title FROM app.documents');
    const existingTitles = new Set(existing.rows.map((row) => row.title));
    const manifest = await readManifest();
    let seeded = 0;
    let skipped = 0;

    for (const entry of manifest) {
      if (existingTitles.has(entry.title)) {
        skipped += 1;
        continue;
      }

      const extension = path.extname(entry.file).toLowerCase();
      const mimeType = MIME_TYPES[extension];
      if (!mimeType) {
        throw new Error(`Unsupported seed document type: ${entry.file}`);
      }

      const filePath = path.join(SEED_ROOT, 'documents', entry.file);
      const buffer = await readFile(filePath);
      const restrictedGroupIds = entry.groups.map((name) => {
        const id = groupIds.get(name);
        if (!id) {
          throw new Error(`Unknown seed group ${name} for ${entry.title}`);
        }
        return id;
      });

      const document = await documents.create({
        ownerId: adminId,
        title: entry.title,
        filename: entry.file,
        mimeType,
        sizeBytes: buffer.byteLength,
        buffer,
        accessLevel: entry.access,
        ...(restrictedGroupIds.length > 0 ? { groupIds: restrictedGroupIds } : {}),
      });

      seeded += 1;
      logger.info(
        {
          title: document.title,
          access: document.access_level,
          groups: entry.groups,
          status: document.status,
        },
        'queued demo document',
      );
    }

    logger.info({ seeded, skipped, total: manifest.length }, 'demo document seed complete');
  } finally {
    logger.info('closing ingestion queue');
    await queue.close();
    await redis.quit();
    logger.info('closing database pool');
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The logger may not exist yet if configuration failed.
  console.error(error);
  process.exit(1);
});
