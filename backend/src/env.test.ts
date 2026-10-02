import { describe, expect, it } from 'vitest';
import { authConfig } from './auth/config';
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

describe('deployment switches', () => {
  it('TRUST_PROXY: false, true, or loopback only', () => {
    expect(loadEnv({}).TRUST_PROXY).toBe(false);
    expect(loadEnv({ TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadEnv({ TRUST_PROXY: 'loopback' }).TRUST_PROXY).toBe('loopback');
    expect(() => loadEnv({ TRUST_PROXY: '10.0.0.1' })).toThrow(/TRUST_PROXY/);
  });

  it('COOKIE_SECURE: auto follows NODE_ENV; true/false override it', () => {
    const secure = (e: Record<string, string>) => authConfig(loadEnv(e)).cookieSecure;
    expect(secure({ NODE_ENV: 'production' })).toBe(true);
    expect(secure({ NODE_ENV: 'development' })).toBe(false);
    expect(secure({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toBe(false);
    expect(secure({ NODE_ENV: 'development', COOKIE_SECURE: 'true' })).toBe(true);
    expect(authConfig(loadEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).cookieName).toBe(
      'boq_session',
    );
    expect(authConfig(loadEnv({ NODE_ENV: 'production' })).cookieName).toBe('__Host-boq_session');
  });
});
