import crypto from 'node:crypto';

export function cryptoRandom(): string {
  return crypto.randomBytes(16).toString('hex');
}
