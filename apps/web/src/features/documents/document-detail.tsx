import {
  AlertTriangle,
  Download,
  FileText,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import { Sheet } from '../../components/ui/sheet';
import type {
  AccessLevel,
  DocumentItem,
  GroupOption,
} from '../../types/documents';
import {
  ACCESS_LEVEL_LABELS,
  INGESTION_ERROR_LABELS,
  formatBytes,
  formatDate,
} from '../../types/documents';
import { DocumentAccessBadge, DocumentStatusBadge } from './document-badges';

interface DocumentDetailProps {
  document: DocumentItem | null;
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  canRetry: boolean;
  groups: GroupOption[];
  onDownload: (document: DocumentItem) => Promise<void>;
  onRetry: (document: DocumentItem) => Promise<void>;
  onUpdate: (
    document: DocumentItem,
    updates: { title?: string; access_level?: AccessLevel; group_ids?: string[] },
  ) => Promise<void>;
  onDelete: (document: DocumentItem) => Promise<void>;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-body-sm text-ink-500">{label}</dt>
      <dd className="text-right text-body-sm text-ink-700">{value}</dd>
    </div>
  );
}

export function DocumentDetail({
  document,
  open,
  onClose,
  canEdit,
  canRetry,
  groups,
  onDownload,
  onRetry,
  onUpdate,
  onDelete,
}: DocumentDetailProps) {
  const [title, setTitle] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('internal');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'retry' | 'delete' | 'download' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!document) {
      return;
    }
    setTitle(document.title);
    setAccessLevel(document.access_level);
    setGroupIds((document.groups ?? []).map((group) => group.id));
    setConfirmDelete(false);
    setError(null);
  }, [document]);

  if (!document) {
    return null;
  }

  async function run(
    action: 'save' | 'retry' | 'delete' | 'download',
    task: () => Promise<void>,
  ): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      await task();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : 'The action could not be completed.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accessLevel === 'restricted' && groupIds.length === 0) {
      setError('Restricted documents need at least one group.');
      return;
    }

    await run('save', () =>
      onUpdate(document!, {
        title: title.trim() || document!.title,
        access_level: accessLevel,
        group_ids: accessLevel === 'restricted' ? groupIds : [],
      }),
    );
  }

  function toggleGroup(id: string) {
    setGroupIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  const errorCode = document.error_code;
  const errorLabel = errorCode ? (INGESTION_ERROR_LABELS[errorCode] ?? errorCode) : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={document.title}
      description={document.filename}
      side="right"
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run('download', () => onDownload(document!))}
          >
            <Download aria-hidden="true" className="size-4" />
            {busy === 'download' ? 'Preparing…' : 'Download'}
          </Button>
          {canRetry && document.status === 'failed' ? (
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => void run('retry', () => onRetry(document!))}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {busy === 'retry' ? 'Queueing…' : 'Retry'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <DocumentStatusBadge status={document.status} />
          <DocumentAccessBadge level={document.access_level} />
          {document.status === 'ready' ? (
            <span className="text-body-sm text-ink-500">
              {document.chunk_count.toLocaleString()} chunks indexed
            </span>
          ) : null}
        </div>

        {document.status === 'failed' ? (
          <Alert variant="danger" title={errorLabel ?? 'Ingestion failed'}>
            {document.error ?? 'The document could not be indexed. Retry to run it again.'}
            {errorCode ? (
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wide opacity-80">
                {errorCode}
              </p>
            ) : null}
          </Alert>
        ) : null}

        {document.status === 'queued' || document.status === 'processing' ? (
          <Alert variant="info" title="Indexing in progress">
            This panel updates automatically when the document becomes ready.
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="danger" title="Action failed">
            {error}
          </Alert>
        ) : null}

        <dl className="rounded-nested border border-line px-4">
          <MetaRow label="File type" value={document.mime_type || 'Unknown'} />
          <MetaRow label="Size" value={formatBytes(document.size_bytes)} />
          <MetaRow
            label="Pages"
            value={document.page_count > 0 ? String(document.page_count) : '—'}
          />
          <MetaRow label="Chunks" value={document.chunk_count.toLocaleString()} />
          <MetaRow label="Uploaded" value={formatDate(document.created_at)} />
          <MetaRow label="Updated" value={formatDate(document.updated_at)} />
        </dl>

        {document.access_level === 'restricted' ? (
          <div className="rounded-nested border border-line bg-surface-container-low px-4 py-3">
            <p className="flex items-center gap-1.5 text-label-sm uppercase tracking-[0.04em] text-ink-500">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Allowed groups
            </p>
            <p className="mt-1.5 text-body-md text-ink-700">
              {document.groups.length > 0
                ? document.groups.map((group) => group.name).join(', ')
                : 'No groups assigned — only admins can open this document.'}
            </p>
          </div>
        ) : null}

        {canEdit ? (
          <form className="space-y-4 border-t border-line pt-5" onSubmit={handleSave}>
            <div className="flex items-center gap-2">
              <FileText aria-hidden="true" className="size-4 text-ink-500" />
              <h3 className="font-display text-display-sm text-ink-900">Document settings</h3>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="detail-title">Title</Label>
              <Input
                id="detail-title"
                value={title}
                disabled={busy !== null}
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="detail-access">Access level</Label>
              <Select
                id="detail-access"
                value={accessLevel}
                disabled={busy !== null}
                onChange={(event) => setAccessLevel(event.target.value as AccessLevel)}
              >
                {(['public', 'internal', 'restricted'] as AccessLevel[]).map((level) => (
                  <option key={level} value={level}>
                    {ACCESS_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            </div>

            {accessLevel === 'restricted' ? (
              <fieldset className="space-y-2">
                <legend className="text-label-md text-ink-700">Allowed groups</legend>
                {groups.length === 0 ? (
                  <p className="text-body-sm text-ink-500">No groups exist yet.</p>
                ) : (
                  <div className="grid gap-2 rounded-nested border border-line p-3 sm:grid-cols-2">
                    {groups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 text-body-sm text-ink-700"
                      >
                        <Checkbox
                          checked={groupIds.includes(group.id)}
                          disabled={busy !== null}
                          onChange={() => toggleGroup(group.id)}
                        />
                        {group.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' ? 'Saving…' : 'Save changes'}
              </Button>

              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('delete', async () => {
                        await onDelete(document!);
                        onClose();
                      })
                    }
                  >
                    {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Delete
                </Button>
              )}
            </div>

            {confirmDelete ? (
              <p className="flex items-center gap-1.5 text-body-sm text-danger-text">
                <AlertTriangle aria-hidden="true" className="size-3.5" />
                This removes the file and all indexed chunks. It cannot be undone.
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </Sheet>
  );
}
