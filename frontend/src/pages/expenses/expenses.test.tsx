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
  rows: [{ costHead: { id: H, code: 'H1', name: 'Head one', active: true }, metrics }],
  total: metrics,
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
  reversalOf: null,
  reversedAt: null,
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
  expenses: { items: [reversal, reversed, live], total: 3, page: 1, pageSize: 50 },
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
    fireEvent.change(screen.getByLabelText('Amount (KWD)'), { target: { value: '-3' } });
    expect(
      (screen.getByRole('button', { name: 'Add expense' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('Cost-head detail', () => {
  it('shows Budget, Actual, Remaining and Used, and every entry with the right actions', async () => {
    mockApi({ [`GET /api/projects/${P}/cost-heads/${H}`]: () => ({ data: detail }) });
    render(<CostHeadPage projectId={P} costHeadId={H} />);
    const figures = await screen.findByLabelText('Figures');
    expect(figures.textContent).toBe('Budget1,000.000Actual800.000Remaining200.000Used80.00%');

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
});
