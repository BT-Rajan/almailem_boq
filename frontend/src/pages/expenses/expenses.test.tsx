// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER } from '@boq/shared';
import { setCsrfToken } from '../../api/client';
import { mockApi } from '../../testing';
import { CostHeadPage } from './CostHeadPage';
import { ExpenseForm } from './ExpenseForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const P = '33333333-3333-4333-8333-333333333333';
const H = '44444444-4444-4444-8444-444444444444';
const metrics = { budget: 1_000_000, actual: 800_000, remaining: 200_000, utilisationBp: 8000 };
const boq = {
  rows: [
    {
      costHead: { id: H, code: 'H1', name: 'Head one', active: true },
      inBudget: true,
      metrics,
      status: 'WARNING',
    },
  ],
  total: metrics,
  totalStatus: 'WARNING',
  editable: true,
};
const base = {
  costHead: { id: H, code: 'H1', name: 'Head one' },
  vendor: 'Acme',
  expenseDate: '2026-03-15',
  description: null,
  attachment: null,
  createdBy: { id: 'u1', name: 'Ada' },
  createdAt: '2026-03-15T08:00:00.000Z',
  modifiedBy: null,
  modifiedAt: '2026-03-15T08:00:00.000Z',
  reversalOf: null,
  reversedAt: null,
  status: 'POSTED',
  approval: null,
};
const live = {
  ...base,
  id: 'e1',
  invoiceNo: 'INV-1',
  amountFils: 800_000,
  attachment: { name: 'bill.pdf', type: 'application/pdf', size: 10 },
};
const reversed = {
  ...base,
  id: 'e2',
  invoiceNo: 'INV-2',
  amountFils: 50_000,
  reversedAt: '2026-03-16T00:00:00.000Z',
};
const reversal = {
  ...base,
  id: 'e3',
  invoiceNo: 'INV-2',
  amountFils: -50_000,
  reversalOf: 'e2',
  description: 'Duplicate',
};
const detail = {
  costHead: { id: H, code: 'H1', name: 'Head one', active: true },
  metrics,
  status: 'WARNING',
  expenses: { items: [reversal, reversed, live], total: 3, page: 1, pageSize: 50 },
  deleted: [],
  editable: true,
};

describe('Add expense form', () => {
  it('sends fils and the fields, then uploads the bill with its name and the CSRF token', async () => {
    setCsrfToken('csrf-1');
    const onSaved = vi.fn();
    const calls = mockApi({
      [`GET /api/projects/${P}/boq`]: () => ({ data: boq }),
      [`POST /api/projects/${P}/expenses`]: () => ({ status: 201, data: { ...live, id: 'new' } }),
      [`PUT /api/projects/${P}/expenses/new/attachment`]: () => ({ data: live }),
    });
    render(<ExpenseForm projectId={P} costHeadId={H} onSaved={onSaved} />);
    await screen.findByRole('option', { name: 'H1 · Head one' });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: 'INV-9' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-15' } });
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '1,250.5' } });
    const file = new File(['%PDF-1.7'], 'bill 7.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/Bill/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      costHeadId: H,
      vendor: 'Acme',
      invoiceNo: 'INV-9',
      expenseDate: '2026-03-15',
      amountFils: 1_250_500,
      description: null,
    });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toBe(file);
    expect(put?.headers).toMatchObject({
      'content-type': 'application/pdf',
      'x-file-name': 'bill%207.pdf',
      [CSRF_HEADER]: 'csrf-1',
    });
  });

  it('says when the expense saved but the bill did not attach', async () => {
    mockApi({
      [`GET /api/projects/${P}/boq`]: () => ({ data: boq }),
      [`POST /api/projects/${P}/expenses`]: () => ({ status: 201, data: { ...live, id: 'new' } }),
      [`PUT /api/projects/${P}/expenses/new/attachment`]: () => ({
        status: 415,
        error: { code: 'UNSUPPORTED_FILE', message: 'Only PDF, JPG and PNG files are accepted' },
      }),
    });
    render(<ExpenseForm projectId={P} costHeadId={H} onSaved={() => {}} />);
    await screen.findByRole('option', { name: 'H1 · Head one' });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Bill/), {
      target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Expense saved, but the bill was not attached: Only PDF, JPG and PNG files are accepted',
    );
  });

  it('will not submit an invalid amount', async () => {
    mockApi({ [`GET /api/projects/${P}/boq`]: () => ({ data: boq }) });
    render(<ExpenseForm projectId={P} costHeadId={H} onSaved={() => {}} />);
    for (const value of ['-3', '1.0005']) {
      // Kuwaiti dinars have 3 decimals: a 4th is refused, never rounded.
      fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value } });
      expect(
        (screen.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(screen.getByText(/at most 3 decimals/)).toBeTruthy();
  });
});

describe('Cost-head detail', () => {
  it('shows Budget, Actual, Remaining and Used, and every entry with the right actions', async () => {
    mockApi({ [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({ data: detail }) });
    render(<CostHeadPage projectId={P} costHeadId={H} />);
    const figures = await screen.findByLabelText('Figures');
    expect(figures.textContent).toBe(
      'Budget1,000.000Actual800.000Remaining200.000Used80.00%StatusWarning',
    );

    const rowOf = (inv: string, amount: string) =>
      screen
        .getAllByRole('row')
        .find((r) => r.textContent?.includes(inv) && r.textContent.includes(amount)) as HTMLElement;
    const liveRow = rowOf('INV-1', '800.000');
    expect(within(liveRow).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(liveRow).getByRole('link', { name: 'View' }).getAttribute('href')).toBe(
      `/api/projects/${P}/expenses/e1/attachment`,
    );
    const reversalRow = rowOf('INV-2', '-50.000');
    expect(reversalRow.textContent).toContain('Reversal');
    expect(within(reversalRow).queryByRole('button')).toBeNull();
    const reversedRow = rowOf('Reversed', '50.000');
    expect(within(reversedRow).queryByRole('button')).toBeNull();
  });

  it('reverses with a reason', async () => {
    const calls = mockApi({
      [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({ data: detail }),
      [`POST /api/projects/${P}/expenses/e1/reverse`]: () => ({ status: 201, data: reversal }),
    });
    render(<CostHeadPage projectId={P} costHeadId={H} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Entered twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reverse expense' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ reason: 'Entered twice' }),
    );
  });
  it('offers Delete only to an administrator, and deletes after confirmation', async () => {
    const calls = mockApi({
      [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({ data: detail }),
      [`DELETE /api/projects/${P}/expenses/e1`]: () => ({ data: { deleted: true } }),
    });
    const { unmount } = render(<CostHeadPage projectId={P} costHeadId={H} />);
    await screen.findByRole('button', { name: 'Edit' });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    unmount();

    vi.stubGlobal('confirm', () => true);
    render(<CostHeadPage projectId={P} costHeadId={H} canDelete />);
    expect(await screen.findAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('Expense detail', () => {
  const expenseDetail = (over: Record<string, unknown> = {}) => ({
    expense: {
      ...live,
      modifiedBy: { id: 'u2', name: 'Bob' },
      modifiedAt: '2026-03-16T09:00:00.000Z',
    },
    project: { id: P, systemNo: 'P00001', code: 'ALM-1', name: 'Villas' },
    costHead: { id: H, systemNo: 'C001', code: 'H1', name: 'Head one' },
    deleted: null,
    history: [
      {
        action: 'CREATED',
        by: { id: 'u1', name: 'Ada' },
        at: '2026-03-15T08:00:00.000Z',
        changes: [{ field: 'amountFils', from: null, to: 700_000 }],
        note: null,
      },
      {
        action: 'MODIFIED',
        by: { id: 'u2', name: 'Bob' },
        at: '2026-03-16T09:00:00.000Z',
        changes: [{ field: 'amountFils', from: 700_000, to: 800_000 }],
        note: null,
      },
    ],
    ...over,
  });

  it('tapping an expense shows its full record, bill and history', async () => {
    mockApi({
      [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({ data: detail }),
      [`GET /api/projects/${P}/expenses/e1`]: () => ({ data: expenseDetail() }),
    });
    render(<CostHeadPage projectId={P} costHeadId={H} />);
    const row = (await screen.findByText('INV-1')).closest('tr') as HTMLElement;
    fireEvent.click(row);
    const history = await screen.findByRole('list', { name: 'History' });
    expect(history.textContent).toContain('Amount: 700.000 KWD → 800.000 KWD');
    expect(screen.getByText('P00001 · Villas')).toBeTruthy();
    expect(screen.getByText('C001 · Head one')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy(); // modified by
    expect(screen.getByRole('link', { name: 'View bill.pdf' }).getAttribute('href')).toBe(
      `/api/projects/${P}/expenses/e1/attachment`,
    );
  });

  it('says so when no bill was uploaded, and marks a deleted expense', async () => {
    mockApi({
      [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({
        data: {
          ...detail,
          deleted: [
            {
              id: 'e7',
              invoiceNo: 'INV-7',
              expenseDate: '2026-03-10',
              amountFils: 5_000,
              deletedBy: { id: 'u0', name: 'Admin' },
              deletedAt: '2026-03-11T08:00:00.000Z',
            },
          ],
        },
      }),
      [`GET /api/projects/${P}/expenses/e7`]: () => ({
        data: expenseDetail({
          expense: { ...live, id: 'e7', attachment: null, modifiedBy: null },
          deleted: { by: { id: 'u0', name: 'Admin' }, at: '2026-03-11T08:00:00.000Z' },
        }),
      }),
    });
    render(<CostHeadPage projectId={P} costHeadId={H} />);
    fireEvent.click(await screen.findByRole('button', { name: /INV-7/ }));
    expect(await screen.findByText('No bill uploaded')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Deleted by Admin/);
  });
});

describe('Add Expense preview', () => {
  it('shows what the expense would do, with the status dot, before saving', async () => {
    const calls = mockApi({
      [`GET /api/projects/${P}/boq`]: () => ({ data: boq }),
      [`GET /api/projects/${P}/cost-heads/${H}/projection`]: () => ({
        data: {
          current: { metrics, status: 'WARNING' },
          projected: {
            metrics: {
              budget: 1_000_000,
              actual: 1_050_000,
              remaining: -50_000,
              utilisationBp: 10_500,
            },
            status: 'APPROVAL_REQUIRED',
          },
        },
      }),
    });
    render(<ExpenseForm projectId={P} costHeadId={H} onSaved={() => {}} />);
    await screen.findByRole('option', { name: 'H1 · Head one' });
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '250' } });
    const preview = await screen.findByRole('status', { name: 'After this expense' });
    expect(preview.textContent).toContain('Actual 1,050.000');
    expect(preview.textContent).toContain('Remaining -50.000');
    expect(preview.textContent).toContain('Used 105.00%');
    expect(preview.textContent).toContain('Approval');
    expect(preview.textContent).toContain('This takes the head to its approval level');
    expect(calls.find((c) => c.url.includes('/projection'))?.url).toContain('amountFils=250000');
  });

  it('asks nothing until there is a head and a valid amount; never on edit', async () => {
    const calls = mockApi({ [`GET /api/projects/${P}/boq`]: () => ({ data: boq }) });
    render(<ExpenseForm projectId={P} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '250' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.some((c) => c.url.includes('/projection'))).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('approval of spend past the approval level', () => {
  const over = {
    current: { metrics, status: 'WARNING' },
    projected: {
      metrics: { budget: 1_000_000, actual: 1_050_000, remaining: -50_000, utilisationBp: 10_500 },
      status: 'APPROVAL_REQUIRED',
    },
  };

  it('asks for the reason and sends it with the expense', async () => {
    const onSaved = vi.fn();
    const calls = mockApi({
      [`GET /api/projects/${P}/boq`]: () => ({ data: boq }),
      [`GET /api/projects/${P}/cost-heads/${H}/projection`]: () => ({ data: over }),
      [`POST /api/projects/${P}/expenses`]: () => ({
        status: 201,
        data: { ...live, id: 'new', status: 'PENDING_APPROVAL' },
      }),
    });
    render(<ExpenseForm projectId={P} costHeadId={H} onSaved={onSaved} />);
    await screen.findByRole('option', { name: 'H1 · Head one' });
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: 'INV-9' } });
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '250' } });
    const reason = await screen.findByLabelText(/Reason for approval/);
    const send = screen.getByRole('button', { name: 'Send for approval' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // the reason is mandatory
    fireEvent.change(reason, { target: { value: 'Extra steel' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      amountFils: 250_000,
      approvalReason: 'Extra steel',
    });
  });

  it('never asks for a reason below the approval level', async () => {
    const calls = mockApi({
      [`GET /api/projects/${P}/boq`]: () => ({ data: boq }),
      [`GET /api/projects/${P}/cost-heads/${H}/projection`]: () => ({
        data: { ...over, projected: { metrics, status: 'WARNING' } },
      }),
      [`POST /api/projects/${P}/expenses`]: () => ({ status: 201, data: live }),
    });
    render(<ExpenseForm projectId={P} costHeadId={H} onSaved={() => {}} />);
    await screen.findByRole('option', { name: 'H1 · Head one' });
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '10' } });
    await screen.findByRole('status', { name: 'After this expense' });
    expect(screen.queryByLabelText(/Reason for approval/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows a held expense for what it is, with Cancel request instead of Edit or Reverse', async () => {
    const waiting = {
      ...live,
      id: 'e9',
      invoiceNo: 'INV-9',
      amountFils: 300_000,
      attachment: null,
      status: 'PENDING_APPROVAL',
      approval: {
        id: 'a9',
        status: 'PENDING',
        reason: 'Extra steel',
        requestedBy: { id: 'u1', name: 'Ada' },
        decidedBy: null,
        decidedAt: null,
        decisionComment: null,
      },
    };
    const calls = mockApi({
      [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({
        data: { ...detail, expenses: { items: [waiting], total: 1, page: 1, pageSize: 50 } },
      }),
      [`POST /api/projects/${P}/expenses/e9/cancel-approval`]: () => ({ data: {} }),
    });
    render(<CostHeadPage projectId={P} costHeadId={H} />);
    const row = (await screen.findByText('INV-9')).closest('tr') as HTMLElement;
    expect(row.textContent).toContain('Awaiting approval');
    expect(row.className).toBe('clickable inactive');
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Reverse' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/expenses/e9/cancel-approval'))).toBe(true),
    );
  });
});
