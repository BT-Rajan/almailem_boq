import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../db/testing';
import { auditLogRepository, costHeadsRepository, type CostHeadRecord } from '../repositories';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';

// Placeholder cost heads for tests only, not real ones.
const MISSING = '00000000-0000-1000-8000-000000000000';
type Method = 'GET' | 'POST' | 'PUT';
type Metrics = { budget: number; actual: number; remaining: number; utilisationBp: number };
type Boq = {
  rows: { costHead: { id: string; code: string; active: boolean }; metrics: Metrics }[];
  total: Metrics;
  editable: boolean;
};

describe.skipIf(!hasTestDb)('project BoQ and estimates (real MariaDB)', () => {
  let fx: Fixture;
  let pm: Session;
  let viewer: Session;
  let viewerId: string;
  let outsider: Session;
  let heads: CostHeadRecord[];
  let inactive: CostHeadRecord;

  beforeAll(async () => {
    fx = await createAuthFixture();
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const v = await makeUser(fx, { roleName: 'Viewer' });
    viewerId = v.id;
    viewer = await signIn(fx, v.email);
    outsider = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const repo = costHeadsRepository(fx.db.pool);
    heads = [];
    for (let i = 1; i <= 4; i++)
      heads.push(await repo.create({ code: `H${i}`, name: `Head ${i}`, displayOrder: i }));
    inactive = await repo.create({
      code: 'HX',
      name: 'Retired head',
      displayOrder: 9,
      active: false,
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
  let seq = 0;
  const newProject = async () =>
    (await call(pm, 'POST', '/api/projects', { code: `E-${++seq}`, name: 'p' })).json().data as {
      id: string;
    };
  const getBoq = async (id: string, s: Session = pm) =>
    (await call(s, 'GET', `/api/projects/${id}/boq`)).json().data as Boq;
  const setEst = (id: string, rows: [CostHeadRecord | string, number][], s: Session = pm) =>
    call(s, 'PUT', `/api/projects/${id}/estimates`, {
      estimates: rows.map(([h, amountFils]) => ({
        costHeadId: typeof h === 'string' ? h : h.id,
        amountFils,
      })),
    });
  const estimateAudit = async (id: string) =>
    (await auditLogRepository(fx.db.pool).listForEntity('project', id)).filter(
      (r) => r.event === 'estimate.changed',
    );

  it('a new project lists every active head with zero budget, in display order', async () => {
    const p = await newProject();
    const b = await getBoq(p.id);
    expect(b.rows.map((r) => r.costHead.code)).toEqual(['H1', 'H2', 'H3', 'H4']);
    for (const r of b.rows)
      expect(r.metrics).toEqual({ budget: 0, actual: 0, remaining: 0, utilisationBp: 0 });
    expect(b.total).toEqual({ budget: 0, actual: 0, remaining: 0, utilisationBp: 0 });
    expect(b.editable).toBe(true);
  });

  it('sets budgets; metrics come back computed; totals equal the sum of heads', async () => {
    const p = await newProject();
    const res = await setEst(p.id, [
      [heads[0] as CostHeadRecord, 1_250_500],
      [heads[2] as CostHeadRecord, 7_000_000_000],
    ]);
    expect(res.statusCode).toBe(200);
    const b = res.json().data as Boq;
    const row = (code: string) => b.rows.find((r) => r.costHead.code === code)?.metrics;
    expect(row('H1')).toEqual({
      budget: 1_250_500,
      actual: 0,
      remaining: 1_250_500,
      utilisationBp: 0,
    });
    expect(row('H3')?.budget).toBe(7_000_000_000);
    expect(b.total.budget).toBe(b.rows.reduce((s, r) => s + r.metrics.budget, 0));
    expect(b.total.remaining).toBe(b.rows.reduce((s, r) => s + r.metrics.remaining, 0));
    expect(b.total.actual).toBe(0);
    expect(await getBoq(p.id)).toEqual(b); // GET agrees with the PUT response
  });

  it('audits each real change with before/after; unchanged rows write nothing', async () => {
    const p = await newProject();
    const h1 = heads[0] as CostHeadRecord;
    const h2 = heads[1] as CostHeadRecord;
    await setEst(p.id, [
      [h1, 100],
      [h2, 0],
    ]); // h2 0 -> 0 is no change
    await setEst(p.id, [[h1, 250]]);
    await setEst(p.id, [[h1, 250]]); // no change
    await setEst(p.id, [[h1, 0]]); // cleared
    const rows = await estimateAudit(p.id);
    expect(rows.map((r) => [r.before, r.after])).toEqual([
      [
        { costHeadId: h1.id, code: 'H1', amountFils: 0 },
        { costHeadId: h1.id, code: 'H1', amountFils: 100 },
      ],
      [
        { costHeadId: h1.id, code: 'H1', amountFils: 100 },
        { costHeadId: h1.id, code: 'H1', amountFils: 250 },
      ],
      [
        { costHeadId: h1.id, code: 'H1', amountFils: 250 },
        { costHeadId: h1.id, code: 'H1', amountFils: 0 },
      ],
    ]);
    expect(rows.every((r) => r.actorUserId !== null)).toBe(true);
  });

  it('an unknown head fails the whole batch; nothing is saved', async () => {
    const p = await newProject();
    const res = await setEst(p.id, [
      [heads[0] as CostHeadRecord, 500],
      [MISSING, 1],
    ]);
    expect(res.statusCode).toBe(404);
    expect((await getBoq(p.id)).total.budget).toBe(0);
    expect(await estimateAudit(p.id)).toEqual([]);
  });

  it('inactive heads take no new budget; one that already has a budget stays visible and counted', async () => {
    const p = await newProject();
    expect((await setEst(p.id, [[inactive, 10]])).statusCode).toBe(409);
    expect((await setEst(p.id, [[inactive, 0]])).statusCode).toBe(200);

    const h4 = heads[3] as CostHeadRecord;
    await setEst(p.id, [[h4, 900]]);
    await costHeadsRepository(fx.db.pool).update(h4.id, { active: false });
    try {
      const b = await getBoq(p.id);
      expect(b.rows.find((r) => r.costHead.id === h4.id)).toMatchObject({
        costHead: { active: false },
        metrics: { budget: 900 },
      });
      expect(b.total.budget).toBe(900);
      expect((await setEst(p.id, [[h4, 1000]])).statusCode).toBe(409);
      expect((await setEst(p.id, [[h4, 0]])).statusCode).toBe(200);
      expect((await getBoq(p.id)).rows.some((r) => r.costHead.id === h4.id)).toBe(false);
    } finally {
      await costHeadsRepository(fx.db.pool).update(h4.id, { active: true });
    }
  });

  it('budgets are locked once a project is completed or cancelled', async () => {
    const p = await newProject();
    await call(pm, 'POST', `/api/projects/${p.id}/status`, { status: 'cancelled' });
    const res = await setEst(p.id, [[heads[0] as CostHeadRecord, 1]]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BUDGET_LOCKED');
    expect((await getBoq(p.id)).editable).toBe(false);
  });

  it.each([[-1], [1.5], ['100'], [Number.MAX_SAFE_INTEGER + 1]])(
    'rejects amount %s with 400',
    async (amount) => {
      const p = await newProject();
      const res = await call(pm, 'PUT', `/api/projects/${p.id}/estimates`, {
        estimates: [{ costHeadId: (heads[0] as CostHeadRecord).id, amountFils: amount }],
      });
      expect(res.statusCode).toBe(400);
    },
  );

  it('largest safe amount works; a project total beyond the safe range is refused and rolled back', async () => {
    const p = await newProject();
    const max = Number.MAX_SAFE_INTEGER;
    expect((await setEst(p.id, [[heads[0] as CostHeadRecord, max]])).json().data.total.budget).toBe(
      max,
    );
    const res = await setEst(p.id, [[heads[1] as CostHeadRecord, 1]]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect((await getBoq(p.id)).total.budget).toBe(max);
  });

  it('concurrent edits of one head apply one after the other (audit chain stays consistent)', async () => {
    const p = await newProject();
    const h1 = heads[0] as CostHeadRecord;
    await Promise.all([setEst(p.id, [[h1, 111]]), setEst(p.id, [[h1, 222]])]);
    const rows = await estimateAudit(p.id);
    expect(rows).toHaveLength(2);
    expect((rows[1]?.before as { amountFils: number }).amountFils).toBe(
      (rows[0]?.after as { amountFils: number }).amountFils,
    );
    const final = (await getBoq(p.id)).rows.find((r) => r.costHead.id === h1.id)?.metrics.budget;
    expect(final).toBe((rows[1]?.after as { amountFils: number }).amountFils);
  });

  describe('access', () => {
    it('non-members get 403 on both routes; signed-out 401', async () => {
      const p = await newProject();
      expect((await call(outsider, 'GET', `/api/projects/${p.id}/boq`)).statusCode).toBe(403);
      expect((await setEst(p.id, [[heads[0] as CostHeadRecord, 1]], outsider)).statusCode).toBe(
        403,
      );
      expect((await call(null, 'GET', `/api/projects/${p.id}/boq`)).statusCode).toBe(401);
    });

    it('a Viewer member reads the BoQ but cannot change budgets', async () => {
      const p = await newProject();
      await call(pm, 'PUT', `/api/projects/${p.id}/members/${viewerId}`);
      expect((await call(viewer, 'GET', `/api/projects/${p.id}/boq`)).statusCode).toBe(200);
      expect((await setEst(p.id, [[heads[0] as CostHeadRecord, 1]], viewer)).statusCode).toBe(403);
    });
  });
});
