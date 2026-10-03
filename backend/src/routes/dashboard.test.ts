import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fils, type Dashboard, type ProjectBoq } from '@boq/shared';
import { calculateBudgetStatus } from '../domain/control';
import { hasTestDb, seedPortfolio } from '../db/testing';
import { costHeadsRepository, estimatesRepository, type CostHeadRecord } from '../repositories';
import {
  approveHeld,
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  TEST_APPROVAL_REASON,
  type Fixture,
  type Session,
} from '../auth/testing';

// Placeholder heads and projects for tests only. Default thresholds: 80.00% / 100.00%.
const DEFAULTS = { warningBp: 8000, approvalBp: 10000 };
type Method = 'GET' | 'POST' | 'PUT';

describe.skipIf(!hasTestDb)('dashboard (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let pm: Session;
  let other: Session;
  let viewer: Session;
  let viewerId: string;
  let h1: CostHeadRecord;
  let h2: CostHeadRecord;

  beforeAll(async () => {
    fx = await createAuthFixture();
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    other = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const v = await makeUser(fx, { roleName: 'Viewer' });
    viewerId = v.id;
    viewer = await signIn(fx, v.email);
    h1 = await costHeadsRepository(fx.db.pool).create({
      code: 'D1',
      name: 'Head one',
      displayOrder: 1,
    });
    h2 = await costHeadsRepository(fx.db.pool).create({
      code: 'D2',
      name: 'Head two',
      displayOrder: 2,
    });
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
  const dashboard = async (s: Session) =>
    (await call(s, 'GET', '/api/dashboard')).json().data as Dashboard;
  let seq = 0;
  const project = async (
    s: Session,
    budgets: [CostHeadRecord, number][],
    spend: [CostHeadRecord, number][],
  ) => {
    const id = (await call(s, 'POST', '/api/projects', { name: `Dash ${++seq}` })).json().data
      .id as string;
    await call(admin, 'PUT', `/api/projects/${id}/estimates`, {
      estimates: budgets.map(([h, amountFils]) => ({ costHeadId: h.id, amountFils })),
    });
    // Expenses go only on heads in the approved budget: spent heads without one join it at 0.
    for (const [h] of spend)
      if (!budgets.some(([b]) => b.id === h.id))
        await estimatesRepository(fx.db.pool).upsert(id, h.id, fils(0));
    const ids: string[] = [];
    for (const [h, amountFils] of spend) {
      const res = await call(s, 'POST', `/api/projects/${id}/expenses`, {
        costHeadId: h.id,
        vendor: 'V',
        invoiceNo: `I-${++seq}`,
        expenseDate: '2026-05-01',
        amountFils,
        approvalReason: TEST_APPROVAL_REASON,
      });
      await approveHeld(fx, admin, res.json().data); // the figures below expect spend in Actual
      ids.push(res.json().data.id);
    }
    return { id, expenseIds: ids };
  };

  describe('figures', () => {
    it('summary totals equal the sum of project totals, and each project equals its BoQ total', async () => {
      const a = await project(
        pm,
        [
          [h1, 1_000_000],
          [h2, 500_000],
        ],
        [[h1, 850_000]],
      ); // 56.66%
      const b = await project(
        pm,
        [[h1, 100_000]],
        [
          [h1, 100_000],
          [h2, 5],
        ],
      ); // over budget
      const c = await project(pm, [], []); // no money yet
      const d = await dashboard(pm);

      const sum = (k: 'budget' | 'actual' | 'remaining') =>
        d.projects.reduce((s, p) => s + p.metrics[k], 0);
      expect(d.summary.projects).toBe(d.projects.length);
      expect(d.summary.metrics.budget).toBe(sum('budget'));
      expect(d.summary.metrics.actual).toBe(sum('actual'));
      expect(d.summary.metrics.remaining).toBe(sum('remaining'));

      for (const { id } of [a, b, c]) {
        const boq = (await call(pm, 'GET', `/api/projects/${id}/boq`)).json().data as ProjectBoq;
        const row = d.projects.find((p) => p.id === id);
        expect(row?.metrics).toEqual(boq.total);
        expect(row?.status).toBe(boq.totalStatus);
      }
    });

    it('every status is exactly what the control engine gives for those figures', async () => {
      await project(pm, [[h1, 1_000]], [[h1, 800]]); // 80.00%
      const d = await dashboard(pm);
      for (const p of [...d.projects, d.summary])
        expect(p.status).toBe(calculateBudgetStatus(p.metrics.utilisationBp, DEFAULTS));
      expect(d.projects.map((p) => p.status)).toEqual(
        expect.arrayContaining(['WARNING', 'APPROVAL_REQUIRED', 'NORMAL']),
      );
    });

    it('reversed expenses and deleted projects do not count', async () => {
      const before = (await dashboard(admin)).summary;
      const p = await project(
        pm,
        [[h1, 10_000]],
        [
          [h1, 3_000],
          [h1, 2_000],
        ],
      );
      await call(pm, 'POST', `/api/projects/${p.id}/expenses/${p.expenseIds[0]}/reverse`, {
        reason: 'x',
      });
      const mid = (await dashboard(admin)).summary;
      expect(mid.projects).toBe(before.projects + 1);
      expect(mid.metrics.actual - before.metrics.actual).toBe(2_000);
      expect(mid.metrics.budget - before.metrics.budget).toBe(10_000);
      await call(admin, 'DELETE' as Method, `/api/projects/${p.id}`);
      expect((await dashboard(admin)).summary).toEqual(before);
    });
  });

  describe('access', () => {
    it('shows only the projects the user may see; administrators see all', async () => {
      const mine = await project(pm, [[h1, 1]], []);
      const theirs = await project(other, [[h1, 1]], []);
      const pmIds = (await dashboard(pm)).projects.map((p) => p.id);
      expect(pmIds).toContain(mine.id);
      expect(pmIds).not.toContain(theirs.id);
      const adminIds = (await dashboard(admin)).projects.map((p) => p.id);
      expect(adminIds).toEqual(expect.arrayContaining([mine.id, theirs.id]));

      expect((await dashboard(viewer)).projects).toEqual([]);
      await call(pm, 'PUT', `/api/projects/${mine.id}/members/${viewerId}`);
      expect((await dashboard(viewer)).projects.map((p) => p.id)).toEqual([mine.id]);
      expect((await call(null, 'GET', '/api/dashboard')).statusCode).toBe(401);
    });

    it('a user with no projects gets zeros, not an error', async () => {
      const lonely = await signIn(fx, (await makeUser(fx, { roleName: 'Viewer' })).email);
      expect(await dashboard(lonely)).toEqual({
        summary: {
          projects: 0,
          pendingApprovals: 0,
          metrics: { budget: 0, actual: 0, remaining: 0, utilisationBp: 0 },
          status: 'NORMAL',
        },
        projects: [],
      });
    });
  });

  describe('project BoQ: needs attention first', () => {
    it('orders heads approval, warning, normal, keeping display order within each', async () => {
      const h3 = await costHeadsRepository(fx.db.pool).create({
        code: 'D3',
        name: 'Head three',
        displayOrder: 3,
      });
      const p = await project(
        pm,
        [
          [h1, 1_000],
          [h2, 1_000],
          [h3, 1_000],
        ],
        [
          [h2, 900],
          [h3, 1_000],
        ],
      );
      const codes = async (q: string) =>
        ((await call(pm, 'GET', `/api/projects/${p.id}/boq${q}`)).json().data as ProjectBoq).rows
          .map((r) => r.costHead.code)
          .filter((c) => ['D1', 'D2', 'D3'].includes(c));
      expect(await codes('')).toEqual(['D1', 'D2', 'D3']);
      expect(await codes('?order=attention')).toEqual(['D3', 'D2', 'D1']);
      expect((await call(pm, 'GET', `/api/projects/${p.id}/boq?order=worst`)).statusCode).toBe(400);
    });
  });
});

describe.skipIf(!hasTestDb)(
  'dashboard performance: 100 projects x 32 heads x 5,000 expenses',
  () => {
    let fx: Fixture;
    let admin: Session;
    let member: Session;

    beforeAll(async () => {
      fx = await createAuthFixture();
      const a = await makeUser(fx, { roleName: 'Admin' });
      admin = await signIn(fx, a.email);
      const m = await makeUser(fx, { roleName: 'Viewer' });
      member = await signIn(fx, m.email);
      const { projectIds } = await seedPortfolio(fx.db.pool, {
        projects: 100,
        heads: 32,
        expenses: 5_000,
        ownerUserId: a.id,
      });
      // The member belongs to half the projects.
      for (const id of projectIds.filter((_, i) => i % 2 === 0))
        await fx.db.pool.query('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [
          id,
          m.id,
        ]);
    }, 120_000);
    afterAll(async () => {
      await fx.close();
    });

    const timeIt = async (s: Session) => {
      const times: number[] = [];
      let body: Dashboard | null = null;
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        const res = await fx.app.inject({
          method: 'GET',
          url: '/api/dashboard',
          headers: asUser(s),
        });
        times.push(performance.now() - t0);
        body = res.json().data;
      }
      times.sort((x, y) => x - y);
      return { median: times[3] as number, body: body as Dashboard };
    };

    it('loads in well under 300 ms (median of 7, including auth and the HTTP layer)', async () => {
      const all = await timeIt(admin);
      const half = await timeIt(member);
      expect(all.body.projects).toHaveLength(100);
      expect(half.body.projects).toHaveLength(50);
      expect(all.median).toBeLessThan(300);
      expect(half.median).toBeLessThan(300);
    });

    it('totals still equal the sum of project totals at this size', async () => {
      const { body } = await timeIt(admin);
      expect(body.summary.metrics.budget).toBe(
        body.projects.reduce((s, p) => s + p.metrics.budget, 0),
      );
      expect(body.summary.metrics.actual).toBe(
        body.projects.reduce((s, p) => s + p.metrics.actual, 0),
      );
      expect(body.summary.metrics.actual).toBeGreaterThan(0);
    });
  },
);
