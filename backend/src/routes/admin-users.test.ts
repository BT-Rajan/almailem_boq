import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../db/testing';
import { auditLogRepository, projectsRepository, rolesRepository } from '../repositories';
import { createUserAdminService } from '../services/user-admin';
import {
  PASSWORD,
  asUser,
  createAuthFixture,
  login,
  makeUser,
  signIn,
  uniqueEmail,
  type Fixture,
  type Session,
} from '../auth/testing';

const NEW_PASSWORD = 'a-long-enough-password';
const MISSING = '00000000-0000-1000-8000-000000000000';

describe.skipIf(!hasTestDb)('admin: users, roles and project access (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let adminId: string;
  let roleIds: Record<string, string>;
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    fx = await createAuthFixture({}, {}, (app) => {
      // Stand-in for the project routes of a later chunk: proves what a user can reach.
      const { authenticate, authorize, authorizeProjectAccess } = app.guards;
      app.get(
        '/__t/projects/:projectId',
        { onRequest: [authenticate, authorize('project.view'), authorizeProjectAccess()] },
        () => ({ ok: true }),
      );
    });
    const a = await makeUser(fx, { roleName: 'Admin' });
    adminId = a.id;
    admin = await signIn(fx, a.email);
    roleIds = Object.fromEntries(
      (await rolesRepository(fx.db.pool).list()).map((r) => [r.name, r.id]),
    );
    const projects = projectsRepository(fx.db.pool);
    const mk = (code: string) =>
      projects.create({ code, name: `Project ${code}`, ownerUserId: adminId, status: 'active' });
    projectA = (await mk('P-A')).id;
    projectB = (await mk('P-B')).id;
  });
  afterAll(async () => {
    await fx.close();
  });

  const call = (
    s: Session | null,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) =>
    fx.app.inject({
      method,
      url,
      ...(s && { headers: asUser(s, method !== 'GET') }),
      ...(payload !== undefined && { payload: payload as object }),
    });

  const createUser = (body: Record<string, unknown>) =>
    call(admin, 'POST', '/api/admin/users', body);
  const auditFor = (userId: string) => auditLogRepository(fx.db.pool).listForEntity('user', userId);
  const reach = (s: Session, projectId: string) =>
    fx.app.inject({ method: 'GET', url: `/__t/projects/${projectId}`, headers: asUser(s) });

  describe('access to the admin API', () => {
    const routes: [Parameters<typeof call>[1], string][] = [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['GET', `/api/admin/users/${MISSING}`],
      ['PATCH', `/api/admin/users/${MISSING}/status`],
      ['PUT', `/api/admin/users/${MISSING}/roles/${MISSING}`],
      ['DELETE', `/api/admin/users/${MISSING}/roles/${MISSING}`],
      ['PUT', `/api/admin/users/${MISSING}/projects/${MISSING}`],
      ['DELETE', `/api/admin/users/${MISSING}/projects/${MISSING}`],
      ['GET', '/api/admin/projects'],
      ['GET', '/api/admin/roles'],
    ];

    it.each(routes)('%s %s: 401 signed out, 403 without the permission', async (method, url) => {
      expect((await call(null, method, url, {})).statusCode).toBe(401);
      for (const role of ['Viewer', 'Project Manager', 'Accountant']) {
        const u = await makeUser(fx, { roleName: role });
        const res = await call(await signIn(fx, u.email), method, url, {});
        expect(res.statusCode, role).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      }
    });

    it('requires the CSRF token on writes', async () => {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: asUser(admin, false),
        payload: { email: uniqueEmail(), name: 'X', password: NEW_PASSWORD },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CSRF_INVALID');
    });
  });

  describe('acceptance: create user > assign role > grant project > sees only that project', () => {
    it('works end to end, and revoking takes effect on the next request', async () => {
      const email = uniqueEmail('flow');
      const created = await createUser({ email, name: 'Flow User', password: NEW_PASSWORD });
      expect(created.statusCode).toBe(201);
      const userId: string = created.json().data.id;
      expect(created.json().data).toMatchObject({
        email,
        roles: [],
        projects: [],
        disabled: false,
      });

      const assigned = await call(
        admin,
        'PUT',
        `/api/admin/users/${userId}/roles/${roleIds['Viewer']}`,
      );
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json().data.roles).toEqual([{ id: roleIds['Viewer'], name: 'Viewer' }]);

      const granted = await call(admin, 'PUT', `/api/admin/users/${userId}/projects/${projectA}`);
      expect(granted.json().data).toEqual([{ id: projectA, code: 'P-A', name: 'Project P-A' }]);

      const user = await signIn(fx, email, NEW_PASSWORD);
      expect((await reach(user, projectA)).statusCode).toBe(200);
      expect((await reach(user, projectB)).statusCode).toBe(403);

      const revoked = await call(
        admin,
        'DELETE',
        `/api/admin/users/${userId}/projects/${projectA}`,
      );
      expect(revoked.json().data).toEqual([]);
      expect((await reach(user, projectA)).statusCode).toBe(403); // same session, next request

      const events = (await auditFor(userId)).map((e) => e.event);
      expect(events).toEqual([
        'user.created',
        'user.role_assigned',
        'user.project_granted',
        'auth.login',
        'user.project_revoked',
      ]);
      const rows = await auditFor(userId);
      expect(rows[0]).toMatchObject({
        actorUserId: adminId,
        after: { email, name: 'Flow User', roles: [] },
      });
      expect(rows[1]).toMatchObject({ before: { roles: [] }, after: { roles: ['Viewer'] } });
      expect(rows[2]?.after).toEqual({ project: { id: projectA, code: 'P-A' } });
      expect(rows[4]?.before).toEqual({ project: { id: projectA, code: 'P-A' } });
    });

    it('a role change applies on the next request of an existing session', async () => {
      const u = await makeUser(fx);
      const s = await signIn(fx, u.email);
      expect((await call(s, 'GET', '/api/auth/me')).json().data.permissions).toEqual([]);
      await call(admin, 'PUT', `/api/admin/users/${u.id}/roles/${roleIds['Viewer']}`);
      expect((await call(s, 'GET', '/api/auth/me')).json().data.permissions).toContain(
        'project.view',
      );
      await call(admin, 'DELETE', `/api/admin/users/${u.id}/roles/${roleIds['Viewer']}`);
      expect((await call(s, 'GET', '/api/auth/me')).json().data.permissions).toEqual([]);
    });
  });

  it('an Admin reaches every project; losing the role removes that on the next request', async () => {
    const u = await makeUser(fx, { roleName: 'Admin' });
    const s = await signIn(fx, u.email);
    expect((await reach(s, projectA)).statusCode).toBe(200);
    expect((await reach(s, projectB)).statusCode).toBe(200);
    await call(admin, 'DELETE', `/api/admin/users/${u.id}/roles/${roleIds['Admin']}`);
    expect((await reach(s, projectA)).statusCode).toBe(403);
  });

  describe('create user', () => {
    it('creates with roles, never returns the password or its hash, and audits without it', async () => {
      const res = await createUser({
        email: uniqueEmail(),
        name: '  Spaced Name  ',
        password: NEW_PASSWORD,
        roleIds: [roleIds['Accountant']],
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.name).toBe('Spaced Name');
      expect(res.json().data.roles).toEqual([{ id: roleIds['Accountant'], name: 'Accountant' }]);
      expect(res.body).not.toMatch(/argon2|password/i);
      const [audit] = await auditFor(res.json().data.id);
      expect(JSON.stringify(audit)).not.toMatch(/argon2|a-long-enough/);
    });

    it('rejects a duplicate email (case-insensitive) with 409', async () => {
      const email = uniqueEmail('dup');
      expect((await createUser({ email, name: 'A', password: NEW_PASSWORD })).statusCode).toBe(201);
      const again = await createUser({
        email: email.toUpperCase(),
        name: 'B',
        password: NEW_PASSWORD,
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toEqual({ code: 'CONFLICT', message: 'User already exists' });
    });

    it.each([
      ['short password', { password: 'short' }],
      ['bad email', { email: 'not-an-email' }],
      ['empty name', { name: '   ' }],
      ['bad role id', { roleIds: ['nope'] }],
      ['unknown field', { isAdmin: true }],
    ])('rejects %s with 400', async (_label, patch) => {
      const res = await createUser({
        email: uniqueEmail(),
        name: 'Valid',
        password: NEW_PASSWORD,
        ...patch,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('an unknown role rolls the whole creation back', async () => {
      const email = uniqueEmail('rollback');
      const res = await createUser({
        email,
        name: 'X',
        password: NEW_PASSWORD,
        roleIds: [MISSING],
      });
      expect(res.statusCode).toBe(404);
      const list = await call(admin, 'GET', `/api/admin/users?search=${encodeURIComponent(email)}`);
      expect(list.json().data.total).toBe(0);
    });
  });

  describe('disable and enable', () => {
    it('disabling ends live sessions and blocks login; enabling restores login', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const s = await signIn(fx, u.email);
      const off = await call(admin, 'PATCH', `/api/admin/users/${u.id}/status`, { disabled: true });
      expect(off.json().data.disabled).toBe(true);
      expect((await call(s, 'GET', '/api/auth/me')).statusCode).toBe(401);
      expect((await login(fx, u.email)).statusCode).toBe(401);

      const on = await call(admin, 'PATCH', `/api/admin/users/${u.id}/status`, { disabled: false });
      expect(on.json().data.disabled).toBe(false);
      expect((await login(fx, u.email, PASSWORD)).statusCode).toBe(200);

      const events = (await auditFor(u.id)).map((e) => e.event);
      expect(events.filter((e) => e.startsWith('user.'))).toEqual([
        'user.disabled',
        'user.enabled',
      ]);
    });

    it('repeating the same state is a no-op with no extra audit row', async () => {
      const u = await makeUser(fx);
      await call(admin, 'PATCH', `/api/admin/users/${u.id}/status`, { disabled: false });
      expect(await auditFor(u.id)).toHaveLength(0);
    });

    it('404 for an unknown user, 400 for a malformed id', async () => {
      const body = { disabled: true };
      expect(
        (await call(admin, 'PATCH', `/api/admin/users/${MISSING}/status`, body)).statusCode,
      ).toBe(404);
      expect((await call(admin, 'PATCH', '/api/admin/users/nope/status', body)).statusCode).toBe(
        400,
      );
    });
  });

  describe('roles and project access', () => {
    it('assigning the same role twice writes one audit row', async () => {
      const u = await makeUser(fx);
      const url = `/api/admin/users/${u.id}/roles/${roleIds['Viewer']}`;
      expect((await call(admin, 'PUT', url)).statusCode).toBe(200);
      expect((await call(admin, 'PUT', url)).statusCode).toBe(200);
      expect((await auditFor(u.id)).map((e) => e.event)).toEqual(['user.role_assigned']);
    });

    it('unknown role or project gives 404; a deleted project cannot be granted', async () => {
      const u = await makeUser(fx);
      expect(
        (await call(admin, 'PUT', `/api/admin/users/${u.id}/roles/${MISSING}`)).statusCode,
      ).toBe(404);
      expect(
        (await call(admin, 'PUT', `/api/admin/users/${u.id}/projects/${MISSING}`)).statusCode,
      ).toBe(404);
      const gone = await projectsRepository(fx.db.pool).create({
        code: 'P-GONE',
        name: 'Gone',
        ownerUserId: adminId,
        status: 'active',
      });
      await projectsRepository(fx.db.pool).softDelete(gone.id);
      expect(
        (await call(admin, 'PUT', `/api/admin/users/${u.id}/projects/${gone.id}`)).statusCode,
      ).toBe(404);
    });

    it('user detail lists roles and live projects', async () => {
      const u = await makeUser(fx, { roleName: 'Viewer' });
      await call(admin, 'PUT', `/api/admin/users/${u.id}/projects/${projectB}`);
      const res = await call(admin, 'GET', `/api/admin/users/${u.id}`);
      expect(res.json().data).toMatchObject({
        id: u.id,
        roles: [{ name: 'Viewer' }],
        projects: [{ id: projectB, code: 'P-B' }],
      });
      expect(res.json().data).not.toHaveProperty('passwordHash');
    });

    it('lists roles with their permissions', async () => {
      const res = await call(admin, 'GET', '/api/admin/roles');
      const roles = res.json().data as { name: string; permissions: string[] }[];
      expect(roles.map((r) => r.name)).toEqual([
        'Accountant',
        'Admin',
        'Project Manager',
        'Viewer',
      ]);
      expect(roles.find((r) => r.name === 'Viewer')?.permissions).toEqual([
        'expense.view',
        'project.view',
        'report.view',
      ]);
    });

    it('lists live projects for the picker', async () => {
      const res = await call(admin, 'GET', '/api/admin/projects');
      const codes = (res.json().data as { code: string }[]).map((p) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['P-A', 'P-B']));
      expect(codes).not.toContain('P-GONE');
    });
  });

  describe('list and search', () => {
    it('searches name and email, paginates, and treats % and _ literally', async () => {
      const tag = `srch${Date.now()}`;
      for (let i = 0; i < 3; i++) {
        await createUser({
          email: `${tag}_${i}@example.com`,
          name: `N ${i}`,
          password: NEW_PASSWORD,
        });
      }
      const page1 = await call(admin, 'GET', `/api/admin/users?search=${tag}&pageSize=2`);
      expect(page1.json().data).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(page1.json().data.items).toHaveLength(2);
      const page2 = await call(admin, 'GET', `/api/admin/users?search=${tag}&pageSize=2&page=2`);
      expect(page2.json().data.items).toHaveLength(1);

      const pct = await call(admin, 'GET', `/api/admin/users?search=${encodeURIComponent('%')}`);
      expect(pct.json().data.total).toBe(0);
      const underscore = await call(admin, 'GET', `/api/admin/users?search=${tag.slice(0, 3)}_`);
      expect(underscore.json().data.total).toBe(0);
    });

    it('rejects oversized pages and unknown query parameters', async () => {
      expect((await call(admin, 'GET', '/api/admin/users?pageSize=101')).statusCode).toBe(400);
      expect((await call(admin, 'GET', '/api/admin/users?sort=password_hash')).statusCode).toBe(
        400,
      );
    });
  });

  describe('the last administrator cannot be removed', () => {
    let fx2: Fixture;
    let soleAdmin: Session;
    let soleAdminId: string;
    let adminRoleId: string;

    beforeAll(async () => {
      fx2 = await createAuthFixture();
      const a = await makeUser(fx2, { roleName: 'Admin' });
      soleAdminId = a.id;
      soleAdmin = await signIn(fx2, a.email);
      adminRoleId = (await rolesRepository(fx2.db.pool).findByName('Admin'))?.id as string;
    });
    afterAll(async () => {
      await fx2.close();
    });

    const call2 = (s: Session, method: 'PATCH' | 'DELETE', url: string, payload?: object) =>
      fx2.app.inject({ method, url, headers: asUser(s, true), ...(payload && { payload }) });

    it('refuses to remove the role or disable the only administrator, and changes nothing', async () => {
      const removeRole = await call2(
        soleAdmin,
        'DELETE',
        `/api/admin/users/${soleAdminId}/roles/${adminRoleId}`,
      );
      expect(removeRole.statusCode).toBe(409);
      expect(removeRole.json().error.code).toBe('LAST_ADMIN');
      const disable = await call2(soleAdmin, 'PATCH', `/api/admin/users/${soleAdminId}/status`, {
        disabled: true,
      });
      expect(disable.statusCode).toBe(409);

      const me = await fx2.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: asUser(soleAdmin),
      });
      expect(me.json().data.permissions).toContain('admin.users.manage');
      expect(
        (await auditLogRepository(fx2.db.pool).listForEntity('user', soleAdminId))
          .map((e) => e.event)
          .filter((e) => e.startsWith('user.')),
      ).toEqual([]);
    });

    it('a disabled administrator does not count', async () => {
      const other = await makeUser(fx2, { roleName: 'Admin' });
      await call2(soleAdmin, 'PATCH', `/api/admin/users/${other.id}/status`, { disabled: true });
      const res = await call2(
        soleAdmin,
        'DELETE',
        `/api/admin/users/${soleAdminId}/roles/${adminRoleId}`,
      );
      expect(res.statusCode).toBe(409);
    });

    it('two administrators removing each other at the same time: exactly one succeeds', async () => {
      // Start from exactly two enabled admins: the sole admin plus one more.
      const b = await makeUser(fx2, { roleName: 'Admin' });
      const sb = await signIn(fx2, b.email);
      const [r1, r2] = await Promise.all([
        call2(soleAdmin, 'DELETE', `/api/admin/users/${b.id}/roles/${adminRoleId}`),
        call2(sb, 'DELETE', `/api/admin/users/${soleAdminId}/roles/${adminRoleId}`),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      // The loser either hits the last-admin rule (409) or has already lost the permission (403).
      expect(codes[0]).toBe(200);
      expect([403, 409]).toContain(codes[1]);
    });

    it('with two administrators, one can step down', async () => {
      const c = await makeUser(fx2, { roleName: 'Admin' });
      const sc = await signIn(fx2, c.email);
      const res = await call2(sc, 'DELETE', `/api/admin/users/${c.id}/roles/${adminRoleId}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.roles).toEqual([]);
    });
  });

  describe('bootstrapAdmin (operator CLI)', () => {
    it('creates the first administrator once, then refuses', async () => {
      const fresh = await createAuthFixture();
      try {
        const service = createUserAdminService(fresh.db.pool);
        const email = uniqueEmail('boot');
        const user = await service.bootstrapAdmin({ email, name: 'Boot', password: NEW_PASSWORD });
        expect(user.roles.map((r) => r.name)).toEqual(['Admin']);
        expect((await signIn(fresh, email, NEW_PASSWORD)).res.json().data.permissions).toContain(
          'admin.users.manage',
        );
        await expect(
          service.bootstrapAdmin({ email: uniqueEmail(), name: 'Two', password: NEW_PASSWORD }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(
          createUserAdminService(fresh.db.pool).bootstrapAdmin({
            email: 'x@example.com',
            name: 'Short',
            password: 'short',
          }),
        ).rejects.toThrow();
      } finally {
        await fresh.close();
      }
    });
  });
});
