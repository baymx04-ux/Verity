import { Tag } from '../../components/ui/tag';
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
  return <Tag variant={statusVariants[status]}>{DOCUMENT_STATUS_LABELS[status]}</Tag>;
}

const accessVariants: Record<AccessLevel, 'info' | 'neutral' | 'warning'> = {
  public: 'info',
  internal: 'neutral',
  restricted: 'warning',
};

export function DocumentAccessBadge({ level }: { level: AccessLevel }) {
  return <Tag variant={accessVariants[level]}>{ACCESS_LEVEL_LABELS[level]}</Tag>;
}
