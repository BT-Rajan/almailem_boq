import { useState, type FormEvent } from 'react';
import type { SessionInfo } from '@boq/shared';
import { login } from '../api/auth';
import { ErrorText } from '../components/SlideOver';

export function LoginPage(props: { onSignedIn: (info: SessionInfo) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      props.onSignedIn(await login({ email, password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <form className="panel login" onSubmit={submit}>
      <h1>Sign in</h1>
      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <ErrorText message={error} />
      <button className="btn-primary" type="submit" disabled={busy}>
        Sign in
      </button>
    </form>
  );
}
