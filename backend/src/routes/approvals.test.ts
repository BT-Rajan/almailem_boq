import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApprovalItem, Expense } from '@boq/shared';
import { hasTestDb } from '../db/testing';
import {
  approvalsRepository,
  auditLogRepository,
  costHeadsRepository,
  type CostHeadRecord,
} from '../repositories';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';

// Placeholder heads and vendors for tests only. Default thresholds: 80.00% / 100.00%.
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

describe.skipIf(!hasTestDb)('approval workflow (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let admin2: Session;
  let pm: Session;
  let accountant: Session;
  let accountantId: string;
  let viewer: Session;
  let viewerId: string;
  let h1: CostHeadRecord;
  let h2: CostHeadRecord;

  beforeAll(async () => {
    fx = await createAuthFixture();
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    admin2 = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const acc = await makeUser(fx, { roleName: 'Accountant' });
    accountantId = acc.id;
    accountant = await signIn(fx, acc.email);
    const v = await makeUser(fx, { roleName: 'Viewer' });
    viewerId = v.id;
    viewer = await signIn(fx, v.email);
    h1 = await costHeadsRepository(fx.db.pool).create({ code: 'A1', name: 'Head one' });
    h2 = await costHeadsRepository(fx.db.pool).create({ code: 'A2', name: 'Head two' });
  });
  afterAll(async () => {
    await fx.close();
  });

  const call = (s: Session, method: Method, url: string, payload?: unknown) =>
    fx.app.inject({
      method,
      url,
      headers: asUser(s, method !== 'GET'),
      ...(payload !== undefined && { payload: payload as object }),
    });
  let seq = 0;
  /** Budget 1,000.000 KWD on h1 and none on h2; the accountant and viewer are members. */
  const newProject = async () => {
    const id = (await call(pm, 'POST', '/api/projects', { code: `AP-${++seq}`, name: 'p' })).json()
      .data.id as string;
    await call(admin, 'PUT', `/api/projects/${id}/estimates`, {
      estimates: [{ costHeadId: h1.id, amountFils: 1_000_000 }],
    });
    await call(pm, 'PUT', `/api/projects/${id}/members/${accountantId}`);
    await call(pm, 'PUT', `/api/projects/${id}/members/${viewerId}`);
    return id;
  };
  const add = (p: string, amountFils: number, extra: Record<string, unknown> = {}, s = pm) =>
    call(s, 'POST', `/api/projects/${p}/expenses`, {
      costHeadId: h1.id,
      vendor: 'Acme Trading',
      invoiceNo: `INV-${++seq}`,
      expenseDate: '2026-09-01',
      amountFils,
      ...extra,
    });
  const addOk = async (p: string, amountFils: number, extra: Record<string, unknown> = {}) => {
    const res = await add(p, amountFils, extra);
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json().data as Expense;
  };
  /** A held expense of `amountFils` on h1, asked for with a reason. */
  const held = async (p: string, amountFils = 1_050_000, s = pm) => {
    const res = await add(p, amountFils, { approvalReason: 'Extra steel after redesign' }, s);
    if (res.statusCode !== 201) throw new Error(res.body);
    const e = res.json().data as Expense;
    expect(e.status).toBe('PENDING_APPROVAL');
    return { expense: e, approvalId: e.approval?.id as string };
  };
  const actual = async (p: string, head = h1): Promise<number> => {
    const boq = (await call(pm, 'GET', `/api/projects/${p}/boq`)).json().data;
    return boq.rows.find((r: { costHead: { id: string } }) => r.costHead.id === head.id).metrics
      .actual;
  };
  const approve = (id: string, s = admin, comment?: string) =>
    call(s, 'POST', `/api/approvals/${id}/approve`, comment ? { comment } : {});
  const reject = (id: string, comment: unknown = 'Not in the contract', s = admin) =>
    call(s, 'POST', `/api/approvals/${id}/reject`, { comment });
  const pendingList = async (s = admin) =>
    (await call(s, 'GET', '/api/approvals?pageSize=100')).json().data.items as ApprovalItem[];
  const expenseOf = async (p: string, id: string) =>
    (
      (await call(pm, 'GET', `/api/projects/${p}/expenses?pageSize=100`)).json().data
        .items as Expense[]
    ).find((e) => e.id === id) as Expense;

  describe('acceptance', () => {
    it('under budget flows normally; warning (80-99%) needs no approval', async () => {
      const p = await newProject();
      const e = await addOk(p, 850_000); // 85%: warning
      expect(e).toMatchObject({ status: 'POSTED', approval: null });
      expect(await actual(p)).toBe(850_000);
      const last = await addOk(p, 149_999); // 99.9999%
      expect(last.status).toBe('POSTED');
      expect(await actual(p)).toBe(999_999);
    });

    it('crossing 100% creates a request with the mandatory reason; Actual does not move', async () => {
      const p = await newProject();
      await addOk(p, 900_000);
      const noReason = await add(p, 100_000); // exactly 100%
      expect(noReason.statusCode).toBe(400);
      expect(noReason.json().error.details).toEqual([
        { path: 'approvalReason', message: expect.stringMatching(/reason/) },
      ]);
      expect((await add(p, 100_000, { approvalReason: '   ' })).statusCode).toBe(400);

      const { expense, approvalId } = await held(p, 100_000);
      expect(expense.approval).toMatchObject({
        status: 'PENDING',
        reason: 'Extra steel after redesign',
      });
      expect(await actual(p)).toBe(900_000);

      const item = (await pendingList()).find((a) => a.id === approvalId) as ApprovalItem;
      expect(item).toMatchObject({
        status: 'PENDING',
        project: { id: p },
        costHead: { id: h1.id, code: 'A1' },
        expense: { id: expense.id, amountFils: 100_000, vendor: 'Acme Trading' },
        reason: 'Extra steel after redesign',
        requestedBp: 10_000,
      });
      // The head now, and after this expense, from the control engine.
      expect(item.now?.current.metrics.utilisationBp).toBe(9_000);
      expect(item.now?.projected).toMatchObject({
        status: 'APPROVAL_REQUIRED',
        metrics: { actual: 1_000_000, utilisationBp: 10_000 },
      });

      const audit = await auditLogRepository(fx.db.pool).listForEntity('approval', approvalId);
      expect(audit.map((r) => r.event)).toEqual(['approval.requested']);
      const steps = await approvalsRepository(fx.db.pool).listActions(approvalId);
      expect(steps).toMatchObject([{ action: 'REQUESTED', from: null, to: 'PENDING' }]);
    });

    it('spend on a head with no budget needs approval (D3)', async () => {
      const p = await newProject();
      const res = await add(p, 1, { costHeadId: h2.id, approvalReason: 'Unbudgeted' });
      expect(res.json().data.status).toBe('PENDING_APPROVAL');
      expect(await actual(p, h2)).toBe(0);
    });

    it('approve promotes the expense into Actual, exactly once, with a full record', async () => {
      const p = await newProject();
      await addOk(p, 600_000);
      const { expense, approvalId } = await held(p, 450_000);
      const res = await approve(approvalId, admin, 'Agreed with the client');
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        status: 'APPROVED',
        decisionComment: 'Agreed with the client',
        decidedBp: 10_500,
        now: null,
      });
      expect(await actual(p)).toBe(1_050_000);
      expect(await expenseOf(p, expense.id)).toMatchObject({
        status: 'POSTED',
        approval: { status: 'APPROVED', decisionComment: 'Agreed with the client' },
      });

      const again = await approve(approvalId, admin2);
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('INVALID_TRANSITION');
      expect((await reject(approvalId)).statusCode).toBe(409);
      expect(await actual(p)).toBe(1_050_000);

      const audit = await auditLogRepository(fx.db.pool).listForEntity('approval', approvalId);
      expect(audit.map((r) => [r.event, r.before, r.after])).toEqual([
        ['approval.requested', null, expect.anything()],
        [
          'approval.approved',
          { status: 'PENDING' },
          expect.objectContaining({ status: 'APPROVED', comment: 'Agreed with the client' }),
        ],
      ]);
      const steps = await approvalsRepository(fx.db.pool).listActions(approvalId);
      expect(steps.map((s) => [s.action, s.from, s.to])).toEqual([
        ['REQUESTED', null, 'PENDING'],
        ['APPROVED', 'PENDING', 'APPROVED'],
      ]);
    });

    it('reject keeps the expense out of Actual and needs a comment', async () => {
      const p = await newProject();
      const { expense, approvalId } = await held(p);
      expect((await reject(approvalId, '')).statusCode).toBe(400);
      expect(
        (await call(admin, 'POST', `/api/approvals/${approvalId}/reject`, {})).statusCode,
      ).toBe(400);
      const res = await reject(approvalId);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        status: 'REJECTED',
        decisionComment: 'Not in the contract',
      });
      expect(await actual(p)).toBe(0);
      expect((await expenseOf(p, expense.id)).status).toBe('REJECTED');
      expect((await approve(approvalId)).statusCode).toBe(409); // a rejection is final
      expect(await actual(p)).toBe(0);
    });

    it('two administrators approving at once: exactly one succeeds', async () => {
      const p = await newProject();
      const { approvalId } = await held(p, 1_200_000);
      const results = await Promise.all([approve(approvalId, admin), approve(approvalId, admin2)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await actual(p)).toBe(1_200_000);
    });

    it('the requester cannot approve their own request, even as an administrator', async () => {
      const p = await newProject();
      const { approvalId } = await held(p, 1_100_000, admin);
      const self = await approve(approvalId, admin);
      expect(self.statusCode).toBe(403);
      expect(self.json().error.code).toBe('SELF_APPROVAL');
      expect((await reject(approvalId, 'mine', admin)).statusCode).toBe(403);
      expect(await actual(p)).toBe(0);
      expect((await approve(approvalId, admin2)).statusCode).toBe(200); // another admin can
      expect(await actual(p)).toBe(1_100_000);
    });

    it('non-admins get 403 on every deciding route; the requester is not special', async () => {
      const p = await newProject();
      const { approvalId } = await held(p);
      for (const s of [pm, accountant, viewer]) {
        expect((await call(s, 'GET', '/api/approvals')).statusCode).toBe(403);
        expect((await approve(approvalId, s)).statusCode).toBe(403);
        expect((await reject(approvalId, 'no', s)).statusCode).toBe(403);
      }
      expect(await actual(p)).toBe(0);
    });
  });

  describe('re-evaluation and the rest of the lifecycle', () => {
    it('re-evaluates at decision time with the control engine: the budget may have changed', async () => {
      const p = await newProject();
      const { approvalId } = await held(p, 1_050_000); // 105% when asked
      await call(admin, 'PUT', `/api/projects/${p}/estimates`, {
        estimates: [{ costHeadId: h1.id, amountFils: 2_100_000 }],
      });
      const item = (await pendingList()).find((a) => a.id === approvalId) as ApprovalItem;
      expect(item.requestedBp).toBe(10_500);
      expect(item.now?.projected).toMatchObject({
        status: 'NORMAL',
        metrics: { utilisationBp: 5_000 },
      });
      const res = await approve(approvalId);
      expect(res.json().data).toMatchObject({ requestedBp: 10_500, decidedBp: 5_000 });
      const steps = await approvalsRepository(fx.db.pool).listActions(approvalId);
      expect(steps.map((s) => s.projectedBp)).toEqual([10_500, 5_000]);
    });

    it('the requester can cancel a waiting request; nobody else can', async () => {
      const p = await newProject();
      const { expense, approvalId } = await held(p);
      const url = `/api/projects/${p}/expenses/${expense.id}/cancel-approval`;
      expect((await call(accountant, 'POST', url)).statusCode).toBe(403); // a member, not the requester
      expect((await call(viewer, 'POST', url)).statusCode).toBe(403); // no approval.request
      const res = await call(pm, 'POST', url);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ status: 'CANCELLED', decidedBy: null });
      expect((await expenseOf(p, expense.id)).status).toBe('CANCELLED');
      expect((await call(pm, 'POST', url)).statusCode).toBe(409);
      expect((await approve(approvalId)).statusCode).toBe(409);
      expect(await actual(p)).toBe(0);
    });

    it('a held invoice blocks a duplicate; a rejected or cancelled one frees it', async () => {
      const p = await newProject();
      const body = { invoiceNo: 'DUP-1', approvalReason: 'Needed' };
      const first = (await add(p, 1_100_000, body)).json().data as Expense;
      expect((await add(p, 10, { invoiceNo: 'DUP-1' })).statusCode).toBe(409);
      await reject(first.approval?.id as string);
      const again = await add(p, 10, { invoiceNo: 'DUP-1' });
      expect(again.statusCode).toBe(201);
      expect(again.json().data.status).toBe('POSTED');
    });

    it('a held, rejected or cancelled expense cannot be edited or reversed', async () => {
      const p = await newProject();
      const { expense, approvalId } = await held(p);
      const edit = () =>
        call(pm, 'PATCH', `/api/projects/${p}/expenses/${expense.id}`, { vendor: 'Other' });
      const rev = () =>
        call(pm, 'POST', `/api/projects/${p}/expenses/${expense.id}/reverse`, { reason: 'x' });
      expect((await edit()).statusCode).toBe(409);
      expect((await rev()).statusCode).toBe(409);
      await reject(approvalId);
      expect((await edit()).statusCode).toBe(409);
      expect((await rev()).statusCode).toBe(409);
    });

    it('an edit that would add spend past 100% is refused; less spend is always allowed', async () => {
      const p = await newProject();
      const e = await addOk(p, 900_000);
      const patch = (body: object) =>
        call(pm, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, body);
      const up = await patch({ amountFils: 1_000_000 });
      expect(up.statusCode).toBe(409);
      expect(up.json().error.code).toBe('APPROVAL_REQUIRED');
      expect((await patch({ costHeadId: h2.id })).statusCode).toBe(409); // h2 has no budget
      expect((await patch({ amountFils: 999_999 })).statusCode).toBe(200);
      expect((await patch({ amountFils: 500_000 })).statusCode).toBe(200);
      expect(await actual(p)).toBe(500_000);
    });

    it('approving needs an open project; rejecting does not', async () => {
      const p = await newProject();
      const a = await held(p);
      const b = await held(p);
      await call(pm, 'POST', `/api/projects/${p}/status`, { status: 'cancelled' });
      const res = await approve(a.approvalId);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('PROJECT_CLOSED');
      expect((await reject(b.approvalId)).statusCode).toBe(200);
      expect(await actual(p)).toBe(0);
    });

    it('lists by status, oldest waiting first', async () => {
      const p = await newProject();
      const a = await held(p);
      const b = await held(p);
      const ids = (await pendingList()).map((x) => x.id);
      expect(ids.indexOf(a.approvalId)).toBeLessThan(ids.indexOf(b.approvalId));
      await approve(a.approvalId);
      expect((await pendingList()).map((x) => x.id)).not.toContain(a.approvalId);
      const approved = (await call(admin, 'GET', '/api/approvals?status=APPROVED&pageSize=100'))
        .json()
        .data.items.map((x: ApprovalItem) => x.id);
      expect(approved).toContain(a.approvalId);
      expect((await call(admin, 'GET', '/api/approvals?status=NOPE')).statusCode).toBe(400);
    });

    it('the dashboard counts waiting requests in the projects the user can see', async () => {
      const before = (await call(admin, 'GET', '/api/dashboard')).json().data.summary
        .pendingApprovals as number;
      const p = await newProject();
      await held(p);
      await held(p);
      expect(
        (await call(admin, 'GET', '/api/dashboard')).json().data.summary.pendingApprovals,
      ).toBe(before + 2);
      const outsider = await signIn(fx, (await makeUser(fx, { roleName: 'Accountant' })).email);
      expect(
        (await call(outsider, 'GET', '/api/dashboard')).json().data.summary.pendingApprovals,
      ).toBe(0);
    });

    it('the history is append-only', async () => {
      const p = await newProject();
      const { approvalId } = await held(p);
      await expect(
        fx.db.pool.query("UPDATE approval_actions SET comment = 'x' WHERE approval_id = ?", [
          approvalId,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        fx.db.pool.query('DELETE FROM approval_actions WHERE approval_id = ?', [approvalId]),
      ).rejects.toThrow(/append-only/);
    });
  });
});
