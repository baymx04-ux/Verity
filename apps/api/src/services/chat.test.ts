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
      'event: done\ndata: {"trace_id":"trace-1","latency_ms":80,"time_to_first_token_ms":1420,"low_confidence":false,"answer_status":"answered","cited_indices":[],"citation_count":0,"invalid_citation_count":1,"model":"fake","usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function insertAssistantId(sql: string, params: unknown[]) {
  return sql.includes('INSERT INTO app.messages') && sql.includes('metadata') && params.length > 8;
}

function sqlSseResponse() {
  return new Response(
    `event: conversation\ndata: {"conversation_id":"${conversationId}"}\n\n` +
      'event: route\ndata: {"route":"sql"}\n\n' +
      'event: status\ndata: {"stage":"executing","message":"Running a safe read-only query…"}\n\n' +
      'event: sql\ndata: {"sql":"SELECT region_name, net_revenue FROM business_ro.v_revenue_daily LIMIT 5","columns":["region_name","net_revenue"],"rows":[{"region_name":"Europe","net_revenue":1250.5}],"row_count":1,"truncated":false,"execution_ms":7}\n\n' +
      'event: token\ndata: {"text":"Europe led the quarter with 1,250.50 in net revenue."}\n\n' +
      'event: sources\ndata: {"citations":[]}\n\n' +
      'event: done\ndata: {"trace_id":"trace-sql","latency_ms":90,"time_to_first_token_ms":60,"low_confidence":false,"answer_status":"answered","usage":{"prompt_tokens":20,"completion_tokens":9},"sql_outcome":{"outcome":"success","row_count":1,"truncated":false}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
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
    expect(done['time_to_first_token_ms']).toBe(1420);
    expect(done['invalid_citation_count']).toBe(1);

    const insert = vi
      .mocked(pool.query)
      .mock.calls.find(([sql, params]) => insertAssistantId(sql, params as unknown[]));
    const metadata = JSON.parse(String(insert?.[1]?.[10])) as Record<string, unknown>;
    expect(metadata['time_to_first_token_ms']).toBe(1420);
    expect(metadata['invalid_citation_count']).toBe(1);
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
    const metadata = JSON.parse(String(insert?.[1]?.[10])) as Record<string, unknown>;
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
    const metadata = JSON.parse(String(insert?.[1]?.[10])) as Record<string, unknown>;
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

  it('forwards sql mode, persists the query/result, and relays sql metadata', async () => {
    const captured: { payload?: AiChatStreamPayload } = {};
    const ai = createAiClientStub({
      chatStream: async (payload) => {
        captured.payload = payload;
        return sqlSseResponse();
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
    const events: Array<[string, unknown]> = [];

    await service.streamChat({
      user,
      conversationId,
      question: 'Revenue by region last quarter?',
      route: 'sql',
      onEvent: (event, data) => events.push([event, data]),
    });

    expect(captured.payload?.route).toBe('sql');

    const sqlEvent = events.find(([event]) => event === 'sql')?.[1] as Record<string, unknown>;
    expect(sqlEvent['sql']).toContain('business_ro.v_revenue_daily');
    expect(sqlEvent['row_count']).toBe(1);

    const done = events.find(([event]) => event === 'done')?.[1] as Record<string, unknown>;
    expect(done['route']).toBe('sql');
    expect(done['sql_outcome']).toMatchObject({ outcome: 'success', row_count: 1 });

    const insert = vi
      .mocked(pool.query)
      .mock.calls.find(([sql, params]) => insertAssistantId(sql, params as unknown[]));
    expect(insert?.[1]?.[2]).toBe('sql');
    expect(insert?.[1]?.[4]).toContain('business_ro.v_revenue_daily');
    const preview = JSON.parse(String(insert?.[1]?.[5])) as Record<string, unknown>;
    expect(preview['row_count']).toBe(1);
    const metadata = JSON.parse(String(insert?.[1]?.[10])) as Record<string, unknown>;
    expect(metadata['sql_outcome']).toMatchObject({ outcome: 'success' });
  });
});
