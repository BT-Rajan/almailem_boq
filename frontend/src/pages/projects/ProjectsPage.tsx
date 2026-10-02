import { listProjects } from '../../api/projects';
import { formatDate, statusLabel } from '../../components/format';
import { Pager, SortHeader, useList } from '../../components/list';
import { navigate } from '../../components/navigate';
import { ErrorText } from '../../components/SlideOver';

/** Only the projects the signed-in user may see; the server decides which. */
export function ProjectsPage() {
  const list = useList(listProjects);
  const { data } = list;
  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Projects</h1>
        <input
          type="search"
          placeholder="Search code or name"
          aria-label="Search projects"
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
        <span className="spacer" />
        <a className="btn-primary button-link" href="#/projects/new">
          New project
        </a>
      </div>
      <ErrorText message={list.error} />
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <SortHeader label="Code" sortKey="code" list={list} />
              <SortHeader label="Name" sortKey="name" list={list} />
              <SortHeader label="Status" sortKey="status" list={list} />
              <th>Owner</th>
              <SortHeader label="Start" sortKey="start" list={list} />
              <SortHeader label="End" sortKey="end" list={list} />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => navigate(`#/projects/${p.id}`)}>
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
      </div>
      <Pager
        data={data}
        page={list.page}
        setPage={list.setPage}
        noun="projects"
        loading={list.loading}
      />
    </section>
  );
}
