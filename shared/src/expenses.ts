import { z } from 'zod';
import type { BudgetMetrics, BoqCostHead } from './budget';
import type { ApprovalStatus } from './approvals';
import type { BudgetStatus } from './control';
import type { Fils } from './money';
import { listQuerySchema, type Page } from './list-query';
import { isoDateSchema } from './projects';

/** Expenses (bills). Money is integer fils. Delete means reverse: a linked negative entry. */

export const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
/** Header carrying the original file name (URI-encoded) with an attachment upload. */
export const ATTACHMENT_NAME_HEADER = 'x-file-name';

const positiveFils = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const fields = {
  costHeadId: z.string().uuid(),
  vendor: z.string().trim().min(1).max(200),
  invoiceNo: z.string().trim().min(1).max(60),
  expenseDate: isoDateSchema,
  amountFils: positiveFils,
  description: z.string().trim().max(2000).nullable(),
};

/**
 * Why spend beyond the approval level is needed. Required, and only read, when the expense would
 * take its head to the approval level (the server decides that, with domain/control).
 */
export const approvalReasonSchema = z.string().trim().min(1).max(500);

export const createExpenseRequestSchema = z
  .object({
    ...fields,
    description: fields.description.optional(),
    approvalReason: approvalReasonSchema.optional(),
  })
  .strict();
export type CreateExpenseRequest = z.input<typeof createExpenseRequestSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseRequestSchema>;

export const updateExpenseRequestSchema = z
  .object({
    costHeadId: fields.costHeadId.optional(),
    vendor: fields.vendor.optional(),
    invoiceNo: fields.invoiceNo.optional(),
    expenseDate: fields.expenseDate.optional(),
    amountFils: fields.amountFils.optional(),
    description: fields.description.optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Nothing to update');
export type UpdateExpenseRequest = z.input<typeof updateExpenseRequestSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseRequestSchema>;

/** A reason is required: a reversal is a correction someone must be able to understand later. */
export const reverseExpenseRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type ReverseExpenseRequest = z.infer<typeof reverseExpenseRequestSchema>;

export const EXPENSE_SORTS = ['date', 'amount', 'vendor', 'invoice'] as const;
export const listExpensesQuerySchema = listQuerySchema(EXPENSE_SORTS, {
  costHeadId: z.string().uuid().optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const expenseParamsSchema = z.object({
  projectId: z.string().uuid(),
  expenseId: z.string().uuid(),
});
export const costHeadParamsSchema = z.object({
  projectId: z.string().uuid(),
  costHeadId: z.string().uuid(),
});

/**
 * Only POSTED expenses count toward Actual. PENDING_APPROVAL is held until an administrator
 * decides; REJECTED and CANCELLED never count. Reversal entries are always POSTED.
 */
export const EXPENSE_STATUSES = ['POSTED', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);

/** The approval request behind a held expense, as the expense list shows it. */
export type ExpenseApproval = {
  id: string;
  status: ApprovalStatus;
  reason: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionComment: string | null;
};

export type Expense = {
  id: string;
  costHead: { id: string; code: string; name: string };
  vendor: string;
  invoiceNo: string;
  expenseDate: string;
  /** Positive for an expense, negative for a reversal entry. */
  amountFils: Fils;
  description: string | null;
  attachment: { name: string; type: AttachmentType; size: number } | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  /** Who changed it last (edit, bill, reversal, approval decision); null if never changed. */
  modifiedBy: { id: string; name: string } | null;
  modifiedAt: string;
  /** Set on a reversal entry: the expense it cancels. */
  reversalOf: string | null;
  /** Set on an expense that has been reversed. */
  reversedAt: string | null;
  status: ExpenseStatus;
  /** Set when the expense needed approval. */
  approval: ExpenseApproval | null;
};
export type ExpensePage = Page<Expense>;

/** An expense an administrator deleted: not active, listed only so its history stays reachable. */
export type DeletedExpenseRef = {
  id: string;
  invoiceNo: string;
  expenseDate: string;
  amountFils: Fils;
  deletedBy: { id: string; name: string } | null;
  deletedAt: string;
};

/** One cost head of one project: its figures (from domain/metrics) and its expenses. */
export type CostHeadDetail = {
  costHead: BoqCostHead;
  metrics: BudgetMetrics;
  status: BudgetStatus;
  expenses: ExpensePage;
  /** In the project's approved budget: only then does it take new expenses. */
  inBudget: boolean;
  /** Deleted expenses of this head, newest first. They never count and are not in `expenses`. */
  deleted: DeletedExpenseRef[];
  /** False once the project is completed or cancelled. */
  editable: boolean;
};

/** What a history entry records. Plain actions, not internal event names. */
export const EXPENSE_HISTORY_ACTIONS = [
  'CREATED',
  'MODIFIED',
  'BILL_UPLOADED',
  'REVERSED',
  'APPROVAL_REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'DELETED',
] as const;
export type ExpenseHistoryAction = (typeof EXPENSE_HISTORY_ACTIONS)[number];
/** Fields a change can name; amounts are fils, the cost head is its "C001 · name" label. */
export type ExpenseHistoryField =
  'costHead' | 'vendor' | 'invoiceNo' | 'expenseDate' | 'amountFils' | 'description' | 'bill';
export type ExpenseHistoryChange = {
  field: ExpenseHistoryField;
  from: string | number | null;
  to: string | number | null;
};
export type ExpenseHistoryEntry = {
  action: ExpenseHistoryAction;
  /** null: the system acted. */
  by: { id: string; name: string } | null;
  at: string;
  changes: ExpenseHistoryChange[];
  /** A reason or decision comment, when there was one. */
  note: string | null;
};

/** One expense with where it belongs and everything that happened to it, oldest first. */
export type ExpenseDetail = {
  expense: Expense;
  project: { id: string; systemNo: string; code: string; name: string };
  costHead: { id: string; systemNo: string; code: string; name: string };
  /** Set when an administrator deleted it: it is kept on record but no longer active. */
  deleted: { by: { id: string; name: string } | null; at: string } | null;
  history: ExpenseHistoryEntry[];
};
