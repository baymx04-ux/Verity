import type { Request } from 'express';

import type { Role } from '../auth/types';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  authToken?: string;
}
