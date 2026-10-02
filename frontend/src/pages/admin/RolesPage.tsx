import { listRoles } from '../../api/admin';
import { useLoad } from '../../api/use-load';
import { ErrorText } from '../../components/SlideOver';

/** Read-only: roles are bundles of permissions, assigned to users on the Users page. */
export function RolesPage() {
  const { data, error, loading } = useLoad(listRoles);
  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Roles</h1>
      </div>
      <ErrorText message={error} />
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Description</th>
              <th>Permissions</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.description ?? '—'}</td>
                <td className="perms">{r.permissions.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="muted">Loading…</p>}
    </section>
  );
}
