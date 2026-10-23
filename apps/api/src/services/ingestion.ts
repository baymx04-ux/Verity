import type { Logger } from '../config/logger';
import type { InternalAiClient } from '../ai-client/internal';
import type { StorageService } from './storage';

/** Columns the ingestion pipeline is allowed to write. */
export interface IngestionTarget {
  id: string;
  title: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  storage_key: string;
  access_level: string;
}

export interface IngestionStore {
  getDocument(id: string): Promise<IngestionTarget | null>;
  markProcessing(id: string, attempt: number): Promise<string>;
  markReady(id: string, result: { chunks: number; pages: number }): Promise<void>;
  markFailed(id: string, errorCode: string, message: string): Promise<void>;
  resetForRetry(id: string, attempt: number): Promise<void>;
}

export interface IngestionSummary {
  chunks: number;
  pages: number;
}

export class IngestionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

/**
 * Implements the Phase 2 pipeline: `processing` -> AI `/ingest` -> `ready`.
 * The worker never parses or embeds anything itself; that belongs to the AI
 * service. It owns status transitions and the sanitized failure message.
 */
export class IngestionService {
  constructor(
    private readonly store: IngestionStore,
    private readonly ai: Pick<InternalAiClient, 'ingest'>,
    private readonly storage: Pick<StorageService, 'getPresignedInternalUrl'>,
    private readonly logger: Logger,
  ) {}

  async run(documentId: string, attempt: number): Promise<IngestionSummary> {
    const target = await this.store.getDocument(documentId);
    if (!target) {
      throw new IngestionError('document_missing', 'The document no longer exists.');
    }

    const jobId = await this.store.markProcessing(documentId, attempt);
    const startedAt = Date.now();

    try {
      const storageUrl = await this.storage.getPresignedInternalUrl(target.storage_key);
      const result = await this.ai.ingest({
        document_id: documentId,
        storage_url: storageUrl,
        filename: target.filename,
        mime_type: target.mime_type,
        title: target.title,
        access_level: target.access_level,
        size_bytes: target.size_bytes,
      });

      await this.store.markReady(documentId, {
        chunks: result.chunks,
        pages: result.pages,
      });

      this.logger.info(
        { documentId, jobId, chunks: result.chunks, durationMs: Date.now() - startedAt },
        'document ingestion succeeded',
      );

      return { chunks: result.chunks, pages: result.pages };
    } catch (error) {
      const { code, message } = classify(error);
      await this.store.markFailed(documentId, code, message);
      this.logger.warn(
        { documentId, jobId, code, durationMs: Date.now() - startedAt },
        'document ingestion failed',
      );
      throw new IngestionError(code, message);
    }
  }

  /** Called by the queue when a retry is scheduled, so the UI can keep polling. */
  resetForRetry(documentId: string, attempt: number): Promise<void> {
    return this.store.resetForRetry(documentId, attempt);
  }
}

function classify(error: unknown): { code: string; message: string } {
  if (error instanceof IngestionError) {
    return { code: error.code, message: error.message.slice(0, 500) };
  }

  const candidate = error as { name?: string; status?: number } | undefined;

  if (candidate?.name === 'AiRequestError') {
    if (candidate.status === 504 || candidate.status === 408) {
      return { code: 'parse_timeout', message: errorMessage(error) };
    }
    if (candidate.status === 422) {
      return { code: 'parse_error', message: errorMessage(error) };
    }
    if (candidate.status === 401 || candidate.status === 403 || candidate.status === 503) {
      return {
        code: 'ai_unauthorized',
        message:
          'The indexing service rejected the internal request. Check INTERNAL_SERVICE_TOKEN.',
      };
    }
    if (candidate.status && candidate.status >= 500) {
      return { code: 'embedding_error', message: errorMessage(error) };
    }
  }

  return { code: 'ingest_failed', message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  return 'Ingestion failed unexpectedly.';
}
