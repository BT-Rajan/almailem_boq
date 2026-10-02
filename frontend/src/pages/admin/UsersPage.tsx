import { useCallback, useState } from 'react';
import type { AdminUser } from '@boq/shared';
import { listUsers } from '../../api/admin';
import { useLoad } from '../../api/use-load';
import { ErrorText, SlideOver } from '../../components/SlideOver';
import { CreateUserForm, UserDetail } from './UserPanel';

const PAGE_SIZE = 50;

function statusLabel(u: AdminUser): string {
  if (u.disabled) return 'Disabled';
  return u.locked ? 'Locked' : 'Active';
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(
    null,
  );

  const load = useCallback(() => listUsers({ search, page, pageSize: PAGE_SIZE }), [search, page]);
  const { data, error, loading, reload } = useLoad(load);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const close = useCallback(() => setPanel(null), []);

  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Users</h1>
        <input
          type="search"
          placeholder="Search name or email"
          aria-label="Search users"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <span className="spacer" />
        <button type="button" className="btn-primary" onClick={() => setPanel({ mode: 'create' })}>
          New user
        </button>
      </div>
      <ErrorText message={error} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((u) => (
            <tr
              key={u.id}
              className="clickable"
              onClick={() => setPanel({ mode: 'edit', id: u.id })}
            >
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.roles.map((r) => r.name).join(', ') || '—'}</td>
              <td>
                <span className={`tag tag-${statusLabel(u).toLowerCase()}`}>{statusLabel(u)}</span>
              </td>
            </tr>
          ))}
          {data && data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="pager">
        <span className="muted">{loading ? 'Loading…' : `${data?.total ?? 0} users`}</span>
        <span className="spacer" />
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>

      {panel && (
        <SlideOver title={panel.mode === 'create' ? 'New user' : 'User'} onClose={close}>
          {panel.mode === 'create' ? (
            <CreateUserForm
              onCreated={(id) => {
                reload();
                setPanel({ mode: 'edit', id });
              }}
            />
          ) : (
            <UserDetail id={panel.id} onChanged={reload} />
          )}
        </SlideOver>
      )}
    </section>
  );
}
