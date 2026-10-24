import { FileText, FileUp, UploadCloud } from 'lucide-react';
import { type DragEvent, type FormEvent, useEffect, useState } from 'react';

import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select } from '../../components/ui/select';
import type { AccessLevel, GroupOption } from '../../types/documents';
import { formatBytes } from '../../types/documents';

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'markdown', 'html', 'htm'];

export interface UploadRequest {
  file: File;
  title?: string;
  accessLevel: AccessLevel;
  groupIds?: string[];
}

export interface UploadEvents {
  onProgress: (index: number, percent: number) => void;
  onComplete: (index: number) => void;
  onError: (index: number, message: string) => void;
}

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  canManageAccess: boolean;
  groups: GroupOption[];
  onUpload: (inputs: UploadRequest[], events: UploadEvents) => Promise<void>;
}

interface UploadEntry {
  id: string;
  file: File;
  progress: number | null;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error: string | null;
}

function validateFile(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return `${file.name}: choose a PDF, DOCX, TXT, MD, or HTML document.`;
  }
  if (file.size <= 0) {
    return `${file.name}: that file is empty.`;
  }
  if (file.size > MAX_BYTES) {
    return `${file.name}: ${formatBytes(file.size)} exceeds the 25 MB limit.`;
  }
  return null;
}

function entryId(file: File, index: number): string {
  return `${index}-${file.name}-${file.size}-${file.lastModified}`;
}

function baseTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The document could not be uploaded.';
}

export function UploadDialog({
  open,
  onClose,
  canManageAccess,
  groups,
  onUpload,
}: UploadDialogProps) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [title, setTitle] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('internal');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setEntries([]);
      setTitle('');
      setAccessLevel('internal');
      setGroupIds([]);
      setDragging(false);
      setBusy(false);
      setError(null);
      setValidationErrors([]);
    }
  }, [open]);

  function chooseFiles(files: File[]): void {
    setError(null);

    if (files.length === 0) {
      return;
    }

    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const validation = validateFile(file);
      if (validation) {
        rejected.push(validation);
      } else {
        accepted.push(file);
      }
    }

    setValidationErrors(rejected);

    if (accepted.length === 0) {
      return;
    }

    setEntries(
      accepted.map((file, index) => ({
        id: entryId(file, index),
        file,
        progress: null,
        status: 'pending',
        error: null,
      })),
    );

    // A shared title only makes sense for one file. With multiple files each
    // document keeps its own filename-derived title.
    if (accepted.length === 1 && !title.trim()) {
      setTitle(baseTitle(accepted[0]!.name));
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFiles(Array.from(event.dataTransfer.files));
  }

  function toggleGroup(id: string) {
    setGroupIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function updateEntry(id: string, patch: Partial<UploadEntry>): void {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Retrying after a partial failure only re-sends the files that did not
    // finish, so a successful upload is never duplicated.
    const pending = entries.filter((entry) => entry.status !== 'done');

    if (pending.length === 0) {
      onClose();
      return;
    }
    if (canManageAccess && accessLevel === 'restricted' && groupIds.length === 0) {
      setError('Restricted documents need at least one group.');
      return;
    }

    setBusy(true);
    for (const entry of pending) {
      updateEntry(entry.id, { status: 'uploading', progress: 0, error: null });
    }

    const single = pending.length === 1;

    try {
      await onUpload(
        pending.map((entry) => ({
          file: entry.file,
          ...(single && title.trim() ? { title: title.trim() } : {}),
          accessLevel: canManageAccess ? accessLevel : 'internal',
          ...(canManageAccess && accessLevel === 'restricted' ? { groupIds } : {}),
        })),
        {
          onProgress: (index, percent) => {
            const entry = pending[index];
            if (entry) {
              updateEntry(entry.id, { progress: percent, status: 'uploading' });
            }
          },
          onComplete: (index) => {
            const entry = pending[index];
            if (entry) {
              updateEntry(entry.id, { progress: 100, status: 'done', error: null });
            }
          },
          onError: (index, message) => {
            const entry = pending[index];
            if (entry) {
              updateEntry(entry.id, { status: 'error', error: message });
            }
          },
        },
      );
      onClose();
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setBusy(false);
    }
  }

  const singleEntry = entries.length === 1 ? entries[0]! : null;
  const totalBytes = entries.reduce((total, entry) => total + entry.file.size, 0);
  const fileSummary =
    entries.length > 0
      ? `${formatBytes(totalBytes)} · ready to upload`
      : 'PDF, DOCX, TXT, MD, or HTML up to 25 MB each. Select several files at once.';

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      title="Upload documents"
      description="Verity parses and indexes each file before it becomes searchable."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="upload-document" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload and index'}
          </Button>
        </>
      }
    >
      <form id="upload-document" className="space-y-4" onSubmit={handleSubmit}>
        {!canManageAccess ? (
          <Alert variant="info" title="Upload visibility">
            Analyst uploads are indexed as internal documents. An admin can change access later.
          </Alert>
        ) : null}

        <label
          htmlFor="document-file"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-nested border border-dashed px-5 py-8 text-center transition-colors ${
            dragging
              ? 'border-action-accent bg-action-tint'
              : 'border-line-strong bg-surface-container-low hover:border-action-accent hover:bg-action-tint/50'
          }`}
        >
          <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-surface text-action shadow-xs">
            {entries.length > 0 ? (
              <FileUp aria-hidden="true" className="size-5" />
            ) : (
              <UploadCloud aria-hidden="true" className="size-5" />
            )}
          </span>
          <span className="text-label-md text-ink-900">
            {singleEntry
              ? singleEntry.file.name
              : entries.length > 1
                ? `${entries.length} files selected`
                : 'Drop documents here, or choose files'}
          </span>
          <span className="mt-1 text-body-sm text-ink-500">{fileSummary}</span>
          <input
            id="document-file"
            type="file"
            multiple
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm"
            disabled={busy}
            onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
          />
        </label>

        {entries.length > 1 ? (
          <ul className="max-h-48 space-y-2 overflow-y-auto" aria-live="polite">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-nested border border-line bg-surface px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink-700">
                    {entry.file.name}
                  </span>
                  <span className="shrink-0 text-body-sm tabular text-ink-500">
                    {entry.status === 'error'
                      ? 'Failed'
                      : entry.status === 'done'
                        ? 'Uploaded'
                        : entry.progress !== null
                          ? `${entry.progress}%`
                          : formatBytes(entry.file.size)}
                  </span>
                </div>
                {entry.progress !== null && entry.status !== 'done' ? (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={entry.progress}
                    aria-label={`Upload progress for ${entry.file.name}`}
                    className="mt-2 h-1 overflow-hidden rounded-full bg-inset"
                  >
                    <div
                      className="h-full rounded-full bg-action transition-[width] duration-200"
                      style={{ width: `${entry.progress}%` }}
                    />
                  </div>
                ) : null}
                {entry.error ? (
                  <p className="mt-1 text-body-sm text-danger-text">{entry.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {singleEntry && singleEntry.progress !== null ? (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex items-center justify-between text-body-sm text-ink-500">
              <span>Uploading</span>
              <span className="tabular">{singleEntry.progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={singleEntry.progress}
              aria-label="Upload progress"
              className="h-1.5 overflow-hidden rounded-full bg-inset"
            >
              <div
                className="h-full rounded-full bg-action transition-[width] duration-200"
                style={{ width: `${singleEntry.progress}%` }}
              />
            </div>
            <p className="text-body-sm text-ink-500">
              Keep this open. Indexing can take a moment after the upload completes.
            </p>
          </div>
        ) : null}

        {singleEntry ? (
          <div className="space-y-1.5">
            <Label htmlFor="document-title">Title</Label>
            <Input
              id="document-title"
              value={title}
              maxLength={500}
              disabled={busy}
              placeholder="Defaults to the filename"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        ) : entries.length > 1 ? (
          <p className="text-body-sm text-ink-500">
            Each document keeps its filename as the title. Rename them from the detail panel after
            indexing.
          </p>
        ) : null}

        {canManageAccess ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="document-access">Access level</Label>
              <Select
                id="document-access"
                value={accessLevel}
                disabled={busy}
                onChange={(event) => setAccessLevel(event.target.value as AccessLevel)}
              >
                <option value="public">Public — every role</option>
                <option value="internal">Internal — analysts and admins</option>
                <option value="restricted">Restricted — selected groups</option>
              </Select>
            </div>

            {accessLevel === 'restricted' ? (
              <fieldset className="space-y-2">
                <legend className="text-label-md text-ink-700">Allowed groups</legend>
                {groups.length === 0 ? (
                  <p className="text-body-sm text-ink-500">
                    No groups exist yet. Create a group before restricting this document.
                  </p>
                ) : (
                  <div className="grid gap-2 rounded-nested border border-line p-3 sm:grid-cols-2">
                    {groups.map((group) => (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 text-body-sm text-ink-700"
                      >
                        <Checkbox
                          checked={groupIds.includes(group.id)}
                          disabled={busy}
                          onChange={() => toggleGroup(group.id)}
                        />
                        {group.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            ) : null}
          </>
        ) : null}

        {validationErrors.length > 0 ? (
          <Alert variant="danger" title="Some files were not accepted">
            <ul className="list-disc space-y-1 pl-4">
              {validationErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="danger" title="Upload failed">
            {error}
          </Alert>
        ) : null}
      </form>
    </Dialog>
  );
}
