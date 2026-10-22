import { ShieldCheck, UserCog, UsersRound } from 'lucide-react';

import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useAuth } from '../features/auth/use-auth';

export function AdminPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-display-lg text-ink-900">Admin</h1>
            <Badge variant="verified">Admin only</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-body-md text-ink-500">
            Workspace administration for people, roles, and access.
          </p>
        </div>
        <Badge variant="neutral">Signed in as {user?.role}</Badge>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound aria-hidden="true" className="size-4 text-action" />
              Users
            </CardTitle>
            <CardDescription>List and inspect workspace accounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body-md text-ink-700">
              The authenticated API is ready at{' '}
              <code className="font-mono text-[12px]">GET /api/auth/users</code>.
            </p>
            <p className="mt-2 text-body-sm text-ink-500">
              The management UI lands with the admin phase.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog aria-hidden="true" className="size-4 text-action" />
              Roles
            </CardTitle>
            <CardDescription>Admin, analyst, and viewer.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body-md text-ink-700">
              Role changes are validated and audited server-side.
            </p>
            <p className="mt-2 text-body-sm text-ink-500">
              Patch endpoint: role changes are admin-only.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-4 text-action" />
              Access
            </CardTitle>
            <CardDescription>Enforced on every request.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-body-md text-ink-700">
              Route guards and the API both check the signed-in role.
            </p>
            <p className="mt-2 text-body-sm text-ink-500">
              Hidden navigation is not treated as a security boundary.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
