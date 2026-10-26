import { createHash, createHmac } from 'node:crypto';

import type { Logger } from '../config/logger';

export interface AiIngestResult {
  document_id: string;
  chunks: number;
  pages: number;
  tokens: number;
  embedding_model: string;
  embedding_dim: number;
  status: 'indexed';
}

export interface AiChatStreamPayload {
  conversation_id: string;
  question: string;
  access_context: {
    user_id: string;
    role: string;
    group_ids: string[];
  };
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  trace_id?: string | null;
}
export class AiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

interface AiClientOptions {
  baseUrl: string;
  token: string;
  logger: Logger;
}

/**
 * Signed client for the internal AI service. Mirrors the HMAC contract in
 * services/ai/app/core/security.py: method + path + timestamp + body hash.
 */
export class InternalAiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly logger: Logger;

  constructor({ baseUrl, token, logger }: AiClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.logger = logger;
  }

  ingest(payload: {
    document_id: string;
    storage_url: string;
    filename: string;
    mime_type: string | null;
    title: string;
    access_level: string;
    size_bytes: number;
  }): Promise<AiIngestResult> {
    return this.request<AiIngestResult>('POST', '/ingest', payload, 5 * 60_000);
  }

  chatStream(payload: AiChatStreamPayload, signal?: AbortSignal): Promise<Response> {
    if (!this.token) {
      throw new AiRequestError(503, 'Internal service authentication is not configured.');
    }

    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const signature = createHmac('sha256', this.token)
      .update(`POST\n/chat/stream\n${timestamp}\n${bodyHash}`)
      .digest('hex');

    const fetchInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Verity-Timestamp': timestamp,
        'X-Verity-Signature': signature,
      },
      body: rawBody,
    };
    if (signal) {
      fetchInit.signal = signal;
    }

    return fetch(`${this.baseUrl}/chat/stream`, fetchInit)
      .catch((error) => {
        this.logger.error({ err: error }, 'ai chat stream request failed');
        throw new AiRequestError(502, 'The answer service is unavailable.');
      })
      .then(async (response) => {
        if (!response.ok) {
          let detail = 'The answer service rejected the request.';
          try {
            const data = (await response.json()) as { detail?: string };
            if (data.detail) {
              detail = String(data.detail).slice(0, 400);
            }
          } catch {
            // keep generic
          }
          this.logger.warn({ status: response.status }, 'ai chat stream returned an error');
          throw new AiRequestError(response.status, detail);
        }
        return response;
      });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.request('DELETE', `/documents/${documentId}`, undefined, 30_000);
  }

  private async request<T>(
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = 60_000,
  ): Promise<T> {
    if (!this.token) {
      throw new AiRequestError(503, 'Internal service authentication is not configured.');
    }

    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const signature = createHmac('sha256', this.token)
      .update(`${method}\n${path}\n${timestamp}\n${bodyHash}`)
      .digest('hex');

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Verity-Timestamp': timestamp,
          'X-Verity-Signature': signature,
        },
        ...(body === undefined ? {} : { body: rawBody }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.error({ err: error, path }, 'ai service request failed');
      throw new AiRequestError(502, 'The indexing service is unavailable.');
    }

    if (!response.ok) {
      let detail = 'The indexing service rejected the request.';
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) {
          detail = String(payload.detail).slice(0, 400);
        }
      } catch {
        // keep the generic message
      }
      this.logger.warn({ path, status: response.status }, 'ai service returned an error');
      throw new AiRequestError(response.status, detail);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
