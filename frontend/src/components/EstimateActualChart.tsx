import { formatFils, inProjectSummary, type Fils, type ProjectBoq } from '@boq/shared';

/**
 * Approved Estimate against Actual per cost head, as horizontal grouped bars. Informational: the
 * figures are the server's BoQ rows (the same rows, order and numbers as the summary table), and
 * every bar is labelled with its exact value. Bars share one scale, the largest figure shown, so
 * an Actual above its Estimate is drawn longer, never capped. Each head links to its expenses,
 * like its table row.
 */
export function EstimateActualChart(props: { boq: ProjectBoq; projectId: string }) {
  const rows = props.boq.rows.filter(inProjectSummary);
  if (rows.length === 0) {
    return (
      <p className="muted chart-empty">No approved cost heads yet, so there is nothing to chart.</p>
    );
  }
  const max = Math.max(...rows.flatMap((r) => [r.metrics.budget, r.metrics.actual]));
  // Display geometry only: a share of the widest bar. 0 when everything is 0.
  const width = (v: Fils) => (max > 0 ? `${(v / max) * 100}%` : '0%');
  return (
    <figure className="ea-chart" aria-label="Approved Estimate and Actual by cost head">
      <figcaption className="row">
        <strong>Estimate vs Actual</strong>
        <span className="spacer" />
        <span className="ea-key">
          <i className="ea-swatch est" /> Approved Estimate
        </span>
        <span className="ea-key">
          <i className="ea-swatch act" /> Actual
        </span>
      </figcaption>
      <ol className="ea-list">
        {rows.map((r) => {
          const label = `${r.costHead.systemNo} · ${r.costHead.name}`;
          const est = formatFils(r.metrics.budget);
          const act = formatFils(r.metrics.actual);
          return (
            <li key={r.costHead.id}>
              <a
                className="ea-item"
                href={`#/projects/${props.projectId}/heads/${r.costHead.id}`}
                title={`${label}\nApproved Estimate ${est} KWD\nActual ${act} KWD`}
              >
                <span className="ea-label">
                  <span className="muted">{r.costHead.systemNo}</span> {r.costHead.name}
                </span>
                <span className="ea-bars">
                  <span className="ea-line">
                    <span className="ea-track">
                      <span className="ea-bar est" style={{ width: width(r.metrics.budget) }} />
                    </span>
                    <span className="ea-value" aria-label={`Approved Estimate ${est}`}>
                      {est}
                    </span>
                  </span>
                  <span className="ea-line">
                    <span className="ea-track">
                      <span className="ea-bar act" style={{ width: width(r.metrics.actual) }} />
                    </span>
                    <span
                      className={
                        r.metrics.actual > r.metrics.budget ? 'ea-value negative' : 'ea-value'
                      }
                      aria-label={`Actual ${act}`}
                    >
                      {act}
                    </span>
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
