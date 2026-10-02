// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../testing';
import { CreateProjectPage } from './CreateProjectPage';
import { ProjectPage } from './ProjectPage';
import { ProjectsPage } from './ProjectsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const ID = '11111111-1111-4111-8111-111111111111';
const project = {
  id: ID,
  code: 'ALM-1',
  name: 'Tower',
  status: 'active',
  ownerUserId: 'u1',
  ownerName: 'Ada',
  startDate: '2026-01-31',
  endDate: null,
  description: null,
  nextStatuses: ['on_hold', 'completed', 'cancelled'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const zero = { budget: 0, actual: 0, remaining: 0, utilisationBp: 0 };
const emptyBoq = { rows: [], total: zero, totalStatus: 'NORMAL', editable: true };
const members = [
  { id: 'u1', name: 'Ada', email: 'ada@x.com', isOwner: true, removable: false },
  { id: 'u2', name: 'Bo', email: 'bo@x.com', isOwner: false, removable: true },
  { id: 'u3', name: 'Cy', email: 'cy@x.com', isOwner: false, removable: false },
];

describe('Projects list', () => {
  it('shows the projects the API returns, with dates in Kuwait format', async () => {
    const calls = mockApi({
      'GET /api/projects': () => ({ data: { items: [project], total: 1, page: 1, pageSize: 50 } }),
    });
    render(<ProjectsPage />);
    expect(await screen.findByText('Tower')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('31/01/2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'tow' } });
    await waitFor(() => expect(calls.at(-1)?.url).toContain('search=tow'));
  });
});

describe('Create project (step 1: details)', () => {
  it('sends the details, leaving out empty fields, then opens the new project', async () => {
    const calls = mockApi({
      'GET /api/users/lookup': () => ({ data: [] }),
      'POST /api/projects': () => ({ status: 201, data: project }),
    });
    render(<CreateProjectPage />);
    expect(screen.getByRole('list', { name: 'Steps' }).textContent).toBe(
      '1. Details2. BoQ3. Review',
    );
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'ALM-1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tower' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: BoQ' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${ID}/setup/boq`));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      code: 'ALM-1',
      name: 'Tower',
      startDate: '2026-01-31',
      endDate: null,
      description: null,
    });
  });

  it('shows the server validation message', async () => {
    mockApi({
      'GET /api/users/lookup': () => ({ data: [] }),
      'POST /api/projects': () => ({
        status: 409,
        error: { code: 'CONFLICT', message: 'Project already exists' },
      }),
    });
    render(<CreateProjectPage />);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: BoQ' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Project already exists');
  });
});

describe('Project page', () => {
  it('offers exactly the status changes the server allows', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: emptyBoq }),
      [`POST /api/projects/${ID}/status`]: () => ({ data: { ...project, status: 'on_hold' } }),
    });
    render(<ProjectPage id={ID} />);
    await screen.findByText('ALM-1 · Tower');
    const labels = screen.getAllByRole('button', { name: /^Mark / }).map((b) => b.textContent);
    expect(labels).toEqual(['Mark on hold', 'Mark completed', 'Mark cancelled']);
    fireEvent.click(screen.getByRole('button', { name: 'Mark on hold' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ status: 'on_hold' }),
    );
  });

  it('members tab: owner and administrators cannot be removed; others can', async () => {
    const calls = mockApi({
      [`GET /api/projects/${ID}`]: () => ({ data: project }),
      [`GET /api/projects/${ID}/boq`]: () => ({ data: emptyBoq }),
      [`GET /api/projects/${ID}/members`]: () => ({ data: members }),
      [`DELETE /api/projects/${ID}/members/u2`]: () => ({ data: members.slice(0, 1) }),
      'GET /api/users/lookup': () => ({ data: [] }),
    });
    render(<ProjectPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Members' }));
    await screen.findByText('bo@x.com');
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Administrator')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('validation messages', () => {
  it('shows the field message, not just "Invalid input"', async () => {
    mockApi({
      'GET /api/users/lookup': () => ({ data: [] }),
      'POST /api/projects': () => ({
        status: 400,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [{ path: 'endDate', message: 'End date must be after the start date' }],
        },
      }),
    });
    render(<CreateProjectPage />);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: BoQ' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Invalid input: End date must be after the start date',
    );
  });
});
