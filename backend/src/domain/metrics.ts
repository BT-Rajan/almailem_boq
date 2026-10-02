import { fils, sumFils, subFils, type BudgetMetrics, type Fils } from '@boq/shared';

/**
 * The ONE place budget maths happens: remaining, utilisation and totals.
 * Pure functions, no I/O, no thresholds (those belong to domain/control).
 * The API sends these results; nothing else recomputes them.
 */

const BP_PER_WHOLE = 10_000n; // basis points in 100%
const MAX_BP = BigInt(Number.MAX_SAFE_INTEGER);

/** Floor division for BigInt (BigInt "/" truncates toward zero). */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/**
 * Utilisation in basis points, rounded down. Exact for any safe-integer fils (BigInt maths), and
 * rounding down keeps "utilisation >= threshold" exact for whole-basis-point thresholds.
 * Budget 0: no spend is 0%; any spend counts as 100% (D3).
 */
export function utilisationBp(budget: Fils, actual: Fils): number {
  if (budget === 0) return actual > 0 ? 10_000 : 0;
  const bp = floorDiv(BigInt(actual) * BP_PER_WHOLE, BigInt(budget));
  // A tiny budget with enormous spend can exceed the safe range; it is "over" either way.
  if (bp > MAX_BP) return Number(MAX_BP);
  if (bp < -MAX_BP) return -Number(MAX_BP);
  return Number(bp);
}

export function budgetMetrics(input: { budget: Fils; actual: Fils }): BudgetMetrics {
  const { budget, actual } = input;
  if (budget < 0) throw new RangeError('Budget cannot be negative');
  return {
    budget,
    actual,
    remaining: subFils(budget, actual),
    utilisationBp: utilisationBp(budget, actual),
  };
}

/** Totals for a set of heads: budgets and actuals are summed, then measured as one. */
export function totalMetrics(rows: readonly { budget: Fils; actual: Fils }[]): BudgetMetrics {
  return budgetMetrics({
    budget: sumFils(rows.map((r) => r.budget)),
    actual: sumFils(rows.map((r) => r.actual)),
  });
}

/** Zero, as Fils. Until expenses exist (Chunk 08), every actual is this. */
export const NO_SPEND: Fils = fils(0);
