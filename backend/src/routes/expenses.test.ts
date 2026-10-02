import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '@boq/shared';
import { JPG, PDF, PNG } from '../attachments/testing';
import { hasTestDb } from '../db/testing';
import { auditLogRepository, costHeadsRepository, type CostHeadRecord } from '../repositories';
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

// Placeholder cost heads and vendors for tests only.
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
type Metrics = { budget: number; actual: number; remaining: number; utilisationBp: number };
type Expense = {
  id: string;
  amountFils: number;
  reversalOf: string | null;
  reversedAt: string | null;
  attachment: { name: string } | null;
};

describe.skipIf(!hasTestDb)('expenses, reversals and attachments (real MariaDB)', () => {
  let fx: Fixture;
  let dir: string;
  let admin: Session;
  let pm: Session;
  let accountant: Session;
  let accountantId: string;
  let viewer: Session;
  let viewerId: string;
  let outsider: Session;
  let h1: CostHeadRecord;
  let h2: CostHeadRecord;
  let retired: CostHeadRecord;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'boq-exp-'));
    fx = await createAuthFixture({ ATTACHMENTS_DIR: dir, ATTACHMENT_MAX_MB: '1' });
    admin = await signIn(fx, (await makeUser(fx, { roleName: 'Admin' })).email);
    pm = await signIn(fx, (await makeUser(fx, { roleName: 'Project Manager' })).email);
    const acc = await makeUser(fx, { roleName: 'Accountant' });
    accountantId = acc.id;
    accountant = await signIn(fx, acc.email);
    const v = await makeUser(fx, { roleName: 'Viewer' });
    viewerId = v.id;
    viewer = await signIn(fx, v.email);
    outsider = await signIn(fx, (await makeUser(fx, { roleName: 'Accountant' })).email);
    const heads = costHeadsRepository(fx.db.pool);
    h1 = await heads.create({ code: 'X1', name: 'Head one', displayOrder: 1 });
    h2 = await heads.create({ code: 'X2', name: 'Head two', displayOrder: 2 });
    retired = await heads.create({ code: 'XR', name: 'Retired', displayOrder: 3, active: false });
  });
  afterAll(async () => {
    await fx.close();
    await rm(dir, { recursive: true, force: true });
  });

  const call = (s: Session | null, method: Method, url: string, payload?: unknown) =>
    fx.app.inject({
      method,
      url,
      ...(s && { headers: asUser(s, method !== 'GET') }),
      ...(payload !== undefined && { payload: payload as object }),
    });
  let seq = 0;
  /** A project with a budget of 1,000.000 KWD on h1, the accountant and viewer as members. */
  const newProject = async () => {
    const p = (await call(pm, 'POST', '/api/projects', { code: `X-${++seq}`, name: 'p' })).json()
      .data as {
      id: string;
    };
    await call(pm, 'PUT', `/api/projects/${p.id}/estimates`, {
      estimates: [{ costHeadId: h1.id, amountFils: 1_000_000 }],
    });
    await call(pm, 'PUT', `/api/projects/${p.id}/members/${accountantId}`);
    await call(pm, 'PUT', `/api/projects/${p.id}/members/${viewerId}`);
    return p.id;
  };
  const expenseBody = (over: Record<string, unknown> = {}) => ({
    costHeadId: h1.id,
    vendor: 'Acme Trading',
    invoiceNo: `INV-${++seq}`,
    expenseDate: '2026-03-15',
    amountFils: 250_000,
    ...over,
  });
  const add = (projectId: string, over: Record<string, unknown> = {}, s: Session = accountant) =>
    call(s, 'POST', `/api/projects/${projectId}/expenses`, expenseBody(over));
  /** An expense that lands in Actual: past the approval level it is approved by the admin. */
  const addOk = async (projectId: string, over: Record<string, unknown> = {}) => {
    const res = await add(projectId, { approvalReason: TEST_APPROVAL_REASON, ...over });
    if (res.statusCode !== 201) throw new Error(res.body);
    const created = res.json().data;
    await approveHeld(fx, admin, created);
    return (await call(pm, 'GET', `/api/projects/${projectId}/expenses?pageSize=100`))
      .json()
      .data.items.find((x: Expense) => x.id === created.id) as Expense;
  };
  const headMetrics = async (projectId: string, head = h1): Promise<Metrics> => {
    const boq = (await call(pm, 'GET', `/api/projects/${projectId}/boq`)).json().data;
    return boq.rows.find((r: { costHead: { id: string } }) => r.costHead.id === head.id).metrics;
  };
  const reverse = (
    projectId: string,
    id: string,
    reason = 'Entered twice',
    s: Session = accountant,
  ) => call(s, 'POST', `/api/projects/${projectId}/expenses/${id}/reverse`, { reason });
  const upload = (
    projectId: string,
    id: string,
    data: Uint8Array,
    type: string,
    s: Session = accountant,
  ) =>
    fx.app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/expenses/${id}/attachment`,
      headers: {
        ...asUser(s, true),
        'content-type': type,
        'x-file-name': encodeURIComponent('bill 7.pdf'),
      },
      payload: Buffer.from(data),
    });
  const filesOnDisk = async () => {
    const out: string[] = [];
    for (const sub of await readdir(dir).catch(() => []))
      out.push(...(await readdir(join(dir, sub))));
    return out;
  };

  describe('acceptance: adding and reversing moves Actual, Remaining and Used', () => {
    it('add > figures change; reverse > they are restored; the record keeps both entries', async () => {
      const p = await newProject();
      expect(await headMetrics(p)).toEqual({
        budget: 1_000_000,
        actual: 0,
        remaining: 1_000_000,
        utilisationBp: 0,
      });

      const e = await addOk(p, { amountFils: 800_000 });
      expect(await headMetrics(p)).toEqual({
        budget: 1_000_000,
        actual: 800_000,
        remaining: 200_000,
        utilisationBp: 8000,
      });

      const res = await reverse(p, e.id);
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({
        amountFils: -800_000,
        reversalOf: e.id,
        description: 'Entered twice',
      });
      expect(await headMetrics(p)).toEqual({
        budget: 1_000_000,
        actual: 0,
        remaining: 1_000_000,
        utilisationBp: 0,
      });

      const list = (await call(pm, 'GET', `/api/projects/${p}/expenses`)).json().data;
      expect(list.total).toBe(2);
      const original = list.items.find((x: Expense) => x.id === e.id);
      expect(original.reversedAt).not.toBeNull();
      // The record nets to zero, the same as Actual.
      expect(list.items.reduce((s: number, x: Expense) => s + x.amountFils, 0)).toBe(0);

      const audit = await auditLogRepository(fx.db.pool).listForEntity('expense', e.id);
      expect(audit.map((r) => r.event)).toEqual(['expense.created', 'expense.reversed']);
      expect(audit[1]?.after).toMatchObject({ reason: 'Entered twice' });
    });

    it('spend on a head with no budget counts as 100% used (D3)', async () => {
      const p = await newProject();
      await addOk(p, { costHeadId: h2.id, amountFils: 1 });
      expect(await headMetrics(p, h2)).toEqual({
        budget: 0,
        actual: 1,
        remaining: -1,
        utilisationBp: 10_000,
      });
    });

    it('project totals equal the sum of heads with real spend', async () => {
      const p = await newProject();
      await addOk(p, { amountFils: 300_000 });
      await addOk(p, { costHeadId: h2.id, amountFils: 5_500 });
      const boq = (await call(pm, 'GET', `/api/projects/${p}/boq`)).json().data;
      const sum = (k: keyof Metrics) =>
        boq.rows.reduce((s: number, r: { metrics: Metrics }) => s + r.metrics[k], 0);
      expect(boq.total).toMatchObject({
        budget: sum('budget'),
        actual: sum('actual'),
        remaining: sum('remaining'),
      });
      expect(boq.total.actual).toBe(305_500);
    });
  });

  describe('duplicates and validation', () => {
    it('rejects the same vendor invoice twice in a project (any case), allows it elsewhere', async () => {
      const p = await newProject();
      await addOk(p, { vendor: 'Gulf Steel', invoiceNo: 'GS-100' });
      const dup = await add(p, { vendor: 'GULF STEEL', invoiceNo: 'gs-100' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.message).toBe(
        'An invoice with this vendor and number already exists',
      );
      expect((await add(p, { vendor: 'Other Vendor', invoiceNo: 'GS-100' })).statusCode).toBe(201);
      const q = await newProject();
      expect((await add(q, { vendor: 'Gulf Steel', invoiceNo: 'GS-100' })).statusCode).toBe(201);
    });

    it('after a reversal the invoice can be entered again, correctly', async () => {
      const p = await newProject();
      const e = await addOk(p, { vendor: 'Re', invoiceNo: 'R-1', amountFils: 999 });
      await reverse(p, e.id, 'Wrong amount');
      expect((await add(p, { vendor: 'Re', invoiceNo: 'R-1', amountFils: 900 })).statusCode).toBe(
        201,
      );
      expect((await headMetrics(p)).actual).toBe(900);
    });

    it.each([
      ['zero amount', { amountFils: 0 }],
      ['negative amount', { amountFils: -5 }],
      ['fractional fils', { amountFils: 1.5 }],
      ['amount as text', { amountFils: '100' }],
      ['impossible date', { expenseDate: '2026-02-30' }],
      ['empty vendor', { vendor: '  ' }],
      ['long invoice number', { invoiceNo: 'x'.repeat(61) }],
      ['unknown field', { status: 'approved' }],
    ])('rejects %s with 400', async (_l, over) => {
      const p = await newProject();
      expect((await add(p, over)).statusCode).toBe(400);
    });

    it('unknown head 404, inactive head 409', async () => {
      const p = await newProject();
      expect(
        (await add(p, { costHeadId: '00000000-0000-1000-8000-000000000000' })).statusCode,
      ).toBe(404);
      expect((await add(p, { costHeadId: retired.id })).statusCode).toBe(409);
    });

    it('a completed or cancelled project takes no new, changed or reversed spend', async () => {
      const p = await newProject();
      const e = await addOk(p);
      await call(pm, 'POST', `/api/projects/${p}/status`, { status: 'cancelled' });
      for (const res of [
        await add(p),
        await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, { vendor: 'X' }),
        await reverse(p, e.id),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe('PROJECT_CLOSED');
      }
    });
  });

  describe('edit', () => {
    it('changes the figures, audits only the changed fields; a no-op writes nothing', async () => {
      const p = await newProject();
      const e = await addOk(p, { amountFils: 100_000 });
      const res = await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, {
        amountFils: 150_000,
        vendor: 'Acme Trading',
      });
      expect(res.json().data.amountFils).toBe(150_000);
      expect((await headMetrics(p)).actual).toBe(150_000);
      await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, {
        amountFils: 150_000,
      });
      const audit = await auditLogRepository(fx.db.pool).listForEntity('expense', e.id);
      expect(audit.map((r) => [r.event, r.before, r.after])).toEqual([
        ['expense.created', null, expect.anything()],
        ['expense.updated', { amountFils: 100_000 }, { amountFils: 150_000 }],
      ]);
    });

    it('moving to another head moves the spend', async () => {
      const p = await newProject();
      await call(pm, 'PUT', `/api/projects/${p}/estimates`, {
        estimates: [{ costHeadId: h2.id, amountFils: 1_000 }],
      });
      const e = await addOk(p, { amountFils: 70 });
      await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, { costHeadId: h2.id });
      expect((await headMetrics(p)).actual).toBe(0);
      expect((await headMetrics(p, h2)).actual).toBe(70);
      const res = await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, {
        costHeadId: retired.id,
      });
      expect(res.statusCode).toBe(409);
    });

    it('reversed expenses and reversal entries cannot be edited; duplicates are refused', async () => {
      const p = await newProject();
      const a = await addOk(p, { vendor: 'V', invoiceNo: 'A' });
      const b = await addOk(p, { vendor: 'V', invoiceNo: 'B' });
      expect(
        (await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${b.id}`, { invoiceNo: 'A' }))
          .statusCode,
      ).toBe(409);
      const rev = (await reverse(p, a.id)).json().data as Expense;
      for (const id of [a.id, rev.id])
        expect(
          (await call(accountant, 'PATCH', `/api/projects/${p}/expenses/${id}`, { vendor: 'Z' }))
            .statusCode,
        ).toBe(409);
    });
  });

  describe('reverse', () => {
    it('only once, never a reversal entry, and a reason is required', async () => {
      const p = await newProject();
      const e = await addOk(p);
      expect((await reverse(p, e.id, '   ')).statusCode).toBe(400);
      const rev = (await reverse(p, e.id)).json().data as Expense;
      expect((await reverse(p, e.id)).statusCode).toBe(409);
      expect((await reverse(p, rev.id)).statusCode).toBe(409);
    });

    it('two simultaneous reversals of one expense: exactly one succeeds', async () => {
      const p = await newProject();
      const e = await addOk(p, { amountFils: 500 });
      const codes = (await Promise.all([reverse(p, e.id), reverse(p, e.id), reverse(p, e.id)]))
        .map((r) => r.statusCode)
        .sort();
      expect(codes).toEqual([201, 409, 409]);
      expect((await headMetrics(p)).actual).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('concurrent adds produce the correct total', async () => {
      const p = await newProject();
      const amounts = Array.from({ length: 25 }, (_, i) => 1_000 + i * 37);
      const results = await Promise.all(amounts.map((amountFils) => add(p, { amountFils })));
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      const expected = amounts.reduce((s, a) => s + a, 0);
      expect((await headMetrics(p)).actual).toBe(expected);
      expect(
        (await call(pm, 'GET', `/api/projects/${p}/expenses?pageSize=100`)).json().data.total,
      ).toBe(25);
    });

    it('concurrent duplicates: exactly one of the same invoice is saved', async () => {
      const p = await newProject();
      const body = { vendor: 'Race', invoiceNo: 'R-9' };
      const codes = (await Promise.all([add(p, body), add(p, body), add(p, body)]))
        .map((r) => r.statusCode)
        .sort();
      expect(codes).toEqual([201, 409, 409]);
    });
  });

  describe('attachments', () => {
    it('stores a PDF under a random name and serves it back only as a download', async () => {
      const p = await newProject();
      const e = await addOk(p);
      const before = await filesOnDisk();
      const res = await upload(p, e.id, PDF, 'application/pdf');
      expect(res.statusCode).toBe(200);
      expect(res.json().data.attachment).toEqual({
        name: 'bill 7.pdf',
        type: 'application/pdf',
        size: PDF.length,
      });
      const added = (await filesOnDisk()).filter((f) => !before.includes(f));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatch(/^[0-9a-f]{32}$/); // random, no client name or extension

      const get = await call(viewer, 'GET', `/api/projects/${p}/expenses/${e.id}/attachment`);
      expect(get.statusCode).toBe(200);
      expect(get.rawPayload.equals(Buffer.from(PDF))).toBe(true);
      expect(get.headers['content-type']).toBe('application/pdf');
      expect(get.headers['content-disposition']).toContain(
        'attachment; filename="attachment"; filename*=UTF-8\'\'bill%207.pdf',
      );
      expect(get.headers['x-content-type-options']).toBe('nosniff');
      expect(String(get.headers['cache-control'])).toContain('no-store');
      expect(JSON.stringify(res.json())).not.toContain(added[0]); // the key never leaves the server
    });

    it('accepts PNG and JPEG; rejects a mismatch between the bytes and the declared type', async () => {
      const p = await newProject();
      const e = await addOk(p);
      expect((await upload(p, e.id, PNG, 'image/png')).statusCode).toBe(200);
      expect((await upload(p, e.id, JPG, 'image/jpeg')).statusCode).toBe(200);
      const fake = await upload(p, e.id, PNG, 'application/pdf');
      expect(fake.statusCode).toBe(415);
      expect(fake.json().error.code).toBe('UNSUPPORTED_FILE');
    });

    it('rejects other file types: HTML bytes, or a type outside the allow-list', async () => {
      const p = await newProject();
      const e = await addOk(p);
      const files = await filesOnDisk();
      const html = await upload(
        p,
        e.id,
        new TextEncoder().encode('<html><script>alert(1)</script>'),
        'application/pdf',
      );
      expect(html.statusCode).toBe(415);
      const svg = await upload(p, e.id, new TextEncoder().encode('<svg/>'), 'image/svg+xml');
      expect(svg.statusCode).toBe(415);
      const exe = await upload(p, e.id, new Uint8Array([0x4d, 0x5a]), 'application/octet-stream');
      expect(exe.statusCode).toBe(415);
      expect(await filesOnDisk()).toEqual(files); // nothing left behind
    });

    it('rejects a file over the size cap with 413', async () => {
      const p = await newProject();
      const e = await addOk(p);
      const big = new Uint8Array(1024 * 1024 + 10);
      big.set(PDF);
      const res = await upload(p, e.id, big, 'application/pdf');
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('replacing an attachment removes the old file; an upload that fails leaves no file', async () => {
      const p = await newProject();
      const e = await addOk(p);
      await upload(p, e.id, PDF, 'application/pdf');
      const one = await filesOnDisk();
      await upload(p, e.id, PNG, 'image/png');
      const two = await filesOnDisk();
      expect(two).toHaveLength(one.length);
      const missing = await upload(
        p,
        '00000000-0000-1000-8000-000000000000',
        PDF,
        'application/pdf',
      );
      expect(missing.statusCode).toBe(404);
      expect(await filesOnDisk()).toEqual(two);
    });

    it('users without project access cannot read attachments; ids from another project are not found', async () => {
      const p = await newProject();
      const e = await addOk(p);
      await upload(p, e.id, PDF, 'application/pdf');
      const url = `/api/projects/${p}/expenses/${e.id}/attachment`;
      expect((await call(outsider, 'GET', url)).statusCode).toBe(403);
      expect((await call(null, 'GET', url)).statusCode).toBe(401);
      const other = await newProject(); // accountant is a member of both
      expect(
        (await call(accountant, 'GET', `/api/projects/${other}/expenses/${e.id}/attachment`))
          .statusCode,
      ).toBe(404);
      expect((await upload(other, e.id, PDF, 'application/pdf')).statusCode).toBe(404);
    });

    it('an upload needs the CSRF token and the edit permission', async () => {
      const p = await newProject();
      const e = await addOk(p);
      const noCsrf = await fx.app.inject({
        method: 'PUT',
        url: `/api/projects/${p}/expenses/${e.id}/attachment`,
        headers: { cookie: accountant.cookie, 'content-type': 'application/pdf' },
        payload: Buffer.from(PDF),
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(noCsrf.json().error.code).toBe('CSRF_INVALID');
      expect((await upload(p, e.id, PDF, 'application/pdf', viewer)).statusCode).toBe(403);
      expect(CSRF_HEADER).toBe('x-csrf-token');
    });
  });

  describe('cost-head detail and access', () => {
    it("shows the same figures as the BoQ row and only that head's expenses", async () => {
      const p = await newProject();
      await addOk(p, { amountFils: 400_000 });
      await addOk(p, { costHeadId: h2.id, amountFils: 9 });
      const res = await call(viewer, 'GET', `/api/projects/${p}/cost-heads/${h1.id}`);
      expect(res.statusCode).toBe(200);
      const d = res.json().data;
      expect(d.metrics).toEqual(await headMetrics(p));
      expect(d.expenses.items).toHaveLength(1);
      expect(d.costHead).toMatchObject({ code: 'X1', active: true });
      expect(d.editable).toBe(true);
    });

    it('non-members 403; Viewer members read but cannot add, edit or reverse', async () => {
      const p = await newProject();
      const e = await addOk(p);
      expect((await call(outsider, 'GET', `/api/projects/${p}/expenses`)).statusCode).toBe(403);
      expect((await add(p, {}, outsider)).statusCode).toBe(403);
      expect((await call(viewer, 'GET', `/api/projects/${p}/expenses`)).statusCode).toBe(200);
      expect((await add(p, {}, viewer)).statusCode).toBe(403);
      expect(
        (await call(viewer, 'PATCH', `/api/projects/${p}/expenses/${e.id}`, { vendor: 'x' }))
          .statusCode,
      ).toBe(403);
      expect((await reverse(p, e.id, 'x', viewer)).statusCode).toBe(403);
    });
  });
});
