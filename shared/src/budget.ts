import { z } from 'zod';
import type { BudgetStatus } from './control';
import type { Fils } from './money';

/** The unit of utilisation: basis points in 100% (1% = 100). A unit, not a threshold. */
export const BP_PER_WHOLE = 10_000;

/**
 * Budget figures as the API sends them. Every number here is computed on the server by
 * domain/metrics; the UI only formats them.
 */
export type BudgetMetrics = {
  budget: Fils;
  actual: Fils;
  /** budget - actual; negative when over budget. */
  remaining: Fils;
  /**
   * Actual as a share of budget, in basis points (1% = 100), rounded down, so integer
   * comparisons against thresholds are exact. Budget 0 with spend counts as 100% (D3).
   */
  utilisationBp: number;
};

export type BoqCostHead = {
  id: string;
  /** System number, C001.... */
  systemNo: string;
  code: string;
  name: string;
  active: boolean;
};
/** Status comes from domain/control, using the thresholds in Admin > Approval Rules. */
export type BoqRow = {
  costHead: BoqCostHead;
  metrics: BudgetMetrics;
  status: BudgetStatus;
  /** In the project's approved budget: only these heads take expenses. */
  inBudget: boolean;
};
/**
 * Rows of the project summary: the approved budget heads, plus any other head still carrying
 * spend (from before budgets were approved), so the rows always add up to the server's total.
 */
export const inProjectSummary = (r: BoqRow): boolean => r.inBudget || r.metrics.actual !== 0;

export type ProjectBoq = {
  rows: BoqRow[];
  total: BudgetMetrics;
  totalStatus: BudgetStatus;
  /** False once the project is completed or cancelled. */
  editable: boolean;
};

/** Amounts are integer fils (D2), never KWD decimals. */
export const amountFilsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const setEstimatesRequestSchema = z
  .object({
    estimates: z
      .array(z.object({ costHeadId: z.string().uuid(), amountFils: amountFilsSchema }).strict())
      .min(1)
      .max(500)
      .refine(
        (rows) => new Set(rows.map((r) => r.costHeadId)).size === rows.length,
        'Each cost head may appear once',
      ),
  })
  .strict();
export type SetEstimatesRequest = z.infer<typeof setEstimatesRequestSchema>;

/** 7999 -> "79.99%". The single percentage formatter; use it at the UI edge. */
export function formatUtilisation(bp: number): string {
  const sign = bp < 0 ? '-' : '';
  const abs = Math.abs(bp);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}%`;
}
