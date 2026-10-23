import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { AuthUser } from '../types/auth';
import { DocumentService, type DocumentRow } from './documents';
import type { StorageService } from './storage';

type Query = { text: string; values: unknown[] };

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    owner_id: '22222222-2222-2222-2222-222222222222',
    title: 'Employee handbook',
    filename: 'handbook.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    storage_key: 'documents/handbook.pdf',
    access_level: 'internal',
    status: 'ready',
    error: null,
    error_code: null,
    page_count: 1,
    chunk_count: 4,
    groups: [],
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function createService(rows: DocumentRow[]) {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes('COUNT(*)')) {
        return { rows: [{ total: rows.length }], rowCount: 1 };
      }
      return { rows, rowCount: rows.length };
    },
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined,
    }),
    end: async () => undefined,
  } as unknown as Pool;

  const storage = {
    getPresignedDownloadUrl: async () => 'http://minio/download',
    delete: async () => undefined,
  } as unknown as StorageService;

  const service = new DocumentService(
    pool,
    storage,
    { deleteDocument: async () => undefined },
    null,
  );

  return { service, queries };
}

function user(role: AuthUser['role'], groupIds: string[] = []): AuthUser {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    email: `${role}@verity.dev`,
    role,
    isActive: true,
    groupIds,
  };
}

describe('document access control', () => {
  it('limits viewers to public and granted restricted documents', async () => {
    const { service, queries } = createService([]);

    await service.list(user('viewer'), {});

    const pageQuery = queries.find((query) => query.text.includes('LIMIT'));
    expect(pageQuery).toBeDefined();
    expect(pageQuery!.text).toContain("d.access_level = 'public'");
    expect(pageQuery!.text).not.toContain("'internal'");
    expect(pageQuery!.text).toContain("d.access_level = 'restricted'");
  });

  it('lets analysts see internal documents', async () => {
    const { service, queries } = createService([]);

    await service.list(user('analyst'), {});

    const pageQuery = queries.find((query) => query.text.includes('LIMIT'));
    expect(pageQuery).toBeDefined();
    expect(pageQuery!.text).toContain("d.access_level IN ('public', 'internal')");
  });

  it('hides internal documents from viewers during detail lookup', async () => {
    const row = documentRow({ access_level: 'internal' });
    const { service } = createService([row]);

    await expect(service.getById(row.id, user('viewer'))).resolves.toBeNull();
    await expect(service.getById(row.id, user('analyst'))).resolves.toMatchObject({ id: row.id });
    await expect(service.getById(row.id, user('admin'))).resolves.toMatchObject({ id: row.id });
  });

  it('allows restricted documents only to matching groups', async () => {
    const row = documentRow({
      access_level: 'restricted',
      groups: [{ id: 'group-finance', name: 'finance' }],
    });
    const { service } = createService([row]);

    await expect(service.getById(row.id, user('viewer', []))).resolves.toBeNull();
    await expect(
      service.getById(row.id, user('viewer', ['group-finance'])),
    ).resolves.toMatchObject({ id: row.id });
    await expect(
      service.getById(row.id, user('analyst', ['group-people'])),
    ).resolves.toBeNull();
  });

  it('does not retry a document the caller cannot access', async () => {
    const row = documentRow({
      access_level: 'restricted',
      groups: [{ id: 'group-finance', name: 'finance' }],
    });
    const { service, queries } = createService([row]);

    await expect(service.retry(row.id, user('analyst', []))).resolves.toBeNull();
    expect(queries.some((query) => query.text.includes('UPDATE app.documents'))).toBe(false);
  });
});
