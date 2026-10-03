import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb, seedPortfolio } from '../db/testing';
import {
  asUser,
  createAuthFixture,
  makeUser,
  signIn,
  type Fixture,
  type Session,
} from '../auth/testing';

/**
 * Load test on the pack's dataset (100 projects x 32 heads x 5,000 expenses): each hot endpoint
 * 100 times at concurrency 10, through the full stack (auth, session, guards, JSON).
 * Targets: p95 <= 300 ms for reads, <= 500 ms for writes. Results are printed for PERFORMANCE.md.
 */
const READ_P95_MS = 300;
const WRITE_P95_MS = 500;

describe.skipIf(!hasTestDb)('load: p95 on 100 projects x 32 heads x 5,000 expenses', () => {
  let fx: Fixture;
  let admin: Session;
  let member: Session;
  let projectIds: string[];
  let headIds: string[];
  const results: string[] = [];

  beforeAll(async () => {
    fx = await createAuthFixture({ LOGIN_RATE_LIMIT: '10000' });
    const a = await makeUser(fx, { roleName: 'Admin' });
    admin = await signIn(fx, a.email);
    const m = await makeUser(fx, { roleName: 'Accountant' });
    member = await signIn(fx, m.email);
    ({ projectIds, headIds } = await seedPortfolio(fx.db.pool, {
      projects: 100,
      heads: 32,
      expenses: 5_000,
      ownerUserId: a.id,
    }));
    for (const id of projectIds.filter((_, i) => i % 2 === 0))
      await fx.db.pool.query('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', [
        id,
        m.id,
      ]);
  }, 180_000);
  afterAll(async () => {
    // LOAD_REPORT=<file> writes the table for PERFORMANCE.md.
    const out = process.env['LOAD_REPORT'];
    if (out)
      writeFileSync(
        out,
        `| Endpoint | p50 ms | p95 ms | max ms |\n|---|---|---|---|\n${results.join('\n')}\n`,
      );
    await fx.close();
  });

  async function measure(
    label: string,
    n: number,
    run: (i: number) => Promise<{ statusCode: number }>,
  ) {
    const times: number[] = [];
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next++;
        const t0 = performance.now();
        const res = await run(i);
        times.push(performance.now() - t0);
        if (res.statusCode >= 400) throw new Error(`${label}: ${res.statusCode}`);
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
    times.sort((x, y) => x - y);
    const at = (q: number) =>
      times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)] as number;
    results.push(
      `| ${label} | ${at(0.5).toFixed(0)} | ${at(0.95).toFixed(0)} | ${(times.at(-1) as number).toFixed(0)} |`,
    );
    return at(0.95);
  }
  const get = (s: Session, url: string) => () =>
    fx.app.inject({ method: 'GET', url, headers: asUser(s) });

  it('reads stay under the p95 target', async () => {
    const p = projectIds[0] as string;
    const h = headIds[0] as string;
    const reads: [string, () => Promise<{ statusCode: number }>][] = [
      ['GET /api/dashboard (admin, 100 projects)', get(admin, '/api/dashboard')],
      ['GET /api/dashboard (member, 50 projects)', get(member, '/api/dashboard')],
      ['GET /api/projects?q=&sort=name', get(member, '/api/projects?sort=name')],
      ['GET /api/projects/:id/boq', get(member, `/api/projects/${p}/boq`)],
      [
        'GET /api/projects/:id/boq?order=attention',
        get(member, `/api/projects/${p}/boq?order=attention`),
      ],
      ['GET /api/projects/:id/cost-heads/:id', get(member, `/api/projects/${p}/cost-heads/${h}`)],
      [
        'GET /api/projects/:id/expenses?sort=amount',
        get(member, `/api/projects/${p}/expenses?sort=amount&dir=desc`),
      ],
      [
        'GET .../projection?amountFils=',
        get(member, `/api/projects/${p}/cost-heads/${h}/projection?amountFils=1000`),
      ],
      ['GET /api/search?q=INV-1 (member)', get(member, '/api/search?q=INV-1')],
      ['GET /api/search?q=INV-1 (admin)', get(admin, '/api/search?q=INV-1')],
    ];
    const slow: string[] = [];
    for (const [label, run] of reads) {
      const p95 = await measure(label, 100, run);
      if (p95 > READ_P95_MS) slow.push(`${label}: ${p95.toFixed(0)} ms`);
    }
    expect(slow).toEqual([]);
  }, 300_000);

  it('writes stay under the p95 target', async () => {
    const p = projectIds[2] as string; // the member belongs to even-numbered projects
    const write =
      (method: 'POST' | 'PUT', url: string, body: (i: number) => object, as = member) =>
      (i: number) =>
        fx.app.inject({ method, url, headers: asUser(as, true), payload: body(i) });
    const ids: string[] = [];
    const slow: string[] = [];
    // Budgets first, large enough that the adds below stay under the approval level and post
    // straight to Actual (each add still runs the approval check), so they can be reversed.
    const est = await measure('PUT /api/projects/:id/estimates (1 head)', 100, (i) =>
      write(
        'PUT',
        `/api/projects/${p}/estimates`,
        () => ({
          estimates: [{ costHeadId: headIds[i % headIds.length], amountFils: 1_000_000_000 + i }],
        }),
        admin, // direct budget writes are for administrators (D31)
      )(i),
    );
    if (est > WRITE_P95_MS) slow.push(`estimates: ${est}`);
    const add = await measure('POST /api/projects/:id/expenses', 100, async (i) => {
      const res = await write('POST', `/api/projects/${p}/expenses`, () => ({
        costHeadId: headIds[i % headIds.length],
        vendor: 'Load',
        invoiceNo: `LOAD-${i}`,
        expenseDate: '2026-08-01',
        amountFils: 1_000 + i,
      }))(i);
      ids.push(res.json().data.id);
      return res;
    });
    if (add > WRITE_P95_MS) slow.push(`add: ${add}`);
    const rev = await measure('POST .../expenses/:id/reverse', 50, (i) =>
      write('POST', `/api/projects/${p}/expenses/${ids[i]}/reverse`, () => ({ reason: 'load' }))(i),
    );
    if (rev > WRITE_P95_MS) slow.push(`reverse: ${rev}`);
    expect(slow).toEqual([]);
  }, 300_000);
});
