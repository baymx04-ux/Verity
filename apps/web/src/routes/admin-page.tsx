import { Badge } from '../components/ui/badge';
import { AdminMetricsDashboard } from '../features/admin/admin-metrics-dashboard';
import { SchemaCatalogEditor } from '../features/admin/schema-catalog-editor';
import { useAuth } from '../features/auth/use-auth';

export function AdminPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-display-lg text-ink-900">Admin</h1>
            <Badge variant="neutral">Admin only</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-body-md text-ink-500">
            Usage, quality signals, and the data catalog for workspace administrators.
          </p>
        </div>
        <Badge variant="neutral">Signed in as {user?.role}</Badge>
      </header>

      <AdminMetricsDashboard />

      <SchemaCatalogEditor />
    </div>
  );
}
