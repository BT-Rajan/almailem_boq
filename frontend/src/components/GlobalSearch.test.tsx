// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../testing';
import { GlobalSearch } from './GlobalSearch';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const hit = {
  projectId: 'p1',
  projectCode: 'ALM-1',
  costHeadId: 'h1',
  expenseId: 'e1',
  vendor: 'Gulf Steel',
  invoiceNo: 'GS-42',
  expenseDate: '2026-06-01',
  amountFils: 75_500_000,
  description: 'rebar for podium',
};

describe('Global search', () => {
  it('asks only from 2 characters, then shows each group with links into the projects', async () => {
    const calls = mockApi({
      'GET /api/search': () => ({
        data: {
          projects: [{ id: 'p1', code: 'ALM-1', name: 'Tower' }],
          costHeads: [{ id: 'h1', code: 'C1', name: 'Steel', active: false }],
          invoices: [hit],
          vendors: [{ vendor: 'Gulf Steel', expenses: 3, projects: 2 }],
          expenses: [hit],
        },
      }),
    });
    render(<GlobalSearch />);
    const box = screen.getByLabelText('Search everything');
    fireEvent.change(box, { target: { value: 's' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toHaveLength(0);

    fireEvent.change(box, { target: { value: 'steel' } });
    const results = await screen.findByRole('listbox', { name: 'Search results' });
    expect(calls.at(-1)?.url).toBe('/api/search?q=steel');
    expect(results.textContent).toContain('Projects');
    expect(screen.getByRole('link', { name: 'ALM-1 · Tower' }).getAttribute('href')).toBe(
      '#/projects/p1',
    );
    expect(
      screen
        .getByRole('link', { name: /GS-42 · Gulf Steel · 75,500.000 · ALM-1/ })
        .getAttribute('href'),
    ).toBe('#/projects/p1/heads/h1');
    expect(results.textContent).toContain('3 expenses in 2 projects');
    expect(results.textContent).toContain('(inactive)');

    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('says when nothing matches', async () => {
    mockApi({
      'GET /api/search': () => ({
        data: { projects: [], costHeads: [], invoices: [], vendors: [], expenses: [] },
      }),
    });
    render(<GlobalSearch />);
    fireEvent.change(screen.getByLabelText('Search everything'), { target: { value: 'zz' } });
    expect(await screen.findByText('Nothing found')).toBeTruthy();
  });
});
