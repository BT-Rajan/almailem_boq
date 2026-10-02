import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../db/testing';
import { auditLogRepository } from '../repositories';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';

// Test data only: placeholder heads, not real cost heads.
const MISSING = '00000000-0000-1000-8000-000000000000';
type Head = { id: string; code: string; name: string; active: boolean; displayOrder: number };

describe.skipIf(!hasTestDb)('admin: cost head master (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let adminId: string;

  beforeAll(async () => {
    fx = await createAuthFixture();
    const a = await makeUser(fx, { roleName: 'Admin' });
    adminId = a.id;
    admin = await signIn(fx, a.email);
  });
  afterAll(async () => {
    await fx.close();
  });

  const call = (
    s: Session | null,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    payload?: unknown,
  ) =>
    fx.app.inject({
      method,
      url,
      ...(s && { headers: asUser(s, method !== 'GET') }),
      ...(payload !== undefined && { payload: payload as object }),
    });
  const create = (body: object) => call(admin, 'POST', '/api/admin/cost-heads', body);
  const list = async () =>
    (await call(admin, 'GET', '/api/admin/cost-heads')).json().data as Head[];
  const audit = (id: string) => auditLogRepository(fx.db.pool).listForEntity('cost_head', id);

  it.each([
    ['GET', '/api/admin/cost-heads'],
    ['POST', '/api/admin/cost-heads'],
    ['PATCH', `/api/admin/cost-heads/${MISSING}`],
    ['PUT', '/api/admin/cost-heads/order'],
  ] as const)('%s %s: 401 signed out, 403 for non-admins', async (method, url) => {
    expect((await call(null, method, url, {})).statusCode).toBe(401);
    for (const role of ['Viewer', 'Project Manager', 'Accountant']) {
      const s = await signIn(fx, (await makeUser(fx, { roleName: role })).email);
      expect((await call(s, method, url, {})).statusCode, role).toBe(403);
    }
  });

  it('adds heads at the end of the list, audited', async () => {
    const a = await create({ code: 'T 01', name: 'Head A', description: 'first' });
    expect(a.statusCode).toBe(201);
    const b = await create({ code: 'T 02', name: 'Head B' });
    const [ha, hb] = [a.json().data as Head, b.json().data as Head];
    expect(ha).toMatchObject({ code: 'T 01', name: 'Head A', active: true, displayOrder: 1 });
    expect(hb.displayOrder).toBe(2);
    expect((await list()).map((h) => h.code)).toEqual(['T 01', 'T 02']);
    const [row] = await audit(ha.id);
    expect(row).toMatchObject({ event: 'cost_head.created', actorUserId: adminId });
    expect(row?.after).toMatchObject({ code: 'T 01', name: 'Head A', description: 'first' });
  });

  it('rejects a duplicate code, case-insensitively, on create and on edit', async () => {
    await create({ code: 'DUP-1', name: 'x' });
    const again = await create({ code: 'dup-1', name: 'y' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({ code: 'CONFLICT', message: 'Cost head already exists' });

    const other = (await create({ code: 'DUP-2', name: 'z' })).json().data as Head;
    const edit = await call(admin, 'PATCH', `/api/admin/cost-heads/${other.id}`, { code: 'DUP-1' });
    expect(edit.statusCode).toBe(409);
  });

  it.each([
    ['empty code', { code: ' ', name: 'n' }],
    ['code with symbols', { code: "1'; DROP", name: 'n' }],
    ['code too long', { code: 'X'.repeat(31), name: 'n' }],
    ['empty name', { code: 'OK1', name: '' }],
    ['unknown field', { code: 'OK2', name: 'n', displayOrder: 1 }],
  ])('rejects %s with 400', async (_label, body) => {
    expect((await create(body)).statusCode).toBe(400);
  });

  it('edits fields, audits only what changed, and treats a no-op as a no-op', async () => {
    const h = (await create({ code: 'ED-1', name: 'Old' })).json().data as Head;
    const res = await call(admin, 'PATCH', `/api/admin/cost-heads/${h.id}`, {
      name: 'New',
      description: 'd',
      code: 'ED-1',
    });
    expect(res.json().data).toMatchObject({ code: 'ED-1', name: 'New', description: 'd' });
    await call(admin, 'PATCH', `/api/admin/cost-heads/${h.id}`, { name: 'New' });
    const rows = await audit(h.id);
    expect(rows.map((r) => r.event)).toEqual(['cost_head.created', 'cost_head.updated']);
    expect(rows[1]).toMatchObject({
      before: { name: 'Old', description: null },
      after: { name: 'New', description: 'd' },
    });
  });

  it('deactivates and reactivates; inactive heads stay in the admin list', async () => {
    const h = (await create({ code: 'DE-1', name: 'n' })).json().data as Head;
    const off = await call(admin, 'PATCH', `/api/admin/cost-heads/${h.id}`, { active: false });
    expect(off.json().data.active).toBe(false);
    expect((await list()).find((x) => x.id === h.id)?.active).toBe(false);
    const on = await call(admin, 'PATCH', `/api/admin/cost-heads/${h.id}`, { active: true });
    expect(on.json().data.active).toBe(true);
    expect((await audit(h.id)).map((r) => r.after)).toEqual([
      expect.anything(),
      { active: false },
      { active: true },
    ]);
  });

  it('404 for an unknown head, 400 for an empty patch or malformed id', async () => {
    expect(
      (await call(admin, 'PATCH', `/api/admin/cost-heads/${MISSING}`, { name: 'x' })).statusCode,
    ).toBe(404);
    const h = (await list())[0] as Head;
    expect((await call(admin, 'PATCH', `/api/admin/cost-heads/${h.id}`, {})).statusCode).toBe(400);
    expect(
      (await call(admin, 'PATCH', '/api/admin/cost-heads/nope', { name: 'x' })).statusCode,
    ).toBe(400);
  });

  describe('reorder', () => {
    it('applies a full new order, numbered 1..n, audited once', async () => {
      const ids = (await list()).map((h) => h.id);
      const reversed = [...ids].reverse();
      const res = await call(admin, 'PUT', '/api/admin/cost-heads/order', { ids: reversed });
      expect(res.statusCode).toBe(200);
      const after = res.json().data as Head[];
      expect(after.map((h) => h.id)).toEqual(reversed);
      expect(after.map((h) => h.displayOrder)).toEqual(reversed.map((_, i) => i + 1));
      expect((await audit('list')).map((r) => r.event)).toEqual(['cost_head.reordered']);

      // same order again: nothing to do, nothing audited
      await call(admin, 'PUT', '/api/admin/cost-heads/order', { ids: reversed });
      expect(await audit('list')).toHaveLength(1);
    });

    it('refuses a partial, stale or duplicated list and changes nothing', async () => {
      const before = await list();
      const ids = before.map((h) => h.id);
      const partial = await call(admin, 'PUT', '/api/admin/cost-heads/order', {
        ids: ids.slice(1),
      });
      expect(partial.statusCode).toBe(409);
      const stale = await call(admin, 'PUT', '/api/admin/cost-heads/order', {
        ids: [...ids.slice(1), MISSING],
      });
      expect(stale.statusCode).toBe(409);
      const dup = await call(admin, 'PUT', '/api/admin/cost-heads/order', {
        ids: [ids[0], ...ids.slice(0, -1)],
      });
      expect(dup.statusCode).toBe(400);
      expect(await list()).toEqual(before);
    });

    it('a new head after a reorder still goes to the end', async () => {
      const h = (await create({ code: 'END-1', name: 'n' })).json().data as Head;
      const all = await list();
      expect(all.at(-1)?.id).toBe(h.id);
      expect(h.displayOrder).toBe(all.length);
    });
  });
});
