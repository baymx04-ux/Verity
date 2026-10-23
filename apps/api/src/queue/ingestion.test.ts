import { describe, expect, it, vi } from 'vitest';

import { createIngestionJobId } from './ingestion';

describe('ingestion queue', () => {
  it('creates BullMQ-safe job ids without colons', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));

    const id = createIngestionJobId('11111111-1111-1111-1111-111111111111', 1);

    expect(id).toBe(`11111111-1111-1111-1111-111111111111-1-${Date.now()}`);
    expect(id).not.toContain(':');

    vi.useRealTimers();
  });
});
