// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../testing';
import { ApprovalsPage } from './ApprovalsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const head = (id: string, n: number) => ({
  id,
  systemNo: `C00${n}`,
  code: `H${n}`,
  name: `Head ${n}`,
});
const proposal = {
  id: 'b1',
  status: 'PENDING',
  project: { id: 'p1', systemNo: 'P00001', code: 'ALM-1', name: 'Tower' },
  lines: [
    { costHead: head('h1', 1), approvedFils: 1_000_000, amountFils: 1_200_000, change: 'CHANGED' },
    { costHead: head('h2', 2), approvedFils: 500_000, amountFils: null, change: 'REMOVED' },
    { costHead: head('h3', 3), approvedFils: null, amountFils: 300_000, change: 'ADDED' },
  ],
  approvedTotalFils: 1_500_000,
  proposedTotalFils: 1_500_000,
  requestedBy: { id: 'u1', name: 'Ada' },
  requestedAt: '2026-09-02T08:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionComment: null,
};

describe('Budget approvals', () => {
  it('shows each head approved vs proposed with totals, and approves through the shared route', async () => {
    const calls = mockApi({
      'GET /api/approvals': () => ({ data: { items: [], total: 0, page: 1, pageSize: 50 } }),
      'GET /api/approvals/cost-structures': () => ({
        data: { items: [proposal], total: 1, page: 1, pageSize: 50 },
      }),
      'POST /api/approvals/b1/approve': () => ({ data: { ...proposal, status: 'APPROVED' } }),
    });
    render(<ApprovalsPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Budgets' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const sheet = screen.getByRole('dialog', { name: 'Budget: P00001 · Tower' });
    const rows = within(within(sheet).getByRole('table', { name: 'Proposed cost structure' }))
      .getAllByRole('row')
      .map((r) =>
        within(r)
          .queryAllByRole('cell')
          .map((c) => c.textContent),
      )
      .filter((cells) => cells.length);
    expect(rows).toEqual([
      ['C001', 'Head 1', '1,000.000', '1,200.000', 'Changed'],
      ['C002', 'Head 2', '500.000', '—', 'Removed'],
      ['C003', 'Head 3', '—', '300.000', 'Added'],
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/approvals/b1/approve')).toBe(true),
    );
  });
});
