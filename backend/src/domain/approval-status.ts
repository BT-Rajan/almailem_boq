import type { ApprovalStatus, ExpenseStatus } from '@boq/shared';

/**
 * The one place approval transitions are defined. Pure, no I/O.
 * PENDING > APPROVED | REJECTED | CANCELLED. Every decision is final.
 */
const TRANSITIONS: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Every request starts here. */
export const INITIAL_APPROVAL_STATUS: ApprovalStatus = 'PENDING';

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** What the held expense becomes with its request: only an approved one counts toward Actual. */
const EXPENSE_STATUS: Readonly<Record<ApprovalStatus, ExpenseStatus>> = {
  PENDING: 'PENDING_APPROVAL',
  APPROVED: 'POSTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

export function expenseStatusFor(status: ApprovalStatus): ExpenseStatus {
  return EXPENSE_STATUS[status];
}
