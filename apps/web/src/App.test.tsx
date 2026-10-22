import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { setAccessToken } from './lib/access-token';

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

const adminUser = {
  id: 'user-admin',
  email: 'admin@verity.dev',
  role: 'admin',
  first_name: 'Ada',
  last_name: 'Admin',
  is_active: true,
};

beforeEach(() => {
  setAccessToken(null);
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('App auth experience', () => {
  it('redirects protected routes to the login screen when there is no session', async () => {
    window.history.pushState({}, '', '/chat');
    stubFetch((url) => {
      if (url === '/api/auth/refresh') {
        return json(401, { error: { code: 'unauthorized', message: 'Missing refresh token' } });
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toBeInTheDocument();
  });

  it('restores a session from the refresh cookie and renders the shell', async () => {
    window.history.pushState({}, '', '/chat');
    stubFetch((url) => {
      if (url === '/api/auth/refresh') {
        return json(200, { accessToken: 'access-token' });
      }
      if (url === '/api/auth/me') {
        return json(200, { user: adminUser });
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Ask Verity' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Admin/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('admin@verity.dev').length).toBeGreaterThan(0);
  });

  it('signs in and lands on the chat shell', async () => {
    window.history.pushState({}, '', '/login');
    const user = userEvent.setup();
    const fetchMock = stubFetch((url, init) => {
      if (url === '/api/auth/refresh') {
        return json(401, { error: { code: 'unauthorized', message: 'Missing refresh token' } });
      }
      if (url === '/api/auth/login' && init?.method === 'POST') {
        return json(200, {
          accessToken: 'access-token',
          user: { id: 'user-admin', email: 'admin@verity.dev', role: 'admin' },
        });
      }
      if (url === '/api/auth/me') {
        return json(200, { user: adminUser });
      }
    });

    render(<App />);

    await user.type(await screen.findByLabelText('Work email'), 'admin@verity.dev');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Ask Verity' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('blocks non-admins from the admin route', async () => {
    window.history.pushState({}, '', '/admin');
    stubFetch((url) => {
      if (url === '/api/auth/refresh') {
        return json(200, { accessToken: 'access-token' });
      }
      if (url === '/api/auth/me') {
        return json(200, {
          user: { ...adminUser, id: 'user-analyst', email: 'analyst@verity.dev', role: 'analyst' },
        });
      }
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /different role/i })).toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: /Admin/i })).toHaveLength(0);
  });

  it('shows a sign-in error for rejected credentials', async () => {
    window.history.pushState({}, '', '/login');
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url === '/api/auth/refresh') {
        return json(401, { error: { code: 'unauthorized', message: 'Missing refresh token' } });
      }
      if (url === '/api/auth/login') {
        return json(401, { error: { code: 'unauthorized', message: 'Invalid email or password' } });
      }
    });

    render(<App />);

    await user.type(await screen.findByLabelText('Work email'), 'admin@verity.dev');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/did not match an active account/i)).toBeInTheDocument();
  });
});
