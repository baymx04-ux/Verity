import {
  ChevronRight,
  Download,
  FileSearch,
  FileText,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { IconButton } from '../components/ui/icon-button';
import { Input } from '../components/ui/input';
import { Pagination } from '../components/ui/pagination';
import { Select } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../components/ui/table';
import { useAuth } from '../features/auth/use-auth';
import {
  deleteDocument,
  getDocumentDownloadUrl,
  listDocuments,
  listGroups,
  retryDocument,
  updateDocument,
  uploadDocument,
} from '../features/documents/document-api';
import { DocumentAccessBadge, DocumentStatusBadge } from '../features/documents/document-badges';

function useCompactViewport(): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return matches;
}
import { DocumentDetail } from '../features/documents/document-detail';
import {
  UploadDialog,
  type UploadEvents,
  type UploadRequest,
} from '../features/documents/upload-dialog';
import type {
  AccessLevel,
  DocumentFilters,
  DocumentItem,
  DocumentStatus,
  GroupOption,
} from '../types/documents';
import { formatBytes, formatDate } from '../types/documents';

const PAGE_SIZE = 20;

interface QueryState {
  status: DocumentStatus | '';
  accessLevel: AccessLevel | '';
  search: string;
  page: number;
}

const INITIAL_QUERY: QueryState = { status: '', accessLevel: '', search: '', page: 1 };

export function DocumentsPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'viewer';
  const canUpload = role === 'admin' || role === 'analyst';
  const canManageAccess = role === 'admin';
  const isCompact = useCompactViewport();

  const [query, setQuery] = useState<QueryState>(INITIAL_QUERY);
  const [searchDraft, setSearchDraft] = useState('');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<DocumentItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [groups, setGroups] = useState<GroupOption[]>([]);

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    const filters: DocumentFilters = {
      page: query.page,
      limit: PAGE_SIZE,
      ...(query.status ? { status: query.status } : {}),
      ...(query.accessLevel ? { accessLevel: query.accessLevel } : {}),
      ...(query.search ? { search: query.search } : {}),
    };

    listDocuments(filters)
      .then((result) => {
        if (!active) {
          return;
        }
        setDocuments(result.documents);
        setTotal(result.total);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : 'The document library could not be loaded.',
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [query, reloadKey]);

  const hasActiveIngestion = documents.some(
    (document) => document.status === 'queued' || document.status === 'processing',
  );

  useEffect(() => {
    if (!hasActiveIngestion) {
      return;
    }

    let active = true;
    const interval = window.setInterval(() => {
      const filters: DocumentFilters = {
        page: query.page,
        limit: PAGE_SIZE,
        ...(query.status ? { status: query.status } : {}),
        ...(query.accessLevel ? { accessLevel: query.accessLevel } : {}),
        ...(query.search ? { search: query.search } : {}),
      };

      listDocuments(filters)
        .then((result) => {
          if (!active) {
            return;
          }
          setDocuments(result.documents);
          setTotal(result.total);
          setSelected((current) => {
            if (!current) {
              return current;
            }
            return result.documents.find((document) => document.id === current.id) ?? current;
          });
        })
        .catch(() => {
          // Polling is best-effort; the explicit refresh still surfaces errors.
        });
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [hasActiveIngestion, query]);

  useEffect(() => {
    if (!canManageAccess) {
      return;
    }

    let active = true;
    listGroups()
      .then((result) => {
        if (active) {
          setGroups(result);
        }
      })
      .catch(() => {
        // Group assignment is optional until the admin needs a restricted preset.
      });

    return () => {
      active = false;
    };
  }, [canManageAccess]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery((current) => ({ ...current, search: searchDraft.trim(), page: 1 }));
  }

  function clearFilters() {
    setSearchDraft('');
    setQuery(INITIAL_QUERY);
  }

  async function handleUpload(inputs: UploadRequest[], events: UploadEvents) {
    const failures: string[] = [];

    for (const [index, input] of inputs.entries()) {
      try {
        await uploadDocument({
          ...input,
          onProgress: (percent) => events.onProgress(index, percent),
        });
        events.onComplete(index);
      } catch (uploadError) {
        const message =
          uploadError instanceof Error
            ? uploadError.message
            : 'The document could not be uploaded.';
        failures.push(message);
        events.onError(index, message);
      }
    }

    if (inputs.length > failures.length) {
      setQuery((current) => ({ ...current, page: 1 }));
      refresh();
    }

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} of ${inputs.length} ${inputs.length === 1 ? 'file' : 'files'} could not be uploaded.`,
      );
    }
  }

  async function handleDownload(document: DocumentItem) {
    const { url } = await getDocumentDownloadUrl(document.id);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleRetry(document: DocumentItem) {
    const updated = await retryDocument(document.id);
    setSelected(updated);
    setDocuments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    refresh();
  }

  async function handleUpdate(
    document: DocumentItem,
    updates: { title?: string; access_level?: AccessLevel; group_ids?: string[] },
  ) {
    const updated = await updateDocument(document.id, updates);
    setSelected(updated);
    setDocuments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    refresh();
  }

  async function handleDelete(document: DocumentItem) {
    await deleteDocument(document.id);
    setSelected(null);
    setDetailOpen(false);
    refresh();
  }

  function openDetail(document: DocumentItem) {
    setSelected(document);
    setDetailOpen(true);
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(query.status || query.accessLevel || query.search);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            <span className="flex size-6 items-center justify-center rounded-[7px] border border-action-border bg-action-tint text-action">
              <FileText aria-hidden="true" className="size-3.5" />
            </span>
            Document repository
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-display-lg text-ink-900">Documents</h1>
            <Badge variant="neutral">{total.toLocaleString()} indexed sources</Badge>
          </div>
          <p className="mt-1.5 max-w-2xl text-body-md leading-relaxed text-ink-500">
            Upload policy, handbook, and product documents. Verity parses, chunks, and embeds each
            one so answers can cite it. Access grants are enforced for every reader.
          </p>
        </div>
        {canUpload ? (
          <Button size="lg" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden="true" className="size-4" />
            Upload document
          </Button>
        ) : null}
      </header>

      <section className="mb-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form className="flex flex-1 gap-2" onSubmit={applySearch}>
            <label htmlFor="document-search" className="sr-only">
              Search documents
            </label>
            <div className="relative flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
              />
              <Input
                id="document-search"
                value={searchDraft}
                placeholder="Search by title or filename"
                onChange={(event) => setSearchDraft(event.target.value)}
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={loading}>
              Search
            </Button>
          </form>

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <label htmlFor="status-filter" className="sr-only">
              Filter by status
            </label>
            <Select
              id="status-filter"
              className="min-w-36"
              value={query.status}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  status: event.target.value as DocumentStatus | '',
                  page: 1,
                }))
              }
            >
              <option value="">All statuses</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="queued">Queued</option>
              <option value="failed">Failed</option>
            </Select>

            <label htmlFor="access-filter" className="sr-only">
              Filter by access level
            </label>
            <Select
              id="access-filter"
              className="min-w-36"
              value={query.accessLevel}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  accessLevel: event.target.value as AccessLevel | '',
                  page: 1,
                }))
              }
            >
              <option value="">All access levels</option>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
              <option value="restricted">Restricted</option>
            </Select>
          </div>
        </div>

        {filtered ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              Active filters
            </span>
            {query.search ? <Badge variant="info">Title: {query.search}</Badge> : null}
            {query.status ? <Badge variant="neutral">{query.status}</Badge> : null}
            {query.accessLevel ? <Badge variant="neutral">{query.accessLevel}</Badge> : null}
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        ) : null}
      </section>

      {loadError ? (
        <Alert variant="danger" title="Could not load documents" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span>{loadError}</span>
            <Button size="sm" variant="secondary" onClick={refresh}>
              <RefreshCw aria-hidden="true" className="size-3.5" />
              Try again
            </Button>
          </div>
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-2 rounded-card border border-line bg-surface p-5 shadow-card">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <EmptyState
            className="min-h-[20rem]"
            icon={<FileSearch className="size-5 text-ink-400" aria-hidden="true" />}
            title={filtered ? 'No documents match these filters' : 'No documents indexed yet'}
            description={
              filtered
                ? 'Try a broader search or clear the active filters.'
                : canUpload
                  ? 'Upload a policy, handbook, or product document. Verity parses, chunks, and embeds it before it becomes citable.'
                  : 'Documents uploaded by an admin or analyst will appear here once they are indexed.'
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canUpload ? (
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload aria-hidden="true" className="size-4" />
                  Upload the first document
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {isCompact ? (
            <div className="divide-y divide-line">
              {documents.map((document) => (
                <article key={document.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-canvas-subtle text-action">
                      <FileText aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-label-md font-medium text-ink-900 transition-fluid hover:text-action hover:underline hover:underline-offset-2"
                        onClick={() => openDetail(document)}
                      >
                        {document.title}
                      </button>
                      <p className="truncate text-body-sm text-ink-500">
                        {document.filename} · {formatBytes(document.size_bytes)}
                      </p>
                      {document.status === 'failed' && document.error ? (
                        <p className="mt-0.5 line-clamp-2 text-body-sm text-danger-text">
                          {document.error}
                        </p>
                      ) : null}
                    </div>
                    <IconButton
                      aria-label={`Open ${document.title}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetail(document)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </IconButton>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <DocumentStatusBadge status={document.status} />
                    <DocumentAccessBadge level={document.access_level} />
                    {document.access_level === 'restricted' && document.groups.length > 0 ? (
                      <span className="text-[11px] text-ink-500">
                        {document.groups.map((group) => group.name).join(', ')}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-2.5">
                    <span className="text-[11px] text-ink-500">
                      {document.chunk_count.toLocaleString()} chunks ·{' '}
                      {formatDate(document.created_at)}
                    </span>
                    <IconButton
                      aria-label={`Download ${document.title}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDownload(document)}
                    >
                      <Download aria-hidden="true" />
                    </IconButton>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Document</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Access</TableHeaderCell>
                    <TableHeaderCell className="hidden md:table-cell">Chunks</TableHeaderCell>
                    <TableHeaderCell className="hidden lg:table-cell">Size</TableHeaderCell>
                    <TableHeaderCell className="hidden xl:table-cell">Uploaded</TableHeaderCell>
                    <TableHeaderCell className="w-24 text-right">Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="max-w-[24rem]">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-canvas-subtle text-action">
                            <FileText aria-hidden="true" className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="block max-w-full truncate text-left text-label-md font-medium text-ink-900 transition-fluid hover:text-action hover:underline hover:underline-offset-2"
                              onClick={() => openDetail(document)}
                            >
                              {document.title}
                            </button>
                            <p className="truncate text-body-sm text-ink-500">
                              {document.filename} · {formatBytes(document.size_bytes)}
                            </p>
                            {document.status === 'failed' && document.error ? (
                              <p className="truncate text-body-sm text-danger-text">
                                {document.error}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DocumentStatusBadge status={document.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <DocumentAccessBadge level={document.access_level} />
                          {document.access_level === 'restricted' && document.groups.length > 0 ? (
                            <span className="text-body-sm text-ink-500">
                              {document.groups.map((group) => group.name).join(', ')}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="tabular text-ink-600">
                          {document.chunk_count.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="tabular text-ink-600">
                          {formatBytes(document.size_bytes)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <span className="whitespace-nowrap text-ink-600">
                          {formatDate(document.created_at)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            aria-label={`Download ${document.title}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDownload(document)}
                          >
                            <Download aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            aria-label={`Open ${document.title}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => openDetail(document)}
                          >
                            <ChevronRight aria-hidden="true" />
                          </IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas-subtle/50 px-4 py-3">
            <p className="text-body-sm text-ink-500">
              Showing{' '}
              <span className="tabular font-medium text-ink-700">
                {(query.page - 1) * PAGE_SIZE + 1}–{Math.min(query.page * PAGE_SIZE, total)}
              </span>{' '}
              of <span className="tabular font-medium text-ink-700">{total.toLocaleString()}</span>
            </p>
            <Pagination
              page={query.page}
              pageCount={pageCount}
              onPageChange={(page) => setQuery((current) => ({ ...current, page }))}
            />
          </div>
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        canManageAccess={canManageAccess}
        groups={groups}
        onUpload={handleUpload}
      />

      <DocumentDetail
        document={selected}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        canEdit={canManageAccess}
        canRetry={canUpload}
        groups={groups}
        onDownload={handleDownload}
        onRetry={handleRetry}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
