import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords';

describe('passwords', () => {
  it('hashes with argon2id at the OWASP minimum cost', async () => {
    const h = await hashPassword('secret-pass');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).toContain('m=19456,t=2,p=1');
    expect(h).not.toContain('secret-pass');
  });
  it('uses a fresh salt every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
  it('verifies right and wrong passwords', async () => {
    const h = await hashPassword('right');
    expect(await verifyPassword(h, 'right')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword(h, '')).toBe(false);
  });
  it('returns false for a missing user, but still does the work', async () => {
    const t0 = performance.now();
    expect(await verifyPassword(null, 'anything')).toBe(false);
    expect(performance.now() - t0).toBeGreaterThan(1); // a real argon2 verification ran
  });
  it('never throws on a malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyPassword('', 'x')).toBe(false);
  });
});
