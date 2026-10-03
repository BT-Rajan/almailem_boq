import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadEnv } from '../config/env';

// These run without a database: the policy is enforced when routes are registered.
const fakePool = {} as Pool;
const make = () => buildApp(loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), { pool: fakePool });

/**
 * The reviewed access policy: every route, what it needs, and whether it is project-scoped.
 * A change here is a security change: it should be deliberate and visible in review.
 */
const POLICY: [string, string][] = [
  ['DELETE /api/admin/users/:userId/projects/:projectId', 'admin.users.manage'],
  ['DELETE /api/admin/users/:userId/roles/:roleId', 'admin.users.manage'],
  ['DELETE /api/projects/:projectId', 'admin.projects.delete + project member'],
  ['DELETE /api/projects/:projectId/expenses/:expenseId', 'admin.expenses.delete + project member'],
  ['DELETE /api/projects/:projectId/members/:userId', 'project.members.manage + project member'],
  ['GET /api/admin/approval-rules', 'admin.approvalrules.manage'],
  ['GET /api/admin/cost-heads', 'admin.costheads.manage'],
  ['GET /api/admin/projects', 'admin.users.manage'],
  ['GET /api/admin/roles', 'admin.roles.view'],
  ['GET /api/admin/users', 'admin.users.manage'],
  ['GET /api/admin/users/:userId', 'admin.users.manage'],
  ['GET /api/approvals', 'approval.decide'],
  ['GET /api/approvals/cost-structures', 'approval.decide'],
  ['GET /api/auth/me', 'signed-in'],
  ['GET /api/dashboard', 'project.view'],
  ['GET /api/health', 'public'],
  ['GET /api/projects', 'project.view'],
  ['GET /api/projects/:projectId', 'project.view + project member'],
  ['GET /api/projects/:projectId/boq', 'project.view + project member'],
  ['GET /api/projects/:projectId/cost-structure', 'project.view + project member'],
  ['GET /api/projects/:projectId/cost-heads/:costHeadId', 'expense.view + project member'],
  [
    'GET /api/projects/:projectId/cost-heads/:costHeadId/projection',
    'expense.create + project member',
  ],
  ['GET /api/projects/:projectId/expenses', 'expense.view + project member'],
  ['GET /api/projects/:projectId/expenses/:expenseId/attachment', 'expense.view + project member'],
  ['GET /api/projects/:projectId/members', 'project.view + project member'],
  ['GET /api/ready', 'public'],
  ['GET /api/search', 'project.view'],
  ['GET /api/users/lookup', 'project.members.manage'],
  ['PATCH /api/admin/cost-heads/:costHeadId', 'admin.costheads.manage'],
  ['PATCH /api/admin/users/:userId/status', 'admin.users.manage'],
  ['PATCH /api/projects/:projectId', 'project.edit + project member'],
  ['PATCH /api/projects/:projectId/expenses/:expenseId', 'expense.edit + project member'],
  ['POST /api/admin/cost-heads', 'admin.costheads.manage'],
  ['POST /api/admin/users', 'admin.users.manage'],
  ['POST /api/approvals/:approvalId/approve', 'approval.decide'],
  ['POST /api/approvals/:approvalId/reject', 'approval.decide'],
  ['POST /api/auth/login', 'public'],
  ['POST /api/auth/logout', 'signed-in'],
  ['POST /api/projects', 'project.create'],
  ['POST /api/projects/:projectId/cost-structure/proposals', 'estimate.edit + project member'],
  ['POST /api/projects/:projectId/expenses', 'expense.create + project member'],
  [
    'POST /api/projects/:projectId/expenses/:expenseId/cancel-approval',
    'approval.request + project member',
  ],
  ['POST /api/projects/:projectId/expenses/:expenseId/reverse', 'expense.reverse + project member'],
  ['POST /api/projects/:projectId/status', 'project.edit + project member'],
  ['PUT /api/admin/approval-rules', 'admin.approvalrules.manage'],
  ['PUT /api/admin/cost-heads/order', 'admin.costheads.manage'],
  ['PUT /api/admin/users/:userId/projects/:projectId', 'admin.users.manage'],
  ['PUT /api/admin/users/:userId/roles/:roleId', 'admin.users.manage'],
  ['PUT /api/projects/:projectId/estimates', 'approval.decide + project member'],
  ['PUT /api/projects/:projectId/expenses/:expenseId/attachment', 'expense.edit + project member'],
  ['PUT /api/projects/:projectId/members/:userId', 'project.members.manage + project member'],
];

describe('route policy (deny by default)', () => {
  it('matches the reviewed access policy, route for route', async () => {
    const app = await make();
    await app.ready();
    const actual = app.routeRegistry
      .filter((r) => r.method !== 'HEAD')
      .map((r): [string, string] => [
        `${r.method} ${r.url}`,
        `${r.public ? 'public' : r.permissions.join('+') || 'signed-in'}${r.projectParam ? ' + project member' : ''}`,
      ])
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(actual).toEqual([...POLICY].sort((a, b) => a[0].localeCompare(b[0])));
  });

  it('pins the exact public surface of the API', async () => {
    const app = await make();
    await app.ready();
    const publicRoutes = app.routeRegistry
      .filter((r) => r.public)
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(publicRoutes).toEqual([
      'GET /api/health',
      'GET /api/ready',
      'HEAD /api/health',
      'HEAD /api/ready',
      'POST /api/auth/login',
    ]);
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
