// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(document.querySelector('.brand-name')?.textContent).toBe('Almailem BoQ Manager');
    // No app chrome until signed in.
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('opens on the dashboard, with projects and administration in the nav', async () => {
    window.location.hash = '';
    const zero = { budget: 0, actual: 0, remaining: 0, utilisationBp: 0 };
    mockApi({
      'GET /api/auth/me': () => ({ data: session }),
      'GET /api/dashboard': () => ({
        data: {
          summary: { projects: 0, pendingApprovals: 0, metrics: zero, status: 'NORMAL' },
          projects: [],
        },
      }),
    });
    render(<App />);
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const name of [
      'Dashboard',
      'Projects',
      'Approvals',
      'Users',
      'Roles',
      'Cost heads',
      'Approval rules',
    ])
      expect(within(nav).getByRole('link', { name })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });

  it('opens the menu drawer, and closes it when a page is picked or on Escape', async () => {
    window.location.hash = '';
    const zero = { budget: 0, actual: 0, remaining: 0, utilisationBp: 0 };
    mockApi({
      'GET /api/auth/me': () => ({ data: session }),
      'GET /api/dashboard': () => ({
        data: {
          summary: { projects: 0, pendingApprovals: 0, metrics: zero, status: 'NORMAL' },
          projects: [],
        },
      }),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Approvals' }));
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
  });
});
