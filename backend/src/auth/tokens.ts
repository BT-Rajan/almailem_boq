import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits from the OS CSPRNG, URL-safe. Used for session cookies and CSRF tokens. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** Only the hash of a session token is stored, so a database leak does not expose live sessions. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
