import { getAccessToken } from '../../lib/access-token';
import { apiFetch, refreshAccessToken } from '../../lib/api';

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

export interface StreamHandlers {
  onStatus?: (stage: string, message: string) => void;
  onRoute?: (route: string) => void;
  onToken?: (text: string) => void;
  onSources?: (citations: Citation[]) => void;
  onDone?: (payload: {
    message_id?: string;
    conversation_id?: string;
    latency_ms?: number;
    trace_id?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export interface StreamChatOptions {
  conversationId?: string | undefined;
  question: string;
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
          if (!rawData) continue;
          try {
            const data = JSON.parse(rawData);
            if (currentEvent === 'status' && data.stage) {
              handlers.onStatus?.(String(data.stage), String(data.message || ''));
            } else if (currentEvent === 'route' && data.route) {
              handlers.onRoute?.(String(data.route));
            } else if (currentEvent === 'token' && typeof data.text === 'string') {
              handlers.onToken?.(data.text);
            } else if (currentEvent === 'sources' && Array.isArray(data.citations)) {
              handlers.onSources?.(data.citations);
            } else if (currentEvent === 'done') {
              handlers.onDone?.(data);
            } else if (currentEvent === 'error') {
              handlers.onError?.({
                code: String(data.code || 'stream_error'),
                message: String(data.message || 'An error occurred during streaming'),
              });
            }
          } catch {
            // ignore partial json
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
