import { describe, expect, it, vi } from 'vitest';

import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('keeps the event name when the event and data lines arrive in different chunks', () => {
    const events: Array<[string, unknown]> = [];
    const parser = createSseParser((event, data) => events.push([event, data]));

    parser.feed('event: token\n');
    parser.feed('data: {"text":"hello"}\n\n');

    expect(events).toEqual([['token', { text: 'hello' }]]);
  });

  it('handles CRLF, comments, multi-line data, and a final frame without a blank line', () => {
    const events: Array<[string, unknown]> = [];
    const parser = createSseParser((event, data) => events.push([event, data]));

    parser.feed(': ping\r\n\r\n');
    parser.feed('event: note\r\ndata: first\r\ndata: second\r\n');
    parser.end();

    expect(events).toEqual([['note', 'first\nsecond']]);
  });

  it('resets the event name after each dispatch', () => {
    const events: Array<[string, unknown]> = [];
    const parser = createSseParser((event, data) => events.push([event, data]));

    parser.feed('event: route\ndata: {"route":"documents"}\n\n');
    parser.feed('data: {"text":"plain"}\n\n');

    expect(events).toEqual([
      ['route', { route: 'documents' }],
      ['message', { text: 'plain' }],
    ]);
  });

  it('ignores malformed JSON frames instead of throwing', () => {
    const onEvent = vi.fn();
    const parser = createSseParser(onEvent);

    expect(() => {
      parser.feed('event: token\ndata: not-json\n\n');
      parser.end();
    }).not.toThrow();

    expect(onEvent).toHaveBeenCalledWith('token', 'not-json');
  });
});
