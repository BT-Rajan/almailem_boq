// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER } from '@boq/shared';
import { setCsrfToken } from '../../api/client';
import { mockApi } from '../../testing';
import { UsersPage } from './UsersPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROLES = [
  { id: 'r-view', name: 'Viewer', description: null, isSystem: true, permissions: [] },
  { id: 'r-acc', name: 'Accountant', description: null, isSystem: true, permissions: [] },
];
const ada = {
  id: 'u1',
  email: 'ada@x.com',
  name: 'Ada',
  disabled: false,
  locked: false,
  roles: [{ id: 'r-view', name: 'Viewer' }],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const page = (items: unknown[]) => ({
  data: { items, total: items.length, page: 1, pageSize: 50 },
});

describe('Users page', () => {
  it('lists users densely and searches through the API', async () => {
    const calls = mockApi({ 'GET /api/admin/users': () => page([ada]) });
    render(<UsersPage />);
    expect(await screen.findByText('ada@x.com')).toBeTruthy();
    expect(screen.getByText('Viewer')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'ad%a' } });
    await waitFor(() => expect(calls.at(-1)?.url).toContain('search=ad%25a'));
    expect(calls.at(-1)?.url).toContain('page=1');
  });

  it('creates a user from the slide-over, sending the CSRF token', async () => {
    setCsrfToken('csrf-xyz');
    const calls = mockApi({
      'GET /api/admin/users': () => page([]),
      'POST /api/admin/users': () => ({ status: 201, data: { ...ada, projects: [] } }),
      'GET /api/admin/users/u1': () => ({ data: { ...ada, projects: [] } }),
      'GET /api/admin/roles': () => ({ data: ROLES }),
      'GET /api/admin/projects': () => ({ data: [] }),
    });
    render(<UsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@x.com' } });
    fireEvent.change(screen.getByLabelText(/Initial password/), {
      target: { value: 'long-enough-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await screen.findByRole('heading', { name: 'Roles' }); // switched to the user detail
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ name: 'Ada', email: 'ada@x.com', password: 'long-enough-pass' });
    expect(post?.headers[CSRF_HEADER]).toBe('csrf-xyz');
  });

  it('assigns a role and shows a server refusal (e.g. last administrator)', async () => {
    const calls = mockApi({
      'GET /api/admin/users': () => page([ada]),
      'GET /api/admin/users/u1': () => ({ data: { ...ada, projects: [] } }),
      'GET /api/admin/roles': () => ({ data: ROLES }),
      'GET /api/admin/projects': () => ({ data: [] }),
      'PUT /api/admin/users/u1/roles/r-acc': () => ({ data: ada }),
      'DELETE /api/admin/users/u1/roles/r-view': () => ({
        status: 409,
        error: { code: 'LAST_ADMIN', message: 'At least one enabled user must keep the right' },
      }),
    });
    render(<UsersPage />);
    fireEvent.click(await screen.findByText('ada@x.com'));
    fireEvent.click(await screen.findByLabelText('Accountant'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));

    fireEvent.click(screen.getByLabelText('Viewer'));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'At least one enabled user must keep the right',
    );
  });
});
