import { ShieldCheck } from 'lucide-react';

import { Badge } from '../components/ui/badge';
import { AdminMetricsDashboard } from '../features/admin/admin-metrics-dashboard';
import { SchemaCatalogEditor } from '../features/admin/schema-catalog-editor';

export function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
          <span className="flex size-6 items-center justify-center rounded-[7px] border border-action-border bg-action-tint text-action">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
          </span>
          Workspace administration
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-display-lg text-ink-900">Admin</h1>
          <Badge variant="warning" dot>
            Admin only
          </Badge>
        </div>
        <p className="mt-1.5 max-w-2xl text-body-md leading-relaxed text-ink-500">
          Usage, quality signals, and the data catalog for workspace administrators.
        </p>
      </header>

      <div className="space-y-6">
        <AdminMetricsDashboard />
        <SchemaCatalogEditor />
      </div>
    </div>
  );
}
