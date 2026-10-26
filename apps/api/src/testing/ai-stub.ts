import type { InternalAiClient } from '../ai-client/internal';

/**
 * Minimal stand-in for the internal AI client in unit tests. Individual tests
 * override the methods they exercise.
 */
export function createAiClientStub(overrides: Partial<InternalAiClient> = {}): InternalAiClient {
  const stub = {
    ingest: async () => ({
      document_id: '00000000-0000-0000-0000-000000000000',
      chunks: 3,
      pages: 1,
      tokens: 120,
      embedding_model: 'test-model',
      embedding_dim: 768,
      status: 'indexed' as const,
    }),
    deleteDocument: async () => undefined,
    chatStream: async () =>
      new Response(
        'event: route\ndata: {"route":"documents"}\n\nevent: token\ndata: {"text":"Stub answer"}\n\nevent: sources\ndata: {"citations":[]}\n\nevent: done\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":5},"latency_ms":100}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    ...overrides,
  };

  return stub as unknown as InternalAiClient;
}
