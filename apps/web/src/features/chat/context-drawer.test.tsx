import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Citation } from './chat-api';
import { ContextDrawer } from './context-drawer';

const citation: Citation = {
  id: 'chunk-1',
  document_id: 'doc-1',
  title: 'Employee Handbook',
  page: 5,
  section: 'Leave policy',
  snippet: 'Employees receive 25 days of paid vacation annually.',
  score: 0.92,
};

function renderDrawer(overrides: Record<string, unknown> = {}) {
  return render(
    <ContextDrawer
      citations={[citation]}
      selectedIndex={null}
      onSelectCitation={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ContextDrawer', () => {
  it('shows real citation metadata instead of a fabricated hash', () => {
    renderDrawer();

    expect(screen.getByText('Employee Handbook')).toBeInTheDocument();
    expect(screen.getByText(/p\.5/)).toBeInTheDocument();
    expect(screen.getByText(/Employees receive 25 days/)).toBeInTheDocument();
    // The relevance score is shown once per card: as the match pill in the header.
    expect(screen.getAllByText(/92%/)).toHaveLength(1);
    expect(screen.queryByText(/sha-256/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/checksum/i)).not.toBeInTheDocument();
  });

  it('opens a signed document URL through the provided handler', async () => {
    const onOpenDocument = vi.fn(async () => undefined);
    renderDrawer({ onOpenDocument });

    await userEvent.click(screen.getByRole('button', { name: /open document/i }));
    expect(onOpenDocument).toHaveBeenCalledWith('doc-1');
  });

  it('surfaces a recoverable error when the signed link fails', async () => {
    const onOpenDocument = vi.fn(async () => {
      throw new Error('nope');
    });
    renderDrawer({ onOpenDocument });

    await userEvent.click(screen.getByRole('button', { name: /open document/i }));

    expect(
      await screen.findByText('The signed document link could not be created. Please try again.'),
    ).toBeInTheDocument();
  });
});
