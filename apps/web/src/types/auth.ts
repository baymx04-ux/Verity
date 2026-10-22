export type Role = 'admin' | 'analyst' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: SessionUser;
}
