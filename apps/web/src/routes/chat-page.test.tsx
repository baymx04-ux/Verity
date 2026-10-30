import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../features/auth/auth-context';
import { setAccessToken } from '../lib/access-token';
import { ChatPage } from './chat-page';

type JsonBody = Record<string, unknown>;

function json(status: number, body: JsonBody): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | undefined) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return (
      handler(url, init) ?? json(404, { error: { code: 'not_found', message: 'Route not found' } })
    );
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

const mockConversations = [
  {
    id: 'conv-1',
    title: 'Q3 Earnings Review',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:05:00Z',
  },
  {
    id: 'conv-2',
    title: 'Employee Handbook Questions',
    created_at: '2026-10-02T10:00:00Z',
    updated_at: '2026-10-02T10:15:00Z',
  },
];

function renderChatPage() {
  const authValue: AuthContextValue = {
    status: 'authenticated',
    user: {
      id: 'user-admin',
      email: 'admin@verity.dev',
      role: 'admin',
      firstName: 'Ada',
      lastName: 'Admin',
      isActive: true,
    },
    login: async () => undefined,
    logout: async () => undefined,
  };

  return render(
    <AuthContext.Provider value={authValue}>
      <ChatPage />
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  setAccessToken('test-access-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatPage conversation deletion confirmation', () => {
  it('asks for confirmation when user clicks delete in conversation rail, and cancels cleanly', async () => {
    let conversations = [...mockConversations];
    const fetchMock = stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/conversations' && method === 'GET') {
        return json(200, { conversations });
      }
      if (url.startsWith('/api/conversations/') && url.endsWith('/messages')) {
        return json(200, { messages: [] });
      }
      if (url.startsWith('/api/conversations/') && method === 'DELETE') {
        const id = url.split('/').pop();
        conversations = conversations.filter((c) => c.id !== id);
        return json(200, { ok: true });
      }
    });

    const user = userEvent.setup();
    renderChatPage();

    // Verify conversations loaded into rail and header
    const titles = await screen.findAllByText('Q3 Earnings Review');
    expect(titles.length).toBeGreaterThan(0);

    // Click delete icon button for "Q3 Earnings Review"
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete Q3 Earnings Review' });
    await user.click(deleteButtons[0]!);

    // Confirmation dialog must appear
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Delete chat' })).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Are you sure you want to delete/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Q3 Earnings Review/)).toBeInTheDocument();

    // Verify DELETE was NOT called yet
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );

    // Click Cancel
    const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' });
    await user.click(cancelBtn);

    // Dialog closes
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Still not deleted
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getAllByText('Q3 Earnings Review').length).toBeGreaterThan(0);
  });

  it('permanently deletes conversation when confirmed in the dialog', async () => {
    let conversations = [...mockConversations];
    const fetchMock = stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/conversations' && method === 'GET') {
        return json(200, { conversations });
      }
      if (url.startsWith('/api/conversations/') && url.endsWith('/messages')) {
        return json(200, { messages: [] });
      }
      if (url.startsWith('/api/conversations/') && method === 'DELETE') {
        const id = url.split('/').pop();
        conversations = conversations.filter((c) => c.id !== id);
        return json(200, { ok: true });
      }
    });

    const user = userEvent.setup();
    renderChatPage();

    const titles = await screen.findAllByText('Q3 Earnings Review');
    expect(titles.length).toBeGreaterThan(0);

    // Click delete icon button in rail
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete Q3 Earnings Review' });
    await user.click(deleteButtons[0]!);

    // Dialog appears
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Click "Delete chat" in confirmation dialog
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete chat' });
    await user.click(confirmBtn);

    // DELETE request must be executed
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );

    // Dialog closes after deletion
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompts for confirmation from the active chat header delete button', async () => {
    let conversations = [...mockConversations];
    const fetchMock = stubFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/conversations' && method === 'GET') {
        return json(200, { conversations });
      }
      if (url.startsWith('/api/conversations/') && url.endsWith('/messages')) {
        return json(200, { messages: [] });
      }
      if (url.startsWith('/api/conversations/') && method === 'DELETE') {
        const id = url.split('/').pop();
        conversations = conversations.filter((c) => c.id !== id);
        return json(200, { ok: true });
      }
    });

    const user = userEvent.setup();
    renderChatPage();

    // Wait for active conversation title in header
    const titles = await screen.findAllByText('Q3 Earnings Review');
    expect(titles.length).toBeGreaterThan(0);

    // Click header delete button
    const headerDeleteBtn = screen.getByRole('button', { name: 'Delete chat' });
    await user.click(headerDeleteBtn);

    // Confirmation dialog opens
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Q3 Earnings Review/)).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete chat' });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/conv-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
