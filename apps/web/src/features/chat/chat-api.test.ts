import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamChat } from './chat-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamChat', () => {
  it('parses split SSE frames and emits each event once', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        streamingResponse([
          'event: conversation\ndata: {"conversation_id":"conv-1"}\n\nevent: tok',
          'en\ndata: {"text":"Hello "}\n\nevent: token\ndata: {"text":"world"}\n\n',
          'event: sources\ndata: {"citations":[{"id":"c1"}]}\n\n',
          'event: done\ndata: {"message_id":"m1","conversation_id":"conv-1","time_to_first_token_ms":1234,"invalid_citation_count":0,"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
        ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const onConversation = vi.fn();
    const onToken = vi.fn();
    const onSources = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat({
      conversationId: 'conv-1',
      question: 'What is the policy?',
      handlers: { onConversation, onToken, onSources, onDone, onError },
    });

    expect(onConversation).toHaveBeenCalledWith('conv-1');
    expect(onToken.mock.calls).toEqual([['Hello '], ['world']]);
    expect(onSources).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({
      message_id: 'm1',
      time_to_first_token_ms: 1234,
      invalid_citation_count: 0,
    });
    expect(onError).not.toHaveBeenCalled();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      conversation_id: 'conv-1',
      question: 'What is the policy?',
    });
  });

  it('sends regenerate without a duplicated question', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        streamingResponse(['event: done\ndata: {"message_id":"m2"}\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);

    await streamChat({
      conversationId: 'conv-1',
      regenerate: true,
      handlers: {},
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      conversation_id: 'conv-1',
      regenerate: true,
    });
  });

  it('reports HTTP failures through onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    const onError = vi.fn();
    await streamChat({ question: 'Hello', handlers: { onError } });

    expect(onError).toHaveBeenCalledWith({
      code: 'http_error',
      message: 'Rate limit reached',
    });
  });
});
