import { FileUp, UploadCloud } from 'lucide-react';
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

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  canManageAccess: boolean;
  groups: GroupOption[];
  onUpload: (input: UploadRequest, onProgress: (percent: number) => void) => Promise<void>;
}

function validateFile(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_EXTENSIONS.includes(extension)) {
    return 'Choose a PDF, DOCX, TXT, MD, or HTML document.';
  }
  if (file.size <= 0) {
    return 'That file is empty.';
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is 25 MB.`;
  }
  return null;
}

export function UploadDialog({
  open,
  onClose,
  canManageAccess,
  groups,
  onUpload,
}: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('internal');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setTitle('');
      setAccessLevel('internal');
      setGroupIds([]);
      setDragging(false);
      setProgress(null);
      setError(null);
    }
  }, [open]);

  function chooseFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const validation = validateFile(next);
    if (validation) {
      setFile(null);
      setError(validation);
      return;
    }
    setFile(next);
    if (!title) {
      setTitle(next.name.replace(/\.[^.]+$/, ''));
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files.item(0));
  }

  function toggleGroup(id: string) {
    setGroupIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('Choose a document to upload.');
      return;
    }
    if (canManageAccess && accessLevel === 'restricted' && groupIds.length === 0) {
      setError('Restricted documents need at least one group.');
      return;
    }

    setProgress(0);
    try {
      await onUpload(
        {
          file,
          ...(title.trim() ? { title: title.trim() } : {}),
          accessLevel: canManageAccess ? accessLevel : 'internal',
          ...(canManageAccess && accessLevel === 'restricted' ? { groupIds } : {}),
        },
        setProgress,
      );
      onClose();
    } catch (uploadError) {
      setProgress(null);
      setError(
        uploadError instanceof Error ? uploadError.message : 'The document could not be uploaded.',
      );
    }
  }

  const busy = progress !== null;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      title="Upload document"
      description="Verity parses and indexes the file before it becomes searchable."
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
            {file ? (
              <FileUp aria-hidden="true" className="size-5" />
            ) : (
              <UploadCloud aria-hidden="true" className="size-5" />
            )}
          </span>
          <span className="text-label-md text-ink-900">
            {file ? file.name : 'Drop a document here, or choose a file'}
          </span>
          <span className="mt-1 text-body-sm text-ink-500">
            {file
              ? `${formatBytes(file.size)} · ready to upload`
              : 'PDF, DOCX, TXT, MD, or HTML up to 25 MB'}
          </span>
          <input
            id="document-file"
            type="file"
            className="sr-only"
            accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm"
            disabled={busy}
            onChange={(event) => chooseFile(event.target.files?.item(0) ?? null)}
          />
        </label>

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

        {progress !== null ? (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex items-center justify-between text-body-sm text-ink-500">
              <span>Uploading</span>
              <span className="tabular">{progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Upload progress"
              className="h-1.5 overflow-hidden rounded-full bg-inset"
            >
              <div
                className="h-full rounded-full bg-action transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-body-sm text-ink-500">
              Keep this open. Indexing can take a moment after the upload completes.
            </p>
          </div>
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
