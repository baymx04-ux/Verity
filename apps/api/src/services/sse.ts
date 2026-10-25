/**
 * Server-Sent Events parser for upstream AI streams.
 *
 * Event and data lines can arrive split across network chunks, so the parser
 * keeps the in-flight `event:` name and data lines until a blank line closes the
 * frame.
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
      // Preserve non-JSON payloads (for example a provider error string).
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
      return; // comment/heartbeat
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
