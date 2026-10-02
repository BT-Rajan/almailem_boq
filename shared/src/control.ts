import { z } from 'zod';
import { BP_PER_WHOLE, type BudgetMetrics } from './budget';

/**
 * Budget status. Computed only by domain/control on the server; the UI shows it as a dot.
 * The thresholds are data (one row, Admin > Approval Rules), never written in code.
 */
export const BUDGET_STATUSES = ['NORMAL', 'WARNING', 'APPROVAL_REQUIRED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

/** Basis points of the budget at which each status starts. */
export type Thresholds = { warningBp: number; approvalBp: number };

/** Approval can start at 100% at most, so spend on a zero budget always needs it (D3). */
export const thresholdsSchema = z
  .object({
    warningBp: z
      .number()
      .int()
      .min(1)
      .max(BP_PER_WHOLE - 1),
    approvalBp: z.number().int().min(2).max(BP_PER_WHOLE),
  })
  .strict()
  .refine((t) => t.warningBp < t.approvalBp, {
    message: 'The warning level must be below the approval level',
    path: ['warningBp'],
  });

export type ThresholdSettings = Thresholds & { updatedAt: string; updatedBy: string | null };

/** What adding an amount to a head would do, before it is saved. */
export type BudgetProjection = {
  current: { metrics: BudgetMetrics; status: BudgetStatus };
  projected: { metrics: BudgetMetrics; status: BudgetStatus };
};

export const projectionQuerySchema = z
  .object({ amountFils: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER) })
  .strict();

/** "75", "75.5", "99.99" (percent, up to 2 decimals) -> basis points, exactly; null if not a percentage. */
export function percentToBp(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
