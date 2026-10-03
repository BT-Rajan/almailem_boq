// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../testing';
import { CreateProjectPage } from './CreateProjectPage';
import { ProjectPage } from './ProjectPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const ID = '22222222-2222-4222-8222-222222222222';
// Placeholder heads and server-computed figures; the UI must show them as given.
const row = (
  id: string,
  code: string,
  budget: number,
  actual: number,
  remaining: number,
  utilisationBp: number,
  active = true,
) => ({
  costHead: {
    id,
    systemNo: `C${code.replace(/\D/g, '').padStart(3, '0')}`,
    code,
    name: `Head ${code}`,
    active,
  },
  inBudget: true,
  metrics: { budget, actual, remaining, utilisationBp },
  status: utilisationBp >= 10_000 ? 'APPROVAL_REQUIRED' : 'NORMAL', // as a server would send it
});
const boq = {
  rows: [row('h1', 'H1', 1_250_500, 0, 1_250_500, 0), row('h2', 'H2', 1_000, 1_500, -500, 15_000)],
  total: { budget: 1_251_500, actual: 1_500, remaining: 1_250_000, utilisationBp: 11 },
  totalStatus: 'NORMAL',
  editable: true,
};
const project = {
  id: ID,
  code: 'ALM-9',
  name: 'Villas',
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

const noBudget = {
  rows: [row('h1', 'H1', 0, 0, 0, 0), row('h2', 'H2', 0, 0, 0, 0)],
  total: { budget: 0, actual: 0, remaining: 0, utilisationBp: 0 },
  totalStatus: 'NORMAL',
  editable: true,
};
const head = (id: string, code: string) => ({
  id,
  systemNo: `C${code.replace(/\D/g, '').padStart(3, '0')}`,
  code,
  name: `Head ${code}`,
});
const structure = (over: Record<string, unknown> = {}) => ({
  approved: [],
  approvedTotalFils: 0,
  lockedHeadIds: [],
  latest: null,
  editable: true,
  ...over,
});

describe('Cost structure: select costs, enter estimates, submit for approval', () => {
  it('selects heads in two columns, enters estimates by tapping rows, and submits the exact amounts', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}/boq`]: () => ({ data: noBudget }),
      [`GET /api/projects/${ID}/cost-structure`]: () => ({ data: structure() }),
      [`POST /api/projects/${ID}/cost-structure/proposals`]: () => ({ status: 201, data: {} }),
    });
    render(<CreateProjectPage step="boq" projectId={ID} />);
    const grid = await screen.findByRole('group', { name: 'Cost heads' });
    const boxes = within(grid).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual([
      'C001Head H1',
      'C002Head H2',
    ]);
    const next = screen.getByRole('button', { name: 'Next: Enter estimates' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    for (const b of boxes) fireEvent.click(b);
    fireEvent.click(next);
    expect(screen.getByText('3. Enter estimates').className).toBe('active');

    const review = screen.getByRole('button', { name: 'Next: Review' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true); // every selected head needs an amount
    fireEvent.click(screen.getByRole('row', { name: 'Estimate for C001' }));
    const input = screen.getByLabelText('Estimated amount (KWD)');
    fireEvent.change(input, { target: { value: '1.2345' } }); // never rounded: refused
    const save = screen.getByRole('button', { name: 'Save estimate' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '1,250.5' } });
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('row', { name: 'Estimate for C002' }));
    fireEvent.change(screen.getByLabelText('Estimated amount (KWD)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
    const c1 = within(screen.getByRole('row', { name: 'Estimate for C001' }))
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(c1).toEqual(['C001', 'Head H1', '1,250.500', 'New']);

    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(screen.getByText('4. Review').className).toBe('active');
    const lines = within(screen.getByRole('table', { name: 'Proposed cost structure' }));
    expect(lines.getAllByText('Added')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Admin approval' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${ID}`));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      lines: [
        { costHeadId: 'h1', amountFils: 1_250_500 },
        { costHeadId: 'h2', amountFils: 0 },
      ],
    });
  });

  it('changes after approval: a head with expenses stays selected; removals are listed', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}/boq`]: () => ({ data: noBudget }),
      [`GET /api/projects/${ID}/cost-structure`]: () => ({
        data: structure({
          approved: [
            { costHead: head('h1', 'H1'), amountFils: 1_000 },
            { costHead: head('h2', 'H2'), amountFils: 500 },
          ],
          approvedTotalFils: 1_500,
          lockedHeadIds: ['h2'],
        }),
      }),
      [`POST /api/projects/${ID}/cost-structure/proposals`]: () => ({ status: 201, data: {} }),
    });
    render(<CreateProjectPage step="boq" projectId={ID} />);
    const grid = await screen.findByRole('group', { name: 'Cost heads' });
    const [h1, h2] = within(grid).getAllByRole('checkbox') as HTMLInputElement[];
    expect([h1?.checked, h2?.checked, h2?.disabled]).toEqual([true, true, true]);
    expect(h2?.closest('label')?.textContent).toContain('has expenses');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Enter estimates' }));
    // Unchanged: nothing to submit.
    expect(
      (screen.getByRole('button', { name: 'Next: Review' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Nothing changed from the approved budget.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back: Select costs' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Cost heads' })).getAllByRole(
        'checkbox',
      )[0] as HTMLElement,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: Enter estimates' }));
    expect(screen.getByText(/To be removed from the budget: C001 Head H1 \(1\.000\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    expect(screen.getByText('Removed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Admin approval' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        lines: [{ costHeadId: 'h2', amountFils: 500 }],
      }),
    );
  });

  it('a waiting request blocks a new one', async () => {
    mockApi({
      [`GET /api/projects/${ID}/boq`]: () => ({ data: noBudget }),
      [`GET /api/projects/${ID}/cost-structure`]: () => ({
        data: structure({
          latest: {
            status: 'PENDING',
            requestedBy: { id: 'u1', name: 'Ada' },
            requestedAt: '2026-09-01T00:00:00Z',
            approvedTotalFils: 0,
            proposedTotalFils: 0,
            lines: [],
          },
        }),
      }),
    });
    render(<CreateProjectPage step="boq" projectId={ID} />);
    expect((await screen.findByText(/Pending Admin approval/)).textContent).toContain('Ada');
    await waitFor(() => expect(screen.getByText('5. Admin approval').className).toBe('active'));
    expect(screen.queryByRole('group', { name: 'Cost heads' })).toBeNull();
  });
});

describe('Project summary tab', () => {
  it('shows Approved Estimate, Actual, Remaining, Utilisation and an Action per head, as the server sent them', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
    });
    render(<ProjectPage id={ID} />);
    const h2 = (await screen.findAllByText('Head H2'))
      .map((e) => e.closest('tr'))
      .find(Boolean) as HTMLElement;
    const cells = within(h2)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual([
      'C002',
      'H2 Head H2',
      '1.000',
      '1.500',
      '-0.500',
      '150.00%',
      'Approval',
      'Open',
    ]);
    const headers = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(headers.slice(0, 8)).toEqual([
      'Cost Code',
      'Cost Head',
      'Approved Estimate',
      'Actual',
      'Remaining',
      'Utilisation %',
      'Status',
      'Action',
    ]);
  });

  it('lists only approved heads (and any still carrying spend); a row opens its expenses', async () => {
    const extra = { ...row('h3', 'H3', 0, 0, 0, 0), inBudget: false };
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: { ...boq, rows: [...boq.rows, extra] } }),
    });
    render(<ProjectPage id={ID} />);
    const h1 = (await screen.findAllByText('Head H1'))
      .map((e) => e.closest('tr'))
      .find(Boolean) as HTMLElement;
    expect(screen.queryByText('Head H3')).toBeNull();
    fireEvent.click(h1.querySelector('td') as HTMLElement);
    expect(window.location.hash).toBe(`#/projects/${ID}/heads/h1`);
  });

  it('charts Estimate against Actual from the same rows, uncapped, each head linking to its expenses', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
    });
    render(<ProjectPage id={ID} />);
    const chart = await screen.findByRole('figure', { name: /Approved Estimate and Actual/ });
    const items = within(chart).getAllByRole('link');
    expect(items.map((a) => a.getAttribute('href'))).toEqual([
      `#/projects/${ID}/heads/h1`,
      `#/projects/${ID}/heads/h2`,
    ]);
    // H1: estimate 1,250.500 is the largest figure; actual 0 draws no bar but shows 0.000.
    expect(
      within(items[0] as HTMLElement).getByLabelText('Approved Estimate 1,250.500'),
    ).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByLabelText('Actual 0.000')).toBeTruthy();
    const bars = (a: HTMLElement) =>
      [...a.querySelectorAll<HTMLElement>('.ea-bar')].map((b) => b.style.width);
    expect(bars(items[0] as HTMLElement)).toEqual(['100%', '0%']);
    // H2: actual 1.500 over estimate 1.000 is drawn longer, not capped at the estimate.
    const [est, act] = bars(items[1] as HTMLElement).map(parseFloat) as [number, number];
    expect(act / est).toBeCloseTo(1.5);
  });

  it('shows an empty state, not an empty chart, without approved heads', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({
        data: { ...noBudget, rows: noBudget.rows.map((r) => ({ ...r, inBudget: false })) },
      }),
    });
    render(<ProjectPage id={ID} />);
    expect(await screen.findByText(/nothing to chart/)).toBeTruthy();
    expect(screen.queryByRole('figure')).toBeNull();
  });

  it('the approved budget is frozen: no direct edit, its state is shown with the next step', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
      [`GET /api/projects/${ID}/cost-structure`]: () => ({
        data: structure({
          approved: [{ costHead: head('h1', 'H1'), amountFils: 1_250_500 }],
          approvedTotalFils: 1_250_500,
        }),
      }),
    });
    render(<ProjectPage id={ID} />);
    const status = await screen.findByText(/Budget approved: 1 cost heads, 1,250.500 KWD/);
    expect(status.closest('p')?.querySelector('a')?.textContent).toBe('Propose a change');
    expect(screen.queryByRole('button', { name: /Edit budget/ })).toBeNull();
  });

  it('a waiting change is shown, never counted as budget', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
      [`GET /api/projects/${ID}/cost-structure`]: () => ({
        data: structure({
          approved: [{ costHead: head('h1', 'H1'), amountFils: 1_250_500 }],
          approvedTotalFils: 1_250_500,
          latest: {
            status: 'PENDING',
            proposedTotalFils: 2_000_000,
            requestedBy: { id: 'u1', name: 'Ada' },
            requestedAt: '2026-09-01T00:00:00Z',
            lines: [],
          },
        }),
      }),
    });
    render(<ProjectPage id={ID} />);
    const notice = await screen.findByText(/pending Admin approval/);
    expect(notice.textContent).toContain('proposed 2,000.000 KWD');
    expect(notice.textContent).toContain(
      'The approved budget (1,250.500 KWD) below stays in force',
    );
    // The figures stay the approved budget.
    expect((await screen.findByLabelText('Project figures')).textContent).toContain(
      'Total Approved Estimate1,251.500',
    );
  });

  it('no Edit actions when the project is locked', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: { ...boq, editable: false } }),
    });
    render(<ProjectPage id={ID} />);
    await screen.findAllByText('Head H1');
    expect(screen.queryByRole('button', { name: /Edit budget/ })).toBeNull();
  });
});
