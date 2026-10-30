import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, Citation } from './chat-api';
import { MessageItem } from './message-item';

const citation: Citation = {
  id: 'chunk-1',
  document_id: 'doc-1',
  title: 'Employee Handbook',
  page: 5,
  section: 'Leave policy',
  snippet: 'Employees receive 25 days of paid vacation annually.',
  score: 0.92,
};

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    conversation_id: 'conversation-1',
    role: 'assistant',
    content: 'Employees receive 25 days of paid vacation [1].',
    route: 'documents',
    citations: [citation],
    trace_id: 'trace-1234567890',
    latency_ms: 420,
    metadata: { answer_status: 'answered', low_confidence: false },
    created_at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderMessage(message: ChatMessage, overrides: Record<string, unknown> = {}) {
  return render(
    <MessageItem
      message={message}
      selectedCitationIndex={null}
      onSelectCitation={vi.fn()}
      onFeedback={vi.fn(async () => undefined)}
      userEmail="analyst@verity.dev"
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MessageItem citations', () => {
  it('renders inline citation chips that map to the retrieved source', async () => {
    const onSelectCitation = vi.fn();
    renderMessage(assistantMessage(), { onSelectCitation });

    const chip = screen.getByRole('button', { name: /\[1\]/i });
    expect(chip).toHaveAttribute('title', 'Employee Handbook · p. 5');

    await userEvent.click(chip);
    expect(onSelectCitation).toHaveBeenCalledWith(0);
  });

  it('keeps citation chips inline with list items and paragraphs', () => {
    renderMessage(
      assistantMessage({
        content: [
          'Verity provides a one-time stipend that can be used to purchase [1], [6]:',
          '',
          '- A desk [1]',
          '- A chair [1]',
          '',
          'Employees must keep receipts [1].',
        ].join('\n'),
        citations: [citation, { ...citation, id: 'chunk-6', page: 9 }],
      }),
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(within(item).getByRole('button', { name: /\[1\]/i })).toBeInTheDocument();
    }

    const paragraphs = screen.getAllByText(/Verity provides|Employees must keep/);
    expect(paragraphs).toHaveLength(2);
    expect(within(paragraphs[0]!).getByRole('button', { name: /\[6\]/i })).toBeInTheDocument();
  });

  it('labels a refusal honestly and does not claim attestation', () => {
    renderMessage(
      assistantMessage({
        content:
          "I don't have enough information to answer that from the documents you can access.",
        metadata: { answer_status: 'refused', low_confidence: true },
        citations: [],
      }),
    );

    expect(screen.getByText('Insufficient document evidence')).toBeInTheDocument();
    expect(screen.getByText('Insufficient evidence')).toBeInTheDocument();
    expect(screen.queryByText(/attested/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sha-256/i)).not.toBeInTheDocument();
  });

  it('shows a stopped partial answer', () => {
    renderMessage(
      assistantMessage({
        content: 'Employees receive',
        metadata: { answer_status: 'aborted', aborted: true },
      }),
    );

    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText(/Generation was stopped/)).toBeInTheDocument();
  });

  it('labels hybrid answers as combined evidence', () => {
    renderMessage(
      assistantMessage({
        route: 'hybrid',
        content: 'Returns are within the 5% target [1].',
      }),
    );

    expect(screen.getByText('Combined answer')).toBeInTheDocument();
    expect(screen.getByText('Docs + data')).toBeInTheDocument();
  });

  it('labels an out-of-scope steer-back without a refusal panel', () => {
    renderMessage(
      assistantMessage({
        route: 'out_of_scope',
        content:
          'I can help with questions about your company documents or business data. What would you like to know?',
        citations: [],
        metadata: { answer_status: 'out_of_scope', low_confidence: false },
      }),
    );

    expect(screen.getAllByText('Out of scope')).toHaveLength(2);
    expect(screen.queryByText('Insufficient document evidence')).not.toBeInTheDocument();
  });

  it('shows a saved acknowledgement after feedback succeeds', async () => {
    const onFeedback = vi.fn(async () => undefined);
    renderMessage(assistantMessage(), { onFeedback });

    const helpful = screen.getByRole('button', { name: 'Helpful answer' });
    await userEvent.click(helpful);

    expect(onFeedback).toHaveBeenCalledWith('message-1', 1, undefined);
    expect(await screen.findByRole('status')).toHaveTextContent('Feedback saved');
    expect(helpful).toHaveAttribute('aria-pressed', 'true');
  });

  it('rolls back the vote and explains a feedback failure', async () => {
    const onFeedback = vi.fn(async () => {
      throw new Error('Feedback service is unavailable.');
    });
    renderMessage(assistantMessage(), { onFeedback });

    const unhelpful = screen.getByRole('button', { name: 'Unhelpful answer' });
    await userEvent.click(unhelpful);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Feedback service is unavailable.',
    );
    expect(unhelpful).toHaveAttribute('aria-pressed', 'false');
  });

  it('copies the answer and exposes regenerate on the latest answer', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onRegenerate = vi.fn();

    renderMessage(assistantMessage(), { onRegenerate });

    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('Employees receive 25 days of paid vacation [1].');
    expect(await screen.findByText('Copied')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});
