// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { mockApi } from './testing';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const session = {
  user: { id: 'u1', email: 'a@x.com', name: 'Ada Admin' },
  permissions: ['admin.users.manage'],
  csrfToken: 'csrf-1',
};

describe('App shell', () => {
  it('renders the brand and asks a signed-out visitor to sign in', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 401, error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    });
    render(<App />);
    expect(screen.getByText('Almailem BoQ Manager')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('opens on the dashboard, with projects and administration in the nav', async () => {
    window.location.hash = '';
    const zero = { budget: 0, actual: 0, remaining: 0, utilisationBp: 0 };
    mockApi({
      'GET /api/auth/me': () => ({ data: session }),
      'GET /api/dashboard': () => ({
        data: { summary: { projects: 0, metrics: zero, status: 'NORMAL' }, projects: [] },
      }),
    });
    render(<App />);
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
    for (const name of ['Dashboard', 'Projects', 'Users', 'Roles', 'Cost heads', 'Approval rules'])
      expect(screen.getByRole('link', { name })).toBeTruthy();
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });
});
