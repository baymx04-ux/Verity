import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { FullPageLoader } from '../../components/layout/full-page-loader';
import { sanitizeRedirectUrl } from '../../lib/redirect';
import type { Role } from '../../types/auth';
import { useAuth } from './use-auth';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageLoader label="Restoring your session" />;
  }

  if (status === 'unauthenticated') {
    const fullPath = `${location.pathname}${location.search}${location.hash}`;
    const destination = sanitizeRedirectUrl(fullPath);
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(destination)}`}
        replace
        state={{ from: destination }}
      />
    );
  }

  return <Outlet />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-card border border-line bg-surface p-8 shadow-xs">
          <p className="text-label-sm uppercase tracking-[0.04em] text-danger-text">
            Access restricted
          </p>
          <h1 className="mt-2 font-display text-display-md text-ink-900">
            This area needs a different role
          </h1>
          <p className="mt-2 text-body-md text-ink-500">
            Your account does not have permission to open this page. If you think that is wrong, ask
            a workspace administrator to review your role.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
