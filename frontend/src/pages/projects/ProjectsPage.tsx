import { useCallback, useState } from 'react';
import { listProjects } from '../../api/projects';
import { useLoad } from '../../api/use-load';
import { formatDate, statusLabel } from '../../components/format';
import { ErrorText } from '../../components/SlideOver';

const PAGE_SIZE = 50;

/** Only the projects the signed-in user may see; the server decides which. */
export function ProjectsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(
    () => listProjects({ search, page, pageSize: PAGE_SIZE }),
    [search, page],
  );
  const { data, error, loading } = useLoad(load);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Projects</h1>
        <input
          type="search"
          placeholder="Search code or name"
          aria-label="Search projects"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <span className="spacer" />
        <a className="btn-primary button-link" href="#/projects/new">
          New project
        </a>
      </div>
      <ErrorText message={error} />
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Start</th>
            <th>End</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((p) => (
            <tr
              key={p.id}
              className="clickable"
              onClick={() => (window.location.hash = `#/projects/${p.id}`)}
            >
              <td>
                <a href={`#/projects/${p.id}`}>{p.code}</a>
              </td>
              <td>{p.name}</td>
              <td>{statusLabel(p.status)}</td>
              <td>{p.ownerName}</td>
              <td>{formatDate(p.startDate)}</td>
              <td>{formatDate(p.endDate)}</td>
            </tr>
          ))}
          {data && data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No projects found
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="pager">
        <span className="muted">{loading ? 'Loading…' : `${data?.total ?? 0} projects`}</span>
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
    </section>
  );
}
