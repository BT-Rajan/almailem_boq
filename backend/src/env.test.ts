import { describe, expect, it } from 'vitest';
import { loadEnv } from './config/env';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });
  it('coerces and splits values', () => {
    const env = loadEnv({ PORT: '8080', CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });
  it('fails on bad values and names the key', () => {
    expect(() => loadEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });
  it('never prints the rejected value (may be a secret)', () => {
    const attempt = () => loadEnv({ LOG_LEVEL: 'super-secret-value' });
    expect(attempt).toThrow(/LOG_LEVEL/);
    expect(attempt).not.toThrow(/super-secret-value/);
  });
  it('accepts mysql:// and mariadb:// database URLs and rejects others', () => {
    expect(loadEnv({ DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/boq' }).DATABASE_URL).toContain(
      'mysql://',
    );
    expect(loadEnv({ DATABASE_URL: 'mariadb://u:p@h/boq' }).DATABASE_URL).toContain('mariadb://');
    expect(loadEnv({}).DATABASE_URL).toBeUndefined();
    const attempt = () => loadEnv({ DATABASE_URL: 'postgres://u:topsecret@h/boq' });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).not.toThrow(/topsecret/);
  });
});
