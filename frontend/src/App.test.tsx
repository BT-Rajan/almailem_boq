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

  it('shows the administration pages to a signed-in user', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ data: session }),
      'GET /api/admin/users': () => ({ data: { items: [], total: 0, page: 1, pageSize: 50 } }),
    });
    render(<App />);
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Roles' })).toBeTruthy();
    expect(await screen.findByText('No users found')).toBeTruthy();
  });
});
