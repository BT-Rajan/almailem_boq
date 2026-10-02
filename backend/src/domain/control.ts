import {
  thresholdsSchema,
  type BudgetMetrics,
  type BudgetStatus,
  type Fils,
  type Thresholds,
} from '@boq/shared';
import { projectedMetrics } from './metrics';

/**
 * The budget control engine: turns utilisation into a status. The ONE place thresholds are compared.
 * Pure, no I/O. Thresholds are passed in (they are data: one row, Admin > Approval Rules), never
 * written here. Utilisation is integer basis points rounded down (domain/metrics), so comparing it
 * with whole-basis-point thresholds is exact: no float drift just below or at a threshold.
 */

/** Reject thresholds that would make the statuses meaningless (also enforced by the database). */
export function checkThresholds(t: Thresholds): Thresholds {
  // Only the two levels matter; a stored record also carries who changed it and when.
  const parsed = thresholdsSchema.safeParse({ warningBp: t.warningBp, approvalBp: t.approvalBp });
  if (!parsed.success) throw new RangeError('Invalid budget thresholds');
  return parsed.data;
}

export function calculateBudgetStatus(utilisationBp: number, thresholds: Thresholds): BudgetStatus {
  if (!Number.isSafeInteger(utilisationBp))
    throw new RangeError('Utilisation must be whole basis points');
  const t = checkThresholds(thresholds);
  if (utilisationBp >= t.approvalBp) return 'APPROVAL_REQUIRED';
  if (utilisationBp >= t.warningBp) return 'WARNING';
  return 'NORMAL';
}

/**
 * What the status WOULD be after adding `newAmount` to a head (negative for a reversal).
 * Used to warn before an expense is saved; Chunk 10 uses it to decide whether approval is needed.
 */
export function projectedStatus(
  input: { currentActual: Fils; newAmount: Fils; budget: Fils },
  thresholds: Thresholds,
): { metrics: BudgetMetrics; status: BudgetStatus } {
  const metrics = projectedMetrics({
    budget: input.budget,
    actual: input.currentActual,
    additional: input.newAmount,
  });
  return { metrics, status: calculateBudgetStatus(metrics.utilisationBp, thresholds) };
}

/** Most urgent first: approval needed, then warning, then normal. For "needs attention first" lists. */
const URGENCY: Record<BudgetStatus, number> = { APPROVAL_REQUIRED: 0, WARNING: 1, NORMAL: 2 };

/** Stable: items with the same status keep their order. */
export function byUrgency<T>(items: readonly T[], statusOf: (item: T) => BudgetStatus): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => URGENCY[statusOf(a.item)] - URGENCY[statusOf(b.item)] || a.i - b.i)
    .map((x) => x.item);
}
