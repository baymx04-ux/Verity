import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './composer';

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    question: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    isStreaming: false,
    mode: 'documents' as const,
    onModeChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<Composer {...props} />), props };
}

describe('Composer answer modes', () => {
  it('starts in Documents mode and switches to Data mode', async () => {
    const { props } = renderComposer();

    expect(screen.getByRole('button', { name: 'Documents' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Data' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByPlaceholderText(/about your documents/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(props.onModeChange).toHaveBeenCalledWith('sql');
  });

  it('describes the data-mode result contract and disables the switch while streaming', () => {
    renderComposer({ mode: 'sql', isStreaming: true });

    expect(screen.getByPlaceholderText(/Revenue by region/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only SQL and result table/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Documents' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Data' })).toBeDisabled();
  });

  it('submits with Enter but keeps Shift+Enter for a new line', async () => {
    const { props } = renderComposer({ question: 'Revenue by region?' });

    const input = screen.getByLabelText('Ask a question');
    await userEvent.type(input, '{shift>}{enter}{/shift}');
    expect(props.onSubmit).not.toHaveBeenCalled();

    await userEvent.type(input, '{enter}');
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
});
