import type { Pool } from 'pg';

import type { ChatRoute, InternalAiClient } from '../ai-client/internal';
import type { Logger } from '../config/logger';
import type { AuthUser } from '../types/auth';
import { createSseParser } from './sse';

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

export interface MessageMetadata {
  answer_status?:
    'answered' | 'refused' | 'uncited' | 'aborted' | 'error' | 'clarification' | 'out_of_scope';
  aborted?: boolean;
  low_confidence?: boolean;
  model?: string;
  router?: Record<string, unknown>;
  spans?: Record<string, number>;
  cited_indices?: number[];
  citation_count?: number;
  invalid_citation_count?: number;
  time_to_first_token_ms?: number | null;
  retrieval?: { best_score?: number; candidates?: number };
  sql_outcome?: Record<string, unknown>;
  error_code?: string;
  [key: string]: unknown;
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
  metadata: MessageMetadata;
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
  question?: string | undefined;
  regenerate?: boolean | undefined;
  route?: ChatRoute | undefined;
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
      metadata: MessageMetadata | null;
      rating: number | null;
      comment: string | null;
      created_at: string;
    }>(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.route, m.citations,
              m.sql_query, m.sql_result_preview, m.trace_id, m.latency_ms,
              m.prompt_tokens, m.completion_tokens, m.metadata, m.created_at,
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
      metadata:
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? row.metadata
          : {},
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
    const { user, onEvent, signal } = options;
    const regenerate = options.regenerate === true;
    const route: ChatRoute = options.route ?? 'auto';
    let convId = options.conversationId;
    let prompt = (options.question ?? '').trim();
    let createdNew = false;

    if (!convId) {
      if (regenerate) {
        throw new Error('A conversation is required to regenerate an answer.');
      }
      if (!prompt) {
        throw new Error('A question is required.');
      }
      const created = await this.createConversation(user.id, prompt.slice(0, 60));
      convId = created.id;
      createdNew = true;
    } else {
      const conversation = await this.getConversation(user.id, convId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
    }

    if (regenerate) {
      const lastUser = await this.pool.query<{ content: string }>(
        `SELECT content
         FROM app.messages
         WHERE conversation_id = $1 AND role = 'user'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [convId],
      );
      prompt = lastUser.rows[0]?.content?.trim() ?? '';
      if (!prompt) {
        throw new Error('There is no earlier question to regenerate.');
      }

      // Replace the previous answer instead of appending a second one. Only
      // remove it when it is the most recent message; a failed earlier attempt
      // may have left the user turn last.
      const lastMessage = await this.pool.query<{ id: string; role: string }>(
        `SELECT id, role
         FROM app.messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [convId],
      );
      const previous = lastMessage.rows[0];
      if (previous?.role === 'assistant') {
        await this.pool.query(`DELETE FROM app.messages WHERE id = $1`, [previous.id]);
      }
    } else if (!prompt) {
      throw new Error('A question is required.');
    }

    this.logger.debug({ userId: user.id, convId, regenerate }, 'starting chat stream');

    // Load the most recent turns before adding the new user message. The
    // previous query used LIMIT with ascending order, which dropped recent
    // history once a conversation grew beyond the limit.
    const history = await this.loadHistory(convId, 20);
    if (regenerate) {
      const last = history[history.length - 1];
      if (last?.role === 'user' && last.content === prompt) {
        history.pop();
      }
    } else {
      await this.pool.query(
        `INSERT INTO app.messages (conversation_id, role, content)
         VALUES ($1, 'user', $2)`,
        [convId, prompt],
      );
    }

    if (!createdNew) {
      // A manually created empty thread gets a useful title on its first turn.
      await this.pool.query(
        `UPDATE app.conversations
         SET title = $2, updated_at = now()
         WHERE id = $1 AND (title = 'New conversation' OR title = '')`,
        [convId, prompt.slice(0, 60)],
      );
    }

    // Tell the browser which conversation exists before generation starts so a
    // stop, reload, or regenerate can address the same thread.
    onEvent('conversation', { conversation_id: convId });

    const aiResponse = await this.ai.chatStream(
      {
        conversation_id: convId,
        question: prompt,
        access_context: {
          user_id: user.id,
          role: user.role,
          group_ids: user.groupIds || [],
        },
        history,
        route,
      },
      signal,
    );

    if (!aiResponse.body) {
      throw new Error('AI service returned an empty response body.');
    }

    let accumulatedContent = '';
    let detectedRoute = 'documents';
    let citations: MessageCitation[] = [];
    let upstreamDone: Record<string, unknown> = {};
    let streamError: { code: string; message: string } | null = null;
    let readError: unknown = null;
    let aborted = signal?.aborted === true;
    let receivedDone = false;
    // SQL event payload — persisted on the assistant message
    let sqlQuery: string | null = null;
    let sqlResultPreview: unknown = null;

    const parser = createSseParser((event, data) => {
      const payload = asRecord(data);

      if (event === 'route') {
        const route = asString(payload.route);
        if (route) detectedRoute = route;
      } else if (event === 'sql') {
        // Persist the displayed result (already capped by the AI service at
        // 200 rows) so reopening a conversation restores the SQL panel.
        sqlQuery = asString(payload.sql) ?? asString(payload.query);
        if (payload.rows !== undefined) {
          const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 200) : [];
          sqlResultPreview = {
            sql: sqlQuery,
            query: sqlQuery,
            columns: Array.isArray(payload.columns) ? payload.columns : [],
            rows,
            row_count: payload.row_count,
            truncated: payload.truncated,
            execution_ms: payload.execution_ms,
          };
        }
      } else if (event === 'token') {
        const text = asString(payload.text);
        if (text) accumulatedContent += text;
      } else if (event === 'sources') {
        if (Array.isArray(payload.citations)) {
          citations = payload.citations as MessageCitation[];
        }
      } else if (event === 'done') {
        // The gateway emits its own done event after persistence. Suppressing
        // the upstream done avoids duplicate assistant messages in the client.
        receivedDone = true;
        upstreamDone = payload;
        return;
      } else if (event === 'error') {
        streamError = {
          code: asString(payload.code) ?? 'stream_error',
          message: asString(payload.message) ?? 'The answer stream failed.',
        };
      }

      if (!signal?.aborted) {
        onEvent(event, data);
      }
    });

    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      parser.feed(decoder.decode());
      parser.end();
    } catch (error) {
      readError = error;
    } finally {
      if (aborted || signal?.aborted) {
        aborted = true;
        try {
          await reader.cancel();
        } catch {
          // The body may already be closed after an abort.
        }
      }
      reader.releaseLock();
    }

    const failure =
      streamError ??
      (readError && !aborted
        ? { code: 'stream_error', message: 'The answer stream was interrupted.' }
        : null) ??
      (!aborted && !receivedDone
        ? { code: 'stream_error', message: 'The answer stream ended before completion.' }
        : null);

    if (aborted) {
      this.logger.info({ userId: user.id, convId }, 'chat stream aborted');
    } else if (failure) {
      this.logger.warn({ userId: user.id, convId, err: readError }, 'chat stream failed');
      if (!streamError) {
        onEvent('error', failure);
      }
    }

    const traceId = asString(upstreamDone.trace_id);
    const latencyMs = asNumber(upstreamDone.latency_ms);
    const usage = asRecord(upstreamDone.usage);
    const promptTokens = asNumber(usage.prompt_tokens);
    const completionTokens = asNumber(usage.completion_tokens);
    const lowConfidence = upstreamDone.low_confidence === true;
    const answerStatus: NonNullable<MessageMetadata['answer_status']> = aborted
      ? 'aborted'
      : failure
        ? 'error'
        : normalizeAnswerStatus(upstreamDone.answer_status);
    const citedIndices = asNumberArray(upstreamDone.cited_indices);
    const citationCount = asNumber(upstreamDone.citation_count) ?? citations.length;
    const invalidCitationCount = asNumber(upstreamDone.invalid_citation_count) ?? 0;
    const timeToFirstTokenMs = asNumber(upstreamDone.time_to_first_token_ms);
    const spans = asNumberRecord(upstreamDone.spans);
    const retrieval = asNumberRecord(upstreamDone.retrieval);
    const sqlOutcome = asRecord(upstreamDone.sql_outcome);
    const router = asRecord(upstreamDone.router);
    const model = asString(upstreamDone.model);

    const metadata: MessageMetadata = {
      answer_status: answerStatus,
      aborted,
      low_confidence: lowConfidence,
      cited_indices: citedIndices,
      citation_count: citationCount,
      invalid_citation_count: invalidCitationCount,
      time_to_first_token_ms: timeToFirstTokenMs,
      ...(model ? { model } : {}),
      ...(spans ? { spans } : {}),
      ...(retrieval ? { retrieval } : {}),
      ...(Object.keys(sqlOutcome).length > 0 ? { sql_outcome: sqlOutcome } : {}),
      ...(Object.keys(router).length > 0 ? { router } : {}),
      ...(failure ? { error_code: failure.code } : {}),
    };

    // Partial answers are persisted on abort or failure so the conversation
    // stays truthful after a reconnect. Failed turns with no content are not
    // stored as assistant messages.
    let messageId: string | null = null;
    if (accumulatedContent.trim().length > 0) {
      try {
        const insertResult = await this.pool.query<{ id: string }>(
          `INSERT INTO app.messages (
             conversation_id, role, content, route, citations, sql_query,
             sql_result_preview, trace_id, latency_ms, prompt_tokens,
             completion_tokens, metadata
           )
           VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            convId,
            accumulatedContent,
            detectedRoute,
            JSON.stringify(citations),
            sqlQuery,
            sqlResultPreview ? JSON.stringify(sqlResultPreview) : null,
            traceId,
            latencyMs,
            promptTokens,
            completionTokens,
            JSON.stringify(metadata),
          ],
        );
        messageId = insertResult.rows[0]?.id ?? null;
      } catch (error) {
        this.logger.error({ err: error, convId }, 'failed to persist assistant message');
      }
    }

    try {
      await this.pool.query(`UPDATE app.conversations SET updated_at = now() WHERE id = $1`, [
        convId,
      ]);
    } catch (error) {
      this.logger.warn({ err: error, convId }, 'failed to update conversation timestamp');
    }

    if (!aborted && !failure) {
      onEvent('done', {
        message_id: messageId,
        conversation_id: convId,
        route: detectedRoute,
        trace_id: traceId,
        latency_ms: latencyMs,
        usage: {
          prompt_tokens: promptTokens ?? 0,
          completion_tokens: completionTokens ?? 0,
        },
        low_confidence: lowConfidence,
        answer_status: answerStatus,
        cited_indices: citedIndices,
        citation_count: citationCount,
        invalid_citation_count: invalidCitationCount,
        time_to_first_token_ms: timeToFirstTokenMs,
        aborted: false,
        persisted: messageId !== null,
        ...(Object.keys(sqlOutcome).length > 0 ? { sql_outcome: sqlOutcome } : {}),
        ...(Object.keys(router).length > 0 ? { router } : {}),
      });
    }
  }

  private async loadHistory(
    conversationId: string,
    limit: number,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const result = await this.pool.query<{ role: 'user' | 'assistant'; content: string }>(
      `SELECT role, content
       FROM (
         SELECT id, role, content, created_at
         FROM app.messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [conversationId, Math.max(1, limit)],
    );
    return result.rows;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeAnswerStatus(value: unknown): NonNullable<MessageMetadata['answer_status']> {
  const status = asString(value);
  return status === 'refused' ||
    status === 'uncited' ||
    status === 'answered' ||
    status === 'clarification' ||
    status === 'out_of_scope'
    ? status
    : 'answered';
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}
