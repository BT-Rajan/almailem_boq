import type { ApprovalStatus, ExpenseStatus, ProjectStatus } from '@boq/shared';

/** Display text only. Formatting lives at the UI edge; no rules here. */
const STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const statusLabel = (s: ProjectStatus): string => STATUS_LABELS[s];

/** '2026-01-31' -> '31/01/2026' (Kuwait style), '' for no date. */
export const formatDate = (iso: string | null): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';

/** An ISO timestamp as '31/01/2026 14:05' in the browser's time zone, '' for none. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Today in the browser's time zone, as 'YYYY-MM-DD' (the default date of a new expense). */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Display text for an expense that does not (yet) count toward Actual. */
const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  POSTED: 'Posted',
  PENDING_APPROVAL: 'Awaiting approval',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const expenseStatusLabel = (s: ExpenseStatus): string => EXPENSE_STATUS_LABELS[s];

const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const approvalStatusLabel = (s: ApprovalStatus): string => APPROVAL_STATUS_LABELS[s];
