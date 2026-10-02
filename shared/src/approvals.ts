import { z } from 'zod';
import type { BudgetProjection } from './control';
import type { Fils } from './money';
import { listQuerySchema, type Page } from './list-query';

/**
 * Approval of spend beyond the approval level (Chunk 10). The transitions live in one place:
 * backend/src/domain/approval-status.ts.
 */
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);

const comment = z.string().trim().min(1).max(1000);

/** An approval may carry a comment; a rejection must say why. */
export const approveRequestSchema = z.object({ comment: comment.optional() }).strict();
export type ApproveRequest = z.infer<typeof approveRequestSchema>;
export const rejectRequestSchema = z.object({ comment }).strict();
export type RejectRequest = z.infer<typeof rejectRequestSchema>;

export const approvalParamsSchema = z.object({ approvalId: z.string().uuid() });

export const APPROVAL_SORTS = ['requested', 'amount', 'project'] as const;
export const listApprovalsQuerySchema = listQuerySchema(APPROVAL_SORTS, {
  status: approvalStatusSchema.default('PENDING'),
});
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;
export type ListApprovalsParams = Partial<z.input<typeof listApprovalsQuerySchema>>;

export type ApprovalItem = {
  id: string;
  status: ApprovalStatus;
  project: { id: string; code: string; name: string };
  costHead: { id: string; code: string; name: string };
  expense: {
    id: string;
    vendor: string;
    invoiceNo: string;
    expenseDate: string;
    amountFils: Fils;
    hasAttachment: boolean;
  };
  reason: string;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  /** Utilisation the head would have reached when the request was made. */
  requestedBp: number;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  /** Utilisation the head reached when it was decided (re-evaluated then). */
  decidedBp: number | null;
  decisionComment: string | null;
  /**
   * Pending only: the head now, and after this expense, from the control engine with today's
   * budget, actual and thresholds. Null once decided.
   */
  now: BudgetProjection | null;
};
export type ApprovalPage = Page<ApprovalItem>;
