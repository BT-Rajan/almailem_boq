import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BudgetProposal, CostStructure } from '@boq/shared';
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

// Placeholder heads for tests only.
type Method = 'GET' | 'POST' | 'PUT';

describe.skipIf(!hasTestDb)('budget (cost structure) approval (real MariaDB)', () => {
  let fx: Fixture;
  let admin: Session;
  let pm: Session;
  let viewer: Session;
  let viewerId: string;
  let h1: CostHeadRecord;
  let h2: CostHeadRecord;
  let h3: CostHeadRecord;

  beforeAll(async () => {
    fx = await createAuthFixture();
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const v = await makeUser(fx, { roleName: 'Viewer' });
    viewerId = v.id;
    viewer = await signIn(fx, v.email);
    const heads = costHeadsRepository(fx.db.pool);
    h1 = await heads.create({ code: 'B1', name: 'Head one', displayOrder: 1 });
    h2 = await heads.create({ code: 'B2', name: 'Head two', displayOrder: 2 });
    h3 = await heads.create({ code: 'B3', name: 'Head three', displayOrder: 3 });
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
  const newProject = async () => {
    const id = (await call(pm, 'POST', '/api/projects', { name: `p ${++seq}` })).json().data
      .id as string;
    await call(pm, 'PUT', `/api/projects/${id}/members/${viewerId}`);
    return id;
  };
  const submit = (p: string, lines: [CostHeadRecord, number][], s = pm) =>
    call(s, 'POST', `/api/projects/${p}/cost-structure/proposals`, {
      lines: lines.map(([h, amountFils]) => ({ costHeadId: h.id, amountFils })),
    });
  const submitOk = async (p: string, lines: [CostHeadRecord, number][]) => {
    const res = await submit(p, lines);
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json().data as BudgetProposal;
  };
  const structure = async (p: string) =>
    (await call(viewer, 'GET', `/api/projects/${p}/cost-structure`)).json().data as CostStructure;
  const budgets = async (p: string) =>
    Object.fromEntries(
      (await call(pm, 'GET', `/api/projects/${p}/boq`))
        .json()
        .data.rows.map((r: { costHead: { code: string }; metrics: { budget: number } }) => [
          r.costHead.code,
          r.metrics.budget,
        ]),
    );
  const decide = (id: string, verb: 'approve' | 'reject', s = admin) =>
    call(s, 'POST', `/api/approvals/${id}/${verb}`, verb === 'reject' ? { comment: 'No' } : {});

  it('set-up: the proposal waits for an admin and is never counted as budget until approved', async () => {
    const p = await newProject();
    const proposal = await submitOk(p, [
      [h1, 1_000_000],
      [h2, 0],
    ]);
    expect(proposal).toMatchObject({
      status: 'PENDING',
      approvedTotalFils: 0,
      proposedTotalFils: 1_000_000,
    });
    expect(
      proposal.lines.map((l) => [l.costHead.code, l.change, l.approvedFils, l.amountFils]),
    ).toEqual([
      ['B1', 'ADDED', null, 1_000_000],
      ['B2', 'ADDED', null, 0],
    ]);
    expect(await budgets(p)).toEqual({ B1: 0, B2: 0, B3: 0 });
    expect((await structure(p)).approved).toEqual([]);
    expect((await structure(p)).latest?.status).toBe('PENDING');

    // The admin sees exactly the proposal, with its total.
    const listed = (await call(admin, 'GET', '/api/approvals/cost-structures')).json().data
      .items as BudgetProposal[];
    expect(listed.find((x) => x.id === proposal.id)).toMatchObject({
      proposedTotalFils: 1_000_000,
    });

    expect((await decide(proposal.id, 'approve')).statusCode).toBe(200);
    expect(await budgets(p)).toEqual({ B1: 1_000_000, B2: 0, B3: 0 });
    const s = await structure(p);
    expect(s.approved.map((l) => [l.costHead.code, l.amountFils])).toEqual([
      ['B1', 1_000_000],
      ['B2', 0],
    ]);
    expect(s.approvedTotalFils).toBe(1_000_000);
  });

  it('changes after approval: add, change and remove are proposed, then applied atomically', async () => {
    const p = await newProject();
    await decide(
      (
        await submitOk(p, [
          [h1, 1_000_000],
          [h2, 500_000],
        ])
      ).id,
      'approve',
    );
    const change = await submitOk(p, [
      [h1, 1_200_000], // change
      [h3, 300_000], // add; h2 left out: remove
    ]);
    expect(
      change.lines.map((l) => [l.costHead.code, l.change, l.approvedFils, l.amountFils]),
    ).toEqual([
      ['B1', 'CHANGED', 1_000_000, 1_200_000],
      ['B2', 'REMOVED', 500_000, null],
      ['B3', 'ADDED', null, 300_000],
    ]);
    // Pending: the approved budget and its figures are untouched.
    expect(await budgets(p)).toEqual({ B1: 1_000_000, B2: 500_000, B3: 0 });
    // A second, conflicting change cannot wait at the same time.
    const second = await submit(p, [
      [h1, 1_500_000],
      [h2, 500_000],
    ]);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.message).toMatch(/awaiting Admin approval/);

    expect((await decide(change.id, 'approve')).statusCode).toBe(200);
    expect(await budgets(p)).toEqual({ B1: 1_200_000, B2: 0, B3: 300_000 });
    expect((await structure(p)).approved.map((l) => l.costHead.code)).toEqual(['B1', 'B3']);
    const events = (await auditLogRepository(fx.db.pool).listForEntity('project', p)).map((r) => [
      r.event,
      r.before,
      r.after,
    ]);
    expect(events).toContainEqual([
      'estimate.changed',
      expect.objectContaining({ code: 'B1', amountFils: 1_000_000 }),
      expect.objectContaining({ code: 'B1', amountFils: 1_200_000 }),
    ]);
    expect(events).toContainEqual([
      'estimate.removed',
      expect.objectContaining({ code: 'B2', amountFils: 500_000 }),
      expect.objectContaining({ code: 'B2', amountFils: null }),
    ]);
    const request = (await auditLogRepository(fx.db.pool).listForEntity('approval', change.id))[0];
    expect(request?.after).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          change: 'CHANGED',
          approvedFils: 1_000_000,
          proposedFils: 1_200_000,
        }),
      ]),
    });
  });

  it('a head with expenses cannot be removed; its estimate can still change', async () => {
    const p = await newProject();
    await decide(
      (
        await submitOk(p, [
          [h1, 1_000_000],
          [h2, 500_000],
        ])
      ).id,
      'approve',
    );
    const spend = await call(pm, 'POST', `/api/projects/${p}/expenses`, {
      costHeadId: h2.id,
      vendor: 'V',
      invoiceNo: `I-${seq}`,
      expenseDate: '2026-09-01',
      amountFils: 100_000,
    });
    expect(spend.statusCode).toBe(201);
    expect((await structure(p)).lockedHeadIds).toEqual([h2.id]);
    const removal = await submit(p, [[h1, 1_000_000]]);
    expect(removal.statusCode).toBe(409);
    expect(removal.json().error).toMatchObject({
      code: 'HEAD_HAS_EXPENSES',
      message: expect.stringMatching(/cannot be removed because expenses exist/),
    });
    expect(
      (
        await submit(p, [
          [h1, 1_000_000],
          [h2, 700_000],
        ])
      ).statusCode,
    ).toBe(201);
  });

  it('rejection leaves the approved budget untouched, and the requester can resubmit', async () => {
    const p = await newProject();
    await decide((await submitOk(p, [[h1, 1_000_000]])).id, 'approve');
    const change = await submitOk(p, [[h1, 2_000_000]]);
    const res = await decide(change.id, 'reject');
    expect(res.json().data).toMatchObject({ status: 'REJECTED', decisionComment: 'No' });
    expect(await budgets(p)).toMatchObject({ B1: 1_000_000 });
    expect((await submit(p, [[h1, 1_100_000]])).statusCode).toBe(201);
  });

  it('nobody but an admin decides or writes budgets directly; the requester never decides', async () => {
    const p = await newProject();
    const proposal = await submitOk(p, [[h1, 1_000_000]]);
    expect((await call(pm, 'GET', '/api/approvals/cost-structures')).statusCode).toBe(403);
    expect((await decide(proposal.id, 'approve', pm)).statusCode).toBe(403);
    const direct = await call(pm, 'PUT', `/api/projects/${p}/estimates`, {
      estimates: [{ costHeadId: h1.id, amountFils: 9_000_000 }],
    });
    expect(direct.statusCode).toBe(403);
    expect((await submit(p, [[h1, 5]], viewer)).statusCode).toBe(403);
    expect(await budgets(p)).toMatchObject({ B1: 0 });

    const own = await await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    const p2 = await newProject();
    const mine = (await submit(p2, [[h1, 10]], own)).json().data as BudgetProposal;
    expect((await decide(mine.id, 'approve', own)).json().error.code).toBe('SELF_APPROVAL');
  });

  it('refuses a request that changes nothing, and a stale one at approval', async () => {
    const p = await newProject();
    await decide((await submitOk(p, [[h1, 1_000_000]])).id, 'approve');
    expect((await submit(p, [[h1, 1_000_000]])).json().error.message).toMatch(/Nothing changed/);
    const change = await submitOk(p, [[h1, 1_500_000]]);
    // An administrator corrected the budget directly after the request was made.
    await call(admin, 'PUT', `/api/projects/${p}/estimates`, {
      estimates: [{ costHeadId: h1.id, amountFils: 1_100_000 }],
    });
    expect((await decide(change.id, 'approve')).statusCode).toBe(409);
    expect(await budgets(p)).toMatchObject({ B1: 1_100_000 });
  });
});
