import { getAccessToken } from '../../lib/access-token';
import { apiFetch, refreshAccessToken } from '../../lib/api';
import { createSseParser } from '../../lib/sse';

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  id: string;
  document_id: string;
  title: string;
  page: number | null;
  section: string | null;
  snippet: string;
  score: number;
}

export interface MessageMetadata {
  answer_status?: 'answered' | 'refused' | 'uncited' | 'aborted' | 'error';
  aborted?: boolean;
  low_confidence?: boolean;
  model?: string;
  spans?: Record<string, number>;
  cited_indices?: number[];
  citation_count?: number;
  invalid_citation_count?: number;
  time_to_first_token_ms?: number | null;
  retrieval?: { best_score?: number; candidates?: number };
  error_code?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  route: string | null;
  citations: Citation[];
  sql_query?: string | null | undefined;
  sql_result_preview?: unknown | null | undefined;
  trace_id?: string | null | undefined;
  latency_ms?: number | null | undefined;
  metadata?: MessageMetadata | undefined;
  feedback?: { rating: number; comment: string | null } | null | undefined;
  created_at: string;
}

export interface Feedback {
  id: string;
  message_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface StreamDonePayload {
  message_id?: string;
  conversation_id?: string;
  route?: string;
  latency_ms?: number;
  trace_id?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  low_confidence?: boolean;
  answer_status?: MessageMetadata['answer_status'];
  cited_indices?: number[];
  citation_count?: number;
  invalid_citation_count?: number;
  time_to_first_token_ms?: number | null;
  aborted?: boolean;
  persisted?: boolean;
}

export interface StreamHandlers {
  onConversation?: (conversationId: string) => void;
  onStatus?: (stage: string, message: string) => void;
  onRoute?: (route: string) => void;
  onToken?: (text: string) => void;
  onSources?: (citations: Citation[]) => void;
  onDone?: (payload: StreamDonePayload) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export interface StreamChatOptions {
  conversationId?: string | undefined;
  question?: string | undefined;
  regenerate?: boolean | undefined;
  handlers: StreamHandlers;
  signal?: AbortSignal | undefined;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const data = await apiFetch<{ conversations: Conversation[] }>('/api/conversations');
  return data.conversations;
}

export async function createConversation(title?: string): Promise<Conversation> {
  const data = await apiFetch<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return data.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch<void>(`/api/conversations/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  const data = await apiFetch<{ messages: ChatMessage[] }>(
    `/api/conversations/${conversationId}/messages`,
  );
  return data.messages;
}

export async function submitFeedback(
  messageId: string,
  rating: 1 | -1,
  comment?: string,
): Promise<Feedback> {
  const data = await apiFetch<{ feedback: Feedback }>(`/api/messages/${messageId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment: comment || undefined }),
  });
  return data.feedback;
}

export async function streamChat({
  conversationId,
  question,
  regenerate,
  handlers,
  signal,
}: StreamChatOptions): Promise<void> {
  let token = getAccessToken();

  const makeRequest = async (authToken: string | null): Promise<Response> => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    });
    if (authToken) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }

    const init: RequestInit = {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        conversation_id: conversationId,
        question,
        regenerate: regenerate || undefined,
      }),
    };
    if (signal) {
      init.signal = signal;
    }

    return fetch('/api/chat/stream', init);
  };

  let response = await makeRequest(token);

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await makeRequest(token);
    }
  }

  if (!response.ok) {
    let message = 'Failed to connect to chat stream';
    try {
      const errBody = (await response.json()) as { error?: { message?: string } };
      if (errBody.error?.message) {
        message = errBody.error.message;
      }
    } catch {
      // keep fallback
    }
    handlers.onError?.({ code: 'http_error', message });
    return;
  }

  if (!response.body) {
    handlers.onError?.({ code: 'empty_stream', message: 'No response body stream received' });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((event, data) => {
    const payload =
      data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};

    if (event === 'conversation' && typeof payload.conversation_id === 'string') {
      handlers.onConversation?.(payload.conversation_id);
    } else if (event === 'status' && payload.stage) {
      handlers.onStatus?.(String(payload.stage), String(payload.message || ''));
    } else if (event === 'route' && payload.route) {
      handlers.onRoute?.(String(payload.route));
    } else if (event === 'token' && typeof payload.text === 'string') {
      handlers.onToken?.(payload.text);
    } else if (event === 'sources' && Array.isArray(payload.citations)) {
      handlers.onSources?.(payload.citations as Citation[]);
    } else if (event === 'done') {
      handlers.onDone?.(payload as StreamDonePayload);
    } else if (event === 'error') {
      handlers.onError?.({
        code: String(payload.code || 'stream_error'),
        message: String(payload.message || 'An error occurred during streaming'),
      });
    }
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.end();
  } finally {
    reader.releaseLock();
  }
}
