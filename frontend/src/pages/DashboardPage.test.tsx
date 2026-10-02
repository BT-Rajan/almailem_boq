// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../testing';
import { DashboardPage } from './DashboardPage';
import { ProjectPage } from './projects/ProjectPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

// Server-computed figures; the page must show them exactly as given.
const dashboard = {
  summary: {
    projects: 2,
    pendingApprovals: 3,
    metrics: { budget: 3_000_000, actual: 2_150_000, remaining: 850_000, utilisationBp: 7166 },
    status: 'NORMAL',
  },
  projects: [
    {
      id: 'p1',
      code: 'ALM-1',
      name: 'Tower',
      projectStatus: 'active',
      metrics: { budget: 1_000_000, actual: 1_050_000, remaining: -50_000, utilisationBp: 10_500 },
      status: 'APPROVAL_REQUIRED',
    },
    {
      id: 'p2',
      code: 'ALM-2',
      name: 'Villas',
      projectStatus: 'on_hold',
      metrics: { budget: 2_000_000, actual: 1_100_000, remaining: 900_000, utilisationBp: 5500 },
      status: 'NORMAL',
    },
  ],
};

describe('Dashboard', () => {
  it('shows the headline figures and a dense project table, as the server sent them', async () => {
    mockApi({ 'GET /api/dashboard': () => ({ data: dashboard }) });
    render(<DashboardPage userName="Ada Lovelace" />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByText(/^Good (morning|afternoon|evening), Ada$/)).toBeTruthy();
    // Budget > Actual > Remaining > Used (with its status dot), then the counts.
    const tiles = within(await screen.findByRole('group', { name: 'Portfolio figures' }))
      .getAllByText(/./, { selector: '.tile-value' })
      .map((v) => `${v.textContent} ${v.nextElementSibling?.textContent}`);
    expect(tiles).toEqual([
      '3,000.000 Budget (KWD)',
      '2,150.000 Actual (KWD)',
      '850.000 Remaining (KWD)',
      '71.66% Used · Normal',
      '2 Projects',
      '3 Pending approvals',
    ]);
    expect(screen.getByText('Pending approvals').closest('a')?.getAttribute('href')).toBe(
      '#/approvals',
    );
    const headers = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(headers).toEqual([
      'Project',
      'Budget',
      'Actual',
      'Remaining',
      'Used',
      'Status',
      'Action',
    ]);
    const tower = screen.getByText(/ALM-1 · Tower/).closest('tr') as HTMLElement;
    expect(
      within(tower)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([
      'ALM-1 · Tower Active',
      '1,000.000',
      '1,050.000',
      '-50.000',
      '105.00%',
      'Approval',
      'Open',
    ]);
    fireEvent.click(tower);
    expect(window.location.hash).toBe('#/projects/p1');
  });
});

describe('Project header and "needs attention first"', () => {
  const ID = '55555555-5555-4555-8555-555555555555';
  const project = {
    id: ID,
    code: 'ALM-1',
    name: 'Tower',
    status: 'active',
    ownerUserId: 'u1',
    ownerName: 'Ada',
    startDate: null,
    endDate: null,
    description: null,
    nextStatuses: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const boq = {
    rows: [],
    total: { budget: 1_000_000, actual: 820_000, remaining: 180_000, utilisationBp: 8200 },
    totalStatus: 'WARNING',
    editable: true,
  };

  it('shows the project figures, and asks the server for attention order when ticked', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
    });
    render(<ProjectPage id={ID} />);
    const figures = await screen.findByLabelText('Project figures');
    expect(figures.textContent).toBe(
      'Budget1,000.000Actual820.000Remaining180.000Used82.00%StatusWarning',
    );
    fireEvent.click(screen.getByLabelText('Needs attention first'));
    await waitFor(() => expect(calls.at(-1)?.url).toBe(`/api/projects/${ID}/boq?order=attention`));
  });
});
