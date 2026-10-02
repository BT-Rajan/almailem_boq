import { formatFils, formatUtilisation, type BudgetMetrics, type BudgetStatus } from '@boq/shared';
import { StatusDot } from './StatusDot';

/** Budget > Actual > Remaining > Used > Status, as the server computed them. Display only. */
export function Figures(props: {
  metrics: BudgetMetrics;
  status: BudgetStatus;
  label?: string;
  /** Plain figures shown before the money ones (e.g. a project count). */
  lead?: { label: string; value: string }[];
}) {
  const m = props.metrics;
  return (
    <dl className="figures" aria-label={props.label ?? 'Figures'}>
      {props.lead?.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
      <div>
        <dt>Budget</dt>
        <dd>{formatFils(m.budget)}</dd>
      </div>
      <div>
        <dt>Actual</dt>
        <dd>{formatFils(m.actual)}</dd>
      </div>
      <div>
        <dt>Remaining</dt>
        <dd className={m.remaining < 0 ? 'negative' : undefined}>{formatFils(m.remaining)}</dd>
      </div>
      <div>
        <dt>Used</dt>
        <dd>{formatUtilisation(m.utilisationBp)}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <StatusDot status={props.status} />
        </dd>
      </div>
    </dl>
  );
}
