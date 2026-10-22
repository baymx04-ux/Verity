import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function ipToHash(ip?: string): string | undefined {
  if (!ip) {
    return undefined;
  }

  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}
