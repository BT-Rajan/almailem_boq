import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dashboard, ExpensePage, ProjectBoq } from '@boq/shared';
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

/**
 * Financial properties, checked against an independent model after every step of a seeded random
 * sequence of real API operations:
 *   Actual per head = sum of the head's original expenses that are not reversed
 *   Remaining = Budget - Actual; Used = floor(Actual * 10000 / Budget) basis points (D3 for 0)
 *   status follows the thresholds (80.00% / 100.00% defaults)
 *   BoQ total = sum of heads; dashboard row = BoQ total; cost-head detail = BoQ row
 *   the ledger (every entry, reversals included) nets to the total Actual
 */
type Live = { id: string; head: number; amount: number; reversed: boolean };

function expectedUsedBp(budget: number, actual: number): number {
  if (budget === 0) return actual > 0 ? 10_000 : 0;
  const n = BigInt(actual) * 10_000n;
  const b = BigInt(budget);
  const q = n / b;
  return Number(n % b !== 0n && n < 0n ? q - 1n : q);
}
const expectedStatus = (bp: number) =>
  bp >= 10_000 ? 'APPROVAL_REQUIRED' : bp >= 8_000 ? 'WARNING' : 'NORMAL';

describe.skipIf(!hasTestDb)('financial properties (real MariaDB)', () => {
  let fx: Fixture;
  let pm: Session;
  let heads: CostHeadRecord[];

  beforeAll(async () => {
    fx = await createAuthFixture();
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    heads = [];
    for (let i = 0; i < 4; i++)
      heads.push(
        await costHeadsRepository(fx.db.pool).create({
          code: `F${i}`,
          name: `Head ${i}`,
          displayOrder: i,
        }),
      );
  });
  afterAll(async () => {
    await fx.close();
  });

  const api = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) => {
    const res = await fx.app.inject({
      method,
      url,
      headers: asUser(pm, method !== 'GET'),
      ...(payload && { payload }),
    });
    if (res.statusCode >= 400) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
    return res.json().data;
  };
  let seq = 0;
  const newProject = async () =>
    (await api('POST', '/api/projects', { code: `FP-${++seq}`, name: 'p' })).id as string;
  const addExpense = async (projectId: string, head: number, amount: number) =>
    (
      await api('POST', `/api/projects/${projectId}/expenses`, {
        costHeadId: heads[head]?.id,
        vendor: `V${seq}`,
        invoiceNo: `INV-${++seq}`,
        expenseDate: '2026-07-01',
        amountFils: amount,
      })
    ).id as string;

  /** Every view of the money agrees with the model. */
  async function checkAll(projectId: string, budgets: number[], ledger: Live[]) {
    const boq = (await api('GET', `/api/projects/${projectId}/boq`)) as ProjectBoq;
    for (let h = 0; h < heads.length; h++) {
      const actual = ledger
        .filter((e) => e.head === h && !e.reversed)
        .reduce((s, e) => s + e.amount, 0);
      const budget = budgets[h] ?? 0;
      const row = boq.rows.find((r) => r.costHead.id === heads[h]?.id);
      const bp = expectedUsedBp(budget, actual);
      expect(row?.metrics, `head ${h}`).toEqual({
        budget,
        actual,
        remaining: budget - actual,
        utilisationBp: bp,
      });
      expect(row?.status).toBe(expectedStatus(bp));
      const detail = await api('GET', `/api/projects/${projectId}/cost-heads/${heads[h]?.id}`);
      expect(detail.metrics).toEqual(row?.metrics);
      expect(detail.status).toBe(row?.status);
    }
    const sum = (k: 'budget' | 'actual' | 'remaining') =>
      boq.rows.reduce((s, r) => s + r.metrics[k], 0);
    expect(boq.total).toMatchObject({
      budget: sum('budget'),
      actual: sum('actual'),
      remaining: sum('remaining'),
    });
    expect(boq.total.utilisationBp).toBe(expectedUsedBp(boq.total.budget, boq.total.actual));

    const dash = (await api('GET', '/api/dashboard')) as Dashboard;
    const mine = dash.projects.find((p) => p.id === projectId);
    expect(mine?.metrics).toEqual(boq.total);
    expect(mine?.status).toBe(boq.totalStatus);

    let entries = 0;
    let net = 0;
    for (let page = 1; ; page++) {
      const p = (await api(
        'GET',
        `/api/projects/${projectId}/expenses?pageSize=100&page=${page}`,
      )) as ExpensePage;
      for (const e of p.items) net += e.amountFils;
      entries += p.items.length;
      if (entries >= p.total) break;
    }
    expect(net).toBe(boq.total.actual);
  }

  it('a 120-step random sequence of adds, reversals, edits, moves and budget changes', async () => {
    let s = 20260701;
    const rand = (n: number) => {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      return s % n;
    };
    const projectId = await newProject();
    const budgets = [0, 0, 0, 0];
    const ledger: Live[] = [];
    const live = () => ledger.filter((e) => !e.reversed);

    for (let step = 0; step < 120; step++) {
      const op = rand(10);
      if (op <= 3 || live().length === 0) {
        const head = rand(4);
        const amount = 1 + rand(5_000_000);
        ledger.push({
          id: await addExpense(projectId, head, amount),
          head,
          amount,
          reversed: false,
        });
      } else if (op <= 5) {
        const e = live()[rand(live().length)] as Live;
        await api('POST', `/api/projects/${projectId}/expenses/${e.id}/reverse`, {
          reason: `step ${step}`,
        });
        e.reversed = true;
      } else if (op === 6) {
        const e = live()[rand(live().length)] as Live;
        e.amount = 1 + rand(5_000_000);
        await api('PATCH', `/api/projects/${projectId}/expenses/${e.id}`, { amountFils: e.amount });
      } else if (op === 7) {
        const e = live()[rand(live().length)] as Live;
        e.head = (e.head + 1 + rand(3)) % 4;
        await api('PATCH', `/api/projects/${projectId}/expenses/${e.id}`, {
          costHeadId: heads[e.head]?.id,
        });
      } else {
        const h = rand(4);
        budgets[h] = rand(3) === 0 ? 0 : rand(20_000_000);
        await api('PUT', `/api/projects/${projectId}/estimates`, {
          estimates: [{ costHeadId: heads[h]?.id, amountFils: budgets[h] }],
        });
      }
      if (step % 10 === 9) await checkAll(projectId, budgets, ledger);
    }
    await checkAll(projectId, budgets, ledger);
    expect(ledger.filter((e) => e.reversed).length).toBeGreaterThan(5);
  }, 180_000);

  it('a concurrent burst of adds, reversals and edits on the same heads ends consistent', async () => {
    const projectId = await newProject();
    const budgets = [10_000_000, 0, 5_000_000, 0];
    await api('PUT', `/api/projects/${projectId}/estimates`, {
      estimates: budgets.map((amountFils, i) => ({ costHeadId: heads[i]?.id, amountFils })),
    });
    const ledger: Live[] = [];
    for (let i = 0; i < 20; i++) {
      const amount = 10_000 + i * 777;
      ledger.push({
        id: await addExpense(projectId, i % 2 === 0 ? 0 : 2, amount),
        head: i % 2 === 0 ? 0 : 2,
        amount,
        reversed: false,
      });
    }
    // Distinct targets, so every operation must succeed whatever order they land in.
    const burst: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      const amount = 50_000 + i;
      burst.push(
        addExpense(projectId, i % 2 === 0 ? 0 : 2, amount).then((id) =>
          ledger.push({ id, head: i % 2 === 0 ? 0 : 2, amount, reversed: false }),
        ),
      );
    }
    for (const e of ledger.slice(0, 8)) {
      burst.push(
        api('POST', `/api/projects/${projectId}/expenses/${e.id}/reverse`, { reason: 'burst' }),
      );
      e.reversed = true;
    }
    for (const e of ledger.slice(8, 14)) {
      e.amount += 1_000;
      burst.push(
        api('PATCH', `/api/projects/${projectId}/expenses/${e.id}`, { amountFils: e.amount }),
      );
    }
    burst.push(
      api('PUT', `/api/projects/${projectId}/estimates`, {
        estimates: [{ costHeadId: heads[0]?.id, amountFils: 12_000_000 }],
      }),
    );
    budgets[0] = 12_000_000;
    await Promise.all(burst);
    await checkAll(projectId, budgets, ledger);
  }, 120_000);
});
