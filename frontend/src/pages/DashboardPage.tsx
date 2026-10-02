import { formatFils, formatUtilisation } from '@boq/shared';
import { getDashboard } from '../api/dashboard';
import { useLoad } from '../api/use-load';
import { Figures } from '../components/Figures';
import { statusLabel } from '../components/format';
import { navigate } from '../components/navigate';
import { ErrorText } from '../components/SlideOver';
import { StatusDot } from '../components/StatusDot';

/**
 * Home: where is the money going, and where do I act? Every figure and status is the server's.
 * Pending approvals joins the headline figures once approvals exist (Chunk 10).
 */
export function DashboardPage() {
  const { data, error } = useLoad(getDashboard);
  if (!data) return <ErrorText message={error} />;
  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Dashboard</h1>
      </div>
      <Figures
        label="Portfolio figures"
        metrics={data.summary.metrics}
        status={data.summary.status}
        lead={[{ label: 'Projects', value: String(data.summary.projects) }]}
      />
      <div className="table-scroll">
        <table className="table money">
          <thead>
            <tr>
              <th>Project</th>
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Remaining</th>
              <th className="num">Used</th>
              <th>Status</th>
              <th className="num">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => navigate(`#/projects/${p.id}`)}>
                <td className="name" title={`${p.code} · ${p.name}`}>
                  {p.code} · {p.name}{' '}
                  <span className="tag muted">{statusLabel(p.projectStatus)}</span>
                </td>
                <td className="num">{formatFils(p.metrics.budget)}</td>
                <td className="num">{formatFils(p.metrics.actual)}</td>
                <td className={p.metrics.remaining < 0 ? 'num negative' : 'num'}>
                  {formatFils(p.metrics.remaining)}
                </td>
                <td className="num">{formatUtilisation(p.metrics.utilisationBp)}</td>
                <td>
                  <StatusDot status={p.status} />
                </td>
                <td className="num">
                  <a href={`#/projects/${p.id}`} aria-label={`Open ${p.code}`}>
                    Open
                  </a>
                </td>
              </tr>
            ))}
            {data.projects.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No projects yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
