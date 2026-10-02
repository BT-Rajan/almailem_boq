// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../testing';
import { CostHeadsPage } from './CostHeadsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Placeholder data, not real cost heads.
const heads = [
  { id: 'h1', code: 'T1', name: 'Head one', description: null, displayOrder: 1, active: true },
  { id: 'h2', code: 'T2', name: 'Head two', description: 'x', displayOrder: 2, active: false },
];

describe('Cost heads page', () => {
  it('lists heads from the API, inactive ones marked', async () => {
    mockApi({ 'GET /api/admin/cost-heads': () => ({ data: heads }) });
    render(<CostHeadsPage />);
    expect(await screen.findByText('Head one')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
  });

  it('moving a head down sends the complete new order', async () => {
    const calls = mockApi({
      'GET /api/admin/cost-heads': () => ({ data: heads }),
      'PUT /api/admin/cost-heads/order': () => ({ data: heads }),
    });
    render(<CostHeadsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move T1 down' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ids: ['h2', 'h1'] });
  });

  it('edits a head in the slide-over, including deactivating it', async () => {
    const calls = mockApi({
      'GET /api/admin/cost-heads': () => ({ data: heads }),
      'PATCH /api/admin/cost-heads/h1': () => ({ data: heads[0] }),
    });
    render(<CostHeadsPage />);
    fireEvent.click(await screen.findByText('Head one'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      code: 'T1',
      name: 'Renamed',
      description: null,
      active: false,
    });
  });

  it('shows the server refusal of a duplicate code', async () => {
    mockApi({
      'GET /api/admin/cost-heads': () => ({ data: heads }),
      'POST /api/admin/cost-heads': () => ({
        status: 409,
        error: { code: 'CONFLICT', message: 'Cost head already exists' },
      }),
    });
    render(<CostHeadsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New cost head' }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'T1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add cost head' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Cost head already exists');
  });
});
