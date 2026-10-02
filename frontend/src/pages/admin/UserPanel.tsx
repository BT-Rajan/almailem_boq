import { useCallback, useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@boq/shared';
import {
  assignRole,
  createUser,
  getUser,
  grantProject,
  listProjects,
  listRoles,
  removeRole,
  revokeProject,
  setUserDisabled,
} from '../../api/admin';
import { attempt, useLoad } from '../../api/use-load';
import { ErrorText } from '../../components/SlideOver';

export function CreateUserForm(props: { onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let id = '';
    const err = await attempt(async () => {
      id = (await createUser(form)).id;
    });
    setBusy(false);
    if (err) setError(err);
    else props.onCreated(id);
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Name
        <input {...field('name')} required maxLength={120} />
      </label>
      <label>
        Email
        <input type="email" {...field('email')} required maxLength={254} />
      </label>
      <label>
        Initial password
        <input
          type="password"
          autoComplete="new-password"
          {...field('password')}
          required
          minLength={PASSWORD_MIN_LENGTH}
        />
        <small className="muted">At least {PASSWORD_MIN_LENGTH} characters.</small>
      </label>
      <ErrorText message={error} />
      <button className="btn-primary" type="submit" disabled={busy}>
        Create user
      </button>
      <small className="muted">Roles and project access are set after creating.</small>
    </form>
  );
}

const loadPickers = () => Promise.all([listRoles(), listProjects()]);

export function UserDetail(props: { id: string; onChanged: () => void }) {
  const { id, onChanged } = props;
  const user = useLoad(useCallback(() => getUser(id), [id]));
  const pickers = useLoad(loadPickers);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState('');

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(await attempt(action));
    setBusy(false);
    user.reload();
    onChanged();
  };

  const u = user.data;
  if (!u) return <ErrorText message={user.error} />;
  const [roles, projects] = pickers.data ?? [[], []];
  const held = new Set(u.roles.map((r) => r.id));
  const granted = new Set(u.projects.map((p) => p.id));
  const grantable = projects.filter((p) => !granted.has(p.id));

  return (
    <div className="form">
      <dl className="facts">
        <dt>Name</dt>
        <dd>{u.name}</dd>
        <dt>Email</dt>
        <dd>{u.email}</dd>
        <dt>Status</dt>
        <dd>
          {u.disabled ? 'Disabled' : 'Active'}
          {u.locked && !u.disabled ? ' (locked after failed sign-ins)' : ''}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => setUserDisabled(u.id, !u.disabled))}
          >
            {u.disabled ? 'Enable' : 'Disable'}
          </button>
        </dd>
      </dl>
      <ErrorText message={error ?? pickers.error} />

      <h3>Roles</h3>
      {roles.map((r) => (
        <label key={r.id} className="check">
          <input
            type="checkbox"
            checked={held.has(r.id)}
            disabled={busy}
            onChange={() =>
              run(() => (held.has(r.id) ? removeRole(u.id, r.id) : assignRole(u.id, r.id)))
            }
          />
          {r.name}
        </label>
      ))}

      <h3>Project access</h3>
      <table className="table">
        <tbody>
          {u.projects.map((p) => (
            <tr key={p.id}>
              <td>{p.code}</td>
              <td>{p.name}</td>
              <td className="num">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => revokeProject(u.id, p.id))}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
          {u.projects.length === 0 && (
            <tr>
              <td className="muted">No project access</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="row">
        <select
          aria-label="Project to grant"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Choose a project…</option>
          {grantable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !projectId}
          onClick={() =>
            run(async () => {
              await grantProject(u.id, projectId);
              setProjectId('');
            })
          }
        >
          Grant
        </button>
      </div>
    </div>
  );
}
