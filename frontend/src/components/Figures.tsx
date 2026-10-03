import { formatFils, formatUtilisation, type BudgetMetrics, type BudgetStatus } from '@boq/shared';
import { StatusDot } from './StatusDot';

/** Budget > Actual > Remaining > Used > Status, as the server computed them. Display only. */
export function Figures(props: {
  metrics: BudgetMetrics;
  status: BudgetStatus;
  label?: string;
  /** Plain figures shown before the money ones (e.g. a project count). */
  lead?: { label: string; value: string }[];
  /** Name the figures as project totals (the project summary). */
  totals?: boolean;
}) {
  const m = props.metrics;
  const n = props.totals
    ? ['Total Approved Estimate', 'Total Actual', 'Total Remaining', 'Overall Utilisation']
    : ['Budget', 'Actual', 'Remaining', 'Used'];
  return (
    <dl className="figures" aria-label={props.label ?? 'Figures'}>
      {props.lead?.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
      <div>
        <dt>{n[0]}</dt>
        <dd>{formatFils(m.budget)}</dd>
      </div>
      <div>
        <dt>{n[1]}</dt>
        <dd>{formatFils(m.actual)}</dd>
      </div>
      <div>
        <dt>{n[2]}</dt>
        <dd className={m.remaining < 0 ? 'negative' : undefined}>{formatFils(m.remaining)}</dd>
      </div>
      <div>
        <dt>{n[3]}</dt>
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
