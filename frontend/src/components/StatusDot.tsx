import type { BudgetStatus } from '@boq/shared';

/** Display only: the server decides the status (domain/control). */
const LABELS: Record<BudgetStatus, string> = {
  NORMAL: 'Normal',
  WARNING: 'Warning',
  APPROVAL_REQUIRED: 'Approval',
};

/** `compact`: the dot alone, its label as tooltip and accessible name (for very wide tables). */
export function StatusDot(props: { status: BudgetStatus; compact?: boolean }) {
  const label = LABELS[props.status];
  if (props.compact)
    return (
      <span
        className={`status status-${props.status.toLowerCase()}`}
        role="img"
        aria-label={label}
        title={label}
      >
        <span className="dot" aria-hidden="true" />
      </span>
    );
  return (
    <span className={`status status-${props.status.toLowerCase()}`}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}
