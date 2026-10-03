import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../db/testing';
import { fils } from '@boq/shared';
import {
  auditLogRepository,
  costHeadsRepository,
  estimatesRepository,
  type CostHeadRecord,
} from '../repositories';
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

// Placeholder heads for tests only. Defaults come from the migration: warning 80.00%, approval 100.00%.
type Method = 'GET' | 'POST' | 'PUT';
type Row = { costHead: { id: string }; metrics: { utilisationBp: number }; status: string };

describe.skipIf(!hasTestDb)('budget status, projection and approval rules (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let pm: Session;
  let viewer: Session;
  let viewerId: string;
  let outsider: Session;
  let h1: CostHeadRecord;
  let h2: CostHeadRecord;

  beforeAll(async () => {
    fx = await createAuthFixture();
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const v = await makeUser(fx, { roleName: 'Viewer' });
    viewerId = v.id;
    viewer = await signIn(fx, v.email);
    outsider = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    h1 = await costHeadsRepository(fx.db.pool).create({
      code: 'C1',
      name: 'Head one',
      displayOrder: 1,
    });
    h2 = await costHeadsRepository(fx.db.pool).create({
      code: 'C2',
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
  let seq = 0;
  /** Budget 1,000.000 KWD on h1, none on h2. */
  const newProject = async () => {
    const id = (await call(pm, 'POST', '/api/projects', { code: `C-${++seq}`, name: 'p' })).json()
      .data.id as string;
    await call(admin, 'PUT', `/api/projects/${id}/estimates`, {
      estimates: [{ costHeadId: h1.id, amountFils: 1_000_000 }],
    });
    await call(pm, 'PUT', `/api/projects/${id}/members/${viewerId}`);
    // h2 is in the approved budget at 0: spend on it is the zero-budget case (D3).
    await estimatesRepository(fx.db.pool).upsert(id, h2.id, fils(0));
    return id;
  };
  /** Spend that lands in Actual: past the approval level it is approved by the admin. */
  const spend = async (p: string, amountFils: number, head = h1) => {
    const res = await call(pm, 'POST', `/api/projects/${p}/expenses`, {
      costHeadId: head.id,
      vendor: 'V',
      invoiceNo: `I-${++seq}`,
      expenseDate: '2026-04-01',
      amountFils,
      approvalReason: TEST_APPROVAL_REASON,
    });
    if (res.statusCode !== 201) throw new Error(res.body);
    await approveHeld(fx, admin, res.json().data);
    return res.json().data.id as string;
  };
  const boq = async (p: string) => (await call(pm, 'GET', `/api/projects/${p}/boq`)).json().data;
  const statusOf = async (p: string, head = h1) =>
    ((await boq(p)).rows as Row[]).find((r) => r.costHead.id === head.id)?.status;

  describe('status on the BoQ and the cost-head detail', () => {
    it('crosses 80% and 100% at exactly the right fils, and a reversal brings it back', async () => {
      const p = await newProject();
      expect(await statusOf(p)).toBe('NORMAL');
      await spend(p, 799_999); // 79.9999%
      expect(await statusOf(p)).toBe('NORMAL');
      await spend(p, 1); // 80.00%
      expect(await statusOf(p)).toBe('WARNING');
      const last = await spend(p, 200_000); // 100.00%
      expect(await statusOf(p)).toBe('APPROVAL_REQUIRED');
      await call(pm, 'POST', `/api/projects/${p}/expenses/${last}/reverse`, { reason: 'test' });
      expect(await statusOf(p)).toBe('WARNING');

      const detail = (await call(viewer, 'GET', `/api/projects/${p}/cost-heads/${h1.id}`)).json()
        .data;
      expect(detail.status).toBe('WARNING');
      expect(detail.metrics.utilisationBp).toBe(8000);
    });

    it('spend on a head without budget needs approval; the project total has its own status', async () => {
      const p = await newProject();
      await spend(p, 1, h2);
      const b = await boq(p);
      expect((b.rows as Row[]).find((r) => r.costHead.id === h2.id)?.status).toBe(
        'APPROVAL_REQUIRED',
      );
      expect(b.total.utilisationBp).toBe(0); // 0.001 of 1,000 KWD rounds down to 0.00%
      expect(b.totalStatus).toBe('NORMAL');
    });
  });

  describe('projection (Add Expense preview)', () => {
    it('reports the current and projected figures and status without saving anything', async () => {
      const p = await newProject();
      await spend(p, 700_000);
      const url = (amount: number) =>
        `/api/projects/${p}/cost-heads/${h1.id}/projection?amountFils=${amount}`;
      const warn = (await call(pm, 'GET', url(100_000))).json().data;
      expect(warn).toEqual({
        current: {
          metrics: { budget: 1_000_000, actual: 700_000, remaining: 300_000, utilisationBp: 7000 },
          status: 'NORMAL',
        },
        projected: {
          metrics: { budget: 1_000_000, actual: 800_000, remaining: 200_000, utilisationBp: 8000 },
          status: 'WARNING',
        },
      });
      expect((await call(pm, 'GET', url(300_000))).json().data.projected.status).toBe(
        'APPROVAL_REQUIRED',
      );
      expect((await call(pm, 'GET', url(99_999))).json().data.projected.status).toBe('NORMAL');
      expect((await boq(p)).total.actual).toBe(700_000); // nothing saved
    });

    it('validates the amount and the head; needs expense.create and project access', async () => {
      const p = await newProject();
      const base = `/api/projects/${p}/cost-heads/${h1.id}/projection`;
      expect((await call(pm, 'GET', `${base}?amountFils=0`)).statusCode).toBe(400);
      expect((await call(pm, 'GET', `${base}?amountFils=1.5`)).statusCode).toBe(400);
      expect((await call(pm, 'GET', base)).statusCode).toBe(400);
      expect(
        (
          await call(
            pm,
            'GET',
            `/api/projects/${p}/cost-heads/00000000-0000-1000-8000-000000000000/projection?amountFils=1`,
          )
        ).statusCode,
      ).toBe(404);
      expect((await call(viewer, 'GET', `${base}?amountFils=1`)).statusCode).toBe(403);
      expect((await call(outsider, 'GET', `${base}?amountFils=1`)).statusCode).toBe(403);
    });
  });

  describe('Admin > Approval Rules', () => {
    it('ships with the defaults; only admins may read or change them', async () => {
      const res = await call(admin, 'GET', '/api/admin/approval-rules');
      expect(res.json().data).toMatchObject({
        warningBp: 8000,
        approvalBp: 10000,
        updatedBy: null,
      });
      expect((await call(pm, 'GET', '/api/admin/approval-rules')).statusCode).toBe(403);
      expect(
        (await call(pm, 'PUT', '/api/admin/approval-rules', { warningBp: 1, approvalBp: 2 }))
          .statusCode,
      ).toBe(403);
    });

    it.each([
      [{ warningBp: 9000, approvalBp: 9000 }],
      [{ warningBp: 9500, approvalBp: 9000 }],
      [{ warningBp: 8000, approvalBp: 10001 }],
      [{ warningBp: 80, approvalBp: '100' }],
      [{ warningBp: 80.5, approvalBp: 10000 }],
      [{ warningBp: 8000 }],
    ])('rejects %j with 400', async (body) => {
      expect((await call(admin, 'PUT', '/api/admin/approval-rules', body)).statusCode).toBe(400);
    });

    it('a change applies to every status on the next request, and is audited once', async () => {
      const p = await newProject();
      await spend(p, 760_000); // 76%
      expect(await statusOf(p)).toBe('NORMAL');
      try {
        const res = await call(admin, 'PUT', '/api/admin/approval-rules', {
          warningBp: 7500,
          approvalBp: 9500,
        });
        expect(res.json().data).toMatchObject({ warningBp: 7500, approvalBp: 9500 });
        expect(await statusOf(p)).toBe('WARNING');
        await spend(p, 190_000); // 95%
        expect(await statusOf(p)).toBe('APPROVAL_REQUIRED');
        await call(admin, 'PUT', '/api/admin/approval-rules', {
          warningBp: 7500,
          approvalBp: 9500,
        }); // no-op
        const rows = await auditLogRepository(fx.db.pool).listForEntity('budget_thresholds', '1');
        expect(rows.map((r) => [r.event, r.before, r.after])).toEqual([
          [
            'budget_thresholds.updated',
            { warningBp: 8000, approvalBp: 10000 },
            { warningBp: 7500, approvalBp: 9500 },
          ],
        ]);
      } finally {
        await call(admin, 'PUT', '/api/admin/approval-rules', {
          warningBp: 8000,
          approvalBp: 10000,
        });
      }
      expect(await statusOf(p)).toBe('WARNING'); // 95% under the defaults
    });
  });
});
