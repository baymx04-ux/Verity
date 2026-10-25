import express from 'express';
import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { signAccessToken } from '../auth/jwt';
import type { Role } from '../auth/types';
import { optionalAuthenticate } from '../middleware/auth';
import { ChatService } from '../services/chat';
import { testConfig } from '../testing/fixtures';
import { createAiClientStub } from '../testing/ai-stub';
import { createConversationsRouter } from './conversations';
import { createChatRouter } from './chat';
import { createMessagesRouter } from './messages';

const config = testConfig();
const logger = pino({ level: 'silent' });

function auth(role: Role, id = '33333333-3333-3333-3333-333333333333'): string {
  const token = signAccessToken(config, { id, email: `${role}@verity.dev`, role }, `jti-${role}`);
  return `Bearer ${token}`;
}

describe('chat, conversations, and feedback api', () => {
  it('requires authentication for chat stream', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const ai = createAiClientStub();
    const chatService = new ChatService(pool, ai, logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/chat', createChatRouter({ chatService, logger, config }));

    const res = await request(app).post('/api/chat/stream').send({ question: 'Hello' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty question', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const ai = createAiClientStub();
    const chatService = new ChatService(pool, ai, logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/chat', createChatRouter({ chatService, logger, config }));

    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', auth('analyst'))
      .send({ question: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('streams chat events and persists messages', async () => {
    const convId = '11111111-1111-1111-1111-111111111111';
    const messageId = '22222222-2222-2222-2222-222222222222';
    const userId = '33333333-3333-3333-3333-333333333333';

    const pool = {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        if (sql.includes('INSERT INTO app.conversations')) {
          return {
            rows: [
              {
                id: convId,
                user_id: userId,
                title: 'What is the vacation policy?',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO app.messages')) {
          return { rows: [{ id: messageId }], rowCount: 1 };
        }
        if (sql.includes('SELECT role, content FROM app.messages')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('UPDATE app.conversations')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Pool;

    const ai = createAiClientStub({
      chatStream: async () =>
        new Response(
          'event: route\ndata: {"route":"documents"}\n\nevent: token\ndata: {"text":"You get 25 days."}\n\nevent: done\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":5},"latency_ms":120}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    });

    const chatService = new ChatService(pool, ai, logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/chat', createChatRouter({ chatService, logger, config }));

    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', auth('analyst', userId))
      .send({ question: 'What is the vacation policy?' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: route');
    expect(res.text).toContain('event: token');
    expect(res.text).toContain('You get 25 days.');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain(messageId);

    // The upstream done event is suppressed; the gateway emits one done after
    // persistence so the browser cannot append the same assistant message twice.
    expect(res.text.match(/event: done/g)).toHaveLength(1);
  });

  it('returns an in-band error for a conversation owned by another user', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as Pool;

    const chatService = new ChatService(pool, createAiClientStub(), logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/chat', createChatRouter({ chatService, logger, config }));

    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', auth('viewer'))
      .send({
        conversation_id: '11111111-1111-1111-1111-111111111111',
        question: 'What is the policy?',
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('not_found');
  });

  it('requires a conversation id when regenerating', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const chatService = new ChatService(pool, createAiClientStub(), logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/chat', createChatRouter({ chatService, logger, config }));

    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', auth('analyst'))
      .send({ regenerate: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('manages conversations CRUD', async () => {
    const convId = '11111111-1111-1111-1111-111111111111';
    const userId = '33333333-3333-3333-3333-333333333333';

    const pool = {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        if (sql.includes('app.conversations') && sql.includes('SELECT')) {
          return {
            rows: [
              {
                id: convId,
                user_id: userId,
                title: 'Test Conversation',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO app.conversations')) {
          return {
            rows: [
              {
                id: convId,
                user_id: userId,
                title: 'Created Thread',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('DELETE FROM app.conversations')) {
          return { rowCount: 1, rows: [] };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Pool;

    const chatService = new ChatService(pool, createAiClientStub(), logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/conversations', createConversationsRouter({ chatService, logger }));

    // List conversations
    const listRes = await request(app)
      .get('/api/conversations')
      .set('Authorization', auth('viewer', userId));
    expect(listRes.status).toBe(200);
    expect(listRes.body.conversations).toHaveLength(1);

    // Create conversation
    const createRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', auth('viewer', userId))
      .send({ title: 'Created Thread' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.conversation.title).toBe('Created Thread');

    // Delete conversation
    const deleteRes = await request(app)
      .delete(`/api/conversations/${convId}`)
      .set('Authorization', auth('viewer', userId));
    expect(deleteRes.status).toBe(204);
  });

  it('records feedback on a message', async () => {
    const messageId = '22222222-2222-2222-2222-222222222222';
    const userId = '33333333-3333-3333-3333-333333333333';

    const pool = {
      query: vi.fn(async (sql: string, _params: unknown[]) => {
        if (sql.includes('app.messages') && sql.includes('SELECT')) {
          return { rows: [{ id: messageId }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO app.feedback')) {
          return {
            rows: [
              {
                id: '55555555-5555-5555-5555-555555555555',
                message_id: messageId,
                user_id: userId,
                rating: 1,
                comment: 'Very helpful citation!',
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Pool;

    const chatService = new ChatService(pool, createAiClientStub(), logger);

    const app = express();
    app.use(express.json());
    app.use(optionalAuthenticate(config, logger));
    app.use('/api/messages', createMessagesRouter({ chatService, logger }));

    const res = await request(app)
      .post(`/api/messages/${messageId}/feedback`)
      .set('Authorization', auth('viewer', userId))
      .send({ rating: 1, comment: 'Very helpful citation!' });

    expect(res.status).toBe(200);
    expect(res.body.feedback.rating).toBe(1);
    expect(res.body.feedback.comment).toBe('Very helpful citation!');
  });
});
