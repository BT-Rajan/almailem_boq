import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../db/testing';
import {
  costHeadsRepository,
  permissionsRepository,
  projectMembersRepository,
  projectsRepository,
  rolesRepository,
} from '../repositories';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';
import type { RouteInfo } from '../auth/types';

/**
 * Authorization matrix: every registered route x every role x member / non-member.
 * Expectations come from the routes' own guards (recorded at registration) and each user's real
 * permissions from the database, so a new route is covered without editing this file.
 * Allowed means "not 401/403" (the request may still fail validation or not find a record).
 */
const ROLES = ['Admin', 'Project Manager', 'Accountant', 'Viewer', null] as const;
type Actor = {
  label: string;
  session: Session;
  perms: Set<string>;
  member: boolean;
  userId: string;
};

describe.skipIf(!hasTestDb)('authorization matrix (real MariaDB)', () => {
  let fx: Fixture;
  let actors: Actor[];
  let routes: RouteInfo[];
  let ownerId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    fx = await createAuthFixture();
    const owner = await makeUser(fx, { roleName: 'Project Manager' });
    ownerId = owner.id;
    const project = await projectsRepository(fx.db.pool).create({
      code: 'MATRIX',
      name: 'Matrix',
      ownerUserId: owner.id,
      status: 'active',
    });
    await projectMembersRepository(fx.db.pool).add(project.id, owner.id);
    const head = await costHeadsRepository(fx.db.pool).create({ code: 'MX', name: 'Matrix head' });
    const ownerSession = await signIn(fx, owner.email);
    const expense = await fx.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/expenses`,
      headers: asUser(ownerSession, true),
      payload: {
        costHeadId: head.id,
        vendor: 'V',
        invoiceNo: 'I',
        expenseDate: '2026-01-01',
        amountFils: 1,
      },
    });
    const bystander = await makeUser(fx);
    Object.assign(ids, {
      projectId: project.id,
      costHeadId: head.id,
      expenseId: expense.json().data.id,
      userId: bystander.id, // admin and member routes act on this user, never on the caller
      roleId: (await rolesRepository(fx.db.pool).findByName('Viewer'))?.id as string,
    });

    actors = [];
    for (const role of ROLES)
      for (const member of [true, false]) {
        const u = await makeUser(fx, role ? { roleName: role } : {});
        if (member) await projectMembersRepository(fx.db.pool).add(project.id, u.id);
        actors.push({
          label: `${role ?? 'no role'} ${member ? 'member' : 'non-member'}`,
          session: await signIn(fx, u.email),
          perms: new Set(await permissionsRepository(fx.db.pool).listCodesForUser(u.id)),
          member,
          userId: u.id,
        });
      }
    routes = fx.app.routeRegistry.filter(
      (r) => !r.public && r.method !== 'HEAD' && r.url !== '/api/auth/logout', // logout ends the session under test
    );
  }, 120_000);
  afterAll(async () => {
    await fx.close();
  });

  const fill = (url: string, over: Record<string, string> = {}) =>
    url.replace(
      /:(\w+)/g,
      (_m, name: string) => over[name] ?? ids[name] ?? '00000000-0000-1000-8000-000000000000',
    );

  /** Deleting the project would end the matrix, so that route gets a fresh project each time. */
  async function urlFor(route: RouteInfo, actor: Actor): Promise<string> {
    if (route.method === 'DELETE' && route.url === '/api/projects/:projectId') {
      const p = await projectsRepository(fx.db.pool).create({
        code: `DEL-${Math.random().toString(36).slice(2, 10)}`,
        name: 'Throwaway',
        ownerUserId: ownerId,
        status: 'planned',
      });
      if (actor.member) await projectMembersRepository(fx.db.pool).add(p.id, actor.userId);
      return fill(route.url, { projectId: p.id });
    }
    return fill(route.url);
  }

  const call = (route: RouteInfo, url: string, s: Session | null) =>
    fx.app.inject({
      method: route.method as 'GET',
      url,
      headers: s ? asUser(s, route.method !== 'GET') : {},
      ...(route.method !== 'GET' && !url.endsWith('/attachment') && { payload: {} }),
    });

  it('covers every non-public route (a guard-less route could not have been registered)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(39);
    // Only "who am I" is open to any signed-in user; everything else names a permission.
    const open = routes
      .filter((r) => r.permissions.length === 0)
      .map((r) => `${r.method} ${r.url}`);
    expect(open).toEqual(['GET /api/auth/me']);
  });

  it('every route refuses a signed-out caller with 401', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      const res = await call(r, fill(r.url), null);
      if (res.statusCode !== 401) wrong.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(wrong).toEqual([]);
  });

  it('every route x role x membership gets exactly the access its guards promise', async () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const r of routes)
      for (const a of actors) {
        const hasPerms = r.permissions.every((p) => a.perms.has(p));
        const inProject =
          r.projectParam === null || a.member || a.perms.has('admin.projects.access');
        const allowed = hasPerms && inProject;
        const res = await call(r, await urlFor(r, a), a.session);
        const denied = res.statusCode === 403 && res.json().error.code === 'FORBIDDEN';
        if (allowed === denied || res.statusCode === 401)
          wrong.push(
            `${r.method} ${r.url} as ${a.label}: expected ${allowed ? 'allowed' : '403'}, got ${res.statusCode}`,
          );
        checked++;
      }
    expect(wrong).toEqual([]);
    expect(checked).toBe(routes.length * actors.length);
  }, 120_000);

  it('the matrix is not trivially "everyone allowed" or "everyone denied"', () => {
    const viewer = actors.find((a) => a.label === 'Viewer member') as Actor;
    const admin = actors.find((a) => a.label === 'Admin non-member') as Actor;
    const denied = routes.filter((r) => !r.permissions.every((p) => viewer.perms.has(p)));
    expect(denied.length).toBeGreaterThan(15);
    expect(routes.every((r) => r.permissions.every((p) => admin.perms.has(p)))).toBe(true);
  });
});
