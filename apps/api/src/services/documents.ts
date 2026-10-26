import type { Pool } from 'pg';
import type { Queue } from 'bullmq';

import type { StorageService } from './storage';
import type { AuthUser } from '../types/auth';
import type { InternalAiClient } from '../ai-client/internal';
import type { IngestionJobData } from '../queue/ingestion';
import { createIngestionJobId } from '../queue/ingestion';

export type AccessLevel = 'public' | 'internal' | 'restricted';
export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface DocumentRow {
  id: string;
  owner_id: string;
  title: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  access_level: AccessLevel;
  status: DocumentStatus;
  error: string | null;
  error_code: string | null;
  page_count: number;
  chunk_count: number;
  groups?: { id: string; name: string }[];
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentInput {
  ownerId: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  accessLevel: AccessLevel;
  groupIds?: string[];
}

export class DocumentService {
  constructor(
    private pool: Pool,
    private storage: StorageService,
    private ai: Pick<InternalAiClient, 'deleteDocument'>,
    private queue: Queue<IngestionJobData> | null,
  ) {}

  async create(input: CreateDocumentInput): Promise<DocumentRow> {
    const storageKey = this.storage.buildStorageKey(input.filename);
    const client = await this.pool.connect();

    let doc: DocumentRow;

    try {
      await client.query('BEGIN');

      const insertResult = await client.query<DocumentRow>(
        `INSERT INTO app.documents
          (owner_id, title, filename, mime_type, size_bytes, storage_key, access_level, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
         RETURNING *`,
        [
          input.ownerId,
          input.title,
          input.filename,
          input.mimeType,
          input.sizeBytes,
          storageKey,
          input.accessLevel,
        ],
      );

      doc = insertResult.rows[0]!;

      if (input.accessLevel === 'restricted' && input.groupIds?.length) {
        for (const groupId of input.groupIds) {
          await client.query(
            `INSERT INTO app.document_groups (document_id, group_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [doc.id, groupId],
          );
        }
      }

      // Object goes to MinIO before the transaction commits so a failed upload
      // never leaves a row pointing at a missing file.
      await this.storage.upload(storageKey, input.buffer, input.mimeType);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await this.enqueue(doc.id, input, storageKey);

    return doc;
  }

  /** Re-queue a document after a failure or when the operator asks for a retry. */
  async retry(id: string, user: AuthUser): Promise<DocumentRow | null> {
    const doc = await this.getById(id, user);
    if (!doc) {
      return null;
    }

    await this.pool.query(
      `UPDATE app.documents
          SET status = 'queued', error = NULL, error_code = NULL, updated_at = now()
        WHERE id = $1`,
      [id],
    );

    await this.enqueue(
      doc.id,
      {
        title: doc.title,
        filename: doc.filename,
        mimeType: doc.mime_type,
        sizeBytes: doc.size_bytes,
        accessLevel: doc.access_level,
      },
      doc.storage_key,
      true,
    );

    const updated = await this.pool.query<DocumentRow>(
      `SELECT * FROM app.documents WHERE id = $1`,
      [id],
    );
    return updated.rows[0] ?? null;
  }

  private async enqueue(
    documentId: string,
    meta: {
      title: string;
      filename: string;
      mimeType: string | null;
      sizeBytes: number;
      accessLevel: string;
    },
    storageKey: string,
    isRetry = false,
  ): Promise<void> {
    if (!this.queue) {
      await this.pool.query(
        `UPDATE app.documents
            SET status = 'failed',
                error_code = 'queue_unavailable',
                error = 'The ingestion queue is unavailable, so this document was not indexed.',
                updated_at = now()
          WHERE id = $1`,
        [documentId],
      );
      return;
    }

    try {
      await this.queue.add(
        'ingest',
        {
          documentId,
          storageKey,
          filename: meta.filename,
          mimeType: meta.mimeType,
          title: meta.title,
          accessLevel: meta.accessLevel,
          sizeBytes: meta.sizeBytes,
          attempt: isRetry ? 1 : 0,
        },
        { jobId: createIngestionJobId(documentId, isRetry ? 1 : 0) },
      );
    } catch {
      await this.pool.query(
        `UPDATE app.documents
            SET status = 'failed',
                error_code = 'queue_unavailable',
                error = 'The ingestion queue is unavailable, so this document was not indexed.',
                updated_at = now()
          WHERE id = $1`,
        [documentId],
      );
    }
  }

  async list(
    user: AuthUser,
    options: {
      status?: string;
      accessLevel?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ documents: DocumentRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (user.role !== 'admin') {
      const allowedLevels =
        user.role === 'analyst'
          ? `d.access_level IN ('public', 'internal')`
          : `d.access_level = 'public'`;
      conditions.push(`(
        ${allowedLevels}
        OR (
          d.access_level = 'restricted' AND EXISTS (
            SELECT 1 FROM app.document_groups dg
            INNER JOIN app.user_groups ug ON ug.group_id = dg.group_id
            WHERE dg.document_id = d.id AND ug.user_id = $${paramIndex}
          )
        )
      )`);
      values.push(user.id);
      paramIndex++;
    }

    if (options.status) {
      conditions.push(`d.status = $${paramIndex}`);
      values.push(options.status);
      paramIndex++;
    }

    if (options.accessLevel) {
      conditions.push(`d.access_level = $${paramIndex}`);
      values.push(options.accessLevel);
      paramIndex++;
    }

    if (options.search) {
      conditions.push(`(d.title ILIKE $${paramIndex} OR d.filename ILIKE $${paramIndex})`);
      values.push(`%${options.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM app.documents d ${whereClause}`,
      values,
    );

    const pageValues = [...values, limit, offset];
    const result = await this.pool.query<DocumentRow>(
      `SELECT d.*, ${GROUP_AGGREGATE}
       FROM app.documents d
       LEFT JOIN app.document_groups dg ON dg.document_id = d.id
       LEFT JOIN app.groups g ON g.id = dg.group_id
       ${whereClause}
       GROUP BY d.id
       ORDER BY d.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      pageValues,
    );

    return {
      documents: result.rows,
      total: countResult.rows[0]?.total ?? 0,
      page,
      limit,
    };
  }

  async getById(id: string, user: AuthUser): Promise<DocumentRow | null> {
    const result = await this.pool.query<DocumentRow>(
      `SELECT d.*, ${GROUP_AGGREGATE}
       FROM app.documents d
       LEFT JOIN app.document_groups dg ON dg.document_id = d.id
       LEFT JOIN app.groups g ON g.id = dg.group_id
       WHERE d.id = $1
       GROUP BY d.id`,
      [id],
    );

    const doc = result.rows[0];
    if (!doc) {
      return null;
    }

    return this.canAccess(doc, user) ? doc : null;
  }

  async getDownloadUrl(id: string, user: AuthUser): Promise<string | null> {
    const doc = await this.getById(id, user);
    if (!doc) {
      return null;
    }
    return this.storage.getPresignedDownloadUrl(doc.storage_key, doc.filename);
  }

  async update(
    id: string,
    updates: { title?: string; access_level?: AccessLevel; group_ids?: string[] },
  ): Promise<DocumentRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = ['updated_at = now()'];
      const values: unknown[] = [id];
      let paramIndex = 2;

      if (updates.title) {
        setClauses.push(`title = $${paramIndex}`);
        values.push(updates.title);
        paramIndex++;
      }

      if (updates.access_level) {
        setClauses.push(`access_level = $${paramIndex}`);
        values.push(updates.access_level);
        paramIndex++;
      }

      const updateRes = await client.query<DocumentRow>(
        `UPDATE app.documents SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        values,
      );

      if (updateRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Groups only matter for restricted documents; clearing them on any
      // access-level change avoids stale grants that would leak later.
      if (updates.access_level || updates.group_ids) {
        await client.query(`DELETE FROM app.document_groups WHERE document_id = $1`, [id]);

        const targetLevel = updates.access_level ?? updateRes.rows[0]!.access_level;
        if (targetLevel === 'restricted' && updates.group_ids?.length) {
          for (const groupId of updates.group_ids) {
            await client.query(
              `INSERT INTO app.document_groups (document_id, group_id) VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [id, groupId],
            );
          }
        }
      }

      await client.query('COMMIT');

      return this.getById(id, { id: '', email: '', role: 'admin', isActive: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM app.documents WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) {
      return false;
    }

    // Order: heavy/remote work first, row last. A failed chunk delete is
    // retried by deleting the row (chunks cascade) so nothing stays orphaned.
    await this.storage.delete(row.storage_key).catch(() => undefined);
    await this.ai.deleteDocument(id).catch(() => undefined);

    await this.pool.query(`DELETE FROM app.documents WHERE id = $1`, [id]);
    return true;
  }

  private canAccess(doc: DocumentRow, user: AuthUser): boolean {
    if (user.role === 'admin') {
      return true;
    }
    if (doc.access_level === 'public') {
      return true;
    }
    if (doc.access_level === 'internal') {
      return user.role === 'analyst';
    }
    if (doc.access_level === 'restricted') {
      const groupIds = new Set((doc.groups ?? []).map((group) => group.id));
      if (groupIds.size === 0) {
        return false;
      }
      const membership = user.groupIds ?? [];
      return membership.some((id) => groupIds.has(id));
    }
    return false;
  }
}

const GROUP_AGGREGATE = `COALESCE(
  json_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name))
    FILTER (WHERE g.id IS NOT NULL),
  '[]'::json
) AS groups`;
