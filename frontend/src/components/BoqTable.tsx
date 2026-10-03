import {
  formatFils,
  formatUtilisation,
  inProjectSummary,
  type BoqRow,
  type ProjectBoq,
} from '@boq/shared';
import { navigate } from './navigate';
import { StatusDot } from './StatusDot';

/**
 * The project summary: Approved Estimate > Actual > Remaining > Utilisation > Status > Action, one
 * row per approved cost head, with the project total. Every figure and status is the server's
 * (domain/metrics, domain/control); this only formats. A row opens that head's expenses.
 */
export function BoqTable(props: {
  boq: ProjectBoq;
  onEdit?: (row: BoqRow) => void;
  /** When set, each head links to its detail page (expenses). */
  projectId?: string;
}) {
  const { boq, onEdit, projectId } = props;
  const t = boq.total;
  const rows = boq.rows.filter(inProjectSummary);
  const open = (r: BoqRow) =>
    projectId && navigate(`#/projects/${projectId}/heads/${r.costHead.id}`);
  return (
    <div className="table-scroll">
      <table className="table money">
        <thead>
          <tr>
            <th>Cost Code</th>
            <th>Cost Head</th>
            <th className="num">Approved Estimate</th>
            <th className="num">Actual</th>
            <th className="num">Remaining</th>
            <th className="num">Utilisation %</th>
            <th>Status</th>
            <th className="num">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.costHead.id}
              className={
                [projectId && 'clickable', !r.costHead.active && 'inactive']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onClick={() => open(r)}
            >
              <td>{r.costHead.systemNo}</td>
              {/* The head's own code leads the (width-capped) name cell, so the table still fits. */}
              <td className="name" title={`${r.costHead.code} · ${r.costHead.name}`}>
                <span className="muted">{r.costHead.code}</span>{' '}
                {projectId ? (
                  <a href={`#/projects/${projectId}/heads/${r.costHead.id}`}>{r.costHead.name}</a>
                ) : (
                  r.costHead.name
                )}
                {!r.costHead.active && <span className="muted"> (inactive)</span>}
                {!r.inBudget && <span className="muted"> (not in budget)</span>}
              </td>
              <td className="num">{formatFils(r.metrics.budget)}</td>
              <td className="num">{formatFils(r.metrics.actual)}</td>
              <td className={r.metrics.remaining < 0 ? 'num negative' : 'num'}>
                {formatFils(r.metrics.remaining)}
              </td>
              <td className="num">{formatUtilisation(r.metrics.utilisationBp)}</td>
              <td>
                <StatusDot status={r.status} />
              </td>
              <td className="num">
                {!onEdit && projectId && (
                  <a
                    href={`#/projects/${projectId}/heads/${r.costHead.id}`}
                    aria-label={`Open ${r.costHead.systemNo}`}
                  >
                    Open
                  </a>
                )}
                {onEdit && boq.editable && (
                  <button
                    type="button"
                    aria-label={`Edit budget ${r.costHead.code}`}
                    onClick={() => onEdit(r)}
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No approved cost heads yet.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Total</th>
            <th className="num">{formatFils(t.budget)}</th>
            <th className="num">{formatFils(t.actual)}</th>
            <th className={t.remaining < 0 ? 'num negative' : 'num'}>{formatFils(t.remaining)}</th>
            <th className="num">{formatUtilisation(t.utilisationBp)}</th>
            <th>
              <StatusDot status={boq.totalStatus} />
            </th>
            <th />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
