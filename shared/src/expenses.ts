import { z } from 'zod';
import type { BudgetMetrics, BoqCostHead } from './budget';
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

export const createExpenseRequestSchema = z
  .object({ ...fields, description: fields.description.optional() })
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
  /** Set on a reversal entry: the expense it cancels. */
  reversalOf: string | null;
  /** Set on an expense that has been reversed. */
  reversedAt: string | null;
};
export type ExpensePage = Page<Expense>;

/** One cost head of one project: its figures (from domain/metrics) and its expenses. */
export type CostHeadDetail = {
  costHead: BoqCostHead;
  metrics: BudgetMetrics;
  status: BudgetStatus;
  expenses: ExpensePage;
  /** False once the project is completed or cancelled. */
  editable: boolean;
};
