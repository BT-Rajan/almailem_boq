import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, LogIn, Mail } from 'lucide-react';
import type { SessionInfo } from '@boq/shared';
import { login } from '../api/auth';
import { APP_NAME, Brand } from '../components/BrandMark';

/**
 * Sign-in, laid out like the Almailem roadmap UI: a brand panel beside the card on wide screens,
 * the card alone (with a compact brand above it) on smaller ones.
 */
export function LoginPage(props: { onSignedIn: (info: SessionInfo) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      props.onSignedIn(await login({ email: email.trim(), password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-hero" aria-label={APP_NAME}>
        <div className="auth-brand">
          <Brand />
        </div>
        <div>
          <h1>
            Every <span className="text-gradient-gold">estimate</span>, every{' '}
            <span className="text-gradient-gold">expense</span>, under control.
          </h1>
          <p>
            Estimates, expenses and approvals for every project and cost head in one place, with
            Budget, Actual and Remaining always in view.
          </p>
        </div>
        <div className="auth-badges">
          <span>Secure access</span>
          <span className="dot" />
          <span>Admin approval</span>
        </div>
      </section>

      <div className="auth-side">
        <div className="auth-column">
          <div className="auth-compact-brand">
            <Brand />
          </div>
          <form className="auth-card form" onSubmit={submit}>
            <div>
              <h2>Sign in</h2>
              <p className="lead">Welcome back. Sign in to your account.</p>
            </div>
            <label className="field">
              Email
              <span className="control">
                <Mail size={16} aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </span>
            </label>
            <label className="field">
              Password
              <span className="control">
                <Lock size={16} aria-hidden="true" />
                <input
                  className="with-toggle"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="icon-button reveal"
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  onClick={() => setReveal(!reveal)}
                >
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <button className="btn-primary btn-block" type="submit" disabled={busy}>
              <LogIn size={16} aria-hidden="true" />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="auth-footer">
            © {new Date().getFullYear()} Almailem Engineering Consultants
          </p>
        </div>
      </div>
    </div>
  );
}
