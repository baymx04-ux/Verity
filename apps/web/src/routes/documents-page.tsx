import { FileText, Upload } from 'lucide-react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { Tooltip } from '../components/ui/tooltip';

export function DocumentsPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-display-lg text-ink-900">Documents</h1>
            <Badge variant="neutral">Phase 2</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-body-md text-ink-500">
            Upload, parse, and index the source material Verity is allowed to cite.
          </p>
        </div>
        <Tooltip label="Uploads arrive with ingestion">
          <span>
            <Button disabled>
              <Upload aria-hidden="true" className="size-4" />
              Upload document
            </Button>
          </span>
        </Tooltip>
      </header>

      <EmptyState
        className="min-h-[22rem] bg-surface"
        icon={<FileText aria-hidden="true" />}
        title="No documents indexed yet"
        description="Ingestion, chunking, embeddings, and document-level access control arrive in Phase 2. Nothing is searchable until a document has been processed."
        action={<Badge variant="warning">Ingestion not connected</Badge>}
      />
    </div>
  );
}
