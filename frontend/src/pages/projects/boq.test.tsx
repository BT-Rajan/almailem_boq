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
  costHead: { id, code, name: `Head ${code}`, active },
  metrics: { budget, actual, remaining, utilisationBp },
});
const boq = {
  rows: [row('h1', 'H1', 1_250_500, 0, 1_250_500, 0), row('h2', 'H2', 1_000, 1_500, -500, 15_000)],
  total: { budget: 1_251_500, actual: 1_500, remaining: 1_250_000, utilisationBp: 11 },
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

describe('Create project step 2: BoQ', () => {
  it('keeps a running total as amounts are typed and sends integer fils', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}/boq`]: () => ({
        data: {
          ...boq,
          rows: boq.rows.map((r) => ({ ...r, metrics: { ...r.metrics, budget: 0 } })),
        },
      }),
      [`PUT /api/projects/${ID}/estimates`]: () => ({ data: boq }),
    });
    render(<CreateProjectPage step="boq" projectId={ID} />);
    fireEvent.change(await screen.findByLabelText('Budget H1'), { target: { value: '1,250.5' } });
    expect(screen.getByLabelText('Running total').textContent).toBe('1,250.500');
    fireEvent.change(screen.getByLabelText('Budget H2'), { target: { value: '0.001' } });
    expect(screen.getByLabelText('Running total').textContent).toBe('1,250.501');

    fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${ID}/setup/review`));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      estimates: [
        { costHeadId: 'h1', amountFils: 1_250_500 },
        { costHeadId: 'h2', amountFils: 1 },
      ],
    });
  });

  it('blocks Next on an invalid or negative amount', async () => {
    mockApi({ [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }) });
    render(<CreateProjectPage step="boq" projectId={ID} />);
    const input = await screen.findByLabelText('Budget H1');
    for (const bad of ['abc', '-5', '1.2.3']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(
        (screen.getByRole('button', { name: 'Next: Review' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(screen.getByLabelText('Running total').textContent).toBe(
        'Check the highlighted amounts',
      );
    }
  });
});

describe('Create project step 3: Review', () => {
  it('shows the server figures, formatted, with the total', async () => {
    mockApi({ [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }) });
    render(<CreateProjectPage step="review" projectId={ID} />);
    const totalRow = (await screen.findByText('Total')).closest('tr') as HTMLElement;
    expect(within(totalRow).getByText('1,251.500')).toBeTruthy();
    expect(within(totalRow).getByText('0.11%')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Finish' }).getAttribute('href')).toBe(
      `#/projects/${ID}`,
    );
  });
});

describe('Project BoQ tab', () => {
  it('shows Budget, Actual, Remaining, Used and an Action per head, as the server sent them', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
    });
    render(<ProjectPage id={ID} />);
    const h2 = (await screen.findByText('Head H2')).closest('tr') as HTMLElement;
    const cells = within(h2)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual(['H2', 'Head H2', '1.000', '1.500', '-0.500', '150.00%', '', 'Edit']);
    const headers = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(headers.slice(0, 8)).toEqual([
      'Code',
      'Cost head',
      'Budget',
      'Actual',
      'Remaining',
      'Used',
      'Status',
      'Action',
    ]);
  });

  it('edits one head budget in KWD and sends fils', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: boq }),
      [`PUT /api/projects/${ID}/estimates`]: () => ({ data: boq }),
    });
    render(<ProjectPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit budget H1' }));
    const input = screen.getByLabelText('Budget (KWD)') as HTMLInputElement;
    expect(input.value).toBe('1,250.500');
    fireEvent.change(input, { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        estimates: [{ costHeadId: 'h1', amountFils: 2_000_000 }],
      }),
    );
  });

  it('no Edit actions when the project is locked', async () => {
    mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: { ...boq, editable: false } }),
    });
    render(<ProjectPage id={ID} />);
    await screen.findByText('Head H1');
    expect(screen.queryByRole('button', { name: /Edit budget/ })).toBeNull();
  });
});
