import { z } from 'zod';
import { amountFilsSchema } from './budget';
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

/**
 * Budget (cost structure) approval: a project's selected cost heads and estimated amounts, sent to
 * an administrator through the same approvals as spend. Until approved it is only a proposal; the
 * approved budget is the project's estimates, which only an approval (or an administrator) writes.
 */
export const budgetLineSchema = z
  .object({ costHeadId: z.string().uuid(), amountFils: amountFilsSchema })
  .strict();
export const submitBudgetRequestSchema = z
  .object({
    lines: z
      .array(budgetLineSchema)
      .min(1)
      .max(500)
      .refine(
        (rows) => new Set(rows.map((r) => r.costHeadId)).size === rows.length,
        'Each cost head may appear once',
      ),
  })
  .strict();
export type SubmitBudgetRequest = z.infer<typeof submitBudgetRequestSchema>;

export const BUDGET_APPROVAL_SORTS = ['requested', 'project'] as const;
export const listBudgetApprovalsQuerySchema = listQuerySchema(BUDGET_APPROVAL_SORTS, {
  status: approvalStatusSchema.default('PENDING'),
});
export type ListBudgetApprovalsQuery = z.infer<typeof listBudgetApprovalsQuerySchema>;

export type CostStructureHead = { id: string; systemNo: string; code: string; name: string };

/** What a request does to one head, decided by the server from approved vs proposed. */
export const BUDGET_CHANGES = ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'] as const;
export type BudgetChange = (typeof BUDGET_CHANGES)[number];

export type BudgetProposal = {
  id: string;
  status: ApprovalStatus;
  project: { id: string; systemNo: string; code: string; name: string };
  /** Every head the request touches, as submitted. */
  lines: {
    costHead: CostStructureHead;
    /** Approved estimate when the request was made; null when the head is being added. */
    approvedFils: Fils | null;
    /** Proposed estimate; null when the head is being removed. */
    amountFils: Fils | null;
    change: BudgetChange;
  }[];
  /** Approved total when the request was made, and the total if it is approved. */
  approvedTotalFils: Fils;
  proposedTotalFils: Fils;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionComment: string | null;
};
/**
 * A project's cost structure: the approved budget (authoritative), which heads cannot leave it
 * (they have expenses), and its latest request, if any.
 */
export type CostStructure = {
  approved: { costHead: CostStructureHead; amountFils: Fils }[];
  approvedTotalFils: Fils;
  lockedHeadIds: string[];
  latest: BudgetProposal | null;
  /** False once the project is completed or cancelled. */
  editable: boolean;
};
export type BudgetProposalPage = Page<BudgetProposal>;
