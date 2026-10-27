import { CheckCircle2, Database, RefreshCw, Save, Table2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { Textarea } from '../../components/ui/textarea';
import {
  type SchemaCatalogView,
  type SchemaColumn,
  fetchSchemaCatalog,
  refreshSchemaCatalog,
  updateSchemaCatalog,
} from './schema-catalog-api';

interface DraftColumn extends SchemaColumn {
  examplesText: string;
}

interface Draft {
  description: string;
  columns: DraftColumn[];
}

function toDraft(view: SchemaCatalogView): Draft {
  return {
    description: view.description ?? '',
    columns: (view.columns ?? []).map((column) => ({
      ...column,
      description: column.description ?? '',
      examplesText: (column.examples ?? []).map(String).join(', '),
    })),
  };
}

function parseExamples(value: string): unknown[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const numeric = Number(item);
      return Number.isFinite(numeric) && item !== '' ? numeric : item;
    });
}

export function SchemaCatalogEditor() {
  const [views, setViews] = useState<SchemaCatalogView[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => views.find((view) => view.view_name === selectedName) ?? null,
    [selectedName, views],
  );

  const load = useCallback(async (preferredName?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchSchemaCatalog();
      setViews(response.catalog);
      const nextName =
        preferredName && response.catalog.some((view) => view.view_name === preferredName)
          ? preferredName
          : (response.catalog[0]?.view_name ?? null);
      setSelectedName(nextName);
      const nextView = response.catalog.find((view) => view.view_name === nextName);
      setDraft(nextView ? toDraft(nextView) : null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'The schema catalog could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectView = (view: SchemaCatalogView) => {
    setSelectedName(view.view_name);
    setDraft(toDraft(view));
    setError(null);
    setMessage(null);
  };

  const updateColumn = (name: string, patch: Partial<DraftColumn>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            columns: current.columns.map((column) =>
              column.name === name ? { ...column, ...patch } : column,
            ),
          }
        : current,
    );
  };

  const handleSave = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateSchemaCatalog(selected.view_name, {
        description: draft.description,
        columns: draft.columns.map((column) => {
          const patch: { name: string; description?: string; examples?: unknown[] } = {
            name: column.name,
          };
          if (column.description !== undefined) patch.description = column.description;
          patch.examples = parseExamples(column.examplesText);
          return patch;
        }),
      });
      setMessage(`Saved ${selected.qualified_name}. New descriptions will be used on the next data question.`);
      setViews((current) =>
        current.map((view) =>
          view.view_name === selected.view_name
            ? {
                ...view,
                description: draft.description,
                columns: draft.columns.map((column) => ({
                  name: column.name,
                  type: column.type,
                  nullable: column.nullable,
                  description: column.description,
                  examples: parseExamples(column.examplesText),
                  references: column.references,
                })),
                edited_at: new Date().toISOString(),
              }
            : view,
        ),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'The catalog edit could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await refreshSchemaCatalog();
      setMessage(`Re-introspected ${result.refreshed} views. Admin descriptions were preserved.`);
      await load(selectedName);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'The schema catalog could not be refreshed.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="mt-6 overflow-hidden rounded-card border border-line bg-surface shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <Database aria-hidden="true" className="size-4 text-action" />
            <h2 className="font-display text-display-xs text-ink-900">Text-to-SQL catalog</h2>
            <Badge variant="analyst">Admin editable</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-body-sm text-ink-500">
            Descriptions and example values ground the model in the read-only business views.
            Introspection never exposes the underlying tables or PII.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleRefresh()}
          disabled={refreshing || loading}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Refresh views'}
        </Button>
      </header>

      {error ? (
        <div className="px-4 pt-4 sm:px-5">
          <Alert variant="danger" title="Catalog request failed">
            <p>{error}</p>
          </Alert>
        </div>
      ) : null}

      {message ? (
        <div className="px-4 pt-4 sm:px-5">
          <Alert variant="success" title="Catalog updated">
            <p>{message}</p>
          </Alert>
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 text-body-sm text-ink-500">
          <Spinner label="Loading schema catalog" />
          Loading the read-only view catalog…
        </div>
      ) : views.length === 0 ? (
        <div className="px-4 py-10 text-center sm:px-5">
          <p className="text-body-md text-ink-700">No views have been catalogued yet.</p>
          <p className="mt-1 text-body-sm text-ink-500">
            Run migrations, load the business seed, then choose Refresh views.
          </p>
        </div>
      ) : (
        <div className="grid min-h-[32rem] md:grid-cols-[16rem_minmax(0,1fr)]">
          <nav
            aria-label="Business views"
            className="border-b border-line bg-surface-container-low p-2 md:border-b-0 md:border-r"
          >
            <div className="max-h-[36rem] space-y-1 overflow-y-auto md:max-h-[42rem]">
              {views.map((view) => {
                const active = view.view_name === selectedName;
                return (
                  <button
                    key={view.view_name}
                    type="button"
                    onClick={() => selectView(view)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-start gap-2 rounded-control px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'bg-surface text-ink-900 shadow-xs ring-1 ring-line'
                        : 'text-ink-600 hover:bg-surface hover:text-ink-900'
                    }`}
                  >
                    <Table2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-action" />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12px] font-medium">
                        {view.view_name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-400">
                        {view.columns?.length ?? 0} columns
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          {selected && draft ? (
            <div className="min-w-0 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-label-sm text-action">{selected.qualified_name}</p>
                  <p className="mt-1 text-body-sm text-ink-500">
                    {selected.edited_at ? 'Admin edits saved.' : 'Generated during introspection.'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? <Spinner label="Saving catalog" /> : <Save className="size-3.5" aria-hidden="true" />}
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>

              <label htmlFor="catalog-description" className="mt-5 block text-label-sm font-semibold text-ink-800">
                View description
              </label>
              <Textarea
                id="catalog-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, description: event.target.value } : current,
                  )
                }
                placeholder="Explain what this view contains and when the model should use it."
                className="mt-1.5 min-h-20"
              />

              <div className="mt-5 flex items-center justify-between gap-2">
                <h3 className="text-label-md font-semibold text-ink-900">
                  Columns
                  <span className="ml-2 font-normal text-ink-400">{draft.columns.length}</span>
                </h3>
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-400">
                  <CheckCircle2 aria-hidden="true" className="size-3" />
                  Read-only on the SQL role
                </span>
              </div>

              <div className="mt-2 space-y-3">
                {draft.columns.map((column) => (
                  <div
                    key={column.name}
                    className="rounded-nested border border-line bg-surface-container-low p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-[12px] font-semibold text-ink-900">
                        {column.name}
                      </code>
                      <Badge variant="neutral">{column.type}</Badge>
                      {column.nullable ? <span className="text-[11px] text-ink-400">nullable</span> : null}
                      {column.references ? (
                        <span className="text-[11px] text-emerald-700">
                          → {column.references.table}.{column.references.column}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_16rem]">
                      <label className="block">
                        <span className="sr-only">{`Description for ${column.name}`}</span>
                        <input
                          value={column.description ?? ''}
                          onChange={(event) =>
                            updateColumn(column.name, { description: event.target.value })
                          }
                          placeholder="What this column means…"
                          className="h-9 w-full rounded-control border border-line bg-surface px-2.5 text-body-sm text-ink-900 placeholder:text-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                        />
                      </label>
                      <label className="block">
                        <span className="sr-only">{`Example values for ${column.name}`}</span>
                        <input
                          value={column.examplesText}
                          onChange={(event) =>
                            updateColumn(column.name, { examplesText: event.target.value })
                          }
                          placeholder="Example values, comma-separated"
                          className="h-9 w-full rounded-control border border-line bg-surface px-2.5 text-body-sm text-ink-900 placeholder:text-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center p-6 text-body-sm text-ink-500">
              Select a view to edit its descriptions.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
