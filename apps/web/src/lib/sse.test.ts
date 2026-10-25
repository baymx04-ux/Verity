import { describe, expect, it, vi } from 'vitest';

import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('preserves the event name across chunk boundaries', () => {
    const events: Array<[string, unknown]> = [];
    const parser = createSseParser((event, data) => events.push([event, data]));

    parser.feed('event: token\n');
    parser.feed('data: {"text":"streamed"}\n\n');

    expect(events).toEqual([['token', { text: 'streamed' }]]);
  });

  it('ignores heartbeats and supports CRLF frames', () => {
    const events: Array<[string, unknown]> = [];
    const parser = createSseParser((event, data) => events.push([event, data]));

    parser.feed(': ping\r\n\r\n');
    parser.feed('event: status\r\ndata: {"stage":"writing"}\r\n\r\n');

    expect(events).toEqual([['status', { stage: 'writing' }]]);
  });

  it('keeps the default message event when no event field is sent', () => {
    const onEvent = vi.fn();
    const parser = createSseParser(onEvent);

    parser.feed('data: {"text":"hello"}\n\n');

    expect(onEvent).toHaveBeenCalledWith('message', { text: 'hello' });
  });
});
