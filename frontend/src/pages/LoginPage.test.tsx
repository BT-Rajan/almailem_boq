// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../testing';
import { LoginPage } from './LoginPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const session = {
  user: { id: 'u1', email: 'ada@example.com', name: 'Ada' },
  permissions: [],
  csrfToken: 'c',
};

describe('Sign-in page', () => {
  it('signs in with the trimmed email and the password as typed', async () => {
    const onSignedIn = vi.fn();
    const calls = mockApi({ 'POST /api/auth/login': () => ({ data: session }) });
    render(<LoginPage onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' ada@example.com ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: ' secret pass ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session));
    expect(calls[0]?.body).toEqual({ email: 'ada@example.com', password: ' secret pass ' });
  });

  it('shows and hides the password', () => {
    mockApi({});
    render(<LoginPage onSignedIn={() => {}} />);
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
  });

  it("shows the server's refusal and lets the person try again", async () => {
    mockApi({
      'POST /api/auth/login': () => ({
        status: 401,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      }),
    });
    render(<LoginPage onSignedIn={() => {}} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Email or password is incorrect');
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
