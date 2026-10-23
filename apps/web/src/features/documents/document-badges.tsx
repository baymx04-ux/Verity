import { Badge } from '../../components/ui/badge';
import {
  ACCESS_LEVEL_LABELS,
  DOCUMENT_STATUS_LABELS,
  type AccessLevel,
  type DocumentStatus,
} from '../../types/documents';

const statusVariants: Record<DocumentStatus, 'verified' | 'info' | 'warning' | 'danger'> = {
  ready: 'verified',
  processing: 'info',
  queued: 'warning',
  failed: 'danger',
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <Badge variant={statusVariants[status]}>
      {status === 'ready' ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-verified" />
      ) : null}
      {DOCUMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

const accessVariants: Record<AccessLevel, 'info' | 'neutral' | 'warning'> = {
  public: 'info',
  internal: 'neutral',
  restricted: 'warning',
};

export function DocumentAccessBadge({ level }: { level: AccessLevel }) {
  return <Badge variant={accessVariants[level]}>{ACCESS_LEVEL_LABELS[level]}</Badge>;
}
