import type { Request } from 'express';

import type { Role } from '../auth/types';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  /** Group memberships, resolved per request for restricted-document access. */
  groupIds?: string[];
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  authToken?: string;
}

