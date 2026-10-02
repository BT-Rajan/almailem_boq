// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../testing';
import { ApprovalRulesPage } from './ApprovalRulesPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rules = {
  warningBp: 8000,
  approvalBp: 10000,
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: null,
};

describe('Approval rules page', () => {
  it('shows the stored levels as percentages and saves basis points', async () => {
    const calls = mockApi({
      'GET /api/admin/approval-rules': () => ({ data: rules }),
      'PUT /api/admin/approval-rules': () => ({ data: { ...rules, warningBp: 7550 } }),
    });
    render(<ApprovalRulesPage />);
    const warning = (await screen.findByLabelText('Warning level (%)')) as HTMLInputElement;
    expect(warning.value).toBe('80.00');
    expect((screen.getByLabelText('Approval level (%)') as HTMLInputElement).value).toBe('100.00');
    fireEvent.change(warning, { target: { value: '75.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        warningBp: 7550,
        approvalBp: 10000,
      }),
    );
  });

  it('will not send a value that is not a percentage, and shows server refusals', async () => {
    mockApi({
      'GET /api/admin/approval-rules': () => ({ data: rules }),
      'PUT /api/admin/approval-rules': () => ({
        status: 400,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [
            { path: 'warningBp', message: 'The warning level must be below the approval level' },
          ],
        },
      }),
    });
    render(<ApprovalRulesPage />);
    const warning = await screen.findByLabelText('Warning level (%)');
    fireEvent.change(warning, { target: { value: 'eighty' } });
    expect((screen.getByRole('button', { name: 'Save rules' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(warning, { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Invalid input: The warning level must be below the approval level',
    );
  });
});
