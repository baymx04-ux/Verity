export type Role = 'admin' | 'analyst' | 'viewer';

export const ROLES: Role[] = ['admin', 'analyst', 'viewer'];

export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (value === 'admin' || value === 'analyst' || value === 'viewer')
  );
}
