/**
 * Minimal SSE parser. Event and data lines may be split across fetch chunks,
 * so the in-flight event name and data are retained until a blank line.
 */

export interface SseParser {
  feed: (chunk: string) => void;
  end: () => void;
}

export function createSseParser(onEvent: (event: string, data: unknown) => void): SseParser {
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = 'message';
      return;
    }

    const name = eventName;
    const raw = dataLines.join('\n');
    eventName = 'message';
    dataLines = [];

    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // Keep non-JSON payloads as text.
    }
    onEvent(name, data);
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) {
      return;
    }

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    },
    end() {
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = '';
      }
      dispatch();
    },
  };
}
