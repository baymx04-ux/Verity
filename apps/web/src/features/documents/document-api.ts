import { getAccessToken } from '../../lib/access-token';
import { ApiError, apiFetch, refreshAccessToken } from '../../lib/api';
import type {
  AccessLevel,
  DocumentFilters,
  DocumentItem,
  DocumentListResponse,
  GroupOption,
} from '../../types/documents';

interface UploadInput {
  file: File;
  title?: string;
  accessLevel: AccessLevel;
  groupIds?: string[];
  onProgress?: (percent: number) => void;
}

function documentQuery(filters: DocumentFilters): string {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.accessLevel) {
    params.set('access_level', filters.accessLevel);
  }
  if (filters.search?.trim()) {
    params.set('search', filters.search.trim());
  }
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 20));
  return params.toString();
}

export function listDocuments(filters: DocumentFilters = {}): Promise<DocumentListResponse> {
  return apiFetch<DocumentListResponse>(`/api/documents?${documentQuery(filters)}`);
}

function uploadOnce(input: UploadInput, token: string | null): Promise<{ document: DocumentItem }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/documents');
    request.responseType = 'text';
    request.setRequestHeader('Accept', 'application/json');
    if (token) {
      request.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        input.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    request.addEventListener('load', () => {
      let body: unknown;
      try {
        body = request.responseText ? JSON.parse(request.responseText) : undefined;
      } catch {
        body = undefined;
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(body as { document: DocumentItem });
        return;
      }

      const errorBody = body as { error?: { code?: string; message?: string } } | undefined;
      reject(
        new ApiError(
          request.status,
          errorBody?.error?.code ?? 'upload_failed',
          errorBody?.error?.message ?? 'The document could not be uploaded.',
        ),
      );
    });

    request.addEventListener('error', () => {
      reject(new ApiError(0, 'network_error', 'The upload could not reach the server.'));
    });

    request.addEventListener('abort', () => {
      reject(new ApiError(0, 'upload_cancelled', 'The upload was cancelled.'));
    });

    const form = new FormData();
    form.append('file', input.file);
    if (input.title?.trim()) {
      form.append('title', input.title.trim());
    }
    form.append('access_level', input.accessLevel);
    input.groupIds?.forEach((groupId) => form.append('group_ids', groupId));

    request.send(form);
  });
}

export async function uploadDocument(input: UploadInput): Promise<DocumentItem> {
  let token = getAccessToken();
  if (!token) {
    token = await refreshAccessToken();
  }

  try {
    const body = await uploadOnce(input, token);
    return body.document;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const body = await uploadOnce(input, refreshed);
        return body.document;
      }
    }
    throw error;
  }
}

export async function getDocumentDownloadUrl(
  id: string,
): Promise<{ url: string; expires_in_s: number }> {
  return apiFetch<{ url: string; expires_in_s: number }>(`/api/documents/${id}/file`);
}

export async function updateDocument(
  id: string,
  updates: { title?: string; access_level?: AccessLevel; group_ids?: string[] },
): Promise<DocumentItem> {
  const body = await apiFetch<{ document: DocumentItem }>(`/api/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return body.document;
}

export async function retryDocument(id: string): Promise<DocumentItem> {
  const body = await apiFetch<{ document: DocumentItem }>(`/api/documents/${id}/retry`, {
    method: 'POST',
  });
  return body.document;
}

export async function deleteDocument(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/documents/${id}`, { method: 'DELETE' });
}

export async function listGroups(): Promise<GroupOption[]> {
  const body = await apiFetch<{ groups: GroupOption[] }>('/api/admin/groups');
  return body.groups;
}
