import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchResults } from '@boq/shared';
import { hasTestDb } from '../db/testing';
import { costHeadsRepository, type CostHeadRecord } from '../repositories';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';

// Placeholder data for tests only.
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

describe.skipIf(!hasTestDb)('shared list pattern and global search (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let pm: Session;
  let other: Session;
  let head: CostHeadRecord;
  let mine: string;
  let theirs: string;

  beforeAll(async () => {
    fx = await createAuthFixture();
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    other = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    head = await costHeadsRepository(fx.db.pool).create({
      code: 'SRCH-H',
      name: 'Searchable head',
      displayOrder: 1,
    });
    mine = await project(pm, 'MINE-1', 'Zephyr Tower', 'active');
    theirs = await project(other, 'THEIRS-1', 'Zephyr Annex', 'planned');
    await project(pm, 'MINE-2', 'Alpha Villas', 'planned');
    await project(pm, 'MINE-3', 'Mid Mall', 'active');
    await expense(pm, mine, 'Zephyr Steel', 'ZS-001', 300_000, 'rebar for podium');
    await expense(pm, mine, 'Acme', 'AC-002', 100_000, null);
    await expense(pm, mine, 'Acme', 'AC-003', 200_000, null);
    await expense(other, theirs, 'Zephyr Steel', 'ZS-SECRET', 900_000, 'secret rebar');
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
  async function project(s: Session, code: string, name: string, status: string) {
    const id = (await call(s, 'POST', '/api/projects', { code, name })).json().data.id as string;
    if (status === 'active')
      await call(s, 'POST', `/api/projects/${id}/status`, { status: 'active' });
    return id;
  }
  async function expense(
    s: Session,
    projectId: string,
    vendor: string,
    invoiceNo: string,
    amountFils: number,
    description: string | null,
  ) {
    const res = await call(s, 'POST', `/api/projects/${projectId}/expenses`, {
      costHeadId: head.id,
      vendor,
      invoiceNo,
      expenseDate: '2026-06-01',
      amountFils,
      description,
    });
    return res.json().data.id as string;
  }
  const search = async (s: Session, q: string) =>
    (await call(s, 'GET', `/api/search?q=${encodeURIComponent(q)}`)).json().data as SearchResults;

  describe('lists: sort, filter, page', () => {
    it('projects: sorts by an allowed key and direction, and filters by status', async () => {
      const codes = async (qs: string) =>
        (
          (await call(pm, 'GET', `/api/projects?${qs}`)).json().data.items as { code: string }[]
        ).map((p) => p.code);
      expect(await codes('sort=name')).toEqual(['MINE-2', 'MINE-3', 'MINE-1']);
      expect(await codes('sort=name&dir=desc')).toEqual(['MINE-1', 'MINE-3', 'MINE-2']);
      expect(await codes('status=active')).toEqual(['MINE-1', 'MINE-3']);
      expect(await codes('q=zephyr')).toEqual(['MINE-1']);
    });

    it('expenses: sorts by amount; pages are stable and cover every entry once', async () => {
      const amounts = async (qs: string) =>
        (
          (await call(pm, 'GET', `/api/projects/${mine}/expenses?${qs}`)).json().data.items as {
            amountFils: number;
          }[]
        ).map((e) => e.amountFils);
      expect(await amounts('sort=amount')).toEqual([100_000, 200_000, 300_000]);
      expect(await amounts('sort=amount&dir=desc')).toEqual([300_000, 200_000, 100_000]);
      const pages = [
        ...(await amounts('sort=vendor&pageSize=2&page=1')),
        ...(await amounts('sort=vendor&pageSize=2&page=2')),
      ];
      expect(pages.sort()).toEqual([100_000, 200_000, 300_000].sort());
      expect(await amounts('q=rebar')).toEqual([300_000]);
    });

    it.each([
      ['/api/projects?sort=code;DROP TABLE projects'],
      ['/api/projects?sort=p.code'],
      ['/api/projects?sort=owner_user_id'],
      ['/api/projects?sort=__proto__'],
      ['/api/projects?dir=sideways'],
      ['/api/projects?status=1 OR 1=1'],
      ['/api/projects?orderBy=code'],
      ['/api/projects?pageSize=101'],
      ['/api/projects?page=0'],
      ['/api/admin/users?sort=password_hash'],
      ['/api/admin/users?filter=disabled'],
    ])('refuses %s with 400', async (url) => {
      const s = url.startsWith('/api/admin') ? admin : pm;
      const res = await call(s, 'GET', url);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('SQL in the search text is just text', async () => {
      for (const q of ["' OR 1=1 --", '%', '_', '\\', "'); DROP TABLE projects; --"]) {
        const res = await call(pm, 'GET', `/api/projects?q=${encodeURIComponent(q)}`);
        expect(res.statusCode).toBe(200);
        expect(res.json().data.total).toBe(0);
      }
      expect((await call(pm, 'GET', '/api/projects')).json().data.total).toBe(3); // still there
    });
  });

  describe('global search', () => {
    it('groups projects, cost heads, invoices, vendors and expenses', async () => {
      const r = await search(pm, 'zephyr');
      expect(r.projects.map((p) => p.code)).toEqual(['MINE-1']);
      expect(r.vendors).toEqual([{ vendor: 'Zephyr Steel', expenses: 1, projects: 1 }]);
      expect((await search(pm, 'ZS-0')).invoices.map((i) => i.invoiceNo)).toEqual(['ZS-001']);
      expect((await search(pm, 'podium')).expenses.map((e) => e.invoiceNo)).toEqual(['ZS-001']);
      expect((await search(pm, 'searchable')).costHeads.map((h) => h.code)).toEqual(['SRCH-H']);
      const acme = (await search(pm, 'acme')).vendors;
      expect(acme).toEqual([{ vendor: 'Acme', expenses: 2, projects: 1 }]);
    });

    it("never shows another team's projects, invoices, vendors or expenses", async () => {
      const r = await search(pm, 'zephyr');
      const text = JSON.stringify(r);
      expect(text).not.toContain('THEIRS');
      expect(text).not.toContain('ZS-SECRET');
      expect(text).not.toContain('secret');
      expect((await search(pm, 'secret')).expenses).toEqual([]);
      // an administrator sees everything (D17)
      const all = await search(admin, 'zephyr');
      expect(all.projects.map((p) => p.code).sort()).toEqual(['MINE-1', 'THEIRS-1']);
      expect(all.vendors).toEqual([{ vendor: 'Zephyr Steel', expenses: 2, projects: 2 }]);
    });

    it('leaves out reversal entries, reversed expenses still show once, and deleted projects vanish', async () => {
      const id = await expense(pm, mine, 'Rev Co', 'RV-1', 5_000, null);
      await call(pm, 'POST', `/api/projects/${mine}/expenses/${id}/reverse`, { reason: 'x' });
      expect((await search(pm, 'RV-1')).invoices).toHaveLength(1); // the original, not its reversal
      const gone = await project(pm, 'GONE-1', 'Vanishing', 'planned');
      expect((await search(pm, 'vanishing')).projects).toHaveLength(1);
      await call(admin, 'DELETE', `/api/projects/${gone}`);
      expect((await search(pm, 'vanishing')).projects).toEqual([]);
    });

    it('needs at least 2 characters and treats wildcards literally', async () => {
      expect((await call(pm, 'GET', '/api/search?q=z')).statusCode).toBe(400);
      expect((await call(pm, 'GET', '/api/search')).statusCode).toBe(400);
      expect((await call(pm, 'GET', '/api/search?q=zz&x=1')).statusCode).toBe(400);
      const r = await search(pm, '%%');
      expect(Object.values(r).every((g) => g.length === 0)).toBe(true);
      expect((await call(null, 'GET', '/api/search?q=zephyr')).statusCode).toBe(401);
    });
  });

  it('every search and sort path has an index that leads with its column(s)', async () => {
    const [rows] = await fx.db.pool.query<RowDataPacket[]>(
      `SELECT table_name AS t, index_name AS i, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
         FROM information_schema.statistics WHERE table_schema = DATABASE() GROUP BY table_name, index_name`,
    );
    const leads = (table: string, cols: string) =>
      rows.some((r) => r['t'] === table && `${r['cols']},`.startsWith(`${cols},`));
    for (const [table, cols] of [
      ['projects', 'code'], // project search and sort
      ['projects', 'name'],
      ['projects', 'status'], // status filter
      ['project_members', 'user_id'], // member scope
      ['expenses', 'project_id,invoice_no'], // invoice search
      ['expenses', 'project_id,vendor'], // vendor search
      ['expenses', 'project_id,expense_date'], // default expense sort
      ['expenses', 'project_id,cost_head_id'], // cost-head filter
      ['cost_heads', 'code'],
      ['users', 'email'],
    ] as const)
      expect(leads(table, cols), `${table}(${cols})`).toBe(true);
  });
});
