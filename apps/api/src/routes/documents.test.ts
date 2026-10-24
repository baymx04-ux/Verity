import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import type { Role } from '../auth/types';
import { signAccessToken } from '../auth/jwt';
import type { DocumentRow, DocumentService } from '../services/documents';
import { testConfig } from '../testing/fixtures';
import { createDocumentRouter } from './documents';

const config = testConfig({ UPLOAD_MAX_MB: 1 });
const logger = pino({ level: 'silent' });

const uploadRow: DocumentRow = {
  id: '11111111-1111-1111-1111-111111111111',
  owner_id: '22222222-2222-2222-2222-222222222222',
  title: 'Policy',
  filename: 'policy.pdf',
  mime_type: 'application/pdf',
  size_bytes: 16,
  storage_key: 'documents/policy.pdf',
  access_level: 'internal',
  status: 'queued',
  error: null,
  error_code: null,
  page_count: 0,
  chunk_count: 0,
  created_at: '2026-10-24T00:00:00.000Z',
  updated_at: '2026-10-24T00:00:00.000Z',
};

function appWith() {
  const create = vi.fn(async () => uploadRow);
  const documentService = { create } as unknown as DocumentService;

  const app = express();
  app.use('/api/documents', createDocumentRouter({ documentService, config, logger }));

  return { app, create };
}

function auth(role: Role, id = '33333333-3333-3333-3333-333333333333'): string {
  const token = signAccessToken(config, { id, email: `${role}@verity.dev`, role }, `jti-${role}`);
  return `Bearer ${token}`;
}

describe('document upload validation', () => {
  it('rejects files with an unsupported extension', async () => {
    const { app, create } = appWith();

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('admin'))
      .attach('file', Buffer.from('payload'), {
        filename: 'archive.exe',
        contentType: 'application/octet-stream',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_file');
    expect(response.body.error.message).toContain('Unsupported file type');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a declared type that does not match the extension', async () => {
    const { app, create } = appWith();

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('admin'))
      .attach('file', Buffer.from('payload'), {
        filename: 'policy.pdf',
        contentType: 'application/zip',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_file');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects files larger than the configured limit', async () => {
    const { app, create } = appWith();

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('admin'))
      .attach('file', Buffer.alloc(1024 * 1024 + 1), {
        filename: 'large.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('file_too_large');
    expect(response.body.error.message).toContain('1 MB');
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a file', async () => {
    const { app } = appWith();

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('admin'))
      .field('access_level', 'internal');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('no_file');
  });

  it('accepts an admin upload and stores access grants', async () => {
    const { app, create } = appWith();
    const groupId = '44444444-4444-4444-4444-444444444444';

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('admin'))
      .field('title', 'Security policy')
      .field('access_level', 'restricted')
      .field('group_ids', groupId)
      .attach('file', Buffer.from('policy body'), {
        filename: 'policy.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(201);
    expect(response.body.document.id).toBe(uploadRow.id);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Security policy',
        filename: 'policy.pdf',
        mimeType: 'application/pdf',
        accessLevel: 'restricted',
        groupIds: [groupId],
      }),
    );
  });

  it('forces analyst uploads to internal visibility', async () => {
    const { app, create } = appWith();

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('analyst'))
      .field('access_level', 'restricted')
      .attach('file', Buffer.from('policy body'), {
        filename: 'policy.md',
        contentType: 'text/markdown',
      });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ accessLevel: 'internal' }));
  });

  it('blocks viewers from uploading', async () => {
    const { app, create } = appWith();

    const response = await request(app)
      .post('/api/documents')
      .set('Authorization', auth('viewer'))
      .attach('file', Buffer.from('policy body'), {
        filename: 'policy.md',
        contentType: 'text/markdown',
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
    expect(create).not.toHaveBeenCalled();
  });
});
