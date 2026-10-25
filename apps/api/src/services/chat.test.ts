import pino from 'pino';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { AiChatStreamPayload } from '../ai-client/internal';
import { createAiClientStub } from '../testing/ai-stub';
import type { AuthUser } from '../types/auth';
import { ChatService } from './chat';

const logger = pino({ level: 'silent' });
const userId = '33333333-3333-3333-3333-333333333333';
const conversationId = '11111111-1111-1111-1111-111111111111';
const assistantId = '22222222-2222-2222-2222-222222222222';

const user: AuthUser = {
  id: userId,
  email: 'analyst@verity.dev',
  role: 'analyst',
  isActive: true,
  groupIds: [],
};

function conversationRow() {
  return {
    id: conversationId,
    user_id: userId,
    title: 'Existing thread',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function sseResponse(text = 'Stub answer') {
  return new Response(
    `event: conversation\ndata: {"conversation_id":"${conversationId}"}\n\n` +
      'event: route\ndata: {"route":"documents"}\n\n' +
      `event: token\ndata: {"text":"${text}"}\n\n` +
      'event: sources\ndata: {"citations":[]}\n\n' +
      'event: done\ndata: {"trace_id":"trace-1","latency_ms":80,"low_confidence":false,"answer_status":"answered","cited_indices":[],"citation_count":0,"model":"fake","usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function insertAssistantId(sql: string, params: unknown[]) {
  return sql.includes('INSERT INTO app.messages') && sql.includes('metadata') && params.length > 8;
}

describe('ChatService streaming', () => {
  it('does not forward the upstream done event twice', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app.conversations'))
          return { rows: [conversationRow()], rowCount: 1 };
        if (sql.includes('INSERT INTO app.messages') && sql.includes('metadata')) {
          return { rows: [{ id: assistantId }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO app.messages')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM app.messages')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const ai = createAiClientStub({ chatStream: async () => sseResponse() });
    const service = new ChatService(pool, ai, logger);
    const events: Array<[string, unknown]> = [];

    await service.streamChat({
      user,
      conversationId,
      question: 'What is the policy?',
      onEvent: (event, data) => events.push([event, data]),
    });

    expect(events.filter(([event]) => event === 'done')).toHaveLength(1);
    const done = events.find(([event]) => event === 'done')?.[1] as Record<string, unknown>;
    expect(done['message_id']).toBe(assistantId);
    expect(done['conversation_id']).toBe(conversationId);
    expect(done['trace_id']).toBe('trace-1');
  });

  it('persists a partial answer when the client aborts', async () => {
    const encoder = new TextEncoder();
    const ai = createAiClientStub({
      chatStream: async (_payload, signal) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('event: token\ndata: {"text":"Partial answer"}\n\n'));
            signal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          },
        });
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
      },
    });

    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM app.conversations'))
          return { rows: [conversationRow()], rowCount: 1 };
        if (insertAssistantId(sql, params)) {
          return { rows: [{ id: assistantId }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO app.messages')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM app.messages')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const service = new ChatService(pool, ai, logger);
    const controller = new AbortController();
    const events: string[] = [];

    await service.streamChat({
      user,
      conversationId,
      question: 'What is the policy?',
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event === 'token') {
          controller.abort();
        }
      },
    });

    expect(events).not.toContain('done');
    const insert = vi
      .mocked(pool.query)
      .mock.calls.find(([sql, params]) => insertAssistantId(sql, params as unknown[]));
    expect(insert).toBeDefined();
    expect(insert?.[1]?.[1]).toBe('Partial answer');
    const metadata = JSON.parse(String(insert?.[1]?.[8])) as Record<string, unknown>;
    expect(metadata['aborted']).toBe(true);
    expect(metadata['answer_status']).toBe('aborted');
  });

  it('treats an upstream stream that ends without done as an error', async () => {
    const ai = createAiClientStub({
      chatStream: async () =>
        new Response('event: token\ndata: {"text":"Partial answer"}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    });

    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM app.conversations'))
          return { rows: [conversationRow()], rowCount: 1 };
        if (insertAssistantId(sql, params)) {
          return { rows: [{ id: assistantId }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO app.messages')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM app.messages')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const service = new ChatService(pool, ai, logger);
    const events: Array<[string, unknown]> = [];

    await service.streamChat({
      user,
      conversationId,
      question: 'What is the policy?',
      onEvent: (event, data) => events.push([event, data]),
    });

    expect(events.some(([event]) => event === 'done')).toBe(false);
    expect(events.find(([event]) => event === 'error')?.[1]).toMatchObject({
      code: 'stream_error',
    });

    const insert = vi
      .mocked(pool.query)
      .mock.calls.find(([sql, params]) => insertAssistantId(sql, params as unknown[]));
    const metadata = JSON.parse(String(insert?.[1]?.[8])) as Record<string, unknown>;
    expect(metadata['answer_status']).toBe('error');
  });

  it('regenerates from the last user turn without adding a duplicate question', async () => {
    const captured: { payload?: AiChatStreamPayload } = {};
    const ai = createAiClientStub({
      chatStream: async (payload) => {
        captured.payload = payload;
        return sseResponse('Replacement answer');
      },
    });

    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM app.conversations'))
          return { rows: [conversationRow()], rowCount: 1 };
        if (sql.includes("role = 'user'") && sql.includes('SELECT content')) {
          return { rows: [{ content: 'Original question?' }], rowCount: 1 };
        }
        if (sql.includes('SELECT id, role') && sql.includes('ORDER BY created_at DESC')) {
          return { rows: [{ id: 'old-assistant', role: 'assistant' }], rowCount: 1 };
        }
        if (sql.includes('DELETE FROM app.messages')) return { rows: [], rowCount: 1 };
        if (sql.includes('FROM (') && sql.includes('LIMIT')) {
          return { rows: [{ role: 'user', content: 'Original question?' }], rowCount: 1 };
        }
        if (insertAssistantId(sql, params)) {
          return { rows: [{ id: assistantId }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO app.messages')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const service = new ChatService(pool, ai, logger);
    const events: Array<[string, unknown]> = [];

    await service.streamChat({
      user,
      conversationId,
      regenerate: true,
      onEvent: (event, data) => events.push([event, data]),
    });

    expect(captured.payload?.question).toBe('Original question?');
    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls.some(([sql]) => sql.includes('DELETE FROM app.messages'))).toBe(true);
    expect(
      calls.some(
        ([sql, params]) =>
          sql.includes('INSERT INTO app.messages') &&
          !sql.includes('metadata') &&
          params?.[1] === 'Original question?',
      ),
    ).toBe(false);

    const done = events.find(([event]) => event === 'done')?.[1] as Record<string, unknown>;
    expect(done['message_id']).toBe(assistantId);
  });
});
