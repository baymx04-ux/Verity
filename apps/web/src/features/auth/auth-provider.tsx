import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { apiFetch, refreshAccessToken } from '../../lib/api';
import { setAccessToken } from '../../lib/access-token';
import type { AuthUser, LoginResponse, Role } from '../../types/auth';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

interface MeUser {
  id: string;
  email: string;
  role: Role;
  first_name?: string | null;
  last_name?: string | null;
  is_active?: boolean;
}

function toAuthUser(user: MeUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    isActive: user.is_active ?? true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const loadCurrentUser = useCallback(async (): Promise<AuthUser> => {
    const body = await apiFetch<{ user: MeUser }>('/api/auth/me', undefined, {
      retryOnUnauthorized: false,
    });
    return toAuthUser(body.user);
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const token = await refreshAccessToken();

      if (!active) {
        return;
      }

      if (!token) {
        setStatus('unauthenticated');
        return;
      }

      try {
        const current = await loadCurrentUser();
        if (active) {
          setUser(current);
          setStatus('authenticated');
        }
      } catch {
        if (active) {
          setAccessToken(null);
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [loadCurrentUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const body = await apiFetch<LoginResponse>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
        { retryOnUnauthorized: false },
      );

      setAccessToken(body.accessToken);

      try {
        const current = await loadCurrentUser();
        setUser(current);
      } catch {
        setUser({ ...body.user, firstName: null, lastName: null, isActive: true });
      }

      setStatus('authenticated');
    },
    [loadCurrentUser],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch<{ ok: boolean }>(
        '/api/auth/logout',
        { method: 'POST' },
        { retryOnUnauthorized: false },
      );
    } catch {
      // A failed revocation must not strand the user in the signed-in shell.
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
