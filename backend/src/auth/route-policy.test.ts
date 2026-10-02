import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadEnv } from '../config/env';

// These run without a database: the policy is enforced when routes are registered.
const fakePool = {} as Pool;
const make = () => buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), { pool: fakePool });

describe('route policy (deny by default)', () => {
  it('pins the exact public surface of the API', async () => {
    const app = await make();
    await app.ready();
    const publicRoutes = app.routeRegistry
      .filter((r) => r.public)
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(publicRoutes).toEqual(['GET /api/health', 'HEAD /api/health', 'POST /api/auth/login']);
  });

  it('refuses a route that is neither guarded nor marked public, at registration', async () => {
    const app = await make();
    expect(() => app.get('/api/oops', () => ({ leaked: true }))).toThrow(
      /\/api\/oops must use authenticate/,
    );
  });

  it('refuses an authenticated route that has no permission check', async () => {
    const app = await make();
    expect(() =>
      app.get('/api/oops', { onRequest: [app.guards.authenticate] }, () => ({})),
    ).toThrow(/must use authorize/);
  });

  it('accepts authenticate+authorize, and authenticatedOnly', async () => {
    const app = await make();
    app.get(
      '/api/a',
      { onRequest: [app.guards.authenticate, app.guards.authorize('report.view')] },
      () => ({}),
    );
    app.get(
      '/api/b',
      { onRequest: [app.guards.authenticate], config: { authenticatedOnly: true } },
      () => ({}),
    );
    await expect(app.ready()).resolves.toBeDefined();
  });

  it('refuses authorize() without authenticate()', async () => {
    const app = await make();
    expect(() =>
      app.get('/api/c', { onRequest: [app.guards.authorize('report.view')] }, () => ({})),
    ).toThrow(/must use authenticate/);
  });

  it('answers unauthenticated requests to guarded routes with 401 before touching the database', async () => {
    const app = await make();
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      ok: false,
      data: null,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });

  it('rejects cross-origin writes before any work is done', async () => {
    const app = await make();
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'a@b.co', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});
