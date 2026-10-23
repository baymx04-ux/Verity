import { describe, expect, it } from 'vitest';

import { IngestionService, type IngestionStore, type IngestionTarget } from './ingestion';
import type { InternalAiClient } from '../ai-client/internal';
import { AiRequestError } from '../ai-client/internal';
import { createAiClientStub } from '../testing/ai-stub';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  silent: () => undefined,
  child: () => logger,
} as never;

const target: IngestionTarget = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'Employee handbook',
  filename: 'handbook.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  storage_key: 'documents/1-handbook.pdf',
  access_level: 'internal',
};

function createStore(overrides: Partial<IngestionStore> = {}) {
  const calls: string[] = [];
  const store: IngestionStore = {
    getDocument: async () => target,
    markProcessing: async () => {
      calls.push('processing');
      return 'job-1';
    },
    markReady: async () => {
      calls.push('ready');
    },
    markFailed: async (_id, code, message) => {
      calls.push(`failed:${code}:${message}`);
    },
    resetForRetry: async () => {
      calls.push('requeued');
    },
    ...overrides,
  };
  return { store, calls };
}

const storage = {
  getPresignedInternalUrl: async () => 'http://minio/documents/1-handbook.pdf?sig=abc',
};

function serviceWith(
  ai: Pick<InternalAiClient, 'ingest'>,
  store: IngestionStore,
): IngestionService {
  return new IngestionService(store, ai, storage, logger);
}

describe('ingestion pipeline', () => {
  it('moves a document from processing to ready and reports chunk counts', async () => {
    const { store, calls } = createStore();
    const ai = createAiClientStub({
      ingest: async () => ({
        document_id: target.id,
        chunks: 7,
        pages: 3,
        tokens: 900,
        embedding_model: 'gemini-embedding-001',
        embedding_dim: 768,
        status: 'indexed',
      }),
    });

    const result = await serviceWith(ai, store).run(target.id, 1);

    expect(result).toEqual({ chunks: 7, pages: 3 });
    expect(calls).toEqual(['processing', 'ready']);
  });

  it('classifies a parser rejection as parse_error', async () => {
    const { store, calls } = createStore();
    const ai = createAiClientStub({
      ingest: async () => {
        throw new AiRequestError(422, 'The PDF contains no extractable text.');
      },
    });

    await expect(serviceWith(ai, store).run(target.id, 1)).rejects.toThrow(
      'The PDF contains no extractable text.',
    );

    expect(calls[1]).toBe('failed:parse_error:The PDF contains no extractable text.');
  });

  it('surfaces signature failures as ai_unauthorized', async () => {
    const { store, calls } = createStore();
    const ai = createAiClientStub({
      ingest: async () => {
        throw new AiRequestError(401, 'Invalid internal authentication signature.');
      },
    });

    await expect(serviceWith(ai, store).run(target.id, 1)).rejects.toThrow();

    expect(calls[1]).toContain('failed:ai_unauthorized:');
  });

  it('marks a missing document instead of silently succeeding', async () => {
    const { store, calls } = createStore({ getDocument: async () => null });
    const ai = createAiClientStub();

    await expect(serviceWith(ai, store).run('missing', 1)).rejects.toThrow(
      'The document no longer exists.',
    );

    expect(calls).toEqual([]);
  });

  it('re-queues a document for the next attempt', async () => {
    const { store, calls } = createStore();

    await serviceWith(createAiClientStub(), store).resetForRetry(target.id, 2);

    expect(calls).toEqual(['requeued']);
  });
});
