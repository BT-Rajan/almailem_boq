import { formatFils, formatUtilisation, type BoqRow, type ProjectBoq } from '@boq/shared';

/**
 * Budget > Actual > Remaining > % Used > Status > Action, per cost head, with the project total.
 * Every figure is the server's (domain/metrics); this only formats.
 * Status stays empty until the control engine exists (Chunk 09).
 */
export function BoqTable(props: {
  boq: ProjectBoq;
  onEdit?: (row: BoqRow) => void;
  /** When set, each head links to its detail page (expenses). */
  projectId?: string;
}) {
  const { boq, onEdit, projectId } = props;
  const t = boq.total;
  return (
    <table className="table money">
      <thead>
        <tr>
          <th>Code</th>
          <th>Cost head</th>
          <th className="num">Budget</th>
          <th className="num">Actual</th>
          <th className="num">Remaining</th>
          <th className="num">Used</th>
          <th>Status</th>
          <th className="num">Action</th>
        </tr>
      </thead>
      <tbody>
        {boq.rows.map((r) => (
          <tr key={r.costHead.id} className={r.costHead.active ? undefined : 'inactive'}>
            <td>{r.costHead.code}</td>
            <td>
              {projectId ? (
                <a href={`#/projects/${projectId}/heads/${r.costHead.id}`}>{r.costHead.name}</a>
              ) : (
                r.costHead.name
              )}
              {!r.costHead.active && <span className="muted"> (inactive)</span>}
            </td>
            <td className="num">{formatFils(r.metrics.budget)}</td>
            <td className="num">{formatFils(r.metrics.actual)}</td>
            <td className={r.metrics.remaining < 0 ? 'num negative' : 'num'}>
              {formatFils(r.metrics.remaining)}
            </td>
            <td className="num">{formatUtilisation(r.metrics.utilisationBp)}</td>
            <td />
            <td className="num">
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
        {boq.rows.length === 0 && (
          <tr>
            <td colSpan={8} className="muted">
              No cost heads yet. An administrator adds them in Cost heads.
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
          <th />
          <th />
        </tr>
      </tfoot>
    </table>
  );
}
