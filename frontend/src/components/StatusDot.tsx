import type { BudgetStatus } from '@boq/shared';

/** Display only: the server decides the status (domain/control). */
const LABELS: Record<BudgetStatus, string> = {
  NORMAL: 'Normal',
  WARNING: 'Warning',
  APPROVAL_REQUIRED: 'Approval',
};

export function StatusDot(props: { status: BudgetStatus }) {
  const label = LABELS[props.status];
  return (
    <span className={`status status-${props.status.toLowerCase()}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}
