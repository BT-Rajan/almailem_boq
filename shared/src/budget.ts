import { z } from 'zod';
import type { Fils } from './money';

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

export type BoqCostHead = { id: string; code: string; name: string; active: boolean };
export type BoqRow = { costHead: BoqCostHead; metrics: BudgetMetrics };
export type ProjectBoq = {
  rows: BoqRow[];
  total: BudgetMetrics;
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
