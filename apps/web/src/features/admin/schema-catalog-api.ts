import { apiFetch } from '../../lib/api';

export interface SchemaColumn {
  name: string;
  type: string;
  nullable?: boolean | undefined;
  description?: string | undefined;
  examples?: unknown[] | undefined;
  references?: { table: string; column: string } | undefined;
}

export interface SchemaCatalogView {
  id: string;
  view_name: string;
  qualified_name: string;
  description: string;
  columns: SchemaColumn[];
  introspected_at?: string | null;
  edited_at?: string | null;
  updated_at?: string | null;
}

export interface SchemaCatalogResponse {
  catalog: SchemaCatalogView[];
}

export interface SchemaCatalogPatch {
  description?: string | undefined;
  columns?:
    | Array<{
        name: string;
        description?: string | undefined;
        examples?: unknown[] | undefined;
      }>
    | undefined;
}

export function fetchSchemaCatalog(): Promise<SchemaCatalogResponse> {
  return apiFetch<SchemaCatalogResponse>('/api/admin/schema-catalog');
}

export function refreshSchemaCatalog(): Promise<{ refreshed: number; status: string }> {
  return apiFetch<{ refreshed: number; status: string }>('/api/admin/schema-catalog/refresh', {
    method: 'POST',
  });
}

export function updateSchemaCatalog(
  viewName: string,
  patch: SchemaCatalogPatch,
): Promise<{ updated: string; status: string }> {
  return apiFetch<{ updated: string; status: string }>(
    `/api/admin/schema-catalog/${encodeURIComponent(viewName)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}
