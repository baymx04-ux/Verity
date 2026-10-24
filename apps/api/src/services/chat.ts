import type { Pool } from 'pg';

import type { InternalAiClient } from '../ai-client/internal';
import type { Logger } from '../config/logger';
import type { AuthUser } from '../types/auth';

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageCitation {
  id: string;
  document_id: string;
  title: string;
  page: number | null;
  section: string | null;
  snippet: string;
  score: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  route: string | null;
  citations: MessageCitation[];
  sql_query: string | null;
  sql_result_preview: unknown | null;
  trace_id: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  feedback?: { rating: number; comment: string | null } | null;
  created_at: string;
}

export interface FeedbackRow {
  id: string;
  message_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface StreamChatOptions {
  user: AuthUser;
  conversationId?: string | undefined;
  question: string;
  onEvent: (event: string, data: unknown) => void;
  signal?: AbortSignal | undefined;
}

export class ChatService {
  constructor(
    private readonly pool: Pool,
    private readonly ai: InternalAiClient,
    private readonly logger: Logger,
  ) {}

  async listConversations(userId: string): Promise<ConversationRow[]> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT id, user_id, title, created_at, updated_at
       FROM app.conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationRow | null> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT id, user_id, title, created_at, updated_at
       FROM app.conversations
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    return result.rows[0] ?? null;
  }

  async createConversation(userId: string, title?: string): Promise<ConversationRow> {
    const safeTitle = (title || 'New conversation').trim().slice(0, 100);
    const result = await this.pool.query<ConversationRow>(
      `INSERT INTO app.conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, user_id, title, created_at, updated_at`,
      [userId, safeTitle],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create conversation');
    }
    return row;
  }

  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM app.conversations
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [conversationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listMessages(userId: string, conversationId: string): Promise<MessageRow[]> {
    const conversation = await this.getConversation(userId, conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const result = await this.pool.query<{
      id: string;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      route: string | null;
      citations: MessageCitation[];
      sql_query: string | null;
      sql_result_preview: unknown | null;
      trace_id: string | null;
      latency_ms: number | null;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      rating: number | null;
      comment: string | null;
      created_at: string;
    }>(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.route, m.citations,
              m.sql_query, m.sql_result_preview, m.trace_id, m.latency_ms,
              m.prompt_tokens, m.completion_tokens, m.created_at,
              f.rating, f.comment
       FROM app.messages m
       LEFT JOIN app.feedback f ON f.message_id = m.id AND f.user_id = $2
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId, userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      role: row.role,
      content: row.content,
      route: row.route,
      citations: Array.isArray(row.citations) ? row.citations : [],
      sql_query: row.sql_query,
      sql_result_preview: row.sql_result_preview,
      trace_id: row.trace_id,
      latency_ms: row.latency_ms,
      prompt_tokens: row.prompt_tokens,
      completion_tokens: row.completion_tokens,
      feedback: row.rating ? { rating: row.rating, comment: row.comment } : null,
      created_at: row.created_at,
    }));
  }

  async submitFeedback(
    userId: string,
    messageId: string,
    rating: 1 | -1,
    comment?: string | null,
  ): Promise<FeedbackRow> {
    const msgCheck = await this.pool.query(
      `SELECT m.id
       FROM app.messages m
       JOIN app.conversations c ON c.id = m.conversation_id
       WHERE m.id = $1 AND c.user_id = $2`,
      [messageId, userId],
    );

    if (msgCheck.rowCount === 0) {
      throw new Error('Message not found');
    }

    const result = await this.pool.query<FeedbackRow>(
      `INSERT INTO app.feedback (message_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()
       RETURNING id, message_id, user_id, rating, comment, created_at`,
      [messageId, userId, rating, comment || null],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to record feedback');
    }
    return row;
  }

  async streamChat(options: StreamChatOptions): Promise<void> {
    const { user, question, onEvent, signal } = options;
    let convId = options.conversationId;

    if (convId) {
      const conv = await this.getConversation(user.id, convId);
      if (!conv) {
        throw new Error('Conversation not found');
      }
    } else {
      const derivedTitle = question.trim().slice(0, 60) || 'New question';
      const created = await this.createConversation(user.id, derivedTitle);
      convId = created.id;
    }

    this.logger.debug({ userId: user.id, convId }, 'starting chat stream');

    // Save user question to database
    await this.pool.query(
      `INSERT INTO app.messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)`,
      [convId, question.trim()],
    );

    // Fetch previous messages for conversation history
    const historyResult = await this.pool.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content
       FROM app.messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 20`,
      [convId],
    );

    const history = historyResult.rows.slice(0, -1); // exclude current question

    const aiResponse = await this.ai.chatStream(
      {
        conversation_id: convId,
        question: question.trim(),
        access_context: {
          user_id: user.id,
          role: user.role,
          group_ids: user.groupIds || [],
        },
        history,
      },
      signal,
    );

    if (!aiResponse.body) {
      throw new Error('AI service returned an empty response body.');
    }

    let accumulatedContent = '';
    let detectedRoute: string | null = null;
    let citations: MessageCitation[] = [];
    let traceId: string | null = null;
    let latencyMs: number | null = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;

    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = 'message';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const rawData = line.slice(6).trim();
            try {
              const data = JSON.parse(rawData);
              if (currentEvent === 'route' && data.route) {
                detectedRoute = String(data.route);
              } else if (currentEvent === 'token' && typeof data.text === 'string') {
                accumulatedContent += data.text;
              } else if (currentEvent === 'sources' && Array.isArray(data.citations)) {
                citations = data.citations;
              } else if (currentEvent === 'done') {
                traceId = data.trace_id ? String(data.trace_id) : null;
                latencyMs = typeof data.latency_ms === 'number' ? data.latency_ms : null;
                if (data.usage) {
                  promptTokens = data.usage.prompt_tokens ?? null;
                  completionTokens = data.usage.completion_tokens ?? null;
                }
              }
              onEvent(currentEvent, data);
            } catch {
              // ignore parse errors for partial event data
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Persist assistant message
    const insertResult = await this.pool.query<{ id: string }>(
      `INSERT INTO app.messages (
         conversation_id, role, content, route, citations, trace_id,
         latency_ms, prompt_tokens, completion_tokens
       )
       VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        convId,
        accumulatedContent,
        detectedRoute || 'documents',
        JSON.stringify(citations),
        traceId,
        latencyMs,
        promptTokens,
        completionTokens,
      ],
    );

    const messageId = insertResult.rows[0]?.id;

    // Update conversation timestamp
    await this.pool.query(
      `UPDATE app.conversations SET updated_at = now() WHERE id = $1`,
      [convId],
    );

    // Emit final enhanced done event with message_id and conversation_id
    onEvent('done', {
      message_id: messageId,
      conversation_id: convId,
      route: detectedRoute || 'documents',
      trace_id: traceId,
      latency_ms: latencyMs,
      usage: {
        prompt_tokens: promptTokens || 0,
        completion_tokens: completionTokens || 0,
      },
    });
  }
}
