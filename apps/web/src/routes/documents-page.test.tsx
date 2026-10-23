import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '../features/auth/auth-context';
import { setAccessToken } from '../lib/access-token';
import type { DocumentItem } from '../types/documents';
import { DocumentsPage } from './documents-page';

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

function documentFixture(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    id: 'doc-1',
    owner_id: 'user-admin',
    title: 'Security handbook',
    filename: 'security-handbook.pdf',
    mime_type: 'application/pdf',
    size_bytes: 2048,
    storage_key: 'documents/security-handbook.pdf',
    access_level: 'internal',
    status: 'ready',
    error: null,
    error_code: null,
    page_count: 4,
    chunk_count: 12,
    groups: [],
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:01:00.000Z',
    ...overrides,
  };
}

const groups = [
  { id: 'group-1', name: 'finance', description: 'Finance', document_count: 2 },
  { id: 'group-2', name: 'people', description: 'People', document_count: 0 },
];

function renderPage(role: 'admin' | 'analyst' | 'viewer' = 'admin') {
  const value: AuthContextValue = {
    status: 'authenticated',
    user: {
      id: `user-${role}`,
      email: `${role}@verity.dev`,
      role,
      firstName: role,
      lastName: 'User',
      isActive: true,
    },
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  };

  return render(
    <AuthContext.Provider value={value}>
      <DocumentsPage />
    </AuthContext.Provider>,
  );
}

function documentHandler(documents: DocumentItem[]) {
  return (url: string, init?: RequestInit): Response | undefined => {
    if (url.startsWith('/api/admin/groups')) {
      return json(200, { groups });
    }
    if (url.startsWith('/api/documents?') && (!init?.method || init.method === 'GET')) {
      return json(200, {
        documents,
        total: documents.length,
        page: 1,
        limit: 20,
      });
    }
    return undefined;
  };
}

beforeEach(() => {
  setAccessToken('test-access-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('Documents page', () => {
  it('lists accessible documents and opens the admin detail panel', async () => {
    const user = userEvent.setup();
    stubFetch(documentHandler([documentFixture()]));

    renderPage('admin');

    expect(await screen.findByRole('button', { name: 'Security handbook' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: 'Security handbook' }).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Ready')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Internal')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('12')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Security handbook' }));

    expect(
      await screen.findByRole('heading', { name: 'Document settings' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Access level')).toHaveValue('internal');
  });

  it('hides upload and access editing from viewers', async () => {
    const user = userEvent.setup();
    stubFetch(documentHandler([documentFixture()]));

    renderPage('viewer');

    expect(await screen.findByRole('button', { name: 'Security handbook' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload document/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Security handbook' }));

    expect(
      await screen.findByRole('heading', { name: 'Security handbook' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Document settings' })).not.toBeInTheDocument();
  });

  it('applies search and status filters through the API query', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch((url) => {
      if (url.startsWith('/api/admin/groups')) {
        return json(200, { groups });
      }
      if (url.startsWith('/api/documents?')) {
        return json(200, {
          documents: [documentFixture({ title: 'Policy digest', filename: 'policy.md' })],
          total: 1,
          page: 1,
          limit: 20,
        });
      }
    });

    renderPage('admin');

    await screen.findByRole('button', { name: 'Policy digest' });

    await user.type(screen.getByLabelText('Search documents'), 'policy');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents?search=policy&page=1&limit=20',
        expect.anything(),
      ),
    );

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'failed');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents?status=failed&search=policy&page=1&limit=20',
        expect.anything(),
      ),
    );

    expect(await screen.findByText('Active filters')).toBeInTheDocument();
  });

  it('saves an access change from the detail panel', async () => {
    const user = userEvent.setup();
    const document = documentFixture();
    const fetchMock = stubFetch((url, init) => {
      if (url.startsWith('/api/admin/groups')) {
        return json(200, { groups });
      }
      if (url === '/api/documents/doc-1' && init?.method === 'PATCH') {
        return json(200, {
          document: { ...document, access_level: 'restricted', groups: [groups[0]] },
        });
      }
      if (url.startsWith('/api/documents?')) {
        return json(200, { documents: [document], total: 1, page: 1, limit: 20 });
      }
    });

    renderPage('admin');

    await user.click(await screen.findByRole('button', { name: 'Open Security handbook' }));
    await screen.findByRole('heading', { name: 'Document settings' });

    await user.selectOptions(screen.getByLabelText('Access level'), 'restricted');
    await user.click(screen.getByLabelText('finance'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents/doc-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            title: 'Security handbook',
            access_level: 'restricted',
            group_ids: ['group-1'],
          }),
        }),
      ),
    );
  });

  it('validates restricted uploads before sending the file', async () => {
    const user = userEvent.setup();
    stubFetch(documentHandler([]));

    renderPage('admin');

    await user.click(await screen.findByRole('button', { name: /Upload document/ }));

    const input = screen.getByLabelText(/Drop a document here/);
    await user.upload(input, new File(['policy body'], 'policy.pdf', { type: 'application/pdf' }));

    await user.selectOptions(screen.getByLabelText('Access level'), 'restricted');
    await user.click(screen.getByRole('button', { name: 'Upload and index' }));

    expect(
      await screen.findByText('Restricted documents need at least one group.'),
    ).toBeInTheDocument();
  });

  it('uploads with progress and refreshes the list', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(documentHandler([documentFixture()]));

    class FakeXhr {
      static instances: FakeXhr[] = [];

      upload = {
        listeners: {} as Record<string, (event: ProgressEvent) => void>,
        addEventListener: (type: string, listener: (event: ProgressEvent) => void) => {
          this.upload.listeners[type] = listener;
        },
      };

      listeners: Record<string, () => void> = {};
      status = 0;
      responseText = '';
      responseType = '';

      constructor() {
        FakeXhr.instances.push(this);
      }

      open() {
        // no-op
      }

      setRequestHeader() {
        // no-op
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners[type] = listener;
      }

      send() {
        this.upload.listeners.progress?.({
          lengthComputable: true,
          loaded: 50,
          total: 100,
        } as ProgressEvent);
        window.setTimeout(() => {
          this.status = 201;
          this.responseText = JSON.stringify({
            document: documentFixture({ id: 'doc-2', title: 'Policy digest', status: 'queued' }),
          });
          this.listeners.load?.();
        }, 0);
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    renderPage('admin');

    await user.click(await screen.findByRole('button', { name: /Upload document/ }));

    const input = screen.getByLabelText(/Drop a document here/);
    await user.upload(
      input,
      new File(['new policy body'], 'policy.md', { type: 'text/markdown' }),
    );
    await user.selectOptions(screen.getByLabelText('Access level'), 'internal');
    await user.click(screen.getByRole('button', { name: 'Upload and index' }));

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Upload document' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/documents?')))
        .toHaveLength(2),
    );
  });

  it('deletes a document after confirmation', async () => {
    const user = userEvent.setup();
    let documents = [documentFixture()];
    const fetchMock = stubFetch((url, init) => {
      if (url.startsWith('/api/admin/groups')) {
        return json(200, { groups });
      }
      if (url === '/api/documents/doc-1' && init?.method === 'DELETE') {
        documents = [];
        return json(200, { success: true });
      }
      if (url.startsWith('/api/documents?')) {
        return json(200, {
          documents,
          total: documents.length,
          page: 1,
          limit: 20,
        });
      }
    });

    renderPage('admin');

    await user.click(await screen.findByRole('button', { name: 'Open Security handbook' }));
    await screen.findByRole('heading', { name: 'Document settings' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents/doc-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(await screen.findByText('No documents indexed yet')).toBeInTheDocument();
  });
});
