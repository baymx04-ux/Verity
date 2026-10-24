export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type AccessLevel = 'public' | 'internal' | 'restricted';

export interface DocumentGroup {
  id: string;
  name: string;
}

export interface DocumentItem {
  id: string;
  owner_id: string;
  title: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  access_level: AccessLevel;
  status: DocumentStatus;
  error: string | null;
  error_code: string | null;
  page_count: number;
  chunk_count: number;
  groups: DocumentGroup[];
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  documents: DocumentItem[];
  total: number;
  page: number;
  limit: number;
}

export interface GroupOption extends DocumentGroup {
  description?: string | null;
  document_count: number;
}

export interface DocumentFilters {
  status?: DocumentStatus | '';
  accessLevel?: AccessLevel | '';
  search?: string;
  page?: number;
  limit?: number;
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  public: 'Public',
  internal: 'Internal',
  restricted: 'Restricted',
};

export const INGESTION_ERROR_LABELS: Record<string, string> = {
  parse_error: 'The file could not be parsed',
  parse_timeout: 'Parsing timed out',
  embedding_error: 'Embedding generation failed',
  ai_unavailable: 'The ingestion service was unavailable',
  ai_unauthorized: 'The ingestion service rejected the request',
  queue_unavailable: 'The ingestion queue was unavailable',
  storage_error: 'The stored file could not be read',
  ingest_failed: 'Ingestion failed',
  timeout: 'Ingestion timed out',
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
