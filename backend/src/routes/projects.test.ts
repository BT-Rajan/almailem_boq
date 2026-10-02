import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../db/testing';
import { auditLogRepository, usersRepository, type UserRecord } from '../repositories';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';

const MISSING = '00000000-0000-1000-8000-000000000000';
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

describe.skipIf(!hasTestDb)('projects and members (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let pmUser: UserRecord;
  let pm: Session;
  let viewerUser: UserRecord;
  let viewer: Session;
  let outsider: Session;

  beforeAll(async () => {
    fx = await createAuthFixture();
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pmUser = await makeUser(fx, { roleName: 'Project Manager' });
    pm = await signIn(fx, pmUser.email);
    viewerUser = await makeUser(fx, { roleName: 'Viewer' });
    viewer = await signIn(fx, viewerUser.email);
    outsider = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
  });
  afterAll(async () => {
    await fx.close();
  });

  const call = (s: Session | null, method: Method, url: string, payload?: unknown) =>
    fx.app.inject({
      method,
      url,
      ...(s && { headers: asUser(s, method !== 'GET') }),
      ...(payload !== undefined && { payload: payload as object }),
    });
  let seq = 0;
  const newProject = async (s: Session = pm, extra: object = {}) => {
    const res = await call(s, 'POST', '/api/projects', {
      code: `PRJ-${++seq}`,
      name: `Project ${seq}`,
      ...extra,
    });
    if (res.statusCode !== 201) throw new Error(`create failed: ${res.body}`);
    return res.json().data as { id: string; code: string };
  };
  const audit = (id: string) => auditLogRepository(fx.db.pool).listForEntity('project', id);

  describe('create (step 1: details)', () => {
    it('creates a planned project owned by the creator, who becomes a member', async () => {
      const res = await call(pm, 'POST', '/api/projects', {
        code: 'ALM-100',
        name: 'Tower',
        startDate: '2026-01-01',
        endDate: '2027-06-30',
        description: 'd',
      });
      expect(res.statusCode).toBe(201);
      const p = res.json().data;
      expect(p).toMatchObject({
        code: 'ALM-100',
        status: 'planned',
        ownerUserId: pmUser.id,
        ownerName: 'Test User',
        startDate: '2026-01-01',
        endDate: '2027-06-30',
        nextStatuses: ['active', 'cancelled'],
      });
      expect(Object.keys(p).filter((k) => /amount|budget|cost|fils|actual/i.test(k))).toEqual([]);
      expect((await call(pm, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(200);
      const [row] = await audit(p.id);
      expect(row).toMatchObject({ event: 'project.created', actorUserId: pmUser.id });
      expect(row?.after).toMatchObject({ code: 'ALM-100', status: 'planned' });
    });

    it('a named owner and the creator both become members', async () => {
      const p = await newProject(pm, { ownerUserId: viewerUser.id });
      const members = (await call(pm, 'GET', `/api/projects/${p.id}/members`)).json().data;
      const stored = members.filter(
        (m: { removable: boolean; isOwner: boolean }) => m.removable || m.isOwner,
      );
      expect(stored.map((m: { id: string }) => m.id).sort()).toEqual(
        [pmUser.id, viewerUser.id].sort(),
      );
      expect((await call(viewer, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(200);
    });

    it('rejects a duplicate code (case-insensitive)', async () => {
      await newProject(pm, { code: 'DUP-P' });
      const res = await call(pm, 'POST', '/api/projects', { code: 'dup-p', name: 'x' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toBe('Project already exists');
    });

    it.each([
      ['end before start', { startDate: '2026-05-01', endDate: '2026-04-30' }],
      ['end equal to start', { startDate: '2026-05-01', endDate: '2026-05-01' }],
      ['impossible date', { startDate: '2026-02-30' }],
      ['wrong date format', { startDate: '01/05/2026' }],
      ['bad code', { code: 'a b' }],
      ['empty name', { name: ' ' }],
      ['a money field', { budget: 1000 }],
      ['a status on create', { status: 'active' }],
    ])('rejects %s with 400', async (_label, patch) => {
      const res = await call(pm, 'POST', '/api/projects', {
        code: `V-${++seq}`,
        name: 'n',
        ...patch,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects a disabled or unknown owner', async () => {
      const u = await makeUser(fx);
      await usersRepository(fx.db.pool).update(u.id, { disabled: true });
      for (const ownerUserId of [u.id, MISSING]) {
        const res = await call(pm, 'POST', '/api/projects', {
          code: `O-${++seq}`,
          name: 'n',
          ownerUserId,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.message).toBe('Owner must be an active user');
      }
    });

    it('Viewers cannot create projects', async () => {
      expect(
        (await call(viewer, 'POST', '/api/projects', { code: 'NOPE', name: 'n' })).statusCode,
      ).toBe(403);
    });
  });

  describe('access: non-members get the same 403 as a missing project', () => {
    it.each<[Method, string, object?]>([
      ['GET', ''],
      ['PATCH', '', { name: 'x' }],
      ['POST', '/status', { status: 'active' }],
      ['DELETE', ''],
      ['GET', '/members'],
      ['PUT', `/members/${MISSING}`],
      ['DELETE', `/members/${MISSING}`],
    ])('%s /api/projects/:id%s', async (method, suffix, body) => {
      const p = await newProject();
      const real = await call(outsider, method, `/api/projects/${p.id}${suffix}`, body);
      const missing = await call(outsider, method, `/api/projects/${MISSING}${suffix}`, body);
      expect(real.statusCode).toBe(403);
      expect(real.json()).toEqual(missing.json());
      expect((await call(null, method, `/api/projects/${p.id}${suffix}`, body)).statusCode).toBe(
        401,
      );
    });

    it('a Viewer member can read but not edit, change status or manage members', async () => {
      const p = await newProject();
      await call(pm, 'PUT', `/api/projects/${p.id}/members/${viewerUser.id}`);
      expect((await call(viewer, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(200);
      expect((await call(viewer, 'GET', `/api/projects/${p.id}/members`)).statusCode).toBe(200);
      expect((await call(viewer, 'PATCH', `/api/projects/${p.id}`, { name: 'x' })).statusCode).toBe(
        403,
      );
      expect(
        (await call(viewer, 'POST', `/api/projects/${p.id}/status`, { status: 'active' }))
          .statusCode,
      ).toBe(403);
      expect(
        (await call(viewer, 'PUT', `/api/projects/${p.id}/members/${viewerUser.id}`)).statusCode,
      ).toBe(403);
    });

    it('an Admin opens any project without being a member (D17)', async () => {
      const p = await newProject();
      expect((await call(admin, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(200);
    });
  });

  describe('list', () => {
    it('shows only the projects the user belongs to; an Admin sees all; paginated and searchable', async () => {
      const tag = `L${Date.now()}`;
      const mine = await newProject(pm, { code: `${tag}-A`, name: 'Alpha' });
      await newProject(pm, { code: `${tag}-B`, name: 'Beta' });
      const theirs = await newProject(outsider, { code: `${tag}-C`, name: 'Gamma' });

      const pmList = (await call(pm, 'GET', `/api/projects?search=${tag}`)).json().data;
      expect(pmList.items.map((p: { code: string }) => p.code)).toEqual([`${tag}-A`, `${tag}-B`]);
      const adminList = (await call(admin, 'GET', `/api/projects?search=${tag}`)).json().data;
      expect(adminList.total).toBe(3);

      const page2 = (
        await call(admin, 'GET', `/api/projects?search=${tag}&pageSize=2&page=2`)
      ).json().data;
      expect(page2).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page2.items.map((p: { id: string }) => p.id)).toEqual([theirs.id]);

      const byName = (await call(pm, 'GET', '/api/projects?search=alpha')).json().data;
      expect(byName.items.map((p: { id: string }) => p.id)).toContain(mine.id);
      const summary = pmList.items[0];
      expect(Object.keys(summary).sort()).toEqual(
        ['code', 'endDate', 'id', 'name', 'ownerName', 'startDate', 'status'].sort(),
      );
    });

    it('treats % literally and rejects bad paging', async () => {
      expect(
        (await call(pm, 'GET', `/api/projects?search=${encodeURIComponent('%')}`)).json().data
          .total,
      ).toBe(0);
      expect((await call(pm, 'GET', '/api/projects?pageSize=1000')).statusCode).toBe(400);
      expect((await call(pm, 'GET', '/api/projects?orderBy=code')).statusCode).toBe(400);
    });

    it('revoked membership disappears from the list on the next request', async () => {
      const p = await newProject();
      await call(pm, 'PUT', `/api/projects/${p.id}/members/${viewerUser.id}`);
      const has = async () =>
        (await call(viewer, 'GET', `/api/projects?search=${p.code}`)).json().data.total;
      expect(await has()).toBe(1);
      await call(pm, 'DELETE', `/api/projects/${p.id}/members/${viewerUser.id}`);
      expect(await has()).toBe(0);
    });
  });

  describe('edit', () => {
    it('updates fields, audits only what changed, and a repeat is a no-op', async () => {
      const p = await newProject(pm, { startDate: '2026-01-01' });
      const res = await call(pm, 'PATCH', `/api/projects/${p.id}`, {
        name: 'Renamed',
        endDate: '2026-12-31',
      });
      expect(res.json().data).toMatchObject({ name: 'Renamed', endDate: '2026-12-31' });
      await call(pm, 'PATCH', `/api/projects/${p.id}`, { name: 'Renamed' });
      const rows = await audit(p.id);
      expect(rows.map((r) => r.event)).toEqual(['project.created', 'project.updated']);
      expect(rows[1]).toMatchObject({
        before: { name: expect.any(String), endDate: null },
        after: { name: 'Renamed', endDate: '2026-12-31' },
      });
    });

    it('checks dates against the stored ones, and the code cannot change', async () => {
      const p = await newProject(pm, { startDate: '2026-06-01' });
      const bad = await call(pm, 'PATCH', `/api/projects/${p.id}`, { endDate: '2026-05-01' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.details).toEqual([
        { path: 'endDate', message: 'End date must be after the start date' },
      ]);
      expect((await call(pm, 'PATCH', `/api/projects/${p.id}`, { code: 'NEW' })).statusCode).toBe(
        400,
      );
      expect((await call(pm, 'PATCH', `/api/projects/${p.id}`, {})).statusCode).toBe(400);
    });

    it('a new owner becomes a member', async () => {
      const p = await newProject();
      const res = await call(pm, 'PATCH', `/api/projects/${p.id}`, { ownerUserId: viewerUser.id });
      expect(res.json().data).toMatchObject({ ownerUserId: viewerUser.id });
      expect((await call(viewer, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(200);
    });
  });

  describe('status', () => {
    it('follows the allowed transitions, audited; refuses others with 409', async () => {
      const p = await newProject();
      const to = (status: string) => call(pm, 'POST', `/api/projects/${p.id}/status`, { status });
      expect((await to('completed')).statusCode).toBe(409);
      expect((await to('active')).json().data).toMatchObject({
        status: 'active',
        nextStatuses: ['on_hold', 'completed', 'cancelled'],
      });
      expect((await to('on_hold')).statusCode).toBe(200);
      expect((await to('active')).statusCode).toBe(200);
      expect((await to('completed')).json().data.nextStatuses).toEqual([]);
      const refused = await to('active');
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toEqual({
        code: 'INVALID_TRANSITION',
        message: 'A completed project cannot become active',
      });
      expect((await to('archived')).statusCode).toBe(400);
      const changes = (await audit(p.id)).filter((r) => r.event === 'project.status_changed');
      expect(changes.map((r) => [r.before, r.after])).toEqual([
        [{ status: 'planned' }, { status: 'active' }],
        [{ status: 'active' }, { status: 'on_hold' }],
        [{ status: 'on_hold' }, { status: 'active' }],
        [{ status: 'active' }, { status: 'completed' }],
      ]);
    });
  });

  describe('delete', () => {
    it('only with admin.projects.delete; afterwards the project is gone for everyone', async () => {
      const p = await newProject();
      expect((await call(pm, 'DELETE', `/api/projects/${p.id}`)).statusCode).toBe(403);
      expect((await call(admin, 'DELETE', `/api/projects/${p.id}`)).statusCode).toBe(200);
      expect((await call(pm, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(403);
      expect((await call(admin, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(403);
      expect((await call(pm, 'GET', `/api/projects?search=${p.code}`)).json().data.total).toBe(0);
      expect((await audit(p.id)).at(-1)?.event).toBe('project.deleted');
    });
  });

  describe('members', () => {
    it('lists owner, stored members and implicit admins; add and remove take effect at once', async () => {
      const p = await newProject();
      const u = await makeUser(fx, { roleName: 'Viewer' });
      const s = await signIn(fx, u.email);
      expect((await call(s, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(403);

      const added = await call(pm, 'PUT', `/api/projects/${p.id}/members/${u.id}`);
      const members = added.json().data as { id: string; isOwner: boolean; removable: boolean }[];
      expect(members.find((m) => m.id === pmUser.id)).toMatchObject({
        isOwner: true,
        removable: false,
      });
      expect(members.find((m) => m.id === u.id)).toMatchObject({ isOwner: false, removable: true });
      expect(members.filter((m) => !m.isOwner && !m.removable).length).toBeGreaterThan(0); // admins
      expect((await call(s, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(200);

      await call(pm, 'DELETE', `/api/projects/${p.id}/members/${u.id}`);
      expect((await call(s, 'GET', `/api/projects/${p.id}`)).statusCode).toBe(403);

      const events = (await audit(p.id)).map((r) => r.event);
      expect(events).toEqual(['project.created', 'project.member_added', 'project.member_removed']);
    });

    it('adding twice is a no-op; the owner cannot be removed; disabled users cannot be added', async () => {
      const p = await newProject();
      await call(pm, 'PUT', `/api/projects/${p.id}/members/${viewerUser.id}`);
      await call(pm, 'PUT', `/api/projects/${p.id}/members/${viewerUser.id}`);
      expect((await audit(p.id)).filter((r) => r.event === 'project.member_added')).toHaveLength(1);

      const owner = await call(pm, 'DELETE', `/api/projects/${p.id}/members/${pmUser.id}`);
      expect(owner.statusCode).toBe(409);

      const off = await makeUser(fx);
      await usersRepository(fx.db.pool).update(off.id, { disabled: true });
      expect((await call(pm, 'PUT', `/api/projects/${p.id}/members/${off.id}`)).statusCode).toBe(
        400,
      );
    });
  });

  describe('user lookup', () => {
    it('returns enabled users only, without secrets; Viewers may not use it', async () => {
      const off = await makeUser(fx, { email: `hidden${Date.now()}@example.com` });
      await usersRepository(fx.db.pool).update(off.id, { disabled: true });
      const res = await call(pm, 'GET', '/api/users/lookup?search=hidden');
      expect(res.json().data).toEqual([]);
      const all = await call(pm, 'GET', '/api/users/lookup');
      expect(Object.keys(all.json().data[0]).sort()).toEqual(['email', 'id', 'name']);
      expect(all.body).not.toMatch(/argon2|password/i);
      expect((await call(viewer, 'GET', '/api/users/lookup')).statusCode).toBe(403);
    });
  });
});
