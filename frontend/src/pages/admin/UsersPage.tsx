import { useCallback, useState } from 'react';
import type { AdminUser } from '@boq/shared';
import { listUsers } from '../../api/admin';
import { Pager, SortHeader, useList } from '../../components/list';
import { ErrorText, SlideOver } from '../../components/SlideOver';
import { CreateUserForm, UserDetail } from './UserPanel';

function statusLabel(u: AdminUser): string {
  if (u.disabled) return 'Disabled';
  return u.locked ? 'Locked' : 'Active';
}

export function UsersPage() {
  const [panel, setPanel] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(
    null,
  );

  const list = useList(listUsers);
  const { data, error, loading, reload } = list;

  const close = useCallback(() => setPanel(null), []);

  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Users</h1>
        <input
          type="search"
          placeholder="Search name or email"
          aria-label="Search users"
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
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
            <SortHeader label="Name" sortKey="name" list={list} />
            <SortHeader label="Email" sortKey="email" list={list} />
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
      <Pager data={data} page={list.page} setPage={list.setPage} noun="users" loading={loading} />

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
