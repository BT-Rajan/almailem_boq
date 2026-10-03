// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../testing';
import { ApprovalsPage } from './ApprovalsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const waiting = {
  id: 'a1',
  status: 'PENDING',
  project: { id: 'p1', systemNo: 'P00001', name: 'Tower' },
  costHead: { id: 'h1', code: 'H1', name: 'Steel' },
  expense: {
    id: 'e1',
    vendor: 'Acme',
    invoiceNo: 'INV-7',
    expenseDate: '2026-09-01',
    amountFils: 150_000,
    hasAttachment: false,
  },
  reason: 'Extra steel after redesign',
  requestedBy: { id: 'u1', name: 'Ada' },
  requestedAt: '2026-09-02T08:00:00.000Z',
  requestedBp: 10_500,
  decidedBy: null,
  decidedAt: null,
  decidedBp: null,
  decisionComment: null,
  now: {
    current: {
      metrics: { budget: 1_000_000, actual: 900_000, remaining: 100_000, utilisationBp: 9_000 },
      status: 'WARNING',
    },
    projected: {
      metrics: { budget: 1_000_000, actual: 1_050_000, remaining: -50_000, utilisationBp: 10_500 },
      status: 'APPROVAL_REQUIRED',
    },
  },
};
const page = (items: unknown[]) => ({
  data: { items, total: items.length, page: 1, pageSize: 50 },
});

describe('Approvals', () => {
  it('lists waiting spend with Budget, Actual, Remaining and Used after it, as the server sent them', async () => {
    const calls = mockApi({ 'GET /api/approvals': () => page([waiting]) });
    render(<ApprovalsPage />);
    const row = (await screen.findByText('INV-7', { exact: false })).closest('tr') as HTMLElement;
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual([
      'P00001 · H1',
      'INV-7',
      '150.000',
      '1,000.000',
      '900.000',
      '-50.000',
      '105.00%',
      '',
      'Extra steel after redesign',
      'Decide',
    ]);
    expect(within(row).getByRole('img', { name: 'Approval' })).toBeTruthy();
    expect(within(row).getByText('Extra steel after redesign').getAttribute('title')).toBe(
      'Ada, 02/09/2026: Extra steel after redesign',
    );
    expect(calls[0]?.url).toContain('status=PENDING');
  });

  it('approves with an optional comment, then reloads', async () => {
    const calls = mockApi({
      'GET /api/approvals': () => page([waiting]),
      'POST /api/approvals/a1/approve': () => ({ data: { ...waiting, status: 'APPROVED' } }),
    });
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    const sheet = screen.getByRole('dialog', { name: 'Decide on spend' });
    expect(within(sheet).getByLabelText('After this expense').textContent).toContain('105.00%');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({});
  });

  it('rejects only with a comment, and shows the server refusing self-approval', async () => {
    const calls = mockApi({
      'GET /api/approvals': () => page([waiting]),
      'POST /api/approvals/a1/reject': () => ({
        status: 403,
        error: { code: 'SELF_APPROVAL', message: 'You cannot decide on your own request' },
      }),
    });
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    const sheet = screen.getByRole('dialog', { name: 'Decide on spend' });
    const go = within(sheet).getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText(/Comment/), { target: { value: 'No' } });
    fireEvent.click(go);
    expect((await within(sheet).findByRole('alert')).textContent).toBe(
      'You cannot decide on your own request',
    );
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ comment: 'No' });
  });

  it('switches to decided requests, which show the decision instead of buttons', async () => {
    const decided = {
      ...waiting,
      status: 'APPROVED',
      now: null,
      decidedBp: 5_000,
      decidedBy: { id: 'u2', name: 'Omar' },
      decisionComment: 'Agreed',
    };
    const calls = mockApi({
      'GET /api/approvals': (c) => page(c.url.includes('status=APPROVED') ? [decided] : []),
    });
    render(<ApprovalsPage />);
    await screen.findByText('Nothing waiting');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'APPROVED' } });
    const row = (await screen.findByText('INV-7', { exact: false })).closest('tr') as HTMLElement;
    expect(row.textContent).toContain('50.00%');
    expect(row.textContent).toContain('Omar');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(calls.at(-1)?.url).toContain('status=APPROVED');
  });
});
